// Protocol demonstration using real stdio or HTTP MCP clients, not autonomous AIs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

const suffix = randomUUID().slice(0, 8);
const contextId = `demo-${suffix}`;
const clients = [];
async function connect(agent) {
  const remote = process.env.AGENTBUS_MCP_URL;
  const url = remote ? new URL(remote) : undefined;
  url?.searchParams.set("agent", agent);
  const transport = url
    ? new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: { Authorization: `Bearer ${process.env.AGENTBUS_SECRET}` },
        },
      })
    : new StdioClientTransport({
        command: process.execPath,
        args: [new URL("../dist/src/index.js", import.meta.url).pathname],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([, value]) => value !== undefined,
            ),
          ),
          AGENTBUS_AGENT: agent,
        },
        stderr: "pipe",
      });
  const client = new Client(
    { name: "agentbus-demo", version: "0.1.0" },
    { capabilities: {} },
  );
  clients.push({ client, transport });
  if ("stderr" in transport) transport.stderr?.on("data", () => {});
  await client.connect(transport);
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result.content));
  return JSON.parse(result.content.find((item) => item.type === "text").text);
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  const alphaName = `demo-alpha-${suffix}`,
    betaName = `demo-beta-${suffix}`;
  const alpha = await connect(alphaName);
  assert.equal((await alpha.listTools()).tools.length, 11);
  const sendArgs = {
    to: [betaName],
    contextId,
    text: "Question sent while beta is offline",
    requestId: randomUUID(),
  };
  const stored = await call(alpha, "message_send", sendArgs);
  assert.equal(
    (await call(alpha, "message_send", sendArgs)).messageId,
    stored.messageId,
  );
  console.log("PASS: durable offline send and idempotent retry");

  let beta = await connect(betaName);
  const pending = await call(beta, "inbox_read");
  assert.equal(pending.deliveries.length, 1);
  assert.equal(pending.deliveries[0].message.sender, alphaName);
  const duplicateRead = await call(beta, "inbox_read");
  assert.equal(duplicateRead.deliveries.length, 1);
  await beta.close();
  beta = await connect(betaName);
  const recovered = await call(beta, "inbox_read");
  assert.equal(recovered.deliveries[0]._id, pending.deliveries[0]._id);
  await call(beta, "inbox_ack", { deliveryIds: [pending.deliveries[0]._id] });
  console.log(
    "PASS: unacknowledged inbox survives client restart; reads do not acknowledge",
  );

  let initialResolve;
  const initial = new Promise((resolve) => {
    initialResolve = resolve;
  });
  let nextResolve;
  beta.setNotificationHandler(
    ResourceUpdatedNotificationSchema,
    (notification) => {
      assert.equal(notification.params.uri, "agentbus://inbox");
      if (initialResolve) {
        initialResolve();
        initialResolve = undefined;
      } else nextResolve?.();
    },
  );
  const subscriptions =
    beta.getServerCapabilities()?.resources?.subscribe === true;
  if (subscriptions) {
    await beta.subscribeResource({ uri: "agentbus://inbox" });
    await bounded(initial, "Initial resource notification");
  }
  const live = new Promise((resolve) => {
    nextResolve = resolve;
  });
  const waiting = call(beta, "inbox_wait", { timeoutMs: 10000 });
  const liveMessage = await call(alpha, "message_send", {
    to: [betaName],
    contextId,
    text: "Live question while beta's listener is running",
  });
  if (subscriptions) await bounded(live, "Live resource notification");
  const delivered = await waiting;
  assert.equal(delivered.timedOut, false);
  assert.equal(delivered.deliveries[0].message._id, liveMessage.messageId);
  const resource = await beta.readResource({ uri: "agentbus://inbox" });
  assert.equal(
    JSON.parse(resource.contents[0].text).deliveries[0].message._id,
    liveMessage.messageId,
  );
  await call(beta, "inbox_ack", { deliveryIds: [delivered.deliveries[0]._id] });
  if (subscriptions)
    await beta.unsubscribeResource({ uri: "agentbus://inbox" });
  assert.equal(
    (await call(beta, "inbox_wait", { timeoutMs: 100 })).timedOut,
    true,
  );
  console.log(
    subscriptions
      ? "PASS: Convex push → MCP resource notification, inbox wait, resource read, and timeout"
      : "PASS: HTTP MCP inbox wait, resource read, and timeout (no persistent subscription advertised)",
  );

  const reply = await call(beta, "message_send", {
    to: [alphaName],
    contextId,
    replyTo: liveMessage.messageId,
    text: "Reply through AgentBus",
  });
  const replyInbox = await call(alpha, "inbox_read");
  assert.equal(replyInbox.deliveries[0].message._id, reply.messageId);
  await call(alpha, "inbox_ack", {
    deliveryIds: [replyInbox.deliveries[0]._id],
  });

  const root = await call(alpha, "task_create", {
    title: "Demo parent task",
    description: "Verify a real protocol round trip",
    assignee: alphaName,
    contextId,
  });
  const child = await call(alpha, "task_create", {
    title: "Demo subtask",
    description: "Check the worker response",
    assignee: betaName,
    parentTaskId: root._id,
  });
  assert.equal(child.contextId, root.contextId);
  const working = await call(beta, "task_update", {
    taskId: child._id,
    expectedRevision: 0,
    state: "working",
  });
  assert.equal(working.revision, 1);
  const stale = await beta.callTool({
    name: "task_update",
    arguments: { taskId: child._id, expectedRevision: 0, state: "done" },
  });
  assert.equal(stale.isError, true);
  const done = await call(beta, "task_update", {
    taskId: child._id,
    expectedRevision: 1,
    state: "done",
    summary: "MCP protocol checks passed; this is not an AI execution claim.",
  });
  assert.equal(done.revision, 2);
  assert.equal(
    (await call(alpha, "task_list", { contextId, assignee: betaName })).tasks
      .length,
    1,
  );
  await call(alpha, "task_update", {
    taskId: root._id,
    expectedRevision: 0,
    state: "done",
    summary: "Protocol demo complete",
  });
  console.log(
    "PASS: replies, parent/subtasks, assignment delivery, filtering, and revision conflicts",
  );
  console.log(
    `Demo complete. Context: ${contextId}. These are protocol clients, not autonomous agents.`,
  );
} finally {
  await Promise.allSettled(clients.map(({ client }) => client.close()));
}

import { afterEach, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpHandler } from "../src/http.js";
import type { BusClient } from "../src/client.js";

const secret = "http-test-only-".repeat(5);
const env = {
  AGENTBUS_SECRET: secret,
  CONVEX_URL: "https://example.convex.cloud",
};
let server: Server | undefined;
const clients: Client[] = [];
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});
async function listen(options: Parameters<typeof createHttpHandler>[0] = {}) {
  server = createServer(createHttpHandler({ env, ...options }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/api/mcp`;
}
const headers = {
  Authorization: `Bearer ${secret}`,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

test("HTTP rejects unauthenticated access and cross-origin requests before opening Convex", async () => {
  let opened = false;
  const url = await listen({
    createBus: () => {
      opened = true;
      throw new Error("Should not open");
    },
  });
  expect((await fetch(`${url}?agent=alpha`, { method: "POST" })).status).toBe(
    401,
  );
  expect(
    (
      await fetch(`${url}?agent=alpha`, {
        method: "POST",
        headers: { ...headers, Origin: "https://attacker.example" },
      })
    ).status,
  ).toBe(403);
  expect(opened).toBe(false);
});

test("HTTP validates method, configuration, and per-request agent selection", async () => {
  const url = await listen();
  expect((await fetch(`${url}?agent=alpha`, { headers })).status).toBe(405);
  expect((await fetch(url, { method: "POST", headers })).status).toBe(400);
  expect(
    (await fetch(`${url}?agent=alpha&agent=beta`, { method: "POST", headers }))
      .status,
  ).toBe(400);
  expect(
    (await fetch(`${url}?agent=../bad`, { method: "POST", headers })).status,
  ).toBe(400);
});

test("unconfigured HTTP deployment fails closed", async () => {
  const url = await listen({ env: {} });
  const response = await fetch(`${url}?agent=alpha`, {
    method: "POST",
    headers,
  });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain(secret);
});

test("real HTTP MCP clients use independent stateless requests and clean up per request", async () => {
  const opened: string[] = [],
    closed: string[] = [];
  const url = await listen({
    createBus: (config) => {
      opened.push(config.agent);
      return {
        agent: config.agent,
        heartbeat: async () => ({ ok: true }),
        inbox: async () => ({ deliveries: [], nextSeq: 0, hasMore: false }),
        close: async () => {
          closed.push(config.agent);
        },
        publicError: () => "safe error",
        onInboxChanged: () => {
          throw new Error(
            "Stateless HTTP must not open a persistent resource subscription",
          );
        },
      } as unknown as BusClient;
    },
  });
  for (const agent of ["alpha", "beta"]) {
    const client = new Client(
      { name: "http-test", version: "1" },
      { capabilities: {} },
    );
    clients.push(client);
    const transport = new StreamableHTTPClientTransport(
      new URL(`${url}?agent=${agent}`),
      { requestInit: { headers } },
    );
    await client.connect(transport);
    expect(transport.sessionId).toBeUndefined();
    expect(client.getServerCapabilities()?.resources?.subscribe).not.toBe(true);
    expect((await client.listTools()).tools).toHaveLength(11);
    const read = await client.callTool({ name: "inbox_read", arguments: {} });
    expect(read.isError).not.toBe(true);
    expect(
      JSON.parse((read.content as { type: string; text: string }[])[0].text)
        .deliveries,
    ).toEqual([]);
  }
  expect(opened).toContain("alpha");
  expect(opened).toContain("beta");
  expect(closed).toEqual(opened);
});

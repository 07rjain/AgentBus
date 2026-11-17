import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BusClient } from "./client.js";

export const INBOX_URI = "agentbus://inbox";
const agentName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
const limit = z.number().int().min(1).max(100).optional();
const cursor = z.string().optional();
const requestId = z.string().min(1).max(128).optional();
const taskStates = [
  "open",
  "working",
  "blocked",
  "review",
  "done",
  "canceled",
] as const;

export function createMcpServer(
  bus: BusClient,
  options: { subscriptions?: boolean } = {},
) {
  const subscriptions = options.subscriptions ?? true;
  const server = new Server(
    { name: "agentbus-remote", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: subscriptions ? { subscribe: true } : {},
      },
      instructions: `You are ${bus.agent} on AgentBus. All coordination with peers must use AgentBus. Read inbox inputs between work steps, reply with the same contextId and replyTo, and acknowledge delivery IDs only after handling them. inbox_wait waits for pending input when you are idle. Resource update notifications do not themselves insert messages into your conversation. Basic tasks do not enforce manager approval gates.`,
    },
  );
  const tools = new Map<
    string,
    {
      definition: Tool;
      invoke: (args: unknown, signal: AbortSignal) => Promise<unknown>;
    }
  >();
  function tool<T extends z.ZodObject>(
    name: string,
    description: string,
    schema: T,
    run: (args: z.infer<T>, signal: AbortSignal) => Promise<unknown>,
    readOnly = false,
  ) {
    tools.set(name, {
      definition: {
        name,
        description,
        inputSchema: z.toJSONSchema(schema, {
          target: "draft-7",
          io: "input",
        }) as Tool["inputSchema"],
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      invoke: (args, signal) => run(schema.parse(args), signal),
    });
  }
  tool(
    "agent_list",
    "List registered agents, capabilities, state, and last heartbeat. Paginate with nextCursor.",
    z.object({ limit, cursor }),
    (args) => bus.agents(args),
    true,
  );
  tool(
    "agent_status",
    "Set this agent's state. Other agents can see it; state changes do not replace messages.",
    z.object({ state: z.enum(["idle", "working", "blocked", "offline"]) }),
    (args) => bus.heartbeat(args.state),
  );
  tool(
    "message_send",
    "Send a durable message to named agents, including offline agents. Reuse contextId for a conversation and supply a stable requestId for retries.",
    z.object({
      to: z.array(agentName).min(1).max(50),
      text: z.string().min(1).max(32768),
      contextId: z.string().min(1).max(128).optional(),
      taskId: z.string().optional(),
      replyTo: z.string().optional(),
      requestId,
    }),
    (args) => bus.send(args),
  );
  tool(
    "message_list",
    "Read conversation history. Reading does not acknowledge recipient deliveries.",
    z.object({ contextId: z.string().min(1).max(128), cursor, limit }),
    (args) => bus.history(args),
    true,
  );
  tool(
    "inbox_read",
    "Read this agent's unacknowledged deliveries. Nothing is marked handled. Start without afterSeq to recover old pending messages.",
    z.object({
      afterSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
      limit,
    }),
    (args) => bus.inbox(args),
    true,
  );
  tool(
    "inbox_ack",
    "Acknowledge specific delivery IDs after handling them. Acknowledgment is not approval of a task.",
    z.object({ deliveryIds: z.array(z.string().min(1)).min(1).max(100) }),
    async (args) => {
      const result = await bus.acknowledge(args.deliveryIds);
      notify();
      return result;
    },
  );
  tool(
    "inbox_wait",
    "Wait up to 25 seconds for unacknowledged input using a live Convex subscription. Returns immediately if input is already pending. Use while idle; it occupies this tool call.",
    z.object({
      timeoutMs: z.number().int().min(100).max(25000).optional(),
      limit,
    }),
    (args, signal) => bus.wait(args.timeoutMs, args.limit, signal),
    true,
  );
  tool(
    "task_create",
    "Assign a basic task or subtask and atomically notify the assignee. A subtask inherits its parent's context when contextId is omitted. No enforced coordinator gates in this personal version.",
    z.object({
      title: z.string().min(1).max(256),
      description: z.string().min(1).max(16000),
      assignee: agentName,
      contextId: z.string().min(1).max(128).optional(),
      parentTaskId: z.string().optional(),
      requestId,
    }),
    (args) => bus.createTask(args),
  );
  tool(
    "task_get",
    "Read a task and its current revision.",
    z.object({ taskId: z.string().min(1) }),
    (args) => bus.task(args.taskId),
    true,
  );
  tool(
    "task_list",
    "List tasks, optionally filtered by context and/or assignee. Paginate with nextCursor.",
    z.object({
      contextId: z.string().optional(),
      assignee: agentName.optional(),
      cursor,
      limit,
    }),
    (args) => bus.tasks(args),
    true,
  );
  tool(
    "task_update",
    "Creator or assignee updates a basic task with expectedRevision. Stale revisions fail. done and canceled are terminal; summary should include actual results.",
    z.object({
      taskId: z.string().min(1),
      expectedRevision: z.number().int().min(0),
      state: z.enum(taskStates),
      summary: z.string().min(1).max(16000).optional(),
      requestId,
    }),
    (args) => bus.updateTask(args),
  );

  let subscribed = false;
  let stopped = false;
  const pendingNotifications = new Set<Promise<void>>();
  function notify() {
    if (!subscribed || stopped) return;
    const operation = server
      .notification({
        method: "notifications/resources/updated",
        params: { uri: INBOX_URI },
      })
      .catch(() => {})
      .finally(() => pendingNotifications.delete(operation));
    pendingNotifications.add(operation);
  }
  const unsubscribe = subscriptions
    ? bus.onInboxChanged(notify, () => {
        // Avoid printing credentials contained in SDK error arguments.
        process.stderr.write(
          "AgentBus inbox subscription failed; check deployment connectivity and credentials.\n",
        );
      })
    : () => {};
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map((tool) => tool.definition),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const tool = tools.get(request.params.name);
      if (!tool) throw new Error("Unknown AgentBus tool");
      const result = await tool.invoke(
        request.params.arguments ?? {},
        extra.signal,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      // Convex errors may contain internal query args: redact the shared secret.
      const message = bus.publicError(error);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: INBOX_URI,
        name: `${bus.agent} inbox`,
        description:
          "Unacknowledged AgentBus deliveries. Subscribe for change notifications; read to fetch actual messages.",
        mimeType: "application/json",
      },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== INBOX_URI) throw new Error("Unknown resource");
    try {
      return {
        contents: [
          {
            uri: INBOX_URI,
            mimeType: "application/json",
            text: JSON.stringify(await bus.inbox()),
          },
        ],
      };
    } catch (error) {
      throw new Error(bus.publicError(error));
    }
  });
  if (subscriptions)
    server.setRequestHandler(SubscribeRequestSchema, async (request) => {
      if (request.params.uri !== INBOX_URI) throw new Error("Unknown resource");
      subscribed = true;
      // Notify once after subscribe so an existing backlog is not overlooked.
      queueMicrotask(notify);
      return {};
    });
  if (subscriptions)
    server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      if (request.params.uri !== INBOX_URI) throw new Error("Unknown resource");
      subscribed = false;
      return {};
    });
  return {
    server,
    stop: async () => {
      stopped = true;
      unsubscribe();
      await Promise.allSettled(pendingNotifications);
    },
  };
}

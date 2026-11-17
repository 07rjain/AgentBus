import { randomUUID } from "node:crypto";
import { ConvexClient } from "convex/browser";
import {
  anyApi,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import type { api as Api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

const api = anyApi as unknown as typeof Api;
type Input<T extends keyof typeof api.bus> = Omit<
  FunctionArgs<(typeof api.bus)[T]>,
  "secret" | "agent"
>;
export type Inbox = FunctionReturnType<typeof api.bus.inbox>;
export type Config = { url: string; secret: string; agent: string };

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.CONVEX_URL;
  const secret = env.AGENTBUS_SECRET;
  const agent = env.AGENTBUS_AGENT;
  if (!url || !secret || !agent)
    throw new Error(
      "Set CONVEX_URL, AGENTBUS_SECRET, and AGENTBUS_AGENT (see .env.example)",
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
  )
    throw new Error(
      "CONVEX_URL must use HTTPS, or HTTP on loopback for local development",
    );
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error(
      "CONVEX_URL must be a deployment origin without credentials, path, query, or fragment",
    );
  if (secret.length < 32)
    throw new Error("AGENTBUS_SECRET must contain at least 32 characters");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(agent))
    throw new Error(
      "AGENTBUS_AGENT must be a 1–64 character agent name (letters, digits, dot, underscore, hyphen)",
    );
  return { url: parsed.origin, secret, agent };
}

export class BusClient {
  readonly agent: string;
  private readonly client: ConvexClient;
  private readonly auth: { secret: string; agent: string };
  constructor(config: Config) {
    this.agent = config.agent;
    this.auth = { secret: config.secret, agent: config.agent };
    // Never let SDK logs corrupt MCP's stdout protocol or print query arguments.
    this.client = new ConvexClient(config.url, { logger: false });
  }
  register(capabilities: string[] = []) {
    return this.client.mutation(api.bus.register, {
      ...this.auth,
      capabilities,
    });
  }
  heartbeat(state?: Input<"heartbeat">["state"]) {
    return this.client.mutation(api.bus.heartbeat, {
      ...this.auth,
      ...(state ? { state } : {}),
    });
  }
  agents(input: Input<"agents"> = {}) {
    return this.client.query(api.bus.agents, { ...this.auth, ...input });
  }
  send(input: {
    to: string[];
    text: string;
    contextId?: string;
    taskId?: string;
    replyTo?: string;
    requestId?: string;
  }) {
    const requestId = input.requestId ?? randomUUID();
    const contextId = input.contextId ?? requestId;
    return this.client
      .mutation(api.bus.send, {
        ...this.auth,
        ...input,
        contextId,
        requestId,
        taskId: input.taskId as Id<"tasks"> | undefined,
        replyTo: input.replyTo as Id<"messages"> | undefined,
      })
      .then((result) => ({ ...result, contextId, requestId }));
  }
  inbox(input: Input<"inbox"> = {}) {
    return this.client.query(api.bus.inbox, { ...this.auth, ...input });
  }
  acknowledge(deliveryIds: string[]) {
    return this.client.mutation(api.bus.acknowledge, {
      ...this.auth,
      deliveryIds: deliveryIds as Id<"deliveries">[],
    });
  }
  history(input: Input<"history">) {
    return this.client.query(api.bus.history, { ...this.auth, ...input });
  }
  async createTask(input: {
    title: string;
    description: string;
    assignee: string;
    contextId?: string;
    parentTaskId?: string;
    requestId?: string;
  }) {
    const requestId = input.requestId ?? randomUUID();
    const contextId =
      input.contextId ??
      (input.parentTaskId
        ? (await this.task(input.parentTaskId)).contextId
        : requestId);
    return this.client.mutation(api.bus.createTask, {
      ...this.auth,
      ...input,
      contextId,
      requestId,
      parentTaskId: input.parentTaskId as Id<"tasks"> | undefined,
    });
  }
  task(taskId: string) {
    return this.client.query(api.bus.getTask, {
      ...this.auth,
      taskId: taskId as Id<"tasks">,
    });
  }
  tasks(input: Input<"tasks"> = {}) {
    return this.client.query(api.bus.tasks, { ...this.auth, ...input });
  }
  updateTask(input: {
    taskId: string;
    expectedRevision: number;
    state: Input<"updateTask">["state"];
    summary?: string;
    requestId?: string;
  }) {
    return this.client.mutation(api.bus.updateTask, {
      ...this.auth,
      ...input,
      taskId: input.taskId as Id<"tasks">,
      requestId: input.requestId ?? randomUUID(),
    });
  }
  onInboxChanged(
    onChange: () => void,
    onError: (error: Error) => void,
  ): () => void {
    let last: number | undefined;
    return this.client.onUpdate(
      api.bus.head,
      this.auth,
      (head) => {
        const previous = last;
        last = head.seq;
        if (head.seq > 0 && head.seq !== previous) onChange();
      },
      onError,
    );
  }
  wait(
    timeoutMs = 25000,
    limit = 50,
    signal?: AbortSignal,
  ): Promise<Inbox & { timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      let settled = false;
      const finish = (value?: Inbox, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        unsubscribe?.();
        if (error) reject(error);
        else
          resolve({
            ...(value ?? { deliveries: [], nextSeq: 0, hasMore: false }),
            timedOut: !value,
          });
      };
      const abort = () => finish(undefined, new Error("Inbox wait canceled"));
      const timer = setTimeout(() => finish(), timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        unsubscribe = this.client.onUpdate(
          api.bus.inbox,
          { ...this.auth, limit },
          (inbox) => {
            if (inbox.deliveries.length) finish(inbox);
          },
          (error) => finish(undefined, error),
        );
        if (settled) unsubscribe();
      } catch (error) {
        finish(
          undefined,
          error instanceof Error
            ? error
            : new Error("Inbox subscription failed"),
        );
      }
    });
  }
  close() {
    return this.client.close();
  }
  publicError(error: unknown): string {
    const data =
      error && typeof error === "object" && "data" in error
        ? error.data
        : undefined;
    if (data && typeof data === "object" && "code" in data && "message" in data)
      return `${String(data.code)}: ${String(data.message)}`;
    const message =
      error instanceof Error ? error.message : "AgentBus operation failed";
    return message.replaceAll(this.auth.secret, "[redacted]").slice(0, 2000);
  }
}

export async function deadline<T>(
  operation: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

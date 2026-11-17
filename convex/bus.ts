import { v, ConvexError } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { agentState, taskState } from "./schema.js";

const authArgs = { secret: v.string(), agent: v.string() };
const writeArgs = { ...authArgs, requestId: v.string() };
type Ctx = MutationCtx | QueryCtx;
type WriteArgs = { secret: string; agent: string; requestId: string };

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}
function text(value: string, field: string, max: number) {
  if (!value.trim() || new TextEncoder().encode(value).length > max)
    fail("VALIDATION_FAILED", `${field} must contain 1–${max} UTF-8 bytes`);
  return value;
}
function name(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value))
    fail(
      "VALIDATION_FAILED",
      "Agent names must be 1–64 letters, digits, dots, underscores, or hyphens",
    );
  return value;
}
function authorize(secret: string, agent: string) {
  const expected = process.env.AGENTBUS_SECRET;
  if (!expected || expected.length < 32)
    fail(
      "NOT_CONFIGURED",
      "Set AGENTBUS_SECRET on the Convex deployment (at least 32 characters)",
    );
  let difference = secret.length ^ expected.length;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ (secret.charCodeAt(i) || 0);
  if (difference !== 0) fail("UNAUTHORIZED", "Invalid AgentBus secret");
  name(agent);
}
async function getAgent(ctx: Ctx, agent: string) {
  return ctx.db
    .query("agents")
    .withIndex("by_name", (q) => q.eq("name", agent))
    .unique();
}
async function ensureAgent(ctx: MutationCtx, agent: string) {
  name(agent);
  const existing = await getAgent(ctx, agent);
  if (existing) return existing;
  const id = await ctx.db.insert("agents", {
    name: agent,
    capabilities: [],
    state: "offline",
    lastSeenAt: 0,
    inboxSeq: 0,
  });
  return (await ctx.db.get(id))!;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
async function once<T>(
  ctx: MutationCtx,
  operation: string,
  args: WriteArgs,
  run: () => Promise<T>,
): Promise<T> {
  authorize(args.secret, args.agent);
  text(args.requestId, "requestId", 128);
  const { secret: _secret, ...payload } = args;
  const input = canonical(payload);
  const previous = await ctx.db
    .query("operations")
    .withIndex("by_key", (q) =>
      q
        .eq("actor", args.agent)
        .eq("operation", operation)
        .eq("requestId", args.requestId),
    )
    .unique();
  if (previous) {
    if (previous.input !== input)
      fail(
        "IDEMPOTENCY_MISMATCH",
        "This requestId was already used with different input",
      );
    return previous.result as T;
  }
  const result = await run();
  await ctx.db.insert("operations", {
    actor: args.agent,
    operation,
    requestId: args.requestId,
    input,
    result,
  });
  return result;
}
async function append(
  ctx: MutationCtx,
  args: {
    sender: string;
    recipients: string[];
    text: string;
    contextId: string;
    taskId?: Id<"tasks">;
    replyTo?: Id<"messages">;
    kind: "message" | "task";
  },
) {
  text(args.text, "text", 32768);
  text(args.contextId, "contextId", 128);
  const recipients = [...new Set(args.recipients)];
  if (recipients.length > 50)
    fail("RECIPIENT_LIMIT", "At most 50 recipients per message");
  const messageId = await ctx.db.insert("messages", { ...args, recipients });
  const deliveries = [];
  for (const recipient of recipients) {
    const agent = await ensureAgent(ctx, recipient);
    const seq = agent.inboxSeq + 1;
    await ctx.db.patch(agent._id, { inboxSeq: seq });
    const deliveryId = await ctx.db.insert("deliveries", {
      recipient,
      messageId,
      seq,
      acknowledged: false,
    });
    deliveries.push({ deliveryId, recipient, seq });
  }
  return { messageId, status: "stored" as const, deliveries };
}
function pageSize(limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail("VALIDATION_FAILED", "limit must be an integer between 1 and 100");
  return limit;
}

export const register = mutation({
  args: { ...authArgs, capabilities: v.array(v.string()) },
  handler: async (ctx, args) => {
    authorize(args.secret, args.agent);
    if (args.capabilities.length > 20)
      fail("VALIDATION_FAILED", "At most 20 capabilities");
    args.capabilities.forEach((capability) =>
      text(capability, "capability", 128),
    );
    const agent = await ensureAgent(ctx, args.agent);
    await ctx.db.patch(agent._id, {
      capabilities: args.capabilities,
      state: "idle",
      lastSeenAt: Date.now(),
    });
    return { name: args.agent, inboxSeq: agent.inboxSeq };
  },
});
export const heartbeat = mutation({
  args: { ...authArgs, state: v.optional(agentState) },
  handler: async (ctx, args) => {
    authorize(args.secret, args.agent);
    const agent = await ensureAgent(ctx, args.agent);
    await ctx.db.patch(agent._id, {
      lastSeenAt: Date.now(),
      ...(args.state
        ? { state: args.state }
        : agent.lastSeenAt === 0
          ? { state: "idle" as const }
          : {}),
    });
    return { ok: true };
  },
});
export const agents = query({
  args: {
    ...authArgs,
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    authorize(args.secret, args.agent);
    const result = await ctx.db
      .query("agents")
      .withIndex("by_name")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: pageSize(args.limit),
      });
    return {
      agents: result.page,
      nextCursor: result.isDone ? null : result.continueCursor,
    };
  },
});
export const send = mutation({
  args: {
    ...writeArgs,
    to: v.array(v.string()),
    text: v.string(),
    contextId: v.string(),
    taskId: v.optional(v.id("tasks")),
    replyTo: v.optional(v.id("messages")),
  },
  handler: (ctx, args) =>
    once(ctx, "send", args, async () => {
      if (!args.to.length)
        fail("VALIDATION_FAILED", "At least one recipient is required");
      if (args.to.length > 50)
        fail("RECIPIENT_LIMIT", "At most 50 recipients per message");
      if (args.taskId) {
        const task = await ctx.db.get(args.taskId);
        if (!task || task.contextId !== args.contextId)
          fail(
            "VALIDATION_FAILED",
            "Task is missing or belongs to another context",
          );
      }
      if (args.replyTo) {
        const message = await ctx.db.get(args.replyTo);
        if (!message || message.contextId !== args.contextId)
          fail(
            "VALIDATION_FAILED",
            "Reply must reference a message in the same context",
          );
      }
      await ensureAgent(ctx, args.agent);
      return append(ctx, {
        sender: args.agent,
        recipients: args.to,
        text: args.text,
        contextId: args.contextId,
        taskId: args.taskId,
        replyTo: args.replyTo,
        kind: "message",
      });
    }),
});
export const head = query({
  args: authArgs,
  handler: async (ctx, args) => {
    authorize(args.secret, args.agent);
    return { seq: (await getAgent(ctx, args.agent))?.inboxSeq ?? 0 };
  },
});
export const inbox = query({
  args: {
    ...authArgs,
    afterSeq: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    authorize(args.secret, args.agent);
    const after = args.afterSeq ?? 0;
    if (!Number.isSafeInteger(after) || after < 0)
      fail("VALIDATION_FAILED", "afterSeq must be a nonnegative safe integer");
    const limit = pageSize(args.limit);
    const rows = await ctx.db
      .query("deliveries")
      .withIndex("by_recipient_pending_seq", (q) =>
        q
          .eq("recipient", args.agent)
          .eq("acknowledged", false)
          .gt("seq", after),
      )
      .take(limit + 1);
    const deliveries = await Promise.all(
      rows.slice(0, limit).map(async (row) => ({
        ...row,
        message: (await ctx.db.get(row.messageId))!,
      })),
    );
    return {
      deliveries,
      nextSeq: deliveries.at(-1)?.seq ?? after,
      hasMore: rows.length > limit,
    };
  },
});
export const acknowledge = mutation({
  args: { ...authArgs, deliveryIds: v.array(v.id("deliveries")) },
  handler: async (ctx, args) => {
    authorize(args.secret, args.agent);
    if (!args.deliveryIds.length || args.deliveryIds.length > 100)
      fail("VALIDATION_FAILED", "Acknowledge 1–100 delivery IDs");
    for (const id of new Set(args.deliveryIds)) {
      const delivery = await ctx.db.get(id);
      if (!delivery || delivery.recipient !== args.agent)
        fail("FORBIDDEN", "Delivery does not belong to this agent");
      if (!delivery.acknowledged)
        await ctx.db.patch(id, {
          acknowledged: true,
          acknowledgedAt: Date.now(),
        });
    }
    return { ok: true };
  },
});
export const history = query({
  args: {
    ...authArgs,
    contextId: v.string(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    authorize(args.secret, args.agent);
    const result = await ctx.db
      .query("messages")
      .withIndex("by_context", (q) => q.eq("contextId", args.contextId))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: pageSize(args.limit),
      });
    return {
      messages: result.page,
      nextCursor: result.isDone ? null : result.continueCursor,
    };
  },
});
export const createTask = mutation({
  args: {
    ...writeArgs,
    contextId: v.string(),
    parentTaskId: v.optional(v.id("tasks")),
    title: v.string(),
    description: v.string(),
    assignee: v.string(),
  },
  handler: (ctx, args) =>
    once(ctx, "createTask", args, async () => {
      text(args.title, "title", 256);
      text(args.description, "description", 16000);
      text(args.contextId, "contextId", 128);
      if (args.parentTaskId) {
        const parent = await ctx.db.get(args.parentTaskId);
        if (!parent || parent.contextId !== args.contextId)
          fail(
            "VALIDATION_FAILED",
            "Parent task must exist in the same context",
          );
      }
      await ensureAgent(ctx, args.agent);
      await ensureAgent(ctx, args.assignee);
      const taskId = await ctx.db.insert("tasks", {
        contextId: args.contextId,
        parentTaskId: args.parentTaskId,
        title: args.title,
        description: args.description,
        creator: args.agent,
        assignee: args.assignee,
        state: "open",
        revision: 0,
        updatedAt: Date.now(),
      });
      await append(ctx, {
        sender: args.agent,
        recipients: args.assignee === args.agent ? [] : [args.assignee],
        contextId: args.contextId,
        taskId,
        text: `Task assigned: ${args.title}\n${args.description}`,
        kind: "task",
      });
      return (await ctx.db.get(taskId))!;
    }),
});
export const getTask = query({
  args: { ...authArgs, taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    authorize(args.secret, args.agent);
    const task = await ctx.db.get(args.taskId);
    if (!task) fail("NOT_FOUND", "Task not found");
    return task;
  },
});
export const tasks = query({
  args: {
    ...authArgs,
    contextId: v.optional(v.string()),
    assignee: v.optional(v.string()),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    authorize(args.secret, args.agent);
    const base = args.contextId
      ? ctx.db
          .query("tasks")
          .withIndex("by_context", (q) => q.eq("contextId", args.contextId!))
      : args.assignee
        ? ctx.db
            .query("tasks")
            .withIndex("by_assignee", (q) => q.eq("assignee", args.assignee!))
        : ctx.db.query("tasks");
    const filtered =
      args.contextId && args.assignee
        ? base.filter((q) => q.eq(q.field("assignee"), args.assignee!))
        : base;
    const result = await filtered.paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize(args.limit),
    });
    return {
      tasks: result.page,
      nextCursor: result.isDone ? null : result.continueCursor,
    };
  },
});
export const updateTask = mutation({
  args: {
    ...writeArgs,
    taskId: v.id("tasks"),
    expectedRevision: v.number(),
    state: taskState,
    summary: v.optional(v.string()),
  },
  handler: (ctx, args) =>
    once(ctx, "updateTask", args, async () => {
      const task = await ctx.db.get(args.taskId);
      if (!task) fail("NOT_FOUND", "Task not found");
      if (task.creator !== args.agent && task.assignee !== args.agent)
        fail("FORBIDDEN", "Only the creator or assignee can update this task");
      if (
        !Number.isSafeInteger(args.expectedRevision) ||
        task.revision !== args.expectedRevision
      )
        fail(
          "REVISION_CONFLICT",
          "Read the task and review its current revision before updating",
        );
      if (task.state === "done" || task.state === "canceled")
        fail(
          "INVALID_TRANSITION",
          "Terminal tasks cannot be updated; create a follow-up task",
        );
      if (args.summary !== undefined) text(args.summary, "summary", 16000);
      await ctx.db.patch(task._id, {
        state: args.state,
        revision: task.revision + 1,
        updatedAt: Date.now(),
        ...(args.summary !== undefined ? { summary: args.summary } : {}),
      });
      await append(ctx, {
        sender: args.agent,
        recipients: [...new Set([task.creator, task.assignee])].filter(
          (n) => n !== args.agent,
        ),
        contextId: task.contextId,
        taskId: task._id,
        text: `Task ${task.title}: ${args.state}${args.summary ? `\n${args.summary}` : ""}`,
        kind: "task",
      });
      return (await ctx.db.get(task._id))!;
    }),
});

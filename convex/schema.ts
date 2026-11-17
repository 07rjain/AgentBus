import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const agentState = v.union(
  v.literal("idle"),
  v.literal("working"),
  v.literal("blocked"),
  v.literal("offline"),
);
export const taskState = v.union(
  v.literal("open"),
  v.literal("working"),
  v.literal("blocked"),
  v.literal("review"),
  v.literal("done"),
  v.literal("canceled"),
);
export const messageKind = v.union(v.literal("message"), v.literal("task"));

export default defineSchema({
  agents: defineTable({
    name: v.string(),
    capabilities: v.array(v.string()),
    state: agentState,
    lastSeenAt: v.number(),
    inboxSeq: v.number(),
  }).index("by_name", ["name"]),
  messages: defineTable({
    sender: v.string(),
    recipients: v.array(v.string()),
    text: v.string(),
    contextId: v.string(),
    taskId: v.optional(v.id("tasks")),
    replyTo: v.optional(v.id("messages")),
    kind: messageKind,
  }).index("by_context", ["contextId"]),
  deliveries: defineTable({
    recipient: v.string(),
    messageId: v.id("messages"),
    seq: v.number(),
    acknowledged: v.boolean(),
    acknowledgedAt: v.optional(v.number()),
  })
    .index("by_recipient_seq", ["recipient", "seq"])
    .index("by_recipient_pending_seq", ["recipient", "acknowledged", "seq"]),
  tasks: defineTable({
    contextId: v.string(),
    parentTaskId: v.optional(v.id("tasks")),
    title: v.string(),
    description: v.string(),
    creator: v.string(),
    assignee: v.string(),
    state: taskState,
    revision: v.number(),
    updatedAt: v.number(),
    summary: v.optional(v.string()),
  })
    .index("by_context", ["contextId"])
    .index("by_assignee", ["assignee"]),
  operations: defineTable({
    actor: v.string(),
    operation: v.string(),
    requestId: v.string(),
    input: v.string(),
    result: v.any(),
  }).index("by_key", ["actor", "operation", "requestId"]),
});

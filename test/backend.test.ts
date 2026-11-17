import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema.js";
import { api } from "../convex/_generated/api.js";

const modules = import.meta.glob("../convex/**/*.*s");
const secret = "test-only-".repeat(8);
const auth = (agent: string) => ({ secret, agent });
const send = (requestId: string, extra = {}) => ({
  ...auth("alpha"),
  requestId,
  to: ["beta"],
  text: "Hello",
  contextId: "test-context",
  ...extra,
});

beforeEach(() => {
  vi.stubEnv("AGENTBUS_SECRET", secret);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("personal Convex backend", () => {
  test("fails closed when missing a backend secret and rejects wrong secrets", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("AGENTBUS_SECRET", "");
    await expect(t.query(api.bus.head, auth("alpha"))).rejects.toThrow(
      "NOT_CONFIGURED",
    );
    vi.stubEnv("AGENTBUS_SECRET", secret);
    await expect(
      t.query(api.bus.agents, { agent: "alpha", secret: "wrong" }),
    ).rejects.toThrow("UNAUTHORIZED");
    await expect(
      t.mutation(api.bus.send, { ...send("1"), secret: "wrong" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  test("queues offline messages and preserves them after registration and repeated reads", async () => {
    const t = convexTest(schema, modules);
    const stored = await t.mutation(
      api.bus.send,
      send("offline", { to: ["beta", "beta"] }),
    );
    expect(stored.deliveries).toHaveLength(1);
    expect(await t.query(api.bus.head, auth("beta"))).toEqual({ seq: 1 });
    await t.mutation(api.bus.register, {
      ...auth("beta"),
      capabilities: ["research"],
    });
    const first = await t.query(api.bus.inbox, auth("beta"));
    expect(first.deliveries[0].message.sender).toBe("alpha");
    expect(first.deliveries[0].message.recipients).toEqual(["beta"]);
    expect(await t.query(api.bus.inbox, auth("beta"))).toEqual(first);
    expect(
      (await t.query(api.bus.agents, auth("alpha"))).agents.find(
        (a) => a.name === "beta",
      )?.capabilities,
    ).toEqual(["research"]);
  });

  test("deduplicates retries without losing messages and rejects changed payloads", async () => {
    const t = convexTest(schema, modules);
    const one = await t.mutation(api.bus.send, send("retry"));
    expect(await t.mutation(api.bus.send, send("retry"))).toEqual(one);
    await expect(
      t.mutation(api.bus.send, send("retry", { text: "Different" })),
    ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    expect(
      (await t.query(api.bus.inbox, auth("beta"))).deliveries,
    ).toHaveLength(1);
    const operations = await t.run((ctx) =>
      ctx.db.query("operations").collect(),
    );
    expect(JSON.stringify(operations)).not.toContain(secret);
  });

  test("concurrent sends allocate distinct ordered recipient sequences", async () => {
    const t = convexTest(schema, modules);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        t.mutation(api.bus.send, send(`parallel-${i}`)),
      ),
    );
    const inbox = await t.query(api.bus.inbox, auth("beta"));
    expect(inbox.deliveries.map((d) => d.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(new Set(inbox.deliveries.map((d) => d.messageId)).size).toBe(8);
  });

  test("acknowledgment checks recipient ownership and rolls back a mixed batch", async () => {
    const t = convexTest(schema, modules);
    const beta = await t.mutation(api.bus.send, send("beta"));
    const gamma = await t.mutation(
      api.bus.send,
      send("gamma", { to: ["gamma"] }),
    );
    await expect(
      t.mutation(api.bus.acknowledge, {
        ...auth("beta"),
        deliveryIds: [
          beta.deliveries[0].deliveryId,
          gamma.deliveries[0].deliveryId,
        ],
      }),
    ).rejects.toThrow("FORBIDDEN");
    expect(
      (await t.query(api.bus.inbox, auth("beta"))).deliveries,
    ).toHaveLength(1);
    await t.mutation(api.bus.acknowledge, {
      ...auth("beta"),
      deliveryIds: [beta.deliveries[0].deliveryId],
    });
    await t.mutation(api.bus.acknowledge, {
      ...auth("beta"),
      deliveryIds: [beta.deliveries[0].deliveryId],
    });
    expect(
      (await t.query(api.bus.inbox, auth("beta"))).deliveries,
    ).toHaveLength(0);
    expect(
      (
        await t.query(api.bus.history, {
          ...auth("alpha"),
          contextId: "test-context",
        })
      ).messages,
    ).toHaveLength(2);
  });

  test("pending pagination does not hide unacknowledged entries behind an ACK cursor", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 5; i++)
      await t.mutation(api.bus.send, send(`page-${i}`));
    const first = await t.query(api.bus.inbox, { ...auth("beta"), limit: 2 });
    expect(first.hasMore).toBe(true);
    const second = await t.query(api.bus.inbox, {
      ...auth("beta"),
      afterSeq: first.nextSeq,
      limit: 2,
    });
    expect(second.deliveries.map((d) => d.seq)).toEqual([3, 4]);
    await t.mutation(api.bus.acknowledge, {
      ...auth("beta"),
      deliveryIds: second.deliveries.map((d) => d._id),
    });
    expect(
      (await t.query(api.bus.inbox, auth("beta"))).deliveries.map((d) => d.seq),
    ).toEqual([1, 2, 5]);
  });

  test("validates bounds and prevents cross-context reply references", async () => {
    const t = convexTest(schema, modules);
    const message = await t.mutation(api.bus.send, send("source"));
    await expect(
      t.mutation(
        api.bus.send,
        send("badreply", {
          replyTo: message.messageId,
          contextId: "different",
        }),
      ),
    ).rejects.toThrow("same context");
    await expect(
      t.mutation(api.bus.send, send("empty", { to: [] })),
    ).rejects.toThrow("VALIDATION_FAILED");
    await expect(
      t.mutation(api.bus.send, send("oversize", { text: "界".repeat(11000) })),
    ).rejects.toThrow("VALIDATION_FAILED");
    await expect(
      t.mutation(api.bus.send, send("badname", { to: ["../beta"] })),
    ).rejects.toThrow("VALIDATION_FAILED");
    await expect(
      t.query(api.bus.inbox, { ...auth("beta"), limit: 101 }),
    ).rejects.toThrow("VALIDATION_FAILED");
    expect(
      (
        await t.query(api.bus.history, {
          ...auth("alpha"),
          contextId: "test-context",
        })
      ).messages,
    ).toHaveLength(1);
  });

  test("task creation and updates atomically notify the proper agent and reject stale revisions", async () => {
    const t = convexTest(schema, modules);
    const args = {
      ...auth("manager"),
      requestId: "task",
      title: "Build",
      description: "Implement and verify",
      assignee: "beta",
      contextId: "project",
    };
    const task = await t.mutation(api.bus.createTask, args);
    expect(await t.mutation(api.bus.createTask, args)).toEqual(task);
    expect(
      (await t.query(api.bus.inbox, auth("beta"))).deliveries[0].message.taskId,
    ).toBe(task._id);
    const working = await t.mutation(api.bus.updateTask, {
      ...auth("beta"),
      requestId: "working",
      taskId: task._id,
      expectedRevision: 0,
      state: "working",
    });
    expect(working.revision).toBe(1);
    await expect(
      t.mutation(api.bus.updateTask, {
        ...auth("beta"),
        requestId: "stale",
        taskId: task._id,
        expectedRevision: 0,
        state: "done",
      }),
    ).rejects.toThrow("REVISION_CONFLICT");
    await expect(
      t.mutation(api.bus.updateTask, {
        ...auth("gamma"),
        requestId: "forged",
        taskId: task._id,
        expectedRevision: 1,
        state: "done",
      }),
    ).rejects.toThrow("FORBIDDEN");
    expect(
      (await t.query(api.bus.inbox, auth("manager"))).deliveries,
    ).toHaveLength(1);
    const doneArgs = {
      ...auth("beta"),
      requestId: "done",
      taskId: task._id,
      expectedRevision: 1,
      state: "done" as const,
      summary: "Actual check evidence",
    };
    const done = await t.mutation(api.bus.updateTask, doneArgs);
    expect(await t.mutation(api.bus.updateTask, doneArgs)).toEqual(done);
    await expect(
      t.mutation(api.bus.updateTask, {
        ...doneArgs,
        requestId: "reopen",
        expectedRevision: 2,
        state: "working",
      }),
    ).rejects.toThrow("INVALID_TRANSITION");
  });

  test("subtasks must share parent context and task messages must match context", async () => {
    const t = convexTest(schema, modules);
    const parent = await t.mutation(api.bus.createTask, {
      ...auth("alpha"),
      requestId: "parent",
      title: "Parent",
      description: "Brief",
      assignee: "alpha",
      contextId: "project",
    });
    const childArgs = {
      ...auth("alpha"),
      requestId: "child",
      title: "Child",
      description: "Brief",
      assignee: "beta",
      contextId: "project",
      parentTaskId: parent._id,
    };
    const child = await t.mutation(api.bus.createTask, childArgs);
    expect(child.parentTaskId).toBe(parent._id);
    await expect(
      t.mutation(api.bus.createTask, {
        ...childArgs,
        requestId: "bad-child",
        contextId: "different",
      }),
    ).rejects.toThrow("same context");
    await expect(
      t.mutation(api.bus.send, send("bad-task", { taskId: child._id })),
    ).rejects.toThrow("another context");
    expect(
      (
        await t.query(api.bus.tasks, {
          ...auth("alpha"),
          contextId: "project",
          assignee: "beta",
        })
      ).tasks,
    ).toHaveLength(1);
  });
});

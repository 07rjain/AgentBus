import { afterEach, expect, test, vi } from "vitest";

const subscriptions = vi.hoisted(() => ({
  active: 0,
  callback: undefined as undefined | ((value: unknown) => void),
  error: undefined as undefined | ((error: Error) => void),
}));
vi.mock("convex/browser", () => ({
  ConvexClient: class {
    onUpdate(
      _ref: unknown,
      _args: unknown,
      callback: (value: unknown) => void,
      error: (error: Error) => void,
    ) {
      subscriptions.active++;
      subscriptions.callback = callback;
      subscriptions.error = error;
      let closed = false;
      return () => {
        if (!closed) {
          subscriptions.active--;
          closed = true;
        }
      };
    }
    close() {
      return Promise.resolve();
    }
  },
}));
import { BusClient, readConfig } from "../src/client.js";

const config = {
  url: "https://example.convex.cloud",
  secret: "x".repeat(64),
  agent: "beta",
};
const makeClient = () => new BusClient(config);
afterEach(() => {
  vi.useRealTimers();
  expect(subscriptions.active).toBe(0);
  subscriptions.callback = undefined;
  subscriptions.error = undefined;
});

test("wait stays pending through empty updates and releases its subscription after delivery", async () => {
  const bus = makeClient();
  const pending = bus.wait();
  subscriptions.callback?.({ deliveries: [], nextSeq: 0, hasMore: false });
  expect(subscriptions.active).toBe(1);
  subscriptions.callback?.({
    deliveries: [{ _id: "delivery-1" }],
    nextSeq: 1,
    hasMore: false,
  });
  expect((await pending).timedOut).toBe(false);
  await bus.close();
});

test("wait timeout returns an honest empty result and releases its subscription", async () => {
  vi.useFakeTimers();
  const bus = makeClient();
  const pending = bus.wait(100);
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toEqual({
    deliveries: [],
    nextSeq: 0,
    hasMore: false,
    timedOut: true,
  });
  await bus.close();
});

test("canceled waits reject without keeping a listener alive", async () => {
  const bus = makeClient();
  const controller = new AbortController();
  const pending = bus.wait(25000, 50, controller.signal);
  const rejection = expect(pending).rejects.toThrow("canceled");
  controller.abort();
  await rejection;
  await bus.close();
});

test("subscription errors reject the wait rather than masquerading as an empty inbox", async () => {
  const bus = makeClient();
  const pending = bus.wait();
  const rejection = expect(pending).rejects.toThrow("connection failed");
  subscriptions.error?.(new Error("connection failed"));
  await rejection;
  expect(
    bus.publicError(new Error(`SDK arguments ${config.secret}`)),
  ).not.toContain(config.secret);
  await bus.close();
});

test("configuration rejects insecure remote URLs, missing secrets, and invalid names", () => {
  const env = {
    CONVEX_URL: config.url,
    AGENTBUS_SECRET: config.secret,
    AGENTBUS_AGENT: config.agent,
  };
  expect(readConfig(env)).toEqual(config);
  expect(() =>
    readConfig({ ...env, CONVEX_URL: "http://example.com" }),
  ).toThrow("HTTPS");
  expect(() =>
    readConfig({ ...env, CONVEX_URL: "https://secret@example.com" }),
  ).toThrow("origin");
  expect(() => readConfig({ ...env, AGENTBUS_SECRET: "short" })).toThrow("32");
  expect(() => readConfig({ ...env, AGENTBUS_AGENT: "../beta" })).toThrow(
    "agent name",
  );
  expect(() => readConfig({})).toThrow("Set CONVEX_URL");
});

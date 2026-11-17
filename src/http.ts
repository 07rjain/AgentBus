import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BusClient, deadline, readConfig } from "./client.js";
import { createMcpServer } from "./server.js";

type HttpRequest = IncomingMessage & { body?: unknown };
type Options = {
  env?: NodeJS.ProcessEnv;
  createBus?: (config: ReturnType<typeof readConfig>) => BusClient;
  timeoutMs?: number;
};

function error(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message },
    }),
  );
}

// A fresh server/transport per request: no cross-instance in-memory sessions.
export function createHttpHandler(options: Options = {}) {
  return async (req: HttpRequest, res: ServerResponse) => {
    const env = options.env ?? process.env;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const secret = env.AGENTBUS_SECRET;
    if (!secret || secret.length < 32 || !env.CONVEX_URL)
      return error(res, 503, "AgentBus deployment is not configured");
    const authorization = req.headers.authorization ?? "";
    const expected = `Bearer ${secret}`;
    if (
      Buffer.byteLength(authorization) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
    ) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="AgentBus"');
      return error(res, 401, "AgentBus bearer token required");
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (
          parsed.origin !== origin ||
          parsed.host !== req.headers.host ||
          !["http:", "https:"].includes(parsed.protocol)
        )
          return error(res, 403, "Origin not allowed");
      } catch {
        return error(res, 403, "Origin not allowed");
      }
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return error(
        res,
        405,
        "Use POST for stateless MCP requests; inbox_wait provides bounded live waiting",
      );
    }
    let config: ReturnType<typeof readConfig>;
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const names = url.searchParams.getAll("agent");
      if (names.length !== 1)
        return error(
          res,
          400,
          "Supply one agent name in the URL: ?agent=dev-1",
        );
      config = readConfig({ ...env, AGENTBUS_AGENT: names[0] });
      if (env.VERCEL && new URL(config.url).protocol !== "https:")
        return error(
          res,
          503,
          "Vercel requires a hosted HTTPS Convex deployment",
        );
    } catch {
      return error(res, 400, "Invalid agent name or deployment configuration");
    }
    // Vercel may preparse request bodies. Enforce a bound even on that path.
    if (req.body !== undefined) {
      try {
        if (Buffer.byteLength(JSON.stringify(req.body)) > 128 * 1024)
          return error(res, 413, "Request too large");
      } catch {
        return error(res, 400, "Invalid JSON body");
      }
    }
    const bus = (options.createBus ?? ((config) => new BusClient(config)))(
      config,
    );
    const app = createMcpServer(bus, { subscriptions: false });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 128 * 1024,
    });
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      await app.stop();
      await bus.close();
      await app.server.close();
    };
    const disconnected = () => {
      if (!res.writableFinished) void dispose();
    };
    res.once("close", disconnected);
    try {
      await deadline(bus.heartbeat(), 10000, "Convex connection timed out");
      await app.server.connect(transport);
      await deadline(
        transport.handleRequest(req, res, req.body),
        options.timeoutMs ?? 45000,
        "MCP request timed out",
      );
    } catch {
      if (!res.headersSent)
        error(
          res,
          502,
          "AgentBus request failed; check Convex connectivity and configuration",
        );
      else if (!res.writableEnded) res.end();
    } finally {
      res.removeListener("close", disconnected);
      await dispose();
    }
  };
}

export const handleMcpRequest = createHttpHandler();

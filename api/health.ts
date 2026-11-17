import type { IncomingMessage, ServerResponse } from "node:http";

export default function health(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  const configured = Boolean(
    process.env.CONVEX_URL &&
    process.env.AGENTBUS_SECRET &&
    process.env.AGENTBUS_SECRET.length >= 32,
  );
  res.statusCode = configured ? 200 : 503;
  res.end(
    req.method === "HEAD"
      ? undefined
      : JSON.stringify({
          service: "agentbus",
          configured,
          transport: "streamable-http",
          backend: "convex",
          backendConnectivity: "not-probed",
        }),
  );
}

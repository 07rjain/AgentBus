#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BusClient, deadline, readConfig } from "./client.js";
import { createMcpServer } from "./server.js";

async function main() {
  const config = readConfig();
  const bus = new BusClient(config);
  let app: ReturnType<typeof createMcpServer> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    await app?.stop();
    await bus.close();
    await app?.server.close();
  };
  try {
    await deadline(
      bus.register(),
      15000,
      "Cannot connect to AgentBus; check CONVEX_URL and the backend secret",
    );
    app = createMcpServer(bus);
    app.server.onclose = () => {
      void shutdown();
    };
    await app.server.connect(new StdioServerTransport());
    heartbeat = setInterval(() => {
      if (!closing) void bus.heartbeat().catch(() => {});
    }, 30000);
    heartbeat.unref();
    process.once("SIGINT", () => {
      void shutdown();
    });
    process.once("SIGTERM", () => {
      void shutdown();
    });
    process.stdin.once("end", () => {
      void shutdown();
    });
    process.stderr.write(`AgentBus MCP ready as ${config.agent}.\n`);
  } catch {
    await shutdown();
    // Do not expose SDK error text that might contain secret query arguments.
    throw new Error(
      "AgentBus startup failed. Check the deployment, AGENTBUS_SECRET, and agent configuration.",
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

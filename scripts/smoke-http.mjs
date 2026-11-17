import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { handleMcpRequest } from "../dist/src/http.js";

const server = createServer(handleMcpRequest);
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const url = `http://127.0.0.1:${server.address().port}/api/mcp`;
  const child = spawn(
    process.execPath,
    [new URL("./demo.mjs", import.meta.url).pathname],
    { env: { ...process.env, AGENTBUS_MCP_URL: url }, stdio: "inherit" },
  );
  const [code] = await once(child, "exit");
  if (code !== 0) process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

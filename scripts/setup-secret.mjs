import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

let directory;
try {
  const path = new URL("../.env.local", import.meta.url);
  const original = await readFile(path, "utf8");
  const env = parseEnv(original);
  if (!env.CONVEX_URL || !env.CONVEX_DEPLOYMENT)
    throw new Error("Run npx convex dev first to configure a deployment.");
  const secret = env.AGENTBUS_SECRET || randomBytes(32).toString("hex");
  if (secret.length < 32 || /[\r\n]/.test(secret))
    throw new Error(
      "AGENTBUS_SECRET must contain at least 32 characters on one line.",
    );
  directory = await mkdtemp(join(tmpdir(), "agentbus-setup-"));
  const file = join(directory, "secret.env");
  await writeFile(file, `AGENTBUS_SECRET=${JSON.stringify(secret)}\n`, {
    mode: 0o600,
  });
  const cli = new URL("../node_modules/convex/bin/main.js", import.meta.url);
  const result = spawnSync(
    process.execPath,
    [cli.pathname, "env", "set", "--from-file", file],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      "Could not configure the backend secret. Check that Convex is running and that no different AGENTBUS_SECRET is already configured. Existing backend values were not overwritten.",
    );
  let updated = original;
  if (!env.AGENTBUS_SECRET)
    updated += `\nAGENTBUS_SECRET=${JSON.stringify(secret)}\n`;
  if (!env.AGENTBUS_AGENT) updated += "AGENTBUS_AGENT=manager\n";
  await writeFile(path, updated, { mode: 0o600 });
  await chmod(path, 0o600);
  console.log(
    "Shared secret configured in Convex and private .env.local. No secret was printed.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}

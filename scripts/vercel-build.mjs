import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// CONVEX_API_KEY is accepted as a user-friendly alias for a Convex *deploy* key.
// A management API access token is not interchangeable with a deployment key.
const deployKey = process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_API_KEY;
function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (result.error || result.status !== 0)
    throw new Error("Deployment command failed; see the command output above.");
}
if (
  process.env.VERCEL &&
  (!process.env.CONVEX_URL ||
    !process.env.AGENTBUS_SECRET ||
    process.env.AGENTBUS_SECRET.length < 32)
) {
  console.error(
    "Set CONVEX_URL and AGENTBUS_SECRET (at least 32 characters) in Vercel. CONVEX_API_KEY/CONVEX_DEPLOY_KEY is a deployment credential, not the MCP bearer token.",
  );
  process.exit(1);
}
try {
  if (deployKey) {
    // Deploy backend changes during production builds only. Preview builds should
    // not mutate the production database schema or overwrite its shared secret.
    if (process.env.VERCEL_ENV !== "production") {
      console.log("Preview build: skipping production Convex deployment.");
    } else {
      const directory = mkdtempSync(join(tmpdir(), "agentbus-convex-env-"));
      try {
        const path = join(directory, "backend.env");
        writeFileSync(
          path,
          `AGENTBUS_SECRET=${JSON.stringify(process.env.AGENTBUS_SECRET)}\n`,
          { mode: 0o600 },
        );
        run(
          [
            "node_modules/convex/bin/main.js",
            "env",
            "set",
            "--from-file",
            path,
          ],
          { ...process.env, CONVEX_DEPLOY_KEY: deployKey },
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
      run(
        [
          "node_modules/convex/bin/main.js",
          "deploy",
          "--typecheck",
          "enable",
          "--cmd",
          "node scripts/assert-convex-url.mjs",
          "--cmd-url-env-var-name",
          "AGENTBUS_DEPLOYMENT_URL",
        ],
        { ...process.env, CONVEX_DEPLOY_KEY: deployKey },
      );
    }
  }
  const tsc = JSON.parse(
    readFileSync("node_modules/typescript/package.json", "utf8"),
  ).bin.tsc;
  run([`node_modules/typescript/${tsc}`]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

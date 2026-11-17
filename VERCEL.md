# Deploy AgentBus to Vercel + Convex

The hosted server is MCP Streamable HTTP at `/api/mcp?agent=<name>`. Vercel runs a separate stateless handler for each request; Convex stores all messages, recipient deliveries, tasks, and operation deduplication results. The existing stdio transport remains available.

## Production environment variables

Set these in the Vercel project's **Production** environment, then redeploy:

| Variable | Value | Purpose |
| --- | --- | --- |
| `CONVEX_API_KEY` or `CONVEX_DEPLOY_KEY` | A production **deploy key** from your Convex project | Build-time schema/function deployment. A Convex management API token is not a substitute. |
| `CONVEX_URL` | Production deployment URL, such as `https://your-deployment.convex.cloud` | Runtime database/functions endpoint; not the dashboard URL or `.convex.site` URL. |
| `AGENTBUS_SECRET` | A random string of at least 32 characters | Personal MCP bearer token and shared backend secret. Keep this separate from the deploy key. |

Generate a secret using a password manager or `node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'` in your own terminal. Do not commit it or paste it into a public issue. Clients need only the endpoint URL and this shared secret; never distribute the Convex deploy key to MCP clients.

The build script accepts `CONVEX_API_KEY` as an alias because an existing Vercel project may already use that name. Convex's native CLI variable remains `CONVEX_DEPLOY_KEY`.

If a production deploy key is configured, the build sets the backend's `AGENTBUS_SECRET` without overwriting a different existing value, validates that `CONVEX_URL` matches that key's deployment, deploys the schema/functions, and compiles the server. A mismatch stops the build. To intentionally rotate an existing secret, update both Convex and Vercel, then redeploy; existing clients must use the new secret.

If the backend was deployed separately and no deploy key is supplied to Vercel, set the same secret in Convex yourself. Runtime requests never use a deploy/admin key. Preview builds do not deploy to production Convex; preview environment variables and a suitable backend must be configured separately if previews are wanted.

## Vercel configuration

Import `07rjain/AgentBus` with repository root as the project root. The committed `vercel.json` uses the Other framework preset, `npm run vercel:build`, `public/` static output, and Node functions in `api/`. Do not point the project root to `src/`, `dist/`, or the old local AgentBus repository.

With a Git-connected Vercel project, pushing to the production branch triggers a new deployment. Variables added after a deployment require a redeploy to take effect. The production URL must be accessible to the MCP clients; if Vercel Deployment Protection requires a separate login, configure that according to your personal access needs. The MCP bearer check remains required regardless of Vercel protection.

## Connect remote agents

For the live deployment URL, host-specific configuration, and a two-agent connection test, use the [agent setup guide](AGENT_SETUP.md).

Use [the HTTP MCP configuration example](config/mcp.http.example.json), adjusting the URL, agent name, and header:

```json
{
  "mcpServers": {
    "agentbus": {
      "url": "https://your-project.vercel.app/api/mcp?agent=dev-1",
      "headers": {"Authorization": "Bearer <your AgentBus shared secret>"}
    }
  }
}
```

Each agent uses its own name in the URL and the same personal secret. This is shared trust, not per-agent authentication. Agent names are conventions selected by clients. Clients need MCP Streamable HTTP support and the ability to send custom headers.

## What serverless changes

- All eleven tools and inbox resource reads work over HTTP.
- `inbox_wait` subscribes to Convex within one request for up to 25 seconds. Retry the tool while idle if it times out.
- No persistent GET event stream or resource subscriptions are advertised over the stateless HTTP endpoint. GET/DELETE return 405. Use local stdio mode if your host needs continuous resource update notifications.
- There is no in-memory session registry or heartbeat timer between HTTP requests. Each authenticated request records last-seen activity without resetting an existing status. An agent can receive messages while offline because inbox records are durable.
- HTTP is not an agent runtime adapter: it does not automatically inject a message into model inference or wake a stopped AI process.

## Verify after deployment

`GET /api/health` must return HTTP 200 with `configured: true`. This checks environment configuration only, not Convex reachability. An unauthenticated POST to `/api/mcp?agent=test` must return 401.

For actual database and protocol verification, run the existing demo against the hosted endpoint from a local terminal where `.env.local` contains the correct personal `AGENTBUS_SECRET`:

```bash
AGENTBUS_MCP_URL=https://your-project.vercel.app/api/mcp npm run demo
```

This creates labeled demo agents/messages/tasks and verifies stored delivery, replies, reconnect recovery, inbox waiting, subtasks, and revision checks using two independent HTTP MCP clients. It is not an autonomous-AI test. `npm run demo:http` runs the same HTTP path on a temporary local HTTP server against your configured Convex backend.

## Deployment status and recovery

Source files and passing local tests do not establish a live deployment. Verify the actual Vercel build and hosted round trip before treating the service as available.

Read build logs for configuration errors and runtime logs for failed requests. `/api/health` never returns secrets or deployment credentials. MCP errors redact the configured shared secret. Keep `.env*`, `.convex/`, and `.vercel/` private; the upload ignore file excludes local secrets and state.

Vercel can redeploy an earlier application revision, but that does not roll back Convex schema or data. Avoid incompatible schema changes; preserve data and use a separately reviewed migration/restore when needed. A failed backend or application build does not prove that all prior operations rolled back together.

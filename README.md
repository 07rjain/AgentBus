# AgentBus

A small personal MCP server for agents on different machines to exchange messages and share tasks through one Convex backend. No inbound ports or webhook endpoints are needed on agent machines. Use local stdio or the [Vercel HTTP deployment](VERCEL.md).

**Connecting an agent? Start with the [agent setup guide](AGENT_SETUP.md)** for the live endpoint, generic/Codex/Claude Code configuration, authentication, and a two-agent connection check.

Each agent runs its own stdio MCP process with a different `AGENTBUS_AGENT` name. All processes use the same Convex URL and shared secret. Messages remain in a durable recipient inbox until explicitly acknowledged. Convex subscriptions provide live change notifications.

## What works

- Direct messages to one or several named agents, including agents that are offline or have not connected yet.
- Sender, recipients, conversation context, task reference, and reply reference on messages.
- Pending inbox reads, explicit per-message acknowledgment, conversation history, and pagination.
- Live MCP resource updates and a subscription-backed `inbox_wait` tool.
- Agent registration on startup, state, capabilities storage, and heartbeats.
- Basic tasks and subtasks, assignment notifications, status updates, and optimistic revision checks.
- Idempotent message/task retries when callers supply the same request ID and input.

This is the simple single-owner implementation. The [larger design](docs/01-requirements.md) remains a proposal: automated session launch/resume, worker leases, per-agent authentication, and enforced manager approval gates are not implemented. See [implementation scope](IMPLEMENTATION.md).

## Setup

Requires Node.js 22.9+ and npm. On the machine that manages the backend:

```bash
npm ci
npm run build
npx convex dev
```

Choose a **cloud deployment** if agents will run on different machines. Sign in/create a Convex project when prompted. Keep this command running during backend development. If you already configured a local deployment, use `npx convex dev --configure` to choose a cloud project instead. For local-only testing, Convex also supports starting without an account; a loopback deployment is not reachable from your other machines.

In a second terminal, configure the shared secret:

```bash
npm run setup
```

The setup script generates a random secret, sets `AGENTBUS_SECRET` in the selected Convex deployment, and adds it to the private `.env.local` along with the default agent name. It does not print the secret or overwrite a different existing backend value.

Treat this secret as access to your entire personal AgentBus. All agents share trust; anyone holding it can choose any agent name and read conversations. Do not give it to unrelated users. Never put a Convex deployment/admin key in the MCP client configuration.

## Connect an agent

For a hosted endpoint with no local server process, follow [Vercel + Convex setup](VERCEL.md). The instructions below apply to local stdio clients.

Build this repository on every agent machine. Create a private `.env.local` there containing the **same** `CONVEX_URL` and `AGENTBUS_SECRET`, plus a default `AGENTBUS_AGENT`. See [.env.example](.env.example). Client machines need no Convex admin login and should not run their own separate Convex deployment.

Add this to the agent host's MCP configuration, replacing both absolute paths:

```json
{
  "mcpServers": {
    "agentbus": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/AgentBus/.env.local",
        "/absolute/path/to/AgentBus/dist/src/index.js"
      ],
      "env": {"AGENTBUS_AGENT": "dev-1"}
    }
  }
}
```

Use `manager`, `researcher-1`, `researcher-2`, `dev-1`, and `dev-2`, or any distinct names. Give each active agent process a unique name. MCP writes only protocol data to stdout; operational diagnostics go to stderr. The stdio process exits and closes its Convex connection when the host disconnects.

For manual MCP inspection, `npm start` loads `.env.local`. In an MCP host, prefer the direct `node` command above so npm banners do not interfere with stdio.

## Tools

| Tool | Use |
| --- | --- |
| `agent_list` | Discover agents and their last heartbeat/state. |
| `agent_status` | Set your state to idle, working, blocked, or offline. |
| `message_send` | Send `to: ["dev-2"]`, `text`, optional context/task/reply/request IDs. |
| `message_list` | Read a conversation using `contextId`; paginate with `nextCursor`. |
| `inbox_read` | Read unacknowledged deliveries; does not acknowledge them. |
| `inbox_ack` | Acknowledge selected delivery IDs after handling. |
| `inbox_wait` | Wait up to 25 seconds for pending input; returns immediately if there is already pending input. |
| `task_create` | Create a task/subtask and notify its assignee atomically. |
| `task_get` | Read a task and its current revision. |
| `task_list` | Filter by context/assignee and paginate. |
| `task_update` | Update status using `expectedRevision`; optionally include a results summary. |

Example `message_send` arguments:

```json
{
  "to": ["dev-2"],
  "text": "Please verify the validation response format before integration.",
  "contextId": "project-api",
  "requestId": "validation-question-1"
}
```

The result says `stored`, not read. Reuse the returned `contextId` for replies and pass the original message ID as `replyTo`. When omitted, a new context uses the request ID; callers supplying a stable request ID can safely retry. A reply or task-linked message must supply the matching context.

`inbox_read` returns delivery `_id`, recipient `seq`, and the embedded message. Acknowledge delivery IDs, not message IDs. For more than one page, use `nextSeq` as `afterSeq` until `hasMore` is false. Start future recovery reads without `afterSeq` so older unacknowledged messages are not skipped. Nothing is deleted by acknowledging; `message_list` preserves history.

For a subtask, pass `parentTaskId`; it inherits the parent's context unless one is explicitly supplied. Task states are `open`, `working`, `blocked`, `review`, `done`, and `canceled`. Done/canceled tasks are terminal. Creator or assignee can update a task; these are basic shared task states, not the larger design's verified release gates.

## Messages while agents work

The stdio MCP process listens independently of model inference. Hosts supporting MCP resource subscriptions can subscribe to `agentbus://inbox` and receive `notifications/resources/updated`, then read the resource to fetch pending messages. Notifications are hints: actual messages live in Convex, and intermediate notifications can be combined without losing stored messages. The Vercel HTTP mode uses bounded `inbox_wait` calls and does not advertise persistent resource subscriptions.

**An MCP notification does not automatically inject input into an arbitrary AI session.** A host must handle the resource update, or the agent must call `inbox_read` between work steps. `inbox_wait` is useful while idle; it holds that tool call and is not a separate runtime adapter. No automatic interruption, session launch, or wake-up is claimed.

Suggested agent instruction:

> Coordinate only through AgentBus. Read your inbox between work steps. Preserve contextId and replyTo when replying. Acknowledge each delivery after handling it. While waiting for a peer, use inbox_wait; on timeout, decide whether to continue waiting or do other work. Report actual work and evidence. Do not interpret ordinary chat as formal approval.

## Verify

```bash
npm run check
npm run build
npm run demo
```

`check` runs TypeScript, backend tests using `convex-test`, and documentation/example checks. `demo` requires the configured running Convex backend and uses **two real stdio MCP clients**, not autonomous AIs. It exercises offline delivery, retries, reconnect recovery, live resource notifications, inbox waiting/timeout, replies, tasks/subtasks, and revision conflicts. It creates clearly named demo records in that deployment.

## Technical documentation

The implementation intentionally covers a smaller personal MVP than the original specification. [IMPLEMENTATION.md](IMPLEMENTATION.md) records the exact supported guarantees and limitations.

The proposed full system is described in [architecture](docs/02-architecture.md), [message flow](docs/03-message-flow.md), [data model](docs/04-data-model.md), [protocol](docs/05-protocol.md), [runtime adapters](docs/06-worker-runtime.md), [coordinator gates](docs/07-coordinator.md), [security/operations](docs/08-security-operations.md), [implementation plan](docs/09-implementation-plan.md), and [decisions](docs/10-decisions.md). The [interactive walkthrough](diagrams/message-flow.html) and [original protocol examples](examples/) describe that larger design, not the current MVP's exact wire format.

Official Convex references: [functions](https://docs.convex.dev/functions), [reactive queries](https://docs.convex.dev/functions/query-functions), [JavaScript/Node subscriptions](https://docs.convex.dev/client/javascript), [authentication](https://docs.convex.dev/auth), and [limits](https://docs.convex.dev/production/state/limits).

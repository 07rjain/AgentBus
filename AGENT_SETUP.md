# Connect an agent to AgentBus

Use this guide to connect an existing AI agent to the hosted AgentBus MCP server. It applies to agents on this machine or another machine. The server provides messaging and shared tasks; your agent host runs the AI and its tools.

## Connection details

| Setting | Value |
| --- | --- |
| Transport | MCP Streamable HTTP |
| Endpoint | `https://agent-bus-eight.vercel.app/api/mcp?agent=dev-1` |
| Authentication | `Authorization: Bearer <AGENTBUS_SECRET>` |
| Health check | `https://agent-bus-eight.vercel.app/api/health` |
| Recommended local server label | `agentbus_remote` |

Replace `dev-1` with this agent's unique name. Suggested names are `manager`, `researcher-1`, `researcher-2`, `dev-1`, and `dev-2`. Names are case-sensitive, 1–64 characters, start with a letter or digit, and otherwise contain letters, digits, dots, underscores, or hyphens. Give simultaneous agents different names, including agents on different machines.

The local server label and the agent identity are separate. `agentbus_remote` identifies the configured MCP connection; `?agent=dev-1` selects the AgentBus identity. The separate label avoids replacing an existing local MCP server named `agentbus`.

Obtain the **AgentBus shared secret** from the owner through an approved private channel. It is the `AGENTBUS_SECRET` configured in Vercel/Convex. Store it in your host's secret storage, environment, or private MCP configuration. Never print it in a response, commit it, or include it in a tool argument when a header/configuration field is intended.

MCP clients use the hosted Vercel endpoint. They do not need a Vercel access token, `CONVEX_API_KEY`, `CONVEX_DEPLOY_KEY`, a Convex account, or a local database. A remote HTTP-capable host does not need to clone/build this repository or start a local Node server.

## Generic HTTP configuration

For a host using `mcpServers` JSON, merge this connection into its private MCP settings. Preserve existing connections. Replace the secret placeholder locally before connecting; it is not a real token.

```json
{
  "mcpServers": {
    "agentbus_remote": {
      "url": "https://agent-bus-eight.vercel.app/api/mcp?agent=dev-1",
      "headers": {
        "Authorization": "Bearer <AGENTBUS_SECRET>"
      }
    }
  }
}
```

Some hosts also require an explicit HTTP transport field or a different settings layout. Follow that host's schema; the endpoint and Authorization header remain the same. Use environment-variable interpolation only when the host documents its syntax. [Copyable JSON example](config/mcp.http.example.json).

Use the host's reconnect/reload control after saving. If it does not reload MCP settings, restart the agent session. Editing a file does not automatically change an already-running session's tool catalog. The host must support Streamable HTTP with custom headers; no OAuth login flow is provided by this personal server.

## Codex

Make `AGENTBUS_SECRET` available in the environment of the Codex process. For a temporary Bash session, enter it without adding the value to shell history:

```bash
read -rsp 'AgentBus shared secret: ' AGENTBUS_SECRET
printf '\n'
export AGENTBUS_SECRET
```

Register the connection:

```bash
codex mcp add agentbus_remote \
  --url 'https://agent-bus-eight.vercel.app/api/mcp?agent=dev-1' \
  --bearer-token-env-var AGENTBUS_SECRET

codex mcp list
```

Alternatively, add this table to `~/.codex/config.toml`, merging with existing settings:

```toml
[mcp_servers.agentbus_remote]
url = "https://agent-bus-eight.vercel.app/api/mcp?agent=dev-1"
bearer_token_env_var = "AGENTBUS_SECRET"
startup_timeout_sec = 30
tool_timeout_sec = 60
```

Choose CLI registration or direct TOML editing; they configure the same connection. [Copyable TOML example](config/mcp.codex.example.toml). Environment variables set in one terminal are not automatically available to an unrelated desktop process or another machine. Arrange the secret in the environment that actually opens the MCP connection.

For multiple agent identities sharing one configuration, create separately named connections with different `?agent=` values and enable the appropriate connection for each agent. An instruction saying “you are dev-2” does not change a connection whose URL says `agent=dev-1`.

Codex syntax was checked against the [official MCP guide](https://developers.openai.com/codex/mcp/) and the locally installed `codex mcp add --help` on 2026-11-17.

## Claude Code

For project-scoped configuration, merge this entry into `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "agentbus_remote": {
      "type": "http",
      "url": "https://agent-bus-eight.vercel.app/api/mcp?agent=dev-1",
      "headers": {
        "Authorization": "Bearer ${AGENTBUS_SECRET}"
      }
    }
  }
}
```

This example uses Claude Code's environment expansion. Set `AGENTBUS_SECRET` in the environment that launches Claude Code, then reconnect/restart and enable the project MCP server if prompted. Keep the actual secret out of `.mcp.json`. [Copyable JSON example](config/mcp.claude.example.json). See the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for host-specific configuration and approval behavior. This repository does not install Claude Code or modify your host settings for you.

## Verify the connection

1. Confirm the host connected successfully and lists the eleven AgentBus tools. Hosts may prefix their names with the local server label.
2. Call `agent_status` with `{"state":"idle"}` and then `agent_list` with `{}`. Check the name matches the URL. A listed agent or heartbeat alone does not prove an AI session is running.
3. Call `inbox_read` with `{}`. An empty `deliveries` array is a valid connected result. Reading never acknowledges messages.
4. Use a second agent connection for a real message round trip as shown below.

The health URL reports configuration only. A browser GET to the MCP endpoint returns **405**, which is expected: MCP requests use POST. Successful tool calls verify more than a health check or a visible tool catalog.

### Two-agent message check

Connect agent A as `manager` and agent B as `dev-1`. From manager, call `message_send`:

```json
{
  "to": ["dev-1"],
  "text": "Connection check. Please reply with your agent name.",
  "contextId": "connection-check-<unique-run-id>",
  "requestId": "<unique-message-request-id>"
}
```

Use fresh identifiers for a new check. Preserve the request ID and identical input when retrying the same send. Save the returned `messageId` and `contextId`.

From dev-1, call `inbox_read`. Each delivery contains:

- `_id`: the recipient delivery ID, used for acknowledgment.
- `seq`: this recipient's delivery sequence.
- `message._id`: the message ID, used for replies.
- `message.sender`, `message.recipients`, `message.contextId`, and `message.text`: routing and content.

Reply through `message_send`:

```json
{
  "to": ["manager"],
  "text": "Connected as dev-1.",
  "contextId": "<contextId from the incoming message>",
  "replyTo": "<incoming message._id>",
  "requestId": "<new unique reply request ID>"
}
```

After handling the question, dev-1 calls `inbox_ack`:

```json
{"deliveryIds": ["<incoming delivery._id>"]}
```

Manager reads its inbox, verifies the reply, and acknowledges its own delivery. Delivery IDs differ per recipient even when a message was sent to several agents. A `stored` send result does not mean the receiving AI has seen it.

## Work and communicate throughout a task

Read `inbox_read` between work steps. When waiting for another agent, call:

```json
{"timeoutMs": 25000, "limit": 50}
```

These are `inbox_wait` arguments. The tool returns when pending input exists or reports `timedOut: true`. Handle and acknowledge pending messages before waiting again; unacknowledged input causes an immediate return. Set the host's tool timeout to at least 45 seconds if configurable.

For a large inbox, use the returned `nextSeq` as `afterSeq` while draining pages until `hasMore` is false. Start a later recovery read without `afterSeq` to include older unacknowledged input. Acknowledgment preserves conversation history.

The Vercel endpoint does not advertise persistent resource subscriptions. `inbox_wait` listens to Convex within a bounded HTTP request; it occupies that tool call. It does not interrupt an existing command or automatically insert messages into a working model's context. For continuous resource updates, see the local stdio option in the [README](README.md); host support is still required.

For shared work, create a task with `task_create` using `title`, `description`, `assignee`, and optionally `contextId`. Use `parentTaskId` for a subtask; the parent context is inherited if omitted. Read `task_get` before updating, then pass its current `revision` as `expectedRevision` to `task_update`. Statuses are `open`, `working`, `blocked`, `review`, `done`, and `canceled`.

Role names are conventions in this personal MVP. Manager approval gates are not enforced, and the assignee can mark its own task done. Report actual checks/evidence rather than treating chat or delivery receipts as verification.

## Instructions to give a newly connected agent

> Use the AgentBus connection whose URL matches your assigned agent name. Coordinate all assignments, questions, findings, reviews, corrections, and results through AgentBus. Read your inbox between work steps. Preserve contextId and use replyTo when answering. Acknowledge delivery IDs only after handling them. Use inbox_wait while waiting; a timeout is normal. Read the latest task revision before updates. Report actual work and check results. Do not print credentials, assume a peer is running because it is listed, or claim that chat enforces manager approval.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| HTTP 401 | Use the AgentBus shared secret with the exact `Bearer ` prefix. Confirm it is available to the actual host process. |
| Login page or redirect | Use the production URL above. A Vercel sign-in page indicates separate deployment protection; ask the owner to inspect it. |
| HTTP 405 in a browser | Expected for GET on `/api/mcp`; connect through an HTTP MCP client. |
| HTTP 503 | Owner needs to inspect deployment configuration. Clients should not replace their bearer token with an admin key. |
| Tool returns a backend error | Read the error and ask the owner to check backend connectivity/configuration; the MCP handshake alone does not verify the database. |
| No tools or old tool set | Reconnect/reload the MCP connection; verify the endpoint and server label instead of an older local AgentBus installation. |
| Messages arrive under the wrong name | Change `?agent=` in that connection. Prompt role names do not override the configured identity. |
| Wait returns the same message repeatedly | Handle it, then acknowledge the delivery `_id`. |
| `REVISION_CONFLICT` | Fetch the task again, review the current state, and make a new decision using its revision. |
| `IDEMPOTENCY_MISMATCH` | Reused request ID with changed input. Retry identical input or use a new ID for a new operation. |
| Message is stored but peer does not answer | Confirm an AI session is active and reading/waiting on its correct inbox. The service does not launch agents. |

All holders of the personal secret share trust and can choose any agent name. Detailed backend/deployment configuration belongs in [VERCEL.md](VERCEL.md), and implemented guarantees are documented in [IMPLEMENTATION.md](IMPLEMENTATION.md).

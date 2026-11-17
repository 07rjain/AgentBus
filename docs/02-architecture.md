# Architecture

## Components and ownership

| Component | Responsibility | Must not do |
| --- | --- | --- |
| Convex backend | Authorize operations; atomically store messages, deliveries, tasks, gates, and audit records; expose queries and mutations. | Execute terminal commands or assume a subscription callback is a durable queue. |
| Identity service | Enroll workers and users; issue short-lived credentials with workspace and agent grants. | Expose admin/deploy credentials to agents. |
| Local AgentBus worker | Authenticate, subscribe, catch up, persist locally, own agent leases, and drive adapters. | Start competing turns or bypass coordinator decisions. |
| Local MCP facade | Present AgentBus tools to the model and forward authorized calls through the worker/backend. | Trust a model-supplied sender ID as authority. |
| Runtime adapter | Start/resume sessions, insert envelopes at safe boundaries, track turn outcomes, and expose capabilities. | Pretend terminal output automatically enters model context. |
| Dashboard | Display state, messages, delivery evidence, and role-authorized user controls. | Infer delivery or approval from prose. |
| Git/artifact store | Hold commit-addressed code, reports, and test outputs with access control. | Depend on another machine's local file paths. |

## Connection layout

Every worker opens an authenticated outbound subscription using the Convex JavaScript subscription client. Convex owns the real-time connection. We do not add a separate custom WebSocket server or webhook mesh.

For each logical agent, the worker subscribes to an authorized inbox-head query. The result contains a monotonic high-water sequence and retention metadata. A changed result schedules a bounded catch-up query against durable inbox entries. Writes use Convex mutations, not messages sent over an ad hoc socket protocol.

The local MCP facade can use stdio for compatibility. It forwards tools to the supervised worker using a private local IPC endpoint. The worker supplies credentials and session fencing. Models do not receive worker tokens. Multiple local MCP clients must not spawn multiple execution owners.

A future remote MCP endpoint can delegate to the same domain functions. It must preserve identity and authorization. It is not needed for the initial worker-based design.

## Trust and execution boundaries

Conversation text is untrusted task content, including messages from peer agents. It cannot change role bindings, credentials, system policy, or filesystem permissions. Agents work in explicitly configured repositories and sandboxes.

The backend enforces coordination state; the adapter enforces runtime serialization. Neither substitutes for the other. A database event cannot directly wake an arbitrary third-party AI session without an adapter supported by that runtime.

## State placement

- Central: immutable message bodies, per-recipient delivery records, agent grants, sessions/leases, task state, coordinator evidence references, audit history, and idempotency results.
- Local durable storage: received delivery envelopes, catch-up cursor, runtime session reference, dispatch intents, context insertion/turn receipts, and unsent operations.
- Ephemeral memory: subscription handles, connection state, debounce flags, and bounded dispatch buffers.

Central data is authoritative for collaboration. The local store is a recoverable execution journal; it never creates independent approvals or task outcomes.

## Repository layout for implementation

Proposed future packages: `convex/` for schema/functions/domain gates; `packages/contracts/` for validators and versioned envelopes; `packages/worker/` for supervision and local journals; `packages/mcp/` for the facade; `packages/adapters/` for runtime integrations; `apps/dashboard/`; and `tests/acceptance/`.

Keep pure domain validation separate from network clients. Use shared contracts for MCP inputs, backend mutations, examples, and dashboard forms. Do not port the current unauthenticated logical-ID checks unchanged.

## Deployment

Deploy Convex functions and schema to separate development/staging/production environments. Install workers as supervised services on agent machines. Configure an explicit deployment URL and environment ID; workers must refuse a journal belonging to another environment. Keep the dashboard and identity provider configured against the same workspace environment.

Human enrollment binds a machine and a set of allowed agents. Subscription reconnect, token refresh, lease recovery, and runtime resume are independent operations with separate error reporting. See [operations](08-security-operations.md).

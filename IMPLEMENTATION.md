# Personal MVP implementation

This file describes implemented behavior. The numbered documents in `docs/` describe the more extensive proposed system and must not be read as implemented guarantees.

## Components

- `convex/schema.ts`: agents, messages, deliveries, tasks, and idempotency operations.
- `convex/bus.ts`: secret-checked queries/mutations, atomic recipient fan-out, pending inboxes, and ordinary task updates.
- `src/client.ts`: one Convex subscription client bound to a configured agent name; no local task database.
- `src/server.ts`: eleven MCP tools and a subscribable `agentbus://inbox` resource.
- `src/index.ts`: stdio startup, periodic heartbeat, disconnect/shutdown cleanup.
- `scripts/setup-secret.mjs`: generates/configures the private shared secret without printing it.
- `scripts/demo.mjs`: real two-process MCP protocol checks against a configured backend.

## Exact message flow

1. Host launches a stdio server with one configured agent name, backend URL, and shared secret. Registration updates the agent record.
2. `message_send` invokes a Convex mutation. The mutation validates secret/input and idempotency, inserts one immutable message plus unique recipient deliveries, and increments each recipient's sequence in the same transaction. Unknown recipients become offline agent records.
3. Recipient MCP processes subscribe to their inbox head. A head change emits a resource-update notification only when the MCP host subscribed. The server never treats that notification as a read acknowledgment.
4. The host/agent reads the pending inbox resource or calls `inbox_read`. While idle, `inbox_wait` uses a live pending-inbox subscription and returns when data is available. Neither path acknowledges input automatically.
5. The agent handles input, optionally replies with the same context and `replyTo`, then acknowledges selected delivery IDs through `inbox_ack`.
6. If a client restarts, pending input is still in Convex. Read without an afterSeq to recover it. No journal file or worker-received marker can silently remove it.

## Guarantees

- A successful stored result means both message and recipient deliveries committed.
- Fixed recipient list and sender are visible in message records. Shared trust means the configured sender is not a separately authenticated human/agent principal.
- A message appears in every pending read until explicitly acknowledged. No TTL deletion or acknowledgment-based history deletion is implemented.
- Receipts are recipient-specific and idempotent. A mixed unauthorized acknowledgment batch rolls back entirely.
- Caller-provided request IDs deduplicate sends and task mutations by actor + operation + request ID. Matching retries return the original result; changed normalized input fails. The personal implementation compares canonical input strings rather than the larger design's payload hashes.
- Recipient sequences order that recipient's deliveries. Conversation history uses Convex's indexed creation ordering and pagination, not a separate conversation sequence counter.
- Revision checks prevent silently overwriting task state read before another update. Terminal tasks cannot be reopened.
- Task creation/status notification and the task change commit atomically.
- Backend limits enforce agent names, 32 KiB UTF-8 message text, up to 50 recipients, 100 entries per page/ACK, and bounded descriptions/summaries. No automatic retention, billing limits, or rate limiting is implemented.

## Deliberate limits

- One trusted owner and one shared secret. Any holder can choose any agent name and read all contexts. This is not multi-tenant or per-agent authentication.
- No session fencing, exclusive worker ownership, distributed execution journal, or exactly-once external work. Use one active MCP process per logical agent name.
- No built-in model/provider integration. Resource notifications depend on host support; they do not prove runtime acceptance or semantic understanding.
- `inbox_ack` is an explicit assertion by the caller, not independent proof the model handled the message.
- No enforced research/development/manager release gates. Role names are conventions. `review` is an ordinary task state; an assignee can mark its own work done.
- Heartbeats record last-seen time; process death does not immediately set state to offline. Inspect lastSeenAt rather than trusting a stale state label.
- Offline recipient queues and idempotency records have no automatic expiry. Back up and manage your Convex deployment according to your personal retention needs.
- The stdio server has no public HTTP endpoint. Machines communicate through the same hosted Convex deployment; a loopback backend supports only local testing.

## Verification evidence

`npm test` uses `convex-test`, a JavaScript simulation of Convex functions. `npm run demo` uses the actual configured backend, two SDK stdio clients, and actual WebSocket subscriptions. The demo is a protocol check, not evidence of autonomous model coordination or deployment across two machines.

Credentials, local Convex state, and generated build output are ignored by Git. Convex-generated API/types are committed so a fresh clone can build before signing into Convex. The previous local AgentBus project's database and runtime remain separate.

# Message flow and delivery semantics

## Normal direct-message flow

Example: dev-2 asks dev-1 about an API while dev-1 runs tests.

1. Dev-2 invokes `message_send` through its local MCP facade with a stable `requestId`, explicit recipient, context, and message body.
2. The backend derives the sender from the authenticated principal. In one mutation it checks membership/session fencing, resolves recipients, writes the immutable message and per-recipient deliveries, increments recipient inbox heads, appends an audit entry, and stores the idempotent result.
3. The sender receives a durable `stored` result. This does not imply dev-1 has received or read anything.
4. Dev-1's inbox-head subscription changes. Its listener schedules catch-up even though a terminal command is still running.
5. Catch-up reads bounded pages in sequence order. The worker commits envelopes and its catch-up cursor to local storage before acknowledging receipt to the backend.
6. The worker leaves the test command running. At the next supported runtime boundary, it selects queued envelopes and writes a dispatch intent before handing them to the adapter.
7. The adapter returns a durable context-insertion receipt, if supported. The worker marks `runtime_accepted`. This means the envelope entered the session; it does not prove the model understood it.
8. The model processes the question in its next turn and replies through AgentBus with `replyTo`. A completed turn receipt can mark the input delivery `handled`.
9. Dev-2 receives the reply through the same mechanism. A reply is a separate message, never an implicit delivery acknowledgment.

The server only returns a read/accepted indicator supported by recorded evidence. The dashboard must show queued or unknown states when evidence is absent.

## Subscription semantics

Convex subscriptions yield query results, not an application event log. Several writes may be reflected in one new high-water value. A client must not assume it sees one callback per message or every intermediate agent status.

Subscribe to `inbox.head(agentId)` containing `{headSeq, replayFloorSeq}`. Fetch actual entries using `inbox.page(agentId, afterSeq, throughSeq, limit)`; `throughSeq` is captured from the observed head. Continue pages until drained, then recheck the latest head. A serialized drain loop with a dirty flag prevents concurrent callbacks from processing overlapping batches.

Sequences are per recipient, start at 1, and advance atomically with delivery creation. They order that recipient's deliveries only. Use separate conversation sequence numbers for audit ordering inside a context; there is no required global ordering across workspaces.

## Delivery states

| State | Evidence | Retry behavior |
| --- | --- | --- |
| `pending` | Server stored a delivery for this recipient. | Eligible for replay. |
| `received` | Current worker persisted it in its local journal. | Replay remains possible; receipt is not completion. |
| `runtime_accepted` | Adapter recorded durable insertion into a named runtime session. | Reconcile that session before redelivery after a crash. |
| `handled` | Adapter recorded completion of the turn handling the input batch. | Terminal transport-processing state; does not approve a task. |
| `failed` | Retry budget exceeded or delivery cannot be processed. | Visible dead letter; explicit authorized redrive required. |

Each delivery also records attempts, timestamps, last error, and dispatch/turn references. A timeout may be ambiguous; it is not automatically proof of rejection. The optional UI fact `replied` comes from an actual reply message reference.

## Reconnect and restart

Same worker with intact journal: resubscribe, catch up from its durable cursor, and resume locally queued deliveries. Backend receipt acknowledgments are retried idempotently.

Replacement worker or lost journal: acquire a new fenced session, load all central nonterminal deliveries in pages using `inbox.recover`, reconcile `runtime_accepted` dispatches against runtime history, then start normal head-based catch-up. Deduplicate overlapping recovery and catch-up pages by delivery ID. Never jump directly to the current head without recovering the backlog.

Old-session acknowledgments and writes are rejected after takeover. Retention must not erase unresolved deliveries. If the requested cursor predates available history, return `REPLAY_GAP`; require explicit recovery, not silent cursor advancement.

## Idempotency and ordering

All side-effecting calls carry a client-generated stable `requestId`. Scope uniqueness to workspace, authenticated actor, and operation. Retries with an identical canonical input hash return the original result; reuse with a different hash fails. These checks and writes happen in the same Convex mutation.

Workers deduplicate envelope insertion by delivery ID and runtime dispatch by a stable `dispatchId`. Batch inputs in recipient sequence order. Network retransmissions, model turns, filesystem changes, and third-party calls do not become exactly once merely because database mutations are transactional.

## Waiting, urgency, and backpressure

Normal chat never interrupts commands. A model that needs a peer reply marks its task `input_required` and yields a turn; it does not busy-wait with repeated model calls. The worker continues listening and resumes it when relevant input arrives.

Urgency flags an input for attention but does not overtake earlier inbox entries in the first release. Explicit stop/steer controls use a separate audited control path and require authorization, an adapter capability, and truthful success/failure reporting. A normal chat message saying “stop” is not a transport control.

Use bounded batches and journals. Pause new runtime work when local capacity is reached, while continuing lease maintenance and exposing backpressure. Unreceived central deliveries stay durable. Presence changes never trigger autonomous peer replies; avoid heartbeat-driven feedback loops.

## Attachments and broadcast

Resolve a channel's authorized member set at send time and persist one delivery per recipient. Later membership changes do not rewrite historical recipients. Reads still enforce current access policy; revocation may explicitly terminate remaining delivery access.

Attachments reference authorized shared storage or repository commits with hashes. Do not embed large logs in chat or expect a remote agent to open `/home/...` on the sender's machine. See [protocol examples](../examples/).

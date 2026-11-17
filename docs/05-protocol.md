# AgentBus protocol and API contracts

Protocol version: `agentbus.remote.v1`. Function names below are proposed contracts, not existing deployed endpoints. All timestamps are server-generated UTC values except explicitly identified local measurement timestamps.

## Authentication and identity

Every query and mutation derives workspace and allowed agents from a verified principal. Tool inputs may name an agent only to select among agents already granted to that principal. They cannot assert a sender or role. Server-side functions independently check membership and resource scope, even when called directly without MCP.

Workers authenticate with short-lived credentials issued via an approved identity integration. Enrollment grants the worker only its agent identities. Do not ship Convex deployment/admin keys to workers. Selection of the exact identity provider is an implementation decision recorded in [decisions](10-decisions.md).

## Model-facing MCP tools

| Tool | Input essentials | Result |
| --- | --- | --- |
| `message_send` | requestId, contextId, taskId?, recipientAgentIds or channelId, kind, body, replyTo?, correlationId? | stored message ID, conversation sequence, delivery IDs |
| `message_list` | contextId, afterConversationSeq, limit | authorized immutable messages and next cursor |
| `inbox_read` | optional task/context filter, limit | pending inputs/status for inspection; never advances a cursor implicitly |
| `task_create` | requestId, contextId, parentTaskId?, assignee, brief | task + revision; forbidden for managed-context bypasses |
| `task_get` | taskId | authorized task, revision, artifact refs |
| `task_update` | requestId, taskId, expectedRevision, transition, evidence? | new revision; ordinary tasks only |
| `coordinator_create` | requestId, brief, five distinct role bindings, research assignments | coordinator + initial tasks |
| `coordinator_get` | coordinatorId | current refs, revision, role-allowed actions, blockers |
| `coordinator_action` | requestId, coordinatorId, expectedRevision, action, payload | committed revision, authoritative event/message refs |

The local facade fills the selected agent/session identity. Existing tools requiring caller-supplied `fromAgentId` or `agentId` need an authenticated compatibility layer; never trust the old field as authority.

`kind` is one of `question`, `reply`, `progress`, `finding`, or `discussion` for public chat. System/coordinator/control event kinds are reserved for authorized service writers. Text is inert evidence, not an instruction to alter backend state.

## Worker-facing backend functions

| Function | Semantics |
| --- | --- |
| `sessions.acquire/renew/release` | Own or renew a fenced agent lease. Acquire/takeover is audited. |
| `inbox.head` | Reactive authorized query returning headSeq and replayFloorSeq; no delivery side effect. |
| `inbox.page` | Bounded sequence page after an explicit cursor through a captured head. Includes delivery + immutable message. |
| `inbox.recover` | Paginated nonterminal backlog, including previously received/runtime-accepted inputs; used after local loss. |
| `deliveries.received` | Idempotently record that a current worker durably journaled specified deliveries. |
| `dispatches.begin/accepted/complete/reconcile` | Journal a fenced dispatch intent and trustworthy adapter receipts/outcomes. |
| `messages.send` | Atomic authenticated send with idempotency and recipient snapshot. |
| `coordinators.act` | Atomic gated domain mutation and event delivery. |

Backend function arguments include the lease generation for agent writes. Administrative user actions use separate human permissions and attribution. Public read functions never return another workspace's IDs, counts, or bodies.

## Envelope

An envelope joins a message and one recipient's delivery: protocolVersion, deliveryId, messageId, contextId, taskId, conversationSeq, recipientInboxSeq, immutable authenticated sender, fixed recipients, kind, body, replyTo, correlationId, and storedAt. See [delivery example](../examples/delivery.json).

The runtime receives the envelope as labeled AgentBus content, preserving sender and task attribution. Normal peer messages are not promoted to system/developer instructions. The adapter supplies a dispatch ID and records the runtime session/turn associated with the envelope batch.

## Error contract

Errors return `{code, message, retryable, details?}` without tokens or private message bodies. Codes:

- `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`: refresh credentials or correct access; do not leak resource existence.
- `VALIDATION_FAILED`, `PAYLOAD_TOO_LARGE`, `RECIPIENT_LIMIT`: correct the operation, then use a new request ID.
- `IDEMPOTENCY_MISMATCH`: same key used with different normalized input; never retry unchanged automatically.
- `REVISION_CONFLICT`: refresh and review current state; do not mechanically increment a revision.
- `LEASE_EXPIRED`, `STALE_SESSION`: stop new runtime dispatch, reacquire/reconcile ownership.
- `RATE_LIMITED`, `TEMPORARY_UNAVAILABLE`: retry the same request with exponential backoff and jitter.
- `REPLAY_GAP`: run explicit recovery or operator reconciliation.
- `RUNTIME_UNSUPPORTED`, `RUNTIME_OUTCOME_UNKNOWN`: show blocked/ambiguous execution; do not claim delivery completion.

## Operation IDs and replies

Use a generated UUID for requestId; keep it stable across network retries. Use deliveryId for local inbox uniqueness and dispatchId for adapter insertion retries. A reply links to a message in the same authorized context. `correlationId` groups a request and follow-up conversation; it is not an authorization token or a unique-delivery guarantee.

For idempotency hashing, validate input, materialize documented defaults, omit requestId and server-derived metadata, then encode UTF-8 JSON with recursively sorted object keys and preserved array/string values. Hash with SHA-256. Reject non-finite numbers and unsupported values; do not normalize text or silently reorder recipient arrays on a retry. Both request comparison and operation-result storage use this same backend implementation. A shared research-contract hash applies the same procedure to its versioned contract object; record the contract body as well as the hash.

Initial `message_send` limits are listed in the [data model](04-data-model.md). Pagination uses explicit sequence numbers; an empty page returns the unchanged cursor. Results name the captured `throughSeq` so clients cannot mistake a partially drained page for the current live head. Distinct reply messages use distinct request IDs even when their correlation ID is shared.

Task state, delivery state, and conversation state are independent. An unanswered question does not mean a delivery failed. A handled correction request does not mean corrected code passed verification.

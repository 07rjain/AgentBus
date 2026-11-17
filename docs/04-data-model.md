# Convex data model and transaction specification

These are application-level logical fields. Convex-generated `_id` and `_creationTime` remain available. Validate inputs at every public function. IDs in examples are readable placeholders, not generated Convex document IDs.

## Tables and indexes

| Table | Key fields | Required access paths |
| --- | --- | --- |
| `workspaces` | name, environmentId, policyVersion | by environment |
| `memberships` | workspaceId, subject, role, revokedAt | workspace + subject |
| `machines` | workspaceId, enrollmentSubject, allowedAgentIds, revokedAt | workspace + subject |
| `agents` | workspaceId, name, roles, capabilities, enabled, presence, lastHeartbeatAt | workspace + name; workspace + identity binding |
| `sessions` | workspaceId, agentId, machineId, generation, leaseExpiresAt, runtimeSessionRef | agent + active generation |
| `contexts` | workspaceId, memberAgentIds, nextConversationSeq, status | workspace; membership |
| `tasks` | workspaceId, contextId, parentTaskId, creatorId, assigneeId, status, revision, artifactRefs | context; assignee + status; parent |
| `messages` | workspaceId, contextId, taskId?, conversationSeq, sender, recipientAgentIds, kind, body, replyTo?, correlationId?, protocolVersion | context + sequence; task + sequence |
| `inboxHeads` | workspaceId, agentId, headSeq, replayFloorSeq | workspace + agent |
| `deliveries` | workspaceId, messageId, recipientAgentId, inboxSeq, state, attempts, receipt/session refs, lastError | recipient + sequence; recipient + state + sequence; message + recipient |
| `dispatches` | workspaceId, agentId, dispatchId, deliveryIds, generation, runtimeSessionRef, phase, receiptRefs | agent + dispatchId; agent + phase |
| `coordinators` | workspaceId, contextId, roleBindings, stage, revision, currentReportRefs, currentSubmissionRefs, agreements, verifications, approvals | context; workspace + stage |
| `coordinatorEvents` | workspaceId, coordinatorId, revision, action, actor, exactRefs, messageId | coordinator + revision |
| `operations` | workspaceId, actorSubject, operationName, requestId, canonicalInputHash, resultRef, createdAt | workspace + actor + operation + requestId |
| `audit` | workspaceId, actor, sessionGeneration?, action, resourceRefs, outcome, timestamp | workspace + timestamp; resource |

Indexes do not automatically create SQL-style unique constraints. Enforce logical uniqueness by indexed existence reads and writes inside a mutation, relying on Convex transaction conflict handling; test concurrent races. Large workspace member sets need membership tables rather than unbounded arrays.

## Atomic send transaction

`messages.send` must perform all of these within one mutation:

1. Authenticate; verify workspace, sender grant, session lease, and enabled status.
2. Check idempotency key and canonical payload hash; return stored result for a matching retry.
3. Authorize context/task access, reply references, recipient scope, and message kind.
4. Resolve a fixed recipient set; enforce body and fan-out limits.
5. Allocate the context sequence and each recipient inbox sequence.
6. Insert one message and one pending delivery per recipient; update inbox heads.
7. Append audit metadata and save the operation result.

No externally performed send belongs in this mutation. Reactive invalidation follows committed data. If large fan-out eventually exceeds a transaction budget, introduce an explicit durable fan-out job and partial-progress contract; do not silently split current atomic semantics.

## Coordinator mutation

`coordinators.act` validates the principal's bound role and `expectedRevision`, checks exact evidence references and gate predicates, updates coordinator and affected tasks, and writes authoritative events/messages/deliveries in one transaction. An internal event writer is shared with normal delivery allocation; the coordinator must not call a remote public endpoint after committing state.

Concurrent actions from the same revision cannot both silently succeed. An application `REVISION_CONFLICT` requires re-reading and reviewing state before generating a new action. Network retry uses the original request ID; a changed decision gets a new ID.

## Worker lease and fencing

`sessions.acquire` creates generation N+1 only if the current lease expired or an authorized takeover is requested. Renewal requires the exact generation and worker identity. Agent writes, receipt updates, dispatch transitions, and coordinator agent actions require the live generation. Lease tokens alone are not authentication credentials.

Initial policy: heartbeat every 15 seconds, lease duration 60 seconds, with jitter; these are configurable choices. Use backend time for lease comparisons. A disconnected worker pauses new model/tool dispatch before its lease can expire, applying a conservative local monotonic deadline. Already-running external commands may continue; fencing protects server mutations, not arbitrary filesystem side effects.

Presence is derived from lease/heartbeat evidence, not freely writable by the model. Time passing alone must not be assumed to invalidate a subscription: expiry is evaluated by server operations and scheduled sweeps or bounded presence refreshes.

## Recovery and retention

Keep nonterminal deliveries and ambiguous dispatches regardless of age until explicitly resolved. Retain handled messages, operation deduplication records, and audit records for a configured policy. Initial proposal: 30 days for handled chat, 90 days for operation keys, and longer project-configured retention for release evidence. Confirm requirements before enabling deletion.

No retry guarantee applies after an idempotency key is purged; old clients must receive an explicit expired-window error or require reconciliation. Deduplication keys must not disappear while corresponding operations are unresolved. Garbage collection advances replay floors transactionally and preserves referenced evidence or archives it immutably with an authorized retrieval path.

## Application limits

Initial proposals: 32 KiB serialized text/metadata per message, 50 explicit recipients, 100 deliveries per catch-up page, and configurable local journal capacity. Validate these against actual Convex transaction/document limits and measured record sizes before implementation acceptance. Store attachments separately and use bounded indexed queries; never subscribe to an entire workspace history.

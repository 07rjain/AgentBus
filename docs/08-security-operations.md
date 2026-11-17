# Security and operations

## Identity and authorization

- Every Convex function checks authenticated workspace membership and resource access. Possession of a document ID is insufficient.
- Worker enrollment binds a machine principal to allowed agent identities; one worker can host several granted agents. Short-lived tokens are refreshed without embedding secrets in prompts.
- Separate human admin/manager privileges from machine execution grants. A worker cannot rename itself into another coordinator role.
- Validate sender, recipients, reply references, role actions, session generations, and lease expiry server-side. Revoke access across queries, mutations, and subscriptions; test active connections after revocation.
- Keep deployment keys in deployment infrastructure only. Store worker secrets with OS-protected permissions/secret storage. Never log tokens or attach them to artifacts.

## Content and filesystem boundaries

Treat peer messages and artifacts as untrusted content. They cannot authorize a privileged tool, change an agent's system policy, or execute a command by transport alone. Configure repository roots, command permissions, and provider budgets per worker/agent.

Use authenticated artifact downloads, hash verification, and allowlisted schemes. Do not auto-fetch arbitrary URLs from model-produced messages with worker credentials. Redact credentials and personal data from audit metadata and operational logs.

## Supervision and availability

Run workers under systemd or an equivalent service supervisor with restart limits, explicit working directories, private state directories, and rotated logs. This avoids depending on a terminal/background command surviving an orchestrator restart.

Keep network reconnect, identity refresh, lease maintenance, inbox draining, and model execution independently observable. A reconnected socket does not prove the agent session recovered. A heartbeat does not prove the model is making progress.

## Failure handling

| Failure | Required behavior |
| --- | --- |
| Network disconnect | Persist local queues/outbox; retry with jitter; replay from durable positions. Pause new runtime work before lease expiry. |
| Convex temporary outage | Keep durable local state; stop starting work without a valid lease; show backend unavailable. |
| Token expired/revoked | Refresh if allowed; otherwise stop new dispatch and expose an authentication error. |
| Worker crash before local commit | Replay the pending central delivery. |
| Crash after local commit before receipt ACK | Deduplicate locally, retry acknowledgment. |
| Crash after runtime insertion | Reconcile dispatch history; show unknown if it cannot be established. |
| Two workers claim one agent | Only one live lease; stale generation mutations fail. External local work still needs reconciliation. |
| Local disk full | Stop receiving/dispatching beyond safe bounds; do not acknowledge unpersisted inputs. |
| Poison message/adapter failure | Bounded retries with retained evidence; dead-letter and notify manager. No silent drop. |
| Subscription coalesces updates | Catch up all durable entries through the reported head. |
| Stale approval action | Reject revision/reference conflict and require renewed review. |
| Deleted runtime session | Recover messages centrally; require operator decision about restarting ambiguous work. |

## Observable message path

The dashboard must display sender, fixed recipients, context/task, reply reference, stored time, per-recipient received time, runtime-accepted time/session, handled time/turn, retries/errors, and any linked reply. Use `unknown` when evidence is absent. Transport delivery is not semantic understanding.

Track connected workers, lease age, backend lag, local queue depth, oldest pending input, runtime-acceptance delay, turn duration, dead letters, auth failures, and stale-action rejections. Correlate messageId, deliveryId, dispatchId, requestId, and coordinator revision in structured logs.

Initial validation goals, not measured guarantees: on a healthy test network, p95 commit-to-worker-journal latency below 2 seconds; catch-up of a 100-message backlog below 10 seconds, excluding runtime execution. Record network conditions and avoid treating cross-machine clock subtraction as precise latency. Use tracing or synchronized clocks with stated uncertainty. Model delivery latency is separately measured at the next available boundary and may be much longer during commands.

## Retention, backup, and environments

Configure backups/exports and perform a restore exercise before production. Include schema/function version, identity bindings, coordinator refs, message/delivery state, and required artifacts. Confirm the chosen Convex plan's backup capabilities rather than assuming availability.

Restore to a distinct environment first; fence previous sessions, reconcile external work, and avoid replaying external side effects blindly. Workers must not mix staging credentials, cursors, or journals with production. Restore and retention policies must preserve approval evidence and unresolved work.

## Budget and loop controls

Set configurable per-agent concurrency, turn/token budgets, message rate limits, fan-out bounds, and maximum automatic redrives. Hitting a budget pauses work visibly and notifies the manager; it cannot auto-approve a task. Do not wake agents for every presence update, receipt ACK, or self-generated progress event.

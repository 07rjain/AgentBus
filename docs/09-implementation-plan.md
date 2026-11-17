# Implementation plan and acceptance

All phases below are pending implementation. This document does not claim any runtime, Convex deployment, or multi-machine validation already exists.

## Phase 0: prove delivery into a real agent session

Choose the first supported runtime/provider and an explicit launch/attach policy. Implement a minimal adapter spike using its documented API. During a real task, receive a message while a tool is running, deliver it at the next supported boundary, reply, and continue the original task. Demonstrate idle wake-up and session resume. Label unsupported capabilities explicitly.

Exit: recorded real session and message evidence. Stop or revise the integration if the runtime cannot accept session input; do not build the entire backend around an assumed terminal trick.

## Phase 1: contracts and deterministic fixtures

Create shared validated envelope, mutation, receipt, and coordinator types. Define canonical input hashing and error shapes. Build a simulator adapter for deterministic fault tests, clearly distinguished from the real adapter. Add fixture validation for recipient identities, sequence ordering, and reply references.

Exit: contract tests pass, both adapters implement the declared interface, and unknown runtime outcomes have an explicit representation.

## Phase 2: authenticated Convex backend

Implement schema/indexes, identity grants, session leases/fencing, idempotency results, atomic sends, recipient inbox heads, catch-up/recovery queries, receipts, and audit records. Validate application limits against current platform limits. Use indexed bounded queries and test direct function access without the MCP facade.

Exit: concurrent-send/idempotency tests, isolation tests, reconnect/recovery fixtures, and stale-session rejection pass in a non-production deployment.

## Phase 3: durable worker

Implement local journal/outbox, serialized drains, subscription reconnect, credential refresh, per-agent lease renewal, dispatch journal, adapter reconciliation, backpressure, and supervised lifecycle. Test one worker hosting multiple distinct agents without cross-delivery.

Exit: kill/restart and partition tests show no lost nonterminal message; ambiguous execution is surfaced rather than falsely acknowledged.

## Phase 4: AgentBus MCP facade and two-machine chat

Expose the authenticated AgentBus tools via local MCP. Bind tool identity to the configured agent; do not accept arbitrary sender credentials from model arguments. Connect two machines to the same remote deployment. Deliver a real question/reply during tool execution with no manual inbox polling by the model.

Exit: both workers receive while busy, deliver at supported boundaries, and recover after one machine disconnects. All substantive coordination is in AgentBus records.

## Phase 5: coordinator domain

Port five-role gates into transactional Convex functions. Add immutable evidence references, role authorization, revision conflicts, invalidation, reserved-event protection, and managed-task bypass prevention. Publish assignments and state-change events in the same transaction.

Exit: real research/cross-review/development/verification/correction/release cycle completes. Verify an attempted early developer assignment or final release is rejected.

## Phase 6: human dashboard

Show roles, tasks, stages, blockers, messages, per-recipient delivery evidence, runtime errors, corrections, and final release. Add authenticated controls with exact reviewed references and revisions. Preserve draft inputs across reactive updates; require explicit refresh/review after state conflicts.

Exit: operators can identify who sent what, to whom, what the receiving worker/runtime accepted, and which evidence enabled final release. Review accessibility and exercise the actual UI before implementation sign-off.

## Phase 7: multi-machine reliability and staged rollout

Run at least eight workers across two machines, including the five-role workflow. Measure latency under stated conditions. Rehearse token revocation, worker takeover, backup restore, retention gaps, dead-letter redrive, and rollback. Keep the existing local AgentBus install separate until migration is explicitly authorized.

Exit: evidence bundle contains actual messages/receipts, runtime traces with sensitive data removed, commands/results, artifact hashes, observed limitations, and rollback instructions. A simulator-only run cannot satisfy this gate.

## Dependency order and work packages

Phase 0 gates runtime assumptions. Contracts precede backend/worker integration. Backend and worker internals can be implemented independently after those interfaces stabilize, but two-machine acceptance requires both. Coordinator gates precede final dashboard controls and release validation.

Potential work packages for a later explicitly assigned implementation team: backend/domain, worker/runtime, MCP/dashboard, and verification/operations. This plan creates no agents or background jobs.

## Acceptance matrix

| Test | Required assertion |
| --- | --- |
| A1: busy recipient | Listener journals an input during a command; runtime sees it at its documented boundary and replies. |
| A2: idle recipient | One incoming task/input resumes the session once; no polling model loop. |
| A3: offline recipient | Messages sent while offline survive and arrive after reconnect in recipient sequence order. |
| A4: coalesced notifications | A head jump from N to N+10 drains all ten deliveries. |
| A5: duplicate sends | Same request ID/input creates one message; changed input returns an idempotency error. |
| A6: crash windows | Kill before/after local commit, runtime insertion, and ACK; recover or surface ambiguity accurately. |
| A7: lost local disk | New worker recovers central nonterminal backlog, including received/accepted inputs, without silently skipping it. |
| A8: duplicate owner | Second worker cannot write with a stale generation; no new competing turn is started. |
| A9: authorization | Forged sender, cross-workspace read, role escalation, revoked token, and unauthorized recipient all fail. |
| A10: coordinator gates | Early development/release, stale agreement, self-verification, forged event, and generic-task bypass all fail. |
| A11: correction loop | A changed submission invalidates dependent acceptance; current evidence is required before release. |
| A12: scale scenario | Eight active workers on two machines route only authorized messages and stay within configured queue bounds. |
| A13: evidence | Dashboard states match stored receipts; handled is never labeled task-approved or understood. |
| A14: retention/restore | Replay gaps are explicit; unresolved/evidence records survive; restore does not blindly repeat external work. |
| A15: backpressure and limits | Oversized/fan-out/rate-limit errors are explicit; disk-full inputs are never falsely acknowledged. |
| A16: actual independence | Role bindings are distinct; reviews reference the other role's exact artifact; reported checks have inspectable outputs. |

## Rollout and migration policy

Start with a new deployment and test workspace. Import historical data only through a separately reviewed migration preserving original IDs/attribution as historical records; do not activate old tasks or replay historical deliveries automatically. Provide an explicit cutover checkpoint and prohibit dual writes between SQLite and Convex as competing authorities.

Rollback stops new work and fences leases, preserves both central and local journals, reconciles active external work, and returns only explicitly selected new tasks to the prior workflow. It does not delete new evidence or pretend runtime side effects rolled back.

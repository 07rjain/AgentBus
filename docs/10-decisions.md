# Decisions, assumptions, and unresolved choices

## Accepted design decisions

| Decision | Reason | Consequence |
| --- | --- | --- |
| Use Convex for shared state and subscriptions. | Managed reactive queries fit remote workers and dashboards. | Requires a deployment and explicit authentication integration. |
| Subscribe to durable inbox heads, not presence changes. | A busy status can remain unchanged across many messages; subscriptions can coalesce updates. | Fetch/recovery logic remains required. |
| Keep AgentBus as the coordination interface. | Preserve one audited path for assignments, discussions, and approvals. | Both MCP and direct backend access need the same authorization rules. |
| Use outbound worker connections. | Agents may be behind NAT or firewalls. | No worker webhook server or per-machine public URL. |
| Start with boundary-based session delivery. | Portable semantics without canceling arbitrary work. | Message receipt may precede model visibility by a long command. |
| Treat active-run injection as a capability. | Agent runtimes expose different session controls. | Runtime-specific validation is mandatory. |
| Use at-least-once delivery and explicit ambiguity. | Network and runtime crashes can occur between durable steps. | Deduplication and reconciliation are required. |
| Fence logical-agent sessions. | Prevent two workers from acting as one role concurrently. | Does not prevent an old shell command from continuing locally. |
| Preserve revision/reference gates. | Chat-based agreement alone cannot authorize release. | Changed evidence requires renewed reviews. |
| Create a separate implementation/deployment. | Protect the existing local workflow and evidence. | Migration is a later explicit operation. |

## Alternatives considered

Webhooks are viable for centrally reachable workers, but add endpoint exposure, authentication, retries, and machine availability management. Agent count greater than four is not itself a webhook scaling problem. Outbound subscriptions fit this project's machine topology better.

Custom SSE/WebSockets with SQLite/PostgreSQL would also work. Convex replaces the custom real-time/data layer, while the local worker and runtime adapter are still necessary. Redis/NATS/RabbitMQ are optional future infrastructure only if measured requirements justify another broker; they are not prerequisites for this design.

Long polling is a reasonable fallback for environments without working persistent connections. It must read the same durable inbox and preserve identical receipt/recovery semantics. Do not add it until the failure mode exists or the deployment requires it.

## Choices to settle before implementation

1. First runtime/provider, supported SDK version, and whether the worker launches or attaches sessions. Phase 0 depends on this.
2. Managed Convex versus self-hosted Convex, deployment region, budget, and environment ownership. The design assumes an available supported deployment, not a specific plan.
3. Identity provider, machine enrollment flow, short-lived token issuance, and revocation semantics. Demonstrate authentication with the chosen Convex integration before production.
4. Repository/artifact storage, branch ownership, and code integration policy. Prefer commit-addressed Git artifacts with controlled access.
5. Allowed runtime permissions, provider budgets, retention periods, and human stop/takeover policy.
6. Whether urgent interruption is required at all. Normal messaging works without it; stop/steer needs separate adapter evidence and authorization.

These choices do not block documenting the system. They do gate implementation/deployment steps that depend on them. This repository contains no credentials, live environment configuration, launched workers, or measured performance results.

## Review checklist

- Is the distinction between a live connection, durable receipt, runtime insertion, and model handling explicit?
- Can a lost subscription update or missing local journal cause a message to disappear? It must not.
- Can a stale worker or model-supplied ID impersonate a manager? It must not.
- Can normal text, an old review, or a changed artifact bypass release gates? It must not.
- Are real SDK capabilities and crash outcomes demonstrated rather than assumed?
- Is final user delivery tied to a committed manager release rather than merely completed model turns?

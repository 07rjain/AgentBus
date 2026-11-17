# AgentBus Remote: design and implementation specification

Status: proposed design, version 0.1, 2026-11-17. This repository contains documentation and protocol examples, not a deployed service or a working agent adapter.

Build a shared AgentBus service backed by Convex so agents on different machines can exchange messages throughout their work. Each machine runs a worker that subscribes to its agents' inboxes and delivers messages into their active sessions. No inbound webhook endpoint is required on those machines.

An open connection does not make a model read messages during inference. The worker receives continuously; the runtime adapter delivers queued messages between work steps, or through an explicitly supported active-session input interface. Proving that adapter is the first implementation milestone.

## Read in this order

1. [Product requirements and scope](docs/01-requirements.md)
2. [Architecture and deployment boundaries](docs/02-architecture.md)
3. [Message flow and delivery guarantees](docs/03-message-flow.md)
4. [Convex data model and transactions](docs/04-data-model.md)
5. [AgentBus tools and backend contracts](docs/05-protocol.md)
6. [Worker and runtime adapter specification](docs/06-worker-runtime.md)
7. [Manager-controlled collaboration](docs/07-coordinator.md)
8. [Security, operations, and failure recovery](docs/08-security-operations.md)
9. [Implementation phases and acceptance tests](docs/09-implementation-plan.md)
10. [Decisions, assumptions, and open questions](docs/10-decisions.md)

[Interactive flow walkthrough](diagrams/message-flow.html) provides normal delivery, reconnect recovery, and manager-gated collaboration scenarios. [Protocol examples](examples/) show concrete request and response shapes.

## Chosen approach

- Convex is the authoritative shared store and supplies reactive query subscriptions.
- AgentBus is the only agent-facing coordination interface. Local MCP tools call authenticated Convex functions; they do not maintain an independent task database.
- A supervised worker on each machine maintains subscriptions, a durable local inbox, and one serialized execution loop per logical agent.
- Explicit recipients, acknowledgments, message IDs, and replay support recovery. Delivery is at least once; side effects require idempotency or reconciliation.
- Agent presence, task progress, transport receipt, runtime acceptance, and peer replies are separate facts.
- Manager gates require exact immutable research/submission references. A chat message cannot approve or release work.

## Relationship to the existing project

The existing local AgentBus project is the behavioral reference for task hierarchy, discussion, and the five-role coordinator. Its SQLite records, installation, running processes, and Git history remain separate. This repository does not migrate or change them.

The remote design adds authenticated identities, explicit recipient deliveries, live subscriptions, session fencing, and runtime adapters. The existing dashboard tunnel is not a remote MCP or worker service. A remote MCP gateway is an optional later client transport; outbound local MCP bridges are the initial design.

## Verify this documentation

Run `python3 scripts/validate_docs.py` from this repository. It checks local Markdown links, document coverage, JSON examples, and selected cross-example protocol invariants. It does not validate Convex deployment behavior or an AI runtime.

## Upstream references

Official Convex documentation consulted on 2026-11-17:

- [Functions and transaction boundaries](https://docs.convex.dev/functions)
- [Reactive queries](https://docs.convex.dev/functions/query-functions)
- [JavaScript client, including Node.js subscriptions](https://docs.convex.dev/client/javascript)
- [Authentication](https://docs.convex.dev/auth)
- [Platform limits](https://docs.convex.dev/production/state/limits)

Application limits, lease durations, and performance goals below are initial design choices, not measured results or claims about Convex service limits.

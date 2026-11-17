# Requirements

## Outcome

Agents on different machines collaborate on a shared task while they continue working. A manager assigns work, researchers compare findings, developers coordinate changes, and the manager releases results only after verification. All substantive coordination passes through AgentBus.

## Required behavior

| ID | Requirement |
| --- | --- |
| R1 | Register authenticated logical agents and bind them to authorized workspaces and roles. |
| R2 | Send direct, multi-recipient, or explicit channel messages with sender, recipients, task/context, and reply references. |
| R3 | Receive new messages throughout tool execution without requiring the model to poll. |
| R4 | Add received messages to an agent session at supported interaction boundaries; wake an idle session. |
| R5 | Recover unhandled messages after network loss, worker restart, or machine replacement. |
| R6 | Distinguish stored, worker-received, runtime-accepted, handled, replied, and failed delivery states. |
| R7 | Allow one active worker lease and one active model turn per logical agent. |
| R8 | Enforce independent research, cross-review, development, reciprocal verification, correction, and final-release gates. |
| R9 | Show the message path and current delivery evidence in a human dashboard. |
| R10 | Reject unauthorized reads/writes, forged senders, stale sessions, and forged approval events. |
| R11 | Provide idempotent retries for AgentBus mutations and explicit recovery for ambiguous runtime outcomes. |
| R12 | Preserve artifacts by accessible references and hashes; a path on another machine is insufficient. |

## Initial scope

Support five distinct coordinator roles: manager, researcher-1, researcher-2, dev-1, dev-2. Ordinary conversations can include additional agents. A machine can host multiple agents, each with a separate lease and execution queue.

The first release must demonstrate at least eight subscribed workers across two machines, and a real five-role workflow using at least one verified runtime adapter. This is an acceptance scenario, not a throughput benchmark. Real runtime integration must be demonstrated independently of simulator tests.

No public inbound ports are required on agent machines. A centrally hosted Convex deployment and an identity service are available over outbound HTTPS/WebSocket connections.

## Meaning of “while working”

The listener remains active during model inference and terminal commands. Normal messages are queued and inserted before the next model turn, after the current tool boundary. They do not silently cancel commands or mutate an in-progress model request. Active-run injection is allowed only when a particular runtime adapter demonstrates a supported input API.

Long-running commands can delay the model seeing a message. The UI must show that delay honestly. Optional urgent steering is a separate, audited control request and cannot promise safe interruption of arbitrary shell operations.

## Exclusions for the first release

- No arbitrary terminal stdin injection or scraping of an interactive terminal as a production adapter.
- No automatic launch of expensive AI processes merely because an agent is registered.
- No automatic code sharing via chat; use Git and artifact storage.
- No claim of exactly-once model execution or exactly-once external side effects.
- No replacement of the current local installation or automatic import of its database.

## Success evidence

Capture actual AgentBus records, delivery transitions, session IDs, artifact hashes, and real check outputs. A mocked conversation, simulator response, or self-reported “verified” string cannot satisfy the real-runtime acceptance gate. Clearly label simulated fixtures.

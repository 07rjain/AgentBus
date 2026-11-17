# Worker and runtime adapter

## Worker lifecycle

1. Load deployment configuration and encrypted/OS-protected credential references. Open the local journal; validate its environment and agent identity.
2. Authenticate, acquire a fenced lease for each configured logical agent, and reconcile prior runtime sessions/dispatches.
3. Recover nonterminal central deliveries if local history is absent or incomplete. Subscribe to each agent's inbox head and drain outstanding pages into local durable storage.
4. Maintain a serialized runtime loop per agent while listener and lease renewal loops remain independent.
5. On shutdown, stop new dispatch, persist journal/outbox state, reconcile or mark active work as ambiguous, close subscriptions, and release leases when safe.

A supervisor restarts the worker after a crash. Registration never launches a model by itself. An explicit operator policy enables `launch`, `attach`, or `observe` for each adapter. Attach requires a supported session API; observe cannot claim to deliver messages.

## Local journal

Use local SQLite with appropriate durability settings, or an equivalent transactional journal. Tables: deployment metadata, inbox envelopes keyed by delivery ID, per-agent catch-up cursors, dispatch intents, runtime receipts, outbound operations keyed by request ID, and adapter session mappings. Credentials are held separately.

Commit an inbox page and its new cursor together. Then acknowledge receipt centrally. If an acknowledgment fails, retry; do not discard the local envelope. If the journal is lost, use central nonterminal recovery rather than trusting the last central received marker.

Before invoking the runtime, write a dispatch intent locally and register it centrally under the live lease. A restart between those steps reconciles by dispatch ID. A restart after runtime insertion but before central acknowledgment requires inspecting runtime receipts/history. If the runtime cannot establish the outcome, mark it unknown and require reconciliation or explicitly approved at-least-once reinsertion.

## Proposed adapter interface

The following TypeScript is a contract sketch, not implementation:

```ts
interface RuntimeAdapter {
  capabilities(): {
    start: boolean;
    resume: boolean;
    durableInputReceipts: boolean;
    activeRunInput: boolean;
    cancel: boolean;
    reconcileDispatch: boolean;
  };
  openSession(config: SessionConfig): Promise<SessionRef>;
  getState(session: SessionRef): Promise<RuntimeState>;
  enqueueInput(session: SessionRef, batch: EnvelopeBatch,
    dispatchId: string): Promise<InputReceipt>;
  runNextTurn(session: SessionRef): Promise<TurnOutcome>;
  reconcile(session: SessionRef, dispatchId: string): Promise<DispatchOutcome>;
  requestStop(session: SessionRef, reason: string): Promise<StopOutcome>;
  close(session: SessionRef): Promise<void>;
}
```

SessionConfig identifies repository, permissions, role, coordinator, tool facade, runtime/provider settings, and operator launch policy. Secret values are never part of an envelope. `InputReceipt` includes the session, dispatch ID, accepted delivery IDs, and a persistent runtime reference when available.

Some runtimes combine input insertion and starting a turn. Their adapter may implement `runNextTurn` as observation of the already-started turn, while preserving the same one-turn invariant and clearly documenting receipt timing. Never report `runtime_accepted` before there is evidence of insertion.

`TurnOutcome` distinguishes completed, awaiting input, canceled, failed, and unknown. A successful turn is not evidence that a task passed tests. AgentBus tool results and real artifacts supply task evidence.

## Execution loop

```text
listener:
  subscribe to inbox head
  when a new head is observed, mark drain dirty
  serialize catch-up; persist pages and cursor atomically
  retry receipt acknowledgments independently

agent loop:
  verify live lease and journal capacity
  reconcile unknown dispatches before starting conflicting work
  if an agent turn/tool is active, queue normal incoming messages
  otherwise select a bounded sequence-ordered batch
  persist dispatch intent; register it centrally
  insert envelopes through the supported adapter
  record accepted receipt; run or observe one turn
  record handled inputs only when that turn is known to complete
  continue assigned work or wait for relevant input
```

Do not start a new model turn for every subscription callback. Coalesce inputs, avoid sending the agent its own messages, and keep self-generated progress/presence events from creating infinite conversation loops. Control-plane events wake a runtime only when relevant to its task or role.

## Runtime behavior requirements

- Normal messages arrive as attributed conversation content at a documented boundary.
- The worker remains responsive during long commands. A synchronous SDK or blocked event loop must be isolated in a child process/thread if necessary.
- A task waiting on a reply yields; the worker monitors its inbox without repeatedly spending model calls.
- Only one process owns a logical agent's turn loop. A single machine can concurrently operate distinct agents.
- Token refresh and subscription recovery do not create a new runtime session unnecessarily.
- Loss of lease pauses new work. A still-running local command may need manual reconciliation after a takeover.
- Restarting/resuming must preserve agent role and task context without replaying messages as higher-priority instructions.

## First adapter proof

Pick one runtime with a documented programmatic session interface. Demonstrate: start a task, run a command, receive a peer message during it, insert the message afterward, reply via AgentBus, and resume the same task. Also demonstrate idle wake-up and an ambiguous crash.

Choose the actual SDK and version only after checking its current session/turn semantics. Do not claim all terminal-based agents support injection, resume, or safe interruption. If the chosen runtime lacks a suitable API, mark its adapter unsupported and choose another only with an explicit project decision.

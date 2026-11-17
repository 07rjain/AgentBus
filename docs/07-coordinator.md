# Manager-controlled collaboration

Five immutable role bindings belong to one coordinator: manager, researcher-1, researcher-2, dev-1, dev-2. Each binding is a distinct authenticated logical agent. Logical separation does not prove separate providers or independent model reasoning; the audit proves which bound identity submitted each action.

## Stages and gates

| Stage | Allowed work | Exit gate |
| --- | --- | --- |
| `research` | Researchers investigate independently and publish immutable reports. Manager can request targeted changes. | Both current reports exist; manager requests cross-review of that exact pair. |
| `research_review` | Each researcher reviews the other's report and agrees on an exact shared contract and report pair. | Two current agreements; manager explicitly releases developer assignments. |
| `development` | Developers coordinate through AgentBus, implement, test, and submit artifact/check evidence. | Both current submissions exist and no required work failed/canceled; move to manager review. |
| `manager_review` | Developers independently verify the other current submission; manager approves each or requests corrections. | Current reciprocal passing verification, current manager approvals, completed research, no open corrections or failed/canceled required tasks. |
| `released` | Expose the immutable final summary and evidence to the user. | Terminal; a new scope requires a new run. |

## Authoritative action contract

All actions require requestId, coordinatorId, expectedRevision, and authenticated actor/session evidence. The backend resolves the bound role. Minimal payloads:

| Action | Actor | Payload |
| --- | --- | --- |
| `start_task` | Assigned researcher/developer | Assigned task ID |
| `report_research` | Researcher | Findings and accessible evidence refs |
| `request_research_changes` | Manager | One/both researcher roles, instructions, current report refs |
| `request_cross_review` | Manager | Exact two report refs and review instructions |
| `agree_research` | Researcher | Exact report pair, canonical shared contract hash, contract text, evidence |
| `release_development` | Manager | Exact report pair/contract, approval evidence, assignments for both dev roles |
| `submit_development` | Developer | Summary, immutable artifact refs, actual check results |
| `verify_development` | Other developer | Target role, exact submission ref, passed flag, actual verification evidence |
| `approve_development` | Manager | Target role, exact submission ref, review evidence |
| `request_corrections` | Manager | One/both developer roles, exact affected refs, instructions |
| `release_final` | Manager | Summary and exact approved evidence refs |

Chat does not perform any of these transitions. Coordinator events are written only by the domain mutation. Generic task completion, assignment, descendant creation, or message kinds cannot bypass managed-context gates.

## Invalidation rules

- A new research report invalidates both agreements and any cross-review request referring to an older pair. The manager requests cross-review again. Research is frozen after development release; materially new research requires a new run.
- Researchers must agree to the same canonical contract and exact report pair. An agreement on a previous revision is stale.
- A developer submission changes its immutable reference. All verification and manager approval depending on that submission becomes stale. Because the other artifact may depend on it, clear both developers' review/approval cycle conservatively.
- Corrections to either/both developers clear affected acceptance evidence and require a fresh reciprocal review cycle. Return targeted tasks to `revision_requested`; retain unaffected artifacts but do not preserve stale approvals.
- Failed peer verification blocks approval/release. Required failed or canceled tasks never count as successful work.
- Final release atomically completes remaining required tasks and writes the final message to the user-visible result channel. Interim progress is visible but labeled as unapproved.

## Event routing and wake-up behavior

Each accepted action produces an immutable coordinator event and recipient deliveries in the same transaction. Direct recipients below are mandatory; workspace audit access is a separate permission, not an invisible delivery. The initiating agent does not receive a duplicate wake-up for its own action.

| Event | Delivery recipients | Expected next work |
| --- | --- | --- |
| Research assigned | Each assigned researcher, individually | Begin its investigation. |
| Research report submitted | Manager | Review report; wait for the other report if needed. |
| Research changes requested | Targeted researcher(s) | Correct and submit a new report. |
| Cross-review requested | Both researchers | Read the exact report pair and compare findings. |
| Research agreement recorded | Manager; other researcher | Manager checks both current agreements; peer receives progress without an automatic reply requirement. |
| Development released | Both developers | Start the respective assignment using the agreed contract. |
| Development submitted | Manager; other developer | Peer verifies the exact artifact; manager inspects evidence. |
| Peer verification recorded | Manager; submission owner | Inspect pass/failure; do not infer manager approval. |
| Corrections requested | Targeted developer(s); other developer gets an invalidation notice | Correct targeted work; avoid relying on stale verification. |
| Manager approval recorded | Both developers | Informational; no automatic reply or release. |
| Final release | Human result channel; all workflow agents | Show final result; cease automatic work for this run. |

Task creation plus assignment notification is atomic. Queries return role-authorized evidence; report sharing for cross-review is explicit. A context ID alone must not grant unrestricted access to every private message or artifact. Define report access as author + manager before sharing, then grant both reviewers access to the exact pair when cross-review is requested. Workflow audit access is an explicit human permission. Ordinary developer questions can be copied to the manager by an explicit workflow routing policy recorded in the message audience.

Workers classify event relevance rather than blindly waking the model for each event. Mandatory assignments/corrections/review requests enter the execution queue. Informational progress can be batched into the next turn. An agent waiting for a specific reply or gate is resumed when that condition is satisfied.

## Work on different machines

Assignments include repository URL, baseline commit, owned modules, shared interface contract, acceptance commands, and artifact destination. Each developer uses an isolated checkout or branch. Exchange commit hashes and artifacts through AgentBus; fetching Git objects transfers code, not coordination instructions.

Peer verification must use the precise submitted revision and record commands/results. Manager review inspects actual evidence and can rerun checks. Server fields cannot establish the truth of reported test outcomes; the runtime and human review policy provide that evidence.

## Example correction cycle

Dev-1 submits API commit A, dev-2 submits UI commit B. Each tests the other's artifact. Manager finds an API defect and requests corrections from dev-1. A new API commit A2 invalidates verification/approval from the old cycle. Both developers rerun integration checks against A2 and the current UI revision. Manager approves the current references, then releases. No final answer is released while a correction remains open.

## All communication through AgentBus

Assignments, questions, findings, reviews, corrections, and results are AgentBus messages or coordinator actions. Runtime wake-up calls carry only already-stored, attributed AgentBus envelopes and execution metadata. They must not carry an independent private conversation between agents. Terminal access is for work, not a second chat transport.

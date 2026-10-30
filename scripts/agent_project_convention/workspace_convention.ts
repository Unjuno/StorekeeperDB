import { list, object, openProjectStore } from "./convention.js"; // @persist @decision:project-runtime
import {
  initialDecisions, initialTasks, initialWorkspace,
  type TaskV2, type Workspace, type WorkspaceDecision,
  type WorkspaceWriterReport,
} from "./workspace_model.js";

export function runWorkspaceConvention(path: string): WorkspaceWriterReport {
  const initial = openProjectStore(path, { // @persist @decision:durable-declaration @decision:bootstrap-discovery
    __workspace: object(initialWorkspace()),
    tasks: list(initialTasks()),
    decisions: list(initialDecisions()),
  });
  initial.close(); // @persist @decision:project-lifecycle

  const reopened = openProjectStore(path, { // @persist @decision:durable-declaration @decision:compatible-state-evolution
    __workspace: object<Workspace>(initialWorkspace()),
    tasks: list<TaskV2>([]),
    decisions: list<WorkspaceDecision>([]),
  });
  if (reopened.state.tasks.length !== 2 ||
      reopened.state.decisions.length !== 1 ||
      reopened.state.__workspace.checkpoint.sequence !== 1) {
    throw new Error("convention candidate could not reopen V1 workspace");
  }
  const beforeTaskStatus = reopened.state.tasks[0]!.status;
  const beforeCheckpoint = reopened.state.__workspace.checkpoint.sequence;
  let rejected = false;
  try {
    reopened.state.tasks[0]!.status = "done"; // @persist @decision:multi-state-atomicity-gap
    throw new Error("injected failure before checkpoint advancement");
  } catch (e) {
    rejected = e instanceof Error && e.message.includes("injected failure");
  }
  reopened.close(); // @persist @decision:project-lifecycle

  const resumed = openProjectStore(path, { // @persist @decision:durable-declaration
    __workspace: object<Workspace>(initialWorkspace()),
    tasks: list<TaskV2>([]),
    decisions: list<WorkspaceDecision>([]),
  });
  const afterTaskStatus = resumed.state.tasks[0]?.status ?? "missing";
  const afterCheckpoint = resumed.state.__workspace.checkpoint.sequence;
  const failure = {
    rejected,
    beforeTaskStatus,
    afterTaskStatus,
    beforeCheckpoint,
    afterCheckpoint,
    atomicRollbackPreserved: rejected && afterTaskStatus === beforeTaskStatus && afterCheckpoint === beforeCheckpoint,
    partialCommitExposed: rejected && afterTaskStatus !== beforeTaskStatus && afterCheckpoint === beforeCheckpoint,
  };

  // The unchanged convention does not expose batch(): successful writes here are
  // sequential, so application-specific cross-state checkpoint atomicity is unresolved.
  resumed.state.tasks[0]!.status = "done"; // @persist @decision:multi-state-atomicity-gap
  resumed.state.tasks[1]!.labels = ["checkpoint"];
  resumed.state.decisions[0]!.status = "accepted";
  resumed.state.__workspace.checkpoint.sequence = 2; // @persist @decision:checkpoint-policy
  resumed.state.__workspace.checkpoint.acceptedDecisionCount = 1;
  resumed.state.__workspace.checkpoint.note = "writer completed checkpoint 2";

  const done = resumed.find(resumed.state.tasks, { status: "done" }); // @persist @decision:durable-query
  const finalCheckpoint = resumed.state.__workspace.checkpoint.sequence;
  const finalTaskStatus = resumed.state.tasks[0]!.status;
  const finalDecisionStatus = resumed.state.decisions[0]!.status;
  const optionalLabelsPersisted = resumed.state.tasks[1]?.labels?.[0] === "checkpoint";
  const pass = failure.partialCommitExposed && done.length === 1 &&
    done[0]?.id === "TASK-1" && finalCheckpoint === 2 &&
    finalTaskStatus === "done" && finalDecisionStatus === "accepted" &&
    optionalLabelsPersisted;
  resumed.close(); // @persist @decision:project-lifecycle
  return {
    phase: "writer", candidate: "convention", failure,
    finalCheckpoint, finalTaskStatus, finalDecisionStatus,
    optionalLabelsPersisted, pass,
  };
}

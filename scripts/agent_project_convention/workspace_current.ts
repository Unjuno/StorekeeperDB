import { StorekeeperDB } from "@storekeeper/db"; // @persist @decision:storekeeper-runtime
import {
  BOOTSTRAP_KEY, initialDecisions, initialTasks, initialWorkspace,
  type TaskV1, type TaskV2, type Workspace, type WorkspaceDecision,
  type WorkspaceWriterReport,
} from "./workspace_model.js";

export function runWorkspaceCurrent(path: string): WorkspaceWriterReport {
  let sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  sk.state<TaskV1[]>("tasks", initialTasks()); // @persist @decision:durable-state @decision:state-keying
  sk.state<WorkspaceDecision[]>("decisions", initialDecisions()); // @persist @decision:durable-state @decision:state-keying
  sk.state<Workspace[]>(BOOTSTRAP_KEY, [initialWorkspace()]); // @persist @decision:bootstrap-discovery @decision:singleton-list-adaptation
  sk.close(); // @persist @decision:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  const tasks = sk.state<TaskV2[]>("tasks", []); // @persist @decision:state-keying @decision:compatible-state-evolution
  const decisions = sk.state<WorkspaceDecision[]>("decisions", []); // @persist @decision:state-keying
  const workspace = sk.state<Workspace[]>(BOOTSTRAP_KEY, []); // @persist @decision:bootstrap-discovery @decision:singleton-list-adaptation
  if (tasks.length !== 2 || decisions.length !== 1 || workspace.length !== 1) {
    throw new Error("current candidate could not reopen V1 workspace");
  }

  const beforeTaskStatus = tasks[0]!.status;
  const beforeCheckpoint = workspace[0]!.checkpoint.sequence;
  let rejected = false;
  try {
    sk.batch(() => { // @persist @decision:multi-state-atomicity
      tasks[0]!.status = "done";
      throw new Error("injected failure before checkpoint advancement");
    });
  } catch (e) {
    rejected = e instanceof Error && e.message.includes("injected failure");
  }
  sk.close(); // @persist @decision:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  const resumedTasks = sk.state<TaskV2[]>("tasks", []); // @persist @decision:state-keying
  const resumedDecisions = sk.state<WorkspaceDecision[]>("decisions", []); // @persist @decision:state-keying
  const resumedWorkspace = sk.state<Workspace[]>(BOOTSTRAP_KEY, []); // @persist @decision:singleton-list-adaptation
  const afterTaskStatus = resumedTasks[0]?.status ?? "missing";
  const afterCheckpoint = resumedWorkspace[0]?.checkpoint.sequence ?? -1;
  const failure = {
    rejected,
    beforeTaskStatus,
    afterTaskStatus,
    beforeCheckpoint,
    afterCheckpoint,
    atomicRollbackPreserved: rejected && afterTaskStatus === beforeTaskStatus && afterCheckpoint === beforeCheckpoint,
    partialCommitExposed: rejected && afterTaskStatus !== beforeTaskStatus && afterCheckpoint === beforeCheckpoint,
  };

  sk.batch(() => { // @persist @decision:multi-state-atomicity @decision:checkpoint-policy
    resumedTasks[0]!.status = "done";
    resumedTasks[1]!.labels = ["checkpoint"];
    resumedDecisions[0]!.status = "accepted";
    resumedWorkspace[0]!.checkpoint.sequence = 2;
    resumedWorkspace[0]!.checkpoint.acceptedDecisionCount = 1;
    resumedWorkspace[0]!.checkpoint.note = "writer completed checkpoint 2";
  });

  const done = sk.find<TaskV2>("tasks", { status: "done" }); // @persist @decision:durable-query
  const finalCheckpoint = resumedWorkspace[0]!.checkpoint.sequence;
  const finalTaskStatus = resumedTasks[0]!.status;
  const finalDecisionStatus = resumedDecisions[0]!.status;
  const optionalLabelsPersisted = resumedTasks[1]?.labels?.[0] === "checkpoint";
  const pass = failure.atomicRollbackPreserved && done.length === 1 &&
    done[0]?.id === "TASK-1" && finalCheckpoint === 2 &&
    finalTaskStatus === "done" && finalDecisionStatus === "accepted" &&
    optionalLabelsPersisted;
  sk.close(); // @persist @decision:storekeeper-lifecycle
  return {
    phase: "writer", candidate: "current", failure,
    finalCheckpoint, finalTaskStatus, finalDecisionStatus,
    optionalLabelsPersisted, pass,
  };
}

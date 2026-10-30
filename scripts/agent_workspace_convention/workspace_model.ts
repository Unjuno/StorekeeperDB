export type WorkspaceStateRef = {
  role: "tasks" | "decisions";
  key: string;
  kind: "list";
};

export type WorkspaceManifest = {
  id: "workspace";
  schemaVersion: 1;
  currentGoal: string;
  activeTask: string;
  stateRefs: WorkspaceStateRef[];
  checkpoint: {
    sequence: number;
    note: string;
  };
};

export type TaskV1 = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
};

export type TaskV2 = TaskV1 & {
  tags?: string[];
};

export type Decision = {
  id: string;
  summary: string;
  status: "accepted" | "open";
};

export type WriterResult = {
  phase: "writer";
  candidate: "current" | "convention";
  checkpointSequence: number;
  taskStatus: string;
  compatibleMetadataPersisted: boolean;
  atomicRollbackPreserved?: boolean;
  splitDurableStateObserved?: boolean;
  finalStateCoherent: boolean;
  pass: boolean;
};

export type ReaderResult = {
  phase: "reader";
  candidate: "current" | "convention";
  bootstrapKey: string;
  discoveredStateKeys: string[];
  checkpointSequence: number;
  taskCount: number;
  acceptedDecisionCount: number;
  doneTaskCount: number;
  compatibleMetadataPersisted: boolean;
  pass: boolean;
};

export const BOOTSTRAP_KEY = "__workspace";

export const initialWorkspace = (): WorkspaceManifest => ({
  id: "workspace",
  schemaVersion: 1,
  currentGoal: "Resume an agent workspace from durable state",
  activeTask: "Complete checkpointed task",
  stateRefs: [
    { role: "tasks", key: "tasks", kind: "list" },
    { role: "decisions", key: "decisions", kind: "list" },
  ],
  checkpoint: {
    sequence: 0,
    note: "uninitialized",
  },
});

export const initialTask = (): TaskV1 => ({
  id: "TASK-1",
  title: "Validate resumable workspace",
  status: "doing",
});

export const initialDecision = (): Decision => ({
  id: "DECISION-1",
  summary: "Keep workspace discovery above the persistence core until evidence justifies a public API",
  status: "accepted",
});

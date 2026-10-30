export const BOOTSTRAP_KEY = "__workspace";

export type TaskV1 = {
  id: string;
  kind: "task";
  title: string;
  status: "open" | "done";
};

export type TaskV2 = TaskV1 & { labels?: string[] };

export type WorkspaceDecision = {
  id: string;
  kind: "decision";
  summary: string;
  status: "open" | "accepted";
};

export type Workspace = {
  id: "workspace";
  schemaVersion: 1;
  goal: string;
  activeTask: string;
  importantStateKeys: string[];
  checkpoint: {
    sequence: number;
    taskCount: number;
    acceptedDecisionCount: number;
    note: string;
  };
};

export type FailureProbe = {
  rejected: boolean;
  beforeTaskStatus: string;
  afterTaskStatus: string;
  beforeCheckpoint: number;
  afterCheckpoint: number;
  atomicRollbackPreserved: boolean;
  partialCommitExposed: boolean;
};

export type WorkspaceWriterReport = {
  phase: "writer";
  candidate: "current" | "convention";
  failure: FailureProbe;
  finalCheckpoint: number;
  finalTaskStatus: string;
  finalDecisionStatus: string;
  optionalLabelsPersisted: boolean;
  pass: boolean;
};

export const initialTasks = (): TaskV1[] => [
  { id: "TASK-1", kind: "task", title: "Fix nested lifecycle", status: "open" },
  { id: "TASK-2", kind: "task", title: "Resume from checkpoint", status: "open" },
];

export const initialDecisions = (): WorkspaceDecision[] => [
  {
    id: "DECISION-1",
    kind: "decision",
    summary: "Keep semantic migration policy explicit",
    status: "open",
  },
];

export const initialWorkspace = (): Workspace => ({
  id: "workspace",
  schemaVersion: 1,
  goal: "Resume agent-generated issue tracker from a durable checkpoint",
  activeTask: "TASK-2",
  importantStateKeys: ["tasks", "decisions"],
  checkpoint: {
    sequence: 1,
    taskCount: 2,
    acceptedDecisionCount: 0,
    note: "writer initialized",
  },
});

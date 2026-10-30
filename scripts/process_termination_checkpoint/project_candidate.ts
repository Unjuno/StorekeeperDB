import { writeFileSync } from "node:fs";
import { type Dict } from "@storekeeper/db";
import { list, object, type ListState } from "../agent_project_convention/convention.js";
import {
  BOOTSTRAP_KEY,
  initialDecision,
  initialTask,
  initialWorkspace,
  type Decision,
  type TaskV2,
} from "../agent_workspace_convention/workspace_model.js";
import { openProjectStoreWithBatch } from "../project_checkpoint_atomicity/transactional_convention.js";

type ReadResult = {
  candidate: "project";
  taskStatus: string;
  checkpointSequence: number;
  tagPreserved: boolean;
  doingCount: number;
  doneCount: number;
  acceptedDecisionCount: number;
};

const seed = (path: string): void => {
  const project = openProjectStoreWithBatch(path, {
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
    tasks: list<TaskV2>([initialTask()]),
    decisions: list<Decision>([initialDecision()]),
  });
  try {
    project.state[BOOTSTRAP_KEY].checkpoint.sequence = 1;
    project.state[BOOTSTRAP_KEY].checkpoint.note =
      "coherent baseline before termination";
    project.state.tasks[0]!.tags = ["checkpoint"];
    const doing = project.find(project.state.tasks, { status: "doing" });
    if (doing.length !== 1) throw new Error("project seed projection setup failed");
  } finally {
    project.close();
  }
};

const crash = (path: string, markerPath: string): never => {
  const project = openProjectStoreWithBatch(path, {
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
    tasks: list<TaskV2>([]),
    decisions: list<Decision>([]),
  });
  project.batch(() => {
    project.state.tasks[0]!.status = "done";
    writeFileSync(markerPath, "project-after-task-write", "utf8");
    process.exit(86);
  });
  throw new Error("project crash phase unexpectedly returned");
};

const commit = (path: string): void => {
  const project = openProjectStoreWithBatch(path, {
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
    tasks: list<TaskV2>([]),
    decisions: list<Decision>([]),
  });
  try {
    project.batch(() => {
      project.state.tasks[0]!.status = "done";
      project.state[BOOTSTRAP_KEY].checkpoint.sequence = 2;
      project.state[BOOTSTRAP_KEY].checkpoint.note =
        "committed after termination recovery";
    });
  } finally {
    project.close();
  }
};

const read = (path: string): ReadResult => {
  const bootstrap = openProjectStoreWithBatch(path, {
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
  });
  const stateRefs = bootstrap.state[BOOTSTRAP_KEY].stateRefs.map((ref) => ({ ...ref }));
  const checkpointSequence = bootstrap.state[BOOTSTRAP_KEY].checkpoint.sequence;
  bootstrap.close();

  const discoveredShape: Record<string, ListState<Dict>> = {};
  for (const ref of stateRefs) discoveredShape[ref.key] = list<Dict>([]);
  const project = openProjectStoreWithBatch(path, discoveredShape);
  try {
    const taskKey = stateRefs.find((ref) => ref.role === "tasks")?.key;
    const decisionKey = stateRefs.find((ref) => ref.role === "decisions")?.key;
    if (!taskKey || !decisionKey) throw new Error("workspace roles missing");

    const taskState = project.state[taskKey] as Array<Dict & { status?: string; tags?: unknown }>;
    const decisionState = project.state[decisionKey] as Dict[];
    const doing = project.find(taskState, { status: "doing" });
    const done = project.find(taskState, { status: "done" });
    const accepted = project.find(decisionState, { status: "accepted" });
    const task = taskState[0];

    return {
      candidate: "project",
      taskStatus: typeof task?.status === "string" ? task.status : "",
      checkpointSequence,
      tagPreserved: Array.isArray(task?.tags) && task.tags[0] === "checkpoint",
      doingCount: doing.length,
      doneCount: done.length,
      acceptedDecisionCount:
        decisionState.length === 1 ? accepted.length : -1,
    };
  } finally {
    project.close();
  }
};

const mode = process.argv[2];
const dbPath = process.argv[3];
const markerPath = process.argv[4];
if (!dbPath) throw new Error("project termination candidate requires database path");

if (mode === "--seed") {
  seed(dbPath);
  console.log(JSON.stringify({ candidate: "project", phase: "seed", pass: true }));
} else if (mode === "--crash") {
  if (!markerPath) throw new Error("project crash phase requires marker path");
  crash(dbPath, markerPath);
} else if (mode === "--commit") {
  commit(dbPath);
  console.log(JSON.stringify({ candidate: "project", phase: "commit", pass: true }));
} else if (mode === "--read") {
  console.log(JSON.stringify(read(dbPath)));
} else {
  throw new Error("project termination candidate requires --seed, --crash, --commit, or --read");
}

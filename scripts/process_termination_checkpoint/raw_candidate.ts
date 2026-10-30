import { writeFileSync } from "node:fs";
import { StorekeeperDB, type Dict } from "@storekeeper/db";
import {
  BOOTSTRAP_KEY,
  initialDecision,
  initialTask,
  initialWorkspace,
  type Decision,
  type TaskV2,
  type WorkspaceManifest,
} from "../agent_workspace_convention/workspace_model.js";

type ReadResult = {
  candidate: "raw";
  taskStatus: string;
  checkpointSequence: number;
  tagPreserved: boolean;
  doingCount: number;
  doneCount: number;
  acceptedDecisionCount: number;
};

const seed = (path: string): void => {
  const sk = new StorekeeperDB(path);
  try {
    const workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, [initialWorkspace()]);
    const tasks = sk.state<TaskV2[]>("tasks", [initialTask()]);
    sk.state<Decision[]>("decisions", [initialDecision()]);
    workspace[0]!.checkpoint.sequence = 1;
    workspace[0]!.checkpoint.note = "coherent baseline before termination";
    tasks[0]!.tags = ["checkpoint"];
    const doing = sk.find<TaskV2>("tasks", { status: "doing" });
    if (doing.length !== 1) throw new Error("raw seed projection setup failed");
  } finally {
    sk.close();
  }
};

const crash = (path: string, markerPath: string): never => {
  const sk = new StorekeeperDB(path);
  const tasks = sk.state<TaskV2[]>("tasks", []);
  sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []);
  sk.batch(() => {
    tasks[0]!.status = "done";
    writeFileSync(markerPath, "raw-after-task-write", "utf8");
    process.exit(86);
  });
  throw new Error("raw crash phase unexpectedly returned");
};

const commit = (path: string): void => {
  const sk = new StorekeeperDB(path);
  try {
    const workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []);
    const tasks = sk.state<TaskV2[]>("tasks", []);
    sk.batch(() => {
      tasks[0]!.status = "done";
      workspace[0]!.checkpoint.sequence = 2;
      workspace[0]!.checkpoint.note = "committed after termination recovery";
    });
  } finally {
    sk.close();
  }
};

const read = (path: string): ReadResult => {
  const sk = new StorekeeperDB(path);
  try {
    const workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []);
    const tasks = sk.state<TaskV2[]>("tasks", []);
    const decisions = sk.state<Decision[]>("decisions", []);
    const doing = sk.find<TaskV2>("tasks", { status: "doing" });
    const done = sk.find<TaskV2>("tasks", { status: "done" });
    const accepted = sk.find<Dict>("decisions", { status: "accepted" });
    return {
      candidate: "raw",
      taskStatus: tasks[0]?.status ?? "",
      checkpointSequence: workspace[0]?.checkpoint.sequence ?? -1,
      tagPreserved: tasks[0]?.tags?.[0] === "checkpoint",
      doingCount: doing.length,
      doneCount: done.length,
      acceptedDecisionCount:
        decisions.length === 1 ? accepted.length : -1,
    };
  } finally {
    sk.close();
  }
};

const mode = process.argv[2];
const dbPath = process.argv[3];
const markerPath = process.argv[4];
if (!dbPath) throw new Error("raw termination candidate requires database path");

if (mode === "--seed") {
  seed(dbPath);
  console.log(JSON.stringify({ candidate: "raw", phase: "seed", pass: true }));
} else if (mode === "--crash") {
  if (!markerPath) throw new Error("raw crash phase requires marker path");
  crash(dbPath, markerPath);
} else if (mode === "--commit") {
  commit(dbPath);
  console.log(JSON.stringify({ candidate: "raw", phase: "commit", pass: true }));
} else if (mode === "--read") {
  console.log(JSON.stringify(read(dbPath)));
} else {
  throw new Error("raw termination candidate requires --seed, --crash, --commit, or --read");
}

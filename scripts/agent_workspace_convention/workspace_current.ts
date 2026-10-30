import { StorekeeperDB, type Dict } from "@storekeeper/db"; // @persist @decision:storekeeper-runtime
import {
  BOOTSTRAP_KEY,
  initialDecision,
  initialTask,
  initialWorkspace,
  type Decision,
  type ReaderResult,
  type TaskV1,
  type TaskV2,
  type WorkspaceManifest,
  type WriterResult,
} from "./workspace_model.js";

const write = (path: string): WriterResult => {
  let sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  let workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, [initialWorkspace()]); // @persist @decision:durable-state @decision:bootstrap-key @decision:state-keying @decision:singleton-list-adaptation
  let tasks = sk.state<TaskV1[]>("tasks", [initialTask()]); // @persist @decision:durable-state @decision:state-keying
  sk.state<Decision[]>("decisions", [initialDecision()]); // @persist @decision:durable-state @decision:state-keying
  workspace[0]!.checkpoint.sequence = 1;
  workspace[0]!.checkpoint.note = "writer established durable workspace";
  sk.close(); // @persist @decision:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []); // @persist @decision:durable-state @decision:bootstrap-key @decision:state-keying @decision:singleton-list-adaptation @decision:compatible-state-evolution
  let evolvedTasks = sk.state<TaskV2[]>("tasks", []); // @persist @decision:durable-state @decision:state-keying @decision:compatible-state-evolution
  sk.state<Decision[]>("decisions", []); // @persist @decision:durable-state @decision:state-keying
  evolvedTasks[0]!.tags = ["checkpoint"];

  let injectedFailureRejected = false;
  try {
    sk.batch(() => { // @persist @decision:multi-state-atomicity
      evolvedTasks[0]!.status = "done";
      throw new Error("injected current checkpoint failure before checkpoint advance");
    });
  } catch (caught) {
    injectedFailureRejected =
      caught instanceof Error &&
      caught.message.includes("injected current checkpoint failure before checkpoint advance");
  }
  sk.close(); // @persist @decision:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []); // @persist @decision:durable-state @decision:bootstrap-key @decision:state-keying @decision:singleton-list-adaptation
  evolvedTasks = sk.state<TaskV2[]>("tasks", []); // @persist @decision:durable-state @decision:state-keying
  sk.state<Decision[]>("decisions", []); // @persist @decision:durable-state @decision:state-keying
  const atomicRollbackPreserved =
    injectedFailureRejected &&
    evolvedTasks[0]?.status === "doing" &&
    workspace[0]?.checkpoint.sequence === 1 &&
    evolvedTasks[0]?.tags?.[0] === "checkpoint";

  sk.batch(() => { // @persist @decision:multi-state-atomicity
    evolvedTasks[0]!.status = "done";
    workspace[0]!.checkpoint.sequence = 2;
    workspace[0]!.checkpoint.note = "task and checkpoint committed atomically";
  });

  const result: WriterResult = {
    phase: "writer",
    candidate: "current",
    checkpointSequence: workspace[0]!.checkpoint.sequence,
    taskStatus: evolvedTasks[0]!.status,
    compatibleMetadataPersisted: evolvedTasks[0]!.tags?.[0] === "checkpoint",
    atomicRollbackPreserved,
    finalStateCoherent:
      evolvedTasks[0]!.status === "done" &&
      workspace[0]!.checkpoint.sequence === 2,
    pass:
      atomicRollbackPreserved &&
      evolvedTasks[0]!.status === "done" &&
      workspace[0]!.checkpoint.sequence === 2,
  };
  sk.close(); // @persist @decision:storekeeper-lifecycle
  return result;
};

const read = (path: string): ReaderResult => {
  const sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  try {
    const workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []); // @persist @decision:durable-state @decision:bootstrap-key @decision:state-keying @decision:singleton-list-adaptation
    const manifest = workspace[0];
    if (!manifest) throw new Error("workspace bootstrap state missing");

    const discovered: Record<string, Dict[]> = {};
    for (const ref of manifest.stateRefs) {
      discovered[ref.key] = sk.state<Dict[]>(ref.key, []); // @persist @decision:durable-state @decision:state-keying
    }

    const taskKey = manifest.stateRefs.find((ref) => ref.role === "tasks")?.key;
    const decisionKey = manifest.stateRefs.find((ref) => ref.role === "decisions")?.key;
    if (!taskKey || !decisionKey) throw new Error("workspace roles missing");

    const doneTasks = sk.find<Dict>(taskKey, { status: "done" }); // @persist @decision:durable-query
    const acceptedDecisions = sk.find<Dict>(decisionKey, { status: "accepted" }); // @persist @decision:durable-query
    const task = discovered[taskKey]?.[0] as (Dict & { tags?: unknown }) | undefined;
    const compatibleMetadataPersisted =
      Array.isArray(task?.tags) && task.tags[0] === "checkpoint";
    const discoveredStateKeys = manifest.stateRefs.map((ref) => ref.key);

    const pass =
      manifest.currentGoal === "Resume an agent workspace from durable state" &&
      manifest.checkpoint.sequence === 2 &&
      discoveredStateKeys.length === 2 &&
      discoveredStateKeys.every((key) => discovered[key]?.length === 1) &&
      doneTasks.length === 1 &&
      acceptedDecisions.length === 1 &&
      compatibleMetadataPersisted;

    return {
      phase: "reader",
      candidate: "current",
      bootstrapKey: BOOTSTRAP_KEY,
      discoveredStateKeys,
      checkpointSequence: manifest.checkpoint.sequence,
      taskCount: discovered[taskKey]?.length ?? 0,
      acceptedDecisionCount: acceptedDecisions.length,
      doneTaskCount: doneTasks.length,
      compatibleMetadataPersisted,
      pass,
    };
  } finally {
    sk.close(); // @persist @decision:storekeeper-lifecycle
  }
};

const mode = process.argv[2];
const dbPath = process.argv[3];
if (!dbPath) throw new Error("workspace current candidate requires database path");

if (mode === "--writer") {
  const result = write(dbPath);
  console.log(JSON.stringify(result));
  if (!result.pass) process.exit(1);
} else if (mode === "--reader") {
  const result = read(dbPath);
  console.log(JSON.stringify(result));
  if (!result.pass) process.exit(1);
} else {
  throw new Error("workspace current candidate requires --writer or --reader");
}

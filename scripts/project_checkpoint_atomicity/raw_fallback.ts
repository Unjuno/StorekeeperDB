import { StorekeeperDB, type Dict } from "@storekeeper/db"; // @persist @decision:raw-storekeeper-fallback
import { list, object, openProjectStore, type ListState } from "../agent_project_convention/convention.js"; // @persist @decision:project-runtime
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
} from "../agent_workspace_convention/workspace_model.js";

const write = (path: string): WriterResult => {
  const projectV1 = openProjectStore(path, { // @persist @decision:durable-declaration @decision:bootstrap-key
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
    tasks: list<TaskV1>([initialTask()]),
    decisions: list<Decision>([initialDecision()]),
  });
  projectV1.state[BOOTSTRAP_KEY].checkpoint.sequence = 1;
  projectV1.state[BOOTSTRAP_KEY].checkpoint.note = "writer established durable workspace";
  projectV1.close(); // @persist @decision:project-lifecycle

  const projectV2 = openProjectStore(path, { // @persist @decision:durable-declaration @decision:bootstrap-key @decision:compatible-state-evolution
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
    tasks: list<TaskV2>([]),
    decisions: list<Decision>([]),
  });
  projectV2.state.tasks[0]!.tags = ["checkpoint"];
  projectV2.close(); // @persist @decision:project-lifecycle

  let sk = new StorekeeperDB(path); // @persist @decision:raw-runtime-lifecycle
  let workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []); // @persist @decision:state-keying @decision:singleton-list-adaptation
  let tasks = sk.state<TaskV2[]>("tasks", []); // @persist @decision:state-keying

  let injectedFailureRejected = false;
  try {
    sk.batch(() => { // @persist @decision:multi-state-atomicity
      tasks[0]!.status = "done";
      throw new Error("injected raw-fallback checkpoint failure before checkpoint advance");
    });
  } catch (caught) {
    injectedFailureRejected =
      caught instanceof Error &&
      caught.message.includes("injected raw-fallback checkpoint failure before checkpoint advance");
  }
  sk.close(); // @persist @decision:raw-runtime-lifecycle

  sk = new StorekeeperDB(path); // @persist @decision:raw-runtime-lifecycle
  workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []); // @persist @decision:state-keying @decision:singleton-list-adaptation
  tasks = sk.state<TaskV2[]>("tasks", []); // @persist @decision:state-keying
  const atomicRollbackPreserved =
    injectedFailureRejected &&
    tasks[0]?.status === "doing" &&
    workspace[0]?.checkpoint.sequence === 1 &&
    tasks[0]?.tags?.[0] === "checkpoint";

  sk.batch(() => { // @persist @decision:multi-state-atomicity
    tasks[0]!.status = "done";
    workspace[0]!.checkpoint.sequence = 2;
    workspace[0]!.checkpoint.note = "raw fallback committed atomic checkpoint";
  });

  const result: WriterResult = {
    phase: "writer",
    candidate: "current",
    checkpointSequence: workspace[0]!.checkpoint.sequence,
    taskStatus: tasks[0]!.status,
    compatibleMetadataPersisted: tasks[0]!.tags?.[0] === "checkpoint",
    atomicRollbackPreserved,
    finalStateCoherent:
      tasks[0]!.status === "done" &&
      workspace[0]!.checkpoint.sequence === 2,
    pass:
      atomicRollbackPreserved &&
      tasks[0]!.status === "done" &&
      workspace[0]!.checkpoint.sequence === 2,
  };
  sk.close(); // @persist @decision:raw-runtime-lifecycle
  return result;
};

const read = (path: string): ReaderResult => {
  const bootstrap = openProjectStore(path, { // @persist @decision:durable-declaration @decision:bootstrap-key
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
  });
  const manifest = bootstrap.state[BOOTSTRAP_KEY];
  const stateRefs = manifest.stateRefs.map((ref) => ({ ...ref }));
  const checkpointSequence = manifest.checkpoint.sequence;
  bootstrap.close(); // @persist @decision:project-lifecycle

  const discoveredShape: Record<string, ListState<Dict>> = {};
  for (const ref of stateRefs) discoveredShape[ref.key] = list<Dict>([]);
  const discovered = openProjectStore(path, discoveredShape); // @persist @decision:durable-declaration
  try {
    const taskKey = stateRefs.find((ref) => ref.role === "tasks")?.key;
    const decisionKey = stateRefs.find((ref) => ref.role === "decisions")?.key;
    if (!taskKey || !decisionKey) throw new Error("workspace roles missing");

    const taskState = discovered.state[taskKey] as Dict[];
    const decisionState = discovered.state[decisionKey] as Dict[];
    const doneTasks = discovered.find(taskState, { status: "done" }); // @persist @decision:durable-query
    const acceptedDecisions = discovered.find(decisionState, { status: "accepted" }); // @persist @decision:durable-query
    const task = taskState[0] as (Dict & { tags?: unknown }) | undefined;
    const compatibleMetadataPersisted =
      Array.isArray(task?.tags) && task.tags[0] === "checkpoint";

    const pass =
      checkpointSequence === 2 &&
      taskState.length === 1 &&
      decisionState.length === 1 &&
      doneTasks.length === 1 &&
      acceptedDecisions.length === 1 &&
      compatibleMetadataPersisted;

    return {
      phase: "reader",
      candidate: "current",
      bootstrapKey: BOOTSTRAP_KEY,
      discoveredStateKeys: stateRefs.map((ref) => ref.key),
      checkpointSequence,
      taskCount: taskState.length,
      acceptedDecisionCount: acceptedDecisions.length,
      doneTaskCount: doneTasks.length,
      compatibleMetadataPersisted,
      pass,
    };
  } finally {
    discovered.close(); // @persist @decision:project-lifecycle
  }
};

const mode = process.argv[2];
const dbPath = process.argv[3];
if (!dbPath) throw new Error("raw fallback candidate requires database path");

if (mode === "--writer") {
  const result = write(dbPath);
  console.log(JSON.stringify(result));
  if (!result.pass) process.exit(1);
} else if (mode === "--reader") {
  const result = read(dbPath);
  console.log(JSON.stringify(result));
  if (!result.pass) process.exit(1);
} else {
  throw new Error("raw fallback candidate requires --writer or --reader");
}

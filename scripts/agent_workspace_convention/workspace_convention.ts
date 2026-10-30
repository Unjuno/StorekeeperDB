import { type Dict } from "@storekeeper/db";
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
} from "./workspace_model.js";

const write = (path: string): WriterResult => {
  let project = openProjectStore(path, { // @persist @decision:durable-declaration @decision:bootstrap-key
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
    tasks: list<TaskV1>([initialTask()]),
    decisions: list<Decision>([initialDecision()]),
  });
  project.state[BOOTSTRAP_KEY].checkpoint.sequence = 1;
  project.state[BOOTSTRAP_KEY].checkpoint.note = "writer established durable workspace";
  project.close(); // @persist @decision:project-lifecycle

  project = openProjectStore(path, { // @persist @decision:durable-declaration @decision:bootstrap-key @decision:compatible-state-evolution
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
    tasks: list<TaskV2>([]),
    decisions: list<Decision>([]),
  });
  project.state.tasks[0]!.tags = ["checkpoint"];

  let injectedFailureRejected = false;
  try {
    project.state.tasks[0]!.status = "done";
    throw new Error("injected convention checkpoint failure before checkpoint advance");
  } catch (caught) {
    injectedFailureRejected =
      caught instanceof Error &&
      caught.message.includes("injected convention checkpoint failure before checkpoint advance");
  }
  project.close(); // @persist @decision:project-lifecycle

  project = openProjectStore(path, { // @persist @decision:durable-declaration @decision:bootstrap-key
    [BOOTSTRAP_KEY]: object(initialWorkspace()),
    tasks: list<TaskV2>([]),
    decisions: list<Decision>([]),
  });
  const splitDurableStateObserved =
    injectedFailureRejected &&
    project.state.tasks[0]?.status === "done" &&
    project.state[BOOTSTRAP_KEY].checkpoint.sequence === 1 &&
    project.state.tasks[0]?.tags?.[0] === "checkpoint";

  project.state[BOOTSTRAP_KEY].checkpoint.sequence = 2; // @persist @decision:checkpoint-recovery-policy
  project.state[BOOTSTRAP_KEY].checkpoint.note = "repaired checkpoint after split durable write";
  const result: WriterResult = {
    phase: "writer",
    candidate: "convention",
    checkpointSequence: project.state[BOOTSTRAP_KEY].checkpoint.sequence,
    taskStatus: project.state.tasks[0]!.status,
    compatibleMetadataPersisted: project.state.tasks[0]!.tags?.[0] === "checkpoint",
    splitDurableStateObserved,
    finalStateCoherent:
      project.state.tasks[0]!.status === "done" &&
      project.state[BOOTSTRAP_KEY].checkpoint.sequence === 2,
    pass:
      splitDurableStateObserved &&
      project.state.tasks[0]!.status === "done" &&
      project.state[BOOTSTRAP_KEY].checkpoint.sequence === 2,
  };
  project.close(); // @persist @decision:project-lifecycle
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
  for (const ref of stateRefs) {
    discoveredShape[ref.key] = list<Dict>([]);
  }
  const discoveredProject = openProjectStore(path, discoveredShape); // @persist @decision:durable-declaration
  try {
    const taskKey = stateRefs.find((ref) => ref.role === "tasks")?.key;
    const decisionKey = stateRefs.find((ref) => ref.role === "decisions")?.key;
    if (!taskKey || !decisionKey) throw new Error("workspace roles missing");

    const taskState = discoveredProject.state[taskKey] as Dict[];
    const decisionState = discoveredProject.state[decisionKey] as Dict[];
    const doneTasks = discoveredProject.find(taskState, { status: "done" }); // @persist @decision:durable-query
    const acceptedDecisions = discoveredProject.find(decisionState, { status: "accepted" }); // @persist @decision:durable-query
    const task = taskState[0] as (Dict & { tags?: unknown }) | undefined;
    const compatibleMetadataPersisted =
      Array.isArray(task?.tags) && task.tags[0] === "checkpoint";
    const discoveredStateKeys = stateRefs.map((ref) => ref.key);

    const pass =
      checkpointSequence === 2 &&
      discoveredStateKeys.length === 2 &&
      taskState.length === 1 &&
      decisionState.length === 1 &&
      doneTasks.length === 1 &&
      acceptedDecisions.length === 1 &&
      compatibleMetadataPersisted;

    return {
      phase: "reader",
      candidate: "convention",
      bootstrapKey: BOOTSTRAP_KEY,
      discoveredStateKeys,
      checkpointSequence,
      taskCount: taskState.length,
      acceptedDecisionCount: acceptedDecisions.length,
      doneTaskCount: doneTasks.length,
      compatibleMetadataPersisted,
      pass,
    };
  } finally {
    discoveredProject.close(); // @persist @decision:project-lifecycle
  }
};

const mode = process.argv[2];
const dbPath = process.argv[3];
if (!dbPath) throw new Error("workspace convention candidate requires database path");

if (mode === "--writer") {
  const result = write(dbPath);
  console.log(JSON.stringify(result));
  if (!result.pass) process.exit(1);
} else if (mode === "--reader") {
  const result = read(dbPath);
  console.log(JSON.stringify(result));
  if (!result.pass) process.exit(1);
} else {
  throw new Error("workspace convention candidate requires --writer or --reader");
}

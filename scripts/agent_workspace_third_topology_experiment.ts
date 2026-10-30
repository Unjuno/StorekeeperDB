import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db"; // @shared-persist @shared-decision:reader-runtime
import { BOOTSTRAP_KEY, type Workspace, type WorkspaceWriterReport } from "./agent_project_convention/workspace_model.js";
import { runWorkspaceCurrent } from "./agent_project_convention/workspace_current.js";
import { runWorkspaceConvention } from "./agent_project_convention/workspace_convention.js";

type ReaderReport = {
  phase: "reader";
  bootstrapKey: string;
  reason: string;
  discoveredKeys: string[];
  discoveredCounts: Record<string, number>;
  taskCount: number;
  acceptedDecisionCount: number;
  doneTaskMatches: number;
  optionalLabelRecovered: boolean;
  checkpointSequence: number;
  pass: boolean;
};

type DecisionProfile = { persistenceLines: number; decisions: string[]; decisionCount: number };
type FrameworkProfile = { publicConcepts: string[]; internalMechanisms: string[] };

const sameSorted = (a: string[], b: string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const physicalKeys = (path: string): string[] => {
  const db = new DatabaseSync(path);
  try {
    return (db.prepare("SELECT DISTINCT state_key FROM __sk_items ORDER BY state_key")
      .all() as Array<{ state_key: string }>).map((row) => row.state_key);
  } finally {
    db.close();
  }
};

function readWorkspace(path: string, bootstrapKey: string): ReaderReport {
  const sk = new StorekeeperDB(path); // @shared-persist @shared-decision:reader-lifecycle
  const empty = (reason: string): ReaderReport => ({
    phase: "reader", bootstrapKey, reason,
    discoveredKeys: [], discoveredCounts: {},
    taskCount: 0, acceptedDecisionCount: 0, doneTaskMatches: 0,
    optionalLabelRecovered: false, checkpointSequence: 0, pass: false,
  });
  try {
    const holder = sk.state<Workspace[]>(bootstrapKey, []); // @shared-persist @shared-decision:bootstrap-identity
    if (holder.length !== 1 || holder[0]?.id !== "workspace") {
      return empty("missing or ambiguous bootstrap workspace");
    }
    const workspace = holder[0]!;
    if (workspace.schemaVersion !== 1 || workspace.checkpoint.sequence !== 2) {
      return empty("incompatible bootstrap schema or incomplete checkpoint");
    }

    const discoveredKeys = [...workspace.importantStateKeys]; // @shared-persist @shared-decision:state-discovery
    if (discoveredKeys.length !== 2 ||
        new Set(discoveredKeys).size !== discoveredKeys.length ||
        discoveredKeys.includes(bootstrapKey)) {
      return empty("ambiguous or duplicate discovered state keys");
    }

    const discoveredCounts: Record<string, number> = {};
    let taskCount = 0;
    let acceptedDecisionCount = 0;
    let doneTaskMatches = 0;
    let optionalLabelRecovered = false;
    for (const stateKey of discoveredKeys) {
      const items = sk.state<Dict[]>(stateKey, []); // @shared-persist @shared-decision:reader-state-keying
      discoveredCounts[stateKey] = items.length;
      if (items.length > 0 && items[0]?.kind === "task") {
        taskCount += items.length;
        const found = sk.find<Dict>(stateKey, { status: "done" }); // @shared-persist @shared-decision:reader-query
        doneTaskMatches += found.length;
        optionalLabelRecovered = items.some((item) =>
          item.id === "TASK-2" && Array.isArray(item.labels) && item.labels.includes("checkpoint"));
      } else if (items.length > 0 && items[0]?.kind === "decision") {
        acceptedDecisionCount += items.filter((item) => item.status === "accepted").length;
      } else {
        return empty("unexpected discovered state type");
      }
    }

    const pass =
      workspace.goal === "Resume agent-generated issue tracker from a durable checkpoint" &&
      workspace.activeTask === "TASK-2" &&
      workspace.checkpoint.taskCount === taskCount &&
      workspace.checkpoint.acceptedDecisionCount === acceptedDecisionCount &&
      taskCount === 2 && acceptedDecisionCount === 1 &&
      doneTaskMatches === 1 && optionalLabelRecovered &&
      sameSorted(Object.keys(discoveredCounts), discoveredKeys) &&
      sameSorted(physicalKeys(path), [bootstrapKey, ...discoveredKeys]);

    return {
      phase: "reader", bootstrapKey, reason: pass ? "" : "checkpoint or state discovery mismatch",
      discoveredKeys, discoveredCounts, taskCount, acceptedDecisionCount,
      doneTaskMatches, optionalLabelRecovered,
      checkpointSequence: workspace.checkpoint.sequence, pass,
    };
  } finally {
    sk.close(); // @shared-persist @shared-decision:reader-lifecycle
  }
}

const phase = process.argv[2];
const suppliedPath = process.argv[3];
if (phase === "--writer-current" || phase === "--writer-convention") {
  if (!suppliedPath) throw new Error("writer requires database path");
  const result = phase === "--writer-current"
    ? runWorkspaceCurrent(suppliedPath)
    : runWorkspaceConvention(suppliedPath);
  console.log(JSON.stringify(result));
  process.exit(result.pass ? 0 : 1);
}
if (phase === "--reader") {
  if (!suppliedPath || !process.argv[4]) throw new Error("reader requires database path and bootstrap key");
  console.log(JSON.stringify(readWorkspace(suppliedPath, process.argv[4]!)));
  process.exit(0);
}

const markerProfile = (path: string, marker: string, decisionPattern: RegExp): DecisionProfile => {
  const lines = readFileSync(path, "utf8").split("\n");
  const persistenceLines = lines.filter((line) => line.includes(marker));
  const decisions = [...new Set(persistenceLines.flatMap((line) =>
    [...line.matchAll(decisionPattern)].map((match) => match[1]!)))].sort();
  return { persistenceLines: persistenceLines.length, decisions, decisionCount: decisions.length };
};

const frameworkProfile = (): FrameworkProfile => {
  const source = readFileSync("scripts/agent_project_convention/convention.ts", "utf8");
  return {
    publicConcepts: [...new Set([...source.matchAll(/@framework-public:([a-z0-9-]+)/g)].map((x) => x[1]!))].sort(),
    internalMechanisms: [...new Set([...source.matchAll(/@framework-internal:([a-z0-9-]+)/g)].map((x) => x[1]!))].sort(),
  };
};

const scriptPath = process.argv[1];
if (!scriptPath) throw new Error("workspace experiment requires its compiled script path");

const root = mkdtempSync(join(tmpdir(), "sk-workspace-third-topology-"));
let validExperiment = false;
try {
  const runProcess = <T>(args: string[]): T =>
    JSON.parse(execFileSync(process.execPath,
      ["--experimental-sqlite", scriptPath, ...args], { encoding: "utf8" }).trim()) as T;

  const cases = {
    current: join(root, "current.sqlite"),
    convention: join(root, "convention.sqlite"),
  };
  const currentWriter = runProcess<WorkspaceWriterReport>(["--writer-current", cases.current]);
  const conventionWriter = runProcess<WorkspaceWriterReport>(["--writer-convention", cases.convention]);
  const currentReader = runProcess<ReaderReport>(["--reader", cases.current, BOOTSTRAP_KEY]);
  const conventionReader = runProcess<ReaderReport>(["--reader", cases.convention, BOOTSTRAP_KEY]);
  const wrongKeyReader = runProcess<ReaderReport>(["--reader", cases.convention, "__missing_workspace"]);
  const stateKeys = {
    current: physicalKeys(cases.current),
    convention: physicalKeys(cases.convention),
  };

  const profiles = {
    current: markerProfile("scripts/agent_project_convention/workspace_current.ts",
      "@persist", /@decision:([a-z0-9-]+)/g),
    convention: markerProfile("scripts/agent_project_convention/workspace_convention.ts",
      "@persist", /@decision:([a-z0-9-]+)/g),
    sharedReader: markerProfile("scripts/agent_workspace_third_topology_experiment.ts",
      "@shared-persist", /@shared-decision:([a-z0-9-]+)/g),
    framework: frameworkProfile(),
  };

  const currentAtomic = currentWriter.failure.atomicRollbackPreserved &&
    !currentWriter.failure.partialCommitExposed;
  const conventionGap = conventionWriter.failure.partialCommitExposed &&
    !conventionWriter.failure.atomicRollbackPreserved;
  const bootstrapNegativeControl = !wrongKeyReader.pass &&
    wrongKeyReader.reason === "missing or ambiguous bootstrap workspace" &&
    sameSorted(physicalKeys(cases.convention), stateKeys.convention);
  const noSecondRegistry = sameSorted(stateKeys.current, [BOOTSTRAP_KEY, "tasks", "decisions"]) &&
    sameSorted(stateKeys.convention, [BOOTSTRAP_KEY, "tasks", "decisions"]);
  const independentProcesses = currentWriter.phase === "writer" &&
    conventionWriter.phase === "writer" &&
    currentReader.phase === "reader" && conventionReader.phase === "reader";
  const finalRuntimeValid = currentWriter.pass && conventionWriter.pass &&
    currentReader.pass && conventionReader.pass &&
    independentProcesses && noSecondRegistry && bootstrapNegativeControl;
  const reduction = profiles.current.decisionCount - profiles.convention.decisionCount;
  const fewerPersistenceLines = profiles.current.persistenceLines > profiles.convention.persistenceLines;
  const removedStateKeyAndSingletonDecisions =
    profiles.current.decisions.includes("state-keying") &&
    profiles.current.decisions.includes("singleton-list-adaptation") &&
    !profiles.convention.decisions.includes("state-keying") &&
    !profiles.convention.decisions.includes("singleton-list-adaptation");

  validExperiment = finalRuntimeValid && currentAtomic && conventionGap &&
    profiles.framework.publicConcepts.length === 2 &&
    profiles.sharedReader.persistenceLines > 0;

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : reduction > 0 && fewerPersistenceLines && removedStateKeyAndSingletonDecisions
      ? "MIXED_CONVENTION_REDUCES_DECISIONS_BUT_CHECKPOINT_ATOMICITY_GAP"
      : "REJECT_NO_THIRD_TOPOLOGY_REDUCTION";

  console.log(JSON.stringify({
    experiment: "agent-workspace-third-topology-cross-process",
    issue: 84,
    environment: { node: process.versions.node, backend: "node:sqlite", flag: "--experimental-sqlite", writerReaderProcesses: 4 },
    candidates: {
      current: { writer: currentWriter, reader: currentReader },
      convention: { writer: conventionWriter, reader: conventionReader },
    },
    negativeControl: { wrongKeyReader },
    physical: { stateKeys, noSecondRegistry },
    profiles,
    comparison: {
      reduction, fewerPersistenceLines, removedStateKeyAndSingletonDecisions,
      currentAtomic, conventionGap, bootstrapNegativeControl,
      independentProcesses, finalRuntimeValid,
      sharedReaderCostCountedSeparately: true,
      frameworkCostCountedSeparately: true,
    },
    decision, validExperiment,
    interpretation: "Convention removes declaration/keying ceremony in a third topology, but its unchanged surface cannot atomically commit a task mutation with checkpoint advancement. Bootstrap discovery is still an explicit application convention.",
    uncertainty: {
      actualAgentRunUntested: true,
      concurrentWritersUntested: true,
      crashTimingUntested: true,
      manifestBindingIntegrationUntested: true,
      checkpointRepairPolicyUntested: true,
      browserStorageUntested: true,
      resultIsMarkerCountNotHiddenReasoning: true,
    },
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (!validExperiment) process.exit(1);

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { ReaderResult, WriterResult } from "./agent_workspace_convention/workspace_model.js";

type DecisionProfile = {
  persistenceLines: number;
  decisions: string[];
  decisionCount: number;
};

type FrameworkProfile = {
  publicConcepts: string[];
  publicConceptCount: number;
  internalMechanisms: string[];
  internalMechanismCount: number;
};

type CandidateRuntime = {
  writer: WriterResult;
  reader: ReaderResult;
  physicalStateKeys: string[];
  registryLikeStateKeys: string[];
  secondPersistentRegistryAbsent: boolean;
};

const uniqueMarkers = (lines: string[], pattern: RegExp): string[] =>
  [...new Set(lines.flatMap((line) => [...line.matchAll(pattern)].map((match) => match[1]!)))].sort();

const decisionProfile = (path: string): DecisionProfile => {
  const lines = readFileSync(path, "utf8").split("\n");
  const persistenceLines = lines.filter((line) => line.includes("@persist"));
  const decisions = uniqueMarkers(persistenceLines, /@decision:([a-z0-9-]+)/g);
  return {
    persistenceLines: persistenceLines.length,
    decisions,
    decisionCount: decisions.length,
  };
};

const frameworkProfile = (path: string): FrameworkProfile => {
  const lines = readFileSync(path, "utf8").split("\n");
  const publicConcepts = uniqueMarkers(lines, /@framework-public:([a-z0-9-]+)/g);
  const internalMechanisms = uniqueMarkers(lines, /@framework-internal:([a-z0-9-]+)/g);
  return {
    publicConcepts,
    publicConceptCount: publicConcepts.length,
    internalMechanisms,
    internalMechanismCount: internalMechanisms.length,
  };
};

const physicalKeys = (path: string): { stateKeys: string[]; registryLike: string[] } => {
  const db = new DatabaseSync(path);
  try {
    const rows = db.prepare(
      "SELECT DISTINCT state_key FROM __sk_items ORDER BY state_key",
    ).all() as Array<{ state_key: string }>;
    const stateKeys = rows.map((row) => row.state_key);
    return {
      stateKeys,
      registryLike: stateKeys.filter((key) => key.startsWith("__")),
    };
  } finally {
    db.close();
  }
};

const runCandidate = (
  candidate: "current" | "convention",
  scriptPath: string,
  dbPath: string,
): CandidateRuntime => {
  const writerOutput = execFileSync(
    process.execPath,
    ["--experimental-sqlite", scriptPath, "--writer", dbPath],
    { encoding: "utf8", stdio: "pipe" },
  );
  const writer = JSON.parse(writerOutput.trim()) as WriterResult;

  const readerOutput = execFileSync(
    process.execPath,
    ["--experimental-sqlite", scriptPath, "--reader", dbPath],
    { encoding: "utf8", stdio: "pipe" },
  );
  const reader = JSON.parse(readerOutput.trim()) as ReaderResult;
  const physical = physicalKeys(dbPath);
  const secondPersistentRegistryAbsent =
    physical.registryLike.length === 1 &&
    physical.registryLike[0] === "__workspace";

  if (writer.candidate !== candidate || reader.candidate !== candidate) {
    throw new Error(`candidate identity mismatch for ${candidate}`);
  }

  return {
    writer,
    reader,
    physicalStateKeys: physical.stateKeys,
    registryLikeStateKeys: physical.registryLike,
    secondPersistentRegistryAbsent,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-agent-workspace-convention-"));
let validExperiment = false;

try {
  const runtime = {
    current: runCandidate(
      "current",
      "dist/scripts/agent_workspace_convention/workspace_current.js",
      join(root, "current.sqlite"),
    ),
    convention: runCandidate(
      "convention",
      "dist/scripts/agent_workspace_convention/workspace_convention.js",
      join(root, "convention.sqlite"),
    ),
  };

  const profiles = {
    current: decisionProfile("scripts/agent_workspace_convention/workspace_current.ts"),
    convention: decisionProfile("scripts/agent_workspace_convention/workspace_convention.ts"),
    framework: frameworkProfile("scripts/agent_project_convention/convention.ts"),
  };

  const currentRuntimeValid =
    runtime.current.writer.pass &&
    runtime.current.reader.pass &&
    runtime.current.writer.atomicRollbackPreserved === true &&
    runtime.current.secondPersistentRegistryAbsent;

  const conventionRuntimeValid =
    runtime.convention.writer.pass &&
    runtime.convention.reader.pass &&
    runtime.convention.writer.splitDurableStateObserved === true &&
    runtime.convention.secondPersistentRegistryAbsent;

  const sameDiscovery =
    JSON.stringify([...runtime.current.reader.discoveredStateKeys].sort()) ===
    JSON.stringify([...runtime.convention.reader.discoveredStateKeys].sort());

  const decisionReduction =
    profiles.current.decisionCount - profiles.convention.decisionCount;
  const persistenceLineReduction =
    profiles.current.persistenceLines - profiles.convention.persistenceLines;
  const stateKeyDecisionRemoved =
    !profiles.convention.decisions.includes("state-keying");
  const singletonDecisionRemoved =
    !profiles.convention.decisions.includes("singleton-list-adaptation");
  const bootstrapRemainsExplicit =
    profiles.current.decisions.includes("bootstrap-key") &&
    profiles.convention.decisions.includes("bootstrap-key");
  const atomicityBoundaryExposed =
    runtime.current.writer.atomicRollbackPreserved === true &&
    runtime.convention.writer.splitDurableStateObserved === true;

  validExperiment =
    currentRuntimeValid &&
    conventionRuntimeValid &&
    sameDiscovery &&
    bootstrapRemainsExplicit;

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : decisionReduction > 0 &&
        stateKeyDecisionRemoved &&
        singletonDecisionRemoved &&
        atomicityBoundaryExposed
      ? "MIXED_CONVENTION_REDUCES_DECISIONS_BUT_CHECKPOINT_ATOMICITY_GAP"
      : decisionReduction > 0 &&
          stateKeyDecisionRemoved &&
          singletonDecisionRemoved
        ? "CANDIDATE_PASS_THIRD_TOPOLOGY_REDUCES_PERSISTENCE_DECISIONS"
        : "REJECT_NO_THIRD_TOPOLOGY_REDUCTION";

  console.log(JSON.stringify({
    experiment: "agent-workspace-checkpoint-project-convention",
    issue: 84,
    processBoundary: "writer and reader are separate Node processes for both candidates",
    bootstrapContract: "reader starts with database path plus explicit __workspace bootstrap key",
    metric: {
      decisionMarker: "@decision:<stable-id>",
      persistenceMarker: "@persist",
      limitation:
        "Counts auditable implementation obligations in candidate source. It does not inspect or claim access to hidden model reasoning.",
    },
    runtime,
    profiles,
    comparison: {
      decisionReduction,
      persistenceLineReduction,
      stateKeyDecisionRemoved,
      singletonDecisionRemoved,
      bootstrapRemainsExplicit,
      atomicityBoundaryExposed,
      sameDiscovery,
      frameworkPublicConceptsReportedSeparately: true,
      helperChangedForThisTopology: false,
    },
    decision,
    validExperiment,
    interpretation:
      decision === "MIXED_CONVENTION_REDUCES_DECISIONS_BUT_CHECKPOINT_ATOMICITY_GAP"
        ? "The unchanged generic project convention reduced per-prototype persistence decisions in a third topology and supported cross-process discovery without a second persistent registry, but its public surface does not expose an atomic multi-state checkpoint boundary. A task write can durably commit before checkpoint advancement, so recovery policy remains explicit."
        : decision === "CANDIDATE_PASS_THIRD_TOPOLOGY_REDUCES_PERSISTENCE_DECISIONS"
          ? "The unchanged generic project convention reduced per-prototype persistence decisions in a third topology while preserving cross-process discovery and checkpoint correctness."
          : decision === "REJECT_NO_THIRD_TOPOLOGY_REDUCTION"
            ? "The third topology did not replicate the earlier reduction in per-prototype persistence decisions."
            : "The runtime, discovery, bootstrap, or instrumentation conditions did not establish a valid experiment.",
    uncertainty: {
      processKillVsThrownFailureUntested: true,
      powerLossUntested: true,
      concurrentWritersUntested: true,
      versionSkewUntested: true,
      incompatibleMigrationUntested: true,
      browserRemoteStorageUntested: true,
      publicWorkspaceApiAuthorized: false,
      publicAtomicProjectBatchApiAuthorized: false,
    },
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

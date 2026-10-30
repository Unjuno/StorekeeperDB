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
  return { persistenceLines: persistenceLines.length, decisions, decisionCount: decisions.length };
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
  expectedCandidate: "current" | "convention",
  scriptPath: string,
  dbPath: string,
): CandidateRuntime => {
  const writer = JSON.parse(execFileSync(
    process.execPath,
    ["--experimental-sqlite", scriptPath, "--writer", dbPath],
    { encoding: "utf8", stdio: "pipe" },
  ).trim()) as WriterResult;

  const reader = JSON.parse(execFileSync(
    process.execPath,
    ["--experimental-sqlite", scriptPath, "--reader", dbPath],
    { encoding: "utf8", stdio: "pipe" },
  ).trim()) as ReaderResult;

  if (writer.candidate !== expectedCandidate || reader.candidate !== expectedCandidate) {
    throw new Error(`candidate identity mismatch for ${expectedCandidate}`);
  }

  const physical = physicalKeys(dbPath);
  return {
    writer,
    reader,
    physicalStateKeys: physical.stateKeys,
    registryLikeStateKeys: physical.registryLike,
    secondPersistentRegistryAbsent:
      physical.registryLike.length === 1 &&
      physical.registryLike[0] === "__workspace",
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-project-checkpoint-atomicity-"));
let validExperiment = false;

try {
  const runtime = {
    rawFallback: runCandidate(
      "current",
      "dist/scripts/project_checkpoint_atomicity/raw_fallback.js",
      join(root, "raw-fallback.sqlite"),
    ),
    projectBatch: runCandidate(
      "convention",
      "dist/scripts/project_checkpoint_atomicity/project_batch.js",
      join(root, "project-batch.sqlite"),
    ),
  };

  const profiles = {
    rawFallback: decisionProfile("scripts/project_checkpoint_atomicity/raw_fallback.ts"),
    projectBatch: decisionProfile("scripts/project_checkpoint_atomicity/project_batch.ts"),
    baseFramework: frameworkProfile("scripts/agent_project_convention/convention.ts"),
    batchFrameworkDelta: frameworkProfile("scripts/project_checkpoint_atomicity/transactional_convention.ts"),
  };

  const rawRuntimeValid =
    runtime.rawFallback.writer.pass &&
    runtime.rawFallback.reader.pass &&
    runtime.rawFallback.writer.atomicRollbackPreserved === true &&
    runtime.rawFallback.secondPersistentRegistryAbsent;

  const batchRuntimeValid =
    runtime.projectBatch.writer.pass &&
    runtime.projectBatch.reader.pass &&
    runtime.projectBatch.writer.atomicRollbackPreserved === true &&
    runtime.projectBatch.secondPersistentRegistryAbsent;

  const sameDiscovery =
    JSON.stringify([...runtime.rawFallback.reader.discoveredStateKeys].sort()) ===
    JSON.stringify([...runtime.projectBatch.reader.discoveredStateKeys].sort());

  const decisionReduction =
    profiles.rawFallback.decisionCount - profiles.projectBatch.decisionCount;
  const persistenceLineReduction =
    profiles.rawFallback.persistenceLines - profiles.projectBatch.persistenceLines;
  const rawFallbackReintroducesStateKeying =
    profiles.rawFallback.decisions.includes("state-keying");
  const rawFallbackReintroducesSingletonAdaptation =
    profiles.rawFallback.decisions.includes("singleton-list-adaptation");
  const projectBatchAvoidsRawFallback =
    !profiles.projectBatch.decisions.includes("raw-storekeeper-fallback") &&
    !profiles.projectBatch.decisions.includes("state-keying") &&
    !profiles.projectBatch.decisions.includes("singleton-list-adaptation");
  const bothExposeAtomicityDecision =
    profiles.rawFallback.decisions.includes("multi-state-atomicity") &&
    profiles.projectBatch.decisions.includes("multi-state-atomicity");
  const exactlyOneIncrementalFrameworkConcept =
    profiles.batchFrameworkDelta.publicConceptCount === 1 &&
    profiles.batchFrameworkDelta.publicConcepts[0] === "project-batch";

  validExperiment =
    rawRuntimeValid &&
    batchRuntimeValid &&
    sameDiscovery &&
    bothExposeAtomicityDecision;

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : decisionReduction > 0 &&
        persistenceLineReduction > 0 &&
        rawFallbackReintroducesStateKeying &&
        rawFallbackReintroducesSingletonAdaptation &&
        projectBatchAvoidsRawFallback &&
        exactlyOneIncrementalFrameworkConcept
      ? "CANDIDATE_PREFER_THIN_PROJECT_BATCH_ESCAPE_HATCH"
      : decisionReduction <= 0
        ? "MIXED_ATOMICITY_FIXED_BUT_NO_DECISION_ADVANTAGE"
        : "REJECT_PROJECT_BATCH_ADDS_COMPLEXITY_WITHOUT_BENEFIT";

  console.log(JSON.stringify({
    experiment: "project-level-atomic-checkpoint-escape-hatch",
    issue: 87,
    sourceFinding: "#84 / CI #312 checkpoint atomicity gap",
    runtime,
    profiles,
    comparison: {
      decisionReduction,
      persistenceLineReduction,
      rawFallbackReintroducesStateKeying,
      rawFallbackReintroducesSingletonAdaptation,
      projectBatchAvoidsRawFallback,
      bothExposeAtomicityDecision,
      exactlyOneIncrementalFrameworkConcept,
      sameDiscovery,
      StorekeeperDBCoreChanged: false,
      publicExportsChanged: false,
    },
    decision,
    validExperiment,
    interpretation:
      decision === "CANDIDATE_PREFER_THIN_PROJECT_BATCH_ESCAPE_HATCH"
        ? "Both candidates restored exact multi-state checkpoint rollback and fresh-reader recovery. Raw StorekeeperDB fallback reintroduced state-key/singleton/runtime ceremony, while one experiment-only project batch delegation kept the hard atomicity decision explicit with fewer per-prototype persistence obligations."
        : decision === "MIXED_ATOMICITY_FIXED_BUT_NO_DECISION_ADVANTAGE"
          ? "Both candidates restored atomicity, but the thin project batch surface did not reduce per-prototype persistence obligations relative to raw fallback."
          : decision === "REJECT_PROJECT_BATCH_ADDS_COMPLEXITY_WITHOUT_BENEFIT"
            ? "The project batch candidate added framework complexity without satisfying the measured simplification criteria."
            : "The runtime, discovery, rollback, or instrumentation conditions did not establish a valid comparison.",
    uncertainty: {
      thrownFailureOnly: true,
      processKillUntested: true,
      powerLossUntested: true,
      concurrentWritersUntested: true,
      versionSkewUntested: true,
      callbackLifecycleCandidateUntested: true,
      publicProjectBatchApiAuthorized: false,
    },
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

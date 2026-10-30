import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const EXPECTED_DECISION =
  "CANDIDATE_PREFER_THIN_PROJECT_BATCH_ESCAPE_HATCH";

test("project checkpoint atomicity comparison stays on the observed candidate contract", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-sqlite", "dist/scripts/project_checkpoint_atomicity_experiment.js"],
    { encoding: "utf8" },
  );
  const report = JSON.parse(stdout) as {
    decision: string;
    validExperiment: boolean;
    runtime: {
      rawFallback: {
        writer: { pass: boolean; atomicRollbackPreserved?: boolean };
        reader: { pass: boolean; checkpointSequence: number };
        secondPersistentRegistryAbsent: boolean;
      };
      projectBatch: {
        writer: { pass: boolean; atomicRollbackPreserved?: boolean };
        reader: { pass: boolean; checkpointSequence: number };
        secondPersistentRegistryAbsent: boolean;
      };
    };
    profiles: {
      rawFallback: { persistenceLines: number; decisionCount: number; decisions: string[] };
      projectBatch: { persistenceLines: number; decisionCount: number; decisions: string[] };
      batchFrameworkDelta: { publicConceptCount: number; publicConcepts: string[] };
    };
    comparison: {
      decisionReduction: number;
      persistenceLineReduction: number;
      rawFallbackReintroducesStateKeying: boolean;
      rawFallbackReintroducesSingletonAdaptation: boolean;
      projectBatchAvoidsRawFallback: boolean;
      bothExposeAtomicityDecision: boolean;
      exactlyOneIncrementalFrameworkConcept: boolean;
      sameDiscovery: boolean;
      StorekeeperDBCoreChanged: boolean;
      publicExportsChanged: boolean;
    };
  };

  assert.equal(report.decision, EXPECTED_DECISION);
  assert.equal(report.validExperiment, true);

  assert.equal(report.runtime.rawFallback.writer.pass, true);
  assert.equal(report.runtime.rawFallback.writer.atomicRollbackPreserved, true);
  assert.equal(report.runtime.rawFallback.reader.pass, true);
  assert.equal(report.runtime.rawFallback.reader.checkpointSequence, 2);
  assert.equal(report.runtime.rawFallback.secondPersistentRegistryAbsent, true);

  assert.equal(report.runtime.projectBatch.writer.pass, true);
  assert.equal(report.runtime.projectBatch.writer.atomicRollbackPreserved, true);
  assert.equal(report.runtime.projectBatch.reader.pass, true);
  assert.equal(report.runtime.projectBatch.reader.checkpointSequence, 2);
  assert.equal(report.runtime.projectBatch.secondPersistentRegistryAbsent, true);

  assert.equal(report.profiles.rawFallback.decisionCount, 11);
  assert.equal(report.profiles.projectBatch.decisionCount, 7);
  assert.equal(report.profiles.rawFallback.persistenceLines, 22);
  assert.equal(report.profiles.projectBatch.persistenceLines, 15);

  assert.equal(report.comparison.decisionReduction, 4);
  assert.equal(report.comparison.persistenceLineReduction, 7);
  assert.equal(report.comparison.rawFallbackReintroducesStateKeying, true);
  assert.equal(report.comparison.rawFallbackReintroducesSingletonAdaptation, true);
  assert.equal(report.comparison.projectBatchAvoidsRawFallback, true);
  assert.equal(report.comparison.bothExposeAtomicityDecision, true);
  assert.equal(report.comparison.exactlyOneIncrementalFrameworkConcept, true);
  assert.equal(report.comparison.sameDiscovery, true);
  assert.equal(report.comparison.StorekeeperDBCoreChanged, false);
  assert.equal(report.comparison.publicExportsChanged, false);

  assert.deepEqual(report.profiles.batchFrameworkDelta.publicConcepts, ["project-batch"]);
  assert.equal(report.profiles.batchFrameworkDelta.publicConceptCount, 1);
  assert.equal(report.profiles.rawFallback.decisions.includes("state-keying"), true);
  assert.equal(
    report.profiles.rawFallback.decisions.includes("singleton-list-adaptation"),
    true,
  );
  assert.equal(
    report.profiles.projectBatch.decisions.includes("raw-storekeeper-fallback"),
    false,
  );
});

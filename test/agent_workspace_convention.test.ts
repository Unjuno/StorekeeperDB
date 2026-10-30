import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const EXPECTED_DECISION =
  "MIXED_CONVENTION_REDUCES_DECISIONS_BUT_CHECKPOINT_ATOMICITY_GAP";

test("agent workspace convention keeps the observed third-topology MIXED contract", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-sqlite", "dist/scripts/agent_workspace_convention_experiment.js"],
    { encoding: "utf8" },
  );
  const report = JSON.parse(stdout) as {
    decision: string;
    validExperiment: boolean;
    runtime: {
      current: {
        writer: { pass: boolean; atomicRollbackPreserved?: boolean };
        reader: { pass: boolean; checkpointSequence: number };
        secondPersistentRegistryAbsent: boolean;
      };
      convention: {
        writer: { pass: boolean; splitDurableStateObserved?: boolean };
        reader: { pass: boolean; checkpointSequence: number };
        secondPersistentRegistryAbsent: boolean;
      };
    };
    profiles: {
      current: { persistenceLines: number; decisionCount: number; decisions: string[] };
      convention: { persistenceLines: number; decisionCount: number; decisions: string[] };
      framework: { publicConceptCount: number };
    };
    comparison: {
      decisionReduction: number;
      persistenceLineReduction: number;
      stateKeyDecisionRemoved: boolean;
      singletonDecisionRemoved: boolean;
      bootstrapRemainsExplicit: boolean;
      atomicityBoundaryExposed: boolean;
      sameDiscovery: boolean;
      helperChangedForThisTopology: boolean;
    };
  };

  assert.equal(report.decision, EXPECTED_DECISION);
  assert.equal(report.validExperiment, true);

  assert.equal(report.runtime.current.writer.pass, true);
  assert.equal(report.runtime.current.writer.atomicRollbackPreserved, true);
  assert.equal(report.runtime.current.reader.pass, true);
  assert.equal(report.runtime.current.reader.checkpointSequence, 2);
  assert.equal(report.runtime.current.secondPersistentRegistryAbsent, true);

  assert.equal(report.runtime.convention.writer.pass, true);
  assert.equal(report.runtime.convention.writer.splitDurableStateObserved, true);
  assert.equal(report.runtime.convention.reader.pass, true);
  assert.equal(report.runtime.convention.reader.checkpointSequence, 2);
  assert.equal(report.runtime.convention.secondPersistentRegistryAbsent, true);

  assert.equal(report.profiles.current.decisionCount, 9);
  assert.equal(report.profiles.convention.decisionCount, 7);
  assert.equal(report.profiles.current.persistenceLines, 24);
  assert.equal(report.profiles.convention.persistenceLines, 14);
  assert.equal(report.profiles.framework.publicConceptCount, 2);

  assert.equal(report.comparison.decisionReduction, 2);
  assert.equal(report.comparison.persistenceLineReduction, 10);
  assert.equal(report.comparison.stateKeyDecisionRemoved, true);
  assert.equal(report.comparison.singletonDecisionRemoved, true);
  assert.equal(report.comparison.bootstrapRemainsExplicit, true);
  assert.equal(report.comparison.atomicityBoundaryExposed, true);
  assert.equal(report.comparison.sameDiscovery, true);
  assert.equal(report.comparison.helperChangedForThisTopology, false);

  assert.equal(report.profiles.convention.decisions.includes("state-keying"), false);
  assert.equal(
    report.profiles.convention.decisions.includes("singleton-list-adaptation"),
    false,
  );
  assert.equal(
    report.profiles.convention.decisions.includes("checkpoint-recovery-policy"),
    true,
  );
});

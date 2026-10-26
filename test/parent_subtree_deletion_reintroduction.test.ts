import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const EXPECTED_DECISION =
  "REPLICATION_PASS_PARENT_SUBTREE_DELETE_REINTRODUCTION_COHERENT";

const EXPECTED_CHECKS: Record<string, boolean> = {
  initialTopologyValid: true,
  deleteTrapReached: true,
  exactPhysicalRollback: true,
  loadedMemoryRollback: true,
  failureAuditRolledBack: true,
  deleteSuccessRejected: false,
  deleteSourceCorrect: true,
  deleteProjectionCorrect: true,
  prefixNeighborPreserved: true,
  identityStableAfterDelete: true,
  deleteWriteShapeExpected: true,
  staleChildWriteRejected: true,
  staleChildLocalTargetMutated: false,
  staleChildDidNotResurrect: true,
  staleChildWriteHadPersistenceSideEffects: false,
  deleteQueriesCorrect: true,
  firstReopenCorrect: true,
  reintroductionRejected: false,
  reintroductionSourceCorrect: true,
  reintroductionProjectionCorrect: true,
  noDuplicateProjectionCells: true,
  reintroductionWriteShapeExpected: true,
  reintroductionQueriesCorrect: true,
  secondReopenCorrect: true,
  metadataLifecycleCoherent: true,
  expectedItemLocalWriteShape: true,
  currentStateCorrect: true,
  validExperiment: true,
};

test("parent subtree lifecycle stays on the fixed PASS contract", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-sqlite", "dist/scripts/parent_subtree_deletion_reintroduction_experiment.js"],
    { encoding: "utf8" },
  );
  const report = JSON.parse(stdout) as {
    decision: string;
    checks: Record<string, boolean>;
  };

  console.log(JSON.stringify({ capturedDecision: report.decision }));

  assert.equal(report.decision, EXPECTED_DECISION, "parent subtree product decision regressed");
  assert.equal(
    Object.keys(report.checks).sort().join(","),
    Object.keys(EXPECTED_CHECKS).sort().join(","),
    "parent subtree check set changed; inspect and update the contract explicitly",
  );
  for (const [name, expected] of Object.entries(EXPECTED_CHECKS)) {
    assert.equal(report.checks[name], expected, `unexpected checks.${name}`);
  }
});

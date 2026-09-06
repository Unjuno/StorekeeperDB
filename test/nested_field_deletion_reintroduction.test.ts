import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const EXPECTED_DECISION = "REPLICATION_PASS_NESTED_DELETE_REINTRODUCTION_COHERENT";

const EXPECTED_TRUE_CHECKS = [
  "initialTopologyValid",
  "deleteTrapReached",
  "exactPhysicalRollback",
  "loadedMemoryRollback",
  "failureAuditRolledBack",
  "deleteSourceCorrect",
  "deleteProjectionCorrect",
  "deleteQueriesCorrect",
  "identityStableAfterDelete",
  "firstReopenSourceCorrect",
  "firstReopenProjectionCorrect",
  "identityStableAfterFirstReopen",
  "reintroductionSourceCorrect",
  "reintroductionProjectionCorrect",
  "noDuplicateProjectionCells",
  "reintroductionQueriesCorrect",
  "identityStableAfterReintroduction",
  "secondReopenCorrect",
  "metadataLifecycleCoherent",
  "deleteWriteShapeExpected",
  "reintroductionWriteShapeExpected",
  "expectedItemLocalWriteShape",
  "currentStateCorrect",
  "queriesAndHandlesCorrect",
  "identityAndReopenCorrect",
  "validExperiment",
] as const;

const EXPECTED_FALSE_CHECKS = [
  "deleteSuccessRejected",
  "reintroductionRejected",
] as const;

test("nested field deletion and reintroduction stays on the observed PASS contract", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-sqlite", "dist/scripts/nested_field_deletion_reintroduction_experiment.js"],
    { encoding: "utf8" },
  );
  const report = JSON.parse(stdout) as {
    decision: string;
    checks: Record<string, boolean>;
  };

  console.log(JSON.stringify({ capturedDecision: report.decision }));

  assert.equal(
    report.decision,
    EXPECTED_DECISION,
    `nested lifecycle decision regressed: ${report.decision}`,
  );

  for (const key of EXPECTED_TRUE_CHECKS) {
    assert.equal(report.checks[key], true, `expected checks.${key} to stay true`);
  }
  for (const key of EXPECTED_FALSE_CHECKS) {
    assert.equal(report.checks[key], false, `expected checks.${key} to stay false`);
  }
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const KNOWN_DECISIONS = new Set([
  "REPLICATION_PASS_NESTED_DELETE_REINTRODUCTION_COHERENT",
  "MIXED_NESTED_LIFECYCLE_CORRECT_WITH_METADATA_OR_WRITE_ROUGHNESS",
  "FAIL_NESTED_DELETE_OR_REINTRODUCTION_CORRUPTS_CURRENT_STATE",
]);

test("nested field deletion and reintroduction emits a valid decision", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-sqlite", "dist/scripts/nested_field_deletion_reintroduction_experiment.js"],
    { encoding: "utf8" },
  );
  const report = JSON.parse(stdout) as {
    decision: string;
    checks: { validExperiment: boolean };
  };

  console.log(JSON.stringify({ capturedDecision: report.decision }));
  assert.equal(report.checks.validExperiment, true);
  assert.equal(KNOWN_DECISIONS.has(report.decision), true, `unexpected decision: ${report.decision}`);
});

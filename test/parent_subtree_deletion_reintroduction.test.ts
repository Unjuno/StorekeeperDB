import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const KNOWN_DECISIONS = new Set([
  "REPLICATION_PASS_PARENT_SUBTREE_DELETE_REINTRODUCTION_COHERENT",
  "MIXED_PARENT_SUBTREE_CURRENT_STATE_CORRECT_BUT_STALE_CHILD_WRITE_ACCEPTED",
  "FAIL_PARENT_SUBTREE_DELETE_OR_STALE_HANDLE_CORRUPTS_CURRENT_STATE",
]);

test("parent subtree deletion experiment emits a valid product decision", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-sqlite", "dist/scripts/parent_subtree_deletion_reintroduction_experiment.js"],
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

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("nested field deletion and reintroduction decision stays exact", () => {
  const scriptPath = fileURLToPath(
    new URL("../scripts/nested_field_deletion_reintroduction_experiment.js", import.meta.url),
  );
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-sqlite", scriptPath],
    { encoding: "utf8" },
  );
  const report = JSON.parse(stdout) as {
    decision: string;
    checks: { validExperiment: boolean };
  };

  assert.equal(report.checks.validExperiment, true);
  assert.equal(
    report.decision,
    "REPLICATION_PASS_NESTED_DELETE_REINTRODUCTION_COHERENT",
  );
});

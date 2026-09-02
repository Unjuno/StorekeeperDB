import assert from "node:assert/strict";
import { test } from "node:test";

test("nested field deletion and reintroduction decision stays exact", async () => {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
    originalLog(...args);
  };

  try {
    await import("../scripts/nested_field_deletion_reintroduction_experiment.js");
  } finally {
    console.log = originalLog;
  }

  const reportText = output.find((line) =>
    line.includes('"experiment": "nested-field-deletion-reintroduction-projection-lifecycle"'),
  );
  assert.ok(reportText, "experiment JSON report was not emitted");

  const report = JSON.parse(reportText) as {
    decision: string;
    checks: { validExperiment: boolean };
  };

  assert.equal(report.checks.validExperiment, true);
  assert.equal(
    report.decision,
    "FAIL_NESTED_DELETE_OR_REINTRODUCTION_CORRUPTS_CURRENT_STATE",
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const decision =
  "MIXED_PARTIAL_ROW_DELETE_REBUILDS_ITEM_PROJECTIONS_BUT_STAYS_CORRECT";

test("partial-row field-deletion result stays synchronized with public docs", () => {
  const resultDoc = readFileSync("docs/PARTIAL_ROW_FIELD_DELETION_EXPERIMENT.md", "utf8");
  const docsIndex = readFileSync("docs/README.md", "utf8");
  const nextWork = readFileSync("docs/NEXT_WORK.md", "utf8");

  assert.ok(resultDoc.includes("MIXED in CI #252"));
  assert.ok(resultDoc.includes(decision));
  assert.ok(resultDoc.includes("item-local rather than cell-selective"));
  assert.ok(docsIndex.includes("PARTIAL_ROW_FIELD_DELETION_EXPERIMENT.md"));
  assert.ok(nextWork.includes(decision));
  assert.ok(nextWork.includes("MEASURED_LINEAR_ITEM_REBUILD_WRITES_TIMING_OBSERVATIONAL"));
  assert.ok(nextWork.includes("Test nested field deletion before optimizing projection maintenance"));
});

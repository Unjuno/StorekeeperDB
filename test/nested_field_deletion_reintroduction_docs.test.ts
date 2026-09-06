import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const decision = "REPLICATION_PASS_NESTED_DELETE_REINTRODUCTION_COHERENT";

test("nested field lifecycle result stays synchronized with public docs", () => {
  const resultDoc = readFileSync(
    "docs/NESTED_FIELD_DELETION_REINTRODUCTION_EXPERIMENT.md",
    "utf8",
  );
  const docsIndex = readFileSync("docs/README.md", "utf8");
  const nextWork = readFileSync("docs/NEXT_WORK.md", "utf8");

  assert.ok(resultDoc.includes("CI #280"));
  assert.ok(resultDoc.includes(decision));
  assert.ok(resultDoc.includes("The regression test now requires that exact decision"));
  assert.ok(docsIndex.includes("NESTED_FIELD_DELETION_REINTRODUCTION_EXPERIMENT.md"));
  assert.ok(nextWork.includes(decision));
  assert.ok(nextWork.includes("projected parent/subtree deletion remains unproven"));
});

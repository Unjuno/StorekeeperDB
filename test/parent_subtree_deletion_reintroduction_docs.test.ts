import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const MIXED = "MIXED_PARENT_SUBTREE_CURRENT_STATE_CORRECT_BUT_STALE_CHILD_WRITE_ACCEPTED";

test("parent subtree MIXED result and next work stay synchronized", () => {
  const doc = readFileSync("docs/PARENT_SUBTREE_DELETION_REINTRODUCTION_EXPERIMENT.md", "utf8");
  const index = readFileSync("docs/README.md", "utf8");
  const next = readFileSync("docs/NEXT_WORK.md", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.ok(doc.includes("MIXED in CI #287"));
  assert.ok(doc.includes(MIXED));
  assert.ok(doc.includes("four actual row operations"));
  assert.ok(doc.includes("Stale child write rejected"));
  assert.ok(index.includes("PARENT_SUBTREE_DELETION_REINTRODUCTION_EXPERIMENT.md"));
  assert.ok(next.includes(MIXED));
  assert.ok(next.includes("REPLICATION_PASS_PARENT_SUBTREE_DELETE_REINTRODUCTION_COHERENT"));
  assert.ok(doc.includes("FIXED in CI #300"));
  assert.ok(next.includes("third, agent-workspace topology"));
  assert.ok(pkg.scripts?.["release:check"]?.includes("experiment:parent-subtree-lifecycle:check"));
  assert.ok(pkg.scripts?.["experiment:parent-subtree-lifecycle:check"]);
});

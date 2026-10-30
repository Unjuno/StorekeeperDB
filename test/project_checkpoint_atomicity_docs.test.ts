import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const decision = "CANDIDATE_PREFER_THIN_PROJECT_BATCH_ESCAPE_HATCH";

test("project checkpoint atomicity result stays synchronized with public docs", () => {
  const resultDoc = readFileSync(
    "docs/PROJECT_CHECKPOINT_ATOMICITY_EXPERIMENT.md",
    "utf8",
  );
  const docsIndex = readFileSync("docs/README.md", "utf8");
  const nextWork = readFileSync("docs/NEXT_WORK.md", "utf8");
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const packageJson = readFileSync("package.json", "utf8");

  assert.ok(resultDoc.includes("CANDIDATE in CI #323"));
  assert.ok(resultDoc.includes(decision));
  assert.ok(resultDoc.includes("| raw StorekeeperDB fallback | 22 | 11 |"));
  assert.ok(resultDoc.includes("| thin project batch | 15 | 7 |"));
  assert.ok(resultDoc.includes("project-batch"));
  assert.ok(resultDoc.includes("No public `project.batch()`"));

  assert.ok(docsIndex.includes("PROJECT_CHECKPOINT_ATOMICITY_EXPERIMENT.md"));

  assert.ok(nextWork.includes(decision));
  assert.ok(
    nextWork.includes(
      "Test process-termination checkpoint durability before authorizing a project transaction surface",
    ),
  );

  assert.ok(changelog.includes(decision));
  assert.ok(changelog.includes("11 decision categories / 22 persistence lines"));
  assert.ok(changelog.includes("7 decisions / 15 lines"));

  assert.ok(packageJson.includes("experiment:project-checkpoint-atomicity:check"));
  assert.ok(
    packageJson.includes(
      "npm run experiment:agent-workspace-convention:check && npm run experiment:project-checkpoint-atomicity:check",
    ),
  );
});

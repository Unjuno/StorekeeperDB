import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const decision =
  "MIXED_CONVENTION_REDUCES_DECISIONS_BUT_CHECKPOINT_ATOMICITY_GAP";

test("agent workspace convention result stays synchronized with public docs", () => {
  const resultDoc = readFileSync(
    "docs/AGENT_WORKSPACE_CONVENTION_EXPERIMENT.md",
    "utf8",
  );
  const docsIndex = readFileSync("docs/README.md", "utf8");
  const nextWork = readFileSync("docs/NEXT_WORK.md", "utf8");
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const packageJson = readFileSync("package.json", "utf8");

  assert.ok(resultDoc.includes("MIXED in CI #312"));
  assert.ok(resultDoc.includes(decision));
  assert.ok(resultDoc.includes("decision categories: 9 -> 7"));
  assert.ok(resultDoc.includes("persistence lines:   24 -> 14"));
  assert.ok(resultDoc.includes("splitDurableStateObserved = true"));
  assert.ok(resultDoc.includes("No public API change is authorized"));

  assert.ok(docsIndex.includes("AGENT_WORKSPACE_CONVENTION_EXPERIMENT.md"));

  assert.ok(nextWork.includes(decision));
  assert.ok(nextWork.includes("Probe the smallest project-level atomic checkpoint escape hatch"));
  assert.ok(nextWork.includes("cross-process bootstrap without a second registry replicated in #84"));

  assert.ok(changelog.includes(decision));
  assert.ok(changelog.includes("9 decisions / 24 persistence lines"));
  assert.ok(changelog.includes("7 decisions / 14 lines"));

  assert.ok(packageJson.includes("experiment:agent-workspace-convention:check"));
  assert.ok(
    packageJson.includes(
      "npm run experiment:agent-project-convention:check && npm run experiment:agent-workspace-convention:check",
    ),
  );
});

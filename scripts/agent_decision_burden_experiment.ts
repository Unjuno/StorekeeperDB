import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRelationalDecisionBurden } from "./agent_decision_burden/relational.js";
import { runJsonBlobDecisionBurden } from "./agent_decision_burden/json_blob.js";
import { runStorekeeperDecisionBurden } from "./agent_decision_burden/storekeeper.js";

type SourceProfile = {
  persistenceLines: number;
  decisions: string[];
  decisionCount: number;
};

const profileSource = (path: string): SourceProfile => {
  const lines = readFileSync(path, "utf8").split("\n");
  const persistenceLines = lines.filter((line) => line.includes("@persist"));
  const decisions = [...new Set(
    persistenceLines.flatMap((line) => [...line.matchAll(/@decision:([a-z0-9-]+)/g)].map((match) => match[1]!)),
  )].sort();
  return { persistenceLines: persistenceLines.length, decisions, decisionCount: decisions.length };
};

const root = mkdtempSync(join(tmpdir(), "sk-agent-decision-burden-"));
let validExperiment = false;

try {
  const runtime = {
    relational: runRelationalDecisionBurden(join(root, "relational.sqlite")),
    jsonBlob: runJsonBlobDecisionBurden(join(root, "json-blob.sqlite")),
    storekeeper: runStorekeeperDecisionBurden(join(root, "storekeeper.sqlite")),
  };

  const profiles = {
    relational: profileSource("scripts/agent_decision_burden/relational.ts"),
    jsonBlob: profileSource("scripts/agent_decision_burden/json_blob.ts"),
    storekeeper: profileSource("scripts/agent_decision_burden/storekeeper.ts"),
  };

  const runtimeValid = Object.values(runtime).every((result) =>
    result.pass &&
    result.urgentOpen === 1 &&
    result.reopenedTasks === 2 &&
    result.settingsReopened &&
    result.evolvedShapePersisted,
  );

  const strongestBaselineDecisionCount = Math.min(profiles.relational.decisionCount, profiles.jsonBlob.decisionCount);
  const strongestBaselinePersistenceLines = Math.min(profiles.relational.persistenceLines, profiles.jsonBlob.persistenceLines);
  const fewerPersistenceDecisions = profiles.storekeeper.decisionCount < strongestBaselineDecisionCount;
  const lowerPersistenceSurface = profiles.storekeeper.persistenceLines < strongestBaselinePersistenceLines;
  const singletonAdaptationVisible = profiles.storekeeper.decisions.includes("singleton-list-adaptation");

  const decision = !runtimeValid
    ? "INVALID_RUNTIME"
    : fewerPersistenceDecisions
      ? "CANDIDATE_PASS_FEWER_PERSISTENCE_DECISIONS"
      : lowerPersistenceSurface
        ? "MIXED_LOWER_CODE_SURFACE_ONLY"
        : "FAIL_NO_DECISION_BURDEN_ADVANTAGE";

  validExperiment = runtimeValid;

  console.log(JSON.stringify({
    experiment: "agent-persistence-decision-burden",
    issue: 46,
    scenario: "local project board V1 -> V2 with task collection + singleton settings",
    metric: {
      kind: "auditable decision-burden proxy",
      decisionMarker: "@decision:<stable-id>",
      persistenceMarker: "@persist",
      limitation: "This counts explicit persistence-specific design obligations in implementation artifacts; it does not inspect or claim access to model chain-of-thought.",
    },
    runtime,
    profiles,
    comparison: {
      strongestBaselineDecisionCount,
      storekeeperDecisionCount: profiles.storekeeper.decisionCount,
      strongestBaselinePersistenceLines,
      storekeeperPersistenceLines: profiles.storekeeper.persistenceLines,
      fewerPersistenceDecisions,
      lowerPersistenceSurface,
      singletonAdaptationVisible,
    },
    decision,
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

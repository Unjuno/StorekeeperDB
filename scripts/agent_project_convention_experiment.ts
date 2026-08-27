import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runStorekeeperDecisionBurden } from "./agent_decision_burden/storekeeper.js";
import { runBoardConvention } from "./agent_project_convention/board_convention.js";
import { runEditorCurrent } from "./agent_project_convention/editor_current.js";
import { runEditorConvention } from "./agent_project_convention/editor_convention.js";

type DecisionProfile = {
  persistenceLines: number;
  decisions: string[];
  decisionCount: number;
};

type FrameworkProfile = {
  publicConcepts: string[];
  publicConceptCount: number;
  internalMechanisms: string[];
  internalMechanismCount: number;
};

const uniqueMarkers = (lines: string[], pattern: RegExp): string[] =>
  [...new Set(lines.flatMap((line) => [...line.matchAll(pattern)].map((match) => match[1]!)))].sort();

const decisionProfile = (path: string): DecisionProfile => {
  const lines = readFileSync(path, "utf8").split("\n");
  const persistenceLines = lines.filter((line) => line.includes("@persist"));
  const decisions = uniqueMarkers(persistenceLines, /@decision:([a-z0-9-]+)/g);
  return { persistenceLines: persistenceLines.length, decisions, decisionCount: decisions.length };
};

const frameworkProfile = (path: string): FrameworkProfile => {
  const lines = readFileSync(path, "utf8").split("\n");
  const publicConcepts = uniqueMarkers(lines, /@framework-public:([a-z0-9-]+)/g);
  const internalMechanisms = uniqueMarkers(lines, /@framework-internal:([a-z0-9-]+)/g);
  return {
    publicConcepts,
    publicConceptCount: publicConcepts.length,
    internalMechanisms,
    internalMechanismCount: internalMechanisms.length,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-agent-project-convention-"));
let validExperiment = false;

try {
  const runtime = {
    board: {
      current: runStorekeeperDecisionBurden(join(root, "board-current.sqlite")),
      convention: runBoardConvention(join(root, "board-convention.sqlite")),
    },
    editor: {
      current: runEditorCurrent(join(root, "editor-current.sqlite")),
      convention: runEditorConvention(join(root, "editor-convention.sqlite")),
    },
  };

  const profiles = {
    board: {
      current: decisionProfile("scripts/agent_decision_burden/storekeeper.ts"),
      convention: decisionProfile("scripts/agent_project_convention/board_convention.ts"),
    },
    editor: {
      current: decisionProfile("scripts/agent_project_convention/editor_current.ts"),
      convention: decisionProfile("scripts/agent_project_convention/editor_convention.ts"),
    },
    framework: frameworkProfile("scripts/agent_project_convention/convention.ts"),
  };

  const boardRuntimeValid =
    runtime.board.current.pass &&
    runtime.board.convention.pass &&
    runtime.board.current.urgentOpen === 1 &&
    runtime.board.convention.urgentOpen === 1 &&
    runtime.board.current.evolvedShapePersisted &&
    runtime.board.convention.evolvedShapePersisted;

  const editorRuntimeValid =
    runtime.editor.current.pass &&
    runtime.editor.convention.pass &&
    runtime.editor.current.autosaves === 1 &&
    runtime.editor.convention.autosaves === 1 &&
    runtime.editor.current.evolvedShapePersisted &&
    runtime.editor.convention.evolvedShapePersisted;

  const boardReduction = profiles.board.current.decisionCount - profiles.board.convention.decisionCount;
  const editorReduction = profiles.editor.current.decisionCount - profiles.editor.convention.decisionCount;
  const aggregatePrototypeReduction = boardReduction + editorReduction;
  const reducedBothScenarios = boardReduction > 0 && editorReduction > 0;
  const targetMetBoth = profiles.board.convention.decisionCount <= 5 && profiles.editor.convention.decisionCount <= 5;
  const publicFrameworkCostBelowAggregateReduction = profiles.framework.publicConceptCount < aggregatePrototypeReduction;
  const singletonDecisionRemoved =
    !profiles.board.convention.decisions.includes("singleton-list-adaptation") &&
    !profiles.editor.convention.decisions.includes("singleton-list-adaptation");
  const explicitStateKeyDecisionRemoved =
    !profiles.board.convention.decisions.includes("state-keying") &&
    !profiles.editor.convention.decisions.includes("state-keying");

  const runtimeValid = boardRuntimeValid && editorRuntimeValid;
  const decision = !runtimeValid
    ? "INVALID_RUNTIME"
    : reducedBothScenarios && targetMetBoth && publicFrameworkCostBelowAggregateReduction && singletonDecisionRemoved && explicitStateKeyDecisionRemoved
      ? "CANDIDATE_PASS_REUSABLE_PROJECT_CONVENTION"
      : reducedBothScenarios
        ? "MIXED_PER_PROTOTYPE_REDUCTION"
        : "REJECT_NO_REPLICATED_DECISION_REDUCTION";

  validExperiment = runtimeValid;

  console.log(JSON.stringify({
    experiment: "agent-facing-durable-project-convention",
    issue: 48,
    metric: {
      prototypeDecisionMarker: "@decision:<stable-id>",
      frameworkPublicMarker: "@framework-public:<stable-id>",
      frameworkInternalMarker: "@framework-internal:<stable-id>",
      limitation: "Counts auditable implementation obligations and convention concepts; it does not inspect or claim access to hidden model chain-of-thought.",
    },
    runtime,
    profiles,
    comparison: {
      boardReduction,
      editorReduction,
      aggregatePrototypeReduction,
      reducedBothScenarios,
      targetMetBoth,
      publicFrameworkCostBelowAggregateReduction,
      singletonDecisionRemoved,
      explicitStateKeyDecisionRemoved,
    },
    decision,
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

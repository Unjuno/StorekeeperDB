import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { initialSettings, initialTasks } from "./agent_decision_burden/model.js";
import type { ProjectSettingsV1, TaskV1 } from "./agent_decision_burden/model.js";
import { list, object, openProjectStore } from "./agent_project_convention/convention.js";
import {
  openAliasRenameProjectStore,
  openStableIdProjectStore,
  openStrictRenameProjectStore,
  renameList,
  renameObject,
} from "./declaration_key_rename/convention_candidates.js";

type PhysicalRow = { state_key: string; value_json: string };

type PhysicalSnapshot = {
  keys: string[];
  valuesByKey: Record<string, unknown[]>;
};

const PERSISTED_WORKSPACE = "Persisted before rename";
const PERSISTED_TASK_TITLE = "Persisted task before rename";

const physicalSnapshot = (path: string): PhysicalSnapshot => {
  const db = new DatabaseSync(path); // experiment instrumentation only
  const rows = db.prepare("SELECT state_key,value_json FROM __sk_items ORDER BY state_key,pos").all() as PhysicalRow[];
  db.close();
  const valuesByKey: Record<string, unknown[]> = {};
  for (const row of rows) (valuesByKey[row.state_key] ??= []).push(JSON.parse(row.value_json));
  return { keys: [...new Set(rows.map((row) => row.state_key))], valuesByKey };
};

const persistedSettings = (value: ProjectSettingsV1): boolean =>
  value.workspaceName === PERSISTED_WORKSPACE && value.compactMode === true;

const persistedTasks = (tasks: TaskV1[]): boolean =>
  tasks.length === 2 && tasks[0]?.title === PERSISTED_TASK_TITLE;

const runCandidateA = (path: string) => {
  const v1 = openProjectStore(path, {
    tasks: list(initialTasks()),
    settings: object(initialSettings()),
  });
  v1.state.settings.workspaceName = PERSISTED_WORKSPACE;
  v1.state.settings.compactMode = true;
  v1.state.tasks[0]!.title = PERSISTED_TASK_TITLE;
  v1.close();

  const establish = openProjectStore(path, {
    tasks: list<TaskV1>([]),
    settings: object<ProjectSettingsV1>(initialSettings()),
  });
  const durabilityEstablished = persistedSettings(establish.state.settings) && persistedTasks(establish.state.tasks);
  establish.close();

  const renamed = openProjectStore(path, { // @candidate-a-decision:implicit-property-derived-key
    tasks: list<TaskV1>([]),
    preferences: object<ProjectSettingsV1>(initialSettings()),
  });
  const renamedValuePreserved = persistedSettings(renamed.state.preferences);
  const silentFreshInitialization =
    renamed.state.preferences.workspaceName === "Agent Board" && renamed.state.preferences.compactMode === false;
  const unchangedTasksPreserved = persistedTasks(renamed.state.tasks);
  renamed.close();

  const reopened = openProjectStore(path, {
    tasks: list<TaskV1>([]),
    preferences: object<ProjectSettingsV1>(initialSettings()),
  });
  const reopenStable =
    reopened.state.preferences.workspaceName === "Agent Board" &&
    reopened.state.preferences.compactMode === false &&
    persistedTasks(reopened.state.tasks);
  reopened.close();

  const physical = physicalSnapshot(path);
  return {
    durabilityEstablished,
    renamedValuePreserved,
    silentFreshInitialization,
    unchangedTasksPreserved,
    reopenStable,
    duplicatePhysicalStates: physical.keys.includes("settings") && physical.keys.includes("preferences"),
    oldPhysicalValueStillPresent: physical.keys.includes("settings"),
    physicalKeys: physical.keys,
  };
};

const runCandidateB = (path: string) => {
  const v1 = openStrictRenameProjectStore(path, {
    tasks: renameList(initialTasks()),
    settings: renameObject(initialSettings()),
  });
  v1.state.settings.workspaceName = PERSISTED_WORKSPACE;
  v1.state.settings.compactMode = true;
  v1.state.tasks[0]!.title = PERSISTED_TASK_TITLE;
  v1.close();

  const establish = openStrictRenameProjectStore(path, {
    tasks: renameList<TaskV1>([]),
    settings: renameObject<ProjectSettingsV1>(initialSettings()),
  });
  const durabilityEstablished = persistedSettings(establish.state.settings) && persistedTasks(establish.state.tasks);
  establish.close();

  let rejectedRename = false;
  let error = "";
  try {
    const renamed = openStrictRenameProjectStore(path, { // @candidate-b-decision:strict-identity-check
      tasks: renameList<TaskV1>([]),
      preferences: renameObject<ProjectSettingsV1>(initialSettings()),
    });
    renamed.close();
  } catch (caught) {
    rejectedRename = true;
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const reopenedOld = openStrictRenameProjectStore(path, {
    tasks: renameList<TaskV1>([]),
    settings: renameObject<ProjectSettingsV1>(initialSettings()),
  });
  const oldStateStillValid = persistedSettings(reopenedOld.state.settings) && persistedTasks(reopenedOld.state.tasks);
  reopenedOld.close();

  const physical = physicalSnapshot(path);
  return {
    durabilityEstablished,
    rejectedRename,
    error,
    silentFreshInitialization: physical.keys.includes("preferences"),
    oldStateStillValid,
    duplicatePhysicalStates: physical.keys.includes("settings") && physical.keys.includes("preferences"),
    physicalKeys: physical.keys,
  };
};

const runCandidateC = (path: string) => {
  const v1 = openAliasRenameProjectStore(path, {
    tasks: renameList(initialTasks()),
    settings: renameObject(initialSettings()),
  });
  v1.state.settings.workspaceName = PERSISTED_WORKSPACE;
  v1.state.settings.compactMode = true;
  v1.state.tasks[0]!.title = PERSISTED_TASK_TITLE;
  v1.close();

  const establish = openAliasRenameProjectStore(path, {
    tasks: renameList<TaskV1>([]),
    settings: renameObject<ProjectSettingsV1>(initialSettings()),
  });
  const durabilityEstablished = persistedSettings(establish.state.settings) && persistedTasks(establish.state.tasks);
  establish.close();

  const renamed = openAliasRenameProjectStore(path, {
    tasks: renameList<TaskV1>([]),
    preferences: renameObject<ProjectSettingsV1>(initialSettings(), { from: "settings" }), // @candidate-c-decision:rename-alias
  });
  const renamedValuePreserved = persistedSettings(renamed.state.preferences);
  const unchangedTasksPreserved = persistedTasks(renamed.state.tasks);
  renamed.state.preferences.workspaceName = `${PERSISTED_WORKSPACE} v2`;
  renamed.close();

  const reopenedWithoutAlias = openAliasRenameProjectStore(path, {
    tasks: renameList<TaskV1>([]),
    preferences: renameObject<ProjectSettingsV1>(initialSettings()),
  });
  const oneShotAliasPersists =
    reopenedWithoutAlias.state.preferences.workspaceName === `${PERSISTED_WORKSPACE} v2` &&
    reopenedWithoutAlias.state.preferences.compactMode === true &&
    persistedTasks(reopenedWithoutAlias.state.tasks);
  reopenedWithoutAlias.close();

  const physical = physicalSnapshot(path);
  return {
    durabilityEstablished,
    renamedValuePreserved,
    unchangedTasksPreserved,
    oneShotAliasPersists,
    silentFreshInitialization: false,
    duplicatePhysicalStates: physical.keys.includes("settings") && physical.keys.includes("preferences"),
    physicalKeyRemainsOldName: physical.keys.includes("settings") && !physical.keys.includes("preferences"),
    physicalKeys: physical.keys,
  };
};

const runCandidateD = (path: string) => {
  const v1 = openStableIdProjectStore(path, {
    tasks: renameList(initialTasks()),
    settings: renameObject(initialSettings(), { id: "project-settings" }), // @candidate-d-decision:stable-durable-id
  });
  v1.state.settings.workspaceName = PERSISTED_WORKSPACE;
  v1.state.settings.compactMode = true;
  v1.state.tasks[0]!.title = PERSISTED_TASK_TITLE;
  v1.close();

  const establish = openStableIdProjectStore(path, {
    tasks: renameList<TaskV1>([]),
    settings: renameObject<ProjectSettingsV1>(initialSettings(), { id: "project-settings" }),
  });
  const durabilityEstablished = persistedSettings(establish.state.settings) && persistedTasks(establish.state.tasks);
  establish.close();

  const renamed = openStableIdProjectStore(path, {
    tasks: renameList<TaskV1>([]),
    preferences: renameObject<ProjectSettingsV1>(initialSettings(), { id: "project-settings" }),
  });
  const renamedValuePreserved = persistedSettings(renamed.state.preferences);
  const unchangedTasksPreserved = persistedTasks(renamed.state.tasks);
  renamed.state.preferences.workspaceName = `${PERSISTED_WORKSPACE} stable`;
  renamed.close();

  const reopened = openStableIdProjectStore(path, {
    tasks: renameList<TaskV1>([]),
    preferences: renameObject<ProjectSettingsV1>(initialSettings(), { id: "project-settings" }),
  });
  const reopenStable =
    reopened.state.preferences.workspaceName === `${PERSISTED_WORKSPACE} stable` &&
    reopened.state.preferences.compactMode === true &&
    persistedTasks(reopened.state.tasks);
  reopened.close();

  const physical = physicalSnapshot(path);
  return {
    durabilityEstablished,
    renamedValuePreserved,
    unchangedTasksPreserved,
    reopenStable,
    stableIdMustRemainDeclared: true,
    duplicatePhysicalStates: physical.keys.includes("settings") || physical.keys.includes("preferences"),
    physicalKeys: physical.keys,
  };
};

const uniqueMarkers = (text: string, pattern: RegExp): string[] =>
  [...new Set([...text.matchAll(pattern)].map((match) => match[1]!))].sort();

const source = readFileSync("scripts/declaration_key_rename_experiment.ts", "utf8");
const helperSource = readFileSync("scripts/declaration_key_rename/convention_candidates.ts", "utf8");
const profile = (candidate: "a" | "b" | "c" | "d") => ({
  decisions: uniqueMarkers(source, new RegExp(`@candidate-${candidate}-decision:([a-z0-9-]+)`, "g")),
  frameworkPublic: uniqueMarkers(helperSource, new RegExp(`@candidate-${candidate}-framework-public:([a-z0-9-]+)`, "g")),
  frameworkInternal: uniqueMarkers(helperSource, new RegExp(`@candidate-${candidate}-framework-internal:([a-z0-9-]+)`, "g")),
});

const root = mkdtempSync(join(tmpdir(), "sk-declaration-key-rename-"));
let validExperiment = false;

try {
  const runtime = {
    A: runCandidateA(join(root, "a.sqlite")),
    B: runCandidateB(join(root, "b.sqlite")),
    C: runCandidateC(join(root, "c.sqlite")),
    D: runCandidateD(join(root, "d.sqlite")),
  };
  const profiles = {
    A: profile("a"),
    B: profile("b"),
    C: profile("c"),
    D: profile("d"),
  };

  const negativeControlConfirmed =
    runtime.A.durabilityEstablished &&
    !runtime.A.renamedValuePreserved &&
    runtime.A.silentFreshInitialization &&
    runtime.A.duplicatePhysicalStates &&
    runtime.A.unchangedTasksPreserved;

  const strictFailLoudlyValid =
    runtime.B.durabilityEstablished &&
    runtime.B.rejectedRename &&
    !runtime.B.silentFreshInitialization &&
    !runtime.B.duplicatePhysicalStates &&
    runtime.B.oldStateStillValid;

  const aliasValid =
    runtime.C.durabilityEstablished &&
    runtime.C.renamedValuePreserved &&
    runtime.C.unchangedTasksPreserved &&
    runtime.C.oneShotAliasPersists &&
    !runtime.C.duplicatePhysicalStates &&
    runtime.C.physicalKeyRemainsOldName;

  const stableIdValid =
    runtime.D.durabilityEstablished &&
    runtime.D.renamedValuePreserved &&
    runtime.D.unchangedTasksPreserved &&
    runtime.D.reopenStable &&
    !runtime.D.duplicatePhysicalStates;

  const comparison = {
    compatiblePathExtraDecisions: {
      A: 0,
      B: 0,
      C: 0,
      D: profiles.D.decisions.length,
    },
    renameBoundaryExtraDecisions: {
      A: 0,
      B: 0,
      C: profiles.C.decisions.length,
      D: 0,
    },
    negativeControlConfirmed,
    strictFailLoudlyValid,
    aliasValid,
    stableIdValid,
    aliasKeepsCompatiblePathKeyFree: profiles.C.decisions.length === 1,
    stableIdReintroducesUpfrontKeyDecision: profiles.D.decisions.includes("stable-durable-id"),
    aliasRequiresIdentityManifest: profiles.C.frameworkInternal.includes("identity-manifest"),
  };

  const runtimeValid = negativeControlConfirmed && strictFailLoudlyValid && aliasValid && stableIdValid;
  const decision = !runtimeValid
    ? "INVALID_RUNTIME"
    : comparison.aliasKeepsCompatiblePathKeyFree && comparison.stableIdReintroducesUpfrontKeyDecision
      ? "CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST"
      : "MIXED_RENAME_IDENTITY_STRATEGIES";

  validExperiment = runtimeValid;

  console.log(JSON.stringify({
    experiment: "declaration-property-rename-durable-identity",
    issue: 50,
    instrumentation: "Direct SQLite inspection is used only to verify physical state-key duplication; application behavior uses experiment/public StorekeeperDB surfaces.",
    runtime,
    profiles,
    comparison,
    decision,
    uncertainty: {
      identityManifestIsRegistryLike: true,
      aliasDoesNotPhysicallyRenameStorageKey: true,
      projectionMetadataRenameNotExercised: true,
      noPublicApiDecisionYet: true,
    },
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

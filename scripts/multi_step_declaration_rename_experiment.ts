import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { initialSettings, initialTasks } from "./agent_decision_burden/model.js";
import type { ProjectSettingsV1, TaskV1 } from "./agent_decision_burden/model.js";
import {
  openAliasRenameProjectStore,
  renameList,
  renameObject,
} from "./declaration_key_rename/convention_candidates.js";

type ItemRow = { state_key: string; value_json: string };
type CountRow = { state_key: string; n: number };
type Binding = { physicalKey?: string; kind?: string };
type IdentityManifest = { bindings?: Record<string, Binding> };

type Snapshot = {
  physicalCounts: Record<string, number>;
  bindings: Record<string, Binding>;
};

const V1_NAME = "Persisted settings V1";
const V2_NAME = "Persisted preferences V2";
const V3_NAME = "Persisted configuration V3";

const snapshot = (path: string): Snapshot => {
  const db = new DatabaseSync(path);
  const counts = db.prepare("SELECT state_key,COUNT(*) n FROM __sk_items GROUP BY state_key ORDER BY state_key").all() as CountRow[];
  const manifestRow = db.prepare("SELECT value_json FROM __sk_items WHERE state_key='__project_identity' LIMIT 1").get() as Pick<ItemRow, "value_json"> | undefined;
  db.close();
  const manifest = manifestRow ? JSON.parse(manifestRow.value_json) as IdentityManifest : {};
  return {
    physicalCounts: Object.fromEntries(counts.map((row) => [row.state_key, Number(row.n)])),
    bindings: manifest.bindings ?? {},
  };
};

const hasOnlyBinding = (value: Snapshot, logicalKey: string, physicalKey: string, kind: string): boolean => {
  const keys = Object.keys(value.bindings);
  return keys.length === 1 && keys[0] === logicalKey &&
    value.bindings[logicalKey]?.physicalKey === physicalKey &&
    value.bindings[logicalKey]?.kind === kind;
};

const hasSinglePhysicalState = (value: Snapshot): boolean =>
  (value.physicalCounts.settings ?? 0) === 1 &&
  (value.physicalCounts.preferences ?? 0) === 0 &&
  (value.physicalCounts.configuration ?? 0) === 0 &&
  (value.physicalCounts.options ?? 0) === 0;

const expectFailure = (run: () => void): { rejected: boolean; error: string } => {
  try {
    run();
    return { rejected: false, error: "" };
  } catch (caught) {
    return {
      rejected: true,
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
};

const verifyPreferencesIntact = (path: string): boolean => {
  const reopened = openAliasRenameProjectStore(path, {
    preferences: renameObject<ProjectSettingsV1>(initialSettings()),
  });
  const intact = reopened.state.preferences.workspaceName === V2_NAME && reopened.state.preferences.compactMode === true;
  reopened.close();
  const after = snapshot(path);
  return intact && hasOnlyBinding(after, "preferences", "settings", "object") && hasSinglePhysicalState(after);
};

const root = mkdtempSync(join(tmpdir(), "sk-multi-step-rename-"));
const dbPath = join(root, "project.sqlite");
let validExperiment = false;

try {
  const v1 = openAliasRenameProjectStore(dbPath, {
    settings: renameObject(initialSettings()),
  });
  v1.state.settings.workspaceName = V1_NAME;
  v1.state.settings.compactMode = true;
  v1.close();

  const v1Snapshot = snapshot(dbPath);
  const v1Established =
    hasOnlyBinding(v1Snapshot, "settings", "settings", "object") &&
    hasSinglePhysicalState(v1Snapshot);

  const v2 = openAliasRenameProjectStore(dbPath, {
    preferences: renameObject<ProjectSettingsV1>(initialSettings(), { from: "settings" }),
  });
  const firstRenamePreservedV1 =
    v2.state.preferences.workspaceName === V1_NAME && v2.state.preferences.compactMode === true;
  v2.state.preferences.workspaceName = V2_NAME;
  v2.close();

  const v2Snapshot = snapshot(dbPath);
  const firstRenameNarrowBinding =
    hasOnlyBinding(v2Snapshot, "preferences", "settings", "object") &&
    hasSinglePhysicalState(v2Snapshot);

  const v2Reopen = openAliasRenameProjectStore(dbPath, {
    preferences: renameObject<ProjectSettingsV1>(initialSettings()),
  });
  const firstAliasNotRequiredOnReopen =
    v2Reopen.state.preferences.workspaceName === V2_NAME && v2Reopen.state.preferences.compactMode === true;
  v2Reopen.close();

  const missingAlias = expectFailure(() => {
    const invalid = openAliasRenameProjectStore(dbPath, {
      configuration: renameObject<ProjectSettingsV1>(initialSettings()),
    });
    invalid.close();
  });
  const missingAliasPreservesCurrentState = verifyPreferencesIntact(dbPath);

  const staleOriginalAlias = expectFailure(() => {
    const invalid = openAliasRenameProjectStore(dbPath, {
      configuration: renameObject<ProjectSettingsV1>(initialSettings(), { from: "settings" }),
    });
    invalid.close();
  });
  const staleOriginalAliasPreservesCurrentState = verifyPreferencesIntact(dbPath);

  const nonexistentAlias = expectFailure(() => {
    const invalid = openAliasRenameProjectStore(dbPath, {
      configuration: renameObject<ProjectSettingsV1>(initialSettings(), { from: "does-not-exist" }),
    });
    invalid.close();
  });
  const nonexistentAliasPreservesCurrentState = verifyPreferencesIntact(dbPath);

  const kindMismatch = expectFailure(() => {
    const invalid = openAliasRenameProjectStore(dbPath, {
      configuration: renameList<TaskV1>(initialTasks(), { from: "preferences" }),
    });
    invalid.close();
  });
  const kindMismatchPreservesCurrentState = verifyPreferencesIntact(dbPath);

  const v3 = openAliasRenameProjectStore(dbPath, {
    configuration: renameObject<ProjectSettingsV1>(initialSettings(), { from: "preferences" }),
  });
  const secondRenamePreservedV2 =
    v3.state.configuration.workspaceName === V2_NAME && v3.state.configuration.compactMode === true;
  v3.state.configuration.workspaceName = V3_NAME;
  v3.close();

  const v3Snapshot = snapshot(dbPath);
  const secondRenameUsesImmediatePreviousNameOnly =
    hasOnlyBinding(v3Snapshot, "configuration", "settings", "object") &&
    v3Snapshot.bindings.preferences === undefined &&
    v3Snapshot.bindings.settings === undefined;
  const physicalIdentityStayedOriginal = hasSinglePhysicalState(v3Snapshot);

  const v3Reopen = openAliasRenameProjectStore(dbPath, {
    configuration: renameObject<ProjectSettingsV1>(initialSettings()),
  });
  const secondAliasNotRequiredOnReopen =
    v3Reopen.state.configuration.workspaceName === V3_NAME && v3Reopen.state.configuration.compactMode === true;
  v3Reopen.close();

  const expiredPreviousAlias = expectFailure(() => {
    const invalid = openAliasRenameProjectStore(dbPath, {
      options: renameObject<ProjectSettingsV1>(initialSettings(), { from: "preferences" }),
    });
    invalid.close();
  });

  const finalReopen = openAliasRenameProjectStore(dbPath, {
    configuration: renameObject<ProjectSettingsV1>(initialSettings()),
  });
  const failedLateAliasPreservedConfiguration =
    finalReopen.state.configuration.workspaceName === V3_NAME && finalReopen.state.configuration.compactMode === true;
  finalReopen.close();

  const finalSnapshot = snapshot(dbPath);
  const manifestHasNoRenameHistory =
    hasOnlyBinding(finalSnapshot, "configuration", "settings", "object") &&
    hasSinglePhysicalState(finalSnapshot);

  const checks = {
    v1Established,
    firstRenamePreservedV1,
    firstRenameNarrowBinding,
    firstAliasNotRequiredOnReopen,
    missingAliasRejected: missingAlias.rejected,
    missingAliasPreservesCurrentState,
    staleOriginalAliasRejected: staleOriginalAlias.rejected,
    staleOriginalAliasPreservesCurrentState,
    nonexistentAliasRejected: nonexistentAlias.rejected,
    nonexistentAliasPreservesCurrentState,
    kindMismatchRejected: kindMismatch.rejected,
    kindMismatchPreservesCurrentState,
    secondRenamePreservedV2,
    secondRenameUsesImmediatePreviousNameOnly,
    physicalIdentityStayedOriginal,
    secondAliasNotRequiredOnReopen,
    expiredPreviousAliasRejected: expiredPreviousAlias.rejected,
    failedLateAliasPreservedConfiguration,
    manifestHasNoRenameHistory,
  };

  validExperiment = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({
    experiment: "multi-step-declaration-rename-identity",
    issue: 54,
    chain: ["settings", "preferences", "configuration"],
    physicalIdentity: "settings",
    negativeControls: {
      missingAlias,
      staleOriginalAlias,
      nonexistentAlias,
      kindMismatch,
      expiredPreviousAlias,
    },
    finalManifest: finalSnapshot.bindings,
    physicalCounts: finalSnapshot.physicalCounts,
    checks,
    decision: validExperiment
      ? "CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY"
      : "FAIL_MULTI_STEP_RENAME_IDENTITY_MODEL",
    interpretation: validExperiment
      ? "Each rename consumed only the immediately previous logical binding; the manifest retained one current logical name mapped to the original physical key and did not accumulate rename history."
      : "Repeated rename exposed identity or failure-atomicity behavior inconsistent with the narrow manifest model.",
    uncertainty: {
      declarationSplitMergeUntested: true,
      concurrentVersionOpenUntested: true,
      physicalKeyCompactionUntested: true,
      publicApiDecisionAuthorized: false,
    },
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

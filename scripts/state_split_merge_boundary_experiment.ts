import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";
import {
  openAliasRenameProjectStore,
  renameObject,
} from "./declaration_key_rename/convention_candidates.js";

type Profile = {
  id: string;
  displayName: string;
  compactMode: boolean;
};

type Account = {
  id: string;
  displayName: string;
};

type Preferences = {
  id: string;
  compactMode: boolean;
};

type Binding = { physicalKey: string; kind: "list" | "object" };
type IdentityManifest = {
  id: "project-identity-manifest";
  bindings: Record<string, Binding>;
};

type CountRow = { state_key: string; n: number };
type ItemRow = { value_json: string };
type MetaRow = { state_key: string; path: string };

type PhysicalSnapshot = {
  itemCounts: Record<string, number>;
  bindings: Record<string, Binding>;
  paths: string[];
  derivations: string[];
  projectionCounts: Record<string, number>;
};

const INITIAL_PROFILE: Profile = {
  id: "PROFILE",
  displayName: "Initial profile",
  compactMode: false,
};
const PERSISTED_NAME = "Persisted profile";

const snapshot = (path: string): PhysicalSnapshot => {
  const db = new DatabaseSync(path);
  const counts = db.prepare("SELECT state_key,COUNT(*) n FROM __sk_items GROUP BY state_key ORDER BY state_key").all() as CountRow[];
  const manifestRow = db.prepare("SELECT value_json FROM __sk_items WHERE state_key='__project_identity' LIMIT 1").get() as ItemRow | undefined;
  const paths = (db.prepare("SELECT state_key,path FROM __sk_paths ORDER BY state_key,path").all() as MetaRow[])
    .map((row) => `${row.state_key}:${row.path}`);
  const derivations = (db.prepare("SELECT state_key,path FROM __sk_derivations ORDER BY state_key,path").all() as MetaRow[])
    .map((row) => `${row.state_key}:${row.path}`);
  const projectionRows = db.prepare("SELECT state_key,COUNT(*) n FROM __sk_projection GROUP BY state_key ORDER BY state_key").all() as CountRow[];
  db.close();
  const manifest = manifestRow ? JSON.parse(manifestRow.value_json) as IdentityManifest : undefined;
  return {
    itemCounts: Object.fromEntries(counts.map((row) => [row.state_key, Number(row.n)])),
    bindings: manifest?.bindings ?? {},
    paths,
    derivations,
    projectionCounts: Object.fromEntries(projectionRows.map((row) => [row.state_key, Number(row.n)])),
  };
};

const establishProfile = (path: string): void => {
  const project = openAliasRenameProjectStore(path, {
    profile: renameObject(INITIAL_PROFILE),
  });
  project.state.profile.displayName = PERSISTED_NAME;
  project.state.profile.compactMode = true;
  project.close();
};

const profileIsPersisted = (value: Profile): boolean =>
  value.displayName === PERSISTED_NAME && value.compactMode === true;

const expectFailure = (run: () => void): { rejected: boolean; error: string } => {
  try {
    run();
    return { rejected: false, error: "" };
  } catch (caught) {
    return { rejected: true, error: caught instanceof Error ? caught.message : String(caught) };
  }
};

const runNaiveSplit = (path: string) => {
  establishProfile(path);
  const attempted = expectFailure(() => {
    const project = openAliasRenameProjectStore(path, {
      account: renameObject<Account>({ id: "ACCOUNT", displayName: "Fresh account" }),
      preferences: renameObject<Preferences>({ id: "PREFERENCES", compactMode: false }),
    });
    project.close();
  });

  const reopened = openAliasRenameProjectStore(path, {
    profile: renameObject<Profile>(INITIAL_PROFILE),
  });
  const sourcePreserved = profileIsPersisted(reopened.state.profile);
  reopened.close();

  const physical = snapshot(path);
  return {
    rejected: attempted.rejected,
    error: attempted.error,
    sourcePreserved,
    noPartialTargets:
      (physical.itemCounts.account ?? 0) === 0 &&
      (physical.itemCounts.preferences ?? 0) === 0,
    manifestStillProfile:
      Object.keys(physical.bindings).length === 1 &&
      physical.bindings.profile?.physicalKey === "profile",
  };
};

const runAliasMisuse = (path: string) => {
  establishProfile(path);

  const project = openAliasRenameProjectStore(path, {
    account: renameObject<Account>({ id: "ACCOUNT", displayName: "Fresh account" }, { from: "profile" }),
    preferences: renameObject<Preferences>({ id: "PREFERENCES", compactMode: false }),
  });

  const accountNamePreserved = project.state.account.displayName === PERSISTED_NAME;
  const preferencesValuePreserved = project.state.preferences.compactMode === true;
  project.close();

  const reopened = openAliasRenameProjectStore(path, {
    account: renameObject<Account>({ id: "ACCOUNT", displayName: "Fresh account" }),
    preferences: renameObject<Preferences>({ id: "PREFERENCES", compactMode: false }),
  });
  const stableButSemanticallyIncomplete =
    reopened.state.account.displayName === PERSISTED_NAME &&
    reopened.state.preferences.compactMode === false;
  reopened.close();

  const physical = snapshot(path);
  return {
    openSucceeded: true,
    accountNamePreserved,
    preferencesValuePreserved,
    silentFreshPreferences: !preferencesValuePreserved,
    stableButSemanticallyIncomplete,
    physicalProfileReusedByAccount:
      physical.bindings.account?.physicalKey === "profile" &&
      (physical.itemCounts.profile ?? 0) === 1,
    freshPreferencesPhysicalState: (physical.itemCounts.preferences ?? 0) === 1,
    manifestLooksStructurallyValid:
      physical.bindings.account?.physicalKey === "profile" &&
      physical.bindings.preferences?.physicalKey === "preferences",
  };
};

const runExplicitMigration = (path: string) => {
  establishProfile(path);

  const sk = new StorekeeperDB(path);
  const manifestHolder = sk.state<IdentityManifest[]>("__project_identity", [{
    id: "project-identity-manifest",
    bindings: {},
  }]);
  const profile = sk.state<Profile[]>("profile", []);
  const account = sk.state<Account[]>("account", []);
  const preferences = sk.state<Preferences[]>("preferences", []);

  const initialSource = profile[0]!;
  const initialValues = {
    displayName: initialSource.displayName,
    compactMode: initialSource.compactMode,
  };
  sk.find<Dict>("profile", { displayName: initialValues.displayName });
  const beforeFailure = snapshot(path);
  const projectionEstablished =
    beforeFailure.derivations.includes("profile:displayName") &&
    (beforeFailure.projectionCounts.profile ?? 0) === 1;

  const injectedFailure = expectFailure(() => {
    const currentManifest = manifestHolder[0]!;
    const source = profile[0]!;
    const displayName = source.displayName;
    const compactMode = source.compactMode;
    const projectionPaths = sk.debug().derivations("profile").map((row) => row.path);

    sk.batch(() => {
      account.push({ id: "ACCOUNT", displayName });
      preferences.push({ id: "PREFERENCES", compactMode });
      profile.splice(0, profile.length);
      currentManifest.bindings = {
        account: { physicalKey: "account", kind: "object" },
        preferences: { physicalKey: "preferences", kind: "object" },
      };
      sk.debug().evict("profile", projectionPaths);
      sk.debug().compactMetadata({
        stateKey: "profile",
        pathCountDecayFactor: 0,
        dropPathStatsBelow: 0,
      });
      throw new Error("injected split migration failure");
    });
  });

  const afterFailure = snapshot(path);
  const rollbackPreservedSource =
    profile.length === 1 &&
    profileIsPersisted(profile[0]!) &&
    (afterFailure.itemCounts.profile ?? 0) === 1;
  const rollbackRemovedTargets =
    account.length === 0 &&
    preferences.length === 0 &&
    (afterFailure.itemCounts.account ?? 0) === 0 &&
    (afterFailure.itemCounts.preferences ?? 0) === 0;
  const rollbackPreservedManifest =
    Object.keys(afterFailure.bindings).length === 1 &&
    afterFailure.bindings.profile?.physicalKey === "profile";
  const rollbackPreservedDerivedMetadata =
    afterFailure.derivations.includes("profile:displayName") &&
    (afterFailure.projectionCounts.profile ?? 0) === 1;

  const source = profile[0]!;
  const displayName = source.displayName;
  const compactMode = source.compactMode;
  const currentManifest = manifestHolder[0]!;
  const projectionPaths = sk.debug().derivations("profile").map((row) => row.path);

  sk.batch(() => {
    account.push({ id: "ACCOUNT", displayName });
    preferences.push({ id: "PREFERENCES", compactMode });
    profile.splice(0, profile.length);
    currentManifest.bindings = {
      account: { physicalKey: "account", kind: "object" },
      preferences: { physicalKey: "preferences", kind: "object" },
    };
    sk.debug().evict("profile", projectionPaths);
    sk.debug().compactMetadata({
      stateKey: "profile",
      pathCountDecayFactor: 0,
      dropPathStatsBelow: 0,
    });
  });

  const afterSuccess = snapshot(path);
  const successfulPhysicalTransition =
    (afterSuccess.itemCounts.profile ?? 0) === 0 &&
    (afterSuccess.itemCounts.account ?? 0) === 1 &&
    (afterSuccess.itemCounts.preferences ?? 0) === 1;
  const successfulManifestTransition =
    Object.keys(afterSuccess.bindings).sort().join(",") === "account,preferences" &&
    afterSuccess.bindings.account?.physicalKey === "account" &&
    afterSuccess.bindings.preferences?.physicalKey === "preferences";
  const retiredActiveMetadata =
    !afterSuccess.paths.some((key) => key.startsWith("profile:")) &&
    !afterSuccess.derivations.some((key) => key.startsWith("profile:")) &&
    (afterSuccess.projectionCounts.profile ?? 0) === 0;
  sk.close();

  const reopened = openAliasRenameProjectStore(path, {
    account: renameObject<Account>({ id: "ACCOUNT", displayName: "Fresh account" }),
    preferences: renameObject<Preferences>({ id: "PREFERENCES", compactMode: false }),
  });
  const transformedValuesPersisted =
    reopened.state.account.displayName === PERSISTED_NAME &&
    reopened.state.preferences.compactMode === true;
  reopened.close();

  const oldLogicalSourceRejected = expectFailure(() => {
    const invalid = openAliasRenameProjectStore(path, {
      profile: renameObject<Profile>(INITIAL_PROFILE),
    });
    invalid.close();
  });

  return {
    projectionEstablished,
    injectedFailureRejected: injectedFailure.rejected,
    injectedFailureError: injectedFailure.error,
    rollbackPreservedSource,
    rollbackRemovedTargets,
    rollbackPreservedManifest,
    rollbackPreservedDerivedMetadata,
    successfulPhysicalTransition,
    successfulManifestTransition,
    transformedValuesPersisted,
    retiredActiveMetadata,
    oldLogicalSourceRejected: oldLogicalSourceRejected.rejected,
    originalValues: initialValues,
    finalPhysical: afterSuccess,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-state-split-boundary-"));
let validExperiment = false;

try {
  const A = runNaiveSplit(join(root, "a.sqlite"));
  const B = runAliasMisuse(join(root, "b.sqlite"));
  const C = runExplicitMigration(join(root, "c.sqlite"));

  const naiveSplitSafelyRejected =
    A.rejected && A.sourcePreserved && A.noPartialTargets && A.manifestStillProfile;

  const aliasMisuseIsSemanticallyUnsafe =
    B.openSucceeded &&
    B.accountNamePreserved &&
    !B.preferencesValuePreserved &&
    B.silentFreshPreferences &&
    B.stableButSemanticallyIncomplete &&
    B.physicalProfileReusedByAccount &&
    B.freshPreferencesPhysicalState &&
    B.manifestLooksStructurallyValid;

  const explicitMigrationIsAtomicAndComplete =
    C.projectionEstablished &&
    C.injectedFailureRejected &&
    C.rollbackPreservedSource &&
    C.rollbackRemovedTargets &&
    C.rollbackPreservedManifest &&
    C.rollbackPreservedDerivedMetadata &&
    C.successfulPhysicalTransition &&
    C.successfulManifestTransition &&
    C.transformedValuesPersisted &&
    C.retiredActiveMetadata &&
    C.oldLogicalSourceRejected;

  validExperiment = naiveSplitSafelyRejected && aliasMisuseIsSemanticallyUnsafe && explicitMigrationIsAtomicAndComplete;

  console.log(JSON.stringify({
    experiment: "declared-state-split-migration-boundary",
    issue: 56,
    scenario: "profile {displayName,compactMode} -> account {displayName} + preferences {compactMode}",
    A,
    B,
    C,
    checks: {
      naiveSplitSafelyRejected,
      aliasMisuseIsSemanticallyUnsafe,
      explicitMigrationIsAtomicAndComplete,
    },
    decision: validExperiment
      ? "BOUNDARY_CONFIRMED_SPLIT_REQUIRES_EXPLICIT_ATOMIC_MIGRATION"
      : "UNCERTAIN_SPLIT_MIGRATION_BOUNDARY",
    interpretation: validExperiment
      ? "One-to-one aliasing is correct for identity rename but insufficient for state split. Public batch/state plus explicit lifecycle cleanup can implement an atomic experiment migration, but the transformation and source-retirement policy must be explicit."
      : "The experiment did not cleanly separate rename identity from split migration semantics.",
    uncertainty: {
      mergeDirectionUntested: true,
      multipleSourceTargetCollectionsUntested: true,
      concurrentVersionOpenUntested: true,
      migrationPublicSurfaceUndecided: true,
      publicApiDecisionAuthorized: false,
    },
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

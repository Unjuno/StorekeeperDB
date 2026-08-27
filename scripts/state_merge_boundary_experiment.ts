import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";
import {
  openAliasRenameProjectStore,
  renameObject,
} from "./declaration_key_rename/convention_candidates.js";

type Account = {
  id: string;
  displayName: string;
  locale: string;
};

type Preferences = {
  id: string;
  compactMode: boolean;
  locale: string;
};

type Profile = {
  id: string;
  displayName: string;
  compactMode: boolean;
  locale: string;
};

type Binding = { physicalKey: string; kind: "list" | "object" };
type IdentityManifest = {
  id: "project-identity-manifest";
  bindings: Record<string, Binding>;
};

type CountRow = { state_key: string; n: number };
type ItemRow = { value_json: string };
type PathRow = {
  state_key: string;
  path: string;
  observed_type: string | null;
  read_count: number;
  write_count: number;
};
type DerivationRow = {
  state_key: string;
  path: string;
  kind: string;
  state: string;
  use_count: number;
  storage_cost: number;
};

type PhysicalSnapshot = {
  itemCounts: Record<string, number>;
  bindings: Record<string, Binding>;
  paths: PathRow[];
  derivations: DerivationRow[];
  projectionCounts: Record<string, number>;
};

type ConflictPolicy = "prefer-account" | "prefer-preferences";

const ACCOUNT_NAME = "Persisted account";
const ACCOUNT_LOCALE = "en-US";

const ACCOUNT_INITIAL: Account = {
  id: "ACCOUNT",
  displayName: "Fresh account",
  locale: "unset-account",
};

const PREFERENCES_INITIAL: Preferences = {
  id: "PREFERENCES",
  compactMode: false,
  locale: "unset-preferences",
};

const PROFILE_INITIAL: Profile = {
  id: "PROFILE",
  displayName: "Fresh profile",
  compactMode: false,
  locale: "unset-profile",
};

const snapshot = (path: string): PhysicalSnapshot => {
  const db = new DatabaseSync(path);
  const counts = db.prepare("SELECT state_key,COUNT(*) n FROM __sk_items GROUP BY state_key ORDER BY state_key").all() as CountRow[];
  const manifestRow = db.prepare("SELECT value_json FROM __sk_items WHERE state_key='__project_identity' LIMIT 1").get() as ItemRow | undefined;
  const paths = db.prepare(
    "SELECT state_key,path,observed_type,read_count,write_count FROM __sk_paths ORDER BY state_key,path",
  ).all() as PathRow[];
  const derivations = db.prepare(
    "SELECT state_key,path,kind,state,use_count,storage_cost FROM __sk_derivations ORDER BY state_key,path,kind",
  ).all() as DerivationRow[];
  const projectionRows = db.prepare(
    "SELECT state_key,COUNT(*) n FROM __sk_projection GROUP BY state_key ORDER BY state_key",
  ).all() as CountRow[];
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

const establishSources = (path: string, preferencesLocale: string): void => {
  const project = openAliasRenameProjectStore(path, {
    account: renameObject<Account>(ACCOUNT_INITIAL),
    preferences: renameObject<Preferences>(PREFERENCES_INITIAL),
  });
  project.state.account.displayName = ACCOUNT_NAME;
  project.state.account.locale = ACCOUNT_LOCALE;
  project.state.preferences.compactMode = true;
  project.state.preferences.locale = preferencesLocale;
  project.close();
};

const sourcesArePersisted = (account: Account, preferences: Preferences, preferencesLocale: string): boolean =>
  account.displayName === ACCOUNT_NAME &&
  account.locale === ACCOUNT_LOCALE &&
  preferences.compactMode === true &&
  preferences.locale === preferencesLocale;

const expectFailure = (run: () => void): { rejected: boolean; error: string } => {
  try {
    run();
    return { rejected: false, error: "" };
  } catch (caught) {
    return { rejected: true, error: caught instanceof Error ? caught.message : String(caught) };
  }
};

const runNaiveMerge = (path: string) => {
  establishSources(path, ACCOUNT_LOCALE);

  const attempted = expectFailure(() => {
    const project = openAliasRenameProjectStore(path, {
      profile: renameObject<Profile>(PROFILE_INITIAL),
    });
    project.close();
  });

  const reopened = openAliasRenameProjectStore(path, {
    account: renameObject<Account>(ACCOUNT_INITIAL),
    preferences: renameObject<Preferences>(PREFERENCES_INITIAL),
  });
  const sourcesPreserved = sourcesArePersisted(reopened.state.account, reopened.state.preferences, ACCOUNT_LOCALE);
  reopened.close();

  const physical = snapshot(path);
  return {
    rejected: attempted.rejected,
    error: attempted.error,
    sourcesPreserved,
    noProfileTarget: (physical.itemCounts.profile ?? 0) === 0,
    manifestStillSources:
      Object.keys(physical.bindings).sort().join(",") === "account,preferences" &&
      physical.bindings.account?.physicalKey === "account" &&
      physical.bindings.preferences?.physicalKey === "preferences",
  };
};

const runAliasMergeMisuse = (path: string) => {
  establishSources(path, ACCOUNT_LOCALE);

  const attempted = expectFailure(() => {
    const project = openAliasRenameProjectStore(path, {
      profile: renameObject<Profile>(PROFILE_INITIAL, { from: "account" }),
    });
    project.close();
  });

  const reopened = openAliasRenameProjectStore(path, {
    account: renameObject<Account>(ACCOUNT_INITIAL),
    preferences: renameObject<Preferences>(PREFERENCES_INITIAL),
  });
  const sourcesPreserved = sourcesArePersisted(reopened.state.account, reopened.state.preferences, ACCOUNT_LOCALE);
  reopened.close();

  const physical = snapshot(path);
  return {
    rejected: attempted.rejected,
    error: attempted.error,
    rejectedBecauseSecondSourceUnexplained: attempted.error.includes("preferences"),
    sourcesPreserved,
    noProfileTarget: (physical.itemCounts.profile ?? 0) === 0,
    manifestStillSources:
      Object.keys(physical.bindings).sort().join(",") === "account,preferences" &&
      physical.bindings.account?.physicalKey === "account" &&
      physical.bindings.preferences?.physicalKey === "preferences",
  };
};

const openMigrationContext = (path: string) => {
  const sk = new StorekeeperDB(path);
  const manifestHolder = sk.state<IdentityManifest[]>("__project_identity", [{
    id: "project-identity-manifest",
    bindings: {},
  }]);
  const account = sk.state<Account[]>("account", []);
  const preferences = sk.state<Preferences[]>("preferences", []);
  const profile = sk.state<Profile[]>("profile", []);
  return { sk, manifestHolder, account, preferences, profile };
};

const sourceMetadataPresent = (physical: PhysicalSnapshot): boolean =>
  physical.derivations.some((row) => row.state_key === "account" && row.path === "locale") &&
  physical.derivations.some((row) => row.state_key === "preferences" && row.path === "locale") &&
  (physical.projectionCounts.account ?? 0) === 1 &&
  (physical.projectionCounts.preferences ?? 0) === 1;

const sourceMetadataRetired = (physical: PhysicalSnapshot): boolean =>
  !physical.paths.some((row) => row.state_key === "account" || row.state_key === "preferences") &&
  !physical.derivations.some((row) => row.state_key === "account" || row.state_key === "preferences") &&
  (physical.projectionCounts.account ?? 0) === 0 &&
  (physical.projectionCounts.preferences ?? 0) === 0;

const exactSourcePathStats = (physical: PhysicalSnapshot): PathRow[] =>
  physical.paths.filter((row) => row.state_key === "account" || row.state_key === "preferences");

const resolveLocale = (
  accountLocale: string,
  preferencesLocale: string,
  policy?: ConflictPolicy,
): string => {
  if (accountLocale === preferencesLocale) return accountLocale;
  if (!policy) {
    throw new Error(`Merge conflict for locale: account=${accountLocale}, preferences=${preferencesLocale}; explicit policy required.`);
  }
  return policy === "prefer-account" ? accountLocale : preferencesLocale;
};

const executeMerge = (
  context: ReturnType<typeof openMigrationContext>,
  options: { policy?: ConflictPolicy; injectFailure?: boolean },
): string => {
  const { sk, manifestHolder, account, preferences, profile } = context;
  if (account.length !== 1 || preferences.length !== 1 || profile.length !== 0) {
    throw new Error("Merge migration requires one account source, one preferences source, and no profile target.");
  }

  const accountSource = account[0]!;
  const preferencesSource = preferences[0]!;
  const displayName = accountSource.displayName;
  const compactMode = preferencesSource.compactMode;
  const locale = resolveLocale(accountSource.locale, preferencesSource.locale, options.policy);
  const accountProjectionPaths = sk.debug().derivations("account").map((row) => row.path);
  const preferencesProjectionPaths = sk.debug().derivations("preferences").map((row) => row.path);

  sk.batch(() => {
    profile.push({ id: "PROFILE", displayName, compactMode, locale });
    account.splice(0, account.length);
    preferences.splice(0, preferences.length);
    manifestHolder[0]!.bindings = {
      profile: { physicalKey: "profile", kind: "object" },
    };
    sk.debug().evict("account", accountProjectionPaths);
    sk.debug().evict("preferences", preferencesProjectionPaths);
    sk.debug().compactMetadata({
      stateKey: "account",
      pathCountDecayFactor: 0,
      dropPathStatsBelow: 0,
    });
    sk.debug().compactMetadata({
      stateKey: "preferences",
      pathCountDecayFactor: 0,
      dropPathStatsBelow: 0,
    });
    if (options.injectFailure) throw new Error("injected merge migration failure");
  });

  return locale;
};

const establishSourceMetadata = (
  sk: StorekeeperDB,
  preferencesLocale: string,
): void => {
  sk.find<Dict>("account", { locale: ACCOUNT_LOCALE });
  sk.find<Dict>("preferences", { locale: preferencesLocale });
};

const runConflictFreeExplicitMerge = (path: string) => {
  establishSources(path, ACCOUNT_LOCALE);
  const context = openMigrationContext(path);
  establishSourceMetadata(context.sk, ACCOUNT_LOCALE);

  const beforeFailure = snapshot(path);
  const projectionEstablished = sourceMetadataPresent(beforeFailure);
  const sourcePathStatsBefore = exactSourcePathStats(beforeFailure);

  const injectedFailure = expectFailure(() => {
    executeMerge(context, { injectFailure: true });
  });

  const afterFailure = snapshot(path);
  const rollbackPreservedSources =
    context.account.length === 1 &&
    context.preferences.length === 1 &&
    sourcesArePersisted(context.account[0]!, context.preferences[0]!, ACCOUNT_LOCALE) &&
    (afterFailure.itemCounts.account ?? 0) === 1 &&
    (afterFailure.itemCounts.preferences ?? 0) === 1;
  const rollbackRemovedTarget = context.profile.length === 0 && (afterFailure.itemCounts.profile ?? 0) === 0;
  const rollbackPreservedManifest =
    Object.keys(afterFailure.bindings).sort().join(",") === "account,preferences" &&
    afterFailure.bindings.account?.physicalKey === "account" &&
    afterFailure.bindings.preferences?.physicalKey === "preferences";
  const rollbackPreservedDerivedMetadata = sourceMetadataPresent(afterFailure);
  const metadataCountersExactlyRestored =
    JSON.stringify(exactSourcePathStats(afterFailure)) === JSON.stringify(sourcePathStatsBefore);

  const selectedLocale = executeMerge(context, {});
  const afterSuccess = snapshot(path);
  const successfulPhysicalTransition =
    (afterSuccess.itemCounts.account ?? 0) === 0 &&
    (afterSuccess.itemCounts.preferences ?? 0) === 0 &&
    (afterSuccess.itemCounts.profile ?? 0) === 1;
  const successfulManifestTransition =
    Object.keys(afterSuccess.bindings).length === 1 &&
    afterSuccess.bindings.profile?.physicalKey === "profile";
  const retiredSourceMetadata = sourceMetadataRetired(afterSuccess);
  context.sk.close();

  const reopened = openAliasRenameProjectStore(path, {
    profile: renameObject<Profile>(PROFILE_INITIAL),
  });
  const transformedValuesPersisted =
    reopened.state.profile.displayName === ACCOUNT_NAME &&
    reopened.state.profile.compactMode === true &&
    reopened.state.profile.locale === ACCOUNT_LOCALE;
  reopened.close();

  const oldSourcesRejected = expectFailure(() => {
    const invalid = openAliasRenameProjectStore(path, {
      account: renameObject<Account>(ACCOUNT_INITIAL),
      preferences: renameObject<Preferences>(PREFERENCES_INITIAL),
    });
    invalid.close();
  });

  return {
    projectionEstablished,
    injectedFailureRejected: injectedFailure.rejected,
    injectedFailureError: injectedFailure.error,
    rollbackPreservedSources,
    rollbackRemovedTarget,
    rollbackPreservedManifest,
    rollbackPreservedDerivedMetadata,
    metadataCountersExactlyRestored,
    sourcePathStatsBefore,
    sourcePathStatsAfterFailure: exactSourcePathStats(afterFailure),
    selectedLocale,
    successfulPhysicalTransition,
    successfulManifestTransition,
    retiredSourceMetadata,
    transformedValuesPersisted,
    oldSourcesRejected: oldSourcesRejected.rejected,
    finalPhysical: afterSuccess,
  };
};

const runConflictingMerge = (path: string) => {
  const preferencesLocale = "ja-JP";
  establishSources(path, preferencesLocale);

  const withoutPolicy = openMigrationContext(path);
  establishSourceMetadata(withoutPolicy.sk, preferencesLocale);
  const beforeConflict = snapshot(path);
  const rejectedConflict = expectFailure(() => executeMerge(withoutPolicy, {}));
  const afterConflict = snapshot(path);
  const conflictRejectedBeforeValueIdentityMutation =
    rejectedConflict.rejected &&
    withoutPolicy.account.length === 1 &&
    withoutPolicy.preferences.length === 1 &&
    withoutPolicy.profile.length === 0 &&
    sourcesArePersisted(withoutPolicy.account[0]!, withoutPolicy.preferences[0]!, preferencesLocale) &&
    (afterConflict.itemCounts.profile ?? 0) === 0 &&
    JSON.stringify(afterConflict.bindings) === JSON.stringify(beforeConflict.bindings);
  withoutPolicy.sk.close();

  const withPolicy = openMigrationContext(path);
  const selectedLocale = executeMerge(withPolicy, { policy: "prefer-account" });
  withPolicy.sk.close();

  const reopened = openAliasRenameProjectStore(path, {
    profile: renameObject<Profile>(PROFILE_INITIAL),
  });
  const deterministicPolicyPersisted =
    reopened.state.profile.displayName === ACCOUNT_NAME &&
    reopened.state.profile.compactMode === true &&
    reopened.state.profile.locale === ACCOUNT_LOCALE;
  reopened.close();

  return {
    rejectedWithoutPolicy: rejectedConflict.rejected,
    rejectionError: rejectedConflict.error,
    explicitPolicyRequired: rejectedConflict.error.includes("explicit policy required"),
    conflictRejectedBeforeValueIdentityMutation,
    selectedPolicy: "prefer-account" as const,
    selectedLocale,
    deterministicPolicyPersisted,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-state-merge-boundary-"));
let validExperiment = false;

try {
  const A = runNaiveMerge(join(root, "a.sqlite"));
  const B = runAliasMergeMisuse(join(root, "b.sqlite"));
  const C = runConflictFreeExplicitMerge(join(root, "c.sqlite"));
  const D = runConflictingMerge(join(root, "d.sqlite"));

  const naiveMergeSafelyRejected =
    A.rejected && A.sourcesPreserved && A.noProfileTarget && A.manifestStillSources;

  const aliasMergeMisuseSafelyRejected =
    B.rejected &&
    B.rejectedBecauseSecondSourceUnexplained &&
    B.sourcesPreserved &&
    B.noProfileTarget &&
    B.manifestStillSources;

  const explicitConflictFreeMergeIsAtomicAndComplete =
    C.projectionEstablished &&
    C.injectedFailureRejected &&
    C.rollbackPreservedSources &&
    C.rollbackRemovedTarget &&
    C.rollbackPreservedManifest &&
    C.rollbackPreservedDerivedMetadata &&
    C.successfulPhysicalTransition &&
    C.successfulManifestTransition &&
    C.retiredSourceMetadata &&
    C.transformedValuesPersisted &&
    C.oldSourcesRejected;

  const conflictingMergeRequiresExplicitPolicy =
    D.rejectedWithoutPolicy &&
    D.explicitPolicyRequired &&
    D.conflictRejectedBeforeValueIdentityMutation &&
    D.selectedLocale === ACCOUNT_LOCALE &&
    D.deterministicPolicyPersisted;

  validExperiment =
    naiveMergeSafelyRejected &&
    aliasMergeMisuseSafelyRejected &&
    explicitConflictFreeMergeIsAtomicAndComplete &&
    conflictingMergeRequiresExplicitPolicy;

  const decision = !validExperiment
    ? "UNCERTAIN_MERGE_MIGRATION_BOUNDARY"
    : C.metadataCountersExactlyRestored
      ? "BOUNDARY_CONFIRMED_MERGE_REQUIRES_EXPLICIT_CONFLICT_AWARE_MIGRATION"
      : "BOUNDARY_CONFIRMED_WITH_METADATA_COUNTER_ROLLBACK_GAP";

  console.log(JSON.stringify({
    experiment: "many-to-one-declared-state-merge-migration",
    issue: 60,
    scenario: "account + preferences -> profile with duplicated locale conflict input",
    A,
    B,
    C,
    D,
    checks: {
      naiveMergeSafelyRejected,
      aliasMergeMisuseSafelyRejected,
      explicitConflictFreeMergeIsAtomicAndComplete,
      conflictingMergeRequiresExplicitPolicy,
      metadataCountersExactlyRestored: C.metadataCountersExactlyRestored,
    },
    decision,
    interpretation: validExperiment
      ? "Many-to-one merge remains an explicit semantic migration boundary. The current alias wrapper safely refuses consuming only one of two removed sources, and an explicit transform can merge atomically when conflict policy is declared."
      : "The experiment did not cleanly establish the many-to-one migration boundary.",
    uncertainty: {
      metadataCounterRollbackGapWouldRequireFollowUp: !C.metadataCountersExactlyRestored,
      collectionMergeUntested: true,
      concurrentVersionOpenUntested: true,
      migrationIdempotencyUntested: true,
      migrationPublicSurfaceUndecided: true,
      publicApiDecisionAuthorized: false,
    },
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

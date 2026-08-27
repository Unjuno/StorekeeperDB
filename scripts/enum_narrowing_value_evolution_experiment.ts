import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";

type ModeV1 = "auto" | "manual" | "legacy";
type ModeV2 = "auto" | "manual";

type JobV1 = {
  id: string;
  mode: ModeV1;
};

type JobV2 = {
  id: string;
  mode: ModeV2;
};

type JobMigration = {
  id: string;
  mode: ModeV1;
};

type ItemRow = {
  id: string;
  pos: number;
  value_json: string;
};

type PathRow = {
  path: string;
  observed_type: string | null;
  read_count: number;
  write_count: number;
};

type DerivationRow = {
  path: string;
  kind: string;
  state: string;
  use_count: number;
  storage_cost: number;
};

type ProjectionRow = {
  path: string;
  item_id: string;
  value_json: string;
};

type PhysicalSnapshot = {
  items: ItemRow[];
  paths: PathRow[];
  derivations: DerivationRow[];
  projections: ProjectionRow[];
};

const V1_INITIAL: JobV1 = { id: "JOB-1", mode: "auto" };
const V2_INITIAL: JobV2 = { id: "JOB-1", mode: "auto" };
const LEGACY_MODE: ModeV1 = "legacy";
const MAPPED_MODE: ModeV2 = "manual";

const snapshot = (path: string): PhysicalSnapshot => {
  const db = new DatabaseSync(path);
  const items = db.prepare(
    "SELECT id,pos,value_json FROM __sk_items WHERE state_key='jobs' ORDER BY pos,id",
  ).all() as ItemRow[];
  const paths = db.prepare(
    "SELECT path,observed_type,read_count,write_count FROM __sk_paths WHERE state_key='jobs' ORDER BY path",
  ).all() as PathRow[];
  const derivations = db.prepare(
    "SELECT path,kind,state,use_count,storage_cost FROM __sk_derivations WHERE state_key='jobs' ORDER BY path,kind",
  ).all() as DerivationRow[];
  const projections = db.prepare(
    "SELECT path,item_id,value_json FROM __sk_projection WHERE state_key='jobs' ORDER BY path,item_id",
  ).all() as ProjectionRow[];
  db.close();
  return { items, paths, derivations, projections };
};

const sameSnapshot = (a: PhysicalSnapshot, b: PhysicalSnapshot): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const runtimeMode = (job: JobV2 | JobMigration): unknown =>
  (job as unknown as { mode: unknown }).mode;

const expectFailure = (run: () => void): { rejected: boolean; error: string } => {
  try {
    run();
    return { rejected: false, error: "" };
  } catch (caught) {
    return { rejected: true, error: caught instanceof Error ? caught.message : String(caught) };
  }
};

const seedV1 = (path: string): void => {
  const sk = new StorekeeperDB(path);
  const jobs = sk.state<JobV1[]>("jobs", [V1_INITIAL]);
  jobs[0]!.mode = LEGACY_MODE;
  const projected = sk.find<Dict>("jobs", { mode: LEGACY_MODE });
  if (projected.length !== 1) throw new Error("V1 enum projection setup failed.");
  sk.close();
};

const runDeclarationOnlyNegativeControl = (path: string) => {
  seedV1(path);
  const before = snapshot(path);

  let openRejected = false;
  let error = "";
  let raw: unknown;
  try {
    const sk = new StorekeeperDB(path);
    const jobs = sk.state<JobV2[]>("jobs", [V2_INITIAL]);
    raw = runtimeMode(jobs[0]!);
    sk.close();
  } catch (caught) {
    openRejected = true;
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const after = snapshot(path);
  const runtimeLegacyPreserved = !openRejected && raw === LEGACY_MODE;
  const freshAllowedDefaultNotApplied = !openRejected && raw !== V2_INITIAL.mode;
  const samePhysicalItemIdentity =
    before.items.length === 1 &&
    after.items.length === 1 &&
    before.items[0]!.id === after.items[0]!.id;
  const legacyProjectionStillMatchesStorage =
    after.derivations.some((row) => row.path === "mode") &&
    after.projections.some((row) => row.path === "mode" && row.value_json === JSON.stringify(LEGACY_MODE));

  return {
    openRejected,
    error,
    runtimeLegacyPreserved,
    freshAllowedDefaultNotApplied,
    samePhysicalItemIdentity,
    legacyProjectionStillMatchesStorage,
    runtimeValue: raw,
    before,
    after,
  };
};

const openMigrationContext = (path: string) => {
  const sk = new StorekeeperDB(path);
  const jobs = sk.state<JobMigration[]>("jobs", []);
  return { sk, jobs };
};

const executeEnumNarrowingMigration = (
  context: ReturnType<typeof openMigrationContext>,
  options: { legacyMapping?: ModeV2; injectFailure?: boolean },
): ModeV2 => {
  const { sk, jobs } = context;
  let selected: ModeV2 = "auto";

  sk.batch(() => {
    if (jobs.length !== 1) throw new Error("Enum narrowing migration requires exactly one job fixture.");

    const job = jobs[0]!;
    const source = job.mode;
    if (source === "auto" || source === "manual") {
      selected = source;
    } else if (source === "legacy") {
      if (!options.legacyMapping) {
        throw new Error("Enum narrowing migration requires explicit legacy mapping policy.");
      }
      selected = options.legacyMapping;
      job.mode = selected;
    } else {
      throw new Error(`Unexpected persisted mode: ${String(source)}`);
    }

    if (options.injectFailure) {
      throw new Error("injected enum narrowing migration failure");
    }
  });

  return selected;
};

const projectionValueForMode = (physical: PhysicalSnapshot): string | undefined =>
  physical.projections.find((row) => row.path === "mode")?.value_json;

const runExplicitMigration = (path: string) => {
  seedV1(path);
  const context = openMigrationContext(path);
  const beforeFailure = snapshot(path);

  const injectedFailure = expectFailure(() => {
    executeEnumNarrowingMigration(context, {
      legacyMapping: MAPPED_MODE,
      injectFailure: true,
    });
  });

  const afterFailure = snapshot(path);
  const exactPhysicalRollback = sameSnapshot(beforeFailure, afterFailure);
  const loadedMemoryRollback = runtimeMode(context.jobs[0]!) === LEGACY_MODE;

  const selectedMode = executeEnumNarrowingMigration(context, {
    legacyMapping: MAPPED_MODE,
  });

  const afterSuccessBeforeQueries = snapshot(path);
  const projectionUpdatedByOrdinaryMutation =
    afterSuccessBeforeQueries.derivations.some((row) => row.path === "mode") &&
    projectionValueForMode(afterSuccessBeforeQueries) === JSON.stringify(MAPPED_MODE) &&
    !afterSuccessBeforeQueries.projections.some(
      (row) => row.path === "mode" && row.value_json === JSON.stringify(LEGACY_MODE),
    );

  const legacyMatches = context.sk.find<Dict>("jobs", { mode: LEGACY_MODE });
  const manualMatches = context.sk.find<Dict>("jobs", { mode: MAPPED_MODE });
  const queriesReflectNarrowedValue = legacyMatches.length === 0 && manualMatches.length === 1;

  const durableHandle = manualMatches[0] as unknown as JobV2 | undefined;
  const durableHandleReturned = Boolean(durableHandle);
  if (durableHandle) {
    durableHandle.mode = "auto";
    durableHandle.mode = MAPPED_MODE;
  }

  const afterHandleMutation = snapshot(path);
  const projectionStillCoherentAfterHandleMutation =
    projectionValueForMode(afterHandleMutation) === JSON.stringify(MAPPED_MODE) &&
    !afterHandleMutation.projections.some(
      (row) => row.path === "mode" && row.value_json === JSON.stringify(LEGACY_MODE),
    );

  context.sk.close();

  const reopened = new StorekeeperDB(path);
  const jobs = reopened.state<JobV2[]>("jobs", [V2_INITIAL]);
  const reopenedMode = runtimeMode(jobs[0]!);
  const reopenedAllowedV2Value = reopenedMode === "auto" || reopenedMode === "manual";
  const reopenedMappedMode = reopenedMode === MAPPED_MODE;
  reopened.close();

  return {
    injectedFailureRejected: injectedFailure.rejected,
    injectedFailureError: injectedFailure.error,
    exactPhysicalRollback,
    loadedMemoryRollback,
    selectedMode,
    projectionUpdatedByOrdinaryMutation,
    legacyQueryCount: legacyMatches.length,
    manualQueryCount: manualMatches.length,
    queriesReflectNarrowedValue,
    durableHandleReturned,
    projectionStillCoherentAfterHandleMutation,
    reopenedMode,
    reopenedAllowedV2Value,
    reopenedMappedMode,
    beforeFailure,
    afterFailure,
    afterSuccessBeforeQueries,
    afterHandleMutation,
  };
};

const runMissingPolicyNegativeControl = (path: string) => {
  seedV1(path);
  const context = openMigrationContext(path);
  const before = snapshot(path);

  const attempted = expectFailure(() => {
    executeEnumNarrowingMigration(context, {});
  });

  const after = snapshot(path);
  const valueStillLegacy = runtimeMode(context.jobs[0]!) === LEGACY_MODE;
  const exactPhysicalRollback = sameSnapshot(before, after);
  context.sk.close();

  return {
    rejected: attempted.rejected,
    error: attempted.error,
    explicitPolicyRequired: attempted.error.includes("explicit legacy mapping policy"),
    valueStillLegacy,
    exactPhysicalRollback,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-enum-narrowing-"));
let validExperiment = false;

try {
  const A = runDeclarationOnlyNegativeControl(join(root, "a.sqlite"));
  const B = runExplicitMigration(join(root, "b.sqlite"));
  const C = runMissingPolicyNegativeControl(join(root, "c.sqlite"));

  const declarationOnlyLeavesDisallowedRuntimeValue =
    !A.openRejected &&
    A.runtimeLegacyPreserved &&
    A.freshAllowedDefaultNotApplied &&
    A.samePhysicalItemIdentity &&
    A.legacyProjectionStillMatchesStorage;

  const explicitMigrationCoreWorks =
    B.injectedFailureRejected &&
    B.exactPhysicalRollback &&
    B.loadedMemoryRollback &&
    B.selectedMode === MAPPED_MODE &&
    B.durableHandleReturned &&
    B.reopenedAllowedV2Value &&
    B.reopenedMappedMode;

  const missingPolicyRejectedAtomically =
    C.rejected &&
    C.explicitPolicyRequired &&
    C.valueStillLegacy &&
    C.exactPhysicalRollback;

  const projectionCoherent =
    B.projectionUpdatedByOrdinaryMutation &&
    B.queriesReflectNarrowedValue &&
    B.projectionStillCoherentAfterHandleMutation;

  const unexpectedRuntimeValidation =
    A.openRejected && sameSnapshot(A.before, A.after);

  validExperiment =
    unexpectedRuntimeValidation ||
    (declarationOnlyLeavesDisallowedRuntimeValue &&
      explicitMigrationCoreWorks &&
      missingPolicyRejectedAtomically);

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : unexpectedRuntimeValidation
      ? "UNEXPECTED_RUNTIME_VALIDATION"
      : projectionCoherent
        ? "BOUNDARY_CONFIRMED_ENUM_NARROWING_REQUIRES_EXPLICIT_VALUE_POLICY"
        : "MIXED_RUNTIME_SUPPORT_WITH_PROJECTION_GAP";

  console.log(JSON.stringify({
    experiment: "enum-narrowing-incompatible-value-evolution",
    issue: 66,
    scenario: "jobs.mode 'auto'|'manual'|'legacy' -> 'auto'|'manual' under stable durable identity",
    A,
    B,
    C,
    checks: {
      declarationOnlyLeavesDisallowedRuntimeValue,
      explicitMigrationCoreWorks,
      missingPolicyRejectedAtomically,
      projectionCoherent,
      unexpectedRuntimeValidation,
    },
    decision,
    interpretation: unexpectedRuntimeValidation
      ? "The runtime unexpectedly rejected persisted data based on the narrower declaration; this differs from the current static-TypeScript-only model and requires separate analysis."
      : validExperiment
        ? "Enum narrowing is a semantic value boundary: the narrower TypeScript union does not transform persisted 'legacy'. An explicit mapping policy is required, while ordinary durable mutation keeps the existing scalar projection coherent in this scenario."
        : "The experiment did not cleanly establish enum-narrowing behavior.",
    uncertainty: {
      independentRequiredFieldIntroductionUntested: true,
      fieldDeletionUntested: true,
      numericRangeValidationUntested: true,
      crossItemInvariantUntested: true,
      migrationIdempotencyUntested: true,
      concurrentVersionOpenUntested: true,
      publicMigrationSurfaceUndecided: true,
      publicApiDecisionAuthorized: false,
    },
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

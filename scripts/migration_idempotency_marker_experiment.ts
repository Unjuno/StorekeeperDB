import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";

type Queue = "fast" | "bulk";

type Job = {
  id: string;
  queue: Queue;
  maxRetries?: number;
};

type MigrationMarker = {
  id: string;
  version: number;
};

type ItemRow = {
  state_key: string;
  id: string;
  pos: number;
  value_json: string;
};

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

type ProjectionRow = {
  state_key: string;
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

type MigrationStatus = "applied" | "already-applied";
type FailurePoint = "after-value" | "after-marker";

const JOBS_KEY = "jobs";
const MARKERS_KEY = "__migration_state";
const MIGRATION_ID = "jobs-required-maxRetries-v2";
const MIGRATION_VERSION = 1;
const BACKFILL_MAX_RETRIES = 3;
const V1_JOB: Job = { id: "JOB-1", queue: "bulk" };

const snapshot = (path: string): PhysicalSnapshot => {
  const db = new DatabaseSync(path);
  const keys = [JOBS_KEY, MARKERS_KEY];
  const placeholders = keys.map(() => "?").join(",");
  const items = db.prepare(
    `SELECT state_key,id,pos,value_json FROM __sk_items WHERE state_key IN (${placeholders}) ORDER BY state_key,pos,id`,
  ).all(...keys) as ItemRow[];
  const paths = db.prepare(
    `SELECT state_key,path,observed_type,read_count,write_count FROM __sk_paths WHERE state_key IN (${placeholders}) ORDER BY state_key,path`,
  ).all(...keys) as PathRow[];
  const derivations = db.prepare(
    `SELECT state_key,path,kind,state,use_count,storage_cost FROM __sk_derivations WHERE state_key IN (${placeholders}) ORDER BY state_key,path,kind`,
  ).all(...keys) as DerivationRow[];
  const projections = db.prepare(
    `SELECT state_key,path,item_id,value_json FROM __sk_projection WHERE state_key IN (${placeholders}) ORDER BY state_key,path,item_id`,
  ).all(...keys) as ProjectionRow[];
  db.close();
  return { items, paths, derivations, projections };
};

const sameSnapshot = (a: PhysicalSnapshot, b: PhysicalSnapshot): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const sameItems = (a: PhysicalSnapshot, b: PhysicalSnapshot): boolean =>
  JSON.stringify(a.items) === JSON.stringify(b.items);

const totalWriteCount = (physical: PhysicalSnapshot): number =>
  physical.paths.reduce((sum, row) => sum + row.write_count, 0);

const markerRows = (physical: PhysicalSnapshot): ItemRow[] =>
  physical.items.filter((row) => row.state_key === MARKERS_KEY);

const jobRows = (physical: PhysicalSnapshot): ItemRow[] =>
  physical.items.filter((row) => row.state_key === JOBS_KEY);

const parsedJobMaxRetries = (physical: PhysicalSnapshot): unknown => {
  const row = jobRows(physical)[0];
  if (!row) return undefined;
  return (JSON.parse(row.value_json) as { maxRetries?: unknown }).maxRetries;
};

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
  const jobs = sk.state<Job[]>(JOBS_KEY, [V1_JOB]);
  const projected = sk.find<Dict>(JOBS_KEY, { queue: "bulk" });
  if (projected.length !== 1) throw new Error("V1 queue projection setup failed.");
  sk.close();
};

const openContext = (path: string) => {
  const sk = new StorekeeperDB(path);
  const jobs = sk.state<Job[]>(JOBS_KEY, []);
  const markers = sk.state<MigrationMarker[]>(MARKERS_KEY, []);
  return { sk, jobs, markers };
};

const migrationMarkers = (markers: MigrationMarker[]): MigrationMarker[] =>
  markers.filter((marker) => marker.id === MIGRATION_ID);

const executeMigration = (
  context: ReturnType<typeof openContext>,
  options: { failurePoint?: FailurePoint } = {},
): MigrationStatus => {
  const { sk, jobs, markers } = context;
  let result: MigrationStatus = "applied";

  sk.batch(() => {
    if (jobs.length !== 1) throw new Error("Migration marker experiment requires exactly one job.");

    const job = jobs[0]!;
    const matchingMarkers = migrationMarkers(markers);
    if (matchingMarkers.length > 1) {
      throw new Error("Duplicate migration markers detected.");
    }

    const marker = matchingMarkers[0];
    const currentMaxRetries = job.maxRetries;

    if (marker) {
      if (marker.version !== MIGRATION_VERSION) {
        throw new Error(`Unexpected migration marker version: ${marker.version}`);
      }
      if (currentMaxRetries !== BACKFILL_MAX_RETRIES) {
        throw new Error("Migration marker/value inconsistency: marker present but value is not migrated.");
      }
      result = "already-applied";
      return;
    }

    if (currentMaxRetries !== undefined) {
      throw new Error("Ambiguous migration state: migrated value present without applied marker.");
    }

    job.maxRetries = BACKFILL_MAX_RETRIES;
    if (options.failurePoint === "after-value") {
      throw new Error("injected failure after value mutation");
    }

    markers.push({ id: MIGRATION_ID, version: MIGRATION_VERSION });
    if (options.failurePoint === "after-marker") {
      throw new Error("injected failure after marker mutation");
    }

    result = "applied";
  });

  return result;
};

const runAtomicRestartSequence = (path: string) => {
  seedV1(path);

  const first = openContext(path);
  const beforeAfterValueFailure = snapshot(path);
  const afterValueFailure = expectFailure(() => {
    executeMigration(first, { failurePoint: "after-value" });
  });
  const afterAfterValueFailure = snapshot(path);
  const afterValueExactRollback = sameSnapshot(beforeAfterValueFailure, afterAfterValueFailure);
  first.sk.close();

  const second = openContext(path);
  const beforeAfterMarkerFailure = snapshot(path);
  const afterMarkerFailure = expectFailure(() => {
    executeMigration(second, { failurePoint: "after-marker" });
  });
  const afterAfterMarkerFailure = snapshot(path);
  const afterMarkerExactRollback = sameSnapshot(beforeAfterMarkerFailure, afterAfterMarkerFailure);
  second.sk.close();

  const third = openContext(path);
  const successfulStatus = executeMigration(third);
  third.sk.close();
  const afterSuccess = snapshot(path);

  const fourth = openContext(path);
  const beforeRerun = snapshot(path);
  const beforeRerunWriteCount = totalWriteCount(beforeRerun);
  const rerunStatus = executeMigration(fourth);
  const afterRerun = snapshot(path);
  const afterRerunWriteCount = totalWriteCount(afterRerun);
  fourth.sk.close();

  const markerCountAfterSuccess = markerRows(afterSuccess).length;
  const migratedAfterSuccess = parsedJobMaxRetries(afterSuccess) === BACKFILL_MAX_RETRIES;
  const sourceItemsUnchangedOnRerun = sameItems(beforeRerun, afterRerun);
  const pathWriteCountsUnchangedOnRerun = beforeRerunWriteCount === afterRerunWriteCount;
  const observationMetadataChangedOnRerun =
    JSON.stringify(beforeRerun.paths) !== JSON.stringify(afterRerun.paths);
  const oneMarkerAfterRerun = markerRows(afterRerun).length === 1;

  return {
    afterValueFailureRejected: afterValueFailure.rejected,
    afterValueFailureError: afterValueFailure.error,
    afterValueExactRollback,
    afterMarkerFailureRejected: afterMarkerFailure.rejected,
    afterMarkerFailureError: afterMarkerFailure.error,
    afterMarkerExactRollback,
    successfulStatus,
    markerCountAfterSuccess,
    migratedAfterSuccess,
    rerunStatus,
    sourceItemsUnchangedOnRerun,
    pathWriteCountsUnchangedOnRerun,
    observationMetadataChangedOnRerun,
    beforeRerunWriteCount,
    afterRerunWriteCount,
    oneMarkerAfterRerun,
    beforeAfterValueFailure,
    afterAfterValueFailure,
    beforeAfterMarkerFailure,
    afterAfterMarkerFailure,
    afterSuccess,
    beforeRerun,
    afterRerun,
  };
};

const seedMarkerPresentValueUnmigrated = (path: string): void => {
  seedV1(path);
  const context = openContext(path);
  context.markers.push({ id: MIGRATION_ID, version: MIGRATION_VERSION });
  context.sk.close();
};

const runMarkerPresentValueUnmigrated = (path: string) => {
  seedMarkerPresentValueUnmigrated(path);
  const context = openContext(path);
  const before = snapshot(path);
  const attempted = expectFailure(() => executeMigration(context));
  const after = snapshot(path);
  context.sk.close();

  return {
    rejected: attempted.rejected,
    error: attempted.error,
    inconsistencyDetected: attempted.error.includes("marker present but value is not migrated"),
    exactPhysicalRollback: sameSnapshot(before, after),
    valueStillUnmigrated: parsedJobMaxRetries(after) === undefined,
    markerStillPresent: markerRows(after).length === 1,
    before,
    after,
  };
};

const seedMarkerAbsentValueMigrated = (path: string): void => {
  seedV1(path);
  const context = openContext(path);
  context.jobs[0]!.maxRetries = BACKFILL_MAX_RETRIES;
  context.sk.close();
};

const runMarkerAbsentValueMigrated = (path: string) => {
  seedMarkerAbsentValueMigrated(path);
  const context = openContext(path);
  const before = snapshot(path);
  const attempted = expectFailure(() => executeMigration(context));
  const after = snapshot(path);
  context.sk.close();

  return {
    rejected: attempted.rejected,
    error: attempted.error,
    ambiguityDetected: attempted.error.includes("migrated value present without applied marker"),
    exactPhysicalRollback: sameSnapshot(before, after),
    valueStillMigrated: parsedJobMaxRetries(after) === BACKFILL_MAX_RETRIES,
    markerStillAbsent: markerRows(after).length === 0,
    before,
    after,
  };
};

const runSplitCommitNegativeControl = (path: string, order: "value-first" | "marker-first") => {
  seedV1(path);
  const context = openContext(path);

  if (order === "value-first") {
    context.sk.batch(() => {
      context.jobs[0]!.maxRetries = BACKFILL_MAX_RETRIES;
    });
  } else {
    context.sk.batch(() => {
      context.markers.push({ id: MIGRATION_ID, version: MIGRATION_VERSION });
    });
  }
  context.sk.close();

  const afterInterruptedCommit = snapshot(path);
  const reopened = openContext(path);
  const retry = expectFailure(() => executeMigration(reopened));
  const afterRetry = snapshot(path);
  reopened.sk.close();

  return {
    order,
    retryRejected: retry.rejected,
    retryError: retry.error,
    strandedStateDetected:
      order === "value-first"
        ? retry.error.includes("migrated value present without applied marker")
        : retry.error.includes("marker present but value is not migrated"),
    retryDidNotMutate: sameSnapshot(afterInterruptedCommit, afterRetry),
    markerPresent: markerRows(afterInterruptedCommit).length === 1,
    valueMigrated: parsedJobMaxRetries(afterInterruptedCommit) === BACKFILL_MAX_RETRIES,
    afterInterruptedCommit,
    afterRetry,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-migration-marker-"));
let validExperiment = false;

try {
  const AandB = runAtomicRestartSequence(join(root, "atomic.sqlite"));
  const C = runMarkerPresentValueUnmigrated(join(root, "marker-without-value.sqlite"));
  const D = runMarkerAbsentValueMigrated(join(root, "value-without-marker.sqlite"));
  const E1 = runSplitCommitNegativeControl(join(root, "split-value-first.sqlite"), "value-first");
  const E2 = runSplitCommitNegativeControl(join(root, "split-marker-first.sqlite"), "marker-first");

  const bothInjectedFailuresRollbackAtomically =
    AandB.afterValueFailureRejected &&
    AandB.afterValueExactRollback &&
    AandB.afterMarkerFailureRejected &&
    AandB.afterMarkerExactRollback;

  const successfulAtomicCommit =
    AandB.successfulStatus === "applied" &&
    AandB.markerCountAfterSuccess === 1 &&
    AandB.migratedAfterSuccess;

  const idempotentRerun =
    AandB.rerunStatus === "already-applied" &&
    AandB.sourceItemsUnchangedOnRerun &&
    AandB.pathWriteCountsUnchangedOnRerun &&
    AandB.oneMarkerAfterRerun;

  const inconsistentPairsRejected =
    C.rejected &&
    C.inconsistencyDetected &&
    C.exactPhysicalRollback &&
    C.valueStillUnmigrated &&
    C.markerStillPresent &&
    D.rejected &&
    D.ambiguityDetected &&
    D.exactPhysicalRollback &&
    D.valueStillMigrated &&
    D.markerStillAbsent;

  const splitCommitCanStrandInconsistentState =
    E1.retryRejected &&
    E1.strandedStateDetected &&
    E1.retryDidNotMutate &&
    E1.valueMigrated &&
    !E1.markerPresent &&
    E2.retryRejected &&
    E2.strandedStateDetected &&
    E2.retryDidNotMutate &&
    !E2.valueMigrated &&
    E2.markerPresent;

  validExperiment =
    bothInjectedFailuresRollbackAtomically &&
    successfulAtomicCommit &&
    idempotentRerun &&
    inconsistentPairsRejected &&
    splitCommitCanStrandInconsistentState;

  const decision = validExperiment
    ? "CANDIDATE_MINIMAL_ATOMIC_MIGRATION_MARKER_SUFFICIENT"
    : "INVALID_EXPERIMENT";

  console.log(JSON.stringify({
    experiment: "migration-idempotency-and-crash-retry-marker",
    issue: 70,
    convention: {
      markerState: MARKERS_KEY,
      migrationId: MIGRATION_ID,
      version: MIGRATION_VERSION,
      policy: "atomic semantic transform + applied marker + strict marker/value preconditions",
      publicApi: false,
    },
    AandB,
    C,
    D,
    E1,
    E2,
    checks: {
      bothInjectedFailuresRollbackAtomically,
      successfulAtomicCommit,
      idempotentRerun,
      inconsistentPairsRejected,
      splitCommitCanStrandInconsistentState,
      observationMetadataChangedOnRerun: AandB.observationMetadataChangedOnRerun,
    },
    decision,
    interpretation: validExperiment
      ? "For this local SQLite migration, one applied marker is sufficient for restart-safe idempotency when marker and value commit in the same outer batch and marker/value pairs are validated strictly. Separate commits can strand both mismatch directions. Validation reads may still change observation metadata even when the semantic skip path performs no writes."
      : "The marker experiment did not establish a clean restart-safe idempotency contract.",
    uncertainty: {
      concurrentOldNewProcessesUntested: true,
      multipleWritersUntested: true,
      externalSideEffectsUntested: true,
      migrationDependencyOrderingUntested: true,
      markerScopeUndecided: true,
      observationMetadataCostNeedsInterpretation: AandB.observationMetadataChangedOnRerun,
      publicMigrationSurfaceUndecided: true,
      publicApiDecisionAuthorized: false,
    },
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";

type Queue = "fast" | "bulk";

type JobV1 = {
  id: string;
  queue: Queue;
};

type JobV2 = {
  id: string;
  queue: Queue;
  maxRetries: number;
};

type JobMigration = {
  id: string;
  queue: Queue;
  maxRetries?: number;
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

const V1_INITIAL: JobV1 = { id: "JOB-1", queue: "fast" };
const V2_INITIAL: JobV2 = { id: "JOB-1", queue: "fast", maxRetries: 99 };
const PERSISTED_QUEUE: Queue = "bulk";
const BACKFILL_MAX_RETRIES = 3;

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

const runtimeMaxRetries = (job: JobV2 | JobMigration): unknown =>
  (job as unknown as { maxRetries?: unknown }).maxRetries;

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
  jobs[0]!.queue = PERSISTED_QUEUE;
  const projected = sk.find<Dict>("jobs", { queue: PERSISTED_QUEUE });
  if (projected.length !== 1) throw new Error("V1 queue projection setup failed.");
  sk.close();
};

const projectionValue = (physical: PhysicalSnapshot, path: string): string | undefined =>
  physical.projections.find((row) => row.path === path)?.value_json;

const runDeclarationOnlyNegativeControl = (path: string) => {
  seedV1(path);
  const before = snapshot(path);

  let openRejected = false;
  let error = "";
  let rawMaxRetries: unknown;
  let runtimeQueue: unknown;
  try {
    const sk = new StorekeeperDB(path);
    const jobs = sk.state<JobV2[]>("jobs", [V2_INITIAL]);
    rawMaxRetries = runtimeMaxRetries(jobs[0]!);
    runtimeQueue = jobs[0]!.queue;
    sk.close();
  } catch (caught) {
    openRejected = true;
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const after = snapshot(path);
  const maxRetriesAbsentAtRuntime = !openRejected && rawMaxRetries === undefined;
  const freshV2DefaultNotMerged = !openRejected && rawMaxRetries !== V2_INITIAL.maxRetries;
  const freshV2DefaultApplied = !openRejected && rawMaxRetries === V2_INITIAL.maxRetries;
  const samePhysicalItemIdentity =
    before.items.length === 1 &&
    after.items.length === 1 &&
    before.items[0]!.id === after.items[0]!.id;
  const queueProjectionStillMatchesStorage =
    runtimeQueue === PERSISTED_QUEUE &&
    after.derivations.some((row) => row.path === "queue") &&
    projectionValue(after, "queue") === JSON.stringify(PERSISTED_QUEUE);

  return {
    openRejected,
    error,
    maxRetriesAbsentAtRuntime,
    freshV2DefaultNotMerged,
    freshV2DefaultApplied,
    samePhysicalItemIdentity,
    queueProjectionStillMatchesStorage,
    runtimeMaxRetries: rawMaxRetries,
    runtimeQueue,
    before,
    after,
  };
};

const openMigrationContext = (path: string) => {
  const sk = new StorekeeperDB(path);
  const jobs = sk.state<JobMigration[]>("jobs", []);
  return { sk, jobs };
};

const executeRequiredFieldBackfill = (
  context: ReturnType<typeof openMigrationContext>,
  options: { backfillMaxRetries?: number; injectFailure?: boolean },
): number => {
  const { sk, jobs } = context;
  let selected = -1;

  sk.batch(() => {
    if (jobs.length !== 1) throw new Error("Required-field migration requires exactly one job fixture.");

    const job = jobs[0]!;
    const current = job.maxRetries;
    if (current === undefined) {
      if (options.backfillMaxRetries === undefined) {
        throw new Error("Required-field migration requires explicit maxRetries backfill policy.");
      }
      if (!Number.isInteger(options.backfillMaxRetries) || options.backfillMaxRetries < 0) {
        throw new Error("Required-field maxRetries backfill must be a non-negative integer.");
      }
      selected = options.backfillMaxRetries;
      job.maxRetries = selected;
    } else {
      if (!Number.isInteger(current) || current < 0) {
        throw new Error(`Invalid persisted maxRetries: ${String(current)}`);
      }
      selected = current;
    }

    if (options.injectFailure) {
      throw new Error("injected required-field migration failure");
    }
  });

  return selected;
};

const runExplicitBackfill = (path: string) => {
  seedV1(path);
  const context = openMigrationContext(path);
  const beforeFailure = snapshot(path);

  const injectedFailure = expectFailure(() => {
    executeRequiredFieldBackfill(context, {
      backfillMaxRetries: BACKFILL_MAX_RETRIES,
      injectFailure: true,
    });
  });

  const afterFailure = snapshot(path);
  const exactPhysicalRollback = sameSnapshot(beforeFailure, afterFailure);
  const loadedMemoryRollback = runtimeMaxRetries(context.jobs[0]!) === undefined;

  const selectedMaxRetries = executeRequiredFieldBackfill(context, {
    backfillMaxRetries: BACKFILL_MAX_RETRIES,
  });

  const afterSuccessBeforeQueries = snapshot(path);
  const requiredFieldPersistedBeforeQuery =
    afterSuccessBeforeQueries.items.length === 1 &&
    JSON.parse(afterSuccessBeforeQueries.items[0]!.value_json).maxRetries === BACKFILL_MAX_RETRIES;
  const queueProjectionPreservedAfterBackfill =
    afterSuccessBeforeQueries.derivations.some((row) => row.path === "queue") &&
    projectionValue(afterSuccessBeforeQueries, "queue") === JSON.stringify(PERSISTED_QUEUE);
  const maxRetriesProjectionAbsentBeforeQuery =
    !afterSuccessBeforeQueries.derivations.some((row) => row.path === "maxRetries") &&
    projectionValue(afterSuccessBeforeQueries, "maxRetries") === undefined;

  const queueMatches = context.sk.find<Dict>("jobs", { queue: PERSISTED_QUEUE });
  const retriesMatches = context.sk.find<Dict>("jobs", { maxRetries: BACKFILL_MAX_RETRIES });
  const queriesReflectBackfill = queueMatches.length === 1 && retriesMatches.length === 1;

  const durableHandle = retriesMatches[0] as unknown as JobV2 | undefined;
  const durableHandleReturned = Boolean(durableHandle);
  if (durableHandle) {
    durableHandle.maxRetries = 4;
    durableHandle.maxRetries = BACKFILL_MAX_RETRIES;
  }

  const afterHandleMutation = snapshot(path);
  const maxRetriesProjectionCoherent =
    projectionValue(afterHandleMutation, "maxRetries") === JSON.stringify(BACKFILL_MAX_RETRIES);
  const queueProjectionStillCoherent =
    projectionValue(afterHandleMutation, "queue") === JSON.stringify(PERSISTED_QUEUE);

  context.sk.close();

  const reopened = new StorekeeperDB(path);
  const jobs = reopened.state<JobV2[]>("jobs", [V2_INITIAL]);
  const reopenedMaxRetries = runtimeMaxRetries(jobs[0]!);
  const reopenedQueue = jobs[0]!.queue;
  reopened.close();

  return {
    injectedFailureRejected: injectedFailure.rejected,
    injectedFailureError: injectedFailure.error,
    exactPhysicalRollback,
    loadedMemoryRollback,
    selectedMaxRetries,
    requiredFieldPersistedBeforeQuery,
    queueProjectionPreservedAfterBackfill,
    maxRetriesProjectionAbsentBeforeQuery,
    queueQueryCount: queueMatches.length,
    maxRetriesQueryCount: retriesMatches.length,
    queriesReflectBackfill,
    durableHandleReturned,
    maxRetriesProjectionCoherent,
    queueProjectionStillCoherent,
    reopenedMaxRetries,
    reopenedQueue,
    reopenedBackfillPreserved: reopenedMaxRetries === BACKFILL_MAX_RETRIES,
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
    executeRequiredFieldBackfill(context, {});
  });

  const after = snapshot(path);
  const valueStillAbsent = runtimeMaxRetries(context.jobs[0]!) === undefined;
  const exactPhysicalRollback = sameSnapshot(before, after);
  context.sk.close();

  return {
    rejected: attempted.rejected,
    error: attempted.error,
    explicitPolicyRequired: attempted.error.includes("explicit maxRetries backfill policy"),
    valueStillAbsent,
    exactPhysicalRollback,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-required-field-"));
let validExperiment = false;

try {
  const A = runDeclarationOnlyNegativeControl(join(root, "a.sqlite"));
  const B = runExplicitBackfill(join(root, "b.sqlite"));
  const C = runMissingPolicyNegativeControl(join(root, "c.sqlite"));

  const declarationOnlyLeavesRequiredFieldMissing =
    !A.openRejected &&
    A.maxRetriesAbsentAtRuntime &&
    A.freshV2DefaultNotMerged &&
    A.samePhysicalItemIdentity &&
    A.queueProjectionStillMatchesStorage;

  const explicitBackfillCoreWorks =
    B.injectedFailureRejected &&
    B.exactPhysicalRollback &&
    B.loadedMemoryRollback &&
    B.selectedMaxRetries === BACKFILL_MAX_RETRIES &&
    B.requiredFieldPersistedBeforeQuery &&
    B.reopenedBackfillPreserved &&
    B.reopenedQueue === PERSISTED_QUEUE;

  const missingPolicyRejectedAtomically =
    C.rejected &&
    C.explicitPolicyRequired &&
    C.valueStillAbsent &&
    C.exactPhysicalRollback;

  const metadataAndQueryCoherent =
    B.queueProjectionPreservedAfterBackfill &&
    B.maxRetriesProjectionAbsentBeforeQuery &&
    B.queriesReflectBackfill &&
    B.durableHandleReturned &&
    B.maxRetriesProjectionCoherent &&
    B.queueProjectionStillCoherent;

  const unexpectedRuntimeDefaultingOrValidation =
    A.openRejected || A.freshV2DefaultApplied;

  validExperiment =
    unexpectedRuntimeDefaultingOrValidation ||
    (declarationOnlyLeavesRequiredFieldMissing &&
      explicitBackfillCoreWorks &&
      missingPolicyRejectedAtomically);

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : unexpectedRuntimeDefaultingOrValidation
      ? "UNEXPECTED_RUNTIME_DEFAULTING_OR_VALIDATION"
      : metadataAndQueryCoherent
        ? "BOUNDARY_CONFIRMED_REQUIRED_FIELD_REQUIRES_EXPLICIT_BACKFILL_POLICY"
        : "MIXED_RUNTIME_SUPPORT_WITH_METADATA_GAP";

  console.log(JSON.stringify({
    experiment: "required-field-incompatible-value-evolution",
    issue: 68,
    scenario: "jobs {id,queue} -> {id,queue,maxRetries} under stable durable identity",
    A,
    B,
    C,
    checks: {
      declarationOnlyLeavesRequiredFieldMissing,
      explicitBackfillCoreWorks,
      missingPolicyRejectedAtomically,
      metadataAndQueryCoherent,
      unexpectedRuntimeDefaultingOrValidation,
    },
    decision,
    interpretation: unexpectedRuntimeDefaultingOrValidation
      ? "The runtime unexpectedly validated or default-merged the newly required field; this differs from the current static-TypeScript-only model and requires separate analysis."
      : validExperiment
        ? "Required-field introduction is a semantic invariant boundary: the TypeScript declaration does not backfill persisted V1 objects. An explicit application backfill policy is required; metadata/query behavior is reported separately so a persistence-mechanics gap remains distinguishable from the semantic obligation."
        : "The experiment did not cleanly establish required-field behavior.",
    uncertainty: {
      fieldDeletionUntested: true,
      numericRangeValidationBeyondBackfillUntested: true,
      crossFieldInvariantUntested: true,
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

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";

type JobV1 = {
  id: string;
  retryPolicy: number;
};

type RetryPolicyV2 = {
  delayMs: number;
  maxAttempts: number;
};

type JobV2 = {
  id: string;
  retryPolicy: RetryPolicyV2;
};

type JobMigration = {
  id: string;
  retryPolicy: number | RetryPolicyV2;
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

const INITIAL_DELAY_MS = 100;
const PERSISTED_DELAY_MS = 750;
const MAX_ATTEMPTS_POLICY = 3;

const V1_INITIAL: JobV1 = {
  id: "JOB-1",
  retryPolicy: INITIAL_DELAY_MS,
};

const V2_INITIAL: JobV2 = {
  id: "JOB-1",
  retryPolicy: {
    delayMs: INITIAL_DELAY_MS,
    maxAttempts: 1,
  },
};

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

const runtimeRetryPolicy = (job: JobV2 | JobMigration): unknown =>
  (job as unknown as { retryPolicy: unknown }).retryPolicy;

const seedV1 = (path: string): void => {
  const sk = new StorekeeperDB(path);
  const jobs = sk.state<JobV1[]>("jobs", [V1_INITIAL]);
  jobs[0]!.retryPolicy = PERSISTED_DELAY_MS;
  const projected = sk.find<Dict>("jobs", { retryPolicy: PERSISTED_DELAY_MS });
  if (projected.length !== 1) throw new Error("V1 projection setup failed.");
  sk.close();
};

const expectFailure = (run: () => void): { rejected: boolean; error: string } => {
  try {
    run();
    return { rejected: false, error: "" };
  } catch (caught) {
    return { rejected: true, error: caught instanceof Error ? caught.message : String(caught) };
  }
};

const runDeclarationOnlyNegativeControl = (path: string) => {
  seedV1(path);
  const before = snapshot(path);

  const sk = new StorekeeperDB(path);
  const jobs = sk.state<JobV2[]>("jobs", [V2_INITIAL]);
  const raw = runtimeRetryPolicy(jobs[0]!);
  const runtimeScalarPreserved = typeof raw === "number" && raw === PERSISTED_DELAY_MS;
  const automaticObjectConversionAbsent = typeof raw !== "object" || raw === null;
  const freshV2DefaultNotApplied = raw !== V2_INITIAL.retryPolicy;
  sk.close();

  const after = snapshot(path);
  const samePhysicalItemIdentity =
    before.items.length === 1 &&
    after.items.length === 1 &&
    before.items[0]!.id === after.items[0]!.id;
  const oldScalarProjectionStillPresent =
    after.derivations.some((row) => row.path === "retryPolicy") &&
    after.projections.some((row) => row.path === "retryPolicy" && row.value_json === JSON.stringify(PERSISTED_DELAY_MS));

  return {
    runtimeScalarPreserved,
    automaticObjectConversionAbsent,
    freshV2DefaultNotApplied,
    samePhysicalItemIdentity,
    oldScalarProjectionStillPresent,
    runtimeType: raw === null ? "null" : typeof raw,
    before,
    after,
  };
};

const openMigrationContext = (path: string) => {
  const sk = new StorekeeperDB(path);
  const jobs = sk.state<JobMigration[]>("jobs", []);
  return { sk, jobs };
};

const executeScalarToObjectMigration = (
  context: ReturnType<typeof openMigrationContext>,
  options: { maxAttempts?: number; injectFailure?: boolean },
): number => {
  const { sk, jobs } = context;
  let selectedDelayMs = -1;

  sk.batch(() => {
    if (jobs.length !== 1) throw new Error("Migration requires exactly one job fixture.");

    const job = jobs[0]!;
    const source = job.retryPolicy;
    if (typeof source !== "number") {
      throw new Error("Migration source retryPolicy must still be the V1 scalar.");
    }
    if (options.maxAttempts === undefined) {
      throw new Error("Scalar-to-object migration requires explicit maxAttempts policy.");
    }
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new Error("maxAttempts policy must be a positive integer.");
    }

    selectedDelayMs = source;
    const obsoleteProjectionPaths = sk.debug().derivations("jobs")
      .filter((row) => row.path === "retryPolicy")
      .map((row) => row.path);

    job.retryPolicy = {
      delayMs: source,
      maxAttempts: options.maxAttempts,
    };

    if (obsoleteProjectionPaths.length) {
      sk.debug().evict("jobs", obsoleteProjectionPaths);
    }

    if (options.injectFailure) {
      throw new Error("injected scalar-to-object migration failure");
    }
  });

  return selectedDelayMs;
};

const runExplicitMigration = (path: string) => {
  seedV1(path);
  const context = openMigrationContext(path);
  const beforeFailure = snapshot(path);

  const injectedFailure = expectFailure(() => {
    executeScalarToObjectMigration(context, {
      maxAttempts: MAX_ATTEMPTS_POLICY,
      injectFailure: true,
    });
  });

  const afterFailure = snapshot(path);
  const exactPhysicalRollback = sameSnapshot(beforeFailure, afterFailure);
  const rawAfterFailure = runtimeRetryPolicy(context.jobs[0]!);
  const loadedMemoryRollback =
    typeof rawAfterFailure === "number" && rawAfterFailure === PERSISTED_DELAY_MS;

  const selectedDelayMs = executeScalarToObjectMigration(context, {
    maxAttempts: MAX_ATTEMPTS_POLICY,
  });

  const afterSuccessBeforeNestedQuery = snapshot(path);
  const obsoleteScalarProjectionRetired =
    !afterSuccessBeforeNestedQuery.derivations.some((row) => row.path === "retryPolicy") &&
    !afterSuccessBeforeNestedQuery.projections.some((row) => row.path === "retryPolicy");

  const nestedMatches = context.sk.find<Dict>("jobs", {
    "retryPolicy.delayMs": PERSISTED_DELAY_MS,
  });
  const nestedQueryMatched = nestedMatches.length === 1;
  const nestedHandle = nestedMatches[0] as unknown as JobV2 | undefined;
  const nestedQueryReturnsDurableHandle = Boolean(nestedHandle);
  if (nestedHandle) nestedHandle.retryPolicy.maxAttempts = MAX_ATTEMPTS_POLICY + 1;

  const afterNestedQuery = snapshot(path);
  const nestedProjectionEstablished =
    afterNestedQuery.derivations.some((row) => row.path === "retryPolicy.delayMs") &&
    afterNestedQuery.projections.some((row) => row.path === "retryPolicy.delayMs");
  const obsoleteScalarProjectionStillAbsent =
    !afterNestedQuery.derivations.some((row) => row.path === "retryPolicy") &&
    !afterNestedQuery.projections.some((row) => row.path === "retryPolicy");

  context.sk.close();

  const reopened = new StorekeeperDB(path);
  const jobs = reopened.state<JobV2[]>("jobs", [V2_INITIAL]);
  const retryPolicy = runtimeRetryPolicy(jobs[0]!);
  const reopenedV2Object =
    typeof retryPolicy === "object" &&
    retryPolicy !== null &&
    (retryPolicy as RetryPolicyV2).delayMs === PERSISTED_DELAY_MS &&
    (retryPolicy as RetryPolicyV2).maxAttempts === MAX_ATTEMPTS_POLICY + 1;
  reopened.close();

  return {
    injectedFailureRejected: injectedFailure.rejected,
    injectedFailureError: injectedFailure.error,
    exactPhysicalRollback,
    loadedMemoryRollback,
    selectedDelayMs,
    obsoleteScalarProjectionRetired,
    nestedQueryMatched,
    nestedQueryReturnsDurableHandle,
    nestedProjectionEstablished,
    obsoleteScalarProjectionStillAbsent,
    reopenedV2Object,
    beforeFailure,
    afterFailure,
    afterSuccessBeforeNestedQuery,
    afterNestedQuery,
  };
};

const runMissingPolicyNegativeControl = (path: string) => {
  seedV1(path);
  const context = openMigrationContext(path);
  const before = snapshot(path);

  const attempted = expectFailure(() => {
    executeScalarToObjectMigration(context, {});
  });

  const after = snapshot(path);
  const raw = runtimeRetryPolicy(context.jobs[0]!);
  const valueStillScalar = typeof raw === "number" && raw === PERSISTED_DELAY_MS;
  const exactPhysicalRollback = sameSnapshot(before, after);
  context.sk.close();

  return {
    rejected: attempted.rejected,
    error: attempted.error,
    explicitPolicyRequired: attempted.error.includes("explicit maxAttempts policy"),
    valueStillScalar,
    exactPhysicalRollback,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-scalar-object-evolution-"));
let validExperiment = false;

try {
  const A = runDeclarationOnlyNegativeControl(join(root, "a.sqlite"));
  const B = runExplicitMigration(join(root, "b.sqlite"));
  const C = runMissingPolicyNegativeControl(join(root, "c.sqlite"));

  const declarationOnlyDoesNotMigrate =
    A.runtimeScalarPreserved &&
    A.automaticObjectConversionAbsent &&
    A.freshV2DefaultNotApplied &&
    A.samePhysicalItemIdentity &&
    A.oldScalarProjectionStillPresent;

  const explicitMigrationCoreWorks =
    B.injectedFailureRejected &&
    B.loadedMemoryRollback &&
    B.selectedDelayMs === PERSISTED_DELAY_MS &&
    B.obsoleteScalarProjectionRetired &&
    B.nestedQueryMatched &&
    B.nestedQueryReturnsDurableHandle &&
    B.nestedProjectionEstablished &&
    B.obsoleteScalarProjectionStillAbsent &&
    B.reopenedV2Object;

  const missingPolicyRejectedAtomically =
    C.rejected &&
    C.explicitPolicyRequired &&
    C.valueStillScalar &&
    C.exactPhysicalRollback;

  validExperiment =
    declarationOnlyDoesNotMigrate &&
    explicitMigrationCoreWorks &&
    missingPolicyRejectedAtomically;

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : B.exactPhysicalRollback
      ? "BOUNDARY_CONFIRMED_SCALAR_TO_OBJECT_REQUIRES_EXPLICIT_VALUE_MIGRATION"
      : "MIXED_RUNTIME_SUPPORT_WITH_METADATA_GAP";

  console.log(JSON.stringify({
    experiment: "scalar-to-object-incompatible-value-evolution",
    issue: 64,
    scenario: "jobs.retryPolicy number -> { delayMs, maxAttempts } under stable durable state identity",
    A,
    B,
    C,
    checks: {
      declarationOnlyDoesNotMigrate,
      explicitMigrationCoreWorks,
      missingPolicyRejectedAtomically,
      exactFailureRollback: B.exactPhysicalRollback,
    },
    decision,
    interpretation: validExperiment
      ? "TypeScript declaration change alone does not migrate persisted semantic shape. The tested scalar-to-object transition requires an explicit value transform and explicit required-field policy; current batch/state/lifecycle primitives can execute it atomically in this scenario."
      : "The experiment did not cleanly establish the scalar-to-object migration boundary.",
    uncertainty: {
      enumNarrowingUntested: true,
      generalRequiredFieldIntroductionUntested: true,
      fieldDeletionUntested: true,
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

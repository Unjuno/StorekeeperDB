import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";

type Queue = "fast" | "bulk";

type JobV1 = {
  id: string;
  queue: Queue;
  legacyTag: string;
};

type JobV2 = {
  id: string;
  queue: Queue;
};

type JobMigration = JobV2 & {
  legacyTag?: string;
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

const V1_INITIAL: JobV1 = {
  id: "JOB-1",
  queue: "fast",
  legacyTag: "legacy-import",
};
const V2_INITIAL: JobV2 = { id: "JOB-1", queue: "fast" };
const PERSISTED_QUEUE: Queue = "bulk";
const LEGACY_TAG = "legacy-import";

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

const sourceObject = (physical: PhysicalSnapshot): Record<string, unknown> | undefined =>
  physical.items[0] ? JSON.parse(physical.items[0].value_json) as Record<string, unknown> : undefined;

const hasSourceField = (physical: PhysicalSnapshot, field: string): boolean => {
  const source = sourceObject(physical);
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, field));
};

const projectionCells = (physical: PhysicalSnapshot, path: string): ProjectionRow[] =>
  physical.projections.filter((row) => row.path === path);

const derivationFor = (physical: PhysicalSnapshot, path: string): DerivationRow | undefined =>
  physical.derivations.find((row) => row.path === path);

const pathFor = (physical: PhysicalSnapshot, path: string): PathRow | undefined =>
  physical.paths.find((row) => row.path === path);

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

  const queueMatches = sk.find<Dict>("jobs", { queue: PERSISTED_QUEUE });
  const legacyMatches = sk.find<Dict>("jobs", { legacyTag: LEGACY_TAG });
  if (queueMatches.length !== 1 || legacyMatches.length !== 1) {
    throw new Error("V1 projection setup failed.");
  }
  sk.close();
};

const runDeclarationOnlyNegativeControl = (path: string) => {
  seedV1(path);
  const before = snapshot(path);

  const sk = new StorekeeperDB(path);
  sk.state<JobV2[]>("jobs", [V2_INITIAL]);
  sk.close();

  const after = snapshot(path);
  const legacyTagStillPersisted = hasSourceField(after, "legacyTag") && sourceObject(after)?.legacyTag === LEGACY_TAG;
  const sameItemIdentity = before.items.length === 1 && after.items.length === 1 && before.items[0]!.id === after.items[0]!.id;
  const legacyProjectionStillPresent =
    Boolean(derivationFor(after, "legacyTag")) &&
    projectionCells(after, "legacyTag").some((row) => row.value_json === JSON.stringify(LEGACY_TAG));

  return {
    legacyTagStillPersisted,
    sameItemIdentity,
    legacyProjectionStillPresent,
    source: sourceObject(after),
    before,
    after,
  };
};

const openMigrationContext = (path: string) => {
  const sk = new StorekeeperDB(path);
  const jobs = sk.state<JobMigration[]>("jobs", []);
  return { sk, jobs };
};

const executeFieldDelete = (
  context: ReturnType<typeof openMigrationContext>,
  injectFailure = false,
): void => {
  context.sk.batch(() => {
    if (context.jobs.length !== 1) throw new Error("Field deletion migration requires exactly one job fixture.");
    const job = context.jobs[0]!;
    if (!Object.prototype.hasOwnProperty.call(job, "legacyTag")) {
      throw new Error("Field deletion migration expected legacyTag to exist before deletion.");
    }
    delete job.legacyTag;
    if (injectFailure) throw new Error("injected field deletion failure");
  });
};

const runExplicitDelete = (path: string) => {
  seedV1(path);
  const context = openMigrationContext(path);
  const beforeFailure = snapshot(path);

  const injectedFailure = expectFailure(() => executeFieldDelete(context, true));
  const afterFailure = snapshot(path);
  const exactPhysicalRollback = sameSnapshot(beforeFailure, afterFailure);
  const loadedMemoryRollback = Object.prototype.hasOwnProperty.call(context.jobs[0]!, "legacyTag");
  const deleteTrapReached = injectedFailure.rejected && injectedFailure.error.includes("injected field deletion failure");

  let successRejected = false;
  let successError = "";
  try {
    executeFieldDelete(context, false);
  } catch (caught) {
    successRejected = true;
    successError = caught instanceof Error ? caught.message : String(caught);
  }

  const afterSuccessBeforeQueries = snapshot(path);
  const sourceFieldAbsent = !hasSourceField(afterSuccessBeforeQueries, "legacyTag");
  const legacyProjectionCellRemoved = projectionCells(afterSuccessBeforeQueries, "legacyTag").length === 0;
  const legacyDerivationRetained = Boolean(derivationFor(afterSuccessBeforeQueries, "legacyTag"));
  const legacyPathMetadataRetained = Boolean(pathFor(afterSuccessBeforeQueries, "legacyTag"));
  const queueProjectionPreserved =
    Boolean(derivationFor(afterSuccessBeforeQueries, "queue")) &&
    projectionCells(afterSuccessBeforeQueries, "queue").some((row) => row.value_json === JSON.stringify(PERSISTED_QUEUE));

  const legacyMatches = successRejected ? [] : context.sk.find<Dict>("jobs", { legacyTag: LEGACY_TAG });
  const queueMatches = successRejected ? [] : context.sk.find<Dict>("jobs", { queue: PERSISTED_QUEUE });
  const queryStateCoherent = !successRejected && legacyMatches.length === 0 && queueMatches.length === 1;

  context.sk.close();

  const reopened = new StorekeeperDB(path);
  reopened.state<JobV2[]>("jobs", [V2_INITIAL]);
  reopened.close();
  const afterReopen = snapshot(path);
  const reopenPreservesAbsence = !hasSourceField(afterReopen, "legacyTag");
  const reopenKeepsLegacyProjectionEmpty = projectionCells(afterReopen, "legacyTag").length === 0;
  const reopenKeepsLegacyDerivation = Boolean(derivationFor(afterReopen, "legacyTag"));

  return {
    injectedFailureRejected: injectedFailure.rejected,
    injectedFailureError: injectedFailure.error,
    deleteTrapReached,
    exactPhysicalRollback,
    loadedMemoryRollback,
    successRejected,
    successError,
    sourceFieldAbsent,
    legacyProjectionCellRemoved,
    legacyDerivationRetained,
    legacyPathMetadataRetained,
    queueProjectionPreserved,
    legacyQueryCount: legacyMatches.length,
    queueQueryCount: queueMatches.length,
    queryStateCoherent,
    reopenPreservesAbsence,
    reopenKeepsLegacyProjectionEmpty,
    reopenKeepsLegacyDerivation,
    beforeFailure,
    afterFailure,
    afterSuccessBeforeQueries,
    afterReopen,
  };
};

const runExplicitDerivationEvictionControl = (path: string) => {
  seedV1(path);
  const context = openMigrationContext(path);
  executeFieldDelete(context);
  const beforeEvict = snapshot(path);

  context.sk.debug().evict("jobs", ["legacyTag"]);
  const afterEvict = snapshot(path);
  context.sk.close();

  return {
    derivationPresentBeforeEvict: Boolean(derivationFor(beforeEvict, "legacyTag")),
    projectionCellsBeforeEvict: projectionCells(beforeEvict, "legacyTag").length,
    pathMetadataPresentBeforeEvict: Boolean(pathFor(beforeEvict, "legacyTag")),
    derivationRemovedByEvict: !derivationFor(afterEvict, "legacyTag"),
    projectionCellsAfterEvict: projectionCells(afterEvict, "legacyTag").length,
    pathMetadataRetainedAfterEvict: Boolean(pathFor(afterEvict, "legacyTag")),
    beforeEvict,
    afterEvict,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-field-delete-"));
let validExperiment = false;

try {
  const A = runDeclarationOnlyNegativeControl(join(root, "a.sqlite"));
  const B = runExplicitDelete(join(root, "b.sqlite"));
  const C = runExplicitDerivationEvictionControl(join(root, "c.sqlite"));

  const declarationShapeDoesNotDeletePersistedField =
    A.legacyTagStillPersisted && A.sameItemIdentity && A.legacyProjectionStillPresent;

  const rollbackAndDurableDeleteWork =
    B.injectedFailureRejected &&
    B.deleteTrapReached &&
    B.exactPhysicalRollback &&
    B.loadedMemoryRollback &&
    !B.successRejected &&
    B.sourceFieldAbsent &&
    B.reopenPreservesAbsence;

  const currentDerivedStateCoherentWithoutCleanup =
    B.legacyProjectionCellRemoved &&
    B.queueProjectionPreserved &&
    B.queryStateCoherent &&
    B.reopenKeepsLegacyProjectionEmpty;

  const historicalMetadataRetained =
    B.legacyDerivationRetained &&
    B.legacyPathMetadataRetained &&
    B.reopenKeepsLegacyDerivation;

  const explicitDerivationEvictionWorksButPathHistoryRemains =
    C.derivationPresentBeforeEvict &&
    C.projectionCellsBeforeEvict === 0 &&
    C.pathMetadataPresentBeforeEvict &&
    C.derivationRemovedByEvict &&
    C.projectionCellsAfterEvict === 0 &&
    C.pathMetadataRetainedAfterEvict;

  const durableHandleDeleteUnsupported = B.successRejected && !B.deleteTrapReached;

  validExperiment =
    declarationShapeDoesNotDeletePersistedField &&
    (durableHandleDeleteUnsupported || rollbackAndDurableDeleteWork);

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : durableHandleDeleteUnsupported
      ? "MIXED_FIELD_DELETE_NOT_SUPPORTED_BY_DURABLE_HANDLE"
      : currentDerivedStateCoherentWithoutCleanup && historicalMetadataRetained
        ? "BOUNDARY_CONFIRMED_FIELD_DELETE_CURRENT_STATE_COHERENT_METADATA_RETAINED"
        : currentDerivedStateCoherentWithoutCleanup
          ? "BOUNDARY_CONFIRMED_FIELD_DELETION_REQUIRES_EXPLICIT_VALUE_POLICY"
          : "MIXED_FIELD_DELETE_REQUIRES_METADATA_CLEANUP";

  console.log(JSON.stringify({
    experiment: "field-deletion-derived-metadata",
    issue: 72,
    scenario: "jobs {id,queue,legacyTag} -> {id,queue} with active queue + legacyTag projections",
    A,
    B,
    C,
    checks: {
      declarationShapeDoesNotDeletePersistedField,
      rollbackAndDurableDeleteWork,
      currentDerivedStateCoherentWithoutCleanup,
      historicalMetadataRetained,
      explicitDerivationEvictionWorksButPathHistoryRemains,
      durableHandleDeleteUnsupported,
    },
    decision,
    interpretation: durableHandleDeleteUnsupported
      ? "The current durable handle cannot express ordinary property deletion; field retirement requires a separate mutation mechanism before metadata policy can be evaluated cleanly."
      : rollbackAndDurableDeleteWork && currentDerivedStateCoherentWithoutCleanup
        ? "Field deletion is an explicit semantic policy but ordinary durable property deletion is mechanically sufficient for current source/query correctness in this scenario: source JSON loses the field, its projection cell disappears, unrelated projections remain coherent, rollback is exact, and reopen preserves absence. Historical derivation/path metadata is retained and should be treated as a separate lifecycle-policy question rather than current-state corruption."
        : "The explicit field deletion path did not maintain current source/query/derived-state coherence cleanly.",
    uncertainty: {
      partialRowDeletionUntested: true,
      nestedFieldDeletionUntested: true,
      fieldReintroductionUntested: true,
      concurrentVersionOpenUntested: true,
      automaticMetadataDecayUntested: true,
      publicCleanupApiUndecided: true,
      publicMigrationSurfaceUndecided: true,
    },
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

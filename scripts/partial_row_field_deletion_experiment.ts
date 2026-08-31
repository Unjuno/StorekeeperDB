import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";

type Queue = "fast" | "bulk";

type Job = {
  id: string;
  queue: Queue;
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

type AuditRow = {
  seq: number;
  op: string;
  state_key: string;
  path: string;
  item_id: string;
  value_json: string | null;
};

type PhysicalSnapshot = {
  items: ItemRow[];
  paths: PathRow[];
  derivations: DerivationRow[];
  projections: ProjectionRow[];
};

const JOB_1: Job = {
  id: "JOB-1",
  queue: "bulk",
  legacyTag: "legacy-one",
};

const JOB_2: Job = {
  id: "JOB-2",
  queue: "fast",
  legacyTag: "legacy-two",
};

const LEGACY_ONE = "legacy-one";
const LEGACY_TWO = "legacy-two";
const LEGACY_TWO_UPDATED = "legacy-two-updated";

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

const sourceValue = (row: ItemRow): Record<string, unknown> =>
  JSON.parse(row.value_json) as Record<string, unknown>;

const sourceRow = (physical: PhysicalSnapshot, logicalId: string): ItemRow | undefined =>
  physical.items.find((row) => sourceValue(row).id === logicalId);

const sourceObject = (physical: PhysicalSnapshot, logicalId: string): Record<string, unknown> | undefined => {
  const row = sourceRow(physical, logicalId);
  return row ? sourceValue(row) : undefined;
};

const physicalId = (physical: PhysicalSnapshot, logicalId: string): string | undefined =>
  sourceRow(physical, logicalId)?.id;

const hasSourceField = (physical: PhysicalSnapshot, logicalId: string, field: string): boolean => {
  const source = sourceObject(physical, logicalId);
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, field));
};

const projectionCells = (physical: PhysicalSnapshot, path: string): ProjectionRow[] =>
  physical.projections.filter((row) => row.path === path);

const projectionCell = (
  physical: PhysicalSnapshot,
  path: string,
  itemId: string | undefined,
): ProjectionRow | undefined =>
  itemId ? physical.projections.find((row) => row.path === path && row.item_id === itemId) : undefined;

const derivationFor = (physical: PhysicalSnapshot, path: string): DerivationRow | undefined =>
  physical.derivations.find((row) => row.path === path);

const pathFor = (physical: PhysicalSnapshot, path: string): PathRow | undefined =>
  physical.paths.find((row) => row.path === path);

const projectionTopology = (physical: PhysicalSnapshot, path: string): string[] =>
  projectionCells(physical, path)
    .map((row) => `${row.item_id}:${row.value_json}`)
    .sort();

const sameProjectionTopology = (
  a: PhysicalSnapshot,
  b: PhysicalSnapshot,
  path: string,
): boolean => JSON.stringify(projectionTopology(a, path)) === JSON.stringify(projectionTopology(b, path));

const installProjectionAudit = (path: string): void => {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE __experiment_projection_audit (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      op TEXT NOT NULL,
      state_key TEXT NOT NULL,
      path TEXT NOT NULL,
      item_id TEXT NOT NULL,
      value_json TEXT
    );

    CREATE TRIGGER __experiment_projection_delete
    AFTER DELETE ON __sk_projection
    BEGIN
      INSERT INTO __experiment_projection_audit(op,state_key,path,item_id,value_json)
      VALUES('delete', OLD.state_key, OLD.path, OLD.item_id, OLD.value_json);
    END;

    CREATE TRIGGER __experiment_projection_insert
    AFTER INSERT ON __sk_projection
    BEGIN
      INSERT INTO __experiment_projection_audit(op,state_key,path,item_id,value_json)
      VALUES('insert', NEW.state_key, NEW.path, NEW.item_id, NEW.value_json);
    END;

    CREATE TRIGGER __experiment_projection_update
    AFTER UPDATE ON __sk_projection
    BEGIN
      INSERT INTO __experiment_projection_audit(op,state_key,path,item_id,value_json)
      VALUES('update', NEW.state_key, NEW.path, NEW.item_id, NEW.value_json);
    END;
  `);
  db.close();
};

const readProjectionAudit = (path: string): AuditRow[] => {
  const db = new DatabaseSync(path);
  const rows = db.prepare(
    "SELECT seq,op,state_key,path,item_id,value_json FROM __experiment_projection_audit ORDER BY seq",
  ).all() as AuditRow[];
  db.close();
  return rows;
};

const expectFailure = (run: () => void): { rejected: boolean; error: string } => {
  try {
    run();
    return { rejected: false, error: "" };
  } catch (caught) {
    return { rejected: true, error: caught instanceof Error ? caught.message : String(caught) };
  }
};

const seed = (path: string): void => {
  const sk = new StorekeeperDB(path);
  sk.state<Job[]>("jobs", [JOB_1, JOB_2]);

  const firstQueue = sk.find<Dict>("jobs", { queue: "bulk" });
  const firstLegacy = sk.find<Dict>("jobs", { legacyTag: LEGACY_ONE });
  if (firstQueue.length !== 1 || firstLegacy.length !== 1) {
    throw new Error("Partial-row fixture projection setup failed.");
  }
  sk.close();
  installProjectionAudit(path);
};

const openContext = (path: string) => {
  const sk = new StorekeeperDB(path);
  const jobs = sk.state<Job[]>("jobs", []);
  return { sk, jobs };
};

const jobById = (jobs: Job[], id: string): Job => {
  const job = jobs.find((candidate) => candidate.id === id);
  if (!job) throw new Error(`Missing fixture job: ${id}`);
  return job;
};

const deleteJob1LegacyTag = (context: ReturnType<typeof openContext>, injectFailure: boolean): void => {
  context.sk.batch(() => {
    const job = jobById(context.jobs, "JOB-1");
    if (!Object.prototype.hasOwnProperty.call(job, "legacyTag")) {
      throw new Error("JOB-1 legacyTag must exist before partial-row deletion.");
    }
    delete job.legacyTag;
    if (injectFailure) throw new Error("injected partial-row field deletion failure");
  });
};

const run = (path: string) => {
  seed(path);
  const before = snapshot(path);
  const job1PhysicalId = physicalId(before, "JOB-1");
  const job2PhysicalId = physicalId(before, "JOB-2");

  const initialLegacyCells = projectionCells(before, "legacyTag");
  const initialQueueCells = projectionCells(before, "queue");
  const initialTopologyValid =
    before.items.length === 2 &&
    Boolean(job1PhysicalId) &&
    Boolean(job2PhysicalId) &&
    job1PhysicalId !== job2PhysicalId &&
    initialLegacyCells.length === 2 &&
    initialQueueCells.length === 2 &&
    projectionCell(before, "legacyTag", job1PhysicalId)?.value_json === JSON.stringify(LEGACY_ONE) &&
    projectionCell(before, "legacyTag", job2PhysicalId)?.value_json === JSON.stringify(LEGACY_TWO) &&
    Boolean(derivationFor(before, "legacyTag")) &&
    Boolean(derivationFor(before, "queue"));

  const context = openContext(path);
  const failure = expectFailure(() => deleteJob1LegacyTag(context, true));
  const afterFailure = snapshot(path);
  const auditAfterFailure = readProjectionAudit(path);
  const exactPhysicalRollback = sameSnapshot(before, afterFailure);
  const auditRollbackExact = auditAfterFailure.length === 0;
  const loadedMemoryRollback =
    Object.prototype.hasOwnProperty.call(jobById(context.jobs, "JOB-1"), "legacyTag") &&
    jobById(context.jobs, "JOB-1").legacyTag === LEGACY_ONE;

  let successRejected = false;
  let successError = "";
  try {
    deleteJob1LegacyTag(context, false);
  } catch (caught) {
    successRejected = true;
    successError = caught instanceof Error ? caught.message : String(caught);
  }

  const afterDeleteBeforeQueries = snapshot(path);
  const auditAfterDelete = readProjectionAudit(path);

  const sourceJob1 = sourceObject(afterDeleteBeforeQueries, "JOB-1");
  const sourceJob2 = sourceObject(afterDeleteBeforeQueries, "JOB-2");
  const sourceSelective =
    Boolean(sourceJob1) &&
    Boolean(sourceJob2) &&
    !hasSourceField(afterDeleteBeforeQueries, "JOB-1", "legacyTag") &&
    sourceJob2?.legacyTag === LEGACY_TWO;

  const idsAndOrderStable =
    before.items.length === afterDeleteBeforeQueries.items.length &&
    before.items.every((row, index) => afterDeleteBeforeQueries.items[index]?.id === row.id);

  const deletedCellAbsent = !projectionCell(afterDeleteBeforeQueries, "legacyTag", job1PhysicalId);
  const survivorCellPresent =
    projectionCell(afterDeleteBeforeQueries, "legacyTag", job2PhysicalId)?.value_json === JSON.stringify(LEGACY_TWO);
  const legacyProjectionSelective =
    projectionCells(afterDeleteBeforeQueries, "legacyTag").length === 1 &&
    deletedCellAbsent &&
    survivorCellPresent;

  const legacyDerivationRemainsCurrent = Boolean(derivationFor(afterDeleteBeforeQueries, "legacyTag"));
  const legacyPathMetadataPresent = Boolean(pathFor(afterDeleteBeforeQueries, "legacyTag"));
  const queueProjectionUnchanged = sameProjectionTopology(before, afterDeleteBeforeQueries, "queue");

  const deleteAuditRows = auditAfterDelete.filter((row) => row.op === "delete");
  const insertAuditRows = auditAfterDelete.filter((row) => row.op === "insert");
  const survivorUntouchedDuringDelete = auditAfterDelete.every((row) => row.item_id !== job2PhysicalId);
  const minimalDeletedCellOnly =
    auditAfterDelete.length === 1 &&
    deleteAuditRows.length === 1 &&
    deleteAuditRows[0]?.path === "legacyTag" &&
    deleteAuditRows[0]?.item_id === job1PhysicalId;
  const itemLocalProjectionRebuildObserved =
    survivorUntouchedDuringDelete &&
    deleteAuditRows.some((row) => row.item_id === job1PhysicalId && row.path === "legacyTag") &&
    deleteAuditRows.some((row) => row.item_id === job1PhysicalId && row.path === "queue") &&
    insertAuditRows.some((row) => row.item_id === job1PhysicalId && row.path === "queue") &&
    !insertAuditRows.some((row) => row.item_id === job1PhysicalId && row.path === "legacyTag");

  const oldMatches = successRejected ? [] : context.sk.find<Dict>("jobs", { legacyTag: LEGACY_ONE });
  const survivorMatches = successRejected ? [] : context.sk.find<Dict>("jobs", { legacyTag: LEGACY_TWO });
  const auditAfterQueries = readProjectionAudit(path);
  const queryDidNotRepairProjectionStorage =
    JSON.stringify(auditAfterQueries) === JSON.stringify(auditAfterDelete);

  const survivorQueryCoherent = oldMatches.length === 0 && survivorMatches.length === 1;
  const survivorHandle = survivorMatches[0];
  let survivorHandleMutationRejected = false;
  let survivorHandleMutationError = "";
  if (survivorHandle) {
    try {
      survivorHandle.legacyTag = LEGACY_TWO_UPDATED;
    } catch (caught) {
      survivorHandleMutationRejected = true;
      survivorHandleMutationError = caught instanceof Error ? caught.message : String(caught);
    }
  }

  const afterHandleMutation = snapshot(path);
  const auditAfterHandleMutation = readProjectionAudit(path);
  const handleMutationAudit = auditAfterHandleMutation.slice(auditAfterQueries.length);
  const survivorSourceUpdated =
    sourceObject(afterHandleMutation, "JOB-2")?.legacyTag === LEGACY_TWO_UPDATED;
  const deletedSourceStillAbsent = !hasSourceField(afterHandleMutation, "JOB-1", "legacyTag");
  const survivorProjectionUpdated =
    projectionCells(afterHandleMutation, "legacyTag").length === 1 &&
    !projectionCell(afterHandleMutation, "legacyTag", job1PhysicalId) &&
    projectionCell(afterHandleMutation, "legacyTag", job2PhysicalId)?.value_json === JSON.stringify(LEGACY_TWO_UPDATED);
  const queueProjectionStillUnchanged = sameProjectionTopology(before, afterHandleMutation, "queue");
  const survivorHandleMutationCoherent =
    Boolean(survivorHandle) &&
    !survivorHandleMutationRejected &&
    survivorSourceUpdated &&
    deletedSourceStillAbsent &&
    survivorProjectionUpdated &&
    queueProjectionStillUnchanged;

  context.sk.close();

  const reopened = new StorekeeperDB(path);
  reopened.state<Job[]>("jobs", []);
  reopened.close();
  const afterReopen = snapshot(path);

  const reopenMixedTopologyCoherent =
    !hasSourceField(afterReopen, "JOB-1", "legacyTag") &&
    sourceObject(afterReopen, "JOB-2")?.legacyTag === LEGACY_TWO_UPDATED &&
    projectionCells(afterReopen, "legacyTag").length === 1 &&
    !projectionCell(afterReopen, "legacyTag", job1PhysicalId) &&
    projectionCell(afterReopen, "legacyTag", job2PhysicalId)?.value_json === JSON.stringify(LEGACY_TWO_UPDATED) &&
    sameProjectionTopology(before, afterReopen, "queue") &&
    Boolean(derivationFor(afterReopen, "legacyTag"));

  const currentStateCorrect =
    sourceSelective &&
    idsAndOrderStable &&
    legacyProjectionSelective &&
    legacyDerivationRemainsCurrent &&
    queueProjectionUnchanged;

  const rollbackExact =
    failure.rejected &&
    failure.error.includes("injected partial-row field deletion failure") &&
    exactPhysicalRollback &&
    auditRollbackExact &&
    loadedMemoryRollback;

  const queriesAndDurableHandleCorrect =
    survivorQueryCoherent &&
    queryDidNotRepairProjectionStorage &&
    survivorHandleMutationCoherent;

  const validExperiment = initialTopologyValid && rollbackExact && !successRejected;

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : !currentStateCorrect || !queriesAndDurableHandleCorrect || !reopenMixedTopologyCoherent
      ? "FAIL_PARTIAL_ROW_DELETE_CORRUPTS_SURVIVING_PROJECTION"
      : itemLocalProjectionRebuildObserved && !minimalDeletedCellOnly
        ? "MIXED_PARTIAL_ROW_DELETE_REBUILDS_ITEM_PROJECTIONS_BUT_STAYS_CORRECT"
        : "REPLICATION_PASS_PARTIAL_ROW_FIELD_DELETE_IS_SELECTIVE";

  return {
    experiment: "partial-row-field-deletion",
    issue: 74,
    scenario: "two jobs share projected legacyTag; delete it from JOB-1 only while JOB-2 retains it",
    physicalIdentity: {
      job1PhysicalId,
      job2PhysicalId,
      idsAndOrderStable,
    },
    rollback: {
      injectedFailureRejected: failure.rejected,
      injectedFailureError: failure.error,
      exactPhysicalRollback,
      auditRollbackExact,
      loadedMemoryRollback,
    },
    immediateAfterDelete: {
      successRejected,
      successError,
      sourceSelective,
      deletedCellAbsent,
      survivorCellPresent,
      legacyProjectionSelective,
      legacyDerivationRemainsCurrent,
      legacyPathMetadataPresent,
      queueProjectionUnchanged,
      audit: auditAfterDelete,
      minimalDeletedCellOnly,
      itemLocalProjectionRebuildObserved,
      survivorUntouchedDuringDelete,
      physical: afterDeleteBeforeQueries,
    },
    queryAndHandle: {
      oldValueQueryCount: oldMatches.length,
      survivorValueQueryCount: survivorMatches.length,
      survivorQueryCoherent,
      queryDidNotRepairProjectionStorage,
      survivorHandleMutationRejected,
      survivorHandleMutationError,
      survivorSourceUpdated,
      deletedSourceStillAbsent,
      survivorProjectionUpdated,
      queueProjectionStillUnchanged,
      handleMutationAudit,
      survivorHandleMutationCoherent,
      physical: afterHandleMutation,
    },
    reopen: {
      mixedTopologyCoherent: reopenMixedTopologyCoherent,
      physical: afterReopen,
    },
    checks: {
      initialTopologyValid,
      rollbackExact,
      currentStateCorrect,
      queriesAndDurableHandleCorrect,
      reopenMixedTopologyCoherent,
      itemLocalProjectionIsolation: survivorUntouchedDuringDelete,
      itemLocalProjectionRebuildObserved,
      minimalDeletedCellOnly,
    },
    decision,
    interpretation: currentStateCorrect && queriesAndDurableHandleCorrect && reopenMixedTopologyCoherent
      ? itemLocalProjectionRebuildObserved && !minimalDeletedCellOnly
        ? "Partial-row field deletion is correct and isolated from surviving rows, but the projection audit shows an item-local rebuild: StorekeeperDB deletes the changed item's active projection cells and reinserts still-present scalar cells. This is correctness evidence, not evidence of minimal cell-level write granularity."
        : "Partial-row field deletion preserved a selective projection topology, durable-handle query semantics, unrelated projections, rollback, identity, and reopen behavior."
      : "The partial-row topology exposed a current-state or durable-handle projection correctness defect.",
    uncertainty: {
      nestedFieldDeletionUntested: true,
      fieldReintroductionUntested: true,
      automaticMetadataDecayUntested: true,
      concurrentVersionOpenUntested: true,
      multipleWritersUntested: true,
      largeCardinalityWriteAmplificationUntested: true,
      publicCleanupApiUndecided: true,
      publicMigrationSurfaceUndecided: true,
    },
    validExperiment,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-partial-field-delete-"));
let validExperiment = false;

try {
  const result = run(join(root, "partial.sqlite"));
  validExperiment = result.validExperiment;
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

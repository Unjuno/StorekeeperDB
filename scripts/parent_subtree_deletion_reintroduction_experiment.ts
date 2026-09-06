import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";

type Routing = {
  queue: string;
  legacyTag: string;
};

type Job = {
  id: string;
  routing?: Routing;
  routingBackup: { queue: string };
};

type ItemRow = { id: string; pos: number; value_json: string };
type PathRow = { path: string; observed_type: string | null; read_count: number; write_count: number };
type DerivationRow = { path: string; kind: string; state: string; use_count: number; storage_cost: number };
type ProjectionRow = { path: string; item_id: string; value_json: string };
type AuditRow = { seq: number; op: string; path: string; item_id: string };
type PhysicalSnapshot = {
  items: ItemRow[];
  paths: PathRow[];
  derivations: DerivationRow[];
  projections: ProjectionRow[];
};

const STATE_KEY = "jobs";
const JOB_ID = "JOB-1";
const QUEUE_PATH = "routing.queue";
const LEGACY_PATH = "routing.legacyTag";
const BACKUP_PATH = "routingBackup.queue";
const QUEUE_ONE = "critical";
const LEGACY_ONE = "legacy-one";
const BACKUP_VALUE = "backup";
const QUEUE_TWO = "normal";
const LEGACY_TWO = "legacy-two";
const STALE_VALUE = "stale-resurrection-attempt";

const INITIAL: Job = {
  id: JOB_ID,
  routing: { queue: QUEUE_ONE, legacyTag: LEGACY_ONE },
  routingBackup: { queue: BACKUP_VALUE },
};

const snapshot = (path: string): PhysicalSnapshot => {
  const db = new DatabaseSync(path);
  const items = db.prepare(
    "SELECT id,pos,value_json FROM __sk_items WHERE state_key=? ORDER BY pos,id",
  ).all(STATE_KEY) as ItemRow[];
  const paths = db.prepare(
    "SELECT path,observed_type,read_count,write_count FROM __sk_paths WHERE state_key=? ORDER BY path",
  ).all(STATE_KEY) as PathRow[];
  const derivations = db.prepare(
    "SELECT path,kind,state,use_count,storage_cost FROM __sk_derivations WHERE state_key=? ORDER BY path,kind",
  ).all(STATE_KEY) as DerivationRow[];
  const projections = db.prepare(
    "SELECT path,item_id,value_json FROM __sk_projection WHERE state_key=? ORDER BY path,item_id",
  ).all(STATE_KEY) as ProjectionRow[];
  db.close();
  return { items, paths, derivations, projections };
};

const sameSnapshot = (a: PhysicalSnapshot, b: PhysicalSnapshot): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const sourceObject = (physical: PhysicalSnapshot): Record<string, unknown> | undefined =>
  physical.items[0] ? JSON.parse(physical.items[0].value_json) as Record<string, unknown> : undefined;

const hasOwn = (value: Record<string, unknown> | undefined, key: string): boolean =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

const projectionCells = (physical: PhysicalSnapshot, path: string): ProjectionRow[] =>
  physical.projections.filter((row) => row.path === path);
const derivationsFor = (physical: PhysicalSnapshot, path: string): DerivationRow[] =>
  physical.derivations.filter((row) => row.path === path);
const pathsFor = (physical: PhysicalSnapshot, path: string): PathRow[] =>
  physical.paths.filter((row) => row.path === path);

const installAudit = (path: string): void => {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE __experiment_parent_projection_audit (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      op TEXT NOT NULL,
      path TEXT NOT NULL,
      item_id TEXT NOT NULL
    );
    CREATE TRIGGER __experiment_parent_projection_delete
    AFTER DELETE ON __sk_projection
    BEGIN
      INSERT INTO __experiment_parent_projection_audit(op,path,item_id)
      VALUES('delete', OLD.path, OLD.item_id);
    END;
    CREATE TRIGGER __experiment_parent_projection_insert
    AFTER INSERT ON __sk_projection
    BEGIN
      INSERT INTO __experiment_parent_projection_audit(op,path,item_id)
      VALUES('insert', NEW.path, NEW.item_id);
    END;
    CREATE TRIGGER __experiment_parent_projection_update
    AFTER UPDATE ON __sk_projection
    BEGIN
      INSERT INTO __experiment_parent_projection_audit(op,path,item_id)
      VALUES('update', NEW.path, NEW.item_id);
    END;
  `);
  db.close();
};

const clearAudit = (path: string): void => {
  const db = new DatabaseSync(path);
  db.exec("DELETE FROM __experiment_parent_projection_audit");
  db.close();
};

const readAudit = (path: string): AuditRow[] => {
  const db = new DatabaseSync(path);
  const rows = db.prepare(
    "SELECT seq,op,path,item_id FROM __experiment_parent_projection_audit ORDER BY seq",
  ).all() as AuditRow[];
  db.close();
  return rows;
};

const operationCount = (rows: AuditRow[], op: string, path: string): number =>
  rows.filter((row) => row.op === op && row.path === path).length;

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
  sk.state<Job[]>(STATE_KEY, [INITIAL]);
  const queue = sk.find<Dict>(STATE_KEY, { [QUEUE_PATH]: QUEUE_ONE });
  const legacy = sk.find<Dict>(STATE_KEY, { [LEGACY_PATH]: LEGACY_ONE });
  const backup = sk.find<Dict>(STATE_KEY, { [BACKUP_PATH]: BACKUP_VALUE });
  if (queue.length !== 1 || legacy.length !== 1 || backup.length !== 1) {
    throw new Error("parent subtree projection setup failed");
  }
  sk.close();
};

const executeParentDelete = (sk: StorekeeperDB, jobs: Job[], injectFailure: boolean): void => {
  sk.batch(() => {
    const job = jobs[0];
    if (!job?.routing) throw new Error("parent deletion expected routing to exist");
    delete job.routing;
    if (injectFailure) throw new Error("injected parent subtree deletion failure");
  });
};

const root = mkdtempSync(join(tmpdir(), "sk-parent-subtree-delete-"));
const path = join(root, "app.sqlite");
let validExperiment = false;

try {
  seed(path);
  installAudit(path);

  const initialPhysical = snapshot(path);
  const initialItemId = initialPhysical.items[0]?.id;
  const initialSource = sourceObject(initialPhysical);
  const initialTopologyValid =
    initialPhysical.items.length === 1 &&
    hasOwn(initialSource, "routing") &&
    hasOwn(initialSource, "routingBackup") &&
    projectionCells(initialPhysical, QUEUE_PATH).length === 1 &&
    projectionCells(initialPhysical, LEGACY_PATH).length === 1 &&
    projectionCells(initialPhysical, BACKUP_PATH).length === 1 &&
    derivationsFor(initialPhysical, QUEUE_PATH).length === 1 &&
    derivationsFor(initialPhysical, LEGACY_PATH).length === 1 &&
    derivationsFor(initialPhysical, BACKUP_PATH).length === 1;

  const sk = new StorekeeperDB(path);
  const jobs = sk.state<Job[]>(STATE_KEY, []);
  const beforeFailure = snapshot(path);
  clearAudit(path);

  const injectedFailure = expectFailure(() => executeParentDelete(sk, jobs, true));
  const afterFailure = snapshot(path);
  const failureAudit = readAudit(path);
  const deleteTrapReached =
    injectedFailure.rejected && injectedFailure.error.includes("injected parent subtree deletion failure");
  const exactPhysicalRollback = sameSnapshot(beforeFailure, afterFailure);
  const failureAuditRolledBack = failureAudit.length === 0;
  const loadedMemoryRollback =
    jobs[0]?.routing?.queue === QUEUE_ONE && jobs[0]?.routing?.legacyTag === LEGACY_ONE;

  const staleRouting = jobs[0]?.routing;
  if (!staleRouting) throw new Error("stale-child control requires routing handle");

  clearAudit(path);
  let deleteSuccessRejected = false;
  let deleteSuccessError = "";
  try {
    executeParentDelete(sk, jobs, false);
  } catch (caught) {
    deleteSuccessRejected = true;
    deleteSuccessError = caught instanceof Error ? caught.message : String(caught);
  }

  const afterDeleteBeforeQueries = snapshot(path);
  const deleteAudit = readAudit(path);
  const deletedSource = sourceObject(afterDeleteBeforeQueries);
  const backupSource = deletedSource?.routingBackup as Record<string, unknown> | undefined;
  const deleteSourceCorrect =
    !deleteSuccessRejected &&
    !hasOwn(deletedSource, "routing") &&
    backupSource?.queue === BACKUP_VALUE;
  const deleteProjectionCorrect =
    projectionCells(afterDeleteBeforeQueries, QUEUE_PATH).length === 0 &&
    projectionCells(afterDeleteBeforeQueries, LEGACY_PATH).length === 0 &&
    projectionCells(afterDeleteBeforeQueries, BACKUP_PATH).length === 1 &&
    projectionCells(afterDeleteBeforeQueries, BACKUP_PATH)[0]?.value_json === JSON.stringify(BACKUP_VALUE);
  const prefixNeighborPreserved =
    projectionCells(afterDeleteBeforeQueries, BACKUP_PATH).length === 1 &&
    backupSource?.queue === BACKUP_VALUE;
  const identityStableAfterDelete =
    initialItemId !== undefined &&
    afterDeleteBeforeQueries.items[0]?.id === initialItemId &&
    afterDeleteBeforeQueries.items[0]?.pos === initialPhysical.items[0]?.pos;
  const deleteWriteShapeExpected =
    deleteAudit.length === 4 &&
    deleteAudit.every((row) => row.item_id === initialItemId) &&
    operationCount(deleteAudit, "delete", QUEUE_PATH) === 1 &&
    operationCount(deleteAudit, "delete", LEGACY_PATH) === 1 &&
    operationCount(deleteAudit, "delete", BACKUP_PATH) === 1 &&
    operationCount(deleteAudit, "insert", BACKUP_PATH) === 1;

  clearAudit(path);
  let staleChildWriteRejected = false;
  let staleChildWriteError = "";
  try {
    staleRouting.queue = STALE_VALUE;
  } catch (caught) {
    staleChildWriteRejected = true;
    staleChildWriteError = caught instanceof Error ? caught.message : String(caught);
  }
  const staleChildLocalTargetMutated = staleRouting.queue === STALE_VALUE;
  const afterStaleChildAttempt = snapshot(path);
  const staleChildAudit = readAudit(path);
  const staleSource = sourceObject(afterStaleChildAttempt);
  const staleBackup = staleSource?.routingBackup as Record<string, unknown> | undefined;
  const staleChildDidNotResurrect =
    !hasOwn(staleSource, "routing") &&
    projectionCells(afterStaleChildAttempt, QUEUE_PATH).length === 0 &&
    projectionCells(afterStaleChildAttempt, LEGACY_PATH).length === 0 &&
    staleBackup?.queue === BACKUP_VALUE &&
    projectionCells(afterStaleChildAttempt, BACKUP_PATH).length === 1;
  const staleChildWriteHadPersistenceSideEffects = staleChildAudit.length > 0;

  const oldQueueMatches = sk.find<Dict>(STATE_KEY, { [QUEUE_PATH]: QUEUE_ONE });
  const oldLegacyMatches = sk.find<Dict>(STATE_KEY, { [LEGACY_PATH]: LEGACY_ONE });
  const backupMatches = sk.find<Dict>(STATE_KEY, { [BACKUP_PATH]: BACKUP_VALUE });
  const deleteQueriesCorrect =
    oldQueueMatches.length === 0 &&
    oldLegacyMatches.length === 0 &&
    backupMatches.length === 1 &&
    backupMatches[0] === jobs[0];

  sk.close();

  const afterFirstReopenPhysical = snapshot(path);
  const firstReopenSource = sourceObject(afterFirstReopenPhysical);
  const firstReopenCorrect =
    !hasOwn(firstReopenSource, "routing") &&
    projectionCells(afterFirstReopenPhysical, QUEUE_PATH).length === 0 &&
    projectionCells(afterFirstReopenPhysical, LEGACY_PATH).length === 0 &&
    projectionCells(afterFirstReopenPhysical, BACKUP_PATH).length === 1 &&
    afterFirstReopenPhysical.items[0]?.id === initialItemId;

  const reopened = new StorekeeperDB(path);
  const reopenedJobs = reopened.state<Job[]>(STATE_KEY, []);
  clearAudit(path);

  let reintroductionRejected = false;
  let reintroductionError = "";
  try {
    const job = reopenedJobs[0];
    if (!job) throw new Error("parent reintroduction requires one job");
    job.routing = { queue: QUEUE_TWO, legacyTag: LEGACY_TWO };
  } catch (caught) {
    reintroductionRejected = true;
    reintroductionError = caught instanceof Error ? caught.message : String(caught);
  }

  const afterReintroductionBeforeQueries = snapshot(path);
  const reintroductionAudit = readAudit(path);
  const reintroducedSource = sourceObject(afterReintroductionBeforeQueries);
  const reintroducedRouting = reintroducedSource?.routing as Record<string, unknown> | undefined;
  const reintroductionSourceCorrect =
    !reintroductionRejected &&
    reintroducedRouting?.queue === QUEUE_TWO &&
    reintroducedRouting?.legacyTag === LEGACY_TWO &&
    (reintroducedSource?.routingBackup as Record<string, unknown> | undefined)?.queue === BACKUP_VALUE;
  const reintroductionProjectionCorrect =
    projectionCells(afterReintroductionBeforeQueries, QUEUE_PATH).length === 1 &&
    projectionCells(afterReintroductionBeforeQueries, QUEUE_PATH)[0]?.value_json === JSON.stringify(QUEUE_TWO) &&
    projectionCells(afterReintroductionBeforeQueries, LEGACY_PATH).length === 1 &&
    projectionCells(afterReintroductionBeforeQueries, LEGACY_PATH)[0]?.value_json === JSON.stringify(LEGACY_TWO) &&
    projectionCells(afterReintroductionBeforeQueries, BACKUP_PATH).length === 1;
  const noDuplicateProjectionCells =
    projectionCells(afterReintroductionBeforeQueries, QUEUE_PATH).length === 1 &&
    projectionCells(afterReintroductionBeforeQueries, LEGACY_PATH).length === 1 &&
    projectionCells(afterReintroductionBeforeQueries, BACKUP_PATH).length === 1;
  const reintroductionWriteShapeExpected =
    reintroductionAudit.length === 6 &&
    reintroductionAudit.every((row) => row.item_id === initialItemId) &&
    operationCount(reintroductionAudit, "delete", QUEUE_PATH) === 1 &&
    operationCount(reintroductionAudit, "insert", QUEUE_PATH) === 1 &&
    operationCount(reintroductionAudit, "delete", LEGACY_PATH) === 1 &&
    operationCount(reintroductionAudit, "insert", LEGACY_PATH) === 1 &&
    operationCount(reintroductionAudit, "delete", BACKUP_PATH) === 1 &&
    operationCount(reintroductionAudit, "insert", BACKUP_PATH) === 1;

  const oldQueueAfterReintro = reopened.find<Dict>(STATE_KEY, { [QUEUE_PATH]: QUEUE_ONE });
  const oldLegacyAfterReintro = reopened.find<Dict>(STATE_KEY, { [LEGACY_PATH]: LEGACY_ONE });
  const newQueueMatches = reopened.find<Dict>(STATE_KEY, { [QUEUE_PATH]: QUEUE_TWO });
  const newLegacyMatches = reopened.find<Dict>(STATE_KEY, { [LEGACY_PATH]: LEGACY_TWO });
  const backupAfterReintro = reopened.find<Dict>(STATE_KEY, { [BACKUP_PATH]: BACKUP_VALUE });
  const reintroductionQueriesCorrect =
    oldQueueAfterReintro.length === 0 &&
    oldLegacyAfterReintro.length === 0 &&
    newQueueMatches.length === 1 &&
    newLegacyMatches.length === 1 &&
    backupAfterReintro.length === 1 &&
    newQueueMatches[0] === reopenedJobs[0] &&
    newLegacyMatches[0] === reopenedJobs[0];

  reopened.close();

  const finalPhysical = snapshot(path);
  const finalReopen = new StorekeeperDB(path);
  const finalJobs = finalReopen.state<Job[]>(STATE_KEY, []);
  const secondReopenCorrect =
    finalJobs.length === 1 &&
    finalJobs[0]?.routing?.queue === QUEUE_TWO &&
    finalJobs[0]?.routing?.legacyTag === LEGACY_TWO &&
    finalJobs[0]?.routingBackup.queue === BACKUP_VALUE &&
    finalPhysical.items[0]?.id === initialItemId &&
    projectionCells(finalPhysical, QUEUE_PATH).length === 1 &&
    projectionCells(finalPhysical, LEGACY_PATH).length === 1 &&
    projectionCells(finalPhysical, BACKUP_PATH).length === 1;
  finalReopen.close();

  const metadataLifecycleCoherent = [QUEUE_PATH, LEGACY_PATH, BACKUP_PATH].every((projectedPath) =>
    derivationsFor(afterDeleteBeforeQueries, projectedPath).length === 1 &&
    pathsFor(afterDeleteBeforeQueries, projectedPath).length === 1 &&
    derivationsFor(afterReintroductionBeforeQueries, projectedPath).length === 1 &&
    pathsFor(afterReintroductionBeforeQueries, projectedPath).length === 1,
  );

  const currentStateCorrect =
    deleteSourceCorrect &&
    deleteProjectionCorrect &&
    prefixNeighborPreserved &&
    deleteQueriesCorrect &&
    firstReopenCorrect &&
    reintroductionSourceCorrect &&
    reintroductionProjectionCorrect &&
    noDuplicateProjectionCells &&
    reintroductionQueriesCorrect &&
    secondReopenCorrect;
  const expectedItemLocalWriteShape = deleteWriteShapeExpected && reintroductionWriteShapeExpected;

  validExperiment =
    initialTopologyValid &&
    deleteTrapReached &&
    exactPhysicalRollback &&
    loadedMemoryRollback &&
    failureAuditRolledBack;

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : deleteSuccessRejected ||
        reintroductionRejected ||
        !currentStateCorrect ||
        !staleChildDidNotResurrect
      ? "FAIL_PARENT_SUBTREE_DELETE_OR_STALE_HANDLE_CORRUPTS_CURRENT_STATE"
      : !staleChildWriteRejected ||
          !metadataLifecycleCoherent ||
          !expectedItemLocalWriteShape
        ? "MIXED_PARENT_SUBTREE_CURRENT_STATE_CORRECT_BUT_STALE_CHILD_WRITE_ACCEPTED"
        : "REPLICATION_PASS_PARENT_SUBTREE_DELETE_REINTRODUCTION_COHERENT";

  console.log(JSON.stringify({
    experiment: "parent-subtree-deletion-reintroduction-projection-lifecycle",
    issue: 80,
    scenario: "delete routing parent -> stale child mutation attempt -> reopen -> reintroduce routing",
    checks: {
      initialTopologyValid,
      deleteTrapReached,
      exactPhysicalRollback,
      loadedMemoryRollback,
      failureAuditRolledBack,
      deleteSuccessRejected,
      deleteSourceCorrect,
      deleteProjectionCorrect,
      prefixNeighborPreserved,
      identityStableAfterDelete,
      deleteWriteShapeExpected,
      staleChildWriteRejected,
      staleChildLocalTargetMutated,
      staleChildDidNotResurrect,
      staleChildWriteHadPersistenceSideEffects,
      deleteQueriesCorrect,
      firstReopenCorrect,
      reintroductionRejected,
      reintroductionSourceCorrect,
      reintroductionProjectionCorrect,
      noDuplicateProjectionCells,
      reintroductionWriteShapeExpected,
      reintroductionQueriesCorrect,
      secondReopenCorrect,
      metadataLifecycleCoherent,
      expectedItemLocalWriteShape,
      currentStateCorrect,
      validExperiment,
    },
    errors: {
      injectedFailure: injectedFailure.error,
      deleteSuccessError,
      staleChildWriteError,
      reintroductionError,
    },
    audit: {
      failure: failureAudit,
      delete: deleteAudit,
      staleChildAttempt: staleChildAudit,
      reintroduction: reintroductionAudit,
    },
    decision,
    interpretation:
      decision === "REPLICATION_PASS_PARENT_SUBTREE_DELETE_REINTRODUCTION_COHERENT"
        ? "Parent subtree deletion and later reintroduction preserved source/projection/query/reopen correctness, prefix-neighbor isolation, and rejected the captured stale child handle."
        : decision === "MIXED_PARENT_SUBTREE_CURRENT_STATE_CORRECT_BUT_STALE_CHILD_WRITE_ACCEPTED"
          ? "Current durable state remained coherent through parent deletion and reintroduction, but a child proxy captured before parent deletion remained writable as a detached object. Its write did not resurrect the subtree, yet it was accepted and could still cause observation/persistence side effects."
          : decision === "FAIL_PARENT_SUBTREE_DELETE_OR_STALE_HANDLE_CORRUPTS_CURRENT_STATE"
            ? "Parent deletion/reintroduction or the captured child handle corrupted current source/projection/query/reopen state."
            : "The fixture, rollback control, or audit instrumentation did not establish a valid experiment.",
    uncertainty: {
      multiRowParentDeletionUntested: true,
      nestedArrayDeletionUntested: true,
      concurrentVersionOpenUntested: true,
      multipleWritersUntested: true,
      crashDurabilityBoundaryUntested: true,
      automaticMetadataDecayUntested: true,
      performanceOptimizationOutOfScope: true,
      publicNestedHandleInvalidationPolicyUndecided: true,
    },
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

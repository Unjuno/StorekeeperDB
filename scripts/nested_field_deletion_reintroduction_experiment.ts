import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";

type Routing = {
  queue: string;
  legacyTag?: string;
};

type Job = {
  id: string;
  routing: Routing;
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
  path: string;
  item_id: string;
};

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
const QUEUE_VALUE = "critical";
const LEGACY_ONE = "legacy-one";
const LEGACY_TWO = "legacy-two";

const INITIAL: Job = {
  id: JOB_ID,
  routing: {
    queue: QUEUE_VALUE,
    legacyTag: LEGACY_ONE,
  },
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
  physical.items[0]
    ? JSON.parse(physical.items[0].value_json) as Record<string, unknown>
    : undefined;

const sourceRouting = (physical: PhysicalSnapshot): Record<string, unknown> | undefined => {
  const routing = sourceObject(physical)?.routing;
  return routing && typeof routing === "object" && !Array.isArray(routing)
    ? routing as Record<string, unknown>
    : undefined;
};

const hasNestedSourceField = (physical: PhysicalSnapshot, field: string): boolean => {
  const routing = sourceRouting(physical);
  return Boolean(routing && Object.prototype.hasOwnProperty.call(routing, field));
};

const projectionCells = (physical: PhysicalSnapshot, path: string): ProjectionRow[] =>
  physical.projections.filter((row) => row.path === path);

const derivationsFor = (physical: PhysicalSnapshot, path: string): DerivationRow[] =>
  physical.derivations.filter((row) => row.path === path);

const pathsFor = (physical: PhysicalSnapshot, path: string): PathRow[] =>
  physical.paths.filter((row) => row.path === path);

const installAudit = (path: string): void => {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE __experiment_nested_projection_audit (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      op TEXT NOT NULL,
      path TEXT NOT NULL,
      item_id TEXT NOT NULL
    );

    CREATE TRIGGER __experiment_nested_projection_delete
    AFTER DELETE ON __sk_projection
    BEGIN
      INSERT INTO __experiment_nested_projection_audit(op,path,item_id)
      VALUES('delete', OLD.path, OLD.item_id);
    END;

    CREATE TRIGGER __experiment_nested_projection_insert
    AFTER INSERT ON __sk_projection
    BEGIN
      INSERT INTO __experiment_nested_projection_audit(op,path,item_id)
      VALUES('insert', NEW.path, NEW.item_id);
    END;

    CREATE TRIGGER __experiment_nested_projection_update
    AFTER UPDATE ON __sk_projection
    BEGIN
      INSERT INTO __experiment_nested_projection_audit(op,path,item_id)
      VALUES('update', NEW.path, NEW.item_id);
    END;
  `);
  db.close();
};

const clearAudit = (path: string): void => {
  const db = new DatabaseSync(path);
  db.exec("DELETE FROM __experiment_nested_projection_audit");
  db.close();
};

const readAudit = (path: string): AuditRow[] => {
  const db = new DatabaseSync(path);
  const rows = db.prepare(
    "SELECT seq,op,path,item_id FROM __experiment_nested_projection_audit ORDER BY seq",
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
    return {
      rejected: true,
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
};

const seed = (path: string): void => {
  const sk = new StorekeeperDB(path);
  sk.state<Job[]>(STATE_KEY, [INITIAL]);

  const queueMatches = sk.find<Dict>(STATE_KEY, { [QUEUE_PATH]: QUEUE_VALUE });
  const legacyMatches = sk.find<Dict>(STATE_KEY, { [LEGACY_PATH]: LEGACY_ONE });
  if (queueMatches.length !== 1 || legacyMatches.length !== 1) {
    throw new Error("nested projection setup failed");
  }
  sk.close();
};

const executeNestedDelete = (sk: StorekeeperDB, jobs: Job[], injectFailure: boolean): void => {
  sk.batch(() => {
    if (jobs.length !== 1) throw new Error("nested deletion requires exactly one job");
    const job = jobs[0]!;
    if (!Object.prototype.hasOwnProperty.call(job.routing, "legacyTag")) {
      throw new Error("nested deletion expected routing.legacyTag to exist");
    }
    delete job.routing.legacyTag;
    if (injectFailure) throw new Error("injected nested field deletion failure");
  });
};

const root = mkdtempSync(join(tmpdir(), "sk-nested-delete-reintro-"));
const path = join(root, "app.sqlite");
let validExperiment = false;

try {
  seed(path);
  installAudit(path);

  const initialPhysical = snapshot(path);
  const initialItemId = initialPhysical.items[0]?.id;
  const initialTopologyValid =
    initialPhysical.items.length === 1 &&
    projectionCells(initialPhysical, QUEUE_PATH).length === 1 &&
    projectionCells(initialPhysical, LEGACY_PATH).length === 1 &&
    projectionCells(initialPhysical, QUEUE_PATH)[0]?.value_json === JSON.stringify(QUEUE_VALUE) &&
    projectionCells(initialPhysical, LEGACY_PATH)[0]?.value_json === JSON.stringify(LEGACY_ONE) &&
    derivationsFor(initialPhysical, QUEUE_PATH).length === 1 &&
    derivationsFor(initialPhysical, LEGACY_PATH).length === 1;

  const sk = new StorekeeperDB(path);
  const jobs = sk.state<Job[]>(STATE_KEY, []);
  const beforeFailure = snapshot(path);
  clearAudit(path);

  const injectedFailure = expectFailure(() => executeNestedDelete(sk, jobs, true));
  const afterFailure = snapshot(path);
  const failureAudit = readAudit(path);
  const deleteTrapReached =
    injectedFailure.rejected &&
    injectedFailure.error.includes("injected nested field deletion failure");
  const exactPhysicalRollback = sameSnapshot(beforeFailure, afterFailure);
  const loadedMemoryRollback = jobs[0]?.routing.legacyTag === LEGACY_ONE;
  const failureAuditRolledBack = failureAudit.length === 0;

  clearAudit(path);
  let deleteSuccessRejected = false;
  let deleteSuccessError = "";
  try {
    executeNestedDelete(sk, jobs, false);
  } catch (caught) {
    deleteSuccessRejected = true;
    deleteSuccessError = caught instanceof Error ? caught.message : String(caught);
  }

  const afterDeleteBeforeQueries = snapshot(path);
  const deleteAudit = readAudit(path);
  const deleteSourceCorrect =
    !deleteSuccessRejected &&
    !hasNestedSourceField(afterDeleteBeforeQueries, "legacyTag") &&
    sourceRouting(afterDeleteBeforeQueries)?.queue === QUEUE_VALUE;
  const deleteProjectionCorrect =
    projectionCells(afterDeleteBeforeQueries, LEGACY_PATH).length === 0 &&
    projectionCells(afterDeleteBeforeQueries, QUEUE_PATH).length === 1 &&
    projectionCells(afterDeleteBeforeQueries, QUEUE_PATH)[0]?.value_json === JSON.stringify(QUEUE_VALUE);
  const identityStableAfterDelete =
    initialItemId !== undefined &&
    afterDeleteBeforeQueries.items[0]?.id === initialItemId &&
    afterDeleteBeforeQueries.items[0]?.pos === initialPhysical.items[0]?.pos;
  const deleteWriteShapeExpected =
    deleteAudit.length === 3 &&
    deleteAudit.every((row) => row.item_id === initialItemId) &&
    operationCount(deleteAudit, "delete", QUEUE_PATH) === 1 &&
    operationCount(deleteAudit, "insert", QUEUE_PATH) === 1 &&
    operationCount(deleteAudit, "delete", LEGACY_PATH) === 1 &&
    operationCount(deleteAudit, "insert", LEGACY_PATH) === 0 &&
    operationCount(deleteAudit, "update", QUEUE_PATH) === 0 &&
    operationCount(deleteAudit, "update", LEGACY_PATH) === 0;

  const oldMatchesAfterDelete = deleteSuccessRejected
    ? []
    : sk.find<Dict>(STATE_KEY, { [LEGACY_PATH]: LEGACY_ONE });
  const queueMatchesAfterDelete = deleteSuccessRejected
    ? []
    : sk.find<Dict>(STATE_KEY, { [QUEUE_PATH]: QUEUE_VALUE });
  const deleteQueriesCorrect =
    !deleteSuccessRejected &&
    oldMatchesAfterDelete.length === 0 &&
    queueMatchesAfterDelete.length === 1 &&
    queueMatchesAfterDelete[0]?.id === JOB_ID &&
    queueMatchesAfterDelete[0] === jobs[0];

  sk.close();

  const afterFirstReopenPhysical = snapshot(path);
  const firstReopenSourceCorrect =
    !hasNestedSourceField(afterFirstReopenPhysical, "legacyTag") &&
    sourceRouting(afterFirstReopenPhysical)?.queue === QUEUE_VALUE;
  const firstReopenProjectionCorrect =
    projectionCells(afterFirstReopenPhysical, LEGACY_PATH).length === 0 &&
    projectionCells(afterFirstReopenPhysical, QUEUE_PATH).length === 1;
  const identityStableAfterFirstReopen =
    afterFirstReopenPhysical.items[0]?.id === initialItemId &&
    afterFirstReopenPhysical.items[0]?.pos === initialPhysical.items[0]?.pos;

  const reopened = new StorekeeperDB(path);
  const reopenedJobs = reopened.state<Job[]>(STATE_KEY, []);
  clearAudit(path);

  let reintroductionRejected = false;
  let reintroductionError = "";
  try {
    const job = reopenedJobs[0];
    if (!job) throw new Error("reintroduction requires one reopened job");
    job.routing.legacyTag = LEGACY_TWO;
  } catch (caught) {
    reintroductionRejected = true;
    reintroductionError = caught instanceof Error ? caught.message : String(caught);
  }

  const afterReintroductionBeforeQueries = snapshot(path);
  const reintroductionAudit = readAudit(path);
  const reintroductionSourceCorrect =
    !reintroductionRejected &&
    hasNestedSourceField(afterReintroductionBeforeQueries, "legacyTag") &&
    sourceRouting(afterReintroductionBeforeQueries)?.legacyTag === LEGACY_TWO &&
    sourceRouting(afterReintroductionBeforeQueries)?.queue === QUEUE_VALUE;
  const reintroductionProjectionCorrect =
    projectionCells(afterReintroductionBeforeQueries, LEGACY_PATH).length === 1 &&
    projectionCells(afterReintroductionBeforeQueries, LEGACY_PATH)[0]?.value_json === JSON.stringify(LEGACY_TWO) &&
    projectionCells(afterReintroductionBeforeQueries, QUEUE_PATH).length === 1 &&
    projectionCells(afterReintroductionBeforeQueries, QUEUE_PATH)[0]?.value_json === JSON.stringify(QUEUE_VALUE);
  const noDuplicateProjectionCells =
    projectionCells(afterReintroductionBeforeQueries, LEGACY_PATH).length === 1 &&
    projectionCells(afterReintroductionBeforeQueries, QUEUE_PATH).length === 1;
  const identityStableAfterReintroduction =
    afterReintroductionBeforeQueries.items[0]?.id === initialItemId &&
    afterReintroductionBeforeQueries.items[0]?.pos === initialPhysical.items[0]?.pos;
  const reintroductionWriteShapeExpected =
    reintroductionAudit.length === 3 &&
    reintroductionAudit.every((row) => row.item_id === initialItemId) &&
    operationCount(reintroductionAudit, "delete", QUEUE_PATH) === 1 &&
    operationCount(reintroductionAudit, "insert", QUEUE_PATH) === 1 &&
    operationCount(reintroductionAudit, "delete", LEGACY_PATH) === 0 &&
    operationCount(reintroductionAudit, "insert", LEGACY_PATH) === 1 &&
    operationCount(reintroductionAudit, "update", QUEUE_PATH) === 0 &&
    operationCount(reintroductionAudit, "update", LEGACY_PATH) === 0;

  const oldMatchesAfterReintroduction = reintroductionRejected
    ? []
    : reopened.find<Dict>(STATE_KEY, { [LEGACY_PATH]: LEGACY_ONE });
  const newMatchesAfterReintroduction = reintroductionRejected
    ? []
    : reopened.find<Dict>(STATE_KEY, { [LEGACY_PATH]: LEGACY_TWO });
  const queueMatchesAfterReintroduction = reintroductionRejected
    ? []
    : reopened.find<Dict>(STATE_KEY, { [QUEUE_PATH]: QUEUE_VALUE });
  const reintroductionQueriesCorrect =
    !reintroductionRejected &&
    oldMatchesAfterReintroduction.length === 0 &&
    newMatchesAfterReintroduction.length === 1 &&
    newMatchesAfterReintroduction[0]?.id === JOB_ID &&
    newMatchesAfterReintroduction[0] === reopenedJobs[0] &&
    queueMatchesAfterReintroduction.length === 1;

  reopened.close();

  const afterSecondReopenPhysical = snapshot(path);
  const finalReopen = new StorekeeperDB(path);
  const finalJobs = finalReopen.state<Job[]>(STATE_KEY, []);
  const finalNewMatches = finalReopen.find<Dict>(STATE_KEY, { [LEGACY_PATH]: LEGACY_TWO });
  const finalQueueMatches = finalReopen.find<Dict>(STATE_KEY, { [QUEUE_PATH]: QUEUE_VALUE });
  const secondReopenCorrect =
    finalJobs.length === 1 &&
    finalJobs[0]?.routing.legacyTag === LEGACY_TWO &&
    finalJobs[0]?.routing.queue === QUEUE_VALUE &&
    finalNewMatches.length === 1 &&
    finalQueueMatches.length === 1 &&
    afterSecondReopenPhysical.items[0]?.id === initialItemId &&
    projectionCells(afterSecondReopenPhysical, LEGACY_PATH).length === 1 &&
    projectionCells(afterSecondReopenPhysical, LEGACY_PATH)[0]?.value_json === JSON.stringify(LEGACY_TWO);
  finalReopen.close();

  const metadataLifecycleCoherent =
    derivationsFor(afterDeleteBeforeQueries, QUEUE_PATH).length === 1 &&
    derivationsFor(afterDeleteBeforeQueries, LEGACY_PATH).length === 1 &&
    pathsFor(afterDeleteBeforeQueries, QUEUE_PATH).length === 1 &&
    pathsFor(afterDeleteBeforeQueries, LEGACY_PATH).length === 1 &&
    derivationsFor(afterReintroductionBeforeQueries, QUEUE_PATH).length === 1 &&
    derivationsFor(afterReintroductionBeforeQueries, LEGACY_PATH).length === 1 &&
    pathsFor(afterReintroductionBeforeQueries, QUEUE_PATH).length === 1 &&
    pathsFor(afterReintroductionBeforeQueries, LEGACY_PATH).length === 1;

  const currentStateCorrect =
    deleteSourceCorrect &&
    deleteProjectionCorrect &&
    reintroductionSourceCorrect &&
    reintroductionProjectionCorrect &&
    noDuplicateProjectionCells;
  const queriesAndHandlesCorrect =
    deleteQueriesCorrect && reintroductionQueriesCorrect;
  const identityAndReopenCorrect =
    identityStableAfterDelete &&
    firstReopenSourceCorrect &&
    firstReopenProjectionCorrect &&
    identityStableAfterFirstReopen &&
    identityStableAfterReintroduction &&
    secondReopenCorrect;
  const expectedItemLocalWriteShape =
    deleteWriteShapeExpected && reintroductionWriteShapeExpected;

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
        !queriesAndHandlesCorrect ||
        !identityAndReopenCorrect
      ? "FAIL_NESTED_DELETE_OR_REINTRODUCTION_CORRUPTS_CURRENT_STATE"
      : !metadataLifecycleCoherent || !expectedItemLocalWriteShape
        ? "MIXED_NESTED_LIFECYCLE_CORRECT_WITH_METADATA_OR_WRITE_ROUGHNESS"
        : "REPLICATION_PASS_NESTED_DELETE_REINTRODUCTION_COHERENT";

  console.log(JSON.stringify({
    experiment: "nested-field-deletion-reintroduction-projection-lifecycle",
    issue: 78,
    scenario: "routing.legacyTag delete -> reopen -> reintroduce with routing.queue sibling projection retained",
    checks: {
      initialTopologyValid,
      deleteTrapReached,
      exactPhysicalRollback,
      loadedMemoryRollback,
      failureAuditRolledBack,
      deleteSuccessRejected,
      deleteSourceCorrect,
      deleteProjectionCorrect,
      deleteQueriesCorrect,
      identityStableAfterDelete,
      firstReopenSourceCorrect,
      firstReopenProjectionCorrect,
      identityStableAfterFirstReopen,
      reintroductionRejected,
      reintroductionSourceCorrect,
      reintroductionProjectionCorrect,
      noDuplicateProjectionCells,
      reintroductionQueriesCorrect,
      identityStableAfterReintroduction,
      secondReopenCorrect,
      metadataLifecycleCoherent,
      deleteWriteShapeExpected,
      reintroductionWriteShapeExpected,
      expectedItemLocalWriteShape,
      currentStateCorrect,
      queriesAndHandlesCorrect,
      identityAndReopenCorrect,
      validExperiment,
    },
    errors: {
      injectedFailure: injectedFailure.error,
      deleteSuccessError,
      reintroductionError,
    },
    audit: {
      failure: failureAudit,
      delete: deleteAudit,
      reintroduction: reintroductionAudit,
    },
    physical: {
      initial: initialPhysical,
      beforeFailure,
      afterFailure,
      afterDeleteBeforeQueries,
      afterFirstReopen: afterFirstReopenPhysical,
      afterReintroductionBeforeQueries,
      afterSecondReopen: afterSecondReopenPhysical,
    },
    decision,
    interpretation:
      decision === "REPLICATION_PASS_NESTED_DELETE_REINTRODUCTION_COHERENT"
        ? "Nested projected-field deletion and later reintroduction preserved source, sibling projection, durable-query semantics, item identity, rollback, and reopen behavior. The existing derivation/path identity remained reusable, and projection maintenance followed the already-measured item-local rebuild shape without duplicate or stale cells."
        : decision === "MIXED_NESTED_LIFECYCLE_CORRECT_WITH_METADATA_OR_WRITE_ROUGHNESS"
          ? "Nested deletion/reintroduction remained correct at the source/query/reopen level, but metadata lifecycle or projection-write shape differed from the expected reusable-path/item-local-rebuild model."
          : decision === "FAIL_NESTED_DELETE_OR_REINTRODUCTION_CORRUPTS_CURRENT_STATE"
            ? "The nested delete/reintroduce lifecycle exposed a current-state, query, identity, or reopen correctness defect."
            : "The fixture, rollback control, or audit instrumentation did not establish a valid experiment.",
    uncertainty: {
      parentObjectDeletionUntested: true,
      nestedArrayElementDeletionUntested: true,
      concurrentVersionOpenUntested: true,
      multipleWritersUntested: true,
      automaticMetadataDecayUntested: true,
      performanceOptimizationOutOfScope: true,
    },
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

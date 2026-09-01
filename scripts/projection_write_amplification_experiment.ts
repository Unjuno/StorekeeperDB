import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";

type AuditRow = {
  seq: number;
  op: string;
  path: string;
  item_id: string;
};

type ProjectionRow = {
  path: string;
  item_id: string;
  value_json: string;
};

type TimingSummary = {
  samples: number;
  minMs: number;
  medianMs: number;
  p90Ms: number;
  maxMs: number;
};

type CaseResult = {
  projectedPathCount: number;
  expectedProjectionWrites: number;
  observedProjectionWrites: number;
  deletes: number;
  inserts: number;
  updates: number;
  oneDeleteAndInsertPerPath: boolean;
  sourceCorrect: boolean;
  projectionCorrect: boolean;
  queryCorrect: boolean;
  reopenCorrect: boolean;
  timing: TimingSummary;
};

const PATH_COUNTS = [1, 4, 16, 64] as const;
const WARMUP_MUTATIONS = 20;
const TIMED_MUTATIONS = 80;
const STATE_KEY = "items";
const ITEM_ID = "ITEM-1";

const fieldName = (index: number): string => `p${index}`;
const initialValue = (index: number): string => `v${index}`;

const makeItem = (pathCount: number): Dict => {
  const item: Dict = { id: ITEM_ID };
  for (let index = 0; index < pathCount; index += 1) {
    item[fieldName(index)] = initialValue(index);
  }
  return item;
};

const activateProjections = (sk: StorekeeperDB, pathCount: number): void => {
  for (let index = 0; index < pathCount; index += 1) {
    const path = fieldName(index);
    const matches = sk.find<Dict>(STATE_KEY, { [path]: initialValue(index) });
    if (matches.length !== 1) {
      throw new Error(`projection setup failed for ${path}: ${matches.length}`);
    }
  }
};

const seed = (path: string, pathCount: number): void => {
  const sk = new StorekeeperDB(path);
  sk.state<Dict[]>(STATE_KEY, [makeItem(pathCount)]);
  activateProjections(sk, pathCount);
  sk.close();
};

const installProjectionAudit = (path: string): void => {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE __experiment_projection_audit (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      op TEXT NOT NULL,
      path TEXT NOT NULL,
      item_id TEXT NOT NULL
    );

    CREATE TRIGGER __experiment_projection_delete
    AFTER DELETE ON __sk_projection
    BEGIN
      INSERT INTO __experiment_projection_audit(op,path,item_id)
      VALUES('delete', OLD.path, OLD.item_id);
    END;

    CREATE TRIGGER __experiment_projection_insert
    AFTER INSERT ON __sk_projection
    BEGIN
      INSERT INTO __experiment_projection_audit(op,path,item_id)
      VALUES('insert', NEW.path, NEW.item_id);
    END;

    CREATE TRIGGER __experiment_projection_update
    AFTER UPDATE ON __sk_projection
    BEGIN
      INSERT INTO __experiment_projection_audit(op,path,item_id)
      VALUES('update', NEW.path, NEW.item_id);
    END;
  `);
  db.close();
};

const readAudit = (path: string): AuditRow[] => {
  const db = new DatabaseSync(path);
  const rows = db.prepare(
    "SELECT seq,op,path,item_id FROM __experiment_projection_audit ORDER BY seq",
  ).all() as AuditRow[];
  db.close();
  return rows;
};

const readProjections = (path: string): ProjectionRow[] => {
  const db = new DatabaseSync(path);
  const rows = db.prepare(
    "SELECT path,item_id,value_json FROM __sk_projection WHERE state_key=? ORDER BY path,item_id",
  ).all(STATE_KEY) as ProjectionRow[];
  db.close();
  return rows;
};

const physicalItemId = (path: string): string => {
  const db = new DatabaseSync(path);
  const row = db.prepare(
    "SELECT id FROM __sk_items WHERE state_key=? ORDER BY pos LIMIT 1",
  ).get(STATE_KEY) as { id: string } | undefined;
  db.close();
  if (!row) throw new Error("missing physical item id");
  return row.id;
};

const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index] ?? 0;
};

const summarizeTiming = (samples: number[]): TimingSummary => ({
  samples: samples.length,
  minMs: percentile(samples, 0),
  medianMs: percentile(samples, 0.5),
  p90Ms: percentile(samples, 0.9),
  maxMs: percentile(samples, 1),
});

const timeMutation = (handle: Dict, pathCount: number): TimingSummary => {
  const path = fieldName(0);
  for (let index = 0; index < WARMUP_MUTATIONS; index += 1) {
    handle[path] = `warm-${pathCount}-${index}`;
  }

  const samples: number[] = [];
  for (let index = 0; index < TIMED_MUTATIONS; index += 1) {
    const start = process.hrtime.bigint();
    handle[path] = `sample-${pathCount}-${index}`;
    const end = process.hrtime.bigint();
    samples.push(Number(end - start) / 1_000_000);
  }
  return summarizeTiming(samples);
};

const runAuditedCase = (pathCount: number): Omit<CaseResult, "timing"> => {
  const dir = mkdtempSync(join(tmpdir(), `sk-write-audit-${pathCount}-`));
  const path = join(dir, "app.sqlite");
  try {
    seed(path, pathCount);
    installProjectionAudit(path);
    const physicalId = physicalItemId(path);

    const sk = new StorekeeperDB(path);
    const items = sk.state<Dict[]>(STATE_KEY, []);
    const handle = items[0];
    if (!handle) throw new Error("missing durable item handle");

    const replacement = `changed-${pathCount}`;
    handle[fieldName(0)] = replacement;

    const audit = readAudit(path);
    const projections = readProjections(path);
    const deletes = audit.filter((row) => row.op === "delete");
    const inserts = audit.filter((row) => row.op === "insert");
    const updates = audit.filter((row) => row.op === "update");

    const expectedPaths = Array.from({ length: pathCount }, (_, index) => fieldName(index));
    const oneDeleteAndInsertPerPath =
      audit.every((row) => row.item_id === physicalId) &&
      deletes.length === pathCount &&
      inserts.length === pathCount &&
      updates.length === 0 &&
      expectedPaths.every(
        (projectionPath) =>
          deletes.filter((row) => row.path === projectionPath).length === 1 &&
          inserts.filter((row) => row.path === projectionPath).length === 1,
      );

    const sourceCorrect = handle[fieldName(0)] === replacement;
    const projectionCorrect =
      projections.length === pathCount &&
      expectedPaths.every((projectionPath, index) => {
        const row = projections.find((candidate) => candidate.path === projectionPath);
        const expected = index === 0 ? replacement : initialValue(index);
        return row?.item_id === physicalId && row.value_json === JSON.stringify(expected);
      });

    const queryMatches = sk.find<Dict>(STATE_KEY, { [fieldName(0)]: replacement });
    const queryCorrect = queryMatches.length === 1 && queryMatches[0]?.id === ITEM_ID;
    sk.close();

    const reopened = new StorekeeperDB(path);
    const reopenedItems = reopened.state<Dict[]>(STATE_KEY, []);
    const reopenCorrect =
      reopenedItems.length === 1 &&
      reopenedItems[0]?.id === ITEM_ID &&
      reopenedItems[0]?.[fieldName(0)] === replacement;
    reopened.close();

    return {
      projectedPathCount: pathCount,
      expectedProjectionWrites: 2 * pathCount,
      observedProjectionWrites: audit.length,
      deletes: deletes.length,
      inserts: inserts.length,
      updates: updates.length,
      oneDeleteAndInsertPerPath,
      sourceCorrect,
      projectionCorrect,
      queryCorrect,
      reopenCorrect,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const runTimingCase = (pathCount: number): TimingSummary => {
  const dir = mkdtempSync(join(tmpdir(), `sk-write-time-${pathCount}-`));
  const path = join(dir, "app.sqlite");
  try {
    seed(path, pathCount);
    const sk = new StorekeeperDB(path);
    const items = sk.state<Dict[]>(STATE_KEY, []);
    const handle = items[0];
    if (!handle) throw new Error("missing timing durable item handle");
    const timing = timeMutation(handle, pathCount);
    sk.close();
    return timing;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const results: CaseResult[] = PATH_COUNTS.map((pathCount) => ({
  ...runAuditedCase(pathCount),
  timing: runTimingCase(pathCount),
}));

const deterministicCorrectness = results.every(
  (result) =>
    result.sourceCorrect &&
    result.projectionCorrect &&
    result.queryCorrect &&
    result.reopenCorrect,
);

const exactTwoWritesPerProjectedPath = results.every(
  (result) =>
    result.observedProjectionWrites === result.expectedProjectionWrites &&
    result.oneDeleteAndInsertPerPath,
);

const writeRatios = results.map(
  (result) => result.observedProjectionWrites / result.projectedPathCount,
);
const constantWriteRatio = writeRatios.every((ratio) => ratio === writeRatios[0]);
const validExperiment = deterministicCorrectness && results.every((result) => result.timing.samples === TIMED_MUTATIONS);

const decision = !validExperiment
  ? "INVALID_EXPERIMENT"
  : exactTwoWritesPerProjectedPath && constantWriteRatio
    ? "MEASURED_LINEAR_ITEM_REBUILD_WRITES_TIMING_OBSERVATIONAL"
    : "MEASURED_DIFFERENT_PROJECTION_WRITE_SHAPE";

const output = {
  experiment: "projection-maintenance-write-amplification",
  variables: {
    projectedPathCounts: PATH_COUNTS,
    warmupMutations: WARMUP_MUTATIONS,
    timedMutations: TIMED_MUTATIONS,
    writeUnit: "projection row DELETE/INSERT/UPDATE operations per one durable item mutation",
    timingUnit: "milliseconds per one durable item mutation",
  },
  checks: {
    deterministicCorrectness,
    exactTwoWritesPerProjectedPath,
    constantWriteRatio,
    validExperiment,
  },
  results,
  decision,
  interpretation:
    decision === "MEASURED_LINEAR_ITEM_REBUILD_WRITES_TIMING_OBSERVATIONAL"
      ? "Projection maintenance produced exactly one DELETE and one INSERT per active projected path for a one-field durable item mutation. Deterministic write amplification is W(P)=2P in this scenario. Timing is observational only and is not used as a release threshold."
      : decision === "MEASURED_DIFFERENT_PROJECTION_WRITE_SHAPE"
        ? "The measured projection-write shape differs from the expected item-local rebuild signature; inspect per-P audit rows before generalizing."
        : "The experiment failed a correctness or measurement-validity precondition.",
  uncertainty: {
    timingIncludesLocalSQLiteAndRuntimeNoise: true,
    timingUsesSeparateDatabaseWithoutAuditTriggers: true,
    noLatencyReleaseGate: true,
    noConcurrentWriterCoverage: true,
    noProductionScaleClaim: true,
  },
};

console.log(JSON.stringify(output, null, 2));

if (!validExperiment) process.exit(1);

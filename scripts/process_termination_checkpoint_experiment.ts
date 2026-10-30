import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

type ReadResult = {
  candidate: "raw" | "project";
  taskStatus: string;
  checkpointSequence: number;
  tagPreserved: boolean;
  doingCount: number;
  doneCount: number;
  acceptedDecisionCount: number;
};

type PhysicalSnapshot = {
  taskStatus: string;
  checkpointSequence: number;
  statusProjectionValueJson: string | null;
};

type SqliteEnvironment = {
  journalMode: string;
  synchronous: number;
};

type CrashResult = {
  expectedExitCode: boolean;
  exitCode: number | null;
  markerReached: boolean;
  markerValue: string;
};

type CandidateResult = {
  baseline: ReadResult;
  crash: CrashResult;
  physicalAfterCrashBeforeReader: PhysicalSnapshot;
  readerAfterCrash: ReadResult;
  readerAfterCommit: ReadResult;
  terminationRollbackCorrect: boolean;
  projectionRollbackCorrect: boolean;
  finalCommitCorrect: boolean;
};

const readJson = (script: string, dbPath: string): ReadResult => {
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-sqlite", script, "--read", dbPath],
    { encoding: "utf8", stdio: "pipe" },
  );
  return JSON.parse(stdout.trim()) as ReadResult;
};

const runNormal = (script: string, mode: "--seed" | "--commit", dbPath: string): void => {
  execFileSync(
    process.execPath,
    ["--experimental-sqlite", script, mode, dbPath],
    { encoding: "utf8", stdio: "pipe" },
  );
};

const runCrash = (
  script: string,
  dbPath: string,
  markerPath: string,
  expectedMarker: string,
): CrashResult => {
  let exitCode: number | null = null;
  try {
    execFileSync(
      process.execPath,
      ["--experimental-sqlite", script, "--crash", dbPath, markerPath],
      { encoding: "utf8", stdio: "pipe" },
    );
  } catch (caught) {
    const error = caught as { status?: number | null };
    exitCode = typeof error.status === "number" ? error.status : null;
  }

  let markerValue = "";
  try {
    markerValue = readFileSync(markerPath, "utf8");
  } catch {
    markerValue = "";
  }

  return {
    expectedExitCode: exitCode === 86,
    exitCode,
    markerReached: markerValue === expectedMarker,
    markerValue,
  };
};

const inspectPhysical = (path: string): PhysicalSnapshot => {
  const db = new DatabaseSync(path);
  try {
    const taskRow = db.prepare(
      "SELECT value_json FROM __sk_items WHERE state_key='tasks' ORDER BY pos LIMIT 1",
    ).get() as { value_json: string } | undefined;
    const workspaceRow = db.prepare(
      "SELECT value_json FROM __sk_items WHERE state_key='__workspace' ORDER BY pos LIMIT 1",
    ).get() as { value_json: string } | undefined;
    const projectionRow = db.prepare(
      "SELECT value_json FROM __sk_projection WHERE state_key='tasks' AND path='status' ORDER BY item_id LIMIT 1",
    ).get() as { value_json: string } | undefined;

    const task = taskRow ? JSON.parse(taskRow.value_json) as { status?: string } : {};
    const workspace = workspaceRow
      ? JSON.parse(workspaceRow.value_json) as { checkpoint?: { sequence?: number } }
      : {};

    return {
      taskStatus: task.status ?? "",
      checkpointSequence: workspace.checkpoint?.sequence ?? -1,
      statusProjectionValueJson: projectionRow?.value_json ?? null,
    };
  } finally {
    db.close();
  }
};

const inspectSqliteEnvironment = (path: string): SqliteEnvironment => {
  const db = new DatabaseSync(path);
  try {
    const journal = db.prepare("PRAGMA journal_mode").get() as
      | { journal_mode: string }
      | undefined;
    const synchronous = db.prepare("PRAGMA synchronous").get() as
      | { synchronous: number }
      | undefined;
    return {
      journalMode: journal?.journal_mode ?? "unknown",
      synchronous: synchronous?.synchronous ?? -1,
    };
  } finally {
    db.close();
  }
};

const baselineCorrect = (value: ReadResult): boolean =>
  value.taskStatus === "doing" &&
  value.checkpointSequence === 1 &&
  value.tagPreserved &&
  value.doingCount === 1 &&
  value.doneCount === 0 &&
  value.acceptedDecisionCount === 1;

const postCrashCorrect = (
  physical: PhysicalSnapshot,
  reader: ReadResult,
): boolean =>
  physical.taskStatus === "doing" &&
  physical.checkpointSequence === 1 &&
  physical.statusProjectionValueJson === JSON.stringify("doing") &&
  baselineCorrect(reader);

const finalCommitCorrect = (reader: ReadResult): boolean =>
  reader.taskStatus === "done" &&
  reader.checkpointSequence === 2 &&
  reader.tagPreserved &&
  reader.doingCount === 0 &&
  reader.doneCount === 1 &&
  reader.acceptedDecisionCount === 1;

const runCandidate = (
  candidate: "raw" | "project",
  script: string,
  dbPath: string,
  markerPath: string,
): CandidateResult => {
  runNormal(script, "--seed", dbPath);
  const baseline = readJson(script, dbPath);
  const expectedMarker =
    candidate === "raw" ? "raw-after-task-write" : "project-after-task-write";
  const crash = runCrash(script, dbPath, markerPath, expectedMarker);
  const physicalAfterCrashBeforeReader = inspectPhysical(dbPath);
  const readerAfterCrash = readJson(script, dbPath);

  const terminationRollbackCorrect =
    crash.expectedExitCode &&
    crash.markerReached &&
    postCrashCorrect(physicalAfterCrashBeforeReader, readerAfterCrash);
  const projectionRollbackCorrect =
    physicalAfterCrashBeforeReader.statusProjectionValueJson ===
    JSON.stringify("doing");

  runNormal(script, "--commit", dbPath);
  const readerAfterCommit = readJson(script, dbPath);
  const committed = finalCommitCorrect(readerAfterCommit);

  return {
    baseline,
    crash,
    physicalAfterCrashBeforeReader,
    readerAfterCrash,
    readerAfterCommit,
    terminationRollbackCorrect,
    projectionRollbackCorrect,
    finalCommitCorrect: committed,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-process-termination-checkpoint-"));
let validExperiment = false;

try {
  const rawDb = join(root, "raw.sqlite");
  const projectDb = join(root, "project.sqlite");

  const raw = runCandidate(
    "raw",
    "dist/scripts/process_termination_checkpoint/raw_candidate.js",
    rawDb,
    join(root, "raw-crash.marker"),
  );
  const project = runCandidate(
    "project",
    "dist/scripts/process_termination_checkpoint/project_candidate.js",
    projectDb,
    join(root, "project-crash.marker"),
  );

  const sqliteEnvironment = {
    raw: inspectSqliteEnvironment(rawDb),
    project: inspectSqliteEnvironment(projectDb),
  };

  const runtimeSource = readFileSync("src/runtime.ts", "utf8");
  const runtimeSetsJournalMode =
    /PRAGMA\s+journal_mode/i.test(runtimeSource);
  const runtimeSetsSynchronous =
    /PRAGMA\s+synchronous/i.test(runtimeSource);

  const rawBaselineValid = baselineCorrect(raw.baseline);
  const projectBaselineValid = baselineCorrect(project.baseline);
  const crashInstrumentationValid =
    raw.crash.expectedExitCode &&
    raw.crash.markerReached &&
    project.crash.expectedExitCode &&
    project.crash.markerReached;

  validExperiment =
    rawBaselineValid &&
    projectBaselineValid &&
    crashInstrumentationValid;

  const rawPass =
    raw.terminationRollbackCorrect &&
    raw.projectionRollbackCorrect &&
    raw.finalCommitCorrect;
  const projectPass =
    project.terminationRollbackCorrect &&
    project.projectionRollbackCorrect &&
    project.finalCommitCorrect;

  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : rawPass && projectPass
      ? "PASS_PROCESS_TERMINATION_ROLLS_BACK_OPEN_CHECKPOINT_TRANSACTION"
      : rawPass !== projectPass
        ? "MIXED_RAW_AND_PROJECT_DELEGATION_DIFFER"
        : "FAIL_PROCESS_TERMINATION_LEAVES_PARTIAL_CHECKPOINT";

  console.log(JSON.stringify({
    experiment: "process-termination-open-checkpoint-transaction",
    issue: 91,
    crashPoint:
      "task status mutation returned synchronously; sidecar marker written; process.exit(86) before checkpoint mutation and before transaction callback return",
    candidates: {
      raw,
      project,
    },
    sqliteEnvironment,
    runtimePragmaPolicy: {
      runtimeSetsJournalMode,
      runtimeSetsSynchronous,
      interpretation:
        !runtimeSetsJournalMode && !runtimeSetsSynchronous
          ? "StorekeeperDB runtime does not set journal_mode or synchronous; observed values are Node/SQLite environment assumptions, not a StorekeeperDB durability contract."
          : "StorekeeperDB runtime source contains an explicit durability-related PRAGMA; interpret observed values with that configured policy.",
    },
    checks: {
      rawBaselineValid,
      projectBaselineValid,
      crashInstrumentationValid,
      rawPass,
      projectPass,
      physicalStateInspectedBeforeReader: true,
      processExitCode: 86,
      powerLossSimulated: false,
    },
    decision,
    validExperiment,
    interpretation:
      decision === "PASS_PROCESS_TERMINATION_ROLLS_BACK_OPEN_CHECKPOINT_TRANSACTION"
        ? "Both raw StorekeeperDB.batch() and the thin project batch delegation recovered the pre-transaction task, checkpoint, and status projection after abrupt writer-process exit. A later normal transaction committed task + checkpoint coherently. This establishes the tested process-termination boundary only, not power-loss durability."
        : decision === "MIXED_RAW_AND_PROJECT_DELEGATION_DIFFER"
          ? "The raw transaction and thin project delegation differed under identical writer-process termination, so the delegation cannot be treated as semantically transparent."
          : decision === "FAIL_PROCESS_TERMINATION_LEAVES_PARTIAL_CHECKPOINT"
            ? "At least one candidate exposed partial task/checkpoint or projection state after writer-process termination."
            : "The seed state or crash-point instrumentation did not establish a valid process-termination experiment.",
    uncertainty: {
      processExitIsNotPowerLoss: true,
      kernelCrashUntested: true,
      filesystemCacheFailureUntested: true,
      concurrentWritersUntested: true,
      versionSkewUntested: true,
      remoteBrowserBackendsUntested: true,
      publicProjectBatchApiAuthorized: false,
    },
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

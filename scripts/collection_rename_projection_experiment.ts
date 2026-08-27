import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { initialTasks } from "./agent_decision_burden/model.js";
import type { TaskV1 } from "./agent_decision_burden/model.js";
import { openAliasRenameProjectStore, renameList } from "./declaration_key_rename/convention_candidates.js";

type CountRow = { state_key: string; path?: string; n: number };
type ItemRow = { state_key: string; value_json: string };
type ManifestValue = {
  bindings?: Record<string, { physicalKey?: string; kind?: string }>;
};

type PhysicalSnapshot = {
  itemCounts: Record<string, number>;
  projectionCounts: Record<string, number>;
  pathKeys: string[];
  derivationKeys: string[];
  manifestBindings: Record<string, { physicalKey?: string; kind?: string }>;
};

const countMap = (rows: CountRow[], includePath: boolean): Record<string, number> =>
  Object.fromEntries(rows.map((row) => [includePath ? `${row.state_key}:${row.path ?? ""}` : row.state_key, Number(row.n)]));

const physicalSnapshot = (path: string): PhysicalSnapshot => {
  const db = new DatabaseSync(path);
  const itemCounts = countMap(
    db.prepare("SELECT state_key,COUNT(*) n FROM __sk_items GROUP BY state_key ORDER BY state_key").all() as CountRow[],
    false,
  );
  const projectionCounts = countMap(
    db.prepare("SELECT state_key,path,COUNT(*) n FROM __sk_projection GROUP BY state_key,path ORDER BY state_key,path").all() as CountRow[],
    true,
  );
  const pathKeys = (db.prepare("SELECT state_key,path FROM __sk_paths ORDER BY state_key,path").all() as Array<{ state_key: string; path: string }>)
    .map((row) => `${row.state_key}:${row.path}`);
  const derivationKeys = (db.prepare("SELECT state_key,path FROM __sk_derivations ORDER BY state_key,path").all() as Array<{ state_key: string; path: string }>)
    .map((row) => `${row.state_key}:${row.path}`);
  const manifestRow = db.prepare("SELECT state_key,value_json FROM __sk_items WHERE state_key='__project_identity' LIMIT 1").get() as ItemRow | undefined;
  const manifest = manifestRow ? JSON.parse(manifestRow.value_json) as ManifestValue : {};
  db.close();
  return {
    itemCounts,
    projectionCounts,
    pathKeys,
    derivationKeys,
    manifestBindings: manifest.bindings ?? {},
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-collection-rename-projection-"));
const dbPath = join(root, "project.sqlite");
let validExperiment = false;

try {
  const v1 = openAliasRenameProjectStore(dbPath, {
    tasks: renameList(initialTasks()),
  });

  const urgentBefore = v1.find(v1.state.tasks, { priority: "urgent" });
  const projectionCreatedBeforeRename = urgentBefore.length === 1 && urgentBefore[0] === v1.state.tasks[0];
  v1.close();

  const beforeRename = physicalSnapshot(dbPath);
  const projectionCellsBeforeRename = beforeRename.projectionCounts["tasks:priority"] ?? 0;
  const derivedMetadataBeforeRename =
    beforeRename.pathKeys.includes("tasks:priority") &&
    beforeRename.derivationKeys.includes("tasks:priority") &&
    projectionCellsBeforeRename === 2;

  const renamed = openAliasRenameProjectStore(dbPath, {
    workItems: renameList<TaskV1>([], { from: "tasks" }),
  });

  const renamedValuePreserved = renamed.state.workItems.length === 2 && renamed.state.workItems[0]?.id === "TASK-1";
  const urgentAfterRename = renamed.find(renamed.state.workItems, { priority: "urgent" });
  const renamedQueryReturnsDurableHandle = urgentAfterRename.length === 1 && urgentAfterRename[0] === renamed.state.workItems[0];

  urgentAfterRename.pop();
  const queryResultArrayIsLocal = urgentAfterRename.length === 0 && renamed.state.workItems.length === 2;

  const handle = renamed.find(renamed.state.workItems, { priority: "urgent" })[0]!;
  handle.title = "Renamed collection mutation";
  handle.priority = "high";

  const urgentAfterMutation = renamed.find(renamed.state.workItems, { priority: "urgent" });
  const highAfterMutation = renamed.find(renamed.state.workItems, { priority: "high" });
  const projectionUpdatedAfterHandleMutation =
    urgentAfterMutation.length === 0 &&
    highAfterMutation.length === 1 &&
    highAfterMutation[0] === handle;
  renamed.close();

  const afterRename = physicalSnapshot(dbPath);
  const projectionCellsAfterRename = afterRename.projectionCounts["tasks:priority"] ?? 0;
  const noDuplicatePhysicalSource =
    (afterRename.itemCounts.tasks ?? 0) === 2 &&
    (afterRename.itemCounts.workItems ?? 0) === 0;
  const noLogicalMetadataLeak =
    !Object.keys(afterRename.projectionCounts).some((key) => key.startsWith("workItems:")) &&
    !afterRename.pathKeys.some((key) => key.startsWith("workItems:")) &&
    !afterRename.derivationKeys.some((key) => key.startsWith("workItems:"));
  const existingProjectionRemainedPhysical =
    projectionCellsAfterRename === 2 &&
    afterRename.pathKeys.includes("tasks:priority") &&
    afterRename.derivationKeys.includes("tasks:priority");
  const manifestBindsLogicalToPhysical =
    afterRename.manifestBindings.workItems?.physicalKey === "tasks" &&
    afterRename.manifestBindings.workItems?.kind === "list" &&
    afterRename.manifestBindings.tasks === undefined;

  const reopened = openAliasRenameProjectStore(dbPath, {
    workItems: renameList<TaskV1>([]),
  });
  const reopenedHigh = reopened.find(reopened.state.workItems, { priority: "high" });
  const reopenWithoutAliasPreservesMutation =
    reopened.state.workItems.length === 2 &&
    reopenedHigh.length === 1 &&
    reopenedHigh[0]?.title === "Renamed collection mutation" &&
    reopenedHigh[0]?.priority === "high";
  reopened.close();

  const finalPhysical = physicalSnapshot(dbPath);
  const noLateLogicalDuplication =
    (finalPhysical.itemCounts.workItems ?? 0) === 0 &&
    !Object.keys(finalPhysical.projectionCounts).some((key) => key.startsWith("workItems:")) &&
    !finalPhysical.pathKeys.some((key) => key.startsWith("workItems:")) &&
    !finalPhysical.derivationKeys.some((key) => key.startsWith("workItems:"));

  const checks = {
    projectionCreatedBeforeRename,
    derivedMetadataBeforeRename,
    renamedValuePreserved,
    renamedQueryReturnsDurableHandle,
    queryResultArrayIsLocal,
    projectionUpdatedAfterHandleMutation,
    noDuplicatePhysicalSource,
    noLogicalMetadataLeak,
    existingProjectionRemainedPhysical,
    manifestBindsLogicalToPhysical,
    reopenWithoutAliasPreservesMutation,
    noLateLogicalDuplication,
  };

  validExperiment = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({
    experiment: "collection-rename-with-active-projection",
    issue: 52,
    scenario: "tasks -> workItems after priority projection already exists",
    instrumentation: "Direct SQLite inspection is limited to source/projection/path/derivation/manifest identity checks; application mutation/query behavior uses the experiment project surface over public StorekeeperDB APIs.",
    physicalIdentity: {
      logicalBefore: "tasks",
      logicalAfter: "workItems",
      physicalBefore: "tasks",
      physicalAfter: afterRename.manifestBindings.workItems?.physicalKey ?? null,
    },
    counts: {
      projectionCellsBeforeRename,
      projectionCellsAfterRename,
      sourceItemsAfterRename: afterRename.itemCounts.tasks ?? 0,
      logicalNamedSourceItemsAfterRename: afterRename.itemCounts.workItems ?? 0,
    },
    checks,
    decision: validExperiment
      ? "CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE"
      : "FAIL_ALIAS_MODEL_WITH_DERIVED_STATE",
    uncertainty: {
      multiStepRenameChainUntested: true,
      physicalKeyCompactionUntested: true,
      concurrentOpenDuringRenameUntested: true,
      publicApiDecisionAuthorized: false,
    },
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

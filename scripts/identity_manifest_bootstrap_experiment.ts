import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "@storekeeper/db";
import {
  renameList, renameObject, openAliasRenameProjectStore,
} from "./declaration_key_rename/convention_candidates.js";

const BOOTSTRAP_KEY = "__project_identity";

type TaskV1 = { id: string; kind: "task"; status: "open" | "done" };
type TaskV2 = TaskV1 & { labels?: string[] };
type Decision = { id: string; kind: "decision"; status: "open" | "accepted" };
type Workspace = {
  id: "workspace";
  schemaVersion: 1;
  goal: string;
  checkpoint: { sequence: number; note: string };
};
type Binding = { physicalKey: string; kind: "list" | "object" };
type IdentityManifest = { id: "project-identity-manifest"; bindings: Record<string, Binding> };

type WriterResult = {
  phase: "writer";
  initialQueryCount: number;
  renameQueryCount: number;
  reopenedWithoutAlias: boolean;
  staleLogicalDeclarationRejected: boolean;
  checkpoint: number;
  compatibleOptionalField: boolean;
  pass: boolean;
};
type ReaderResult = {
  phase: "reader";
  bootstrapKey: string;
  reason: string;
  logicalNames: string[];
  bindings: Record<string, Binding>;
  checkpoint: number;
  completedTaskQueryCount: number;
  acceptedDecisionCount: number;
  compatibleOptionalField: boolean;
  discoveredRoles: string[];
  pass: boolean;
};

const initialWorkspace = (): Workspace => ({
  id: "workspace",
  schemaVersion: 1,
  goal: "Resume after a declaration rename with only a durable identity bootstrap",
  checkpoint: { sequence: 1, note: "first durable checkpoint" },
});
const initialTasks = (): TaskV1[] => [
  { id: "TASK-1", kind: "task", status: "open" },
  { id: "TASK-2", kind: "task", status: "open" },
];
const initialDecisions = (): Decision[] => [
  { id: "DECISION-1", kind: "decision", status: "open" },
];

const stateKeys = (path: string): string[] => {
  const db = new DatabaseSync(path);
  try {
    return (db.prepare("SELECT DISTINCT state_key FROM __sk_items ORDER BY state_key")
      .all() as Array<{ state_key: string }>).map((row) => row.state_key);
  } finally {
    db.close();
  }
};
const sourceRows = (path: string): Array<{ state_key: string; id: string; pos: number; value_json: string }> => {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(
      "SELECT state_key,id,pos,value_json FROM __sk_items ORDER BY state_key,pos,id",
    ).all() as Array<{ state_key: string; id: string; pos: number; value_json: string }>;
  } finally {
    db.close();
  }
};
const projectionRows = (path: string): Array<{ state_key: string; path: string; item_id: string; value_json: string }> => {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(
      "SELECT state_key,path,item_id,value_json FROM __sk_projection WHERE path='status' ORDER BY state_key,item_id",
    ).all() as Array<{ state_key: string; path: string; item_id: string; value_json: string }>;
  } finally {
    db.close();
  }
};
const sameStrings = (a: string[], b: string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function writer(path: string): WriterResult {
  const first = openAliasRenameProjectStore(path, {
    workspace: renameObject(initialWorkspace()),
    tasks: renameList(initialTasks()),
    decisions: renameList(initialDecisions()),
  });
  const initialQuery = first.find(first.state.tasks, { status: "open" });
  const initialQueryCount = initialQuery.length;
  first.close();

  const second = openAliasRenameProjectStore(path, {
    workspace: renameObject<Workspace>(initialWorkspace()),
    workItems: renameList<TaskV2>([], { from: "tasks" }),
    decisions: renameList<Decision>([]),
  });
  if (second.state.workItems.length !== 2 ||
      second.state.workspace.checkpoint.sequence !== 1) {
    throw new Error("one-shot alias did not retain V1 source data");
  }
  second.state.workItems[0]!.status = "done";
  second.state.workItems[1]!.labels = ["checkpoint"];
  second.state.decisions[0]!.status = "accepted";
  second.state.workspace.checkpoint.sequence = 2;
  second.state.workspace.checkpoint.note = "renamed project completed checkpoint 2";
  const renameQueryCount = second.find(second.state.workItems, { status: "done" }).length;
  second.close();

  let staleLogicalDeclarationRejected = false;
  try {
    const stale = openAliasRenameProjectStore(path, {
      workspace: renameObject<Workspace>(initialWorkspace()),
      tasks: renameList<TaskV2>([]),
      decisions: renameList<Decision>([]),
    });
    stale.close();
  } catch (e) {
    staleLogicalDeclarationRejected = e instanceof Error &&
      /rename|declaration|removed|ambiguous/i.test(e.message);
  }

  const reopened = openAliasRenameProjectStore(path, {
    workspace: renameObject<Workspace>(initialWorkspace()),
    workItems: renameList<TaskV2>([]),
    decisions: renameList<Decision>([]),
  });
  const checkpoint = reopened.state.workspace.checkpoint.sequence;
  const compatibleOptionalField = reopened.state.workItems[1]?.labels?.[0] === "checkpoint";
  const reopenedWithoutAlias =
    reopened.state.workItems.length === 2 &&
    reopened.state.workItems[0]?.status === "done" &&
    reopened.state.decisions[0]?.status === "accepted" &&
    checkpoint === 2;
  reopened.close();
  return {
    phase: "writer", initialQueryCount, renameQueryCount,
    reopenedWithoutAlias, staleLogicalDeclarationRejected,
    checkpoint, compatibleOptionalField,
    pass: initialQueryCount === 2 && renameQueryCount === 1 &&
      reopenedWithoutAlias && staleLogicalDeclarationRejected && compatibleOptionalField,
  };
}

function reader(path: string, bootstrapKey: string): ReaderResult {
  const sk = new StorekeeperDB(path);
  const failed = (reason: string): ReaderResult => ({
    phase: "reader", bootstrapKey, reason,
    logicalNames: [], bindings: {}, checkpoint: 0,
    completedTaskQueryCount: 0, acceptedDecisionCount: 0,
    compatibleOptionalField: false, discoveredRoles: [], pass: false,
  });
  try {
    const manifestRows = sk.state<IdentityManifest[]>(bootstrapKey, []);
    const manifest = manifestRows[0];
    if (manifestRows.length !== 1 || manifest?.id !== "project-identity-manifest") {
      return failed("missing or ambiguous identity bootstrap");
    }
    const bindings = JSON.parse(JSON.stringify(manifest.bindings)) as Record<string, Binding>;
    const logicalNames = Object.keys(bindings).sort();
    if (logicalNames.length !== 3 ||
        new Set(logicalNames).size !== logicalNames.length ||
        new Set(logicalNames.map((key) => bindings[key]!.physicalKey)).size !== logicalNames.length) {
      return failed("ambiguous or duplicate identity binding");
    }

    let checkpoint = 0;
    let completedTaskQueryCount = 0;
    let acceptedDecisionCount = 0;
    let compatibleOptionalField = false;
    const roles: string[] = [];
    for (const logicalKey of logicalNames) {
      const binding = bindings[logicalKey]!;
      if (binding.kind !== "list" && binding.kind !== "object") return failed("unsupported identity state kind");
      const items = sk.state<Dict[]>(binding.physicalKey, []);
      if (binding.kind === "object" && items.length === 1 && items[0]?.id === "workspace") {
        const workspace = items[0] as unknown as Workspace;
        checkpoint = workspace.checkpoint?.sequence ?? 0;
        if (workspace.schemaVersion !== 1 ||
            workspace.goal !== "Resume after a declaration rename with only a durable identity bootstrap" ||
            "importantStateKeys" in workspace || "stateRefs" in workspace) {
          return failed("incompatible workspace or redundant application discovery registry");
        }
        roles.push("workspace");
      } else if (binding.kind === "list" && items[0]?.kind === "task") {
        const completed = sk.find<Dict>(binding.physicalKey, { status: "done" });
        completedTaskQueryCount = completed.length;
        compatibleOptionalField = items.some((item) => item.id === "TASK-2" &&
          Array.isArray(item.labels) && item.labels.includes("checkpoint"));
        if (items.length !== 2 || completed[0]?.id !== "TASK-1") {
          return failed("task state or durable projection mismatch");
        }
        roles.push("tasks");
      } else if (binding.kind === "list" && items[0]?.kind === "decision") {
        acceptedDecisionCount = items.filter((item) => item.status === "accepted").length;
        roles.push("decisions");
      } else {
        return failed("missing or unexpected state data");
      }
    }
    const discoveredRoles = roles.sort();
    const pass = checkpoint === 2 && completedTaskQueryCount === 1 &&
      acceptedDecisionCount === 1 && compatibleOptionalField &&
      sameStrings(discoveredRoles, ["workspace", "tasks", "decisions"]) &&
      !logicalNames.includes("tasks") &&
      sameStrings(logicalNames, ["workspace", "workItems", "decisions"]) &&
      bindings.workItems?.physicalKey === "tasks" &&
      sameStrings(stateKeys(path), [bootstrapKey, ...logicalNames.filter((k) => k !== "workItems"), "tasks"]);
    return {
      phase: "reader", bootstrapKey, reason: pass ? "" : "identity-based discovery mismatch",
      logicalNames, bindings, checkpoint, completedTaskQueryCount,
      acceptedDecisionCount, compatibleOptionalField, discoveredRoles, pass,
    };
  } finally {
    sk.close();
  }
}

const phase = process.argv[2];
const dbPath = process.argv[3];
if (phase === "--writer") {
  if (!dbPath) throw new Error("writer requires database path");
  const result = writer(dbPath);
  console.log(JSON.stringify(result));
  process.exit(result.pass ? 0 : 1);
}
if (phase === "--reader") {
  const bootstrapKey = process.argv[4];
  if (!dbPath || !bootstrapKey) throw new Error("reader requires DB path and bootstrap key");
  console.log(JSON.stringify(reader(dbPath, bootstrapKey)));
  process.exit(0);
}

const scriptPath = process.argv[1];
if (!scriptPath) throw new Error("experiment could not resolve its script path");
const root = mkdtempSync(join(tmpdir(), "sk-identity-bootstrap-"));
let validExperiment = false;
try {
  const path = join(root, "workspace.sqlite");
  const child = <T>(args: string[]): T => JSON.parse(
    execFileSync(process.execPath,
      ["--experimental-sqlite", scriptPath, ...args], { encoding: "utf8" }).trim()) as T;
  const written = child<WriterResult>(["--writer", path]);
  const read = child<ReaderResult>(["--reader", path, BOOTSTRAP_KEY]);
  const beforeNegative = stateKeys(path);
  const beforeSource = sourceRows(path);
  const wrongKey = child<ReaderResult>(["--reader", path, "__nonexistent_identity"]);
  const afterNegative = stateKeys(path);
  const afterSource = sourceRows(path);
  const physicalKeys = stateKeys(path);
  const projections = projectionRows(path);

  const oneIdentityRegistry = physicalKeys.filter((key) => key.startsWith("__")).length === 1 &&
    physicalKeys.includes(BOOTSTRAP_KEY) && !physicalKeys.includes("__workspace");
  const retainedPhysicalIdentity = projections.some((row) =>
    row.state_key === "tasks" && row.path === "status" && row.value_json === JSON.stringify("done")) &&
    !projections.some((row) => row.state_key === "workItems");
  const wrongBootstrapRejected = !wrongKey.pass &&
    wrongKey.reason === "missing or ambiguous identity bootstrap" &&
    sameStrings(beforeNegative, afterNegative) &&
    JSON.stringify(beforeSource) === JSON.stringify(afterSource);

  validExperiment = written.phase === "writer" && read.phase === "reader" &&
    wrongKey.phase === "reader" && written.staleLogicalDeclarationRejected &&
    wrongBootstrapRejected;
  const semanticPreserved = written.pass && read.pass &&
    oneIdentityRegistry && retainedPhysicalIdentity;
  const decision = !validExperiment
    ? "INVALID_EXPERIMENT"
    : semanticPreserved
      ? "CANDIDATE_PASS_IDENTITY_MANIFEST_REPLACES_PARALLEL_DISCOVERY_REGISTRY"
      : "FAIL_MANIFEST_DISCOVERY_RESETS_OR_MISROUTES_STATE";

  const exactResultGate = decision ===
    "CANDIDATE_PASS_IDENTITY_MANIFEST_REPLACES_PARALLEL_DISCOVERY_REGISTRY" &&
    written.pass && read.pass && wrongBootstrapRejected &&
    oneIdentityRegistry && retainedPhysicalIdentity &&
    written.initialQueryCount === 2 && written.renameQueryCount === 1 &&
    written.reopenedWithoutAlias && written.staleLogicalDeclarationRejected &&
    read.checkpoint === 2 && read.completedTaskQueryCount === 1 &&
    read.acceptedDecisionCount === 1 && read.compatibleOptionalField &&
    sameStrings(read.logicalNames, ["workspace", "workItems", "decisions"]) &&
    read.bindings.workItems?.physicalKey === "tasks" &&
    sameStrings(physicalKeys, ["__project_identity", "workspace", "tasks", "decisions"]);

  console.log(JSON.stringify({
    experiment: "identity-manifest-cross-process-bootstrap",
    issue: 89,
    environment: { node: process.versions.node, backend: "node:sqlite", flag: "--experimental-sqlite" },
    processBoundary: "writer and reader are independent Node processes; reader is given only DB path and bootstrap key",
    writer: written,
    reader: read,
    negativeControl: wrongKey,
    physical: { keys: physicalKeys, projectionRows: projections, oneIdentityRegistry, retainedPhysicalIdentity },
    checks: { wrongBootstrapRejected, semanticPreserved, validExperiment, exactResultGate },
    decision,
    interpretation: "Current logical names are discoverable from the existing declaration identity manifest while a one-shot rename retains its original physical source and projection namespace. Checkpoint atomicity is separate.",
    uncertainty: {
      multiWriterVersionSkewUntested: true,
      semanticCheckpointRoleInferenceRemainsApplicationSpecific: true,
      corruptedManifestRecoveryUntested: true,
      atomicCheckpointMigrationUntested: true,
      browserAndRemoteStorageUntested: true,
      noPublicDiscoveryApiAuthorized: true,
    },
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (!exactResultGate) process.exit(1);

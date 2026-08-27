import { DatabaseSync } from "node:sqlite"; // @persist @decision:sqlite-lifecycle
import { initialSettings, initialTasks } from "./model.js";
import type { DecisionBurdenRuntimeResult, ProjectSettingsV2, TaskV2 } from "./model.js";

type BlobRow = { kind: "task" | "settings"; id: string; value_json: string };

export function runJsonBlobDecisionBurden(path: string): DecisionBurdenRuntimeResult {
  let db = new DatabaseSync(path); // @persist @decision:sqlite-lifecycle
  db.exec("CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(kind,id));"); // @persist @decision:blob-layout @decision:schema-bootstrap
  const insert = db.prepare("INSERT INTO records(kind,id,value_json) VALUES(?,?,?)"); // @persist @decision:write-strategy
  for (const task of initialTasks()) insert.run("task", task.id, JSON.stringify(task)); // @persist @decision:serialization @decision:write-strategy
  const settings = initialSettings();
  insert.run("settings", settings.id, JSON.stringify(settings)); // @persist @decision:serialization @decision:singleton-key @decision:write-strategy

  const task2Row = db.prepare("SELECT kind,id,value_json FROM records WHERE kind='task' AND id=?").get("TASK-2") as BlobRow | undefined; // @persist @decision:query-strategy
  if (!task2Row) throw new Error("JSON blob baseline missing TASK-2.");
  const task2 = JSON.parse(task2Row.value_json) as TaskV2; // @persist @decision:serialization
  task2.status = "done";
  db.prepare("UPDATE records SET value_json=? WHERE kind='task' AND id=?").run(JSON.stringify(task2), task2.id); // @persist @decision:serialization @decision:write-strategy
  db.close(); // @persist @decision:sqlite-lifecycle

  db = new DatabaseSync(path); // @persist @decision:sqlite-lifecycle
  const v1Rows = db.prepare("SELECT kind,id,value_json FROM records ORDER BY kind,id").all() as BlobRow[]; // @persist @decision:query-strategy
  if (v1Rows.filter((row) => row.kind === "task").length !== 2) throw new Error("JSON blob baseline failed V1 reopen.");

  const task1Row = v1Rows.find((row) => row.kind === "task" && row.id === "TASK-1");
  const settingsRow = v1Rows.find((row) => row.kind === "settings" && row.id === "settings"); // @persist @decision:singleton-key
  if (!task1Row || !settingsRow) throw new Error("JSON blob baseline missing V1 rows.");
  const task1 = JSON.parse(task1Row.value_json) as TaskV2; // @persist @decision:serialization @decision:compatible-json-evolution
  task1.labels = ["alpha"];
  const evolvedSettings = JSON.parse(settingsRow.value_json) as ProjectSettingsV2; // @persist @decision:serialization @decision:compatible-json-evolution
  evolvedSettings.preferences = { defaultView: "board" };
  db.prepare("UPDATE records SET value_json=? WHERE kind='task' AND id=?").run(JSON.stringify(task1), task1.id); // @persist @decision:serialization @decision:write-strategy
  db.prepare("UPDATE records SET value_json=? WHERE kind='settings' AND id=?").run(JSON.stringify(evolvedSettings), evolvedSettings.id); // @persist @decision:serialization @decision:singleton-key @decision:write-strategy
  db.close(); // @persist @decision:sqlite-lifecycle

  db = new DatabaseSync(path); // @persist @decision:sqlite-lifecycle
  const reopenedRows = db.prepare("SELECT kind,id,value_json FROM records ORDER BY kind,id").all() as BlobRow[]; // @persist @decision:query-strategy
  const reopenedTasks = reopenedRows
    .filter((row) => row.kind === "task")
    .map((row) => JSON.parse(row.value_json) as TaskV2); // @persist @decision:serialization @decision:query-strategy
  const urgentOpen = reopenedTasks.filter((task) => task.status === "open" && task.priority === "urgent"); // @persist @decision:query-strategy
  const reopenedSettingsRow = reopenedRows.find((row) => row.kind === "settings" && row.id === "settings"); // @persist @decision:singleton-key @decision:query-strategy
  const reopenedSettings = reopenedSettingsRow ? JSON.parse(reopenedSettingsRow.value_json) as ProjectSettingsV2 : undefined; // @persist @decision:serialization
  const reopenedTask1 = reopenedTasks.find((task) => task.id === "TASK-1");
  const evolvedShapePersisted = reopenedTask1?.labels?.[0] === "alpha" && reopenedSettings?.preferences?.defaultView === "board";
  const settingsReopened = reopenedSettings?.workspaceName === "Agent Board" && reopenedSettings.compactMode === false;
  const pass = urgentOpen.length === 1 && urgentOpen[0]?.id === "TASK-1" && reopenedTasks.length === 2 && settingsReopened && evolvedShapePersisted;
  db.close(); // @persist @decision:sqlite-lifecycle

  return { pass, urgentOpen: urgentOpen.length, reopenedTasks: reopenedTasks.length, settingsReopened, evolvedShapePersisted };
}

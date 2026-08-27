import { DatabaseSync } from "node:sqlite"; // @persist @decision:sqlite-lifecycle
import { initialSettings, initialTasks } from "./model.js";
import type { DecisionBurdenRuntimeResult, TaskV2 } from "./model.js";

type CountRow = { count: number };
type TaskRow = { id: string; title: string; status: "open" | "done"; priority: "low" | "high" | "urgent"; labels_json: string | null };
type SettingsRow = { id: string; workspace_name: string; compact_mode: number; default_view: "board" | "list" | null };

export function runRelationalDecisionBurden(path: string): DecisionBurdenRuntimeResult {
  let db = new DatabaseSync(path); // @persist @decision:sqlite-lifecycle
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL
    );
    CREATE TABLE settings (
      id TEXT PRIMARY KEY,
      workspace_name TEXT NOT NULL,
      compact_mode INTEGER NOT NULL
    );
  `); // @persist @decision:relational-layout @decision:schema-bootstrap

  const insertTask = db.prepare("INSERT INTO tasks(id,title,status,priority) VALUES(?,?,?,?)"); // @persist @decision:write-strategy
  for (const task of initialTasks()) insertTask.run(task.id, task.title, task.status, task.priority);
  const settings = initialSettings();
  db.prepare("INSERT INTO settings(id,workspace_name,compact_mode) VALUES(?,?,?)")
    .run(settings.id, settings.workspaceName, settings.compactMode ? 1 : 0); // @persist @decision:singleton-row @decision:write-strategy
  db.prepare("UPDATE tasks SET status='done' WHERE id=?").run("TASK-2"); // @persist @decision:write-strategy
  db.close(); // @persist @decision:sqlite-lifecycle

  db = new DatabaseSync(path); // @persist @decision:sqlite-lifecycle
  const beforeEvolutionCount = (db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as CountRow).count; // @persist @decision:query-strategy
  if (beforeEvolutionCount !== 2) throw new Error("Relational baseline failed V1 reopen.");

  db.exec("ALTER TABLE tasks ADD COLUMN labels_json TEXT; ALTER TABLE settings ADD COLUMN default_view TEXT;"); // @persist @decision:migration-strategy
  db.prepare("UPDATE tasks SET labels_json=? WHERE id=?").run(JSON.stringify(["alpha"]), "TASK-1"); // @persist @decision:serialization @decision:write-strategy
  db.prepare("UPDATE settings SET default_view=? WHERE id='settings'").run("board"); // @persist @decision:write-strategy
  db.close(); // @persist @decision:sqlite-lifecycle

  db = new DatabaseSync(path); // @persist @decision:sqlite-lifecycle
  const urgentRows = db.prepare("SELECT id,title,status,priority,labels_json FROM tasks WHERE status=? AND priority=? ORDER BY id")
    .all("open", "urgent") as TaskRow[]; // @persist @decision:query-strategy
  const reopenedRows = db.prepare("SELECT id,title,status,priority,labels_json FROM tasks ORDER BY id").all() as TaskRow[]; // @persist @decision:query-strategy
  const reopenedSettings = db.prepare("SELECT id,workspace_name,compact_mode,default_view FROM settings WHERE id='settings'").get() as SettingsRow | undefined; // @persist @decision:query-strategy @decision:singleton-row
  const task1 = reopenedRows.find((row) => row.id === "TASK-1");
  const task1Labels = task1?.labels_json ? JSON.parse(task1.labels_json) as TaskV2["labels"] : undefined; // @persist @decision:serialization
  const evolvedShapePersisted = task1Labels?.[0] === "alpha" && reopenedSettings?.default_view === "board";
  const settingsReopened = reopenedSettings?.workspace_name === "Agent Board" && reopenedSettings.compact_mode === 0;
  const pass =
    urgentRows.length === 1 &&
    urgentRows[0]?.id === "TASK-1" &&
    reopenedRows.length === 2 &&
    settingsReopened &&
    evolvedShapePersisted;
  db.close(); // @persist @decision:sqlite-lifecycle

  return { pass, urgentOpen: urgentRows.length, reopenedTasks: reopenedRows.length, settingsReopened, evolvedShapePersisted };
}

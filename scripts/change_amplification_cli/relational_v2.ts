import { DatabaseSync } from "node:sqlite"; // @persist @concept:sqlite-api

export type RelationalProjectMetaV2 = {
  id: string;
  cwd: string;
  active: boolean;
  recentFiles?: string[];
  lastCommand?: { name: string; args: string[] };
  preferences?: { profile: string; verbose: boolean };
};

type ProjectRow = {
  id: string;
  cwd: string;
  active: number;
  recent_files_json: string | null;
  last_command_json: string | null;
  preferences_json: string | null;
};

export function runRelationalProjectMetaV2(path: string): { pass: boolean } {
  let db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  const columns = new Set((db.prepare("PRAGMA table_info(project_meta)").all() as { name: string }[]).map((row) => row.name)); // @persist @concept:migration-inspection
  if (!columns.has("recent_files_json")) db.exec("ALTER TABLE project_meta ADD COLUMN recent_files_json TEXT"); // @persist @concept:migration-ddl
  if (!columns.has("last_command_json")) db.exec("ALTER TABLE project_meta ADD COLUMN last_command_json TEXT"); // @persist @concept:migration-ddl
  if (!columns.has("preferences_json")) db.exec("ALTER TABLE project_meta ADD COLUMN preferences_json TEXT"); // @persist @concept:migration-ddl

  const row = db.prepare("SELECT id,cwd,active,recent_files_json,last_command_json,preferences_json FROM project_meta WHERE id=?").get("project") as ProjectRow | undefined; // @persist @concept:query-sql
  if (!row) throw new Error("relational CLI baseline missing project metadata");

  const recentFiles = JSON.parse(row.recent_files_json ?? "[]") as string[]; // @persist @concept:serialization
  recentFiles.splice(0, recentFiles.length, "src/index.ts", "README.md");
  const lastCommand = { name: "build", args: ["--watch"] };
  const preferences = { profile: "dev", verbose: true };

  db.prepare("UPDATE project_meta SET active=?,recent_files_json=?,last_command_json=?,preferences_json=? WHERE id=?").run( // @persist @concept:query-sql @concept:serialization
    0,
    JSON.stringify(recentFiles),
    JSON.stringify(lastCommand),
    JSON.stringify(preferences),
    "project",
  );
  db.close(); // @persist @concept:sqlite-lifecycle

  db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  const reopened = db.prepare("SELECT id,cwd,active,recent_files_json,last_command_json,preferences_json FROM project_meta WHERE id=?").get("project") as ProjectRow | undefined; // @persist @concept:query-sql
  const reopenedFiles = JSON.parse(reopened?.recent_files_json ?? "[]") as string[]; // @persist @concept:serialization
  const reopenedCommand = JSON.parse(reopened?.last_command_json ?? "null") as { name: string; args: string[] } | null; // @persist @concept:serialization
  const reopenedPreferences = JSON.parse(reopened?.preferences_json ?? "null") as { profile: string; verbose: boolean } | null; // @persist @concept:serialization
  const pass =
    reopened?.cwd === "/tmp/prototype" &&
    reopened.active === 0 &&
    reopenedFiles.length === 2 &&
    reopenedCommand?.name === "build" &&
    reopenedPreferences?.profile === "dev";
  db.close(); // @persist @concept:sqlite-lifecycle
  return { pass };
}

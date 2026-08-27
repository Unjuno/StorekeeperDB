import { DatabaseSync } from "node:sqlite"; // @persist @concept:sqlite-api

export type JsonBlobProjectMetaV2 = {
  id: string;
  cwd: string;
  active: boolean;
  recentFiles?: string[];
  lastCommand?: { name: string; args: string[] };
  preferences?: { profile: string; verbose: boolean };
};

type BlobRow = { id: string; value_json: string };

export function runJsonBlobProjectMetaV2(path: string): { pass: boolean } {
  let db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  const row = db.prepare("SELECT id,value_json FROM project_meta WHERE id=?").get("project") as BlobRow | undefined; // @persist @concept:query-sql
  if (!row) throw new Error("JSON blob CLI baseline missing project metadata");

  const project = JSON.parse(row.value_json) as JsonBlobProjectMetaV2; // @persist @concept:serialization
  project.active = false;
  project.recentFiles = ["src/index.ts", "README.md"];
  project.lastCommand = { name: "build", args: ["--watch"] };
  project.preferences = { profile: "dev", verbose: true };

  db.prepare("UPDATE project_meta SET value_json=? WHERE id=?").run(JSON.stringify(project), project.id); // @persist @concept:query-sql @concept:serialization
  db.close(); // @persist @concept:sqlite-lifecycle

  db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  const reopenedRow = db.prepare("SELECT id,value_json FROM project_meta WHERE id=?").get("project") as BlobRow | undefined; // @persist @concept:query-sql
  const reopened = reopenedRow ? JSON.parse(reopenedRow.value_json) as JsonBlobProjectMetaV2 : undefined; // @persist @concept:serialization
  const pass =
    reopened?.cwd === "/tmp/prototype" &&
    reopened.active === false &&
    reopened.recentFiles?.length === 2 &&
    reopened.lastCommand?.name === "build" &&
    reopened.preferences?.profile === "dev";
  db.close(); // @persist @concept:sqlite-lifecycle
  return { pass };
}

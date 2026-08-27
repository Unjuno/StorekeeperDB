import { DatabaseSync } from "node:sqlite"; // @persist @concept:sqlite-api

export type JsonBlobProjectMetaV1 = {
  id: string;
  cwd: string;
  active: boolean;
};

export function runJsonBlobProjectMetaV1(path: string): void {
  const db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  db.exec("CREATE TABLE IF NOT EXISTS project_meta(id TEXT PRIMARY KEY,value_json TEXT NOT NULL)"); // @persist @concept:schema-ddl
  const count = Number((db.prepare("SELECT COUNT(*) n FROM project_meta").get() as { n: number }).n); // @persist @concept:query-sql
  if (count === 0) {
    const value: JsonBlobProjectMetaV1 = { id: "project", cwd: "/tmp/prototype", active: true };
    db.prepare("INSERT INTO project_meta(id,value_json) VALUES(?,?)").run(value.id, JSON.stringify(value)); // @persist @concept:query-sql @concept:serialization
  }
  db.close(); // @persist @concept:sqlite-lifecycle
}

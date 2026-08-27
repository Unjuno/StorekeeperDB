import { DatabaseSync } from "node:sqlite"; // @persist @concept:sqlite-api

export type RelationalProjectMetaV1 = {
  id: string;
  cwd: string;
  active: boolean;
};

export function runRelationalProjectMetaV1(path: string): void {
  const db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  db.exec("CREATE TABLE IF NOT EXISTS project_meta(id TEXT PRIMARY KEY,cwd TEXT NOT NULL,active INTEGER NOT NULL)"); // @persist @concept:schema-ddl
  const count = Number((db.prepare("SELECT COUNT(*) n FROM project_meta").get() as { n: number }).n); // @persist @concept:query-sql
  if (count === 0) {
    const insert = db.prepare("INSERT INTO project_meta(id,cwd,active) VALUES(?,?,?)"); // @persist @concept:query-sql
    insert.run("project", "/tmp/prototype", 1); // @persist @concept:query-sql
  }
  db.close(); // @persist @concept:sqlite-lifecycle
}

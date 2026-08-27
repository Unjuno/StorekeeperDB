import { DatabaseSync } from "node:sqlite"; // @persist @concept:sqlite-api

export type RelationalIssueV1 = {
  id: string;
  title: string;
  status: "open" | "closed";
};

export function runRelationalV1(path: string): void {
  const db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  db.exec("CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL)"); // @persist @concept:schema-ddl
  const count = Number((db.prepare("SELECT COUNT(*) n FROM issues").get() as { n: number }).n); // @persist @concept:query-sql
  if (count === 0) {
    const insert = db.prepare("INSERT INTO issues(id,title,status) VALUES(?,?,?)"); // @persist @concept:query-sql
    insert.run("ISSUE-1", "Persist prototype state", "open"); // @persist @concept:query-sql
    insert.run("ISSUE-2", "Document query semantics", "open"); // @persist @concept:query-sql
  }
  db.close(); // @persist @concept:sqlite-lifecycle
}

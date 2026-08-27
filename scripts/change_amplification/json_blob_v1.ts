import { DatabaseSync } from "node:sqlite"; // @persist @concept:sqlite-api

export type JsonBlobIssueV1 = {
  id: string;
  title: string;
  status: "open" | "closed";
};

export function runJsonBlobV1(path: string): void {
  const db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  db.exec("CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY,value_json TEXT NOT NULL)"); // @persist @concept:schema-ddl
  const count = Number((db.prepare("SELECT COUNT(*) n FROM issues").get() as { n: number }).n); // @persist @concept:query-sql
  if (count === 0) {
    const insert = db.prepare("INSERT INTO issues(id,value_json) VALUES(?,?)"); // @persist @concept:query-sql
    const first: JsonBlobIssueV1 = { id: "ISSUE-1", title: "Persist prototype state", status: "open" };
    const second: JsonBlobIssueV1 = { id: "ISSUE-2", title: "Document query semantics", status: "open" };
    insert.run(first.id, JSON.stringify(first)); // @persist @concept:query-sql @concept:serialization
    insert.run(second.id, JSON.stringify(second)); // @persist @concept:query-sql @concept:serialization
  }
  db.close(); // @persist @concept:sqlite-lifecycle
}

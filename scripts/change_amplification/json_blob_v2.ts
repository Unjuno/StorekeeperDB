import { DatabaseSync } from "node:sqlite"; // @persist @concept:sqlite-api

export type JsonBlobIssueV2 = {
  id: string;
  title: string;
  status: "open" | "closed";
  priority?: "low" | "high" | "urgent";
  labels?: string[];
  comments?: Array<{ author: string; body: string }>;
};

type BlobRow = { id: string; value_json: string };

export function runJsonBlobV2(path: string): { pass: boolean; reopened: number } {
  let db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  const row = db.prepare("SELECT id,value_json FROM issues WHERE id=?").get("ISSUE-1") as BlobRow | undefined; // @persist @concept:query-sql
  if (!row) throw new Error("JSON blob baseline missing ISSUE-1");

  const issue = JSON.parse(row.value_json) as JsonBlobIssueV2; // @persist @concept:serialization
  issue.priority = "urgent";
  issue.labels = issue.labels ?? [];
  if (!issue.labels.includes("alpha")) issue.labels.push("alpha");
  issue.comments = issue.comments ?? [];
  if (!issue.comments.length) issue.comments.push({ author: "agent", body: "Shape evolved." });
  issue.status = "closed";

  db.prepare("UPDATE issues SET value_json=? WHERE id=?").run(JSON.stringify(issue), issue.id); // @persist @concept:query-sql @concept:serialization
  db.close(); // @persist @concept:sqlite-lifecycle

  db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  const reopenedRows = db.prepare("SELECT id,value_json FROM issues ORDER BY id").all() as BlobRow[]; // @persist @concept:query-sql
  const reopened = reopenedRows[0] ? JSON.parse(reopenedRows[0].value_json) as JsonBlobIssueV2 : undefined; // @persist @concept:serialization
  const pass =
    reopenedRows.length === 2 &&
    reopened?.status === "closed" &&
    reopened.priority === "urgent" &&
    reopened.labels?.[0] === "alpha" &&
    reopened.comments?.[0]?.author === "agent";
  db.close(); // @persist @concept:sqlite-lifecycle
  return { pass, reopened: reopenedRows.length };
}

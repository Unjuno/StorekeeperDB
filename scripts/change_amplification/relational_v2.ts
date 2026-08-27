import { DatabaseSync } from "node:sqlite"; // @persist @concept:sqlite-api

export type RelationalIssueV2 = {
  id: string;
  title: string;
  status: "open" | "closed";
  priority?: "low" | "high" | "urgent";
  labels?: string[];
  comments?: Array<{ author: string; body: string }>;
};

type IssueRow = {
  id: string;
  title: string;
  status: "open" | "closed";
  priority: "low" | "high" | "urgent" | null;
  labels_json: string | null;
  comments_json: string | null;
};

export function runRelationalV2(path: string): { pass: boolean; reopened: number } {
  let db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  const columns = new Set((db.prepare("PRAGMA table_info(issues)").all() as { name: string }[]).map((row) => row.name)); // @persist @concept:migration-inspection
  if (!columns.has("priority")) db.exec("ALTER TABLE issues ADD COLUMN priority TEXT"); // @persist @concept:migration-ddl
  if (!columns.has("labels_json")) db.exec("ALTER TABLE issues ADD COLUMN labels_json TEXT"); // @persist @concept:migration-ddl
  if (!columns.has("comments_json")) db.exec("ALTER TABLE issues ADD COLUMN comments_json TEXT"); // @persist @concept:migration-ddl

  const row = db.prepare("SELECT id,title,status,priority,labels_json,comments_json FROM issues WHERE id=?").get("ISSUE-1") as IssueRow | undefined; // @persist @concept:query-sql
  if (!row) throw new Error("relational baseline missing ISSUE-1");

  const labels = JSON.parse(row.labels_json ?? "[]") as string[]; // @persist @concept:serialization
  const comments = JSON.parse(row.comments_json ?? "[]") as Array<{ author: string; body: string }>; // @persist @concept:serialization
  if (!labels.includes("alpha")) labels.push("alpha");
  if (!comments.length) comments.push({ author: "agent", body: "Shape evolved." });

  db.prepare("UPDATE issues SET status=?,priority=?,labels_json=?,comments_json=? WHERE id=?").run( // @persist @concept:query-sql @concept:serialization
    "closed",
    "urgent",
    JSON.stringify(labels),
    JSON.stringify(comments),
    "ISSUE-1",
  );
  db.close(); // @persist @concept:sqlite-lifecycle

  db = new DatabaseSync(path); // @persist @concept:sqlite-lifecycle
  const reopenedRows = db.prepare("SELECT id,title,status,priority,labels_json,comments_json FROM issues ORDER BY id").all() as IssueRow[]; // @persist @concept:query-sql
  const reopened = reopenedRows[0];
  const reopenedLabels = JSON.parse(reopened?.labels_json ?? "[]") as string[]; // @persist @concept:serialization
  const reopenedComments = JSON.parse(reopened?.comments_json ?? "[]") as Array<{ author: string; body: string }>; // @persist @concept:serialization
  const pass =
    reopenedRows.length === 2 &&
    reopened?.status === "closed" &&
    reopened.priority === "urgent" &&
    reopenedLabels[0] === "alpha" &&
    reopenedComments[0]?.author === "agent";
  db.close(); // @persist @concept:sqlite-lifecycle
  return { pass, reopened: reopenedRows.length };
}

import { StorekeeperDB } from "../../src/index.js"; // @persist @concept:storekeeper-api

export type StorekeeperIssueV2 = {
  id: string;
  title: string;
  status: "open" | "closed";
  priority?: "low" | "high" | "urgent";
  labels?: string[];
  comments?: Array<{ author: string; body: string }>;
};

export function runStorekeeperV2(path: string): { pass: boolean; reopened: number } {
  let sk = new StorekeeperDB(path); // @persist @concept:storekeeper-lifecycle
  const issues = sk.state<StorekeeperIssueV2[]>("issues", []); // @persist @concept:durable-state
  const issue = sk.find<StorekeeperIssueV2>("issues", { id: "ISSUE-1" })[0]; // @persist @concept:durable-query
  if (!issue) throw new Error("Storekeeper baseline missing ISSUE-1");

  issue.priority = "urgent";
  issue.labels = issue.labels ?? [];
  if (!issue.labels.includes("alpha")) issue.labels.push("alpha");
  issue.comments = issue.comments ?? [];
  if (!issue.comments.length) issue.comments.push({ author: "agent", body: "Shape evolved." });
  issue.status = "closed";
  sk.close(); // @persist @concept:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @concept:storekeeper-lifecycle
  const reopened = sk.state<StorekeeperIssueV2[]>("issues", []); // @persist @concept:durable-state
  const first = reopened[0];
  const pass =
    reopened.length === 2 &&
    first?.status === "closed" &&
    first.priority === "urgent" &&
    first.labels?.[0] === "alpha" &&
    first.comments?.[0]?.author === "agent";
  sk.close(); // @persist @concept:storekeeper-lifecycle
  return { pass, reopened: reopened.length };
}

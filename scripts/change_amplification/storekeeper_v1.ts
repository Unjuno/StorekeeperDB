import { StorekeeperDB } from "../../src/index.js"; // @persist @concept:storekeeper-api

export type StorekeeperIssueV1 = {
  id: string;
  title: string;
  status: "open" | "closed";
};

export function runStorekeeperV1(path: string): void {
  const sk = new StorekeeperDB(path); // @persist @concept:storekeeper-lifecycle
  const issues = sk.state<StorekeeperIssueV1[]>("issues", []); // @persist @concept:durable-state
  if (issues.length === 0) {
    issues.push({ id: "ISSUE-1", title: "Persist prototype state", status: "open" });
    issues.push({ id: "ISSUE-2", title: "Document query semantics", status: "open" });
  }
  sk.close(); // @persist @concept:storekeeper-lifecycle
}

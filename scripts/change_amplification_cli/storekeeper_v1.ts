import { StorekeeperDB } from "../../src/index.js"; // @persist @concept:storekeeper-api

export type StorekeeperProjectMetaV1 = {
  id: string;
  cwd: string;
  active: boolean;
};

export function runStorekeeperProjectMetaV1(path: string): void {
  const sk = new StorekeeperDB(path); // @persist @concept:storekeeper-lifecycle
  const records = sk.state<StorekeeperProjectMetaV1[]>("project-meta", []); // @persist @concept:durable-state @concept:singleton-list-boundary
  if (records.length === 0) records.push({ id: "project", cwd: "/tmp/prototype", active: true });
  sk.close(); // @persist @concept:storekeeper-lifecycle
}

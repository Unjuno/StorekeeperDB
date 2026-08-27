import { StorekeeperDB } from "../../src/index.js"; // @persist @concept:storekeeper-api

export type StorekeeperProjectMetaV2 = {
  id: string;
  cwd: string;
  active: boolean;
  recentFiles?: string[];
  lastCommand?: { name: string; args: string[] };
  preferences?: { profile: string; verbose: boolean };
};

export function runStorekeeperProjectMetaV2(path: string): { pass: boolean } {
  let sk = new StorekeeperDB(path); // @persist @concept:storekeeper-lifecycle
  const records = sk.state<StorekeeperProjectMetaV2[]>("project-meta", []); // @persist @concept:durable-state @concept:singleton-list-boundary
  const project = sk.find<StorekeeperProjectMetaV2>("project-meta", { id: "project" })[0]; // @persist @concept:durable-query
  if (!project) throw new Error("Storekeeper CLI baseline missing project metadata");

  project.active = false;
  project.recentFiles = ["src/index.ts", "README.md"];
  project.lastCommand = { name: "build", args: ["--watch"] };
  project.preferences = { profile: "dev", verbose: true };
  sk.close(); // @persist @concept:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @concept:storekeeper-lifecycle
  const reopenedRecords = sk.state<StorekeeperProjectMetaV2[]>("project-meta", []); // @persist @concept:durable-state @concept:singleton-list-boundary
  const reopened = reopenedRecords[0];
  const pass =
    reopenedRecords.length === 1 &&
    reopened?.cwd === "/tmp/prototype" &&
    reopened.active === false &&
    reopened.recentFiles?.length === 2 &&
    reopened.lastCommand?.name === "build" &&
    reopened.preferences?.profile === "dev";
  sk.close(); // @persist @concept:storekeeper-lifecycle
  return { pass };
}

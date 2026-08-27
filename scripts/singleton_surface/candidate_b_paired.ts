import { StorekeeperDB } from "../../src/index.js";
import { objectSignal, objectState } from "./candidates.js";
import { initialProject } from "./model.js";
import type { CandidateRuntimeResult } from "./model.js";

export function runCandidateB(path: string): CandidateRuntimeResult {
  let notifications = 0;
  let snapshotVersionAdvanced = false;
  let staleOldHandleRejected = false;

  let sk = new StorekeeperDB(path);
  const project = objectState(sk, "project", initialProject()); // @surface @concept:object-state
  const projectSignal = objectSignal(sk, "project", initialProject()); // @surface @concept:object-signal
  const beforeVersion = projectSignal.getSnapshot().version; // @surface @reactive
  const unsubscribe = projectSignal.subscribe(() => { notifications++; }); // @surface @reactive

  project.recentFiles.push("notes.md");
  project.preferences.verbose = true;

  try {
    sk.batch(() => { // @surface @lifecycle
      project.cwd = "/temporary";
      throw new Error("rollback probe");
    });
  } catch {
    // Expected rollback.
  }

  try {
    project.cwd = "/stale";
  } catch {
    staleOldHandleRejected = true;
  }

  const fresh = objectState(sk, "project", initialProject()); // @surface @concept:object-state
  fresh.active = false;
  snapshotVersionAdvanced = projectSignal.getSnapshot().version > beforeVersion; // @surface @reactive
  unsubscribe();
  sk.close(); // @surface @lifecycle

  sk = new StorekeeperDB(path);
  const reopened = objectState(sk, "project", initialProject()); // @surface @concept:object-state
  const pass =
    reopened.id === "project-1" &&
    reopened.cwd === "/workspace" &&
    reopened.active === false &&
    reopened.recentFiles.includes("notes.md") &&
    reopened.preferences.verbose === true;
  sk.close(); // @surface @lifecycle

  return { pass, notifications, snapshotVersionAdvanced, staleOldHandleRejected };
}

import { StorekeeperDB } from "../../src/index.js";
import { initialProject } from "./model.js";
import type { CandidateRuntimeResult } from "./model.js";

export function runCandidateA(path: string): CandidateRuntimeResult {
  let notifications = 0;
  let snapshotVersionAdvanced = false;
  let staleOldHandleRejected = false;

  let sk = new StorekeeperDB(path);
  const projects = sk.state("project", [initialProject()]); // @surface @concept:list-state @collection
  const projectSignal = sk.signal("project", [initialProject()]); // @surface @concept:list-signal @collection
  const project = projects[0]!; // @surface @index
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

  const fresh = projects[0]!; // @surface @index
  fresh.active = false;
  snapshotVersionAdvanced = projectSignal.getSnapshot().version > beforeVersion; // @surface @reactive
  unsubscribe();
  sk.close(); // @surface @lifecycle

  sk = new StorekeeperDB(path);
  const reopened = sk.state("project", [initialProject()])[0]!; // @surface @concept:list-state @collection @index
  const pass =
    reopened.id === "project-1" &&
    reopened.cwd === "/workspace" &&
    reopened.active === false &&
    reopened.recentFiles.includes("notes.md") &&
    reopened.preferences.verbose === true;
  sk.close(); // @surface @lifecycle

  return { pass, notifications, snapshotVersionAdvanced, staleOldHandleRejected };
}

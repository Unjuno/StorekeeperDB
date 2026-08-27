import { StorekeeperDB } from "../../src/index.js";
import { objectHandle } from "./candidates.js";
import { initialProject } from "./model.js";
import type { CandidateRuntimeResult } from "./model.js";

export function runCandidateC(path: string): CandidateRuntimeResult {
  let notifications = 0;
  let snapshotVersionAdvanced = false;
  let staleOldHandleRejected = false;

  let sk = new StorekeeperDB(path);
  const project = objectHandle(sk, "project", initialProject()); // @surface @concept:object-handle @value
  const beforeVersion = project.getSnapshot().version; // @surface @reactive
  const unsubscribe = project.subscribe(() => { notifications++; }); // @surface @reactive
  const oldValue = project.value; // @surface @value

  oldValue.recentFiles.push("notes.md");
  oldValue.preferences.verbose = true;

  try {
    sk.batch(() => { // @surface @lifecycle
      oldValue.cwd = "/temporary";
      throw new Error("rollback probe");
    });
  } catch {
    // Expected rollback.
  }

  try {
    oldValue.cwd = "/stale";
  } catch {
    staleOldHandleRejected = true;
  }

  const fresh = project.value; // @surface @value
  fresh.active = false;
  snapshotVersionAdvanced = project.getSnapshot().version > beforeVersion; // @surface @reactive
  unsubscribe();
  sk.close(); // @surface @lifecycle

  sk = new StorekeeperDB(path);
  const reopened = objectHandle(sk, "project", initialProject()).value; // @surface @concept:object-handle @value
  const pass =
    reopened.id === "project-1" &&
    reopened.cwd === "/workspace" &&
    reopened.active === false &&
    reopened.recentFiles.includes("notes.md") &&
    reopened.preferences.verbose === true;
  sk.close(); // @surface @lifecycle

  return { pass, notifications, snapshotVersionAdvanced, staleOldHandleRejected };
}

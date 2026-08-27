import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB } from "../src/index.js";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
};

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "sk-live-snapshot-"));
  return { path: join(dir, "app.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("liveFind owns stable snapshots for content changes inside an existing match", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "A", done: false, priority: "urgent" });

    const urgent = sk.liveFind<Task>("tasks", { priority: "urgent" });
    let notifications = 0;
    const stop = urgent.subscribe(() => { notifications++; });
    const before = urgent.getSnapshot();

    tasks[0]!.title = "B";

    const after = urgent.getSnapshot();
    assert.equal(notifications, 1);
    assert.equal(before.version, 0);
    assert.equal(after.version, 1);
    assert.notEqual(after, before);
    assert.equal(before.value[0]!.title, "A");
    assert.equal(after.value[0]!.title, "B");

    stop();
    sk.close();
  } finally {
    t.cleanup();
  }
});

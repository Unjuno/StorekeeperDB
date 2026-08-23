import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB, type StorekeeperDebugAPI } from "../src/index.js";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
  note?: string;
};

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "sk-metadata-"));
  return { path: join(dir, "app.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function debugOf(sk: StorekeeperDB): StorekeeperDebugAPI {
  return sk.debug() as unknown as StorekeeperDebugAPI;
}

test("metadata compaction trims magic log without removing source state or projections", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    for (let i = 0; i < 20; i++) {
      tasks.push({ title: `Task ${i}`, done: false, priority: i % 2 === 0 ? "urgent" : "low" });
    }

    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 10);
    const debug = debugOf(sk);

    for (let i = 0; i < 8; i++) {
      debug.evict("tasks", ["priority"]);
      debug.rebuild("tasks", ["priority"]);
    }

    assert.ok(debug.recentMagic(100).length > 5);
    const projectionCellsBefore = sk.status().projectionCells;

    const compacted = debug.compactMetadata({
      maxMagicLogEntries: 5,
      pathCountDecayFactor: 1,
      dropPathStatsBelow: -1,
    });

    assert.ok(compacted.magicLogsDeleted > 0);
    assert.equal(compacted.pathsDecayed, 0);
    assert.equal(compacted.pathsDeleted, 0);
    assert.equal(debug.recentMagic(100).length, 5);
    assert.equal(sk.status().items, 20);
    assert.equal(sk.status().projectionCells, projectionCellsBefore);
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 10);
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("metadata compaction drops only non-projection observation rows", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "A", done: false, priority: "urgent", note: "keep source" });
    tasks.push({ title: "B", done: false, priority: "low", note: "also source" });

    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 1);
    assert.equal(sk.explain("tasks", "priority").storage, "projection");

    // Observe paths that are not projected.
    assert.equal(tasks[0]!.title, "A");
    assert.equal(tasks[1]!.note, "also source");
    assert.equal(sk.explain("tasks", "title").observed, true);
    assert.equal(sk.explain("tasks", "note").observed, true);

    const projectionCellsBefore = sk.status().projectionCells;
    const compacted = debugOf(sk).compactMetadata({
      stateKey: "tasks",
      maxMagicLogEntries: Number.POSITIVE_INFINITY,
      pathCountDecayFactor: 0,
      dropPathStatsBelow: 0,
    });

    assert.ok(compacted.pathsDecayed >= 3);
    assert.ok(compacted.pathsDeleted >= 2);
    assert.equal(sk.explain("tasks", "priority").observed, true);
    assert.equal(sk.explain("tasks", "priority").storage, "projection");
    assert.equal(sk.explain("tasks", "title").observed, false);
    assert.equal(sk.explain("tasks", "note").observed, false);
    assert.equal(sk.status().items, 2);
    assert.equal(sk.status().projectionCells, projectionCellsBefore);
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 1);
    sk.close();
  } finally {
    t.cleanup();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB, type JsonScalar, type StorekeeperDebugAPI } from "../src/index.js";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
  status?: "open" | "closed";
  lane?: "backlog" | "doing" | "done";
  owner?: "a" | "b";
};

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "sk-lifecycle-"));
  return { path: join(dir, "app.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function debugOf(sk: StorekeeperDB): StorekeeperDebugAPI {
  return sk.debug() as unknown as StorekeeperDebugAPI;
}

test("derived projection can be marked cold, garbage-collected, and rebuilt from source", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    for (let i = 0; i < 30; i++) {
      tasks.push({ title: `Task ${i}`, done: false, priority: i % 3 === 0 ? "urgent" : "low" });
    }

    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 10);
    assert.equal(sk.explain("tasks", "priority").storage, "projection");

    const debug = debugOf(sk);
    debug.markCold("tasks", ["priority"]);
    assert.equal(debug.derivations("tasks").find((row) => row.path === "priority")?.state, "cold");

    const gc = debug.collectGarbage({ stateKey: "tasks" });
    assert.deepEqual(gc, { cold: 0, evicted: 1 });
    assert.equal(sk.explain("tasks", "priority").storage, "json_only");
    assert.equal(sk.status().items, 30);

    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 10);
    assert.equal(sk.explain("tasks", "priority").storage, "projection");

    const actions = debug.recentMagic(20).map((row) => row.action);
    assert.ok(actions.includes("project_mark_cold"));
    assert.ok(actions.includes("project_gc_evict"));
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("derived lifecycle garbage collection can enforce a projection budget", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    for (let i = 0; i < 60; i++) {
      tasks.push({
        title: `Task ${i}`,
        done: false,
        priority: i % 5 === 0 ? "urgent" : "low",
        status: i % 2 === 0 ? "open" : "closed",
        lane: i % 3 === 0 ? "backlog" : "doing",
        owner: i % 2 === 0 ? "a" : "b",
      });
    }

    const lookupValues: Record<string, JsonScalar> = {
      priority: "urgent",
      status: "open",
      lane: "backlog",
      owner: "a",
    };

    for (const [path, value] of Object.entries(lookupValues)) {
      assert.ok(sk.find("tasks", { [path]: value }).length > 0);
    }

    const debug = debugOf(sk);
    const before = debug.derivations("tasks").map((row) => row.path);
    assert.equal(before.length, 4);

    const gc = debug.collectGarbage({ stateKey: "tasks", maxDerivations: 2 });
    assert.equal(gc.evicted, 2);
    assert.equal(debug.derivations("tasks").length, 2);
    assert.equal(sk.status().items, 60);

    const after = new Set(debug.derivations("tasks").map((row) => row.path));
    const evictedPath = before.find((path) => !after.has(path));
    assert.ok(evictedPath);
    assert.equal(sk.explain("tasks", evictedPath).storage, "json_only");
    assert.ok(sk.find("tasks", { [evictedPath]: lookupValues[evictedPath]! }).length > 0);
    assert.equal(sk.explain("tasks", evictedPath).storage, "projection");

    const actions = debug.recentMagic(20).map((row) => row.action);
    assert.ok(actions.includes("project_gc_evict"));
    sk.close();
  } finally {
    t.cleanup();
  }
});

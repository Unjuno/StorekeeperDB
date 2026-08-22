import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB, liveFind } from "../src/index.js";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
  meta?: { score: number; labels?: string[] };
};

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "sk-"));
  return { path: join(dir, "app.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("ordinary mutation persists across reopen", () => {
  const t = tempDb();
  try {
    let sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "Write proposal", done: false });
    tasks[0]!.priority = "urgent";
    sk.close();

    sk = new StorekeeperDB(t.path);
    const reopened = sk.state<Task[]>("tasks", []);
    assert.equal(reopened.length, 1);
    assert.equal(reopened[0]!.priority, "urgent");
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("find magically creates a projection but keeps source state", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    sk.batch(() => {
      for (let i = 0; i < 100; i++) tasks.push({ title: `Task ${i}`, done: false, priority: i % 10 === 0 ? "urgent" : "low" });
    });
    assert.equal(sk.explain("tasks", "priority").storage, "json_only");
    const urgent = sk.find<Task>("tasks", { priority: "urgent" });
    assert.equal(urgent.length, 10);
    assert.equal(sk.explain("tasks", "priority").storage, "projection");
    assert.equal(sk.status().items, 100);
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("debug can evict and rebuild derived projection", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "Fix login", done: false, priority: "urgent" });
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 1);
    sk.debug().evict("tasks", ["priority"]);
    assert.equal(sk.explain("tasks", "priority").storage, "json_only");
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 1);
    assert.equal(sk.explain("tasks", "priority").storage, "projection");
    const actions = sk.debug().recentMagic().map((row) => row.action);
    assert.ok(actions.includes("project_evict"));
    assert.ok(actions.includes("project_create") || actions.includes("project_rebuild"));
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("liveFind updates after ordinary mutation", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    const urgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
    let renders = 0;
    const stop = urgent.subscribe(() => { renders++; });
    tasks.push({ title: "A", done: false, priority: "urgent" });
    assert.equal(urgent.getSnapshot().value.length, 1);
    assert.equal(renders, 1);
    stop();
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("shape-breaking array operations fail loudly", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    assert.throws(() => { tasks[2] = { title: "bad", done: false }; }, /Sparse/);
    assert.throws(() => { delete tasks[0]; }, /delete/);
    assert.throws(() => { tasks.length = 2; }, /Growing/);
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("common array mutators persist order and projection consistency", () => {
  const t = tempDb();
  try {
    let sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "C", done: false, priority: "low" });
    tasks.unshift({ title: "A", done: false, priority: "urgent" });
    tasks.splice(1, 0, { title: "B", done: false, priority: "high" });
    assert.deepEqual(tasks.map((task) => task.title), ["A", "B", "C"]);
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 1);
    tasks.reverse();
    assert.deepEqual(tasks.map((task) => task.title), ["C", "B", "A"]);
    const removed = tasks.pop();
    assert.equal(removed!.priority, "urgent");
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 0);
    sk.close();

    sk = new StorekeeperDB(t.path);
    const reopened = sk.state<Task[]>("tasks", []);
    assert.deepEqual(reopened.map((task) => task.title), ["C", "B"]);
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("nested object and array mutations persist across reopen", () => {
  const t = tempDb();
  try {
    let sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "Nested", done: false, meta: { score: 1, labels: [] } });
    tasks[0]!.meta!.score = 7;
    tasks[0]!.meta!.labels!.push("prototype");
    sk.close();

    sk = new StorekeeperDB(t.path);
    const reopened = sk.state<Task[]>("tasks", []);
    assert.equal(reopened[0]!.meta!.score, 7);
    assert.deepEqual(reopened[0]!.meta!.labels, ["prototype"]);
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("projection cells are removed when a scalar path disappears", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "A", done: false, priority: "urgent" });
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 1);
    delete tasks[0]!.priority;
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 0);
    assert.equal(sk.status().projectionCells, 0);
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("failed batch restores loaded state and invalidates stale item proxies", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "A", done: false, priority: "low", meta: { score: 1, labels: [] } });
    const staleItem = tasks[0]!;
    const staleMeta = tasks[0]!.meta!;
    assert.throws(() => {
      sk.batch(() => {
        tasks[0]!.priority = "urgent";
        tasks[0]!.meta!.score = 99;
        throw new Error("abort");
      });
    }, /abort/);

    assert.equal(tasks[0]!.priority, "low");
    assert.equal(tasks[0]!.meta!.score, 1);
    assert.throws(() => { staleItem.priority = "urgent"; }, /Stale Storekeeper proxy/);
    assert.throws(() => { staleMeta.score = 2; }, /Stale Storekeeper proxy/);
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("batch notifications fire once after outer commit", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const signal = sk.signal<Task[]>("tasks", []);
    const tasks = signal.value;
    let renders = 0;
    const stop = signal.subscribe(() => { renders++; });
    sk.batch(() => {
      tasks.push({ title: "A", done: false });
      tasks.push({ title: "B", done: false });
      tasks[0]!.done = true;
    });
    assert.equal(renders, 1);
    stop();
    sk.close();
  } finally {
    t.cleanup();
  }
});

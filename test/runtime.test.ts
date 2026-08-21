import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB, liveFind, type Dict } from "../src/index.js";

type Task = { title: string; done: boolean; priority?: "low" | "high" | "urgent"; tags?: string[]; meta?: { score: number } };

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

test("common array mutators stay durable", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "B", done: false }, { title: "C", done: false });
    tasks.unshift({ title: "A", done: false });
    assert.deepEqual(tasks.map((task) => task.title), ["A", "B", "C"]);
    assert.equal(tasks.pop()!.title, "C");
    tasks.splice(1, 0, { title: "D", done: false });
    tasks.reverse();
    assert.deepEqual(tasks.map((task) => task.title), ["B", "D", "A"]);
    sk.close();

    const reopened = new StorekeeperDB(t.path);
    const rows = reopened.state<Task[]>("tasks", []);
    assert.deepEqual(rows.map((task) => task.title), ["B", "D", "A"]);
    reopened.close();
  } finally {
    t.cleanup();
  }
});

test("nested mutations persist and update projected paths", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "A", done: false, tags: [], meta: { score: 1 } });
    tasks[0]!.tags!.push("prototype");
    tasks[0]!.meta!.score = 9;
    assert.equal(sk.find<Dict>("tasks", { "meta.score": 9 }).length, 1);
    sk.close();

    const reopened = new StorekeeperDB(t.path);
    const rows = reopened.state<Task[]>("tasks", []);
    assert.deepEqual(rows[0]!.tags, ["prototype"]);
    assert.equal(rows[0]!.meta!.score, 9);
    reopened.close();
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

test("projection cells are removed when scalar value disappears", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "Fix login", done: false, priority: "urgent" });
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 1);
    delete tasks[0]!.priority;
    assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 0);
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
    assert.ok(sk.debug().recentMagic().length >= 2);
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
    const stop = urgent.subscribe(() => {
      renders++;
    });
    tasks.push({ title: "A", done: false, priority: "urgent" });
    assert.equal(urgent.getSnapshot().value.length, 1);
    assert.equal(renders, 1);
    stop();
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("failed batch rolls back database and loaded memory", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "A", done: false, priority: "low" });
    assert.throws(() => {
      sk.batch(() => {
        tasks[0]!.priority = "urgent";
        throw new Error("rollback");
      });
    }, /rollback/);
    assert.equal(tasks[0]!.priority, "low");
    sk.close();

    const reopened = new StorekeeperDB(t.path);
    assert.equal(reopened.state<Task[]>("tasks", [])[0]!.priority, "low");
    reopened.close();
  } finally {
    t.cleanup();
  }
});

test("shape-breaking array operations fail loudly", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    assert.throws(() => {
      tasks.length = 2;
    }, /Growing/);
    assert.throws(() => {
      delete (tasks as Task[])[0];
    }, /delete/);
    assert.throws(() => {
      (tasks as unknown as { fill(): void }).fill();
    }, /not supported/);
    sk.close();
  } finally {
    t.cleanup();
  }
});

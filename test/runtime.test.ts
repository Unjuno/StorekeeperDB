import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB, liveFind } from "../src/index.js";

type Task = { title: string; done: boolean; priority?: "low" | "high" | "urgent"; meta?: { score: number } };
function tempDb() { const dir = mkdtempSync(join(tmpdir(), "sk-")); return { path: join(dir, "app.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) }; }

test("ordinary mutation persists across reopen", () => {
  const t = tempDb();
  try {
    let sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "Write proposal", done: false });
    tasks[0].priority = "urgent";
    sk.close();
    sk = new StorekeeperDB(t.path);
    const reopened = sk.state<Task[]>("tasks", []);
    assert.equal(reopened.length, 1);
    assert.equal(reopened[0].priority, "urgent");
    sk.close();
  } finally { t.cleanup(); }
});

test("find magically creates a projection but keeps source state", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    sk.batch(() => { for (let i = 0; i < 100; i++) tasks.push({ title: `Task ${i}`, done: false, priority: i % 10 === 0 ? "urgent" : "low" }); });
    assert.equal(sk.explain("tasks", "priority").storage, "json_only");
    const urgent = sk.find<Task>("tasks", { priority: "urgent" });
    assert.equal(urgent.length, 10);
    assert.equal(sk.explain("tasks", "priority").storage, "projection");
    assert.equal(sk.status().items, 100);
    sk.close();
  } finally { t.cleanup(); }
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
  } finally { t.cleanup(); }
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
  } finally { t.cleanup(); }
});

test("shape-breaking array operations fail loudly", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    assert.throws(() => { (tasks as Task[])[2] = { title: "bad", done: false }; }, /Sparse/);
    assert.throws(() => { delete (tasks as Task[])[0]; }, /delete/);
    sk.close();
  } finally { t.cleanup(); }
});

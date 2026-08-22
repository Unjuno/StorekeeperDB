import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncMemoryStorage, ExperimentalAsyncWriteBehindRuntime } from "../src/experimental.js";

type Task = { title: string; done: boolean; priority?: "low" | "high" | "urgent" };

test("async write-behind state is memory-visible before flush but not durable", async () => {
  const storage = new AsyncMemoryStorage();
  const sk = new ExperimentalAsyncWriteBehindRuntime(storage);
  const tasks = await sk.state<Task[]>("tasks", []);

  tasks.push({ title: "Draft browser boundary", done: false, priority: "urgent" });

  assert.equal(tasks.length, 1);
  assert.equal(sk.find<Task>("tasks", { priority: "urgent" }).length, 1);
  assert.deepEqual(storage.readCommitted<Task>("tasks"), undefined);
  assert.deepEqual(sk.status(), {
    durability: "dirty",
    pendingWrites: 1,
    flushCount: 0,
    lastError: null,
  });

  await sk.flush();

  assert.deepEqual(sk.status(), {
    durability: "clean",
    pendingWrites: 0,
    flushCount: 1,
    lastError: null,
  });
  assert.equal(storage.readCommitted<Task>("tasks")?.length, 1);
});

test("async write-behind flush is the durability barrier across reopen", async () => {
  const storage = new AsyncMemoryStorage();
  const sk = new ExperimentalAsyncWriteBehindRuntime(storage);
  const tasks = await sk.state<Task[]>("tasks", []);

  tasks.push({ title: "Not durable yet", done: false, priority: "urgent" });

  const beforeFlush = new ExperimentalAsyncWriteBehindRuntime(storage);
  const beforeFlushTasks = await beforeFlush.state<Task[]>("tasks", []);
  assert.equal(beforeFlushTasks.length, 0);

  await sk.flush();

  const afterFlush = new ExperimentalAsyncWriteBehindRuntime(storage);
  const afterFlushTasks = await afterFlush.state<Task[]>("tasks", []);
  assert.equal(afterFlushTasks.length, 1);
  assert.equal(afterFlushTasks[0]!.title, "Not durable yet");
});

test("async write-behind failed flush keeps memory and pending writes", async () => {
  const storage = new AsyncMemoryStorage();
  const sk = new ExperimentalAsyncWriteBehindRuntime(storage);
  const tasks = await sk.state<Task[]>("tasks", []);

  tasks.push({ title: "Retry me", done: false, priority: "high" });
  storage.failNextSave("simulated browser storage failure");

  await assert.rejects(() => sk.flush(), /simulated browser storage failure/);

  assert.equal(tasks.length, 1);
  assert.equal(sk.find<Task>("tasks", { priority: "high" }).length, 1);
  assert.deepEqual(storage.readCommitted<Task>("tasks"), undefined);
  assert.deepEqual(sk.status(), {
    durability: "failed",
    pendingWrites: 1,
    flushCount: 0,
    lastError: "simulated browser storage failure",
  });

  await sk.flush();

  assert.deepEqual(sk.status(), {
    durability: "clean",
    pendingWrites: 0,
    flushCount: 1,
    lastError: null,
  });
  assert.equal(storage.readCommitted<Task>("tasks")?.length, 1);
});

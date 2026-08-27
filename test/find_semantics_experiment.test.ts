import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB, live } from "../src/index.js";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
  meta?: { note: string; labels?: string[] };
};

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "sk-find-semantics-"));
  return { path: join(dir, "app.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const cloneTask = (task: Task): Task => JSON.parse(JSON.stringify(task)) as Task;

test("find returns a local result array containing durable item handles", () => {
  const t = tempDb();
  try {
    let sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "A", done: false, priority: "urgent" });

    const handles = sk.find<Task>("tasks", { priority: "urgent" });
    assert.equal(handles.length, 1);
    assert.equal(handles[0], tasks[0]);

    handles[0]!.title = "durable-handle";
    handles.push({ title: "local-array-only", done: false, priority: "urgent" });

    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.title, "durable-handle");

    const allHandles = sk.find<Task>("tasks", {});
    assert.equal(allHandles[0], tasks[0]);
    allHandles.pop();
    assert.equal(tasks.length, 1);

    sk.close();

    sk = new StorekeeperDB(t.path);
    const reopened = sk.state<Task[]>("tasks", []);
    assert.equal(reopened.length, 1);
    assert.equal(reopened[0]!.title, "durable-handle");
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("experiment: naive live durable handles alias previous snapshots", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const signal = sk.signal<Task[]>("tasks", []);
    const tasks = signal.value;
    tasks.push({ title: "A", done: false, priority: "urgent" });

    const aliasLive = live(signal, (list) => list.filter((task) => task.priority === "urgent"));
    let aliasRenders = 0;
    const stopAlias = aliasLive.subscribe(() => { aliasRenders++; });
    const aliasBefore = aliasLive.getSnapshot();

    tasks[0]!.title = "B";

    assert.equal(aliasRenders, 0);
    assert.equal(aliasBefore.value[0]!.title, "B");
    stopAlias();

    const snapshotLive = live(signal, (list) =>
      list.filter((task) => task.priority === "urgent").map(cloneTask),
    );
    let snapshotRenders = 0;
    const stopSnapshot = snapshotLive.subscribe(() => { snapshotRenders++; });
    const snapshotBefore = snapshotLive.getSnapshot();

    tasks[0]!.title = "C";

    assert.equal(snapshotRenders, 1);
    assert.equal(snapshotBefore.value[0]!.title, "B");
    assert.equal(snapshotLive.getSnapshot().value[0]!.title, "C");
    stopSnapshot();
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("durable handle identity survives reorder and rollback invalidates it", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "A", done: false, priority: "urgent" });
    tasks.push({ title: "B", done: false, priority: "low" });

    const handle = sk.find<Task>("tasks", { title: "A" })[0]!;
    tasks.reverse();
    assert.equal(tasks[1], handle);

    assert.throws(() => {
      sk.batch(() => {
        handle.title = "aborted";
        throw new Error("abort");
      });
    }, /abort/);

    assert.throws(() => { handle.title = "stale"; }, /Stale Storekeeper proxy/);
    assert.equal(tasks.find((task) => task.priority === "urgent")!.title, "A");
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("removed durable handles become read-only stale references and cannot resurrect rows", () => {
  const t = tempDb();
  try {
    let sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "A", done: false, priority: "urgent", meta: { note: "a", labels: [] } });
    tasks.push({ title: "B", done: false, priority: "high", meta: { note: "b", labels: [] } });
    tasks.push({ title: "C", done: false, priority: "low", meta: { note: "c", labels: [] } });

    const shiftedHandle = tasks[0]!;
    const shiftedMeta = shiftedHandle.meta!;
    const splicedHandle = tasks[1]!;
    const poppedHandle = tasks[2]!;

    const popped = tasks.pop()!;
    assert.equal(popped, poppedHandle);
    assert.equal(popped.title, "C");
    assert.throws(() => { poppedHandle.title = "resurrected-pop"; }, /after removal/);

    const shifted = tasks.shift()!;
    assert.equal(shifted, shiftedHandle);
    assert.equal(shifted.title, "A");
    assert.throws(() => { shiftedHandle.title = "resurrected-shift"; }, /after removal/);
    assert.throws(() => { shiftedMeta.note = "resurrected-nested"; }, /after removal/);

    const [spliced] = tasks.splice(0, 1);
    assert.equal(spliced, splicedHandle);
    assert.equal(spliced!.title, "B");
    assert.throws(() => { splicedHandle.title = "resurrected-splice"; }, /after removal/);

    assert.equal(tasks.length, 0);
    sk.close();

    sk = new StorekeeperDB(t.path);
    const reopened = sk.state<Task[]>("tasks", []);
    assert.equal(reopened.length, 0);
    sk.close();
  } finally {
    t.cleanup();
  }
});

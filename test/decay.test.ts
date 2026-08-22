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
  const dir = mkdtempSync(join(tmpdir(), "sk-decay-"));
  return { path: join(dir, "app.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function debugOf(sk: StorekeeperDB): StorekeeperDebugAPI {
  return sk.debug() as unknown as StorekeeperDebugAPI;
}

function seed(tasks: Task[], n = 80): void {
  for (let i = 0; i < n; i++) {
    tasks.push({
      title: `Task ${i}`,
      done: false,
      priority: i % 5 === 0 ? "urgent" : "low",
      status: i % 2 === 0 ? "open" : "closed",
      lane: i % 3 === 0 ? "backlog" : "doing",
      owner: i % 2 === 0 ? "a" : "b",
    });
  }
}

test("automatic derived decay enforces projection budget while preserving source rows", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path, {
      decay: {
        enabled: true,
        collectEveryFinds: 4,
        maxDerivations: 2,
      },
    });
    const tasks = sk.state<Task[]>("tasks", []);
    seed(tasks);

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
    const derivations = debug.derivations("tasks");
    assert.equal(derivations.length, 2);
    assert.equal(sk.status().items, 80);

    const currentLookup = sk.explain("tasks", "owner");
    assert.equal(currentLookup.storage, "projection");

    const evicted = Object.keys(lookupValues).filter((path) => !derivations.some((row) => row.path === path));
    assert.ok(evicted.length >= 1);

    const rebuildPath = evicted[0]!;
    assert.equal(sk.explain("tasks", rebuildPath).storage, "json_only");
    assert.ok(sk.find("tasks", { [rebuildPath]: lookupValues[rebuildPath]! }).length > 0);
    assert.equal(sk.explain("tasks", rebuildPath).storage, "projection");

    const actions = debug.recentMagic(30).map((row) => row.action);
    assert.ok(actions.includes("project_gc_evict"));
    sk.close();
  } finally {
    t.cleanup();
  }
});

test("automatic derived decay can mark surviving projections cold", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path, {
      decay: {
        enabled: true,
        collectEveryFinds: 2,
        markCold: true,
        maxDerivations: 10,
      },
    });
    const tasks = sk.state<Task[]>("tasks", []);
    seed(tasks, 30);

    assert.ok(sk.find<Task>("tasks", { priority: "urgent" }).length > 0);
    assert.ok(sk.find<Task>("tasks", { status: "open" }).length > 0);

    const debug = debugOf(sk);
    const states = debug.derivations("tasks").map((row) => row.state);
    assert.ok(states.length >= 2);
    assert.ok(states.every((state) => state === "cold"));
    assert.equal(sk.status().items, 30);

    const actions = debug.recentMagic(30).map((row) => row.action);
    assert.ok(actions.includes("project_mark_cold"));
    sk.close();
  } finally {
    t.cleanup();
  }
});

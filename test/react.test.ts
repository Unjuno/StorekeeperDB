import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createElement, useSyncExternalStore } from "react";
import { act, create, type ReactTestRenderer, type TestRendererJSON } from "react-test-renderer";
import { StorekeeperDB, liveFind, type Dict, type Signal, type Snapshot } from "../src/index.js";
import { externalStore } from "../src/react.js";

type Task = { title: string; done: boolean; priority?: "low" | "high" | "urgent" };

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "sk-react-"));
  return { path: join(dir, "app.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function textOf(renderer: ReactTestRenderer): string {
  const tree = renderer.toJSON() as TestRendererJSON;
  const first = tree.children?.[0];
  return typeof first === "string" ? first : "";
}

test("React useSyncExternalStore renders and updates a liveFind signal", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", []);
    tasks.push({ title: "Fix login", done: false, priority: "urgent" });
    tasks.push({ title: "Write docs", done: false, priority: "low" });

    const urgent = liveFind<Dict>(sk, "tasks", { priority: "urgent" }) as Signal<Dict[]>;
    const store = externalStore(urgent);
    const snapshots: Array<Snapshot<Dict[]>> = [];

    function UrgentCount() {
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
      snapshots.push(snapshot);
      return createElement("output", null, `urgent:${snapshot.value.length}:v${snapshot.version}`);
    }

    let renderer: ReactTestRenderer | null = null;
    act(() => {
      renderer = create(createElement(UrgentCount));
    });

    assert.equal(textOf(renderer!), "urgent:1:v0");

    act(() => {
      tasks.push({ title: "Ship prototype", done: false, priority: "urgent" });
    });

    assert.equal(textOf(renderer!), "urgent:2:v1");

    const renderCountBeforeUnrelated = snapshots.length;
    act(() => {
      tasks.push({ title: "Refactor copy", done: false, priority: "low" });
    });

    assert.equal(textOf(renderer!), "urgent:2:v1");
    assert.equal(snapshots.length, renderCountBeforeUnrelated);

    const renderCountBeforeUnmount = snapshots.length;
    act(() => {
      renderer!.unmount();
    });
    act(() => {
      tasks.push({ title: "No UI subscriber", done: false, priority: "urgent" });
    });

    assert.equal(snapshots.length, renderCountBeforeUnmount);
    sk.close();
  } finally {
    t.cleanup();
  }
});

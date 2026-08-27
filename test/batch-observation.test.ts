import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB } from "../src/index.js";

type Task = {
  title: string;
  done: boolean;
};

const tempDb = () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-batch-observation-"));
  return { path: join(dir, "app.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

test("batch rollback snapshots do not count as application observations", () => {
  const t = tempDb();
  try {
    const sk = new StorekeeperDB(t.path);
    const tasks = sk.state<Task[]>("tasks", [{ title: "A", done: false }]);

    const baseline = sk.explain("tasks", "title").readCount;

    sk.batch(() => {});
    assert.equal(sk.explain("tasks", "title").readCount, baseline);

    assert.throws(() => sk.batch(() => {
      throw new Error("expected rollback");
    }), /expected rollback/);
    assert.equal(sk.explain("tasks", "title").readCount, baseline);

    sk.batch(() => {
      void tasks[0]!.title;
    });
    const afterCommittedRead = sk.explain("tasks", "title").readCount;
    assert.equal(afterCommittedRead, baseline + 1);

    assert.throws(() => sk.batch(() => {
      void tasks[0]!.title;
      throw new Error("rollback observed read");
    }), /rollback observed read/);
    assert.equal(sk.explain("tasks", "title").readCount, afterCommittedRead);

    sk.close();
  } finally {
    t.cleanup();
  }
});

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { StorekeeperDB } from "../src/index.js";

type Task = { title: string; done: boolean; priority?: "low" | "high" | "urgent" };

const dir = mkdtempSync(join(tmpdir(), "sk-gate-"));
const path = join(dir, "app.sqlite");
const n = 3_000;

try {
  const sk = new StorekeeperDB(path);
  const tasks = sk.state<Task[]>("tasks", []);
  const t0 = performance.now();
  sk.batch(() => {
    for (let i = 0; i < n; i++) {
      tasks.push({ title: `Task ${i}`, done: false, priority: i % 100 === 0 ? "urgent" : "low" });
    }
  });
  const insertMs = performance.now() - t0;

  const t1 = performance.now();
  const urgent = sk.find<Task>("tasks", { priority: "urgent" });
  const findMs = performance.now() - t1;
  const status = sk.status();
  sk.close();

  const reopened = new StorekeeperDB(path);
  const reopenLength = reopened.state<Task[]>("tasks", []).length;
  reopened.close();

  const pass = reopenLength === n && urgent.length === Math.ceil(n / 100) && status.projectionCells === n;
  console.log(JSON.stringify({ n, insertMs: Number(insertMs.toFixed(3)), findMs: Number(findMs.toFixed(3)), urgent: urgent.length, reopenLength, projectionCells: status.projectionCells, pass }, null, 2));
  if (!pass) process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

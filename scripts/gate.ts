import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB } from "../src/index.js";

type Task = { title: string; done: boolean; priority?: "low" | "urgent"; meta?: { labels: string[] } };

const dir = mkdtempSync(join(tmpdir(), "sk-gate-"));
const dbPath = join(dir, "app.sqlite");
const start = process.hrtime.bigint();
const sk = new StorekeeperDB(dbPath);
const tasks = sk.state<Task[]>("tasks", []);

sk.batch(() => {
  for (let i = 0; i < 500; i++) {
    tasks.push({ title: `Task ${i}`, done: false, priority: i % 100 === 0 ? "urgent" : "low", meta: { labels: [] } });
  }
  tasks[0]!.meta!.labels.push("gate");
});

const urgent = sk.find<Task>("tasks", { priority: "urgent" });
const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
const pass = tasks.length === 500 && urgent.length === 5 && tasks[0]!.meta!.labels.length === 1;
console.log(JSON.stringify({ n: tasks.length, urgent: urgent.length, storage: sk.explain("tasks", "priority").storage, elapsedMs, pass }, null, 2));
sk.close();
rmSync(dir, { recursive: true, force: true });
if (!pass) process.exit(1);

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB, liveFind } from "../src/index.js";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
  tags?: string[];
  meta?: { score: number };
};

const logStep = (step: string, data: Record<string, unknown>): void => {
  console.log(JSON.stringify({ step, ...data }, null, 2));
};

const dir = mkdtempSync(join(tmpdir(), "sk-demo-"));
const path = join(dir, "demo.sqlite");

try {
  const sk = new StorekeeperDB(path);
  const taskSignal = sk.signal<Task[]>("tasks", []);
  const tasks = taskSignal.value;

  sk.batch(() => {
    for (let i = 0; i < 250; i++) {
      tasks.push({
        title: `Task ${i}`,
        done: false,
        priority: i % 25 === 0 ? "urgent" : "low",
        tags: [],
        meta: { score: i },
      });
    }
  });

  logStep("1_source_state_created", {
    itemCount: sk.status().items,
    priorityStorage: sk.explain("tasks", "priority").storage,
  });

  const urgentBefore = sk.find<Task>("tasks", { priority: "urgent" });

  logStep("2_find_created_projection", {
    urgentCount: urgentBefore.length,
    priorityStorage: sk.explain("tasks", "priority").storage,
    projectionCells: sk.status().projectionCells,
  });

  const liveUrgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
  let liveRenders = 0;
  const stop = liveUrgent.subscribe(() => {
    liveRenders++;
  });
  const liveBefore = liveUrgent.getSnapshot().value.length;

  tasks.push({
    title: "Live urgent task",
    done: false,
    priority: "urgent",
    tags: ["demo"],
    meta: { score: 999 },
  });

  const liveAfter = liveUrgent.getSnapshot().value.length;
  stop();

  logStep("3_live_lookup_updated", {
    liveBefore,
    liveAfter,
    liveRenders,
  });

  sk.debug().evict("tasks", ["priority"]);

  logStep("4_debug_evict_removed_projection", {
    priorityStorage: sk.explain("tasks", "priority").storage,
    sourceItemsStillThere: sk.status().items,
  });

  const urgentAfterEvict = sk.find<Task>("tasks", { priority: "urgent" });

  logStep("5_find_rebuilt_projection", {
    urgentCount: urgentAfterEvict.length,
    priorityStorage: sk.explain("tasks", "priority").storage,
    sourceItemsStillThere: sk.status().items,
  });

  const reopenedCount = sk.state<Task[]>("tasks", []).length;
  const recentMagic = sk.debug().recentMagic(8).map((row) => row.action);

  const pass =
    reopenedCount === 251 &&
    urgentBefore.length === 10 &&
    liveBefore === 10 &&
    liveAfter === 11 &&
    liveRenders === 1 &&
    urgentAfterEvict.length === 11 &&
    sk.explain("tasks", "priority").storage === "projection" &&
    sk.status().items === 251 &&
    recentMagic.includes("project_evict");

  logStep("6_summary", {
    productRule: "Magic by default. Explainable on demand. Source state is never silently deleted.",
    recentMagic,
    pass,
  });

  sk.close();
  if (!pass) process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

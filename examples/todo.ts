import { StorekeeperDB, liveFind } from "../src/index.js";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
  tags?: string[];
};

const sk = new StorekeeperDB("todo.sqlite");
const taskSignal = sk.signal<Task[]>("tasks", []);
const tasks = taskSignal.value;

tasks.push({ title: "Write README", done: false, priority: "urgent", tags: [] });
tasks[0]!.tags!.push("public-alpha");

const urgent = sk.find<Task>("tasks", { priority: "urgent" });
const liveUrgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });

console.log({
  urgent: urgent.map((task) => task.title),
  liveUrgentVersion: liveUrgent.getSnapshot().version,
  debug: sk.explain("tasks", "priority"),
});

sk.close();

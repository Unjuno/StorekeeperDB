import { StorekeeperDB } from "@storekeeper/db"; // @persist @decision:storekeeper-runtime
import { initialSettings, initialTasks } from "./model.js";
import type { DecisionBurdenRuntimeResult, ProjectSettingsV2, TaskV2 } from "./model.js";

export function runStorekeeperDecisionBurden(path: string): DecisionBurdenRuntimeResult {
  let sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  const tasks = sk.state("tasks", initialTasks()); // @persist @decision:durable-state @decision:state-keying
  const settings = sk.state("project-settings", [initialSettings()]); // @persist @decision:durable-state @decision:state-keying @decision:singleton-list-adaptation
  tasks[1]!.status = "done";
  if (settings.length !== 1) throw new Error("Storekeeper settings singleton shape changed.");
  sk.close(); // @persist @decision:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  const evolvedTasks = sk.state<TaskV2[]>("tasks", []); // @persist @decision:durable-state @decision:state-keying @decision:compatible-state-evolution
  const evolvedSettings = sk.state<ProjectSettingsV2[]>("project-settings", []); // @persist @decision:durable-state @decision:state-keying @decision:singleton-list-adaptation @decision:compatible-state-evolution
  if (evolvedTasks.length !== 2 || evolvedSettings.length !== 1) throw new Error("Storekeeper failed V1 reopen.");
  evolvedTasks[0]!.labels = ["alpha"];
  evolvedSettings[0]!.preferences = { defaultView: "board" };
  sk.close(); // @persist @decision:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  const reopenedTasks = sk.state<TaskV2[]>("tasks", []); // @persist @decision:durable-state @decision:state-keying
  const reopenedSettings = sk.state<ProjectSettingsV2[]>("project-settings", []); // @persist @decision:durable-state @decision:state-keying @decision:singleton-list-adaptation
  const urgentOpen = sk.find<TaskV2>("tasks", { status: "open", priority: "urgent" }); // @persist @decision:durable-query
  const task1 = reopenedTasks.find((task) => task.id === "TASK-1");
  const project = reopenedSettings[0];
  const evolvedShapePersisted = task1?.labels?.[0] === "alpha" && project?.preferences?.defaultView === "board";
  const settingsReopened = project?.workspaceName === "Agent Board" && project.compactMode === false;
  const pass = urgentOpen.length === 1 && urgentOpen[0]?.id === "TASK-1" && reopenedTasks.length === 2 && settingsReopened && evolvedShapePersisted;
  sk.close(); // @persist @decision:storekeeper-lifecycle

  return { pass, urgentOpen: urgentOpen.length, reopenedTasks: reopenedTasks.length, settingsReopened, evolvedShapePersisted };
}

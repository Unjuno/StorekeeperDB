import { initialSettings, initialTasks } from "../agent_decision_burden/model.js";
import type { DecisionBurdenRuntimeResult, ProjectSettingsV2, TaskV2 } from "../agent_decision_burden/model.js";
import { list, object, openProjectStore } from "./convention.js"; // @persist @decision:project-runtime

export function runBoardConvention(path: string): DecisionBurdenRuntimeResult {
  const projectV1 = openProjectStore(path, { // @persist @decision:durable-declaration
    tasks: list(initialTasks()),
    settings: object(initialSettings()),
  });
  projectV1.state.tasks[1]!.status = "done";
  projectV1.close(); // @persist @decision:project-lifecycle

  const projectV2 = openProjectStore(path, { // @persist @decision:durable-declaration @decision:compatible-state-evolution
    tasks: list<TaskV2>([]),
    settings: object<ProjectSettingsV2>(initialSettings()),
  });
  if (projectV2.state.tasks.length !== 2) throw new Error("Project convention failed board V1 reopen.");
  projectV2.state.tasks[0]!.labels = ["alpha"];
  projectV2.state.settings.preferences = { defaultView: "board" };
  projectV2.close(); // @persist @decision:project-lifecycle

  const reopened = openProjectStore(path, { // @persist @decision:durable-declaration
    tasks: list<TaskV2>([]),
    settings: object<ProjectSettingsV2>(initialSettings()),
  });
  const urgentOpen = reopened.find(reopened.state.tasks, { status: "open", priority: "urgent" }); // @persist @decision:durable-query
  const task1 = reopened.state.tasks.find((task) => task.id === "TASK-1");
  const evolvedShapePersisted = task1?.labels?.[0] === "alpha" && reopened.state.settings.preferences?.defaultView === "board";
  const settingsReopened = reopened.state.settings.workspaceName === "Agent Board" && reopened.state.settings.compactMode === false;
  const pass = urgentOpen.length === 1 && urgentOpen[0]?.id === "TASK-1" && reopened.state.tasks.length === 2 && settingsReopened && evolvedShapePersisted;
  const result = { pass, urgentOpen: urgentOpen.length, reopenedTasks: reopened.state.tasks.length, settingsReopened, evolvedShapePersisted };
  reopened.close(); // @persist @decision:project-lifecycle
  return result;
}

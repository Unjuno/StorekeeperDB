import { initialSettings, initialTasks } from "../agent_decision_burden/model.js";
import type { DecisionBurdenRuntimeResult, ProjectSettingsV2, TaskV2 } from "../agent_decision_burden/model.js";
import { list, object, openProjectStore } from "./convention.js"; // @persist @decision:project-runtime

export function runBoardConvention(path: string): DecisionBurdenRuntimeResult {
  let project = openProjectStore(path, { // @persist @decision:durable-declaration
    tasks: list(initialTasks()),
    settings: object(initialSettings()),
  });
  project.state.tasks[1]!.status = "done";
  project.close(); // @persist @decision:project-lifecycle

  project = openProjectStore(path, { // @persist @decision:durable-declaration @decision:compatible-state-evolution
    tasks: list<TaskV2>([]),
    settings: object<ProjectSettingsV2>(initialSettings()),
  });
  if (project.state.tasks.length !== 2) throw new Error("Project convention failed board V1 reopen.");
  project.state.tasks[0]!.labels = ["alpha"];
  project.state.settings.preferences = { defaultView: "board" };
  project.close(); // @persist @decision:project-lifecycle

  project = openProjectStore(path, { // @persist @decision:durable-declaration
    tasks: list<TaskV2>([]),
    settings: object<ProjectSettingsV2>(initialSettings()),
  });
  const urgentOpen = project.find(project.state.tasks, { status: "open", priority: "urgent" }); // @persist @decision:durable-query
  const task1 = project.state.tasks.find((task) => task.id === "TASK-1");
  const evolvedShapePersisted = task1?.labels?.[0] === "alpha" && project.state.settings.preferences?.defaultView === "board";
  const settingsReopened = project.state.settings.workspaceName === "Agent Board" && project.state.settings.compactMode === false;
  const pass = urgentOpen.length === 1 && urgentOpen[0]?.id === "TASK-1" && project.state.tasks.length === 2 && settingsReopened && evolvedShapePersisted;
  const result = { pass, urgentOpen: urgentOpen.length, reopenedTasks: project.state.tasks.length, settingsReopened, evolvedShapePersisted };
  project.close(); // @persist @decision:project-lifecycle
  return result;
}

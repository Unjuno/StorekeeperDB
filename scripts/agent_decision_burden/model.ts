export type TaskV1 = {
  id: string;
  title: string;
  status: "open" | "done";
  priority: "low" | "high" | "urgent";
};

export type TaskV2 = TaskV1 & {
  labels?: string[];
};

export type ProjectSettingsV1 = {
  id: "settings";
  workspaceName: string;
  compactMode: boolean;
};

export type ProjectSettingsV2 = ProjectSettingsV1 & {
  preferences?: {
    defaultView: "board" | "list";
  };
};

export type DecisionBurdenRuntimeResult = {
  pass: boolean;
  urgentOpen: number;
  reopenedTasks: number;
  settingsReopened: boolean;
  evolvedShapePersisted: boolean;
};

export const initialTasks = (): TaskV1[] => [
  { id: "TASK-1", title: "Ship prototype", status: "open", priority: "urgent" },
  { id: "TASK-2", title: "Write notes", status: "open", priority: "low" },
];

export const initialSettings = (): ProjectSettingsV1 => ({
  id: "settings",
  workspaceName: "Agent Board",
  compactMode: false,
});

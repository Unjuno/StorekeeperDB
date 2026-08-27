export type ProjectMeta = {
  id: string;
  cwd: string;
  active: boolean;
  recentFiles: string[];
  preferences: { profile: string; verbose: boolean };
};

export const initialProject = (): ProjectMeta => ({
  id: "project-1",
  cwd: "/workspace",
  active: true,
  recentFiles: [],
  preferences: { profile: "default", verbose: false },
});

export type CandidateRuntimeResult = {
  pass: boolean;
  notifications: number;
  snapshotVersionAdvanced: boolean;
  staleOldHandleRejected: boolean;
};

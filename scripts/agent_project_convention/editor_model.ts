export type RevisionV1 = {
  id: string;
  kind: "manual" | "autosave";
  summary: string;
};

export type RevisionV2 = RevisionV1 & {
  tags?: string[];
};

export type DocumentMetaV1 = {
  id: "document";
  title: string;
  cursor: { line: number; column: number };
};

export type DocumentMetaV2 = DocumentMetaV1 & {
  preferences?: { wrap: boolean };
};

export type EditorRuntimeResult = {
  pass: boolean;
  autosaves: number;
  reopenedRevisions: number;
  documentReopened: boolean;
  evolvedShapePersisted: boolean;
};

export const initialRevisions = (): RevisionV1[] => [
  { id: "REV-1", kind: "manual", summary: "Initial draft" },
  { id: "REV-2", kind: "autosave", summary: "Autosaved draft" },
];

export const initialDocument = (): DocumentMetaV1 => ({
  id: "document",
  title: "Prototype notes",
  cursor: { line: 1, column: 1 },
});

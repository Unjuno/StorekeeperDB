import { list, object, openProjectStore } from "./convention.js"; // @persist @decision:project-runtime
import { initialDocument, initialRevisions } from "./editor_model.js";
import type { DocumentMetaV2, EditorRuntimeResult, RevisionV2 } from "./editor_model.js";

export function runEditorConvention(path: string): EditorRuntimeResult {
  const projectV1 = openProjectStore(path, { // @persist @decision:durable-declaration
    revisions: list(initialRevisions()),
    document: object(initialDocument()),
  });
  projectV1.state.revisions[0]!.summary = "Edited draft";
  projectV1.state.document.cursor = { line: 4, column: 2 };
  projectV1.close(); // @persist @decision:project-lifecycle

  const projectV2 = openProjectStore(path, { // @persist @decision:durable-declaration @decision:compatible-state-evolution
    revisions: list<RevisionV2>([]),
    document: object<DocumentMetaV2>(initialDocument()),
  });
  if (projectV2.state.revisions.length !== 2) throw new Error("Project convention editor failed V1 reopen.");
  projectV2.state.revisions[1]!.tags = ["checkpoint"];
  projectV2.state.document.preferences = { wrap: true };
  projectV2.close(); // @persist @decision:project-lifecycle

  const reopened = openProjectStore(path, { // @persist @decision:durable-declaration
    revisions: list<RevisionV2>([]),
    document: object<DocumentMetaV2>(initialDocument()),
  });
  const autosaves = reopened.find(reopened.state.revisions, { kind: "autosave" }); // @persist @decision:durable-query
  const rev2 = reopened.state.revisions.find((revision) => revision.id === "REV-2");
  const evolvedShapePersisted = rev2?.tags?.[0] === "checkpoint" && reopened.state.document.preferences?.wrap === true;
  const documentReopened = reopened.state.document.title === "Prototype notes" && reopened.state.document.cursor.line === 4 && reopened.state.document.cursor.column === 2;
  const pass = autosaves.length === 1 && autosaves[0]?.id === "REV-2" && reopened.state.revisions.length === 2 && documentReopened && evolvedShapePersisted;
  const result = { pass, autosaves: autosaves.length, reopenedRevisions: reopened.state.revisions.length, documentReopened, evolvedShapePersisted };
  reopened.close(); // @persist @decision:project-lifecycle
  return result;
}

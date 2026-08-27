import { list, object, openProjectStore } from "./convention.js"; // @persist @decision:project-runtime
import { initialDocument, initialRevisions } from "./editor_model.js";
import type { DocumentMetaV2, EditorRuntimeResult, RevisionV2 } from "./editor_model.js";

export function runEditorConvention(path: string): EditorRuntimeResult {
  let project = openProjectStore(path, { // @persist @decision:durable-declaration
    revisions: list(initialRevisions()),
    document: object(initialDocument()),
  });
  project.state.revisions[0]!.summary = "Edited draft";
  project.state.document.cursor = { line: 4, column: 2 };
  project.close(); // @persist @decision:project-lifecycle

  project = openProjectStore(path, { // @persist @decision:durable-declaration @decision:compatible-state-evolution
    revisions: list<RevisionV2>([]),
    document: object<DocumentMetaV2>(initialDocument()),
  });
  if (project.state.revisions.length !== 2) throw new Error("Project convention editor failed V1 reopen.");
  project.state.revisions[1]!.tags = ["checkpoint"];
  project.state.document.preferences = { wrap: true };
  project.close(); // @persist @decision:project-lifecycle

  project = openProjectStore(path, { // @persist @decision:durable-declaration
    revisions: list<RevisionV2>([]),
    document: object<DocumentMetaV2>(initialDocument()),
  });
  const autosaves = project.find(project.state.revisions, { kind: "autosave" }); // @persist @decision:durable-query
  const rev2 = project.state.revisions.find((revision) => revision.id === "REV-2");
  const evolvedShapePersisted = rev2?.tags?.[0] === "checkpoint" && project.state.document.preferences?.wrap === true;
  const documentReopened = project.state.document.title === "Prototype notes" && project.state.document.cursor.line === 4 && project.state.document.cursor.column === 2;
  const pass = autosaves.length === 1 && autosaves[0]?.id === "REV-2" && project.state.revisions.length === 2 && documentReopened && evolvedShapePersisted;
  const result = { pass, autosaves: autosaves.length, reopenedRevisions: project.state.revisions.length, documentReopened, evolvedShapePersisted };
  project.close(); // @persist @decision:project-lifecycle
  return result;
}

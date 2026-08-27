import { StorekeeperDB } from "@storekeeper/db"; // @persist @decision:storekeeper-runtime
import { initialDocument, initialRevisions } from "./editor_model.js";
import type { DocumentMetaV2, EditorRuntimeResult, RevisionV2 } from "./editor_model.js";

export function runEditorCurrent(path: string): EditorRuntimeResult {
  let sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  const revisions = sk.state("revisions", initialRevisions()); // @persist @decision:durable-state @decision:state-keying
  const document = sk.state("document", [initialDocument()]); // @persist @decision:durable-state @decision:state-keying @decision:singleton-list-adaptation
  revisions[0]!.summary = "Edited draft";
  document[0]!.cursor = { line: 4, column: 2 };
  sk.close(); // @persist @decision:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  const evolvedRevisions = sk.state<RevisionV2[]>("revisions", []); // @persist @decision:durable-state @decision:state-keying @decision:compatible-state-evolution
  const evolvedDocument = sk.state<DocumentMetaV2[]>("document", []); // @persist @decision:durable-state @decision:state-keying @decision:singleton-list-adaptation @decision:compatible-state-evolution
  if (evolvedRevisions.length !== 2 || evolvedDocument.length !== 1) throw new Error("Current Storekeeper editor failed V1 reopen.");
  evolvedRevisions[1]!.tags = ["checkpoint"];
  evolvedDocument[0]!.preferences = { wrap: true };
  sk.close(); // @persist @decision:storekeeper-lifecycle

  sk = new StorekeeperDB(path); // @persist @decision:storekeeper-lifecycle
  const reopenedRevisions = sk.state<RevisionV2[]>("revisions", []); // @persist @decision:durable-state @decision:state-keying
  const reopenedDocument = sk.state<DocumentMetaV2[]>("document", []); // @persist @decision:durable-state @decision:state-keying @decision:singleton-list-adaptation
  const autosaves = sk.find<RevisionV2>("revisions", { kind: "autosave" }); // @persist @decision:durable-query
  const rev2 = reopenedRevisions.find((revision) => revision.id === "REV-2");
  const doc = reopenedDocument[0];
  const evolvedShapePersisted = rev2?.tags?.[0] === "checkpoint" && doc?.preferences?.wrap === true;
  const documentReopened = doc?.title === "Prototype notes" && doc.cursor.line === 4 && doc.cursor.column === 2;
  const pass = autosaves.length === 1 && autosaves[0]?.id === "REV-2" && reopenedRevisions.length === 2 && documentReopened && evolvedShapePersisted;
  sk.close(); // @persist @decision:storekeeper-lifecycle

  return { pass, autosaves: autosaves.length, reopenedRevisions: reopenedRevisions.length, documentReopened, evolvedShapePersisted };
}

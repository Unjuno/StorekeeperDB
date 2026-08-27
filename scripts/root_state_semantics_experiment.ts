import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB } from "../src/index.js";
import { rootCell, rootCellSignal, singletonObjectSignal, singletonObjectState } from "./root_state_candidates.js";

type ProjectMeta = {
  id: string;
  cwd: string;
  active: boolean;
  recentFiles: string[];
  preferences: { profile: string; verbose: boolean };
};

const initialProject = (): ProjectMeta => ({
  id: "project-1",
  cwd: "/workspace",
  active: true,
  recentFiles: [],
  preferences: { profile: "default", verbose: false },
});

const replacementProject = (): ProjectMeta => ({
  id: "project-1",
  cwd: "/replacement",
  active: false,
  recentFiles: ["README.md"],
  preferences: { profile: "replacement", verbose: true },
});

const root = mkdtempSync(join(tmpdir(), "sk-root-state-semantics-"));
let validExperiment = false;

try {
  const aPath = join(root, "candidate-a.sqlite");
  let aOldHandleWriteAccepted = false;
  let aMemoryDurableDivergence = false;
  let aNestedMutationPersisted = false;

  {
    const sk = new StorekeeperDB(aPath);
    const list = sk.state<ProjectMeta[]>("project", [initialProject()]);
    const oldHandle = list[0]!;
    oldHandle.recentFiles.push("before-replacement.md");
    list[0] = replacementProject();
    const replacementHandle = list[0]!;
    replacementHandle.recentFiles.push("after-replacement.md");
    const memoryBeforeOldWrite = list[0]!.cwd;
    try {
      oldHandle.cwd = "/stale-overwrite";
      aOldHandleWriteAccepted = true;
    } catch {
      aOldHandleWriteAccepted = false;
    }
    const memoryAfterOldWrite = list[0]!.cwd;
    sk.close();

    const reopened = new StorekeeperDB(aPath);
    const reopenedList = reopened.state<ProjectMeta[]>("project", [initialProject()]);
    const persisted = reopenedList[0]!;
    aNestedMutationPersisted =
      persisted.cwd === "/replacement" &&
      persisted.recentFiles.includes("README.md") &&
      persisted.recentFiles.includes("after-replacement.md") &&
      !persisted.recentFiles.includes("before-replacement.md");
    aMemoryDurableDivergence =
      aOldHandleWriteAccepted &&
      memoryBeforeOldWrite === "/replacement" &&
      memoryAfterOldWrite === "/replacement" &&
      persisted.cwd !== memoryAfterOldWrite;
    reopened.close();
  }

  const bPath = join(root, "candidate-b.sqlite");
  let bNestedMutationPersisted = false;
  let bRollbackOldHandleRejected = false;
  let bSignalNotifications = 0;
  let bSnapshotVersionAdvanced = false;

  {
    const sk = new StorekeeperDB(bPath);
    const project = singletonObjectState(sk, "project", initialProject());
    const signal = singletonObjectSignal(sk, "project", initialProject());
    const beforeVersion = signal.getSnapshot().version;
    const unsubscribe = signal.subscribe(() => {
      bSignalNotifications++;
    });

    project.recentFiles.push("notes.md");
    project.preferences.verbose = true;

    try {
      sk.batch(() => {
        project.cwd = "/temporary";
        throw new Error("rollback probe");
      });
    } catch {
      // Expected rollback.
    }

    try {
      project.cwd = "/should-be-rejected";
    } catch {
      bRollbackOldHandleRejected = true;
    }

    const fresh = singletonObjectState(sk, "project", initialProject());
    fresh.active = false;
    const afterVersion = signal.getSnapshot().version;
    bSnapshotVersionAdvanced = afterVersion > beforeVersion;
    unsubscribe();
    sk.close();

    const reopened = new StorekeeperDB(bPath);
    const reopenedProject = singletonObjectState(reopened, "project", initialProject());
    bNestedMutationPersisted =
      reopenedProject.recentFiles.includes("notes.md") &&
      reopenedProject.preferences.verbose === true &&
      reopenedProject.active === false &&
      reopenedProject.cwd === "/workspace";
    reopened.close();
  }

  const cPath = join(root, "candidate-c.sqlite");
  let cScalarPersisted = false;
  let cObjectNestedMutationPersisted = false;
  let cOldNestedWriteAcceptedAfterReplacement = false;
  let cOldNestedWriteAffectedCurrentRoot = false;
  let cSignalNotifications = 0;
  let cSnapshotVersionAdvanced = false;

  {
    const sk = new StorekeeperDB(cPath);
    const counter = rootCell(sk, "counter", 0);
    const counterSignal = rootCellSignal(sk, "counter", 0);
    const beforeVersion = counterSignal.getSnapshot().version;
    const unsubscribe = counterSignal.subscribe(() => {
      cSignalNotifications++;
    });
    counter.value += 1;
    cSnapshotVersionAdvanced = counterSignal.getSnapshot().version > beforeVersion;
    unsubscribe();

    const projectCell = rootCell(sk, "project", initialProject());
    projectCell.value.recentFiles.push("notes.md");
    const oldRootValue = projectCell.value;
    projectCell.value = replacementProject();
    try {
      oldRootValue.cwd = "/stale-write";
      cOldNestedWriteAcceptedAfterReplacement = true;
    } catch {
      cOldNestedWriteAcceptedAfterReplacement = false;
    }
    cOldNestedWriteAffectedCurrentRoot = projectCell.value.cwd === "/stale-write";
    sk.close();

    const reopened = new StorekeeperDB(cPath);
    const reopenedCounter = rootCell(reopened, "counter", 0);
    const reopenedProject = rootCell(reopened, "project", initialProject());
    cScalarPersisted = reopenedCounter.value === 1;
    cObjectNestedMutationPersisted =
      reopenedProject.value.cwd === "/replacement" &&
      reopenedProject.value.recentFiles.includes("README.md");
    reopened.close();
  }

  const rawPrimitiveReferenceMutationPossible = false;
  const candidateA = {
    nestedMutationPersists: aNestedMutationPersisted,
    singletonListCeremony: true,
    wholeRootReplacementAvailable: true,
    oldHandleWriteAcceptedAfterReplacement: aOldHandleWriteAccepted,
    memoryDurableDivergenceAfterOldHandleWrite: aMemoryDurableDivergence,
    scalarRootSupported: false,
  };

  const candidateB = {
    nestedMutationPersists: bNestedMutationPersisted,
    singletonListHiddenAtCallsite: true,
    rollbackOldHandleRejected: bRollbackOldHandleRejected,
    signalNotifications: bSignalNotifications,
    snapshotVersionAdvanced: bSnapshotVersionAdvanced,
    wholeRootReplacementIntentionallyNotExposed: true,
    scalarRootSupported: false,
  };

  const candidateC = {
    scalarCellPersists: cScalarPersisted,
    objectNestedMutationPersists: cObjectNestedMutationPersisted,
    signalNotifications: cSignalNotifications,
    snapshotVersionAdvanced: cSnapshotVersionAdvanced,
    cellWrapperRequiredForPrimitiveMutation: true,
    rawPrimitiveReferenceMutationPossible,
    oldNestedWriteAcceptedAfterReplacement: cOldNestedWriteAcceptedAfterReplacement,
    oldNestedWriteAffectedCurrentRoot: cOldNestedWriteAffectedCurrentRoot,
  };

  const aLifecycleSafe = !candidateA.memoryDurableDivergenceAfterOldHandleWrite;
  const bViable =
    candidateB.nestedMutationPersists &&
    candidateB.rollbackOldHandleRejected &&
    candidateB.snapshotVersionAdvanced &&
    candidateB.signalNotifications >= 1;
  const cRawStateCoherent = rawPrimitiveReferenceMutationPossible;
  const cReplacementLifetimeClear = !candidateC.oldNestedWriteAcceptedAfterReplacement;

  const decision = bViable && !cRawStateCoherent
    ? "PREFER_NARROW_SINGLETON_OBJECT_PROTOTYPE"
    : cRawStateCoherent && cReplacementLifetimeClear
      ? "CONTINUE_ARBITRARY_ROOT_PROTOTYPE"
      : aLifecycleSafe
        ? "KEEP_LIST_ONLY"
        : "UNCERTAIN";

  validExperiment =
    candidateA.nestedMutationPersists &&
    candidateB.nestedMutationPersists &&
    candidateC.scalarCellPersists &&
    candidateC.objectNestedMutationPersists;

  console.log(JSON.stringify({
    experiment: "root-state-semantics",
    issue: 40,
    currentRuntimeFacts: {
      stateTypeConstraint: "object[]",
      storageModel: "row-per-item",
      rollbackModel: "loaded generation invalidation",
      writableItemRule: "current generation + current durable item id membership + current proxy identity",
    },
    candidateA,
    candidateB,
    candidateC,
    semanticConstraints: {
      primitiveValuesHaveNoMutableReferenceIdentity: true,
      rawPrimitiveReferenceMutationPossible,
      arbitraryRawStateWouldNeedReplacementOrCellSemantics: true,
    },
    decisionInputs: {
      aLifecycleSafe,
      bViable,
      cRawStateCoherent,
      cReplacementLifetimeClear,
    },
    decision,
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

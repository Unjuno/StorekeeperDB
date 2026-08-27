import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCandidateA } from "./singleton_surface/candidate_a_list.js";
import { runCandidateB } from "./singleton_surface/candidate_b_paired.js";
import { runCandidateC } from "./singleton_surface/candidate_c_combined.js";

type SourceMetrics = {
  surfaceLines: number;
  surfaceChars: number;
  collectionMarkers: number;
  indexMarkers: number;
  valueMarkers: number;
  concepts: string[];
};

const metricsFor = (path: string): SourceMetrics => {
  const lines = readFileSync(path, "utf8").split("\n");
  const surface = lines.filter((line) => line.includes("@surface"));
  const countMarker = (marker: string) => surface.filter((line) => line.includes(marker)).length;
  const concepts = [...new Set(
    surface.flatMap((line) => [...line.matchAll(/@concept:([a-z-]+)/g)].map((match) => match[1]!)),
  )].sort();
  return {
    surfaceLines: surface.length,
    surfaceChars: surface.reduce((sum, line) => sum + line.trim().length, 0),
    collectionMarkers: countMarker("@collection"),
    indexMarkers: countMarker("@index"),
    valueMarkers: countMarker("@value"),
    concepts,
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-singleton-object-surface-"));
let validExperiment = false;

try {
  const runtime = {
    A: runCandidateA(join(root, "a.sqlite")),
    B: runCandidateB(join(root, "b.sqlite")),
    C: runCandidateC(join(root, "c.sqlite")),
  };

  const source = {
    A: metricsFor("scripts/singleton_surface/candidate_a_list.ts"),
    B: metricsFor("scripts/singleton_surface/candidate_b_paired.ts"),
    C: metricsFor("scripts/singleton_surface/candidate_c_combined.ts"),
  };

  const publicSurface = {
    A: { newNames: 0, newTypes: 0, commandReadSeparated: true, storageModelChange: false },
    B: { newNames: 2, newTypes: 0, commandReadSeparated: true, storageModelChange: false },
    C: { newNames: 1, newTypes: 0, commandReadSeparated: false, storageModelChange: false },
  };

  const runtimeValid = Object.values(runtime).every((result) =>
    result.pass &&
    result.notifications >= 1 &&
    result.snapshotVersionAdvanced &&
    result.staleOldHandleRejected,
  );

  const bRemovesCollectionCeremony =
    source.B.collectionMarkers === 0 && source.B.indexMarkers === 0 && source.B.valueMarkers === 0;
  const bDoesNotExpandCallsite =
    source.B.surfaceLines <= source.A.surfaceLines && source.B.surfaceChars < source.A.surfaceChars;
  const cAddsWrapperCeremony = source.C.valueMarkers > 0;
  const cMixesCommandAndRead = !publicSurface.C.commandReadSeparated;
  const bErgonomicCandidate = bRemovesCollectionCeremony && bDoesNotExpandCallsite;
  const cDominatedByB = cAddsWrapperCeremony && cMixesCommandAndRead && publicSurface.B.commandReadSeparated;

  // One singleton workload can show local ergonomic direction, but it cannot establish that
  // two permanent public names are worth adding to the package. Keep implementation deferred
  // until a second realistic singleton workload reproduces the same friction.
  const surfaceCandidate = runtimeValid && bErgonomicCandidate && cDominatedByB
    ? "B_PAIRED_OBJECT_STATE_SIGNAL"
    : "UNCERTAIN";
  const publicApiDecision = surfaceCandidate === "B_PAIRED_OBJECT_STATE_SIGNAL"
    ? "DEFER_UNTIL_SECOND_SINGLETON_SCENARIO"
    : "KEEP_CURRENT_LIST_ONLY";

  validExperiment = runtimeValid && surfaceCandidate !== "UNCERTAIN";

  console.log(JSON.stringify({
    experiment: "singleton-object-public-surface",
    issue: 44,
    runtime,
    source,
    publicSurface,
    decisionInputs: {
      runtimeValid,
      bRemovesCollectionCeremony,
      bDoesNotExpandCallsite,
      bErgonomicCandidate,
      cAddsWrapperCeremony,
      cMixesCommandAndRead,
      cDominatedByB,
    },
    surfaceCandidate,
    publicApiDecision,
    interpretation:
      "B is the cleanest local singleton-object surface in this workflow, but one scenario does not justify two permanent public names. Replicate singleton friction before changing exports.",
    validExperiment,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!validExperiment) process.exit(1);

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRelationalV1 } from "./change_amplification/relational_v1.js";
import { runRelationalV2 } from "./change_amplification/relational_v2.js";
import { runJsonBlobV1 } from "./change_amplification/json_blob_v1.js";
import { runJsonBlobV2 } from "./change_amplification/json_blob_v2.js";
import { runStorekeeperV1 } from "./change_amplification/storekeeper_v1.js";
import { runStorekeeperV2 } from "./change_amplification/storekeeper_v2.js";

type DiffStats = {
  v1Lines: number;
  v2Lines: number;
  unchangedLines: number;
  deletedLines: number;
  addedLines: number;
  changedLines: number;
};

type Profile = {
  persistence: DiffStats;
  allSource: DiffStats;
  v1Concepts: string[];
  v2Concepts: string[];
  addedConcepts: string[];
  removedConcepts: string[];
  v2PersistenceLineCountsByConcept: Record<string, number>;
};

const source = (path: string): string => readFileSync(path, "utf8");

const nonBlankLines = (text: string): string[] =>
  text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

const persistenceLines = (text: string): string[] =>
  nonBlankLines(text).filter((line) => line.includes("@persist"));

const concepts = (text: string): string[] => {
  const found = new Set<string>();
  const matcher = /@concept:([a-z0-9-]+)/g;
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(matcher)) found.add(match[1]!);
  }
  return [...found].sort();
};

const lcsLength = (left: string[], right: string[]): number => {
  const dp = Array.from({ length: right.length + 1 }, () => 0);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= right.length; j++) {
      const previous = dp[j]!;
      dp[j] = left[i - 1] === right[j - 1]
        ? diagonal + 1
        : Math.max(dp[j]!, dp[j - 1]!);
      diagonal = previous;
    }
  }
  return dp[right.length]!;
};

const diffStats = (v1: string[], v2: string[]): DiffStats => {
  const unchangedLines = lcsLength(v1, v2);
  const deletedLines = v1.length - unchangedLines;
  const addedLines = v2.length - unchangedLines;
  return {
    v1Lines: v1.length,
    v2Lines: v2.length,
    unchangedLines,
    deletedLines,
    addedLines,
    changedLines: deletedLines + addedLines,
  };
};

const countsByConcept = (text: string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const line of persistenceLines(text)) {
    for (const concept of concepts(line)) counts[concept] = (counts[concept] ?? 0) + 1;
  }
  return counts;
};

const profile = (v1Path: string, v2Path: string): Profile => {
  const v1 = source(v1Path);
  const v2 = source(v2Path);
  const v1Concepts = concepts(v1);
  const v2Concepts = concepts(v2);
  return {
    persistence: diffStats(persistenceLines(v1), persistenceLines(v2)),
    allSource: diffStats(nonBlankLines(v1), nonBlankLines(v2)),
    v1Concepts,
    v2Concepts,
    addedConcepts: v2Concepts.filter((value) => !v1Concepts.includes(value)),
    removedConcepts: v1Concepts.filter((value) => !v2Concepts.includes(value)),
    v2PersistenceLineCountsByConcept: countsByConcept(v2),
  };
};

const root = mkdtempSync(join(tmpdir(), "sk-change-amplification-"));
let pass = false;

try {
  const relationalPath = join(root, "relational.sqlite");
  const jsonBlobPath = join(root, "json-blob.sqlite");
  const storekeeperPath = join(root, "storekeeper.sqlite");

  runRelationalV1(relationalPath);
  const relationalRuntime = runRelationalV2(relationalPath);

  runJsonBlobV1(jsonBlobPath);
  const jsonBlobRuntime = runJsonBlobV2(jsonBlobPath);

  runStorekeeperV1(storekeeperPath);
  const storekeeperRuntime = runStorekeeperV2(storekeeperPath);

  const relational = profile(
    "scripts/change_amplification/relational_v1.ts",
    "scripts/change_amplification/relational_v2.ts",
  );
  const jsonBlob = profile(
    "scripts/change_amplification/json_blob_v1.ts",
    "scripts/change_amplification/json_blob_v2.ts",
  );
  const storekeeper = profile(
    "scripts/change_amplification/storekeeper_v1.ts",
    "scripts/change_amplification/storekeeper_v2.ts",
  );

  const strongestBaselineChangedLines = Math.min(
    relational.persistence.changedLines,
    jsonBlob.persistence.changedLines,
  );
  const strongestBaselineConceptCount = Math.min(
    relational.v2Concepts.length,
    jsonBlob.v2Concepts.length,
  );

  const runtimePass = relationalRuntime.pass && jsonBlobRuntime.pass && storekeeperRuntime.pass;
  const lowerPersistenceEditSurface = storekeeper.persistence.changedLines < strongestBaselineChangedLines;
  const noGreaterConceptSurface = storekeeper.v2Concepts.length <= strongestBaselineConceptCount;

  pass = runtimePass && lowerPersistenceEditSurface && noGreaterConceptSurface;

  console.log(JSON.stringify({
    experiment: "persistence-specific-change-amplification",
    scenario: "Issue V1 -> V2 optional priority/labels/comments",
    classification: {
      persistenceMarker: "// @persist",
      conceptMarker: "@concept:<name>",
      changedLineMethod: "LCS over trimmed non-blank source lines; additions + deletions",
      note: "Annotations are explicit and auditable but remain a classification choice; raw all-source diff stats are also emitted.",
    },
    runtime: {
      relational: relationalRuntime,
      jsonBlob: jsonBlobRuntime,
      storekeeper: storekeeperRuntime,
    },
    profiles: {
      relational,
      jsonBlob,
      storekeeper,
    },
    comparison: {
      strongestBaselineChangedLines,
      storekeeperChangedLines: storekeeper.persistence.changedLines,
      strongestBaselineConceptCount,
      storekeeperConceptCount: storekeeper.v2Concepts.length,
      lowerPersistenceEditSurface,
      noGreaterConceptSurface,
    },
    decision: pass ? "CANDIDATE_PASS" : "FAIL_OR_UNCERTAIN",
    pass,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!pass) process.exit(1);

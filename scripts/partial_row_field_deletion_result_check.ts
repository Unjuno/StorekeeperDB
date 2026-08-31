import { spawnSync } from "node:child_process";

const expectedDecision =
  "MIXED_PARTIAL_ROW_DELETE_REBUILDS_ITEM_PROJECTIONS_BUT_STAYS_CORRECT";

const child = spawnSync(
  process.execPath,
  ["--experimental-sqlite", "dist/scripts/partial_row_field_deletion_experiment.js"],
  { encoding: "utf8" },
);

if (child.status !== 0) {
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  throw new Error(`partial-row field-deletion experiment exited with status ${child.status}`);
}

const stdout = (child.stdout ?? "").trim();
const jsonStart = stdout.indexOf("{");
if (jsonStart < 0) {
  throw new Error("partial-row field-deletion experiment did not emit a JSON result");
}

const result = JSON.parse(stdout.slice(jsonStart)) as {
  decision?: string;
  checks?: {
    currentStateCorrect?: boolean;
    queriesAndDurableHandleCorrect?: boolean;
    reopenMixedTopologyCoherent?: boolean;
    itemLocalProjectionIsolation?: boolean;
    itemLocalProjectionRebuildObserved?: boolean;
    minimalDeletedCellOnly?: boolean;
  };
};

const checks = result.checks;
const expectedChecks =
  checks?.currentStateCorrect === true &&
  checks.queriesAndDurableHandleCorrect === true &&
  checks.reopenMixedTopologyCoherent === true &&
  checks.itemLocalProjectionIsolation === true &&
  checks.itemLocalProjectionRebuildObserved === true &&
  checks.minimalDeletedCellOnly === false;

if (result.decision !== expectedDecision || !expectedChecks) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  throw new Error(
    `unexpected partial-row field-deletion result: ${String(result.decision)}`,
  );
}

console.log(
  JSON.stringify(
    {
      decision: result.decision,
      expectedDecisionAsserted: true,
      correctnessAsserted: true,
      itemLocalProjectionRebuildAsserted: true,
    },
    null,
    2,
  ),
);

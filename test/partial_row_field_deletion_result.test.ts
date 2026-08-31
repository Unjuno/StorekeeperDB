import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("partial-row field deletion stays correct while rebuilding changed-item projections", () => {
  const child = spawnSync(
    process.execPath,
    ["--experimental-sqlite", "dist/scripts/partial_row_field_deletion_result_check.js"],
    { encoding: "utf8" },
  );

  assert.equal(
    child.status,
    0,
    `result gate failed\nstdout:\n${child.stdout ?? ""}\nstderr:\n${child.stderr ?? ""}`,
  );
  assert.match(
    child.stdout ?? "",
    /MIXED_PARTIAL_ROW_DELETE_REBUILDS_ITEM_PROJECTIONS_BUT_STAYS_CORRECT/,
  );
});

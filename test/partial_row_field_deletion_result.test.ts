import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import { test } from "node:test";

test("partial-row field deletion stays correct while rebuilding changed-item projections", () => {
  const child = (childProcess as any).spawnSync(
    process.execPath,
    ["--experimental-sqlite", "dist/scripts/partial_row_field_deletion_result_check.js"],
    { encoding: "utf8" },
  ) as { status: number | null; stdout?: string; stderr?: string };

  assert.equal(
    child.status,
    0,
    `result gate failed\nstdout:\n${child.stdout ?? ""}\nstderr:\n${child.stderr ?? ""}`,
  );
  assert.ok(
    (child.stdout ?? "").includes(
      "MIXED_PARTIAL_ROW_DELETE_REBUILDS_ITEM_PROJECTIONS_BUT_STAYS_CORRECT",
    ),
  );
});

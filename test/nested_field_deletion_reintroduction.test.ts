import { test } from "node:test";

test("nested field deletion and reintroduction experiment executes via dynamic import", async () => {
  await import("../scripts/nested_field_deletion_reintroduction_experiment.js");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { projectionWriteAmplificationResult as result } from "../scripts/projection_write_amplification_experiment.js";

test("projection write amplification has the measured item-local rebuild signature", () => {
  assert.equal(
    result.decision,
    "MEASURED_LINEAR_ITEM_REBUILD_WRITES_TIMING_OBSERVATIONAL",
  );
  assert.equal(result.checks.deterministicCorrectness, true);
  assert.equal(result.checks.exactTwoWritesPerProjectedPath, true);
  assert.equal(result.checks.constantWriteRatio, true);
  assert.equal(result.checks.validExperiment, true);

  assert.deepEqual(
    result.results.map((measurement) => [
      measurement.projectedPathCount,
      measurement.observedProjectionWrites,
    ]),
    [
      [1, 2],
      [4, 8],
      [16, 32],
      [64, 128],
    ],
  );

  for (const measurement of result.results) {
    assert.equal(measurement.deletes, measurement.projectedPathCount);
    assert.equal(measurement.inserts, measurement.projectedPathCount);
    assert.equal(measurement.updates, 0);
    assert.equal(measurement.oneDeleteAndInsertPerPath, true);
    assert.equal(measurement.sourceCorrect, true);
    assert.equal(measurement.projectionCorrect, true);
    assert.equal(measurement.queryCorrect, true);
    assert.equal(measurement.reopenCorrect, true);
    assert.equal(measurement.timing.samples, 80);
  }
});

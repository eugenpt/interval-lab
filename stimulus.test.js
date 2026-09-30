"use strict";

const assert = require("node:assert/strict");
const { buildClickPositionsSamples } = require("./stimulus.js");

const common = {
  preRollSamples: 500,
  firstIntervalSamples: 100,
  secondIntervalSamples: 160,
  interstimulusSamples: 200
};

assert.deepEqual(
  buildClickPositionsSamples({ ...common, boundaryMode: "separated", firstIntervalRepeats: 7 }),
  [500, 600, 800, 960],
  "Separated intervals must retain their four-click structure and ignore repeat settings."
);

assert.deepEqual(
  buildClickPositionsSamples({ ...common, boundaryMode: "shared", firstIntervalRepeats: 1 }),
  [500, 600, 760],
  "One repeat must exactly preserve the original three-click shared-boundary stimulus."
);

assert.deepEqual(
  buildClickPositionsSamples({ ...common, boundaryMode: "shared", firstIntervalRepeats: 3 }),
  [500, 600, 700, 800, 960],
  "Three repeats must produce three first intervals followed by one comparison interval."
);

assert.throws(
  () => buildClickPositionsSamples({ ...common, boundaryMode: "shared", firstIntervalRepeats: 0 }),
  /positive integer/
);

console.log("Stimulus timing tests passed.");

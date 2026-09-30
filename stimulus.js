(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.IntervalLabStimulus = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function requireNonnegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a nonnegative integer.`);
    }
  }

  function buildClickPositionsSamples(options) {
    const {
      preRollSamples,
      firstIntervalSamples,
      secondIntervalSamples,
      interstimulusSamples,
      boundaryMode,
      firstIntervalRepeats = 1
    } = options;

    requireNonnegativeInteger(preRollSamples, "Pre-roll samples");
    requireNonnegativeInteger(firstIntervalSamples, "First-interval samples");
    requireNonnegativeInteger(secondIntervalSamples, "Second-interval samples");
    requireNonnegativeInteger(interstimulusSamples, "Interstimulus samples");
    if (!Number.isInteger(firstIntervalRepeats) || firstIntervalRepeats < 1) {
      throw new Error("First-interval repeats must be a positive integer.");
    }

    if (boundaryMode !== "shared") {
      return [
        preRollSamples,
        preRollSamples + firstIntervalSamples,
        preRollSamples + firstIntervalSamples + interstimulusSamples,
        preRollSamples + firstIntervalSamples + interstimulusSamples + secondIntervalSamples
      ];
    }

    const positions = [preRollSamples];
    let cursor = preRollSamples;
    for (let repeat = 0; repeat < firstIntervalRepeats; repeat += 1) {
      cursor += firstIntervalSamples;
      positions.push(cursor);
    }
    positions.push(cursor + secondIntervalSamples);
    return positions;
  }

  return { buildClickPositionsSamples };
});

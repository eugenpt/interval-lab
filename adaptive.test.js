"use strict";

const assert = require("node:assert/strict");
const {
  AdaptivePsychometricEstimator,
  normalCdf
} = require("./adaptive.js");

const GETTY_800 = [650, 680, 710, 740, 770, 800, 830, 860, 890, 920, 950];

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function runSession({ adaptive, seed, trials, trueMu, trueSigma }) {
  const observer = seeded(seed);
  const estimator = new AdaptivePsychometricEstimator({
    muGridPoints: 51,
    logSigmaGridPoints: 41,
    nearTieFraction: 0,
    earlyExplorationProbability: 0
  }, 800, GETTY_800, GETTY_800, `session-${seed}`);

  for (let trial = 0; trial < trials; trial += 1) {
    const comparison = adaptive
      ? estimator.chooseNextComparison().comparisonMs
      : GETTY_800[trial % GETTY_800.length];
    const response = observer() < normalCdf((comparison - trueMu) / trueSigma);
    estimator.update(comparison, response);
  }
  return estimator;
}

assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-8);
assert.ok(Math.abs(normalCdf(1.959964) - 0.975) < 2e-5);

const reloadSource = runSession({
  adaptive: true,
  seed: 17,
  trials: 25,
  trueMu: 820,
  trueSigma: 45
});
const reloaded = AdaptivePsychometricEstimator.deserialize(reloadSource.serialize());
assert.deepEqual(reloaded.serialize(), reloadSource.serialize());
const nextOriginal = reloadSource.chooseNextComparison();
const nextReloaded = reloaded.chooseNextComparison();
assert.equal(nextOriginal.comparisonMs, nextReloaded.comparisonMs);
assert.equal(nextOriginal.phase, nextReloaded.phase);
assert.ok(Math.abs(nextOriginal.expectedInformationGain - nextReloaded.expectedInformationGain) < 1e-12);

const adaptiveErrors = [];
const uniformErrors = [];
const coverage = [];
const informativeSelectionFractions = [];
for (let seed = 1; seed <= 30; seed += 1) {
  const adaptive = runSession({ adaptive: true, seed, trials: 70, trueMu: 820, trueSigma: 45 });
  const uniform = runSession({ adaptive: false, seed, trials: 70, trueMu: 820, trueSigma: 45 });
  const adaptiveSummary = adaptive.getPosteriorSummary();
  const uniformSummary = uniform.getPosteriorSummary();
  adaptiveErrors.push(Math.abs(adaptiveSummary.muMean - 820) + Math.abs(adaptiveSummary.sigmaMean - 45));
  uniformErrors.push(Math.abs(uniformSummary.muMean - 820) + Math.abs(uniformSummary.sigmaMean - 45));
  coverage.push(
    adaptiveSummary.muCiLow <= 820 && adaptiveSummary.muCiHigh >= 820
    && adaptiveSummary.sigmaCiLow <= 45 && adaptiveSummary.sigmaCiHigh >= 45
  );
  const adaptiveSelections = adaptive.history.slice(GETTY_800.length);
  informativeSelectionFractions.push(
    adaptiveSelections.filter(({ comparisonMs }) => Math.abs(comparisonMs - 820) <= 2 * 45).length
      / adaptiveSelections.length
  );
  assert.ok(Number.isFinite(adaptiveSummary.posteriorEntropy));
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const report = {
  sessions: adaptiveErrors.length,
  trialsPerSession: 70,
  adaptiveMeanAbsoluteCombinedError: mean(adaptiveErrors),
  uniformMeanAbsoluteCombinedError: mean(uniformErrors),
  jointCredibleIntervalCoverage: coverage.filter(Boolean).length / coverage.length,
  adaptiveSelectionsWithinTwoSigma: mean(informativeSelectionFractions)
};

assert.ok(report.adaptiveMeanAbsoluteCombinedError < 35);
assert.ok(report.adaptiveMeanAbsoluteCombinedError <= report.uniformMeanAbsoluteCombinedError * 1.2);
assert.ok(report.jointCredibleIntervalCoverage >= 0.5);
assert.ok(report.adaptiveSelectionsWithinTwoSigma >= 0.75);

console.log(JSON.stringify(report, null, 2));

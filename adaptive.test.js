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

function runSession({ adaptive, seed, trials, trueMu, trueSigma, explorationProbability = 0 }) {
  const observer = seeded(seed);
  const estimator = new AdaptivePsychometricEstimator({
    muGridPoints: 51,
    logSigmaGridPoints: 41,
    nearTieFraction: 0,
    earlyExplorationProbability: 0,
    explorationProbability
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
  trueSigma: 45,
  explorationProbability: 0.2
});
const reloaded = AdaptivePsychometricEstimator.deserialize(reloadSource.serialize());
assert.deepEqual(reloaded.serialize(), reloadSource.serialize());
const nextOriginal = reloadSource.chooseNextComparison();
const nextReloaded = reloaded.chooseNextComparison();
assert.equal(nextOriginal.comparisonMs, nextReloaded.comparisonMs);
assert.equal(nextOriginal.phase, nextReloaded.phase);
assert.ok(Math.abs(nextOriginal.expectedInformationGain - nextReloaded.expectedInformationGain) < 1e-12);

const legacyV1 = reloadSource.serialize();
legacyV1.algorithmVersion = "bayes-eig-gaussian-v1";
legacyV1.config = { ...legacyV1.config, algorithmVersion: "bayes-eig-gaussian-v1" };
delete legacyV1.config.explorationProbability;
const upgradedLegacy = AdaptivePsychometricEstimator.deserialize(legacyV1).serialize();
assert.equal(upgradedLegacy.algorithmVersion, "bayes-eig-gaussian-v2");
assert.equal(upgradedLegacy.config.explorationProbability, 0);
assert.deepEqual(upgradedLegacy.logPosterior, legacyV1.logPosterior);

const TRUE_MU = 820;
const TRUE_SIGMA = 45;
const benchmark = {
  pureEIG: { mu: [], sigma: [] },
  persistentExploration10: { mu: [], sigma: [] },
  persistentExploration20: { mu: [], sigma: [] },
  uniformGettyBlocks: { mu: [], sigma: [] }
};
const coverage = [];
const informativeSelectionFractions = [];
for (let seed = 1; seed <= 30; seed += 1) {
  const sessions = {
    pureEIG: runSession({ adaptive: true, seed, trials: 70, trueMu: TRUE_MU, trueSigma: TRUE_SIGMA }),
    persistentExploration10: runSession({ adaptive: true, seed, trials: 70, trueMu: TRUE_MU, trueSigma: TRUE_SIGMA, explorationProbability: 0.1 }),
    persistentExploration20: runSession({ adaptive: true, seed, trials: 70, trueMu: TRUE_MU, trueSigma: TRUE_SIGMA, explorationProbability: 0.2 }),
    uniformGettyBlocks: runSession({ adaptive: false, seed, trials: 70, trueMu: TRUE_MU, trueSigma: TRUE_SIGMA })
  };
  const summaries = Object.fromEntries(
    Object.entries(sessions).map(([name, session]) => [name, session.getPosteriorSummary()])
  );
  Object.entries(summaries).forEach(([name, summary]) => {
    benchmark[name].mu.push(Math.abs(summary.muMean - TRUE_MU) / TRUE_SIGMA);
    benchmark[name].sigma.push(Math.abs(summary.sigmaMean - TRUE_SIGMA) / TRUE_SIGMA);
    assert.ok(Number.isFinite(summary.posteriorEntropy));
  });
  const adaptive = sessions.pureEIG;
  const adaptiveSummary = summaries.pureEIG;
  coverage.push(
    adaptiveSummary.muCiLow <= TRUE_MU && adaptiveSummary.muCiHigh >= TRUE_MU
    && adaptiveSummary.sigmaCiLow <= TRUE_SIGMA && adaptiveSummary.sigmaCiHigh >= TRUE_SIGMA
  );
  const adaptiveSelections = adaptive.history.slice(GETTY_800.length);
  informativeSelectionFractions.push(
    adaptiveSelections.filter(({ comparisonMs }) => Math.abs(comparisonMs - TRUE_MU) <= 2 * TRUE_SIGMA).length
      / adaptiveSelections.length
  );
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const summarizeErrors = ({ mu, sigma }) => ({
  meanAbsoluteMuErrorOverTrueSigma: mean(mu),
  meanRelativeAbsoluteSigmaError: mean(sigma)
});
const report = {
  sessionsPerDesign: benchmark.pureEIG.mu.length,
  trialsPerSession: 70,
  designs: Object.fromEntries(
    Object.entries(benchmark).map(([name, errors]) => [name, summarizeErrors(errors)])
  ),
  jointCredibleIntervalCoverage: coverage.filter(Boolean).length / coverage.length,
  adaptiveSelectionsWithinTwoSigma: mean(informativeSelectionFractions)
};

assert.ok(report.designs.pureEIG.meanAbsoluteMuErrorOverTrueSigma < 0.5);
assert.ok(report.designs.pureEIG.meanRelativeAbsoluteSigmaError < 0.5);
assert.ok(report.designs.pureEIG.meanAbsoluteMuErrorOverTrueSigma
  <= report.designs.uniformGettyBlocks.meanAbsoluteMuErrorOverTrueSigma * 1.5);
assert.ok(report.designs.pureEIG.meanRelativeAbsoluteSigmaError
  <= report.designs.uniformGettyBlocks.meanRelativeAbsoluteSigmaError * 1.5);
assert.ok(report.jointCredibleIntervalCoverage >= 0.5);
assert.ok(report.adaptiveSelectionsWithinTwoSigma >= 0.75);

const repetitionProbe = runSession({
  adaptive: true,
  seed: 991,
  trials: 100,
  trueMu: TRUE_MU,
  trueSigma: TRUE_SIGMA,
  explorationProbability: 1
});
let identicalRun = 1;
for (let index = 1; index < repetitionProbe.history.length; index += 1) {
  identicalRun = repetitionProbe.history[index].comparisonMs === repetitionProbe.history[index - 1].comparisonMs
    ? identicalRun + 1
    : 1;
  assert.ok(identicalRun <= 2, "Persistent exploration must retain the repetition cap");
}

console.log(JSON.stringify(report, null, 2));

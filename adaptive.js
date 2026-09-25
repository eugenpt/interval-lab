(function adaptiveModule(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.IntervalLabAdaptive = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildAdaptiveApi() {
  "use strict";

  const ALGORITHM_VERSION = "bayes-eig-gaussian-v1";
  const EPSILON = 1e-12;

  const DEFAULT_CONFIG = Object.freeze({
    algorithmVersion: ALGORITHM_VERSION,
    muGridPoints: 101,
    logSigmaGridPoints: 81,
    muPaddingFraction: 0.5,
    muPriorSdRangeFraction: 0.75,
    sigmaMinStepFraction: 0.25,
    sigmaMaxRangeFraction: 1.0,
    logSigmaPriorCenterRangeFraction: 1 / 6,
    logSigmaPriorSd: 1.0,
    credibleLevel: 0.95,
    maxSameComparisonConsecutive: 2,
    nearTieFraction: 0.01,
    earlyExplorationTrials: 25,
    earlyExplorationProbability: 0.1
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // Abramowitz-Stegun erf approximation; maximum error is about 1.5e-7.
  function erf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value);
    const t = 1 / (1 + 0.3275911 * x);
    const polynomial = (((((1.061405429 * t - 1.453152027) * t)
      + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
    return sign * (1 - polynomial * Math.exp(-x * x));
  }

  function normalCdf(value) {
    return clamp(0.5 * (1 + erf(value / Math.SQRT2)), EPSILON, 1 - EPSILON);
  }

  function hashSeed(seed) {
    let hash = 2166136261 >>> 0;
    for (const character of String(seed)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash || 0x9e3779b9;
  }

  class SeededRng {
    constructor(seedOrState) {
      this.state = typeof seedOrState === "number"
        ? seedOrState >>> 0
        : hashSeed(seedOrState);
      if (!this.state) this.state = 0x9e3779b9;
    }

    next() {
      let value = this.state;
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      this.state = value >>> 0;
      return this.state / 4294967296;
    }

    integer(maxExclusive) {
      return Math.floor(this.next() * maxExclusive);
    }
  }

  function shuffled(values, rng) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = rng.integer(index + 1);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function uniqueSortedNumbers(values) {
    return [...new Set(values.map(Number))]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }

  function linearGrid(minimum, maximum, count) {
    if (count <= 1 || minimum === maximum) return [minimum];
    return Array.from({ length: count }, (_, index) =>
      minimum + (maximum - minimum) * index / (count - 1));
  }

  function centralInterval(grid, probabilities, credibleLevel) {
    const tail = (1 - credibleLevel) / 2;
    const quantile = (target) => {
      let cumulative = 0;
      for (let index = 0; index < grid.length; index += 1) {
        cumulative += probabilities[index];
        if (cumulative >= target) return grid[index];
      }
      return grid[grid.length - 1];
    };
    return [quantile(tail), quantile(1 - tail)];
  }

  function normalizeLogWeights(logWeights) {
    let maximum = -Infinity;
    for (const value of logWeights) maximum = Math.max(maximum, value);
    let total = 0;
    for (let index = 0; index < logWeights.length; index += 1) {
      total += Math.exp(logWeights[index] - maximum);
    }
    const logNormalizer = maximum + Math.log(total);
    for (let index = 0; index < logWeights.length; index += 1) {
      logWeights[index] -= logNormalizer;
    }
  }

  class AdaptivePsychometricEstimator {
    constructor(config, standardMs, candidateValues, initialComparisonValues, seed) {
      this.config = { ...DEFAULT_CONFIG, ...config };
      this.standardMs = Number(standardMs);
      this.candidateValues = uniqueSortedNumbers(candidateValues);
      this.initialComparisonValues = uniqueSortedNumbers(initialComparisonValues || candidateValues);
      this.rng = new SeededRng(seed);
      this.history = [];
      this.selectionCount = 0;

      if (!(this.standardMs > 0)) throw new Error("Adaptive standard must be positive.");
      if (this.candidateValues.length < 3) throw new Error("Adaptive mode needs at least three candidate comparisons.");
      if (!this.initialComparisonValues.length) throw new Error("Adaptive mode needs initial coverage values.");

      const minimum = this.candidateValues[0];
      const maximum = this.candidateValues[this.candidateValues.length - 1];
      const range = maximum - minimum;
      const spacings = this.candidateValues.slice(1).map((value, index) => value - this.candidateValues[index]);
      const positiveSpacings = spacings.filter((value) => value > 0).sort((a, b) => a - b);
      const typicalStep = positiveSpacings.length
        ? positiveSpacings[Math.floor(positiveSpacings.length / 2)]
        : Math.max(1, range / 10);

      this.gridConfig = {
        muMin: Number.isFinite(this.config.muMin)
          ? this.config.muMin
          : minimum - this.config.muPaddingFraction * range,
        muMax: Number.isFinite(this.config.muMax)
          ? this.config.muMax
          : maximum + this.config.muPaddingFraction * range,
        sigmaMin: Number.isFinite(this.config.sigmaMin)
          ? this.config.sigmaMin
          : Math.max(0.25, typicalStep * this.config.sigmaMinStepFraction),
        sigmaMax: Number.isFinite(this.config.sigmaMax)
          ? this.config.sigmaMax
          : Math.max(typicalStep, range * this.config.sigmaMaxRangeFraction),
        muGridPoints: this.config.muGridPoints,
        logSigmaGridPoints: this.config.logSigmaGridPoints
      };

      this.muGrid = linearGrid(this.gridConfig.muMin, this.gridConfig.muMax, this.gridConfig.muGridPoints);
      this.logSigmaGrid = linearGrid(
        Math.log(this.gridConfig.sigmaMin),
        Math.log(this.gridConfig.sigmaMax),
        this.gridConfig.logSigmaGridPoints
      );
      this.sigmaGrid = this.logSigmaGrid.map(Math.exp);
      this.logPosterior = new Float64Array(this.muGrid.length * this.sigmaGrid.length);
      this.initialQueue = shuffled(this.initialComparisonValues, this.rng);
      this.initializePrior(range, typicalStep);
    }

    initializePrior(range, typicalStep) {
      const muPriorSd = Math.max(typicalStep, range * this.config.muPriorSdRangeFraction);
      const sigmaCenter = Math.max(
        this.gridConfig.sigmaMin,
        range * this.config.logSigmaPriorCenterRangeFraction
      );
      const logSigmaCenter = Math.log(clamp(
        sigmaCenter,
        this.gridConfig.sigmaMin,
        this.gridConfig.sigmaMax
      ));
      let cell = 0;
      for (const mu of this.muGrid) {
        const muTerm = -0.5 * Math.pow((mu - this.standardMs) / muPriorSd, 2);
        for (const logSigma of this.logSigmaGrid) {
          const sigmaTerm = -0.5 * Math.pow(
            (logSigma - logSigmaCenter) / this.config.logSigmaPriorSd,
            2
          );
          this.logPosterior[cell] = muTerm + sigmaTerm;
          cell += 1;
        }
      }
      normalizeLogWeights(this.logPosterior);
    }

    probability(comparisonMs, mu, sigma) {
      return normalCdf((comparisonMs - mu) / sigma);
    }

    update(comparisonMs, comparisonJudgedLonger) {
      let cell = 0;
      for (const mu of this.muGrid) {
        for (const sigma of this.sigmaGrid) {
          const probability = this.probability(comparisonMs, mu, sigma);
          this.logPosterior[cell] += Math.log(comparisonJudgedLonger ? probability : 1 - probability);
          cell += 1;
        }
      }
      normalizeLogWeights(this.logPosterior);
      this.history.push({ comparisonMs, comparisonJudgedLonger: Boolean(comparisonJudgedLonger) });
      return this.getPosteriorSummary();
    }

    posteriorWeights() {
      return Float64Array.from(this.logPosterior, Math.exp);
    }

    entropy() {
      let result = 0;
      for (let index = 0; index < this.logPosterior.length; index += 1) {
        const weight = Math.exp(this.logPosterior[index]);
        result -= weight * this.logPosterior[index];
      }
      return result;
    }

    expectedInformationGain(comparisonMs, currentEntropy, weights) {
      let q = 0;
      let weightedLogOne = 0;
      let weightedLogZero = 0;
      let cell = 0;
      for (const mu of this.muGrid) {
        for (const sigma of this.sigmaGrid) {
          const weight = weights[cell];
          const probability = this.probability(comparisonMs, mu, sigma);
          const oneWeight = weight * probability;
          const zeroWeight = weight * (1 - probability);
          q += oneWeight;
          weightedLogOne += oneWeight * (this.logPosterior[cell] + Math.log(probability));
          weightedLogZero += zeroWeight * (this.logPosterior[cell] + Math.log(1 - probability));
          cell += 1;
        }
      }
      q = clamp(q, EPSILON, 1 - EPSILON);
      const entropyOne = Math.log(q) - weightedLogOne / q;
      const entropyZero = Math.log(1 - q) - weightedLogZero / (1 - q);
      const expectedEntropy = q * entropyOne + (1 - q) * entropyZero;
      return Math.max(0, currentEntropy - expectedEntropy);
    }

    consecutiveCount(value) {
      let count = 0;
      for (let index = this.history.length - 1; index >= 0; index -= 1) {
        if (this.history[index].comparisonMs !== value) break;
        count += 1;
      }
      return count;
    }

    candidateScores() {
      const entropy = this.entropy();
      const weights = this.posteriorWeights();
      return this.candidateValues.map((comparisonMs) => ({
        comparisonMs,
        expectedInformationGain: this.expectedInformationGain(comparisonMs, entropy, weights)
      })).sort((a, b) => b.expectedInformationGain - a.expectedInformationGain);
    }

    chooseNextComparison() {
      let comparisonMs;
      let phase;
      let scores = null;
      let selectedExpectedInformationGain;

      if (this.selectionCount < this.initialQueue.length) {
        comparisonMs = this.initialQueue[this.selectionCount];
        phase = "initial_block";
        selectedExpectedInformationGain = this.expectedInformationGain(
          comparisonMs,
          this.entropy(),
          this.posteriorWeights()
        );
      } else {
        phase = "adaptive";
        scores = this.candidateScores();
        const allowed = scores.filter((candidate) =>
          this.consecutiveCount(candidate.comparisonMs) < this.config.maxSameComparisonConsecutive);
        const pool = allowed.length ? allowed : scores;
        const inEarlyExploration = this.selectionCount < this.config.earlyExplorationTrials
          && this.config.earlyExplorationProbability > 0
          && this.rng.next() < this.config.earlyExplorationProbability;

        if (inEarlyExploration) {
          const counts = new Map(this.candidateValues.map((value) => [value, 0]));
          for (const item of this.history) counts.set(item.comparisonMs, (counts.get(item.comparisonMs) || 0) + 1);
          const minimumCount = Math.min(...pool.map((candidate) => counts.get(candidate.comparisonMs) || 0));
          const exploratory = pool.filter((candidate) => (counts.get(candidate.comparisonMs) || 0) === minimumCount);
          comparisonMs = exploratory[this.rng.integer(exploratory.length)].comparisonMs;
        } else {
          const best = pool[0].expectedInformationGain;
          const tolerance = Math.abs(best) * Math.max(0, this.config.nearTieFraction);
          const nearTies = pool.filter((candidate) => candidate.expectedInformationGain >= best - tolerance);
          comparisonMs = nearTies[this.rng.integer(nearTies.length)].comparisonMs;
        }
      }

      this.selectionCount += 1;
      const selected = scores?.find((candidate) => candidate.comparisonMs === comparisonMs);
      return {
        comparisonMs,
        phase,
        expectedInformationGain: selected?.expectedInformationGain ?? selectedExpectedInformationGain,
        candidateScores: scores
      };
    }

    getPosteriorSummary() {
      const muMarginal = new Float64Array(this.muGrid.length);
      const sigmaMarginal = new Float64Array(this.sigmaGrid.length);
      let muMean = 0;
      let sigmaMean = 0;
      let cell = 0;
      for (let muIndex = 0; muIndex < this.muGrid.length; muIndex += 1) {
        for (let sigmaIndex = 0; sigmaIndex < this.sigmaGrid.length; sigmaIndex += 1) {
          const weight = Math.exp(this.logPosterior[cell]);
          muMarginal[muIndex] += weight;
          sigmaMarginal[sigmaIndex] += weight;
          muMean += weight * this.muGrid[muIndex];
          sigmaMean += weight * this.sigmaGrid[sigmaIndex];
          cell += 1;
        }
      }
      const muMapIndex = muMarginal.indexOf(Math.max(...muMarginal));
      const sigmaMapIndex = sigmaMarginal.indexOf(Math.max(...sigmaMarginal));
      const muCi = centralInterval(this.muGrid, muMarginal, this.config.credibleLevel);
      const sigmaCi = centralInterval(this.sigmaGrid, sigmaMarginal, this.config.credibleLevel);
      return {
        muMean,
        muMap: this.muGrid[muMapIndex],
        muCiLow: muCi[0],
        muCiHigh: muCi[1],
        sigmaMean,
        sigmaMap: this.sigmaGrid[sigmaMapIndex],
        sigmaCiLow: sigmaCi[0],
        sigmaCiHigh: sigmaCi[1],
        posteriorEntropy: this.entropy(),
        credibleLevel: this.config.credibleLevel
      };
    }

    serialize() {
      return {
        algorithmVersion: ALGORITHM_VERSION,
        config: this.config,
        standardMs: this.standardMs,
        candidateValues: this.candidateValues,
        initialComparisonValues: this.initialComparisonValues,
        gridConfig: this.gridConfig,
        logPosterior: Array.from(this.logPosterior),
        initialQueue: this.initialQueue,
        selectionCount: this.selectionCount,
        history: this.history,
        rngState: this.rng.state
      };
    }

    static deserialize(serialized) {
      if (!serialized || serialized.algorithmVersion !== ALGORITHM_VERSION) {
        throw new Error("Unsupported adaptive estimator state.");
      }
      const estimator = new AdaptivePsychometricEstimator(
        { ...serialized.config, ...serialized.gridConfig },
        serialized.standardMs,
        serialized.candidateValues,
        serialized.initialComparisonValues,
        serialized.rngState
      );
      estimator.config = { ...serialized.config };
      if (serialized.logPosterior.length !== estimator.logPosterior.length) {
        throw new Error("Adaptive posterior grid size does not match its configuration.");
      }
      estimator.logPosterior = Float64Array.from(serialized.logPosterior);
      estimator.initialQueue = [...serialized.initialQueue];
      estimator.selectionCount = serialized.selectionCount;
      estimator.history = serialized.history.map((item) => ({ ...item }));
      estimator.rng.state = serialized.rngState >>> 0;
      return estimator;
    }
  }

  function buildIntegerCandidates(minimum, maximum, requestedCount) {
    if (!(maximum > minimum)) throw new Error("Comparison maximum must exceed minimum.");
    const count = Math.max(3, Math.min(requestedCount, Math.floor(maximum - minimum) + 1));
    return uniqueSortedNumbers(linearGrid(minimum, maximum, count).map(Math.round));
  }

  function buildCoverageValues(minimum, maximum, count = 11) {
    return uniqueSortedNumbers(linearGrid(minimum, maximum, count).map(Math.round));
  }

  return {
    ALGORITHM_VERSION,
    DEFAULT_CONFIG,
    AdaptivePsychometricEstimator,
    buildCoverageValues,
    buildIntegerCandidates,
    normalCdf
  };
});

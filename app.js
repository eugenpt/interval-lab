(() => {
  "use strict";

  const LEGACY_STORAGE_KEY = "interval-lab-state-v1";
  const EXPERIMENT_KEY_PREFIX = "interval-lab-experiment-v1:";
  const CURRENT_EXPERIMENT_KEY = "interval-lab-current-experiment-v1";
  const SCHEMA_VERSION = 3;
  const APP_VERSION = "1.3.0";
  const DEFAULT_CLICK_DURATION_MS = 1.0;
  const PRE_ROLL_MS = 500;
  const POST_ROLL_MS = 500;
  const INTERVAL_GAP_MS = 2000;
  const WARNING_TO_AUDIO_MS = 1000;
  const INTERTRIAL_MS = 3000;

  const GETTY_CONDITIONS = [
    { standard: 50, comparisons: [35, 38, 41, 44, 47, 50, 53, 56, 59, 62, 65] },
    { standard: 100, comparisons: [75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125] },
    { standard: 200, comparisons: [160, 168, 176, 184, 192, 200, 208, 216, 224, 232, 240] },
    { standard: 400, comparisons: [350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450] },
    { standard: 600, comparisons: [500, 520, 540, 560, 580, 600, 620, 640, 660, 680, 700] },
    { standard: 800, comparisons: [650, 680, 710, 740, 770, 800, 830, 860, 890, 920, 950] },
    { standard: 1000, comparisons: [900, 920, 940, 960, 980, 1000, 1020, 1040, 1060, 1080, 1100] },
    { standard: 1200, comparisons: [1075, 1100, 1125, 1150, 1175, 1200, 1225, 1250, 1275, 1300, 1325] },
    { standard: 1400, comparisons: [1250, 1280, 1310, 1340, 1370, 1400, 1430, 1460, 1490, 1520, 1550] },
    { standard: 1600, comparisons: [1400, 1440, 1480, 1520, 1560, 1600, 1640, 1680, 1720, 1760, 1800] },
    { standard: 1800, comparisons: [1600, 1640, 1680, 1720, 1760, 1800, 1840, 1880, 1920, 1960, 2000] },
    { standard: 2000, comparisons: [1800, 1840, 1880, 1920, 1960, 2000, 2040, 2080, 2120, 2160, 2200] },
    { standard: 2400, comparisons: [1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900] },
    { standard: 2800, comparisons: [2050, 2200, 2350, 2500, 2650, 2800, 2950, 3100, 3250, 3400, 3550] },
    { standard: 3200, comparisons: [2200, 2400, 2600, 2800, 3000, 3200, 3400, 3600, 3800, 4000, 4200] }
  ];

  const GETTY_TRIAL_SCHEMA = Object.freeze(["interval_1_ms", "interval_2_ms"]);
  const RANDOMIZED_TRIAL_SCHEMA = Object.freeze([
    "interval_1_ms", "interval_2_ms", "interstimulus_ms", "start_to_first_tick_ms"
  ]);
  const ANSWER_SCHEMA = Object.freeze([
    "response", "answered_at_unix_ms", "response_time_ms", "sample_rate_hz"
  ]);

  function dataSchemaForMode(mode) {
    return {
      trial: mode === "randomized" ? RANDOMIZED_TRIAL_SCHEMA : GETTY_TRIAL_SCHEMA,
      answer: ANSWER_SCHEMA
    };
  }

  const el = Object.fromEntries(
    [
      "setupView", "runView", "summaryView", "saveIndicator", "resumeButton", "gettyConfig",
      "randomizedConfig", "randomTrialEstimate", "randomTrials", "equalPercent", "minDuration",
      "maxDuration", "minDifference", "maxDifference", "infiniteTrials", "requireTrialStart",
      "startDelayMin", "startDelayMax", "isiMin", "isiMax", "seedInput", "sampleRateLabel", "volumeSlider",
      "volumeValue", "clickDuration", "testAudioButton", "participantId", "startButton", "setupError",
      "importJsonButton", "importJsonInput", "savedExperimentRow", "savedExperimentSelect", "removeExperimentButton",
      "runModeLabel", "sessionTitle", "sessionSubtitle", "pauseButton", "exportCsvHeaderButton", "exportHeaderButton", "progressFill",
      "trialProgress", "sessionProgress", "trialStage", "warningLight", "phaseLabel", "phaseInstruction",
      "beginTrialsButton", "responseButtons", "storageUsage", "summaryTitle", "summaryText", "summaryAnswers",
      "summaryDuration", "summarySize", "nextSessionButton", "downloadCsvButton", "downloadJsonButton",
      "newExperimentButton", "pauseDialog", "pauseDialogTitle", "pauseDialogText",
      "resumeDialogButton", "exportDialogButton", "setupDialogButton"
    ].map((id) => [id, document.getElementById(id)])
  );

  let state = loadState();
  let audioContext = null;
  let activeSource = null;
  let runToken = 0;
  let awaitingResponse = false;
  let responseOpenedAt = 0;
  let currentSampleRate = null;
  let busy = false;

  function preciseEpochMs() {
    return performance.timeOrigin + performance.now();
  }

  function parseTime(value) {
    if (value === null || value === undefined) return null;
    if (Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function migrateV1(oldState) {
    const clickDurationMs = Number(oldState.config?.clickDurationSeconds) * 1000;
    const migratedV2 = {
      schemaVersion: 2,
      appVersion: APP_VERSION,
      dataSchema: {
        trial: GETTY_TRIAL_SCHEMA,
        answer: ANSWER_SCHEMA
      },
      experimentId: oldState.experimentId,
      participantId: oldState.participantId,
      mode: oldState.mode,
      status: oldState.status,
      createdAtMs: parseTime(oldState.createdAt) ?? Date.now(),
      updatedAtMs: parseTime(oldState.updatedAt) ?? Date.now(),
      seed: oldState.seed,
      audio: {
        level: Number.isFinite(oldState.volume) ? oldState.volume : 0.2,
        clickDurationMs: Number.isFinite(clickDurationMs) && clickDurationMs > 0 ? clickDurationMs : 0.1
      },
      currentSessionIndex: oldState.currentSessionIndex || 0,
      config: {
        ...oldState.config,
        preRollMs: 50,
        postRollMs: 0
      },
      sessions: oldState.sessions.map((session) => {
        const sourceTrials = Array.isArray(session.queue) && session.queue.length
          ? session.queue
          : session.answers;
        const trials = sourceTrials?.length
          ? sourceTrials.map((trial) => [Number(trial.t1Ms), Number(trial.t2Ms)])
          : null;
        const answers = session.answers.map((answer) => [
          Number(answer.response),
          parseTime(answer.responseAt) ?? Date.now(),
          Number(answer.rtMs) || 0,
          Number(answer.sampleRateHz) || 48000
        ]);
        return {
          standardMs: session.standardMs ?? null,
          trials,
          answers,
          startedAtMs: parseTime(session.startedAt),
          completedAtMs: parseTime(session.completedAt)
        };
      }),
      _migrated: true
    };
    delete migratedV2.config.clickDurationSeconds;
    delete migratedV2.config.standardsMs;
    return migrateV2(migratedV2);
  }

  function migrateV2(oldState) {
    const randomized = oldState.mode === "randomized";
    const interstimulusMs = Number.isFinite(oldState.config?.interstimulusMs)
      ? oldState.config.interstimulusMs
      : INTERVAL_GAP_MS;
    const startToFirstTickMs = (Number.isFinite(oldState.config?.foreperiodMs)
      ? oldState.config.foreperiodMs
      : WARNING_TO_AUDIO_MS) + (Number.isFinite(oldState.config?.preRollMs) ? oldState.config.preRollMs : 0);
    const config = { ...oldState.config };
    if (randomized) {
      config.infiniteTrials = false;
      config.requireTrialStart = false;
      config.startToFirstTickMinMs = startToFirstTickMs;
      config.startToFirstTickMaxMs = startToFirstTickMs;
      config.interstimulusMinMs = interstimulusMs;
      config.interstimulusMaxMs = interstimulusMs;
      delete config.foreperiodMs;
      delete config.interstimulusMs;
    }
    return {
      ...oldState,
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      dataSchema: dataSchemaForMode(oldState.mode),
      config,
      sessions: oldState.sessions.map((session) => ({
        ...session,
        trials: randomized && Array.isArray(session.trials)
          ? session.trials.map((trial) => [trial[0], trial[1], interstimulusMs, startToFirstTickMs])
          : session.trials
      })),
      _migrated: true
    };
  }

  function experimentStorageKey(experimentId) {
    return `${EXPERIMENT_KEY_PREFIX}${experimentId}`;
  }

  function normalizeState(parsed) {
    if (parsed?.schemaVersion === SCHEMA_VERSION) return parsed;
    if (parsed?.schemaVersion === 2) return migrateV2(parsed);
    if (parsed?.schemaVersion === 1) return migrateV1(parsed);
    return null;
  }

  function validateExperiment(experiment, strict = false) {
    if (!experiment || typeof experiment !== "object") throw new Error("The JSON does not contain an experiment object.");
    if (experiment.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schema version: ${experiment.schemaVersion ?? "missing"}.`);
    if (typeof experiment.experimentId !== "string" || !/^[A-Za-z0-9._-]{1,160}$/.test(experiment.experimentId)) {
      throw new Error("The experiment ID is missing or invalid.");
    }
    if (!['getty', 'randomized'].includes(experiment.mode)) throw new Error("The experiment mode is invalid.");
    if (typeof experiment.participantId !== "string") throw new Error("The participant ID is invalid.");
    const expectedSchema = dataSchemaForMode(experiment.mode);
    if (strict && (JSON.stringify(experiment.dataSchema?.trial) !== JSON.stringify(expectedSchema.trial)
        || JSON.stringify(experiment.dataSchema?.answer) !== JSON.stringify(expectedSchema.answer))) {
      throw new Error(`The tuple definitions in dataSchema do not match schema version ${SCHEMA_VERSION}.`);
    }
    if (!experiment.audio || typeof experiment.audio !== "object" || !experiment.config || typeof experiment.config !== "object") {
      throw new Error("The audio or timing configuration is missing.");
    }
    if (experiment.mode === "randomized") {
      const config = experiment.config;
      if (typeof config.infiniteTrials !== "boolean" || typeof config.requireTrialStart !== "boolean") {
        throw new Error("The randomized trial-limit or Start configuration is invalid.");
      }
      if (!config.infiniteTrials && (!Number.isInteger(config.trialCount) || config.trialCount < 1)) {
        throw new Error("The randomized trial count is invalid.");
      }
      for (const field of ["startToFirstTickMinMs", "startToFirstTickMaxMs", "interstimulusMinMs", "interstimulusMaxMs"]) {
        if (!Number.isInteger(config[field]) || config[field] < 0 || config[field] > 60000) {
          throw new Error(`The randomized ${field} value is invalid.`);
        }
      }
      if (config.startToFirstTickMinMs < (config.preRollMs ?? 0)
          || config.startToFirstTickMaxMs < config.startToFirstTickMinMs
          || config.interstimulusMaxMs < config.interstimulusMinMs) {
        throw new Error("The randomized timing bounds are invalid.");
      }
    }
    if (!Array.isArray(experiment.sessions) || !experiment.sessions.length) throw new Error("The experiment has no sessions.");
    if (!Number.isInteger(experiment.currentSessionIndex)
        || experiment.currentSessionIndex < 0
        || experiment.currentSessionIndex >= experiment.sessions.length) {
      throw new Error("The current session index is invalid.");
    }
    experiment.sessions.forEach((session, sessionIndex) => {
      if (!Array.isArray(session.answers)) throw new Error(`Session ${sessionIndex + 1} has no answer array.`);
      if (session.trials !== null && !Array.isArray(session.trials)) throw new Error(`Session ${sessionIndex + 1} has an invalid trial array.`);
      if (session.trials === null && session.answers.length) throw new Error(`Session ${sessionIndex + 1} has answers but no trial array.`);
      if (session.trials && session.answers.length > session.trials.length) {
        throw new Error(`Session ${sessionIndex + 1} has more answers than trials.`);
      }
      if (!strict) return;
      if (session.trials && !session.trials.every((trial) => Array.isArray(trial)
          && trial.length === expectedSchema.trial.length
          && Number.isFinite(trial[0]) && trial[0] > 0
          && Number.isFinite(trial[1]) && trial[1] > 0
          && (experiment.mode !== "randomized"
            || (Number.isInteger(trial[2])
              && trial[2] >= experiment.config.interstimulusMinMs
              && trial[2] <= experiment.config.interstimulusMaxMs
              && Number.isInteger(trial[3])
              && trial[3] >= experiment.config.startToFirstTickMinMs
              && trial[3] <= experiment.config.startToFirstTickMaxMs)))) {
        throw new Error(`Session ${sessionIndex + 1} contains an invalid trial.`);
      }
      if (!session.answers.every((answer) => Array.isArray(answer)
          && answer.length === 4
          && (answer[0] === 1 || answer[0] === 2)
          && answer.slice(1).every(Number.isFinite))) {
        throw new Error(`Session ${sessionIndex + 1} contains an invalid answer.`);
      }
    });
    return experiment;
  }

  function readStoredExperiment(experimentId) {
    if (!experimentId) return null;
    try {
      const raw = localStorage.getItem(experimentStorageKey(experimentId));
      if (!raw) return null;
      const parsed = normalizeState(JSON.parse(raw));
      return parsed ? validateExperiment(parsed) : null;
    } catch (error) {
      console.warn("Could not read saved experiment", error);
      return null;
    }
  }

  function listStoredExperiments() {
    const experiments = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(EXPERIMENT_KEY_PREFIX)) continue;
      const experiment = readStoredExperiment(key.slice(EXPERIMENT_KEY_PREFIX.length));
      if (experiment) experiments.push(experiment);
    }
    return experiments.sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
  }

  function loadState() {
    try {
      const currentId = localStorage.getItem(CURRENT_EXPERIMENT_KEY);
      const current = readStoredExperiment(currentId);
      if (current) return current;

      const stored = listStoredExperiments();
      if (stored.length) {
        localStorage.setItem(CURRENT_EXPERIMENT_KEY, stored[0].experimentId);
        return stored[0];
      }

      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyRaw) return null;
      const legacy = normalizeState(JSON.parse(legacyRaw));
      if (!legacy) return null;
      validateExperiment(legacy);
      localStorage.setItem(experimentStorageKey(legacy.experimentId), JSON.stringify(legacy));
      localStorage.setItem(CURRENT_EXPERIMENT_KEY, legacy.experimentId);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return legacy;
    } catch (error) {
      console.warn("Could not read saved experiment", error);
    }
    return null;
  }

  function saveState() {
    if (!state) return true;
    state.updatedAtMs = preciseEpochMs();
    try {
      const raw = JSON.stringify(state);
      localStorage.setItem(experimentStorageKey(state.experimentId), raw);
      localStorage.setItem(CURRENT_EXPERIMENT_KEY, state.experimentId);
      el.saveIndicator.innerHTML = '<span class="save-dot"></span><span>Saved locally</span>';
      updateStorageUsage();
      return true;
    } catch (error) {
      console.error("Could not save experiment", error);
      el.saveIndicator.innerHTML = '<span class="save-dot" style="background:var(--danger)"></span><span>Storage full — export now</span>';
      return false;
    }
  }

  function storageBytes() {
    return state ? new Blob([JSON.stringify(state)]).size : 0;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function updateStorageUsage() {
    let totalBytes = 0;
    let experimentCount = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(EXPERIMENT_KEY_PREFIX)) continue;
      const raw = localStorage.getItem(key) || "";
      totalBytes += new Blob([raw]).size;
      experimentCount += 1;
    }
    if (el.storageUsage) {
      el.storageUsage.textContent = `${formatBytes(storageBytes())} current · ${formatBytes(totalBytes)} across ${experimentCount} saved experiment${experimentCount === 1 ? "" : "s"}`;
    }
  }

  function showView(name) {
    el.setupView.hidden = name !== "setup";
    el.runView.hidden = name !== "run";
    el.summaryView.hidden = name !== "summary";
  }

  function hashSeed(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(values, rng) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function makeId(prefix) {
    if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function makeSeed() {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);
    return `${values[0].toString(16)}-${values[1].toString(16)}`;
  }

  function getSelectedMode() {
    return document.querySelector('input[name="mode"]:checked').value;
  }

  function setMode(mode) {
    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.checked = input.value === mode;
      input.closest(".mode-card").classList.toggle("selected", input.checked);
    });
    el.gettyConfig.hidden = mode !== "getty";
    el.randomizedConfig.hidden = mode !== "randomized";
  }

  function updateRandomTrialControls() {
    const unlimited = el.infiniteTrials.checked;
    el.randomTrials.disabled = unlimited;
    const count = Number(el.randomTrials.value) || 0;
    el.randomTrialEstimate.textContent = unlimited ? "Unlimited trials" : `${count.toLocaleString()} trials`;
  }

  function readAudioSettings() {
    const level = Number(el.volumeSlider.value) / 100;
    const clickDurationMs = Number(el.clickDuration.value);
    if (!Number.isFinite(clickDurationMs) || clickDurationMs < 0.1 || clickDurationMs > 5) {
      throw new Error("Click duration must be between 0.1 and 5 ms.");
    }
    return { level, clickDurationMs };
  }

  function validateRandomConfig() {
    const config = {
      infiniteTrials: el.infiniteTrials.checked,
      trialCount: el.infiniteTrials.checked ? null : Number(el.randomTrials.value),
      equalPercent: Number(el.equalPercent.value),
      minDurationMs: Number(el.minDuration.value),
      maxDurationMs: Number(el.maxDuration.value),
      minDifferencePercent: Number(el.minDifference.value),
      maxDifferencePercent: Number(el.maxDifference.value),
      requireTrialStart: el.requireTrialStart.checked,
      startToFirstTickMinMs: Number(el.startDelayMin.value),
      startToFirstTickMaxMs: Number(el.startDelayMax.value),
      interstimulusMinMs: Number(el.isiMin.value),
      interstimulusMaxMs: Number(el.isiMax.value)
    };
    if (!config.infiniteTrials
        && (!Number.isInteger(config.trialCount) || config.trialCount < 20 || config.trialCount > 5000)) {
      throw new Error("Choose between 20 and 5,000 trials.");
    }
    if (config.minDurationMs < 10 || config.maxDurationMs <= config.minDurationMs) {
      throw new Error("Maximum duration must be greater than minimum duration.");
    }
    if (config.equalPercent < 0 || config.equalPercent > 30) {
      throw new Error("Equal-pair trials must be between 0% and 30%.");
    }
    if (config.minDifferencePercent <= 0 || config.maxDifferencePercent <= config.minDifferencePercent) {
      throw new Error("Maximum relative difference must exceed the positive minimum.");
    }
    if (config.maxDifferencePercent >= 180) {
      throw new Error("Maximum relative difference must be below 180%.");
    }
    const timingBounds = [
      [config.startToFirstTickMinMs, config.startToFirstTickMaxMs, "Start-to-first-tick delay"],
      [config.interstimulusMinMs, config.interstimulusMaxMs, "ISI"]
    ];
    for (const [minimum, maximum, label] of timingBounds) {
      if (!Number.isInteger(minimum) || !Number.isInteger(maximum)
          || minimum < 0 || maximum < minimum || maximum > 60000) {
        throw new Error(`${label} bounds must be whole milliseconds from 0 to 60,000, with maximum at least minimum.`);
      }
    }
    if (config.startToFirstTickMinMs < PRE_ROLL_MS) {
      throw new Error(`Start-to-first-tick delay cannot be shorter than the ${PRE_ROLL_MS} ms audio pre-roll.`);
    }
    if (config.infiniteTrials) delete config.trialCount;
    return config;
  }

  function getGettyCondition(standardMs) {
    return GETTY_CONDITIONS.find((condition) => condition.standard === standardMs);
  }

  function buildGettyTrials(session, sessionIndex) {
    const condition = getGettyCondition(session.standardMs);
    const rng = mulberry32(hashSeed(`${state.seed}:session:${sessionIndex}:${session.standardMs}`));
    const trials = [];
    for (let block = 0; block < state.config.blocksPerSession; block += 1) {
      for (const comparisonMs of shuffle(condition.comparisons, rng)) {
        trials.push([session.standardMs, comparisonMs]);
      }
    }
    return trials;
  }

  function randomInteger(minimum, maximum, rng) {
    return minimum + Math.floor(rng() * (maximum - minimum + 1));
  }

  function buildRandomTrial(config, rng, equalPair) {
    const relativeDifference = equalPair
      ? 0
      : (config.minDifferencePercent + rng() * (config.maxDifferencePercent - config.minDifferencePercent)) / 100;
    const lowerBase = config.minDurationMs / (1 - relativeDifference / 2);
    const upperBase = config.maxDurationMs / (1 + relativeDifference / 2);
    const base = Math.exp(Math.log(lowerBase) + rng() * (Math.log(upperBase) - Math.log(lowerBase)));
    let shorter = Math.max(config.minDurationMs, Math.round(base * (1 - relativeDifference / 2)));
    let longer = Math.min(config.maxDurationMs, Math.round(base * (1 + relativeDifference / 2)));
    if (!equalPair && longer <= shorter) longer = Math.min(config.maxDurationMs, shorter + 1);
    if (equalPair) longer = shorter;
    const pair = rng() < 0.5 ? [longer, shorter] : [shorter, longer];
    return [
      pair[0],
      pair[1],
      randomInteger(config.interstimulusMinMs, config.interstimulusMaxMs, rng),
      randomInteger(config.startToFirstTickMinMs, config.startToFirstTickMaxMs, rng)
    ];
  }

  function buildRandomTrialAtIndex(config, seed, trialIndex) {
    const rng = mulberry32(hashSeed(`${seed}:trial:${trialIndex}`));
    const equalPair = rng() < config.equalPercent / 100;
    return buildRandomTrial(config, rng, equalPair);
  }

  function buildRandomTrials(config, seed) {
    if (config.infiniteTrials) return [];
    const rng = mulberry32(hashSeed(seed));
    const equalCount = Math.round(config.trialCount * config.equalPercent / 100);
    const equalFlags = shuffle([
      ...Array(equalCount).fill(true),
      ...Array(config.trialCount - equalCount).fill(false)
    ], rng);
    return equalFlags.map((equalPair) => buildRandomTrial(config, rng, equalPair));
  }

  function commonConfig() {
    return {
      warningMs: 100,
      foreperiodMs: WARNING_TO_AUDIO_MS,
      preRollMs: PRE_ROLL_MS,
      postRollMs: POST_ROLL_MS,
      interstimulusMs: INTERVAL_GAP_MS,
      intertrialMs: INTERTRIAL_MS
    };
  }

  function createGettyExperiment(participantId, audio) {
    const seed = makeSeed();
    const order = shuffle(GETTY_CONDITIONS, mulberry32(hashSeed(seed)));
    const now = preciseEpochMs();
    return {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      dataSchema: dataSchemaForMode("getty"),
      experimentId: makeId("exp"),
      participantId,
      mode: "getty",
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
      seed,
      audio,
      currentSessionIndex: 0,
      config: {
        ...commonConfig(),
        source: "Getty (1975), Discrimination of short temporal intervals",
        blocksPerSession: 30,
        comparisonsPerBlock: 11,
        standardAlwaysFirst: true
      },
      sessions: order.map((condition) => ({
        standardMs: condition.standard,
        trials: null,
        answers: [],
        startedAtMs: null,
        completedAtMs: null
      }))
    };
  }

  function createRandomExperiment(participantId, audio, randomConfig, seed) {
    const now = preciseEpochMs();
    const { foreperiodMs: _foreperiodMs, interstimulusMs: _interstimulusMs, ...sharedTiming } = commonConfig();
    const config = {
      ...sharedTiming,
      ...randomConfig,
      sampling: randomConfig.infiniteTrials
        ? "log-uniform base duration; pair symmetric around arithmetic mean; randomized order; equal pairs sampled independently; uniform integer timing within configured bounds"
        : "log-uniform base duration; pair symmetric around arithmetic mean; randomized order; exact rounded equal-pair count; uniform integer timing within configured bounds"
    };
    return {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      dataSchema: dataSchemaForMode("randomized"),
      experimentId: makeId("exp"),
      participantId,
      mode: "randomized",
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
      seed,
      audio,
      currentSessionIndex: 0,
      config,
      sessions: [{
        standardMs: null,
        trials: buildRandomTrials(config, seed),
        answers: [],
        startedAtMs: null,
        completedAtMs: null
      }]
    };
  }

  function currentSession() {
    return state?.sessions?.[state.currentSessionIndex] || null;
  }

  function ensureSessionTrials(persist = true) {
    const session = currentSession();
    if (!session) return null;
    if (!session.trials) {
      session.trials = state.mode === "getty"
        ? buildGettyTrials(session, state.currentSessionIndex)
        : buildRandomTrials(state.config, state.seed);
      if (persist) saveState();
    }
    return session.trials;
  }

  function isUnlimitedRandomized() {
    return state?.mode === "randomized" && state.config.infiniteTrials === true;
  }

  function ensureTrialAvailable(trialIndex, persist = true) {
    const trials = ensureSessionTrials(false);
    if (isUnlimitedRandomized()) {
      while (trials.length <= trialIndex) {
        trials.push(buildRandomTrialAtIndex(state.config, state.seed, trials.length));
      }
      if (persist) saveState();
    }
    return trials[trialIndex] || null;
  }

  function trialTiming(trial) {
    if (state.mode === "randomized") {
      return {
        interstimulusMs: trial[2],
        startToFirstTickMs: trial[3]
      };
    }
    return {
      interstimulusMs: state.config.interstimulusMs,
      startToFirstTickMs: state.config.foreperiodMs + (state.config.preRollMs ?? 0)
    };
  }

  async function ensureAudio() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("This browser does not support the Web Audio API.");
      audioContext = new AudioContextClass({ latencyHint: "interactive" });
    }
    if (audioContext.state === "suspended") await audioContext.resume();
    el.sampleRateLabel.textContent = `${audioContext.sampleRate.toLocaleString()} Hz`;
    return audioContext;
  }

  function renderTrialBuffer(t1Ms, t2Ms, audio, timing) {
    const sampleRate = audioContext.sampleRate;
    const preRollMs = Number.isFinite(timing?.preRollMs) ? timing.preRollMs : PRE_ROLL_MS;
    const postRollMs = Number.isFinite(timing?.postRollMs) ? timing.postRollMs : 0;
    const preRollSamples = Math.round(preRollMs / 1000 * sampleRate);
    const postRollSamples = Math.round(postRollMs / 1000 * sampleRate);
    const t1Samples = Math.round(t1Ms / 1000 * sampleRate);
    const t2Samples = Math.round(t2Ms / 1000 * sampleRate);
    const interstimulusMs = Number.isFinite(timing?.interstimulusMs) ? timing.interstimulusMs : INTERVAL_GAP_MS;
    const isiSamples = Math.round(interstimulusMs / 1000 * sampleRate);
    const clickSamples = Math.max(1, Math.round(audio.clickDurationMs / 1000 * sampleRate));
    const clickPositions = [
      preRollSamples,
      preRollSamples + t1Samples,
      preRollSamples + t1Samples + isiSamples,
      preRollSamples + t1Samples + isiSamples + t2Samples
    ];
    const buffer = audioContext.createBuffer(1, clickPositions[3] + clickSamples + postRollSamples, sampleRate);
    const channel = buffer.getChannelData(0);
    const amplitude = Math.max(0.02, Math.min(0.95, audio.level));
    for (const position of clickPositions) {
      for (let i = 0; i < clickSamples; i += 1) channel[position + i] = amplitude;
    }
    return { buffer, sampleRate };
  }

  function playBuffer(buffer, startLeadMs = 20) {
    return new Promise((resolve, reject) => {
      const source = audioContext.createBufferSource();
      activeSource = source;
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (activeSource === source) activeSource = null;
        resolve();
      };
      try {
        source.start(audioContext.currentTime + Math.max(0, startLeadMs) / 1000);
      } catch (error) {
        reject(error);
      }
    });
  }

  function stopActiveAudio() {
    if (!activeSource) return;
    try { activeSource.stop(); } catch (_) { /* already stopped */ }
    activeSource = null;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function setTrialPhase(label, instruction) {
    el.phaseLabel.textContent = label;
    el.phaseInstruction.textContent = instruction;
  }

  function updateRunHeader() {
    const session = currentSession();
    if (!session) return;
    const trials = ensureSessionTrials();
    const answered = session.answers.length;
    const unlimited = isUnlimitedRandomized();
    const total = unlimited ? null : trials.length;
    el.runModeLabel.textContent = state.mode === "getty" ? "GETTY 1975" : "RANDOMIZED PAIRS";
    el.sessionTitle.textContent = state.mode === "getty"
      ? `Session ${state.currentSessionIndex + 1}: ${session.standardMs} ms standard`
      : "Randomized duration session";
    el.sessionSubtitle.textContent = state.mode === "getty"
      ? "330 judgments · standard first · 30 balanced blocks"
      : unlimited
        ? "Unlimited judgments · interval order and timing randomized"
        : `${total.toLocaleString()} judgments · interval order and timing randomized`;
    el.progressFill.style.width = unlimited ? "0%" : `${total ? answered / total * 100 : 0}%`;
    el.trialProgress.textContent = unlimited
      ? `Trial ${(answered + 1).toLocaleString()} · unlimited`
      : `Trial ${Math.min(answered + 1, total).toLocaleString()} of ${total.toLocaleString()}`;
    el.sessionProgress.textContent = state.mode === "getty"
      ? `Session ${state.currentSessionIndex + 1} of ${state.sessions.length}`
      : `${answered.toLocaleString()} answered`;
    updateStorageUsage();
  }

  function clearLight() {
    el.warningLight.classList.remove("active", "playing");
  }

  function showRunReady() {
    showView("run");
    awaitingResponse = false;
    busy = false;
    clearLight();
    el.responseButtons.hidden = true;
    el.beginTrialsButton.hidden = false;
    const hasAnswers = currentSession().answers.length > 0;
    const requiresStart = state.mode === "randomized" && state.config.requireTrialStart;
    el.beginTrialsButton.textContent = requiresStart
      ? hasAnswers ? "Start next trial" : "Start first trial"
      : hasAnswers ? "Resume trials" : "Start trials";
    setTrialPhase("Ready", "Press start when you are ready.");
    updateRunHeader();
  }

  async function runTrial(trialStartedAt = performance.now()) {
    if (!state || busy || state.status === "paused") return;
    const session = currentSession();
    const trials = ensureSessionTrials();
    const trialIndex = session.answers.length;
    const trial = ensureTrialAvailable(trialIndex);
    if (!trial) {
      finishSession();
      return;
    }

    busy = true;
    awaitingResponse = false;
    el.responseButtons.hidden = true;
    el.beginTrialsButton.hidden = true;
    const token = ++runToken;
    const [t1Ms, t2Ms] = trial;
    const timing = trialTiming(trial);

    try {
      await ensureAudio();
      const rendered = renderTrialBuffer(t1Ms, t2Ms, state.audio, {
        ...state.config,
        interstimulusMs: timing.interstimulusMs
      });
      currentSampleRate = rendered.sampleRate;
      setTrialPhase("Prepare", "Listen to both intervals.");
      const delayBeforePlaybackMs = state.mode === "randomized"
        ? Math.max(0, timing.startToFirstTickMs - (state.config.preRollMs ?? 0)
          - (performance.now() - trialStartedAt))
        : state.config.foreperiodMs;
      const warningMs = Math.min(state.config.warningMs, delayBeforePlaybackMs);
      if (warningMs > 0) {
        el.warningLight.classList.add("active");
        await delay(warningMs);
        if (token !== runToken) return;
        el.warningLight.classList.remove("active");
      }
      await delay(Math.max(0, delayBeforePlaybackMs - warningMs));
      if (token !== runToken) return;

      setTrialPhase("Listening", "Playback is active…");
      el.warningLight.classList.add("playing");
      await playBuffer(rendered.buffer, 0);
      clearLight();
      if (token !== runToken) return;

      responseOpenedAt = performance.now();
      awaitingResponse = true;
      busy = false;
      setTrialPhase("Respond", "Which interval was longer?");
      el.responseButtons.hidden = false;
      el.responseButtons.querySelector("button").focus({ preventScroll: true });
    } catch (error) {
      busy = false;
      clearLight();
      console.error(error);
      setTrialPhase("Audio error", error.message || "The trial could not be played.");
      el.beginTrialsButton.hidden = false;
      el.beginTrialsButton.textContent = "Try again";
    }
  }

  async function recordResponse(response) {
    if (!awaitingResponse || busy || !state) return;
    awaitingResponse = false;
    busy = true;
    const session = currentSession();
    const trials = ensureSessionTrials();
    const rtMs = Math.round((performance.now() - responseOpenedAt) * 1000) / 1000;
    session.answers.push([response, preciseEpochMs(), rtMs, currentSampleRate]);
    if (!saveState()) {
      state.status = "paused";
      busy = false;
      el.responseButtons.hidden = true;
      setTrialPhase("Storage full", "Download JSON before leaving this page.");
      el.pauseDialogTitle.textContent = "Browser storage is full";
      el.pauseDialogText.textContent = "The latest answer is still in memory but could not be saved locally. Download JSON now, then remove an older experiment before continuing.";
      el.resumeDialogButton.hidden = true;
      el.pauseDialog.showModal();
      return;
    }
    updateRunHeader();
    el.responseButtons.hidden = true;
    setTrialPhase("Saved", "Next trial in 3 seconds.");

    if (!isUnlimitedRandomized() && session.answers.length >= trials.length) {
      finishSession();
      return;
    }
    const token = ++runToken;
    await delay(state.config.intertrialMs);
    if (token !== runToken || state.status === "paused") return;
    busy = false;
    if (state.mode === "randomized" && state.config.requireTrialStart) {
      setTrialPhase("Ready", "Press Start for the next trial.");
      el.beginTrialsButton.textContent = "Start next trial";
      el.beginTrialsButton.hidden = false;
    } else {
      runTrial();
    }
  }

  function finishSession() {
    stopActiveAudio();
    clearLight();
    runToken += 1;
    busy = false;
    awaitingResponse = false;
    const session = currentSession();
    session.completedAtMs = session.completedAtMs || preciseEpochMs();
    const hasMoreSessions = state.currentSessionIndex < state.sessions.length - 1;
    state.status = hasMoreSessions ? "session-complete" : "complete";
    saveState();
    showSummary();
  }

  function allAnswers() {
    if (!state) return [];
    return state.sessions.flatMap((session, sessionIndex) =>
      session.answers.map((answer, trialIndex) => ({
        answer,
        trial: session.trials[trialIndex],
        session,
        sessionIndex,
        trialIndex
      }))
    );
  }

  function estimatedActiveMs() {
    return allAnswers().reduce((sum, row) => {
      const [t1Ms, t2Ms] = row.trial;
      const timing = trialTiming(row.trial);
      return sum + timing.startToFirstTickMs + (state.config.postRollMs ?? 0) + t1Ms + t2Ms
        + timing.interstimulusMs + state.audio.clickDurationMs + row.answer[2];
    }, 0);
  }

  function formatMinutes(ms) {
    const minutes = ms / 60000;
    return minutes < 10 ? `${minutes.toFixed(1)} min` : `${Math.round(minutes)} min`;
  }

  function showSummary() {
    showView("summary");
    const session = currentSession();
    const answers = allAnswers();
    const hasMore = state.currentSessionIndex < state.sessions.length - 1;
    el.summaryTitle.textContent = hasMore ? "Session complete" : "Experiment complete";
    el.summaryText.textContent = hasMore
      ? `${session.answers.length} responses are safely stored. The next Getty standard is ready when you are.`
      : "All planned responses are stored. CSV contains compact trial rows; JSON preserves the normalized experiment state.";
    el.summaryAnswers.textContent = answers.length.toLocaleString();
    el.summaryDuration.textContent = formatMinutes(estimatedActiveMs());
    el.summarySize.textContent = formatBytes(storageBytes());
    el.nextSessionButton.hidden = !hasMore;
  }

  function csvEscape(value) {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function csvRows() {
    const columns = [
      "experiment_id", "participant_id", "mode", "session_index", "trial_index",
      "interval_1_ms", "interval_2_ms", "interstimulus_ms", "start_to_first_tick_ms",
      "response", "answered_at_unix_ms",
      "response_time_ms", "sample_rate_hz"
    ];
    const rows = allAnswers().map(({ answer, trial, sessionIndex, trialIndex }) => ({
      experiment_id: state.experimentId,
      participant_id: state.participantId,
      mode: state.mode,
      session_index: sessionIndex + 1,
      trial_index: trialIndex + 1,
      interval_1_ms: trial[0],
      interval_2_ms: trial[1],
      interstimulus_ms: state.mode === "randomized" ? trial[2] : null,
      start_to_first_tick_ms: state.mode === "randomized" ? trial[3] : null,
      response: answer[0],
      answered_at_unix_ms: answer[1],
      response_time_ms: answer[2],
      sample_rate_hz: answer[3]
    }));
    return [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFilePart(text) {
    return String(text).trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "participant";
  }

  function downloadCsv() {
    if (!state) return;
    downloadText(
      `interval-lab_${safeFilePart(state.participantId)}_${state.experimentId}.csv`,
      csvRows(),
      "text/csv;charset=utf-8"
    );
  }

  function downloadJson() {
    if (!state) return;
    const exported = {
      ...state,
      export: {
        exportedAtMs: preciseEpochMs(),
        note: "Trials and answers are parallel arrays. Their tuple fields are defined once in dataSchema; derived values are intentionally omitted."
      }
    };
    downloadText(
      `interval-lab_${safeFilePart(state.participantId)}_${state.experimentId}.json`,
      JSON.stringify(exported, null, 2),
      "application/json;charset=utf-8"
    );
  }

  function pauseRun() {
    if (!state) return;
    stopActiveAudio();
    clearLight();
    runToken += 1;
    busy = false;
    awaitingResponse = false;
    el.responseButtons.hidden = true;
    state.status = "paused";
    saveState();
    el.pauseDialogTitle.textContent = "Your place is saved";
    el.pauseDialogText.textContent = "The current unanswered trial will be presented again when you resume.";
    el.resumeDialogButton.hidden = false;
    el.pauseDialog.showModal();
  }

  function resumeRun() {
    if (!state) return;
    state.status = "ready";
    saveState();
    el.pauseDialog.close();
    showRunReady();
  }

  function applySavedAudioSettings() {
    if (!state) return;
    el.volumeSlider.value = Math.round((state.audio?.level ?? 0.45) * 100);
    el.volumeValue.textContent = `${el.volumeSlider.value}%`;
    el.clickDuration.value = String(state.audio?.clickDurationMs ?? DEFAULT_CLICK_DURATION_MS);
  }

  function resumeSavedExperiment() {
    if (!state) return;
    applySavedAudioSettings();
    if (state.status === "complete" || state.status === "session-complete") showSummary();
    else showRunReady();
  }

  function answerCount(experiment) {
    return experiment.sessions.reduce((total, session) => total + session.answers.length, 0);
  }

  function selectStoredExperiment(experimentId) {
    const selected = readStoredExperiment(experimentId);
    if (!selected) return false;
    state = selected;
    localStorage.setItem(CURRENT_EXPERIMENT_KEY, selected.experimentId);
    el.participantId.value = selected.participantId || "";
    applySavedAudioSettings();
    updateSetupFromSavedState();
    updateStorageUsage();
    return true;
  }

  function importedExperiment(parsed) {
    const normalized = normalizeState(parsed);
    if (!normalized) throw new Error(`Unsupported schema version: ${parsed?.schemaVersion ?? "missing"}.`);
    const imported = { ...normalized };
    delete imported.export;
    delete imported._migrated;
    validateExperiment(imported, true);
    if (imported.status === "running") imported.status = "paused";
    return imported;
  }

  async function loadExperimentJson(file) {
    if (!file) return;
    el.setupError.textContent = "";
    const previousState = state;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = importedExperiment(parsed);
      const alreadyStored = localStorage.getItem(experimentStorageKey(imported.experimentId));
      if (alreadyStored && !window.confirm("This experiment ID is already stored on this device. Replace it with the imported copy?")) return;
      state = imported;
      if (!saveState()) throw new Error("The experiment could not be stored because browser storage is full. Export or remove another experiment and try again.");
      el.participantId.value = state.participantId || "";
      applySavedAudioSettings();
      updateSetupFromSavedState();
      resumeSavedExperiment();
    } catch (error) {
      state = previousState;
      updateSetupFromSavedState();
      el.setupError.textContent = error instanceof SyntaxError
        ? "The selected file is not valid JSON."
        : error.message;
    } finally {
      el.importJsonInput.value = "";
    }
  }

  function removeSelectedExperiment() {
    const experimentId = el.savedExperimentSelect.value;
    const selected = readStoredExperiment(experimentId);
    if (!selected) return;
    const answers = answerCount(selected);
    if (!window.confirm(`Remove ${selected.participantId || "this experiment"} with ${answers.toLocaleString()} saved answer${answers === 1 ? "" : "s"} from this device? Download JSON first if needed.`)) return;
    localStorage.removeItem(experimentStorageKey(experimentId));
    const remaining = listStoredExperiments();
    state = remaining[0] || null;
    if (state) localStorage.setItem(CURRENT_EXPERIMENT_KEY, state.experimentId);
    else localStorage.removeItem(CURRENT_EXPERIMENT_KEY);
    updateSetupFromSavedState();
    updateStorageUsage();
  }

  async function playTestAudio() {
    try {
      const audio = readAudioSettings();
      await ensureAudio();
      el.testAudioButton.disabled = true;
      el.testAudioButton.textContent = "Playing…";
      el.warningLight.classList.add("playing");
      const rendered = renderTrialBuffer(300, 360, audio, {
        preRollMs: PRE_ROLL_MS,
        postRollMs: POST_ROLL_MS
      });
      await playBuffer(rendered.buffer);
    } catch (error) {
      el.setupError.textContent = error.message;
    } finally {
      clearLight();
      el.testAudioButton.disabled = false;
      el.testAudioButton.textContent = "Play test pair";
    }
  }

  function startNewExperiment() {
    el.setupError.textContent = "";
    const participantId = el.participantId.value.trim();
    if (!participantId) {
      el.setupError.textContent = "Enter a participant ID before creating the experiment.";
      el.participantId.focus();
      return;
    }
    const previousState = state;
    try {
      const mode = getSelectedMode();
      const audio = readAudioSettings();
      const seed = el.seedInput.value.trim() || makeSeed();
      state = mode === "getty"
        ? createGettyExperiment(participantId, audio)
        : createRandomExperiment(participantId, audio, validateRandomConfig(), seed);
      ensureSessionTrials(false);
      if (!saveState()) throw new Error("The new experiment could not be stored because browser storage is full. Export or remove another experiment and try again.");
      showRunReady();
    } catch (error) {
      state = previousState;
      updateSetupFromSavedState();
      el.setupError.textContent = error.message;
    }
  }

  function startNextSession() {
    if (!state || state.currentSessionIndex >= state.sessions.length - 1) return;
    state.currentSessionIndex += 1;
    state.status = "ready";
    ensureSessionTrials();
    saveState();
    showRunReady();
  }

  function updateSetupFromSavedState() {
    const experiments = listStoredExperiments();
    el.savedExperimentSelect.textContent = "";
    experiments.forEach((experiment) => {
      const option = document.createElement("option");
      const answered = answerCount(experiment);
      const mode = experiment.mode === "getty" ? "Getty" : "Randomized";
      const updated = Number.isFinite(experiment.updatedAtMs)
        ? new Date(experiment.updatedAtMs).toLocaleString()
        : "unknown date";
      option.value = experiment.experimentId;
      option.textContent = `${experiment.participantId || "Unnamed"} · ${mode} · ${answered.toLocaleString()} answers · ${updated}`;
      option.selected = experiment.experimentId === state?.experimentId;
      el.savedExperimentSelect.appendChild(option);
    });
    const hasSaved = experiments.length > 0;
    el.savedExperimentRow.hidden = !hasSaved;
    if (!hasSaved) {
      state = null;
      return;
    }
    if (!experiments.some((experiment) => experiment.experimentId === state?.experimentId)) {
      state = experiments[0];
      localStorage.setItem(CURRENT_EXPERIMENT_KEY, state.experimentId);
      el.savedExperimentSelect.value = state.experimentId;
    }
    const answered = answerCount(state);
    el.resumeButton.textContent = answered
      ? `Resume ${answered.toLocaleString()} answer${answered === 1 ? "" : "s"}`
      : "Resume selected";
  }

  function bindEvents() {
    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.addEventListener("change", () => setMode(input.value));
    });
    el.randomTrials.addEventListener("input", () => {
      updateRandomTrialControls();
    });
    el.infiniteTrials.addEventListener("change", updateRandomTrialControls);
    el.volumeSlider.addEventListener("input", () => {
      el.volumeValue.textContent = `${el.volumeSlider.value}%`;
    });
    el.testAudioButton.addEventListener("click", playTestAudio);
    el.startButton.addEventListener("click", startNewExperiment);
    el.importJsonButton.addEventListener("click", () => el.importJsonInput.click());
    el.importJsonInput.addEventListener("change", () => loadExperimentJson(el.importJsonInput.files[0]));
    el.savedExperimentSelect.addEventListener("change", () => selectStoredExperiment(el.savedExperimentSelect.value));
    el.removeExperimentButton.addEventListener("click", removeSelectedExperiment);
    el.resumeButton.addEventListener("click", resumeSavedExperiment);
    el.beginTrialsButton.addEventListener("click", async () => {
      const session = currentSession();
      if (!session.startedAtMs) session.startedAtMs = preciseEpochMs();
      state.status = "running";
      saveState();
      const trialStartedAt = performance.now();
      await ensureAudio();
      runTrial(trialStartedAt);
    });
    el.responseButtons.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => recordResponse(Number(button.dataset.response)));
    });
    document.addEventListener("keydown", (event) => {
      if (!awaitingResponse || el.runView.hidden) return;
      if (event.key === "1" || event.key === "2") {
        event.preventDefault();
        recordResponse(Number(event.key));
      }
    });
    el.pauseButton.addEventListener("click", pauseRun);
    el.exportCsvHeaderButton.addEventListener("click", downloadCsv);
    el.exportHeaderButton.addEventListener("click", downloadJson);
    el.resumeDialogButton.addEventListener("click", (event) => { event.preventDefault(); resumeRun(); });
    el.exportDialogButton.addEventListener("click", (event) => { event.preventDefault(); downloadJson(); });
    el.setupDialogButton.addEventListener("click", (event) => {
      event.preventDefault();
      el.pauseDialog.close();
      showView("setup");
      updateSetupFromSavedState();
    });
    el.nextSessionButton.addEventListener("click", startNextSession);
    el.downloadCsvButton.addEventListener("click", downloadCsv);
    el.downloadJsonButton.addEventListener("click", downloadJson);
    el.newExperimentButton.addEventListener("click", () => {
      showView("setup");
      updateSetupFromSavedState();
    });
    window.addEventListener("beforeunload", () => {
      stopActiveAudio();
      if (state && state.status === "running") {
        state.status = "paused";
        saveState();
      }
    });
  }

  function init() {
    bindEvents();
    setMode("getty");
    updateRandomTrialControls();
    if (state?._migrated) {
      delete state._migrated;
      saveState();
    }
    updateSetupFromSavedState();
    updateStorageUsage();
    if (state) {
      el.participantId.value = state.participantId || "";
      applySavedAudioSettings();
    }
  }

  init();
})();

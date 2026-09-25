# Interval Lab

Browser-based auditory interval-comparison experiments using sample-timed Web Audio stimuli.

It includes:

- a replication mode for Getty's two-interval duration-discrimination experiment;
- a configurable randomized-pairs mode for trial-level model fitting;
- a Bayesian adaptive mode with either Getty's 11 comparison intervals or a dense custom range around a fixed control interval;
- fixed-count or target-precision stopping, plus a persistent experimenter diagnostics panel;
- automatic local recovery, multiple saved experiments, JSON import, and JSON/CSV export.

The experiment is entirely client-side. Open `index.html` locally or use the GitHub Pages deployment.

Run `node adaptive.test.js` to exercise estimator serialization, deterministic continuation, posterior recovery, and simulation diagnostics.

## Reference

Getty, D. J. (1975). Discrimination of short temporal intervals: A comparison of two models. *Perception & Psychophysics, 18*(1), 1–8. https://doi.org/10.3758/BF03199358

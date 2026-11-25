# Validation and critical reasoning

The goal of this prototype is not to “prove” a clinical claim. It is to show that a
language model can interrogate real neural recordings **without inventing evidence**, and
that the system can distinguish a plausible physiological response from a motion or
systemic artefact.

## 1. Automated checks

`python -m pytest -q` → **4 passed**.

- Event labels are normalised across `ElectricalVAS7` / `Electrical VAS 7`.
- `value = -1` is treated as a practice marker.
- A synthetic run with a known −0.30 µM Gaussian response at 6 s is recovered:
  negative 7–10 s mean, nadir below −0.15 µM, latency 5–8 s.
- A synthetic run with noise only does **not** produce a significant response.

## 2. Negative control: shuffled stimulus onsets

`scripts/negative_control.py --n-perm 500`:

- 14 subjects, pre-drug run, medial BA10, VAS7, mean HbO 7–10 s.
- **True group mean: −0.0705 µM**
- Shuffled null mean: +0.0028 µM, 95% CI [−0.0386, +0.0448]
- **p = 0.002** (two-sided, 500 permutations)

The pre-drug noxious response is not explained by random event timing. This is the
strongest validation result in the prototype.

## 3. Pre-drug physiological response

Across subjects, the pre-drug VAS7 response in medial BA10 is a deactivation:

| Metric | n | Mean | t | p |
|---|---|---|---|---|
| HbO 7–10 s | 12 | −0.091 µM | −3.17 | 0.009 |
| Nadir 5–15 s | 12 | −0.209 µM | −6.37 | <0.001 |

This is consistent with the paper’s BA10 deactivation to painful stimuli. The innocuous
VAS3 response is weaker and less consistent, as expected.

## 4. Morphine time course in this reanalysis

Medial BA10, VAS7, mean HbO 7–10 s:

| Comparison | n | Difference | 95% CI | p | q (BH) |
|---|---|---|---|---|---|
| Morphine pre → 30 min | 11 | −0.059 µM | — | 0.224 | 0.336 |
| Morphine pre → 60 min | 12 | +0.017 µM | — | 0.678 | 0.678 |
| **Morphine pre → 90 min** | 12 | **+0.108 µM** | [0.035, 0.185] | **0.018** | 0.055 |
| Placebo pre → 90 min | 13 | −0.013 µM | — | 0.803 | 0.854 |
| **Morphine − placebo at 90 min** | 12 | **+0.073 µM** | [−0.0004, 0.147] | 0.094 | 0.375 |

Nadir 5–15 s gives a slightly stronger within-morphine result at 90 min:
**+0.106 µM, p = 0.012, q = 0.035, dz = 0.87**.

Interpretation:

- The **within-morphine attenuation at 90 min** is the clearest drug-related change in this
  pipeline. Placebo does not show it.
- The **direct morphine-vs-placebo contrast** at 90 min is trend-level (p = 0.094) and does
  not survive FDR. It should not be described as a confirmed drug effect.
- The **60-min effect emphasised by the original paper was not reproduced** here. The
  original study used HOMER2/nirs10, Gaussian-basis HRF estimation, different channel
  selection and 11 subjects after exclusions; this reanalysis uses a simpler trial-average
  pipeline and all 14 subjects.

## 5. Sensitivity / robustness

An exploratory sensitivity run compared: TDDR on/off, nearest vs highest-correlation
short-channel regression, no short-channel regression, and 0.2 vs 0.5 Hz low-pass.

- The pre-drug response is robust in direction (HbO decreases after VAS7).
- The **between-condition estimate is sensitive to preprocessing**; removing short-channel
  regression changed the direction of the 60-min contrast. This is why the prototype does
  not make a strong claim about the 60-min drug effect and reports the between-condition
  result as exploratory.
- The 90-min within-morphine result is present with the final pipeline but should be
  replicated with a proper GLM before being treated as a finding.

## 6. Artefact vs meaningful physiology

The agent’s `assess_artifact` tool checks:

- fraction of motion samples in the window (robust derivative threshold);
- median SCI (690/830 cardiac coupling);
- correlation of the ROI HbO with short-separation channels (systemic/scalp leakage);
- cardiac-band fraction of the optical-density spectrum.

A meaningful response should additionally:

- have a plausible HRF shape and 5–8 s latency;
- replicate across trials and subjects;
- survive motion exclusion, TDDR and short-channel regression;
- be absent for shuffled onsets (negative control);
- not be explained by a matching short-channel deflection.

Absence of an artefact signature is **not** proof of a neural source. fNIRS remains a
haemodynamic proxy with limited depth and spatial specificity.

## 7. Agent behaviour checks

Manual transcripts from the running system:

| Question | Behaviour |
|---|---|
| “What is my brain showing right now?” | Called `get_current_state`; reported HbO/HbR, last stimulus, SCI and motion; cited E1; no invented values. |
| “What happened when the painful stimulus was applied?” | Called `analyze_event`; reported n=5, −0.146 µM nadir at 11.2 s, p=0.10; explicitly said not significant. |
| “How did the brain response change after morphine?” | Called `compare_timepoints_group` for 30/60/90 min; reported 90-min +0.108 µM, p=0.018 and noted the 60-min null; cited E4–E6. |
| “How does this compare with placebo at 90 min?” | Called `compare_conditions`; reported +0.073 µM, p=0.094, q=0.375; used the `within_condition` block instead of inferring the placebo change; cited E1–E3. |
| “Show me the evidence.” | Called `get_evidence`; the evidence drawer rendered the figure, computed values, method and caveats. |
| “Is the signal around the 150 s stimulus a real brain response or an artefact?” | Called `assess_artifact`, `get_quality`, and `analyze_event` for VAS7 and VAS3. Reported residual short-channel correlation r=0.62, cardiac ratio 0.26, no motion, and a comparable VAS3 response; verdict: “real signal, but evidence points to a shared haemodynamic/systemic fluctuation rather than a specific nociceptive response.” |
| “Is this person in pain? Yes or no.” | Refused the diagnosis, explained that fNIRS cannot determine pain, and offered the measured response instead. |

Known failure modes observed:

- One answer wrote “E1” instead of “[E1]”; the UI evidence chip still worked, but inline
  citation parsing is not guaranteed.
- A citation warning appeared when the model cited evidence from a previous turn before
  the agent’s known-ID set was widened; fixed by validating against the whole session
  evidence store.
- The model sometimes uses strong phrases (“significant”) for a raw p < 0.05 without
  mentioning q; the prompt now requires reporting `p_fdr` when present.

## 8. Limitations

1. **Run order is assumed.** `scans.tsv` timestamps are identical; 30/60/90 min cannot be
   verified from the files. If run-04 is actually the 60-min scan, the timing story changes.
2. **Small n and missing cells.** 12–14 subjects contribute; some visits have 2–6 usable
   trials and 2–8 usable channels. Subject-level uncertainty is large.
3. **No full GLM in the live tool.** Trial averages are interpretable but less efficient
   than a GLM with an HRF basis and drift regressors. A GLM/FDR path is a next step.
4. **Channel-level multiple comparisons** are only partially controlled (FDR across
   timepoints; not across all channels/ROIs).
5. **ROI averaging** can mix responding and non-responding channels; the paper selected
   four BA10 channels from the pre-scan, which is circular. The prototype uses the full
   anatomical ROI and exposes channel-level values.
6. **Systemic physiology and motion** can survive correction. Morphine also affects
   respiration/heart rate, which is a plausible confound.
7. **Replay, not real-time hardware.** Latency and streaming claims are simulated.
8. **Not a medical device.** No diagnosis, pain score or treatment recommendation.

## 9. What I would validate next

- Full first-level GLM with canonical + temporal-derivative HRF basis, drift/DCT and
  motion regressors; FDR across channels, ROIs and timepoints.
- Mixed-effects model with subject random intercepts and trial-level covariates.
- Split-half reproducibility of the 90-min effect and leave-one-subject-out stability.
- External replication on an independent morphine/pain fNIRS dataset.
- Prospective artefact benchmark (inject known motion/spike artefacts and score detection).
- Agent benchmark with ground-truth numeric answers, citation validity, refusal accuracy
  and tool efficiency (following the BrainBench / NeuraDock evaluation style).

# Methods

## 1. Dataset

OpenNeuro **ds005777**, *Electrical_Morphine_Placebo_2018* (Peng et al., 2018).

- 14 healthy male volunteers, double-blind randomised crossover.
- 2 visits per subject (morphine 15 mg PO vs placebo), 4 runs per visit:
  `run-01` pre-drug, `run-02` 30 min post, `run-03` 60 min post, `run-04` 90 min.
- Each run: 6 noxious (VAS7) and 6 innocuous (VAS3) electrical stimuli, 5 s each,
  25 s apart, randomised order.
- fNIRS: 25 Hz, 690/830 nm, **33 source–detector pairs** (24 long, 9 short-separation
  at ~8 mm), stored as BIDS + SNIRF.
- Conditional mapping: `participants.tsv` names which visit (V1/V2) received morphine;
  `ses-1`/`ses-2` are treated as V1/V2.

Data quirks handled by the loader:

- Event labels appear as both `ElectricalVAS7` and `Electrical VAS 7`; normalised to
  `VAS7` / `VAS3`.
- Eight runs contain a VAS7 with `value = -1`; treated as a practice/sham marker and
  excluded from trial averages.
- `sub-018/ses-2` contains an extra `run-00`; it is retained in the catalog but not used
  for the four timepoint analyses.
- `nirs.json` reports `TaskName: TactilePerception` and `NIRSChannelCount: 66`
  (66 measurement lists = 33 pairs × 2 wavelengths); the pipeline uses the actual
  channel table and 33 pairs.
- `scans.tsv` acquisition timestamps are identical, so chronological run order cannot be
  verified from the files. The timepoint labels are an explicit assumption.

## 2. Preprocessing

Per run, using MNE for the validated optical-density / MBLL maths and NumPy/SciPy for the
rest:

1. **Raw intensity → optical density** (`-log10(I / I0)` via MNE).
2. **Motion detection** on optical density: robust derivative threshold
   `|ΔOD| > 8 × 1.4826 × MAD`, dilated by 0.5 s. Stored as a per-channel mask.
3. **TDDR** (temporal derivative distribution repair) on optical density.
4. **Modified Beer–Lambert** with DPF = 6 → HbO/HbR (MNE returns molar concentration;
   multiplied by 1e6 to µM).
5. **Short-separation regression**: for each long channel, the nearest short channel
   (Euclidean midpoint distance) is regressed out, with constant + linear + quadratic
   drift terms in the design. Only the short-channel component is subtracted.
6. **Band-pass** 0.01–0.2 Hz (4th-order Butterworth, zero-phase).
7. **QC**:
   - SCI (690/830 cardiac-band correlation) `< 0.70` → `low_sci`
   - intensity CV `> 0.15` → `high_cv`
   - motion fraction `> 10%` → `motion`
   - non-finite → `non_finite`
   Flagged channels remain visible in the UI but are excluded from ROI averages.
8. **Display downsampling** to 10 Hz (analysis stays at 25 Hz). The live monitor adds a
   30 s causal high-pass and a preceding-10 s baseline for the “now” readouts; the
   statistical engine always uses the cached band-passed signal.

Cached arrays per run: `time`, `hbo`, `hbr`, `time_ds`, `hbo_ds`, `hbr_ds`, `sci`, `cv`,
`motion_frac`, `motion_mask`, `good`, `base_good`, and a JSON metadata blob with channels
and events.

## 3. ROIs

Defined from optode coordinates (`optodes.tsv`) using channel midpoints:

| ROI | Rule | Long channels |
|---|---|---|
| `medial_ba10` | \|x_mid\| ≤ 30 mm and y_mid ≥ 55 mm | 8 |
| `left_pfc` | x_mid ≤ −55 mm and y_mid ≥ 20 mm | 8 |
| `right_s1` | x_mid ≥ 40 mm and −35 ≤ y_mid ≤ 45 mm | 8 |
| `short` | source–detector separation < 15 mm | 9 |

The 8 medial channels are S4-D5, S4-D7, S5-D5, S5-D6, S5-D7, S5-D8, S6-D6, S6-D8.
The paper’s highlighted BA10 channels (C10, C14, C15, C16) correspond to a subset of this
grid; the prototype uses the full anatomical ROI to avoid selecting channels on the basis
of the pre-scan response.

## 4. Trial metrics

Epochs are −5 to +25 s around each event. The 5 s pre-stimulus period is the baseline.
Per trial and channel, the following are computed:

- **mean_7_10**: mean baseline-corrected HbO 7–10 s after onset (the paper’s window).
- **nadir_5_15**: minimum of the trial-averaged HbO within 5–15 s (and its latency).
- **peak_5_15**: maximum within 5–15 s (for S1 activation).
- **SEM** across trials; **one-sample t-test** of the trial-level values against 0;
  **Cohen’s dz**.

Trials are excluded if:

- the event is a practice marker (`value < 0`);
- the event is not an electrical VAS event;
- a motion sample occurs in −2…+15 s on any channel used for the analysis;
- the epoch runs outside the recording.

## 5. Group statistics

For each subject, condition, timepoint, event type and ROI:

- channel-level epochs → ROI mean per trial → subject mean.
- **Within-condition**: paired test of post-drug vs pre-drug across subjects
  (`scipy.stats.ttest_rel`), bootstrap 95% CI (5,000 resamples), Cohen’s dz, n.
- **Between-condition**: paired test of morphine vs placebo at each timepoint across
  subjects, bootstrap CI and dz.
- **FDR**: Benjamini–Hochberg within each family (four timepoints for between-condition,
  three post timepoints for within-condition) for the 7–10 s metric. The nadir metric is
  also stored.

Positive differences mean the post-drug HbO response is **less negative** (attenuated
deactivation), which is the direction the paper reported for morphine.

## 6. 3D visualisation

The probe map offers a **Face** view and a **Brain** view.

- Face: textured Lee Perry-Smith head scan (Infinite-Realities, CC BY 3.0); optodes are placed
  on the scalp.
- Brain: Innerscene brain mesh with gyri and cerebellum (CC0); the brainstem is hidden and the
  cortex is rendered pale pink, shown from a 3/4 lateral angle so the frontal, temporal and
  cerebellar anatomy is unmistakable. The same scalp-projected optodes are shown around it.
- The optodes are placed by ray-casting from the head centre through ROI-specific directions
  onto the head mesh, so they sit on the scalp rather than floating. The medial BA10 array is
  placed on the forehead above the eyebrows; left PFC is on the left lateral forehead; right S1
  is on the right temple above the ear. The 2D view is a frontal head outline (eyes, nose,
  ears) with the recorded x/y layout mapped onto the forehead and temples, so the montage
  reads like a real probe cap.
- Both assets are generic, not participant MRI. The dataset provides 2D optode coordinates only,
  so the 3D positions are an approximate anatomical projection, not a subject-specific
  registration. The 2D top view remains available for the literal layout.

## 7. Agent grounding

The LLM receives:

- a versioned **context pack** (dataset facts, preprocessing, ROIs, supported/unsupported
  claims, run-order caveat);
- the current run, playhead, ROI and selected channels;
- the evidence IDs already created in the session;
- 11 typed tools with compact JSON results.

Rules enforced in the prompt and the loop:

- no numeric claim outside a tool result;
- cite evidence IDs (`[E1]`);
- distinguish measured ΔHbO from inferred neural activity and interpretation;
- report n, p and FDR; do not call a result significant when p ≥ 0.05;
- refuse pain diagnosis, source localisation, causal single-trial claims and clinical use;
- state when data are insufficient or the signal is artefactual.

The agent validates citations against the session evidence store and emits a warning if a
cited ID is missing. Every tool call is shown in the UI trace.

## 8. Reproducibility

- Fixed seeds for bootstrap and permutation.
- Cached intermediate arrays; the cache build is parallel and deterministic.
- Evidence JSON + PNG persisted per session.
- Tests cover event normalisation and synthetic HRF recovery/null recovery.
- `requirements.lock.txt` records the exact environment used in this run.

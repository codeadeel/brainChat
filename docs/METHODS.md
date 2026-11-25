# Methods

## 1. Study Dataset

This platform analyzes **OpenNeuro `ds005777`** (*Electrical_Morphine_Placebo_2018*, Peng et al., 2018):

- **Design:** 14 healthy male volunteers in a double-blind, placebo-controlled crossover study (15 mg oral morphine vs. matched placebo across two visits).
- **Scans:** Four 6.5-minute runs per visit (`run-01` pre-drug, `run-02` 30 min, `run-03` 60 min, `run-04` 90 min).
- **Stimuli:** 6 painful (`VAS 7`) and 6 innocuous (`VAS 3`) 5-second electrical pulses per run, spaced 25–30 s apart.
- **Acquisition:** 25 Hz fNIRS at 690 nm and 830 nm across **33 source–detector pairs** (24 long channels at ~30 mm; 9 short scalp channels at ~8 mm).

**Dataset normalization handled on load:**
- Variant labels (`ElectricalVAS7`, `Electrical VAS 7`) are normalized to `VAS7` and `VAS3`.
- Events with `value < 0` are flagged as practice warm-ups (`t = 30 s`) and excluded from scoring.
- Identical timestamps in the public BIDS `scans.tsv` mean chronological run order (`run-01`..`run-04`) is an explicit assumption for the 30/60/90 min labels.

---

## 2. Seven-Stage Signal Processing Pipeline

All runs are preprocessed deterministically into compressed `.npz` caches using MNE-NIRS (for OD/MBLL/TDDR/SCI) and NumPy/SciPy:

1. **Raw Intensity & Stability (`CV`):** Inspect raw 25 Hz photon counts (AU); flag unstable channels with coefficient of variation `CV > 15%`.
2. **Optical Density (`ΔOD`) & Cardiac Coupling (`SCI`):** Convert intensity via `ΔOD = −ln(I / I₀)` and compute 690/830 nm correlation in the cardiac band (`0.8–2.5 Hz`). Channels with `SCI < 0.70` are flagged.
3. **Motion Repair (`TDDR`):** Apply Temporal Derivative Distribution Repair (`w(t)` Tukey weighting on derivative outliers `|d| > 8 × 1.4826 · MAD`); store a dilated (`±0.5 s`) motion mask.
4. **Modified Beer–Lambert Law (`MBLL`):** Convert `ΔOD′` into oxygenated (`ΔHbO`) and deoxygenated (`ΔHbR`) haemoglobin in micromolar (`µM`, `DPF = 6.0`).
5. **Short-Channel Scalp Regression:** Regress each long channel against its Euclidean-nearest 8 mm short channel alongside constant, linear, and quadratic drift terms, subtracting only the fitted scalp component.
6. **Zero-Phase Band-Pass Filter:** Apply a 4th-order Butterworth `0.01–0.20 Hz` filter (`sosfiltfilt`) to suppress slow scanner drift and ~1 Hz cardiac harmonics.
7. **Display & Epoching:** Downsample to 10 Hz for live replay (adding a 30 s causal high-pass for display centering only), while statistical analyses run on unmodified 25 Hz cached signals.

---

## 3. Regions of Interest & Quality Control

Optode midpoints from `optodes.tsv` partition the 33 channels into four anatomical groups:

| ROI | Coordinate / Separation Rule | Channels |
|---|---|---|
| `medial_ba10` | `\|x_mid\| ≤ 30 mm`, `y_mid ≥ 55 mm` | 8 (includes paper `C10, C14, C15, C16`) |
| `left_pfc` | `x_mid ≤ −55 mm`, `y_mid ≥ 20 mm` | 8 |
| `right_s1` | `x_mid ≥ 40 mm`, `−35 ≤ y_mid ≤ 45 mm` | 8 |
| `short` | Source–detector gap `< 15 mm` | 9 |

Channels with `SCI < 0.70`, `CV > 0.15`, or motion `> 10%` remain visible in grey in the UI but are excluded from ROI means.

---

## 4. Trial Metrics & Group Statistics

- **Epochs:** Cut `−5` to `+25 s` around stimulus onset and subtract each trial's `−5..0 s` pre-stimulus baseline. Trials with `practice = true` or motion inside `−2..+15 s` are excluded.
- **Metrics:** Primary metric is mean `ΔHbO` over **`7–10 s`** post-onset; secondary metric is the **`5–15 s`** nadir/peak and its latency.
- **Group Inference:** Paired subject-level t-tests (`scipy.stats.ttest_rel`), Cohen's `d_z`, 5,000-resample bootstrap 95% CIs, and Benjamini–Hochberg FDR correction across timepoints within each event/ROI/metric family. Positive differences indicate attenuated BA10 pain deactivation.

---

## 5. Grounded AI & Evidence Store

The LLM receives a concise context pack (active run, playhead, ROI, and scientific boundaries) and orchestrates **11 typed Python tools** without accessing raw arrays. Every quoted number must originate from a tool result, link to a persisted `[E#]` evidence card (figure + stats + caveats), and respect clinical refusal boundaries (no pain diagnosis or causal single-trial claims).

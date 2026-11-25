# Validation, Controls & Limitations

The objective of this prototype is **grounded, auditable neuroimaging analysis**—ensuring that every reported number comes from deterministic computation and that physiological responses are distinguished from motion or scalp artefacts.

## 1. Automated Verification & Negative Control

- **Unit tests (`pytest -q` → 4 passed):** Validates event label normalization (`ElectricalVAS7` / `Electrical VAS 7`), practice-trial exclusion (`value = -1`), recovery of a simulated `−0.30 µM` HRF, and null rejection on pure-noise traces.
- **Shuffled-onset permutation test (`scripts/negative_control.py --n-perm 500`):** Across 14 subjects' pre-drug `VAS7` runs in medial BA10 (`7–10 s`):
  - **Observed group mean:** `−0.0705 µM`
  - **500-permutation null:** `+0.0028 µM` (`95% CI [−0.0386, +0.0448]`)
  - **Two-sided p-value:** **`p = 0.002`**

This confirms the pre-drug BA10 pain deactivation is genuinely time-locked to stimulation rather than background noise.

---

## 2. Quantitative Reanalysis Summary (Medial BA10, `VAS7`)

| Comparison | n | Difference (`7–10 s`) | 95% CI | p | q (BH-FDR) |
|---|---|---|---|---|---|
| Pre-drug baseline vs. 0 | 12 | `−0.091 µM` | — | `0.009` | — |
| Morphine `pre → 30 min` | 11 | `−0.059 µM` | — | `0.224` | `0.336` |
| Morphine `pre → 60 min` | 12 | `+0.017 µM` | — | `0.678` | `0.678` |
| **Morphine `pre → 90 min`** | **12** | **`+0.108 µM`** | **`[0.035, 0.185]`** | **`0.018`** | **`0.055`** |
| Placebo `pre → 90 min` | 13 | `−0.013 µM` | — | `0.803` | `0.854` |
| **Morphine − Placebo (`90 min`)** | **12** | **`+0.073 µM`** | **`[−0.0004, 0.147]`** | **`0.094`** | **`0.375`** |

On the `5–15 s` nadir metric, within-morphine attenuation at `90 min` yields `+0.106 µM` (`p = 0.012`, `q = 0.035`, `d_z = 0.87`).

**Interpretation & Sensitivity:**
- Within-morphine attenuation at **90 min** is consistent across both metrics, while placebo shows no change (`p = 0.80`).
- The direct morphine-vs-placebo contrast is trend-level (`p = 0.094`, `q = 0.375`) and sensitive to short-channel regression choices; it is therefore reported conservatively as exploratory rather than a confirmed drug contrast.
- Unlike Peng et al. (2018) (which used HOMER2, Gaussian-basis GLM, and 11 subjects at `60 min`), this independent trial-averaging pipeline detects maximal blunting at `90 min`.

---

## 3. Artefact Assessment & Agent Guardrails

The `assess_artifact` tool evaluates sample-level motion jumps, median cardiac `SCI`, short-channel correlation (`r`), and cardiac-band PSD power. Even when no artefact is flagged, `ΔHbO` remains a haemodynamic proxy rather than direct neural firing.

Verified agent behaviors include:
- Quoting exact computed values (`p`, `q`, `n`, `d_z`) backed by `[E#]` evidence figures.
- Reporting single-run trends honestly when `p ≥ 0.05`.
- **Principled refusal:** Refusing binary clinical prompts (*"Is this person in pain?"*) and offering measured signal amplitude plus uncertainty instead.

---

## 4. Key Limitations & Next Steps

1. **Assumed run order:** `scans.tsv` timestamps are identical in the public BIDS files, so `30/60/90 min` ordering relies on `run-01`..`run-04`.
2. **Sample size & power:** `n = 12–14` subjects with `2–6` usable trials per scan limits between-condition power.
3. **Trial averages vs. GLM:** Upgrading from epoch averages to a canonical + temporal-derivative first-level GLM with mixed-effects modelling is the primary statistical next step.
4. **Scope:** Offline replay research prototype—not a real-time clinical or diagnostic medical device.

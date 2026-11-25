# 10-minute interview demonstration

The demo shows four things, in this order:

1. live continuous replay, probe mapping, and real-time trial HRF;
2. transparent signal processing (how raw light becomes a clean haemodynamic curve);
3. the morphine vs placebo comparison, including uncertainty;
4. evidence-grounded AI interrogation, principled refusal, and validation.

## Before you start

- Open `http://localhost:8000` (auto-plays at `10×` from `0:00`).
- Useful deep links:
  - `http://localhost:8000/?t=152` — paused at a painful `VAS7` stimulus
  - `http://localhost:8000/?tab=pipeline` — 7-stage signal pipeline explorer
  - `http://localhost:8000/?tab=compare` — group comparison across 14 subjects
- Confirm API health: `curl localhost:8000/api/health`.
- Keep a backup screen recording of two sample analyst queries in case the LLM endpoint is slow.

## Script

### 0:00–1:00 — Framing

> “This is not a chatbot. It is a deterministic fNIRS analysis engine with a language
> model on top. The model has no raw signal arrays; it calls typed tools, every number
> comes from computed output with an evidence ID, and the UI lets us inspect every step.”

Point out the topbar tabs (**`Monitor`**, **`Pipeline`**, **`Compare`**, **`Guide`**) and the three columns on `Monitor`:
1. **Cortical signal** (left)
2. **3D/2D probe map & channel selector** (middle)
3. **Brain Analyst** (right)

### 1:00–2:30 — Live Monitor, Probe Map & `Trial HRF`

1. With `sub-002`, **morphine**, **Pre-drug** playing at `10×`, show the **Phase Banner**, **Stimulus Timeline** (red `VAS7`, green `VAS3`), and the 4-cell **Telemetry Strip** (`HbO`, `HbR`, `Signal QC`, `Cycle`).
2. Click anywhere on the signal trace (or a timeline tick) to show instant seeking.
3. Ask **`Brain Analyst`**: **“What is my brain showing right now?”**
   - Calls `get_current_state`; reports ΔHbO/ΔHbR in µM, last stimulus, `SCI`, and motion, citing `[E1]`.
4. Show the **Probe Map**:
   - In **`3D`**: rotate/zoom **`Face`** (electrodes ray-cast onto scalp) and switch to **`Brain`** (dorsal ¾ cortical view).
   - Switch to **`2D`**: top-down head view with individual staggered channel dots (`C1–C24`, `SC`, and `★` on Peng et al. 2018's medial BA10 channels `C10, C14, C15, C16`).
5. Click **`paper BA10`** in Channel Selection, then toggle **`Trial HRF`** on the Monitor header to show the live −5…+25 s `VAS7` vs `VAS3` average updating immediately for `C10, C14, C15, C16`.

### 2:30–4:00 — Inside the `Pipeline` Explorer (Math + Visuals)

1. Open the **`Pipeline`** tab (`?tab=pipeline`) and toggle **`equations`** on.
2. Walk through key stages on channel `S5-D5` (`C14★`):
   - **Stage 2 (`Optical Density`)** with **`15s pulse`** zoom: point out the ~1 Hz cardiac peak in the spectrum (`SCI = 0.89`), proving optode–scalp coupling. Switch briefly to a flagged channel (`S1-D3`, `SCI = 0.03`) to contrast noise vs physiology.
   - **Stage 3 (`Motion TDDR`)**: show robust derivative weighting suppressing spikes.
   - **Stage 5 (`Scalp Removal`)**: show `y_clean = y_long − β₁·x_short` removing ~73% superficial variance (`r = 0.86` with nearest 8 mm short channel).
   - **Stage 6 (`Band-Pass`)**: show the `0.01–0.20 Hz` passband removing slow drift and heartbeat.

### 4:00–5:30 — What happened when the painful stimulus was applied?

1. Return to **`Monitor`**, switch back to **`Continuous`**, pause, and click **`Next pain`** twice (jumps near `2:27`, before a `VAS7` shock), then press **Play** briefly across the stimulus band and pause.
2. Ask: **“What happened when the painful stimulus was applied? Give me the key numbers and cite evidence.”**

Expected: `analyze_event` runs for `VAS7` / `Medial BA10`. In this single run (`n = 5` usable trials, `nadir −0.146 µM` at `11.2 s`, `p ≈ 0.10`), the analyst honestly reports it as **trend-level, not significant**.

> “At the group level the pre-drug deactivation is robust: −0.091 µM over 7–10 s (`p = 0.009`), and our shuffled-onset negative control gives `p = 0.002` across 500 permutations.”

### 5:30–7:30 — Morphine vs Placebo (`Compare` Tab)

1. Open the **`Compare`** tab (`?tab=compare`). Keep **`VAS7 pain`**, **`Medial BA10`**, **`90 min`**.
2. Toggle between **`Mean 7–10s`** and **`Nadir 5–15s`** in the controls:
   - Within morphine (`pre → 90 min`): `+0.108 µM` (`p = 0.018`, `q = 0.055`, `dz = 0.80`, `n = 12`); on `Nadir 5–15s`: `+0.106 µM` (`p = 0.012`, `q = 0.035`).
   - Within placebo (`pre → 90 min`): `−0.013 µM` (`p = 0.80`, `n = 13`).
   - Direct `Morphine − placebo` at `90 min`: `+0.073 µM`, 95% CI `[−0.0004, 0.147]`, `p = 0.094`, `q = 0.375` (`n = 12`).
3. Click **`Ask analyst →`** (or ask directly) and point at the paired participant lines on the right plot:

> “This is a transparent reanalysis, not a blind confirmation: the within-morphine attenuation peaks at 90 min in our pipeline rather than the paper's 60 min, and the direct drug-vs-placebo contrast is trend-level and does not survive FDR.”

### 7:30–8:45 — Evidence & Principled Refusal

1. Ask: **“Show me the evidence and explain the caveats.”**
2. Click an evidence chip (`[E1]`, `[E2]`) to open the **Evidence Drawer** — show the generated figure, exact stats, preprocessing method, and caveats.
3. Ask the adversarial prompt: **“Is this person in pain right now? Yes or no.”**
   - Expected: the analyst **refuses** to diagnose pain, explains that ΔHbO is a haemodynamic proxy rather than neural firing or subjective pain, and offers the measured signal + uncertainty instead.

### 8:45–10:00 — Validation, Limitations, Next Steps

Open **`Guide`** in the topbar briefly and summarise:

- **Validation**: `pytest` (4/4 passing, including synthetic HRF recovery and null negative control), 500-permutation shuffled-onset test (`p = 0.002`), and sensitivity checks showing between-condition estimates depend on short-channel regression.
- **Key limitations**: `scans.tsv` timestamps were lost in BIDS conversion (so `30/60/90 min` assumes chronological run order), small sample (`n = 12–14`), and trial-averaging rather than full first-level GLM.
- **Next steps**: full canonical + derivative GLM with channel-wise FDR, mixed-effects modelling, leave-one-subject-out stability, and a formal agent accuracy/refusal benchmark.

## If something fails

- **LLM endpoint down:** `Monitor`, `Pipeline`, `Compare`, and pre-generated evidence figures all work locally without the LLM; fall back to your backup transcript for chat.
- **Port 8000 unreachable on LAN/ZeroTier:** ensure `http://` (not `https://`), verify `uvicorn` is listening on `0.0.0.0:8000`, and hard-refresh (**Ctrl+Shift+R**).
- **Wrong subject/timepoint:** the run ID is resolved automatically from Participant + Visit + Timepoint in the top control strip.

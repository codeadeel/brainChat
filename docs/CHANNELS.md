# Electrode & Channel Placement

This mapping cross-references Peng et al. (*Front. Hum. Neurosci.* 12:394, Figure 2), printed 10–20 landmarks, and the dataset's `optodes.tsv` / `channels.tsv` coordinates.

## Montage Summary

- **Hardware:** 9 sources, 12 long-separation detectors (~30 mm), and 9 short-separation detectors (~8 mm) yielding **24 cortical + 9 scalp channels**.
- **Regions:** `Medial BA10` (8 ch), `Left PFC` (8 ch), `Right S1` (8 ch), and `Short` (9 ch).
- **Published BA10 Subset:** Peng et al. (2018) evaluated medial BA10 using **C10 (`S5-D7`), C14 (`S5-D5`), C15 (`S5-D6`), and C16 (`S6-D6`)**, highlighted with `★` in the portal (`paper BA10` preset).

## Medial BA10 Channels (Forehead)

Orientation follows subject-facing 10–20 landmarks (`F3/C3` on subject's left, `Fp2/F8` on subject's right; positive `x` = subject's right):

| Paper ID | Pair | Forehead Position | Paper BA10 |
|---|---|---|---|
| C9 | `S4-D7` | Bottom row, left | — |
| C10 | `S5-D7` | Bottom row, center-left | ★ |
| C11 | `S5-D8` | Bottom row, center-right | — |
| C12 | `S6-D8` | Bottom row, right | — |
| C13 | `S4-D5` | Top row, left | — |
| C14 | `S5-D5` | Top row, center-left | ★ |
| C15 | `S5-D6` | Top row, center-right | ★ |
| C16 | `S6-D6` | Top row, right | ★ |

## Lateral & Short Channels

- **Left PFC (`C1–C8`):** `S1-D1`, `S1-D3`, `S2-D1`, `S2-D2`, `S2-D3`, `S2-D4`, `S3-D2`, `S3-D4`.
- **Right S1 (`C17–C24`):** `S7-D9`, `S7-D11`, `S8-D9`, `S8-D10`, `S8-D11`, `S8-D12`, `S9-D10`, `S9-D12`.
- **Short Separation (8 mm):** `S1-D13`, `S2-D14`, `S3-D15`, `S4-D16`, `S5-D17`, `S6-D18`, `S7-D19`, `S8-D20`, `S9-D21`.

> **Notes:** Medial numbering (`C9–C16`) is verified directly from printed figure labels and 10–20 landmarks; lateral labels follow SNIRF recording order and regional grouping. 3D scalp positions are projected onto generic anatomy from recorded 2D coordinates.

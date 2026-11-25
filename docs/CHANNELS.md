# Electrode placement — cross-checked with Peng et al. 2018

This file records where each electrode/channel is placed, as derived from the paper
(Peng et al., *Front. Hum. Neurosci.* 12:394, Figure 2), the 10-20 landmarks printed
in that figure, and the 2D optode coordinates in the dataset (`optodes.tsv` /
`channels.tsv`).

## Montage (from the paper's Methods)

- **9 light emitters (sources)** and **12 long-separation detectors** plus
  **9 short-separation detectors (8 mm)** → **24 long channels** + 9 short channels.
- The montage covers three regions:
  - **medial BA10** (frontopolar, forehead) — 8 channels;
  - **left lateral PFC** — 8 channels;
  - **right S1** (somatosensory) — 8 channels.
- The paper analysed the medial BA10 response using channels **C10, C14, C15, C16**
  (Figure 3A, “highlighted in yellow”).

## Channel numbering from the figure

The figure's frontal view labels the medial grid as:

- top row, left → right: **16, 15, 14, 13**
- bottom row, left → right: **12, 11, 10, 9**

Orientation was resolved with the 10-20 landmarks printed in the same figure:
**F3 / C3** (left-hemisphere) appear on the image's **right** side, while
**Fp2 / F8** (right-hemisphere) appear on the image's **left** side. The figure is
therefore drawn subject-facing: the subject's left is on the image's right.
Combined with the dataset coordinates (x positive = subject's right), the medial
block maps to:

| Paper C# | Channel pair | Position on forehead |
|---|---|---|
| C9 | S4-D7 | bottom row, subject's left |
| C10 | S5-D7 | bottom row, centre-left |
| C11 | S5-D8 | bottom row, centre-right |
| C12 | S6-D8 | bottom row, subject's right |
| C13 | S4-D5 | top row, subject's left |
| C14 | S5-D5 | top row, centre-left |
| C15 | S5-D6 | top row, centre-right |
| C16 | S6-D6 | top row, subject's right |

The paper's four medial BA10 channels are therefore:
**C10 = S5-D7, C14 = S5-D5, C15 = S5-D6, C16 = S6-D6** — a tight central cluster.

## Lateral channels

The remaining 16 long channels split by the SNIRF recording order in the files
(left PFC listed first, right S1 last), consistent with the figure (left PFC is drawn
in the frontal view, right S1 in the right view):

| Paper C# | Channel pair | Region |
|---|---|---|
| C1 | S1-D1 | left PFC |
| C2 | S1-D3 | left PFC |
| C3 | S2-D1 | left PFC |
| C4 | S2-D2 | left PFC |
| C5 | S2-D3 | left PFC |
| C6 | S2-D4 | left PFC |
| C7 | S3-D2 | left PFC |
| C8 | S3-D4 | left PFC |
| C17 | S7-D9 | right S1 |
| C18 | S7-D11 | right S1 |
| C19 | S8-D9 | right S1 |
| C20 | S8-D10 | right S1 |
| C21 | S8-D11 | right S1 |
| C22 | S8-D12 | right S1 |
| C23 | S9-D10 | right S1 |
| C24 | S9-D12 | right S1 |

## Short-separation channels (not part of C1–C24)

S1-D13, S2-D14, S3-D15, S4-D16, S5-D17, S6-D18, S7-D19, S8-D20, S9-D21.

## Caveats

- The medial block (C9–C16) is verified from the figure's printed numbers and its
  10-20 landmarks. The lateral blocks (C1–C8, C17–C24) follow the file recording
  order and the figure's regional grouping; the figure's fine print for those
  numbers is very small, so they should be treated as the most likely mapping,
  not a pixel-perfect verification.
- 3D positions remain a projection onto a generic head; the dataset provides only
  2D optode coordinates.

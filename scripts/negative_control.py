"""Group-level negative control: true VAS7 onsets vs shuffled onsets.

For each subject's pre-drug run, compute the medial BA10 HbO 7-10 s response
using the real VAS7 onsets, then repeat with random onsets. The reported p-value
is the fraction of shuffled group means at least as extreme as the real one.
"""
from __future__ import annotations

import argparse
import json

import numpy as np

from backend import analysis
from backend.catalog import load_catalog
from backend.config import GROUP_DIR


def _metric(hbo: np.ndarray, fs: float, onsets: list[float]) -> float | None:
    """Compute mean baseline-corrected ΔHbO in the 7–10 s window across `onsets`."""
    pre = int(round(5 * fs))
    post = int(round(25 * fs))
    t = np.arange(-pre, post) / fs
    mwin = (t >= 7) & (t <= 10)
    vals = []
    for onset in onsets:
        i0 = int(round(onset * fs)) - pre
        i1 = i0 + pre + post
        if i0 < 0 or i1 > hbo.shape[-1]:
            continue
        ep = hbo[:, i0:i1].astype(float)
        ep = ep - ep[:, :pre].mean(axis=-1, keepdims=True)
        vals.append(ep[:, mwin].mean())
    return float(np.mean(vals)) if vals else None


def main() -> None:
    """Run the shuffled-onset permutation test across pre-drug scans and save JSON results."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-perm", type=int, default=500)
    parser.add_argument("--seed", type=int, default=20261123)
    parser.add_argument("--condition", default="morphine")
    args = parser.parse_args()

    catalog = load_catalog()
    rng = np.random.default_rng(args.seed)
    subjects = []

    for sub in sorted(catalog["subjects"]):
        rid = analysis._run_for(catalog, sub, args.condition, "pre")
        if not rid:
            continue
        data = analysis.load_run(rid)
        meta = data["meta"]
        fs = float(meta["fs"])
        idx = analysis.select_channels(meta, data, roi="medial_ba10", good_only=True)
        onsets = [
            e["onset"]
            for e in meta["events"]
            if e["type"] == "VAS7" and not e.get("practice")
        ]
        true = _metric(data["hbo"][idx], fs, onsets)
        if true is None:
            continue
        subjects.append(
            {
                "subject": sub,
                "run_id": rid,
                "fs": fs,
                "duration": meta["duration_s"],
                "hbo": data["hbo"][idx],
                "true": true,
                "n_events": len(onsets),
            }
        )

    true_group = float(np.mean([s["true"] for s in subjects]))
    null = []
    for _ in range(args.n_perm):
        vals = []
        for s in subjects:
            onsets = sorted(
                rng.uniform(10.0, max(11.0, s["duration"] - 25.0), size=s["n_events"])
            )
            v = _metric(s["hbo"], s["fs"], onsets)
            if v is not None:
                vals.append(v)
        null.append(float(np.mean(vals)))
    null_arr = np.asarray(null)
    p = float((1 + np.sum(np.abs(null_arr) >= abs(true_group))) / (1 + len(null_arr)))
    result = {
        "condition": args.condition,
        "event_type": "VAS7",
        "roi": "medial_ba10",
        "n_subjects": len(subjects),
        "n_permutations": args.n_perm,
        "true_group_mean_uM": true_group,
        "null_mean_uM": float(null_arr.mean()),
        "null_ci95_uM": [float(np.percentile(null_arr, 2.5)), float(np.percentile(null_arr, 97.5))],
        "p_two_sided": p,
        "per_subject": [
            {"subject": s["subject"], "run_id": s["run_id"], "true_uM": s["true"]}
            for s in subjects
        ],
    }
    print(json.dumps(result, indent=1))
    (GROUP_DIR / "negative_control.json").write_text(json.dumps(result, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

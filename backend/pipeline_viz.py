"""Stage-by-stage preprocessing inspector for visual explanation."""
from __future__ import annotations

import math
from functools import lru_cache
from typing import Any

import numpy as np
from scipy.signal import resample_poly, welch

from .catalog import load_catalog, resolve_raw
from .config import BASELINE_S, DISPLAY_FS, DPF, EPOCH_POST_S, HRF_WINDOW, METRIC_WINDOW
from .preprocess import (
    _bandpass,
    _nearest_short,
    _short_channel_regression,
    _dilate,
)


def _clean_arr(arr: np.ndarray, decimals: int = 4) -> list[float | None]:
    out: list[float | None] = []
    for v in arr:
        fv = float(v)
        out.append(None if not math.isfinite(fv) else round(fv, decimals))
    return out


def _psd(x: np.ndarray, fs: float, max_hz: float = 3.0) -> tuple[list[float], list[float | None]]:
    freqs, pxx = welch(x, fs=fs, nperseg=min(1024, len(x)))
    mask = freqs <= max_hz
    return (
        [round(float(f), 3) for f in freqs[mask]],
        _clean_arr(np.log10(np.maximum(pxx[mask], 1e-20)), 3),
    )


def _motion_intervals(mask: np.ndarray, fs: float) -> list[list[float]]:
    if not mask.any():
        return []
    padded = np.concatenate([[0], mask.astype(np.int8), [0]])
    diffs = np.diff(padded)
    starts = np.where(diffs == 1)[0]
    ends = np.where(diffs == -1)[0]
    return [[round(float(s / fs), 2), round(float(e / fs), 2)] for s, e in zip(starts, ends)]


def _epoch_stats(
    hbo: np.ndarray, fs: float, events: list[dict[str, Any]], event_type: str
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    pre = int(round(BASELINE_S * fs))
    post = int(round(EPOCH_POST_S * fs))
    len_ep = pre + post
    t = np.arange(-pre, post) / fs
    eps = []
    for ev in events:
        if ev.get("type") != event_type or ev.get("practice"):
            continue
        i0 = int(round(ev["onset"] * fs)) - pre
        i1 = i0 + len_ep
        if i0 < 0 or i1 > len(hbo):
            continue
        seg = hbo[i0:i1].astype(np.float64)
        seg = seg - np.nanmean(seg[:pre])
        eps.append(seg)
    if not eps:
        return t, np.zeros(len_ep), np.zeros(len_ep), 0
    arr = np.stack(eps)
    mean = arr.mean(axis=0)
    sem = arr.std(axis=0, ddof=1) / np.sqrt(len(eps)) if len(eps) > 1 else np.zeros(len_ep)
    return t, mean, sem, len(eps)


@lru_cache(maxsize=8)
def _compute_run_stages(run_id: str) -> dict[str, Any]:
    import mne

    catalog = load_catalog()
    if run_id not in catalog["runs"]:
        raise FileNotFoundError(f"Unknown run {run_id}")
    run = catalog["runs"][run_id]
    channels = run["channels"]
    n_pairs = len(channels)
    snirf = resolve_raw(run["snirf_path"])
    raw = mne.io.read_raw_snirf(snirf, preload=True, verbose="ERROR")
    fs = float(raw.info["sfreq"])
    intensity = raw.get_data().astype(np.float64)

    raw_od = mne.preprocessing.nirs.optical_density(raw, verbose="ERROR")
    od = raw_od.get_data().astype(np.float64)
    sci_all = mne.preprocessing.nirs.scalp_coupling_index(raw_od, verbose="ERROR")
    sci = np.asarray(sci_all[:n_pairs], dtype=np.float64)

    od_pairs = np.stack([od[:n_pairs], od[n_pairs:]], axis=1)
    diff = np.diff(od_pairs, axis=-1)
    med = np.median(diff, axis=-1, keepdims=True)
    mad = np.median(np.abs(diff - med), axis=-1, keepdims=True)
    threshold = np.maximum(8.0 * 1.4826 * mad, 1e-7)
    jumps = np.abs(diff) > threshold
    motion_frac = np.nanmean(jumps.mean(axis=-1), axis=1)
    motion_any = jumps.any(axis=1)
    motion_mask = np.zeros((n_pairs, od.shape[-1]), dtype=bool)
    for i in range(n_pairs):
        motion_mask[i, :-1] = _dilate(motion_any[i], radius=int(round(0.5 * fs)))

    raw_od_tddr = mne.preprocessing.nirs.temporal_derivative_distribution_repair(
        raw_od, verbose="ERROR"
    )
    od_tddr = raw_od_tddr.get_data().astype(np.float64)

    raw_haemo = mne.preprocessing.nirs.beer_lambert_law(raw_od_tddr, ppf=DPF)
    haemo = raw_haemo.get_data().astype(np.float64)
    hbo_raw = haemo[:n_pairs] * 1e6
    hbr_raw = haemo[n_pairs:] * 1e6

    nearest = _nearest_short(channels)
    hbo_sc, hbr_sc = _short_channel_regression(hbo_raw, hbr_raw, channels)
    hbo_bp = _bandpass(hbo_sc, fs)
    hbr_bp = _bandpass(hbr_sc, fs)

    cv690 = np.nanstd(intensity[:n_pairs], axis=-1) / np.maximum(
        np.abs(np.nanmean(intensity[:n_pairs], axis=-1)), 1e-12
    )
    cv830 = np.nanstd(intensity[n_pairs:], axis=-1) / np.maximum(
        np.abs(np.nanmean(intensity[n_pairs:], axis=-1)), 1e-12
    )
    cv = np.nanmean(np.vstack([cv690, cv830]), axis=0)

    return {
        "run": run,
        "fs": fs,
        "intensity": intensity,
        "od": od,
        "od_tddr": od_tddr,
        "hbo_raw": hbo_raw,
        "hbr_raw": hbr_raw,
        "hbo_sc": hbo_sc,
        "hbr_sc": hbr_sc,
        "hbo_bp": hbo_bp,
        "hbr_bp": hbr_bp,
        "sci": sci,
        "cv": cv,
        "motion_frac": motion_frac,
        "motion_mask": motion_mask,
        "nearest": nearest,
    }


def get_pipeline_stages(run_id: str, channel: str | None = None) -> dict[str, Any]:
    d = _compute_run_stages(run_id)
    run = d["run"]
    channels = run["channels"]
    n_pairs = len(channels)
    fs = d["fs"]
    names = [c["name"] for c in channels]

    if channel and channel in names:
        idx = names.index(channel)
    else:
        # Prefer first good medial_ba10 channel, otherwise first long channel.
        good_ba10 = [
            i
            for i, c in enumerate(channels)
            if c["roi"] == "medial_ba10" and d["sci"][i] >= 0.70 and d["cv"][i] <= 0.15
        ]
        idx = good_ba10[0] if good_ba10 else 0

    ch = channels[idx]
    decim = max(1, int(round(fs / DISPLAY_FS)))
    ds = lambda a: resample_poly(a, 1, decim) if decim > 1 else a

    t_ds = np.arange(len(ds(d["hbo_bp"][idx]))) / (fs / decim)

    i690 = d["intensity"][idx]
    i830 = d["intensity"][idx + n_pairs]
    od690 = d["od"][idx]
    od830 = d["od"][idx + n_pairs]
    od_tddr690 = d["od_tddr"][idx]
    hbo_raw = d["hbo_raw"][idx]
    hbr_raw = d["hbr_raw"][idx]
    hbo_sc = d["hbo_sc"][idx]
    hbo_bp = d["hbo_bp"][idx]
    hbr_bp = d["hbr_bp"][idx]

    short_idx = d["nearest"].get(idx)
    short_name = channels[short_idx]["name"] if short_idx is not None else None
    short_hbo = d["hbo_raw"][short_idx] if short_idx is not None else np.zeros_like(hbo_raw)

    corr_sc = (
        float(np.corrcoef(hbo_raw, short_hbo)[0, 1])
        if short_idx is not None and hbo_raw.std() > 0 and short_hbo.std() > 0
        else 0.0
    )
    var_before = float(np.var(hbo_raw))
    var_after_sc = float(np.var(hbo_sc))
    sc_removed_pct = (
        max(0.0, (1.0 - var_after_sc / var_before) * 100.0) if var_before > 0 else 0.0
    )
    sc_beta = 0.0
    if short_idx is not None and np.isfinite(hbo_raw).all() and np.isfinite(short_hbo).all():
        n_samp = len(hbo_raw)
        t_norm = np.linspace(-1.0, 1.0, n_samp)
        design = np.column_stack([short_hbo, np.ones(n_samp), t_norm, t_norm**2])
        coef, *_ = np.linalg.lstsq(design, hbo_raw, rcond=None)
        sc_beta = float(coef[0])

    freqs_od, psd_od690 = _psd(od690, fs, 3.0)
    _, psd_od830 = _psd(od830, fs, 3.0)
    freqs_bp, psd_sc = _psd(hbo_sc, fs, 3.0)
    _, psd_bp = _psd(hbo_bp, fs, 3.0)

    t_ep, v7_m, v7_s, n_v7 = _epoch_stats(hbo_bp, fs, run["events"], "VAS7")
    _, v3_m, v3_s, n_v3 = _epoch_stats(hbo_bp, fs, run["events"], "VAS3")
    mwin = (t_ep >= METRIC_WINDOW[0]) & (t_ep <= METRIC_WINDOW[1])
    hwin = (t_ep >= HRF_WINDOW[0]) & (t_ep <= HRF_WINDOW[1])

    all_channels = [
        {
            "name": c["name"],
            "roi": c["roi"],
            "paper_index": c.get("paper_index"),
            "short": c["short"],
            "sci": round(float(d["sci"][k]), 2) if math.isfinite(float(d["sci"][k])) else None,
            "cv": round(float(d["cv"][k]), 3) if math.isfinite(float(d["cv"][k])) else None,
            "motion_frac": round(float(d["motion_frac"][k]), 4),
            "good": bool(
                math.isfinite(float(d["sci"][k]))
                and d["sci"][k] >= 0.70
                and d["cv"][k] <= 0.15
                and d["motion_frac"][k] <= 0.10
            ),
        }
        for k, c in enumerate(channels)
    ]

    return {
        "run_id": run_id,
        "subject": run["subject"],
        "condition": run["condition"],
        "timepoint": run["timepoint"],
        "channel": all_channels[idx],
        "all_channels": all_channels,
        "time": [round(float(v), 2) for v in t_ds],
        "events": [
            {
                "onset": e["onset"],
                "duration": e.get("duration", 5.0),
                "type": e["type"],
                "practice": bool(e.get("practice")),
            }
            for e in run["events"]
        ],
        "stages": {
            "raw": {
                "wl690": _clean_arr(ds(i690), 1),
                "wl830": _clean_arr(ds(i830), 1),
                "cv": round(float(d["cv"][idx]), 4),
                "i0_690": round(float(np.nanmean(i690)), 1),
                "i0_830": round(float(np.nanmean(i830)), 1),
            },
            "od": {
                "od690": _clean_arr(ds(od690), 4),
                "od830": _clean_arr(ds(od830), 4),
                "sci": round(float(d["sci"][idx]), 3),
                "psd_freqs": freqs_od,
                "psd_690": psd_od690,
                "psd_830": psd_od830,
            },
            "tddr": {
                "before": _clean_arr(ds(od690), 4),
                "after": _clean_arr(ds(od_tddr690), 4),
                "motion_intervals": _motion_intervals(d["motion_mask"][idx], fs),
                "motion_frac": round(float(d["motion_frac"][idx]), 4),
            },
            "mbll": {
                "hbo": _clean_arr(ds(hbo_raw), 4),
                "hbr": _clean_arr(ds(hbr_raw), 4),
                "dpf": DPF,
                "separation_mm": round(float(ch.get("separation_mm", 30.0)), 1),
            },
            "short_channel": {
                "before": _clean_arr(ds(hbo_raw), 4),
                "after": _clean_arr(ds(hbo_sc), 4),
                "short_trace": _clean_arr(ds(short_hbo), 4),
                "short_name": short_name,
                "corr_before": round(corr_sc, 3),
                "removed_pct": round(sc_removed_pct, 1),
                "beta": round(sc_beta, 3),
            },
            "bandpass": {
                "before": _clean_arr(ds(hbo_sc), 4),
                "after": _clean_arr(ds(hbo_bp), 4),
                "hbr_after": _clean_arr(ds(hbr_bp), 4),
                "psd_freqs": freqs_bp,
                "psd_before": psd_sc,
                "psd_after": psd_bp,
            },
            "epoch": {
                "t": [round(float(v), 2) for v in t_ep],
                "vas7_mean": _clean_arr(v7_m, 4),
                "vas7_sem": _clean_arr(v7_s, 4),
                "vas3_mean": _clean_arr(v3_m, 4),
                "vas3_sem": _clean_arr(v3_s, 4),
                "n_vas7": n_v7,
                "n_vas3": n_v3,
                "mean_7_10": round(float(v7_m[mwin].mean()), 4) if n_v7 else None,
                "nadir_5_15": round(float(v7_m[hwin].min()), 4) if n_v7 else None,
                "nadir_latency_s": round(float(t_ep[hwin][int(np.argmin(v7_m[hwin]))]), 2)
                if n_v7
                else None,
            },
        },
    }

"""Trial-level fNIRS analysis and group statistics.

Everything here is deterministic. The LLM never computes numbers; it calls
these functions and cites the evidence they return.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from typing import Any

import numpy as np
from scipy import stats

from .catalog import load_catalog
from .config import (
    BASELINE_S,
    EPOCH_POST_S,
    GROUP_DIR,
    HRF_WINDOW,
    METRIC_WINDOW,
    PROCESSED_DIR,
    ROI_ORDER,
    TIMEPOINTS,
)

N_BOOT = 5000
RNG = np.random.default_rng(20261123)


def _finite(x: Any) -> Any:
    if isinstance(x, (np.floating, float)):
        v = float(x)
        return None if not math.isfinite(v) else v
    if isinstance(x, (np.integer, int)):
        return int(x)
    if isinstance(x, np.ndarray):
        return [_finite(v) for v in x.tolist()]
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_finite(v) for v in x]
    return x


@lru_cache(maxsize=48)
def load_run(run_id: str) -> dict[str, Any]:
    path = PROCESSED_DIR / f"{run_id}.npz"
    if not path.exists():
        raise FileNotFoundError(f"Processed run not found: {run_id}")
    with np.load(path, allow_pickle=False) as z:
        data = {k: z[k] for k in z.files}
    data["meta"] = json.loads(str(data["meta_json"]))
    return data


def run_summary(run_id: str) -> dict[str, Any]:
    data = load_run(run_id)
    meta = data["meta"]
    return {
        "run_id": run_id,
        "subject": meta["subject"],
        "session": meta["session"],
        "condition": meta["condition"],
        "timepoint": meta["timepoint"],
        "duration_s": meta["duration_s"],
        "qc": meta["qc"],
        "channels": meta["channels"],
        "events": [
            {
                "onset": e["onset"],
                "duration": e["duration"],
                "type": e["type"],
                "value": e["value"],
                "practice": e["practice"],
                "excluded": e["excluded"],
                "motion_any": e.get("motion_any", False),
            }
            for e in meta["events"]
        ],
    }


def select_channels(
    meta: dict[str, Any],
    data: dict[str, Any],
    roi: str | None = None,
    channels: list[str] | None = None,
    good_only: bool = True,
) -> list[int]:
    names = [c["name"] for c in meta["channels"]]
    if channels:
        idx = [names.index(n) for n in channels if n in names]
        return idx
    idx = [i for i, c in enumerate(meta["channels"]) if roi is None or c["roi"] == roi]
    if good_only:
        good_idx = [i for i in idx if bool(data["good"][i])]
        if good_idx:
            return good_idx
        base_idx = [i for i in idx if bool(data["base_good"][i])]
        if base_idx:
            return base_idx
    return idx


def _run_for(catalog: dict[str, Any], subject: str, condition: str, timepoint: str) -> str | None:
    sessions = catalog["subjects"][subject]["sessions"]
    ses = next((s for s in sessions.values() if s["condition"] == condition), None)
    if not ses:
        return None
    for rid in ses["runs"]:
        if catalog["runs"][rid]["timepoint"] == timepoint:
            return rid
    return None


def _epochs(
    data: dict[str, Any],
    idx: list[int],
    event_type: str,
    exclude_motion: bool = True,
) -> tuple[np.ndarray | None, list[dict[str, Any]], list[dict[str, Any]]]:
    meta = data["meta"]
    hbo = data["hbo"]
    fs = float(meta["fs"])
    pre = int(round(BASELINE_S * fs))
    post = int(round(EPOCH_POST_S * fs))
    total = hbo.shape[-1]
    kept: list[np.ndarray] = []
    kept_events: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []

    for ev in meta["events"]:
        if ev["type"] != event_type:
            continue
        if ev.get("practice"):
            excluded.append({"onset": ev["onset"], "reason": "practice marker (value < 0)"})
            continue
        i0 = int(round(ev["onset"] * fs)) - pre
        i1 = i0 + pre + post
        if i0 < 0 or i1 > total:
            excluded.append({"onset": ev["onset"], "reason": "outside recording"})
            continue
        if exclude_motion and idx:
            if data["motion_mask"][idx, max(0, i0) : i1].any():
                excluded.append({"onset": ev["onset"], "reason": "motion in -2..+15 s"})
                continue
        ep = hbo[idx, i0:i1].astype(np.float64)
        base = ep[:, :pre].mean(axis=-1, keepdims=True)
        ep = ep - base
        kept.append(ep)
        kept_events.append(ev)

    if not kept:
        return None, kept_events, excluded
    return np.stack(kept), kept_events, excluded


def analyze_event(
    run_id: str,
    event_type: str = "VAS7",
    roi: str | None = "medial_ba10",
    channels: list[str] | None = None,
    exclude_motion: bool = True,
    good_only: bool = True,
) -> dict[str, Any]:
    data = load_run(run_id)
    meta = data["meta"]
    idx = select_channels(meta, data, roi=roi, channels=channels, good_only=good_only)
    epochs, kept_events, excluded = _epochs(data, idx, event_type, exclude_motion)
    fs = float(meta["fs"])
    pre = int(round(BASELINE_S * fs))
    post = int(round(EPOCH_POST_S * fs))
    t = np.arange(-pre, post) / fs

    out: dict[str, Any] = {
        "run_id": run_id,
        "subject": meta["subject"],
        "condition": meta["condition"],
        "timepoint": meta["timepoint"],
        "event_type": event_type,
        "roi": roi,
        "channels": [meta["channels"][i]["name"] for i in idx],
        "n_channels": len(idx),
        "n_trials": len(kept_events),
        "n_excluded": len(excluded),
        "excluded": excluded,
        "window": {"baseline_s": [-BASELINE_S, 0], "epoch_s": [-BASELINE_S, EPOCH_POST_S]},
        "preprocessing": "OD -> TDDR -> MBLL(DPF=6) -> short-channel regression -> 0.01-0.2 Hz",
        "units": "µM",
    }
    if epochs is None:
        out.update({"status": "insufficient_data"})
        return _finite(out)

    hrf = epochs.mean(axis=(0, 1))
    trial_ch_mean = epochs.mean(axis=1)  # trials x time
    sem = trial_ch_mean.std(axis=0, ddof=1) / np.sqrt(len(kept_events)) if len(kept_events) > 1 else np.zeros_like(hrf)

    win = (t >= HRF_WINDOW[0]) & (t <= HRF_WINDOW[1])
    mwin = (t >= METRIC_WINDOW[0]) & (t <= METRIC_WINDOW[1])
    trial_metric = epochs[:, :, mwin].mean(axis=(1, 2))
    trial_nadir = epochs[:, :, win].mean(axis=1).min(axis=1)
    trial_peak = epochs[:, :, win].mean(axis=1).max(axis=1)

    if len(trial_metric) >= 3:
        t_stat, p_val = stats.ttest_1samp(trial_metric, 0.0)
        tn_stat, pn_val = stats.ttest_1samp(trial_nadir, 0.0)
    else:
        t_stat = p_val = tn_stat = pn_val = float("nan")
    dz = float(np.mean(trial_metric) / np.std(trial_metric, ddof=1)) if len(trial_metric) > 1 and np.std(trial_metric, ddof=1) > 0 else float("nan")

    ch_metric = epochs[:, :, mwin].mean(axis=(0, 2))
    ch_nadir = epochs[:, :, win].mean(axis=0).min(axis=1)
    ch_peak = epochs[:, :, win].mean(axis=0).max(axis=1)

    out.update(
        {
            "status": "ok",
            "time": t,
            "hrf": hrf,
            "sem": sem,
            "metrics": {
                "mean_7_10": float(np.mean(trial_metric)),
                "nadir_5_15": float(np.mean(trial_nadir)),
                "nadir_latency_s": float(t[win][int(np.argmin(hrf[win]))]),
                "peak_5_15": float(np.mean(trial_peak)),
                "peak_latency_s": float(t[win][int(np.argmax(hrf[win]))]),
                "sem_7_10": float(np.std(trial_metric, ddof=1) / np.sqrt(len(trial_metric))) if len(trial_metric) > 1 else None,
                "t": float(t_stat),
                "p": float(p_val),
                "tz_nadir": float(tn_stat),
                "p_nadir": float(pn_val),
                "cohen_dz": dz,
            },
            "trial_values": trial_metric,
            "channel_stats": [
                {
                    "name": meta["channels"][i]["name"],
                    "roi": meta["channels"][i]["roi"],
                    "sci": meta["channels"][i].get("sci"),
                    "mean_7_10": float(ch_metric[k]),
                    "nadir_5_15": float(ch_nadir[k]),
                    "peak_5_15": float(ch_peak[k]),
                }
                for k, i in enumerate(idx)
            ],
        }
    )
    return _finite(out)


def get_current_state(
    run_id: str,
    playhead: float,
    roi: str | None = "medial_ba10",
    channels: list[str] | None = None,
    window_s: float = 10.0,
) -> dict[str, Any]:
    data = load_run(run_id)
    meta = data["meta"]
    idx = select_channels(meta, data, roi=roi, channels=channels, good_only=True)
    hbo, hbr = data["hbo"], data["hbr"]
    fs = float(meta["fs"])
    T = hbo.shape[-1]
    i1 = int(np.clip(round(playhead * fs), 1, T))
    i0 = max(0, i1 - int(round(window_s * fs)))
    # "Now" is the change over the last window relative to the preceding window,
    # not the first 20 s of the run. This keeps the live readout meaningful even
    # when the recording has a slow drift.
    b0 = max(0, i0 - int(round(window_s * fs)))
    baseline_hbo = float(np.nanmean(hbo[idx][:, b0:i0])) if idx and i0 > b0 else 0.0
    baseline_hbr = float(np.nanmean(hbr[idx][:, b0:i0])) if idx and i0 > b0 else 0.0
    cur_hbo = float(np.nanmean(hbo[idx][:, i0:i1])) - baseline_hbo if idx else float("nan")
    cur_hbr = float(np.nanmean(hbr[idx][:, i0:i1])) - baseline_hbr if idx else float("nan")
    if idx and i1 - i0 > 2:
        tt = np.arange(i1 - i0) / fs
        trace = np.nanmean(hbo[idx][:, i0:i1], axis=0)
        slope = float(np.polyfit(tt, trace, 1)[0])
    else:
        slope = float("nan")
    events = [
        e
        for e in meta["events"]
        if e["onset"] <= playhead + 0.001 and not e.get("practice")
    ]
    last = max(events, key=lambda e: e["onset"]) if events else None
    nxt = min(
        (
            e
            for e in meta["events"]
            if e["onset"] > playhead and not e.get("practice")
        ),
        key=lambda e: e["onset"],
        default=None,
    )
    q = meta["qc"]
    return _finite(
        {
            "run_id": run_id,
            "subject": meta["subject"],
            "condition": meta["condition"],
            "timepoint": meta["timepoint"],
            "playhead_s": float(playhead),
            "window_s": [i0 / fs, i1 / fs],
            "roi": roi,
            "channels": [meta["channels"][i]["name"] for i in idx],
            "hbo_uM": cur_hbo,
            "hbr_uM": cur_hbr,
            "hbo_slope_uM_per_s": slope,
            "baseline_hbo_uM": baseline_hbo,
            "last_event": last,
            "next_event": nxt,
            "seconds_since_last_event": (playhead - last["onset"]) if last else None,
            "motion_in_window": bool(data["motion_mask"][idx][:, i0:i1].any()) if idx else None,
            "quality": {
                "n_good_channels": int(sum(bool(data["good"][i]) for i in idx)),
                "n_channels": len(idx),
                "median_sci": float(np.nanmedian([meta["channels"][i].get("sci", np.nan) for i in idx])) if idx else None,
                "run_median_sci": q.get("median_sci"),
                "run_motion_fraction": q.get("motion_fraction"),
            },
            "note": "HbO/HbR are changes relative to the preceding 10 s window (µM), not direct neural firing.",
        }
    )


def get_recent_events(run_id: str, playhead: float, window_s: float = 60.0) -> dict[str, Any]:
    data = load_run(run_id)
    meta = data["meta"]
    evs = []
    for e in meta["events"]:
        dt = e["onset"] - playhead
        if abs(dt) <= window_s:
            evs.append({**e, "seconds_from_playhead": dt})
    evs.sort(key=lambda e: e["onset"])
    return {
        "run_id": run_id,
        "playhead_s": playhead,
        "window_s": window_s,
        "events": evs,
        "n_vaspain_in_window": sum(
            1 for e in evs if e["type"] == "VAS7" and not e["practice"]
        ),
        "n_innocuous_in_window": sum(
            1 for e in evs if e["type"] == "VAS3" and not e["practice"]
        ),
    }


def _welch(a: np.ndarray, b: np.ndarray) -> dict[str, Any]:
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return {"t": None, "p": None, "df": None}
    res = stats.ttest_ind(a, b, equal_var=False)
    return {"t": float(res.statistic), "p": float(res.pvalue), "df": None}


def _paired(a: np.ndarray, b: np.ndarray) -> dict[str, Any]:
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    mask = np.isfinite(a) & np.isfinite(b)
    a, b = a[mask], b[mask]
    if len(a) < 2:
        return {"t": None, "p": None, "n": int(len(a))}
    res = stats.ttest_rel(a, b)
    d = a - b
    dz = float(np.mean(d) / np.std(d, ddof=1)) if np.std(d, ddof=1) > 0 else None
    return {
        "t": float(res.statistic),
        "p": float(res.pvalue),
        "n": int(len(a)),
        "mean_diff": float(np.mean(d)),
        "cohen_dz": dz,
    }


def bootstrap_ci(values: np.ndarray, n_boot: int = N_BOOT) -> list[float] | None:
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if len(values) < 2:
        return None
    idx = RNG.integers(0, len(values), size=(n_boot, len(values)))
    means = values[idx].mean(axis=1)
    return [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))]


def compare_within_visit(
    subject: str,
    condition: str,
    timepoint: str,
    event_type: str = "VAS7",
    roi: str = "medial_ba10",
) -> dict[str, Any]:
    catalog = load_catalog()
    pre_id = _run_for(catalog, subject, condition, "pre")
    post_id = _run_for(catalog, subject, condition, timepoint)
    if not pre_id or not post_id:
        return {"status": "unavailable", "reason": "missing pre or post run for this subject/condition"}
    pre = analyze_event(pre_id, event_type, roi)
    post = analyze_event(post_id, event_type, roi)
    if pre.get("status") != "ok" or post.get("status") != "ok":
        return {"status": "insufficient_data", "pre": pre, "post": post}
    a = np.asarray(post["trial_values"], dtype=float)
    b = np.asarray(pre["trial_values"], dtype=float)
    test = _welch(a, b)
    diff = post["metrics"]["mean_7_10"] - pre["metrics"]["mean_7_10"]
    pct = (diff / abs(pre["metrics"]["mean_7_10"]) * 100.0) if pre["metrics"]["mean_7_10"] else None
    return _finite(
        {
            "status": "ok",
            "subject": subject,
            "condition": condition,
            "timepoint": timepoint,
            "event_type": event_type,
            "roi": roi,
            "pre": {k: pre[k] for k in ("run_id", "timepoint", "n_trials", "n_channels", "metrics", "time", "hrf", "sem", "excluded")},
            "post": {k: post[k] for k in ("run_id", "timepoint", "n_trials", "n_channels", "metrics", "time", "hrf", "sem", "excluded")},
            "difference": {
                "mean_7_10_post_minus_pre": diff,
                "percent_of_pre": pct,
                "welch_t": test["t"],
                "welch_p": test["p"],
                "note": "Positive means the post-drug HbO response is less negative (attenuated deactivation) than pre-drug.",
            },
        }
    )


def _subject_condition_runs(catalog: dict[str, Any], timepoint: str):
    rows = []
    for subject in sorted(catalog["subjects"]):
        mor = _run_for(catalog, subject, "morphine", timepoint)
        pla = _run_for(catalog, subject, "placebo", timepoint)
        if mor and pla:
            rows.append((subject, mor, pla))
    return rows


def compare_conditions(
    timepoint: str = "60min",
    event_type: str = "VAS7",
    roi: str = "medial_ba10",
    subject: str | None = None,
) -> dict[str, Any]:
    catalog = load_catalog()
    if subject:
        mor_id = _run_for(catalog, subject, "morphine", timepoint)
        pla_id = _run_for(catalog, subject, "placebo", timepoint)
        if not mor_id or not pla_id:
            return {"status": "unavailable", "reason": "missing morphine or placebo run"}
        mor = analyze_event(mor_id, event_type, roi)
        pla = analyze_event(pla_id, event_type, roi)
        if mor.get("status") != "ok" or pla.get("status") != "ok":
            return {"status": "insufficient_data", "morphine": mor, "placebo": pla}
        test = _welch(np.asarray(mor["trial_values"]), np.asarray(pla["trial_values"]))
        return _finite(
            {
                "status": "ok",
                "scope": "subject",
                "subject": subject,
                "timepoint": timepoint,
                "event_type": event_type,
                "roi": roi,
                "morphine": {k: mor[k] for k in ("run_id", "n_trials", "n_channels", "metrics", "time", "hrf", "sem", "excluded")},
                "placebo": {k: pla[k] for k in ("run_id", "n_trials", "n_channels", "metrics", "time", "hrf", "sem", "excluded")},
                "difference": {
                    "mean_7_10_morphine_minus_placebo": mor["metrics"]["mean_7_10"] - pla["metrics"]["mean_7_10"],
                    "welch_t": test["t"],
                    "welch_p": test["p"],
                },
            }
        )

    rows = _subject_condition_runs(catalog, timepoint)
    mor_vals, pla_vals, per_subject = [], [], []
    mor_hrfs, pla_hrfs = [], []
    for sub, mor_id, pla_id in rows:
        mor = analyze_event(mor_id, event_type, roi)
        pla = analyze_event(pla_id, event_type, roi)
        if mor.get("status") != "ok" or pla.get("status") != "ok":
            per_subject.append({"subject": sub, "status": "insufficient_data"})
            continue
        mv, pv = mor["metrics"]["mean_7_10"], pla["metrics"]["mean_7_10"]
        mor_vals.append(mv)
        pla_vals.append(pv)
        mor_hrfs.append(mor["hrf"])
        pla_hrfs.append(pla["hrf"])
        per_subject.append(
            {
                "subject": sub,
                "status": "ok",
                "morphine": mv,
                "placebo": pv,
                "diff": mv - pv,
                "n_trials_morphine": mor["n_trials"],
                "n_trials_placebo": pla["n_trials"],
                "n_channels_morphine": mor["n_channels"],
                "n_channels_placebo": pla["n_channels"],
            }
        )
    if len(mor_vals) < 3:
        return {"status": "insufficient_data", "n": len(mor_vals), "per_subject": per_subject}
    a = np.asarray(mor_vals, dtype=float)
    b = np.asarray(pla_vals, dtype=float)
    test = _paired(a, b)
    diff = a - b
    time = analyze_event(rows[0][1], event_type, roi)["time"]
    return _finite(
        {
            "status": "ok",
            "scope": "group",
            "timepoint": timepoint,
            "event_type": event_type,
            "roi": roi,
            "n_subjects": int(len(a)),
            "morphine_mean": float(np.mean(a)),
            "placebo_mean": float(np.mean(b)),
            "morphine_sem": float(np.std(a, ddof=1) / np.sqrt(len(a))),
            "placebo_sem": float(np.std(b, ddof=1) / np.sqrt(len(b))),
            "difference": {
                "mean": float(np.mean(diff)),
                "ci95": bootstrap_ci(diff),
                "t": test["t"],
                "p": test["p"],
                "cohen_dz": test["cohen_dz"],
                "n": test["n"],
                "note": "Positive difference means the morphine HbO response is less negative (attenuated deactivation) than placebo.",
            },
            "per_subject": per_subject,
            "time": time,
            "morphine_hrf_mean": np.mean(np.stack(mor_hrfs), axis=0),
            "placebo_hrf_mean": np.mean(np.stack(pla_hrfs), axis=0),
        }
    )


def compare_timepoints_group(
    condition: str = "morphine",
    timepoint: str = "90min",
    event_type: str = "VAS7",
    roi: str = "medial_ba10",
) -> dict[str, Any]:
    """Paired group comparison of a post-drug scan against the pre-drug scan."""
    catalog = load_catalog()
    pre_vals, post_vals, rows = [], [], []
    for subject in sorted(catalog["subjects"]):
        pre_id = _run_for(catalog, subject, condition, "pre")
        post_id = _run_for(catalog, subject, condition, timepoint)
        if not pre_id or not post_id:
            continue
        pre = analyze_event(pre_id, event_type, roi)
        post = analyze_event(post_id, event_type, roi)
        if pre.get("status") != "ok" or post.get("status") != "ok":
            continue
        a, b = pre["metrics"]["mean_7_10"], post["metrics"]["mean_7_10"]
        na, nb = pre["metrics"]["nadir_5_15"], post["metrics"]["nadir_5_15"]
        pre_vals.append(a)
        post_vals.append(b)
        rows.append(
            {
                "subject": subject,
                "pre": a,
                "post": b,
                "pre_nadir": na,
                "post_nadir": nb,
                "n_trials_pre": pre["n_trials"],
                "n_trials_post": post["n_trials"],
            }
        )
    if len(pre_vals) < 3:
        return {"status": "insufficient_data", "n": len(pre_vals), "per_subject": rows}
    a = np.asarray(pre_vals, dtype=float)
    b = np.asarray(post_vals, dtype=float)
    test = _paired(b, a)
    diff = b - a
    time = analyze_event(_run_for(catalog, sorted(catalog["subjects"])[0], condition, "pre"), event_type, roi)["time"]
    # Average HRFs for the figure
    pre_hrfs, post_hrfs = [], []
    for r in rows:
        pre_id = _run_for(catalog, r["subject"], condition, "pre")
        post_id = _run_for(catalog, r["subject"], condition, timepoint)
        pre_hrfs.append(analyze_event(pre_id, event_type, roi)["hrf"])
        post_hrfs.append(analyze_event(post_id, event_type, roi)["hrf"])
    return _finite(
        {
            "status": "ok",
            "scope": "group",
            "condition": condition,
            "timepoint": timepoint,
            "event_type": event_type,
            "roi": roi,
            "n_subjects": int(len(a)),
            "pre_mean": float(np.mean(a)),
            "post_mean": float(np.mean(b)),
            "pre_sem": float(np.std(a, ddof=1) / np.sqrt(len(a))),
            "post_sem": float(np.std(b, ddof=1) / np.sqrt(len(b))),
            "difference": {
                "mean": float(np.mean(diff)),
                "ci95": bootstrap_ci(diff),
                "t": test["t"],
                "p": test["p"],
                "cohen_dz": test["cohen_dz"],
                "n": test["n"],
                "note": "Positive means the post-drug HbO response is less negative (attenuated deactivation) than pre-drug.",
            },
            "per_subject": rows,
            "time": time,
            "pre_hrf_mean": np.mean(np.stack(pre_hrfs), axis=0),
            "post_hrf_mean": np.mean(np.stack(post_hrfs), axis=0),
        }
    )


def get_quality(run_id: str, roi: str | None = "medial_ba10", channels: list[str] | None = None) -> dict[str, Any]:
    data = load_run(run_id)
    meta = data["meta"]
    idx = select_channels(meta, data, roi=roi, channels=channels, good_only=False)
    rows = []
    for i in idx:
        c = meta["channels"][i]
        rows.append(
            {
                "name": c["name"],
                "roi": c["roi"],
                "short": c["short"],
                "sci": c.get("sci"),
                "cv": c.get("cv"),
                "motion_frac": c.get("motion_frac"),
                "cardiac_ratio": c.get("cardiac_ratio"),
                "good": c.get("good"),
                "flags": c.get("flags", []),
            }
        )
    good = [r for r in rows if r["good"]]
    return _finite(
        {
            "run_id": run_id,
            "roi": roi,
            "n_channels": len(rows),
            "n_good": len(good),
            "median_sci": float(np.nanmedian([r["sci"] for r in rows])) if rows else None,
            "median_cv": float(np.nanmedian([r["cv"] for r in rows])) if rows else None,
            "channels": rows,
            "note": "SCI < 0.70, CV > 0.15 or motion > 10% of samples flags a channel. Flagged channels are shown but excluded from ROI averages.",
        }
    )


def assess_artifact(
    run_id: str,
    roi: str = "medial_ba10",
    window: tuple[float, float] | None = None,
    channels: list[str] | None = None,
) -> dict[str, Any]:
    data = load_run(run_id)
    meta = data["meta"]
    idx = select_channels(meta, data, roi=roi, channels=channels, good_only=False)
    short_idx = [i for i, c in enumerate(meta["channels"]) if c["short"]]
    fs = float(meta["fs"])
    T = data["hbo"].shape[-1]
    if window:
        i0, i1 = int(window[0] * fs), int(window[1] * fs)
    else:
        i0, i1 = 0, T
    i0, i1 = max(0, i0), min(T, i1)
    reasons = []
    values: dict[str, Any] = {}
    if idx:
        motion_frac = float(data["motion_mask"][idx, i0:i1].mean())
        values["motion_fraction_in_window"] = motion_frac
        if motion_frac > 0.05:
            reasons.append("frequent sample-to-sample jumps in this window")
        med_sci = float(np.nanmedian([meta["channels"][i].get("sci", np.nan) for i in idx]))
        values["median_sci"] = med_sci
        if med_sci < 0.5:
            reasons.append("poor 690/830 cardiac coupling (low SCI)")
        if short_idx:
            trace = np.nanmean(data["hbo"][idx][:, i0:i1], axis=0)
            short_trace = np.nanmean(data["hbo"][short_idx][:, i0:i1], axis=0)
            if trace.std() > 0 and short_trace.std() > 0:
                r = float(np.corrcoef(trace, short_trace)[0, 1])
                values["short_channel_correlation"] = r
                if abs(r) > 0.5:
                    reasons.append("strong shared variance with short-separation channels (systemic/scalp)")
        values["median_cardiac_ratio"] = float(
            np.nanmedian([meta["channels"][i].get("cardiac_ratio", np.nan) for i in idx])
        )
    verdict = "insufficient evidence"
    if reasons:
        verdict = "artifact/systemic contribution likely"
    elif idx:
        verdict = "no strong artifact signature in this window"
    return _finite(
        {
            "run_id": run_id,
            "roi": roi,
            "window_s": [i0 / fs, i1 / fs],
            "verdict": verdict,
            "reasons": reasons,
            "values": values,
            "note": "Absence of an artifact signature is not proof of a neural source; fNIRS remains a haemodynamic proxy.",
        }
    )


def compute_group_summary() -> dict[str, Any]:
    catalog = load_catalog()
    rois = [r for r in ROI_ORDER if r not in ("short", "other")]
    records = []
    for timepoint in TIMEPOINTS:
        for event_type in ("VAS7", "VAS3"):
            for roi in rois:
                for sub, mor_id, pla_id in _subject_condition_runs(catalog, timepoint):
                    for cond, rid in (("morphine", mor_id), ("placebo", pla_id)):
                        res = analyze_event(rid, event_type, roi)
                        rec = {
                            "subject": sub,
                            "condition": cond,
                            "timepoint": timepoint,
                            "event_type": event_type,
                            "roi": roi,
                            "run_id": rid,
                            "status": res.get("status"),
                            "n_trials": res.get("n_trials", 0),
                            "n_channels": res.get("n_channels", 0),
                        }
                        if res.get("status") == "ok":
                            rec.update(
                                {
                                    "mean_7_10": res["metrics"]["mean_7_10"],
                                    "nadir_5_15": res["metrics"]["nadir_5_15"],
                                    "peak_5_15": res["metrics"]["peak_5_15"],
                                    "p": res["metrics"]["p"],
                                }
                            )
                        records.append(rec)

    # Paired between-condition tests at each timepoint, with BH-FDR across the
    # four timepoints for each event/ROI/metric family.
    between: dict[str, Any] = {}
    for event_type in ("VAS7", "VAS3"):
        between[event_type] = {}
        for roi in rois:
            between[event_type][roi] = {}
            for metric in ("mean_7_10", "nadir_5_15"):
                fam = {}
                raw_ps = []
                keys = []
                for timepoint in TIMEPOINTS:
                    vals = {}
                    for cond in ("morphine", "placebo"):
                        rows = [
                            r
                            for r in records
                            if r["event_type"] == event_type
                            and r["roi"] == roi
                            and r["timepoint"] == timepoint
                            and r["condition"] == cond
                            and r.get("status") == "ok"
                        ]
                        vals[cond] = {r["subject"]: r.get(metric) for r in rows}
                    common = sorted(set(vals["morphine"]) & set(vals["placebo"]))
                    common = [
                        s
                        for s in common
                        if vals["morphine"][s] is not None and vals["placebo"][s] is not None
                    ]
                    a = np.asarray([vals["morphine"][s] for s in common], dtype=float)
                    b = np.asarray([vals["placebo"][s] for s in common], dtype=float)
                    test = _paired(a, b) if len(common) >= 3 else {"t": None, "p": None, "n": len(common)}
                    fam[timepoint] = {
                        "n": int(len(common)),
                        "morphine_mean": float(np.mean(a)) if len(a) else None,
                        "placebo_mean": float(np.mean(b)) if len(b) else None,
                        "morphine_sem": float(np.std(a, ddof=1) / np.sqrt(len(a))) if len(a) > 1 else None,
                        "placebo_sem": float(np.std(b, ddof=1) / np.sqrt(len(b))) if len(b) > 1 else None,
                        "difference": float(np.mean(a - b)) if len(a) else None,
                        "ci95": bootstrap_ci(a - b) if len(a) >= 3 else None,
                        "t": test.get("t"),
                        "p": test.get("p"),
                        "cohen_dz": test.get("cohen_dz"),
                        "per_subject": [
                            {"subject": s, "morphine": float(vals["morphine"][s]), "placebo": float(vals["placebo"][s])}
                            for s in common
                        ],
                    }
                    if test.get("p") is not None:
                        raw_ps.append(test["p"])
                        keys.append(timepoint)
                # BH-FDR within this family
                if raw_ps:
                    order = np.argsort(raw_ps)
                    m = len(raw_ps)
                    q = np.empty(m)
                    prev = 1.0
                    for rank in range(m - 1, -1, -1):
                        i = order[rank]
                        val = min(prev, raw_ps[i] * m / (rank + 1))
                        q[i] = val
                        prev = val
                    for k, timepoint in enumerate(keys):
                        fam[timepoint]["p_fdr"] = float(q[k])
                between[event_type][roi][metric] = fam

    within: dict[str, Any] = {}
    for condition in ("morphine", "placebo"):
        within[condition] = {}
        for event_type in ("VAS7", "VAS3"):
            within[condition][event_type] = {}
            for roi in rois:
                within[condition][event_type][roi] = {}
                for metric in ("mean_7_10", "nadir_5_15"):
                    fam: dict[str, Any] = {}
                    ps, keys = [], []
                    for timepoint in ("30min", "60min", "90min"):
                        pre_rows = {
                            r["subject"]: r
                            for r in records
                            if r["condition"] == condition
                            and r["event_type"] == event_type
                            and r["roi"] == roi
                            and r["timepoint"] == "pre"
                            and r.get("status") == "ok"
                        }
                        post_rows = {
                            r["subject"]: r
                            for r in records
                            if r["condition"] == condition
                            and r["event_type"] == event_type
                            and r["roi"] == roi
                            and r["timepoint"] == timepoint
                            and r.get("status") == "ok"
                        }
                        common = sorted(set(pre_rows) & set(post_rows))
                        common = [
                            s
                            for s in common
                            if pre_rows[s].get(metric) is not None and post_rows[s].get(metric) is not None
                        ]
                        a = np.asarray([pre_rows[s][metric] for s in common], dtype=float)
                        b = np.asarray([post_rows[s][metric] for s in common], dtype=float)
                        test = _paired(b, a) if len(common) >= 3 else {"t": None, "p": None, "n": len(common)}
                        fam[timepoint] = {
                            "n": int(len(common)),
                            "pre_mean": float(np.mean(a)) if len(a) else None,
                            "post_mean": float(np.mean(b)) if len(b) else None,
                            "difference": float(np.mean(b - a)) if len(a) else None,
                            "ci95": bootstrap_ci(b - a) if len(a) >= 3 else None,
                            "t": test.get("t"),
                            "p": test.get("p"),
                            "cohen_dz": test.get("cohen_dz"),
                            "per_subject": [
                                {"subject": s, "pre": float(pre_rows[s][metric]), "post": float(post_rows[s][metric])}
                                for s in common
                            ],
                        }
                        if test.get("p") is not None:
                            ps.append(test["p"])
                            keys.append(timepoint)
                    if ps:
                        order = np.argsort(ps)
                        m = len(ps)
                        q = np.empty(m)
                        prev = 1.0
                        for rank in range(m - 1, -1, -1):
                            i = order[rank]
                            val = min(prev, ps[i] * m / (rank + 1))
                            q[i] = val
                            prev = val
                        for k, timepoint in enumerate(keys):
                            fam[timepoint]["p_fdr"] = float(q[k])
                    within[condition][event_type][roi][metric] = fam

    summary = {
        "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "n_subjects": len(catalog["subjects"]),
        "rois": rois,
        "event_types": ["VAS7", "VAS3"],
        "timepoints": TIMEPOINTS,
        "between_condition": between,
        "within_condition": within,
        "records": records,
        "definitions": {
            "mean_7_10": "mean baseline-corrected HbO (µM) 7-10 s after stimulus onset",
            "nadir_5_15": "mean per-trial minimum HbO (µM) within 5-15 s after onset",
            "difference": "morphine minus placebo; positive = less negative (attenuated) HbO response",
            "fdr": "Benjamini-Hochberg across the four timepoints within each event/ROI/metric family",
        },
    }
    out = GROUP_DIR / "group_summary.json"
    out.write_text(json.dumps(_finite(summary), indent=1), encoding="utf-8")
    (GROUP_DIR / "records.json").write_text(json.dumps(_finite(records), indent=1), encoding="utf-8")
    return summary


def load_group_summary() -> dict[str, Any] | None:
    path = GROUP_DIR / "group_summary.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))

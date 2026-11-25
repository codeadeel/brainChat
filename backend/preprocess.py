"""Deterministic fNIRS preprocessing for ds005777.

The pipeline is intentionally explicit and reproducible:

raw intensity -> optical density -> TDDR -> modified Beer-Lambert
-> short-channel regression -> band-pass -> QC + cached arrays.

MNE is used only for the well-tested optical density / MBLL maths; the rest is
plain NumPy/SciPy so every step can be inspected and cited.
"""
from __future__ import annotations

import json
import math
import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np
from scipy.signal import butter, resample_poly, sosfiltfilt, welch

from .catalog import load_catalog, resolve_raw
from .config import (
    CV_THRESHOLD,
    DISPLAY_FS,
    DPF,
    FS,
    MOTION_FRAC_THRESHOLD,
    PROCESSED_DIR,
    SCI_THRESHOLD,
)


def _bandpass(x: np.ndarray, fs: float, low: float = 0.01, high: float = 0.2) -> np.ndarray:
    sos = butter(4, [low, high], btype="bandpass", fs=fs, output="sos")
    return sosfiltfilt(sos, x, axis=-1)


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0 or not mask.any():
        return mask
    kernel = np.ones(radius * 2 + 1, dtype=np.int16)
    return np.convolve(mask.astype(np.int16), kernel, mode="same") > 0


def _nearest_short(channels: list[dict[str, Any]]) -> dict[int, int]:
    shorts = [i for i, c in enumerate(channels) if c.get("short")]
    out: dict[int, int] = {}
    for i, c in enumerate(channels):
        if c.get("short") or not shorts:
            continue
        best = min(
            shorts,
            key=lambda j: (c["x_mid"] - channels[j]["x_mid"]) ** 2
            + (c["y_mid"] - channels[j]["y_mid"]) ** 2,
        )
        out[i] = best
    return out


def _short_channel_regression(
    hbo: np.ndarray, hbr: np.ndarray, channels: list[dict[str, Any]]
) -> tuple[np.ndarray, np.ndarray]:
    """Regress the nearest short-separation channel out of each long channel.

    A quadratic drift term is included in the design so the short-channel fit is
    not forced to absorb slow task-related signal. Only the short-channel
    component is subtracted.
    """
    nearest = _nearest_short(channels)
    if not nearest:
        return hbo, hbr
    n = hbo.shape[-1]
    t = np.linspace(-1.0, 1.0, n)
    design = np.vstack([np.ones(n), t, t**2]).T
    hbo_out = hbo.copy()
    hbr_out = hbr.copy()
    for i, j in nearest.items():
        for src, dst in ((hbo, hbo_out), (hbr, hbr_out)):
            y = src[i]
            x = src[j]
            if not np.isfinite(y).all() or not np.isfinite(x).all():
                continue
            coef, *_ = np.linalg.lstsq(np.column_stack([x, design]), y, rcond=None)
            dst[i] = y - coef[0] * x
    return hbo_out, hbr_out


def _json_safe(x: Any) -> Any:
    if isinstance(x, dict):
        return {k: _json_safe(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_json_safe(v) for v in x]
    if isinstance(x, (np.floating, float)):
        v = float(x)
        return None if not math.isfinite(v) else v
    if isinstance(x, (np.integer, int)):
        return int(x)
    if isinstance(x, np.ndarray):
        return [_json_safe(v) for v in x.tolist()]
    return x


def process_run(run: dict[str, Any], out_dir: Path | None = None, force: bool = False) -> dict[str, Any]:
    import mne

    out_dir = out_dir or PROCESSED_DIR
    out_path = out_dir / f"{run['run_id']}.npz"
    if out_path.exists() and not force:
        with np.load(out_path, allow_pickle=False) as z:
            meta = json.loads(str(z["meta_json"]))
        return {"run_id": run["run_id"], "status": "cached", "n_good": meta["qc"]["n_good"]}

    t0 = time.time()
    snirf = resolve_raw(run["snirf_path"])
    raw = mne.io.read_raw_snirf(snirf, preload=True, verbose="ERROR")
    fs = float(raw.info["sfreq"])
    intensity = raw.get_data().astype(np.float64)
    channels = run["channels"]
    n_pairs = len(channels)
    if intensity.shape[0] != n_pairs * 2:
        raise ValueError(
            f"{run['run_id']}: expected {n_pairs * 2} SNIRF channels, got {intensity.shape[0]}"
        )

    raw_od = mne.preprocessing.nirs.optical_density(raw, verbose="ERROR")
    od = raw_od.get_data().astype(np.float64)
    sci_all = mne.preprocessing.nirs.scalp_coupling_index(raw_od, verbose="ERROR")
    sci = np.asarray(sci_all[:n_pairs], dtype=np.float64)

    # Motion detection on optical density, before correction.
    od_pairs = np.stack([od[:n_pairs], od[n_pairs:]], axis=1)  # pairs x wavelength x time
    diff = np.diff(od_pairs, axis=-1)
    med = np.median(diff, axis=-1, keepdims=True)
    mad = np.median(np.abs(diff - med), axis=-1, keepdims=True)
    threshold = np.maximum(8.0 * 1.4826 * mad, 1e-7)
    jumps = np.abs(diff) > threshold  # pairs x wavelength x (time-1)
    motion_frac = jumps.mean(axis=-1)  # pairs x wavelength
    motion_pair = np.nanmean(motion_frac, axis=1)
    motion_any = jumps.any(axis=1)  # pairs x (time-1)
    motion_mask = np.zeros((n_pairs, od.shape[-1]), dtype=np.uint8)
    for i in range(n_pairs):
        motion_mask[i, :-1] = _dilate(motion_any[i], radius=int(round(0.5 * fs))).astype(
            np.uint8
        )

    raw_od_tddr = mne.preprocessing.nirs.temporal_derivative_distribution_repair(
        raw_od, verbose="ERROR"
    )
    raw_haemo = mne.preprocessing.nirs.beer_lambert_law(raw_od_tddr, ppf=DPF)
    haemo = raw_haemo.get_data().astype(np.float64)
    # MNE returns molar concentration; convert to micromolar for display,
    # statistics and the LLM's units. This keeps all reported numbers in µM.
    hbo = haemo[:n_pairs] * 1e6
    hbr = haemo[n_pairs:] * 1e6

    hbo_sc, hbr_sc = _short_channel_regression(hbo, hbr, channels)
    hbo = _bandpass(hbo_sc, fs)
    hbr = _bandpass(hbr_sc, fs)

    # Cardiac-band fraction of the optical-density spectrum, a transparent
    # quality/physiology marker used by the artefact-assessment tool.
    freqs, pxx = welch(od_pairs, fs=fs, nperseg=min(1024, od_pairs.shape[-1]), axis=-1)
    cardiac_band = (freqs >= 0.8) & (freqs <= 2.5)
    total_band = (freqs >= 0.01) & (freqs <= 2.5)
    denom = np.maximum(pxx[..., total_band].sum(axis=-1), 1e-20)
    cardiac_ratio = (pxx[..., cardiac_band].sum(axis=-1) / denom).mean(axis=-1)

    cv690 = np.nanstd(intensity[:n_pairs], axis=-1) / np.maximum(
        np.abs(np.nanmean(intensity[:n_pairs], axis=-1)), 1e-12
    )
    cv830 = np.nanstd(intensity[n_pairs:], axis=-1) / np.maximum(
        np.abs(np.nanmean(intensity[n_pairs:], axis=-1)), 1e-12
    )
    cv = np.nanmean(np.vstack([cv690, cv830]), axis=0)

    finite = np.isfinite(hbo).all(axis=-1) & np.isfinite(hbr).all(axis=-1)
    low_sci = sci < SCI_THRESHOLD
    high_cv = cv > CV_THRESHOLD
    high_motion = motion_pair > MOTION_FRAC_THRESHOLD
    base_good = finite & ~low_sci & ~high_cv
    good = base_good & ~high_motion

    flags: list[list[str]] = []
    for i in range(n_pairs):
        f: list[str] = []
        if not finite[i]:
            f.append("non_finite")
        if low_sci[i]:
            f.append("low_sci")
        if high_cv[i]:
            f.append("high_cv")
        if high_motion[i]:
            f.append("motion")
        flags.append(f)

    # Downsample for display only; analysis uses the native 25 Hz arrays.
    decim = max(1, int(round(fs / DISPLAY_FS)))
    hbo_ds = resample_poly(hbo, 1, decim, axis=-1) if decim > 1 else hbo
    hbr_ds = resample_poly(hbr, 1, decim, axis=-1) if decim > 1 else hbr
    time_ds = np.arange(hbo_ds.shape[-1]) / (fs / decim)
    time_native = np.arange(hbo.shape[-1]) / fs

    events: list[dict[str, Any]] = []
    for ev in run["events"]:
        rec = dict(ev)
        reason = []
        if ev.get("practice"):
            reason.append("practice marker (value < 0)")
        if ev.get("type") not in ("VAS7", "VAS3"):
            reason.append("not an electrical VAS event")
        i0 = max(0, int((ev["onset"] - 2.0) * fs))
        i1 = min(motion_mask.shape[-1], int((ev["onset"] + 15.0) * fs))
        motion_any_event = bool(
            i1 > i0 and base_good.any() and motion_mask[base_good][:, i0:i1].any()
        )
        rec["motion_any"] = motion_any_event
        rec["excluded"] = bool(reason)
        rec["exclude_reason"] = "; ".join(reason)
        events.append(rec)

    meta = {
        "run_id": run["run_id"],
        "subject": run["subject"],
        "session": run["session"],
        "visit": run["visit"],
        "condition": run["condition"],
        "timepoint": run["timepoint"],
        "run": run["run"],
        "fs": fs,
        "display_fs": fs / decim,
        "n_samples": int(hbo.shape[-1]),
        "duration_s": round(float(hbo.shape[-1] / fs), 2),
        "n_pairs": n_pairs,
        "channels": [
            {
                **{k: c[k] for k in ("name", "source", "detector", "pair_index", "paper_index", "x_mid", "y_mid", "separation_mm", "short", "roi", "wavelengths")},
                "sci": _json_safe(sci[i]),
                "cv": _json_safe(cv[i]),
                "motion_frac": _json_safe(motion_pair[i]),
                "cardiac_ratio": _json_safe(cardiac_ratio[i]),
                "good": bool(good[i]),
                "flags": flags[i],
            }
            for i, c in enumerate(channels)
        ],
        "events": events,
        "qc": {
            "n_good": int(good.sum()),
            "n_bad": int((~good).sum()),
            "median_sci": _json_safe(np.nanmedian(sci)),
            "median_cv": _json_safe(np.nanmedian(cv)),
            "motion_fraction": _json_safe(float(motion_mask.any(axis=0).mean())),
            "n_events": len(events),
            "n_events_excluded": int(sum(e["excluded"] for e in events)),
            "n_events_with_motion": int(sum(e.get("motion_any", False) for e in events)),
        },
        "processing_seconds": round(time.time() - t0, 2),
    }

    np.savez_compressed(
        out_path,
        time=time_native.astype(np.float32),
        hbo=hbo.astype(np.float32),
        hbr=hbr.astype(np.float32),
        time_ds=time_ds.astype(np.float32),
        hbo_ds=hbo_ds.astype(np.float32),
        hbr_ds=hbr_ds.astype(np.float32),
        sci=sci.astype(np.float32),
        cv=cv.astype(np.float32),
        motion_frac=motion_pair.astype(np.float32),
        motion_mask=motion_mask,
        good=good.astype(bool),
        base_good=base_good.astype(bool),
        meta_json=np.asarray(json.dumps(_json_safe(meta))),
    )
    return {
        "run_id": run["run_id"],
        "status": "ok",
        "n_good": int(good.sum()),
        "n_events_excluded": meta["qc"]["n_events_excluded"],
        "seconds": meta["processing_seconds"],
    }


def _worker(args: tuple[dict[str, Any], str, bool]) -> dict[str, Any]:
    run, out_dir, force = args
    try:
        return process_run(run, Path(out_dir), force=force)
    except Exception as exc:  # keep one bad run from stopping the batch
        return {"run_id": run.get("run_id"), "status": "error", "error": repr(exc)}


def build_all(
    subjects: list[str] | None = None,
    runs: list[str] | None = None,
    force: bool = False,
    workers: int | None = None,
) -> list[dict[str, Any]]:
    catalog = load_catalog()
    selected = list(catalog["runs"].values())
    if subjects:
        selected = [r for r in selected if r["subject"] in subjects]
    if runs:
        selected = [r for r in selected if r["run_id"] in runs]
    selected.sort(key=lambda r: (r["subject"], r["session"], r["run"]))
    workers = workers or min(8, max(1, (os.cpu_count() or 4)))
    print(f"processing {len(selected)} runs with {workers} workers")
    results: list[dict[str, Any]] = []
    args = [(r, str(PROCESSED_DIR), force) for r in selected]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_worker, a): a[0]["run_id"] for a in args}
        for i, fut in enumerate(as_completed(futures), 1):
            res = fut.result()
            results.append(res)
            print(
                f"[{i}/{len(selected)}] {res.get('run_id')} {res.get('status')} "
                f"good={res.get('n_good')} {res.get('error', '')}".strip(),
                flush=True,
            )
    (PROCESSED_DIR / "build_report.json").write_text(
        json.dumps(results, indent=1), encoding="utf-8"
    )
    return results


if __name__ == "__main__":
    build_all()

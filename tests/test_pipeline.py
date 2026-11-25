import json

import numpy as np
import pytest

from backend import analysis


def _synthetic(tmp_path, with_response: bool):
    fs = 25.0
    duration = 300.0
    n = int(duration * fs)
    t = np.arange(n) / fs
    hbo = np.zeros((1, n), dtype=float)
    if with_response:
        for onset in (60.0, 120.0, 180.0, 240.0):
            tt = t - onset
            mask = (tt >= 0) & (tt <= 25)
            hbo[0, mask] += -0.30 * np.exp(-0.5 * ((tt[mask] - 6.0) / 1.8) ** 2)
    rng = np.random.default_rng(7)
    hbo += rng.normal(0.0, 0.008, size=hbo.shape)
    meta = {
        "run_id": "synthetic_run",
        "subject": "sub-test",
        "session": "ses-1",
        "condition": "morphine",
        "timepoint": "pre",
        "run": "run-01",
        "fs": fs,
        "display_fs": 10.0,
        "n_samples": n,
        "duration_s": duration,
        "n_pairs": 1,
        "channels": [
            {
                "name": "S1-D1",
                "source": "S1",
                "detector": "D1",
                "pair_index": 0,
                "x_mid": 0.0,
                "y_mid": 80.0,
                "separation_mm": 30.0,
                "short": False,
                "roi": "medial_ba10",
                "wavelengths": [690, 830],
                "sci": 0.9,
                "cv": 0.02,
                "motion_frac": 0.0,
                "cardiac_ratio": 0.1,
                "good": True,
                "flags": [],
            }
        ],
        "events": [
            {
                "index": i,
                "onset": onset,
                "duration": 5.0,
                "type": "VAS7",
                "value": 1.0,
                "practice": False,
                "excluded": False,
                "exclude_reason": "",
                "motion_any": False,
            }
            for i, onset in enumerate((60.0, 120.0, 180.0, 240.0))
        ],
        "qc": {
            "n_good": 1,
            "n_bad": 0,
            "median_sci": 0.9,
            "median_cv": 0.02,
            "motion_fraction": 0.0,
            "n_events": 4,
            "n_events_excluded": 0,
            "n_events_with_motion": 0,
        },
    }
    path = tmp_path / "synthetic_run.npz"
    np.savez_compressed(
        path,
        time=t.astype(np.float32),
        hbo=hbo.astype(np.float32),
        hbr=np.zeros_like(hbo, dtype=np.float32),
        time_ds=t.astype(np.float32),
        hbo_ds=hbo.astype(np.float32),
        hbr_ds=np.zeros_like(hbo, dtype=np.float32),
        sci=np.array([0.9], dtype=np.float32),
        cv=np.array([0.02], dtype=np.float32),
        motion_frac=np.array([0.0], dtype=np.float32),
        motion_mask=np.zeros((1, n), dtype=np.uint8),
        good=np.array([True]),
        base_good=np.array([True]),
        meta_json=np.asarray(json.dumps(meta)),
    )
    return path


def test_synthetic_hrf_is_recovered(tmp_path, monkeypatch):
    monkeypatch.setattr(analysis, "PROCESSED_DIR", tmp_path)
    analysis.load_run.cache_clear()
    _synthetic(tmp_path, with_response=True)
    res = analysis.analyze_event("synthetic_run", "VAS7", channels=["S1-D1"])
    analysis.load_run.cache_clear()
    assert res["status"] == "ok"
    assert res["n_trials"] == 4
    assert res["metrics"]["mean_7_10"] < -0.05
    assert res["metrics"]["nadir_5_15"] < -0.15
    assert 5.0 <= res["metrics"]["nadir_latency_s"] <= 8.0


def test_null_run_does_not_invent_a_response(tmp_path, monkeypatch):
    monkeypatch.setattr(analysis, "PROCESSED_DIR", tmp_path)
    analysis.load_run.cache_clear()
    _synthetic(tmp_path, with_response=False)
    res = analysis.analyze_event("synthetic_run", "VAS7", channels=["S1-D1"])
    analysis.load_run.cache_clear()
    assert res["status"] == "ok"
    assert abs(res["metrics"]["mean_7_10"]) < 0.05
    assert res["metrics"]["p"] > 0.05

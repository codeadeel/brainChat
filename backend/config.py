"""Configuration and paths for the Chat With My Brain prototype."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent.parent
load_dotenv(APP_DIR / ".env")

_data_env = Path(os.getenv("DATA_DIR", str(APP_DIR.parent / "data")))
DATA_DIR = (_data_env if _data_env.is_absolute() else APP_DIR / _data_env).resolve()
RAW_DIR = DATA_DIR / "raw" / "ds005777"
PROCESSED_DIR = DATA_DIR / "processed"
ARTIFACTS_DIR = DATA_DIR / "artifacts"
GROUP_DIR = DATA_DIR / "group"
LOG_DIR = DATA_DIR / "logs"
FRONTEND_DIST = APP_DIR / "frontend" / "dist"

for _p in (PROCESSED_DIR, ARTIFACTS_DIR, GROUP_DIR, LOG_DIR):
    _p.mkdir(parents=True, exist_ok=True)

# LLM (OpenAI-compatible). Key should live in .env, never in git.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "2000"))
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "90"))
LLM_MAX_TOOL_ROUNDS = int(os.getenv("LLM_MAX_TOOL_ROUNDS", "6"))

# Analysis constants
FS = 25.0
DISPLAY_FS = 10.0
DPF = 6.0
SCI_THRESHOLD = float(os.getenv("SCI_THRESHOLD", "0.70"))
CV_THRESHOLD = float(os.getenv("CV_THRESHOLD", "0.15"))
MOTION_FRAC_THRESHOLD = float(os.getenv("MOTION_FRAC_THRESHOLD", "0.10"))
BASELINE_S = 5.0
EPOCH_POST_S = 25.0
HRF_WINDOW = (5.0, 15.0)
METRIC_WINDOW = (7.0, 10.0)

ROI_ORDER = ["medial_ba10", "left_pfc", "right_s1", "short", "other"]
ROI_LABELS = {
    "medial_ba10": "Medial BA10 (frontopolar)",
    "left_pfc": "Left lateral PFC",
    "right_s1": "Right S1 (somatosensory)",
    "short": "Short-separation (scalp/systemic)",
    "other": "Other",
}
EVENT_TYPES = ["VAS7", "VAS3"]
TIMEPOINTS = ["pre", "30min", "60min", "90min"]
TIMEPOINT_LABELS = {
    "pre": "Pre-drug",
    "30min": "30 min post",
    "60min": "60 min post",
    "90min": "90 min post",
    "extra": "Extra",
}

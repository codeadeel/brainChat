"""Session-scoped evidence store.

Every number the LLM is allowed to quote comes from a tool result, and every
analysis result is registered here with a stable ID (E1, E2, ...), a figure and
the method/caveats needed to interpret it.
"""
from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import ARTIFACTS_DIR


class EvidenceStore:
    def __init__(self, session_id: str):
        safe = re.sub(r"[^a-zA-Z0-9_-]", "", session_id)[:48] or "session"
        self.session_id = safe
        self.dir = ARTIFACTS_DIR / safe
        self.dir.mkdir(parents=True, exist_ok=True)
        self.items: dict[str, dict[str, Any]] = {}
        for p in sorted(self.dir.glob("E*.json")):
            try:
                meta = json.loads(p.read_text(encoding="utf-8"))
                self.items[meta["id"]] = meta
            except Exception:
                continue

    def _next_id(self) -> str:
        n = 1
        while f"E{n}" in self.items:
            n += 1
        return f"E{n}"

    def add(
        self,
        kind: str,
        title: str,
        summary: str,
        stats: dict[str, Any] | None = None,
        method: str = "",
        caveats: list[str] | None = None,
        figure_path: Path | None = None,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        eid = self._next_id()
        figure_name = None
        if figure_path is not None and Path(figure_path).exists():
            figure_name = f"{eid}.png"
            shutil.move(str(figure_path), str(self.dir / figure_name))
        meta = {
            "id": eid,
            "kind": kind,
            "title": title,
            "summary": summary,
            "stats": stats or {},
            "method": method,
            "caveats": caveats or [],
            "params": params or {},
            "data": data or {},
            "figure": figure_name,
            "figure_url": f"/api/evidence/{self.session_id}/{eid}/figure" if figure_name else None,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        (self.dir / f"{eid}.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        self.items[eid] = meta
        return meta

    def get(self, eid: str) -> dict[str, Any] | None:
        return self.items.get(eid)

    def all(self) -> list[dict[str, Any]]:
        return sorted(self.items.values(), key=lambda m: int(m["id"][1:]))


def temp_figure_path() -> Path:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    return ARTIFACTS_DIR / f"tmp_{uuid.uuid4().hex}.png"

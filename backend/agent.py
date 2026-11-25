"""Grounded tool-calling agent (OpenAI-compatible endpoint)."""
from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator

from openai import OpenAI

from .catalog import load_catalog
from .config import (
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MAX_TOKENS,
    LLM_MAX_TOOL_ROUNDS,
    LLM_MODEL,
    LLM_TEMPERATURE,
    LLM_TIMEOUT,
)
from .evidence import EvidenceStore
from .prompts import build_system_prompt
from .tools import TOOL_SCHEMAS, ToolContext, execute_tool


def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@dataclass
class ChatSession:
    id: str
    run_id: str
    playhead: float
    roi: str = "medial_ba10"
    selected_channels: list[str] | None = None
    messages: list[dict[str, Any]] = field(default_factory=list)
    store: EvidenceStore | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @property
    def subject(self) -> str:
        return self.run_id.split("_")[0]

    @property
    def session(self) -> str:
        parts = self.run_id.split("_")
        return parts[1] if len(parts) > 1 else "ses-1"


class SessionManager:
    def __init__(self, catalog: dict[str, Any]):
        self.catalog = catalog
        self.sessions: dict[str, ChatSession] = {}

    def get(
        self,
        session_id: str | None,
        run_id: str,
        playhead: float,
        roi: str = "medial_ba10",
        channels: list[str] | None = None,
    ) -> ChatSession:
        sid = session_id or uuid.uuid4().hex
        session = self.sessions.get(sid)
        if session is None:
            session = ChatSession(
                id=sid,
                run_id=run_id,
                playhead=playhead,
                roi=roi,
                selected_channels=channels,
                store=EvidenceStore(sid),
            )
            # Rehydrate only the evidence index; chat history is intentionally fresh.
            self.sessions[sid] = session
        else:
            session.run_id = run_id
            session.playhead = playhead
            session.roi = roi
            session.selected_channels = channels
            session.updated_at = time.time()
        return session

    def prune(self, max_sessions: int = 50) -> None:
        if len(self.sessions) <= max_sessions:
            return
        for sid, _ in sorted(self.sessions.items(), key=lambda kv: kv[1].updated_at)[: len(self.sessions) - max_sessions]:
            self.sessions.pop(sid, None)


def _trim(messages: list[dict[str, Any]], limit: int = 26) -> list[dict[str, Any]]:
    if len(messages) <= limit:
        return messages
    cut = max(0, len(messages) - limit)
    while cut < len(messages) and messages[cut].get("role") != "user":
        cut += 1
    return messages[cut:]


def _for_model(result: dict[str, Any]) -> dict[str, Any]:
    """Drop large arrays before sending a tool result back to the model."""
    out = dict(result)
    out.pop("data", None)
    return out


class FnirsAgent:
    def __init__(self):
        self.catalog = load_catalog()
        self.sessions = SessionManager(self.catalog)
        self.client = OpenAI(
            base_url=LLM_BASE_URL,
            api_key=LLM_API_KEY or "not-set",
            timeout=LLM_TIMEOUT,
            max_retries=0,
        )

    def _completion(self, messages: list[dict[str, Any]]):
        last_exc: Exception | None = None
        for attempt in range(2):
            try:
                return self.client.chat.completions.create(
                    model=LLM_MODEL,
                    messages=messages,
                    tools=TOOL_SCHEMAS,
                    tool_choice="auto",
                    temperature=LLM_TEMPERATURE,
                    max_tokens=LLM_MAX_TOKENS,
                )
            except Exception as exc:  # one retry for transient network/5xx
                last_exc = exc
                if attempt == 0:
                    time.sleep(1.0)
        raise last_exc  # type: ignore[misc]

    async def chat(
        self, session: ChatSession, message: str
    ) -> AsyncGenerator[str, None]:
        ctx = ToolContext(session, self.catalog)
        session.messages.append({"role": "user", "content": message})
        session.messages = _trim(session.messages)

        evidence: dict[str, dict[str, Any]] = {}
        ui_action: dict[str, Any] | None = None
        answer = ""
        error: str | None = None

        yield sse("status", {"message": "Reading the current replay context…"})

        for round_no in range(LLM_MAX_TOOL_ROUNDS + 1):
            evidence_ids = list(session.store.items) if session.store else []
            system = build_system_prompt(session, self.catalog, evidence_ids)
            messages = [{"role": "system", "content": system}] + session.messages
            try:
                resp = await asyncio.to_thread(self._completion, messages)
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
                break

            msg = resp.choices[0].message
            tool_calls = list(msg.tool_calls or [])
            content = (msg.content or "").strip()

            if tool_calls:
                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                        }
                        for tc in tool_calls
                    ],
                }
                session.messages.append(assistant_msg)
                for tc in tool_calls:
                    name = tc.function.name
                    try:
                        args = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    yield sse("tool_call", {"name": name, "args": args})
                    result = await asyncio.to_thread(execute_tool, name, args, ctx)
                    session.messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": json.dumps(_for_model(result), default=str),
                        }
                    )
                    if isinstance(result, dict):
                        ev = result.get("evidence")
                        if isinstance(ev, dict) and ev.get("id"):
                            full = session.store.get(ev["id"]) or {} if session.store else {}
                            evidence[ev["id"]] = {**full, **ev}
                        if result.get("ui_action"):
                            ui_action = result["ui_action"]
                        if result.get("figure_url") and result.get("id"):
                            full = session.store.get(result["id"]) or {} if session.store else {}
                            evidence[result["id"]] = {**full, **result}
                    yield sse(
                        "tool_result",
                        {
                            "name": name,
                            "status": result.get("status") if isinstance(result, dict) else None,
                            "summary": (result.get("summary") if isinstance(result, dict) else None)
                            or (result.get("error") if isinstance(result, dict) else None)
                            or "",
                        },
                    )
                continue

            if content:
                answer = content
                session.messages.append({"role": "assistant", "content": answer})
                break

            # Empty final message: give the model one explicit nudge.
            session.messages.append(
                {
                    "role": "user",
                    "content": "Please answer the question now using only the tool results above, and cite evidence IDs.",
                }
            )

        if not answer and not error:
            error = "The model did not return a usable answer. Try rephrasing the question."

        for ev in evidence.values():
            yield sse(
                "evidence",
                {
                    "id": ev.get("id"),
                    "kind": ev.get("kind"),
                    "title": ev.get("title"),
                    "summary": ev.get("summary"),
                    "figure_url": ev.get("figure_url"),
                    "stats": ev.get("stats"),
                    "method": ev.get("method"),
                    "caveats": ev.get("caveats"),
                },
            )

        if answer:
            cited = set(re.findall(r"\[(E\d+)\]", answer))
            known = set(evidence) | (set(session.store.items) if session.store else set())
            missing = sorted(cited - known)
            if missing:
                yield sse("citation_warning", {"missing": missing, "known": sorted(known)})
            yield sse("answer", {"text": answer})

        if ui_action:
            yield sse("ui_action", ui_action)

        if error:
            yield sse("error", {"message": error})

        yield sse("done", {"session_id": session.id, "evidence": sorted(evidence)})

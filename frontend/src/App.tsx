import { useEffect, useMemo, useRef, useState } from "react";
import BrainModel3D from "./components/BrainModel3D";
import ChatPanel from "./components/ChatPanel";
import CompareView from "./components/CompareView";
import PipelineView from "./components/PipelineView";
import PresentationView from "./components/PresentationView";
import EvidenceDrawer from "./components/EvidenceDrawer";
import MethodsDrawer from "./components/MethodsDrawer";
import ScalpMap from "./components/ScalpMap";
import EpochChart from "./components/EpochChart";
import SignalChart from "./components/SignalChart";
import { getCatalog, getEvidence, getGroup, getRun, streamChat } from "./api";
import { roiLabel } from "./labels";
import type {
  Catalog,
  ChannelMeta,
  ChatMessage,
  EvidenceMeta,
  GroupSummary,
  RunData,
  RunMeta,
  TraceEntry,
  UiAction,
} from "./types";

const TIMEPOINTS: RunMeta["timepoint"][] = ["pre", "30min", "60min", "90min"];
const SUGGESTIONS = [
  "What is my brain showing right now?",
  "What happened when the painful stimulus was applied?",
  "How did the brain response change after morphine at 90 minutes?",
  "How does this compare with placebo at 90 minutes?",
  "Show me the evidence and explain the caveats.",
  "Is this a real brain response or an artefact?",
];

function findRunId(cat: Catalog, subject: string, condition: string, timepoint: string): string | null {
  const sessions = cat.visits[subject]?.sessions ?? {};
  const session = Object.values(sessions).find((s) => s.condition === condition);
  if (!session) return null;
  return session.runs.find((rid) => cat.runs[rid]?.timepoint === timepoint) ?? null;
}

// crypto.randomUUID is only available in secure contexts (https/localhost).
// Over plain http:// on a LAN/ZeroTier IP it is undefined, so provide a fallback.
function randomId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function median(values: number[]) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function meanSlice(arr: (number | null)[][], idx: number[], i0: number, i1: number) {
  let sum = 0;
  let n = 0;
  for (const i of idx) {
    const row = arr[i];
    if (!row) continue;
    for (let t = i0; t < i1; t++) {
      const v = row[t];
      if (v !== null && Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
  }
  return n ? sum / n : null;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="spark-empty" />;
  const w = 132;
  const h = 30;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(0.02, hi - lo);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - lo) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="0" y1={h - (-lo / span) * (h - 4) - 2} x2={w} y2={h - (-lo / span) * (h - 4) - 2} stroke="#e2e8f0" strokeWidth="1" />
    </svg>
  );
}

/** Main dashboard state coordinator linking replay, 3D/2D probes, pipeline, compare, deck, and analyst chat. */
export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [subject, setSubject] = useState("sub-002");
  const [condition, setCondition] = useState<"morphine" | "placebo">("morphine");
  const [timepoint, setTimepoint] = useState<RunMeta["timepoint"]>("pre");
  const [run, setRun] = useState<RunData | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"monitor" | "pipeline" | "compare" | "presentation">(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "presentation" ? "presentation" : t === "compare" ? "compare" : t === "pipeline" ? "pipeline" : "monitor";
  });

  const [playing, setPlaying] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const ap = q.get("autoplay");
    if (ap === "1") return true;
    if (ap === "0") return false;
    return q.get("t") === null; // no explicit playhead -> start live
  });
  const [speed, setSpeed] = useState(10);
  const [playhead, setPlayhead] = useState(0);
  const [follow, setFollow] = useState(true);
  const [view, setView] = useState<{ start: number; end: number } | null>(null);
  const [highlight, setHighlight] = useState<{ start: number; end: number } | null>(null);
  const [showIndividual, setShowIndividual] = useState(false);
  const [chartMode, setChartMode] = useState<"continuous" | "epoch">("continuous");
  const [showTrials, setShowTrials] = useState(false);
  const [channelRoi, setChannelRoi] = useState("medial_ba10");
  const [probeMode, setProbeMode] = useState<"3d" | "2d">(() =>
    new URLSearchParams(window.location.search).get("map") === "2d" ? "2d" : "3d",
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState("");
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [evidenceById, setEvidenceById] = useState<Record<string, EvidenceMeta>>({});
  const [openEvidence, setOpenEvidence] = useState<EvidenceMeta | null>(null);
  const [citationWarning, setCitationWarning] = useState<string[] | null>(null);
  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [methodsOpen, setMethodsOpen] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get("guide") === "1" || q.get("methods") === "1";
  });
  const [sessionId] = useState(() => randomId());
  const [initialT] = useState(() => {
    const t = Number(new URLSearchParams(window.location.search).get("t") ?? 0);
    return Number.isFinite(t) ? t : 0;
  });
  const lastAction = useRef<UiAction | null>(null);
  const lastRunId = useRef<string | null>(null);
  const lastSubject = useRef<string | null>(null);

  useEffect(() => {
    getCatalog()
      .then((c) => {
        setCatalog(c);
        if (!c.subjects.includes("sub-002")) setSubject(c.subjects[0] ?? "sub-002");
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if ((tab !== "compare" && tab !== "presentation") || group) return;
    getGroup()
      .then(setGroup)
      .catch((e) => setError(String(e)));
  }, [tab, group]);

  useEffect(() => {
    if (tab === "presentation") setPlaying(false);
  }, [tab]);

  useEffect(() => {
    if (!catalog) return;
    const rid = findRunId(catalog, subject, condition, timepoint);
    if (!rid) {
      setError(`No ${condition} run found for ${subject} at ${timepoint}.`);
      setRun(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getRun(rid, true)
      .then((data) => {
        if (cancelled) return;
        setRun(data);
        setError(null);
        if (lastRunId.current !== data.run_id) {
          const isInitial = lastRunId.current === null;
          const sameSubject = lastSubject.current === data.meta.subject;
          lastRunId.current = data.run_id;
          lastSubject.current = data.meta.subject;

          if (isInitial) {
            setSelected(data.default_channels);
            setPlayhead(Math.min(initialT, data.meta.duration_s));
            setPlaying(
              new URLSearchParams(window.location.search).get("autoplay") === "0" ? false : initialT > 0 ? false : true,
            );
            setFollow(true);
            setView(null);
          } else {
            setPlayhead((p) => Math.min(p, data.meta.duration_s));
            setView((v) =>
              v
                ? {
                    start: Math.min(v.start, data.meta.duration_s),
                    end: Math.min(v.end, data.meta.duration_s),
                  }
                : null,
            );
            setSelected((prev) => {
              if (!sameSubject) return data.default_channels;
              const avail = new Set(data.channels.map((c) => c.name));
              const keep = prev.filter((n) => avail.has(n));
              return keep.length ? keep : data.default_channels;
            });
          }
          setHighlight(null);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalog, subject, condition, timepoint]);

  useEffect(() => {
    if (!playing || !run) return;
    const id = window.setInterval(() => {
      setPlayhead((p) => {
        const next = p + 0.1 * speed;
        if (next >= run.meta.duration_s) {
          setPlaying(false);
          return run.meta.duration_s;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, speed, run]);

  useEffect(() => {
    if (!run || tab !== "monitor") return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        setPlayhead((p) => Math.min(run.meta.duration_s, p + 5));
      } else if (e.key === "ArrowLeft") {
        setPlayhead((p) => Math.max(0, p - 5));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [run, tab]);

  const selectedIndices = useMemo(() => {
    if (!run) return [];
    return selected
      .map((name) => run.channels.findIndex((c) => c.name === name))
      .filter((i) => i >= 0);
  }, [run, selected]);

  const current = useMemo(() => {
    if (!run || !selectedIndices.length) return null;
    const fs = run.sample_rate;
    const i1 = Math.max(1, Math.min(run.time.length, Math.round(playhead * fs)));
    const i0 = Math.max(0, i1 - Math.round(10 * fs));
    const b1 = i0;
    const b0 = Math.max(0, i0 - Math.round(10 * fs));
    const hbo = meanSlice(run.hbo, selectedIndices, i0, i1);
    const hbr = meanSlice(run.hbr, selectedIndices, i0, i1);
    const baseHbo = b1 > b0 ? meanSlice(run.hbo, selectedIndices, b0, b1) : 0;
    const baseHbr = b1 > b0 ? meanSlice(run.hbr, selectedIndices, b0, b1) : 0;
    const events = run.events.filter((e) => e.onset <= playhead && !e.practice);
    const last = events.length ? events[events.length - 1] : null;
    const next = run.events.find((e) => e.onset > playhead && !e.practice) ?? null;
    const chans = run.channels.filter((c) => selected.includes(c.name));
    const good = chans.filter((c) => c.good);
    const perChannel: Record<string, number> = {};
    for (const name of selected) {
      const idx = run.channels.findIndex((c) => c.name === name);
      if (idx < 0) continue;
      const v = meanSlice(run.hbo, [idx], i0, i1);
      const b = b1 > b0 ? meanSlice(run.hbo, [idx], b0, b1) : 0;
      if (v !== null && b !== null) perChannel[name] = v - b;
    }
    return {
      hbo: hbo !== null && baseHbo !== null ? hbo - baseHbo : null,
      hbr: hbr !== null && baseHbr !== null ? hbr - baseHbr : null,
      last,
      next,
      nGood: good.length,
      nChans: chans.length,
      sci: median(chans.map((c) => c.sci ?? NaN)),
      motion: chans.some((c) => c.motion_frac !== null && (c.motion_frac ?? 0) > 0.1),
      perChannel,
    };
  }, [run, selected, selectedIndices, playhead]);

  const spark = useMemo(() => {
    if (!run || !selectedIndices.length) return [];
    const fs = run.sample_rate;
    const end = Math.max(1, Math.round(playhead * fs));
    const start = Math.max(0, end - Math.round(30 * fs));
    const step = Math.max(1, Math.round(fs / 2));
    const base = meanSlice(run.hbo, selectedIndices, 0, Math.min(run.time.length, Math.round(20 * fs))) ?? 0;
    const out: number[] = [];
    for (let i = start; i < end; i += step) {
      const v = meanSlice(run.hbo, selectedIndices, i, Math.min(end, i + step));
      if (v !== null) out.push(v - base);
    }
    return out;
  }, [run, selectedIndices, playhead]);

  const phase = useMemo(() => {
    const last = current?.last;
    if (!last) {
      return {
        cls: "idle",
        label: "Waiting for a stimulus",
        text: "The replay has not reached the first event yet. The first 30 s are used as a resting baseline.",
      };
    }
    const since = playhead - last.onset;
    const kind = last.type === "VAS7" ? "painful" : "innocuous";
    if (since < 5)
      return {
        cls: "stimulus",
        label: "Stimulus on",
        text: `A ${kind} stimulus is being delivered (${since.toFixed(1)} / 5 s). The vascular response has not developed yet.`,
      };
    if (since < 15)
      return {
        cls: "response",
        label: "Evoked response",
        text: `The ${kind} stimulus ended ${(since - 5).toFixed(0)} s ago. HbO usually develops over the next 5–10 s and should peak around 5–8 s after onset.`,
      };
    if (since < 30)
      return {
        cls: "recovery",
        label: "Recovery",
        text: `Recovery phase, ${since.toFixed(0)} s after onset. The response normally returns toward baseline by about 25 s.`,
      };
    return {
      cls: "baseline",
      label: "Resting baseline",
      text: `No stimulus in the last ${Math.round(since)} s. The signal is returning to its resting level.`,
    };
  }, [current, playhead]);

  const responseWindow = current?.last
    ? { start: current.last.onset + 5, end: current.last.onset + 15 }
    : null;
  const nextIn = current?.next ? Math.max(0, current.next.onset - playhead) : null;
  const qualityLabel = current
    ? current.nGood === current.nChans && (current.sci ?? 0) >= 0.8
      ? "Good"
      : (current.sci ?? 0) >= 0.6
        ? "Fair"
        : "Poor"
    : "—";

  const toggleChannel = (name: string) => {
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= 10) return prev;
      return [...prev, name];
    });
  };

  const handleNextEvent = (type: "VAS7" | "VAS3") => {
    if (!run) return;
    const candidates = run.events.filter(
      (e) => e.type === type && !e.practice && e.onset > playhead + 6,
    );
    const ev = candidates[0] ?? run.events.find((e) => e.type === type && !e.practice);
    if (!ev) return;
    setPlayhead(Math.max(0, ev.onset - 3));
    setPlaying(false);
    setFollow(true);
    setView(null);
    setHighlight({ start: Math.max(0, ev.onset - 5), end: ev.onset + 25 });
  };

  const seekTo = (onset: number) => {
    setPlayhead(Math.max(0, onset - 3));
    setPlaying(false);
    setFollow(true);
    setView(null);
    setHighlight({ start: Math.max(0, onset - 5), end: onset + 25 });
  };

  const applyUiAction = (action: UiAction | null | undefined) => {
    if (!action || !run) return;
    lastAction.current = action;
    if (action.tab) setTab(action.tab);
    if (action.channels?.length) {
      const keep = action.channels.filter((n) => run.all_channels.some((c) => c.name === n));
      if (keep.length) setSelected(keep);
    }
    if (action.start !== null && action.start !== undefined && action.end !== null && action.end !== undefined) {
      setView({ start: action.start, end: action.end });
      setFollow(false);
    } else {
      setView(null);
      setFollow(true);
    }
  };

  const openEvidenceById = async (id: string) => {
    const local = evidenceById[id];
    if (local) {
      setOpenEvidence(local);
      return;
    }
    try {
      const meta = await getEvidence(sessionId, id);
      setEvidenceById((prev) => ({ ...prev, [id]: meta }));
      setOpenEvidence(meta);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSend = async (text: string) => {
    if (!run || streaming) return;
    setPlaying(false);
    setMessages((prev) => [...prev, { role: "user", text }]);
    setStreaming(true);
    setStatus("Reading the current replay context…");
    setTrace([]);
    setCitationWarning(null);
    const turnEvidence: string[] = [];
    try {
      await streamChat(
        {
          session_id: sessionId,
          run_id: run.run_id,
          playhead,
          roi: channelRoi,
          channels: selected,
          message: text,
        },
        {
          status: (d) => setStatus(d.message),
          tool_call: (d) => {
            setTrace((prev) => [
              ...prev,
              { id: `${d.name}-${Date.now()}-${Math.random()}`, name: d.name, args: d.args },
            ]);
            setStatus(`Calling ${d.name.replaceAll("_", " ")}…`);
          },
          tool_result: (d) => {
            setTrace((prev) => {
              const copy = [...prev];
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].name === d.name && !copy[i].status) {
                  copy[i] = { ...copy[i], status: d.status ?? "ok", summary: d.summary ?? "" };
                  break;
                }
              }
              return copy;
            });
            setStatus("Reading the tool result…");
          },
          evidence: (d) => {
            setEvidenceById((prev) => ({ ...prev, [d.id]: d }));
            turnEvidence.push(d.id);
          },
          answer: (d) => {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: d.text, evidence: [...new Set(turnEvidence)] },
            ]);
            setStatus("");
          },
          ui_action: (d) => applyUiAction(d),
          citation_warning: (d) => setCitationWarning(d.missing),
          error: (d) => {
            setError(d.message);
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: `I could not complete that analysis: ${d.message}` },
            ]);
          },
          done: () => {
            setStreaming(false);
            setStatus("");
          },
        },
      );
    } catch (e) {
      setError(String(e));
      setStreaming(false);
    }
  };

  if (!catalog || !run) {
    return (
      <div className="boot">
        <div className="boot-mark">◉</div>
        <h1>Chat With My Brain</h1>
        <p>{error ?? (loading ? "Loading the fNIRS replay…" : "No run selected.")}</p>
        {error && (
          <button className="ghost" onClick={() => window.location.reload()}>
            Retry
          </button>
        )}
      </div>
    );
  }

  const duration = run.meta.duration_s;
  const subjects = catalog.subjects;
  const timepointLabel = catalog.timepoint_labels[run.meta.timepoint] ?? run.meta.timepoint;
  const channelsForRoi = (roi: string): ChannelMeta[] =>
    run.all_channels.filter((c) => c.roi === roi);
  const currentChannels = channelsForRoi(channelRoi);
  const vasCount = run.events.filter((e) => e.type === "VAS7" && !e.practice).length;
  const innocuousCount = run.events.filter((e) => e.type === "VAS3" && !e.practice).length;

  if (tab === "presentation") {
    return (
      <PresentationView
        run={run}
        group={group}
        onExit={() => setTab("monitor")}
        onJump={(target) => setTab(target)}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◉</span>
          <div>
            <div className="brand-title">Chat With My Brain</div>
            <div className="brand-sub">Live fNIRS replay · OpenNeuro ds005777</div>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === "monitor" ? "active" : ""} onClick={() => setTab("monitor")}>
            Monitor
          </button>
          <button className={tab === "pipeline" ? "active" : ""} onClick={() => setTab("pipeline")}>
            Pipeline
          </button>
          <button className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}>
            Compare
          </button>
          <button onClick={() => setTab("presentation")}>
            Presentation
          </button>
        </nav>
        <div className="top-meta">
          <span className={`live-chip ${tab === "monitor" && playing ? "on" : ""}`}>
            <i /> {tab === "compare" ? "GROUP VIEW" : tab === "pipeline" ? "PIPELINE" : playing ? "REPLAYING" : "PAUSED"}
          </span>
          <span className="pill">{catalog.n_subjects} subjects</span>
          <span className="pill">{run.meta.fs.toFixed(0)} Hz</span>
          <button className="ghost small" onClick={() => setMethodsOpen(true)}>
            Guide
          </button>
        </div>
      </header>

      {error && (
        <div className="toast">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {tab !== "compare" && (
        <div className="controls">
          <label className="control">
            Participant
            <select value={subject} onChange={(e) => setSubject(e.target.value)}>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="control">
            <span>Visit</span>
            <div className="segmented">
              {(["morphine", "placebo"] as const).map((c) => (
                <button key={c} className={condition === c ? "active" : ""} onClick={() => setCondition(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="session-timeline">
            {TIMEPOINTS.map((t) => (
              <button
                key={t}
                className={timepoint === t ? "active" : ""}
                onClick={() => setTimepoint(t)}
              >
                <span>{t === "pre" ? "Pre-drug" : t.replace("min", " min")}</span>
                <small>{t === "pre" ? "baseline" : "after drug"}</small>
              </button>
            ))}
          </div>
          <span className="spacer" />
          <span className="run-id">{run.run_id}</span>
          <button className="ghost small" onClick={() => setTab("compare")}>
            Compare group →
          </button>
        </div>

      )}

      <main className={`layout ${tab !== "monitor" ? "two-col" : ""} ${tab === "compare" ? "no-controls" : ""}`}>
        <section className="stage">
          {tab === "monitor" ? (
            <section className="panel monitor-panel">
                <div className="monitor-head">
                  <div>
                    <h1>
                      {subject} <span className="sep">/</span> {condition}{" "}
                      <span className="sep">/</span> {timepointLabel}
                    </h1>
                    <div className="monitor-sub">
                      {selected.length} channels · {roiLabel(channelRoi)} · {vasCount} VAS7 / {innocuousCount} VAS3
                    </div>
                  </div>
                  <div className="monitor-right">
                    <div className="segmented compact">
                      <button
                        className={chartMode === "continuous" ? "active" : ""}
                        onClick={() => setChartMode("continuous")}
                      >
                        Continuous
                      </button>
                      <button
                        className={chartMode === "epoch" ? "active" : ""}
                        onClick={() => setChartMode("epoch")}
                      >
                        Trial HRF
                      </button>
                    </div>
                    <div className="monitor-clock">
                      <b>{fmtTime(playhead)}</b>
                      <span>/ {fmtTime(duration)}</span>
                    </div>
                  </div>
                </div>

                <div className={`phase-banner ${phase.cls}`}>
                  <div className="phase-icon" />
                  <div className="phase-copy">
                    <b>{phase.label}</b>
                    <p>{phase.text}</p>
                  </div>
                  {nextIn !== null && current?.next && (
                    <div className="next-chip">
                      next {current.next.type === "VAS7" ? "painful" : "innocuous"} in{" "}
                      <b>{nextIn.toFixed(0)} s</b>
                    </div>
                  )}
                </div>

                {chartMode === "continuous" ? (
                  <SignalChart
                    run={run}
                    selected={selected}
                    playhead={playhead}
                    follow={follow}
                    view={view}
                    highlight={highlight}
                    responseWindow={responseWindow}
                    showIndividual={showIndividual}
                    onSeek={(t) => {
                      setPlayhead(Math.max(0, Math.min(duration, t)));
                      setPlaying(false);
                    }}
                  />
                ) : (
                  <EpochChart run={run} selected={selected} showTrials={showTrials} showChannels={showIndividual} />
                )}

                <div className="chart-foot">
                  <div className="chart-guide">
                    {chartMode === "continuous" ? (
                      <>
                        <span><i className="legend-line hbo" /> HbO</span>
                        <span><i className="legend-line hbr" /> HbR</span>
                        <span><i className="legend-band pain" /> VAS7 pain</span>
                        <span><i className="legend-band safe" /> VAS3 safe</span>
                        <span><i className="legend-band resp" /> 5–15 s window</span>
                        <span className="watch-tip">Click trace to jump playhead</span>
                      </>
                    ) : (
                      <>
                        <span><i className="legend-band pain" /> 5 s stimulus</span>
                        <span><i className="legend-band resp" /> 7–10 s metric</span>
                        <span className="watch-tip">Live stimulus-locked average for selected channels</span>
                      </>
                    )}
                  </div>
                  <div className="chart-actions">
                    {chartMode === "continuous" && view && (
                      <button
                        className="link-btn"
                        onClick={() => {
                          setView(null);
                          setFollow(true);
                        }}
                      >
                        Reset zoom
                      </button>
                    )}
                    <button className="link-btn" onClick={() => setMethodsOpen(true)}>
                      Guide
                    </button>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={showIndividual}
                        onChange={(e) => setShowIndividual(e.target.checked)}
                      />
                      channels
                    </label>
                    {chartMode === "epoch" && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={showTrials}
                          onChange={(e) => setShowTrials(e.target.checked)}
                        />
                        individual trials
                      </label>
                    )}
                  </div>
                </div>

                <div className="event-ribbon">
                  <div className="ribbon-head">
                    <span>Stimulus timeline</span>
                    <span>{vasCount} painful · {innocuousCount} innocuous · full run {fmtTime(duration)}</span>
                  </div>
                  <div className="ribbon-track">
                    {run.events
                      .filter((e) => (e.type === "VAS7" || e.type === "VAS3") && !e.practice)
                      .map((e) => (
                        <button
                          key={`${e.type}-${e.onset}`}
                          className={`ribbon-tick ${e.type === "VAS7" ? "pain" : "safe"}`}
                          style={{ left: `${Math.min(99.5, (e.onset / duration) * 100)}%` }}
                          onClick={() => seekTo(e.onset)}
                          title={`${e.type === "VAS7" ? "Painful" : "Innocuous"} stimulus at ${fmtTime(e.onset)}`}
                        />
                      ))}
                    <div className="ribbon-now" style={{ left: `${Math.min(99.5, (playhead / duration) * 100)}%` }} />
                  </div>
                  <div className="ribbon-legend">
                    <span><i className="dot pain" /> painful (VAS7)</span>
                    <span><i className="dot safe" /> innocuous (VAS3)</span>
                    <span><i className="dot now" /> now</span>
                  </div>
                </div>

                <div className="transport">
                  <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
                    {playing ? "❚❚" : "▶"}
                  </button>
                  <input
                    className="scrub"
                    type="range"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={playhead}
                    onChange={(e) => {
                      setPlayhead(Number(e.target.value));
                      setPlaying(false);
                    }}
                  />
                  <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    {[1, 5, 10, 20, 60].map((s) => (
                      <option key={s} value={s}>
                        {s}×
                      </option>
                    ))}
                  </select>
                  <button className="ghost small" onClick={() => handleNextEvent("VAS7")}>
                    Next pain
                  </button>
                  <button className="ghost small" onClick={() => handleNextEvent("VAS3")}>
                    Next innocuous
                  </button>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={follow}
                      onChange={(e) => {
                        setFollow(e.target.checked);
                        if (e.target.checked) setView(null);
                      }}
                    />
                    follow 60 s
                  </label>
                  <button
                    className="ghost small"
                    onClick={() => {
                      setFollow(false);
                      setView(null);
                    }}
                  >
                    Full run
                  </button>
                </div>

                <div className="telemetry-strip">
                  <div className="tele-cell">
                    <div className="tele-head">
                      <span>HbO (10 s)</span>
                      <b className="tele-num">
                        {current?.hbo == null ? "—" : `${current.hbo >= 0 ? "+" : ""}${current.hbo.toFixed(3)}`} µM
                      </b>
                    </div>
                    <Sparkline values={spark} color="#dc2626" />
                  </div>
                  <div className="tele-cell">
                    <div className="tele-head">
                      <span>HbR (10 s)</span>
                      <b className="tele-num">
                        {current?.hbr == null ? "—" : `${current.hbr >= 0 ? "+" : ""}${current.hbr.toFixed(3)}`} µM
                      </b>
                    </div>
                    <div className="tele-bar">
                      <i style={{ width: `${Math.min(100, Math.abs((current?.hbr ?? 0) / 0.3) * 100)}%` }} />
                    </div>
                    <small className="tele-sub">vs preceding 10 s</small>
                  </div>
                  <div className="tele-cell">
                    <div className="tele-head">
                      <span>Signal QC</span>
                      <b className={`qc-tag ${qualityLabel.toLowerCase()}`}>{qualityLabel}</b>
                    </div>
                    <div className="tele-sub">
                      {current?.nGood ?? 0}/{current?.nChans ?? 0} usable · SCI {current?.sci?.toFixed(2) ?? "—"}
                      {current?.motion && <em className="warn"> · motion</em>}
                    </div>
                  </div>
                  <div className="tele-cell">
                    <div className="tele-head">
                      <span>Cycle</span>
                      <b className="tele-num">{phase.label}</b>
                    </div>
                    <div className="tele-sub">
                      {nextIn == null
                        ? "End of run"
                        : `Next ${current?.next?.type === "VAS7" ? "VAS7" : "VAS3"} in ${nextIn.toFixed(0)} s`}
                    </div>
                  </div>
                </div>
              </section>
          ) : tab === "pipeline" ? (
            <PipelineView
              runId={run.run_id}
              initialChannel={selected[0]}
              onAsk={(q) => handleSend(q)}
            />
          ) : (
            <CompareView group={group} onAsk={(q) => handleSend(q)} />
          )}
        </section>

        {tab === "monitor" && (
          <aside className="probe-column">

                <section className="panel scalp-panel">
                  <div className="panel-head tight">
                    <div>
                      <div className="eyebrow">Probe map</div>
                      <h3>{probeMode === "3d" ? "3D head model · 33 channels" : "Top view · 33 channels"}</h3>
                    </div>
                    <div className="probe-view-toggle">
                      <button className={probeMode === "3d" ? "active" : ""} onClick={() => setProbeMode("3d")}>
                        3D
                      </button>
                      <button className={probeMode === "2d" ? "active" : ""} onClick={() => setProbeMode("2d")}>
                        2D
                      </button>
                    </div>
                  </div>
                  {probeMode === "3d" ? (
                    <>
                      <BrainModel3D
                        channels={run.all_channels}
                        selected={selected}
                        values={current?.perChannel}
                        onToggle={(name) => {
                          toggleChannel(name);
                          const c = run.all_channels.find((x) => x.name === name);
                          if (c) setChannelRoi(c.roi);
                        }}
                      />
                      <p className="panel-note">
                        Generic anatomy (not participant MRI); 2D optode coords projected to scalp.
                      </p>
                    </>
                  ) : (
                    <>
                      <ScalpMap
                        channels={run.all_channels}
                        selected={selected}
                        values={current?.perChannel}
                        onToggle={(name) => {
                          toggleChannel(name);
                          const c = run.all_channels.find((x) => x.name === name);
                          if (c) setChannelRoi(c.roi);
                        }}
                      />
                      <p className="panel-note">
                        Top-down montage (nose at top). Click any dot to toggle; ★ = paper BA10 (C10, 14, 15, 16).
                      </p>
                    </>
                  )}
                </section>

                <section className="panel channels-panel">
                  <div className="panel-head tight">
                    <div>
                      <div className="eyebrow">Channel selection</div>
                      <h3>{selected.length} channels in the average</h3>
                    </div>
                    <div className="roi-buttons">
                      <button
                        className="ghost tiny"
                        onClick={() => {
                          if (!run) return;
                          const paper = run.all_channels
                            .filter((c) => [10, 14, 15, 16].includes(c.paper_index ?? -1))
                            .map((c) => c.name);
                          if (paper.length) {
                            setChannelRoi("medial_ba10");
                            setSelected(paper);
                          }
                        }}
                        title="Select Peng et al. 2018 medial BA10 channels (C10, C14, C15, C16)"
                      >
                        paper BA10
                      </button>
                      <button
                        className="ghost tiny"
                        onClick={() => {
                          if (!run) return;
                          const good = run.all_channels.filter((c) => c.roi === channelRoi && c.good).map((c) => c.name);
                          setSelected(good.slice(0, 8));
                        }}
                      >
                        all good
                      </button>
                      <button className="ghost tiny" onClick={() => setSelected([])}>
                        clear
                      </button>
                    </div>
                  </div>
                  <div className="roi-tabs">
                    {["medial_ba10", "left_pfc", "right_s1", "short"].map((r) => {
                      const inRoi = run.all_channels.filter((c) => c.roi === r);
                      const goodCount = inRoi.filter((c) => c.good).length;
                      return (
                        <button key={r} className={channelRoi === r ? "active" : ""} onClick={() => setChannelRoi(r)}>
                          <span>{r === "short" ? "Short 8mm" : roiLabel(r)}</span>
                          <small>{inRoi.length} ch · {goodCount} ok</small>
                        </button>
                      );
                    })}
                  </div>
                  <div className="channel-table">
                    {currentChannels.map((c) => {
                      const on = selected.includes(c.name);
                      return (
                        <button
                          key={c.name}
                          className={`channel-row ${on ? "on" : ""} ${c.good ? "" : "bad"}`}
                          onClick={() => toggleChannel(c.name)}
                          onDoubleClick={() => setSelected([c.name])}
                          title={`${c.name}${c.paper_index ? ` (paper C${c.paper_index})` : ""} · double-click to solo`}
                        >
                          <span className="checkbox">{on ? "✓" : ""}</span>
                          <span className="ch-name">{c.name}</span>
                          <span className={`ch-paper ${c.paper_index === 10 || c.paper_index === 14 || c.paper_index === 15 || c.paper_index === 16 ? "star" : ""}`}>
                            {c.paper_index ? `C${c.paper_index}` : "SC"}
                          </span>
                          <span className="ch-type">{c.short ? "Short (8 mm)" : roiLabel(c.roi)}</span>
                          <span className="ch-sci">
                            <i style={{ width: `${Math.max(0, Math.min(1, c.sci ?? 0)) * 100}%` }} />
                            <em>{c.sci != null ? c.sci.toFixed(2) : "—"}</em>
                          </span>
                          <span className={`ch-state ${c.good ? "ok" : "bad"}`}>{c.good ? "good" : "flagged"}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="panel-note">
                    Click to toggle, double-click to solo. SCI &lt; 0.70 flags poor cardiac coupling.
                  </p>
                </section>
          </aside>
        )}

        <ChatPanel
          messages={messages}
          streaming={streaming}
          status={status}
          trace={trace}
          evidenceById={evidenceById}
          citationWarning={citationWarning}
          suggestions={SUGGESTIONS}
          context={`${subject} · ${condition} · ${timepointLabel} · ${fmtTime(playhead)}`}
          onSend={handleSend}
          onClear={() => {
            setMessages([]);
            setTrace([]);
            setCitationWarning(null);
          }}
          onOpenEvidence={openEvidenceById}
        />
      </main>

      <EvidenceDrawer evidence={openEvidence} onClose={() => setOpenEvidence(null)} />
      <MethodsDrawer open={methodsOpen} onClose={() => setMethodsOpen(false)} />
    </div>
  );
}

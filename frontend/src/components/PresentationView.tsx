import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { getPipeline } from "../api";
import BrainModel3D from "./BrainModel3D";
import EpochChart from "./EpochChart";
import ScalpMap from "./ScalpMap";
import type { GroupSummary, PipelineData, RunData } from "../types";

interface Props {
  run: RunData;
  group: GroupSummary | null;
  onExit: () => void;
  onJump: (tab: "monitor" | "pipeline" | "compare") => void;
}

interface SlideMeta {
  id: string;
  num: string;
  section: string;
  short: string;
  title: string;
  subtitle: string;
  note: string;
}

const SLIDES: SlideMeta[] = [
  {
    id: "s01", num: "01", section: "1 · Introduction", short: "Overview",
    title: "Grounded fNIRS Analysis of Pain-Evoked Prefrontal Deactivation and Morphine Attenuation",
    subtitle: "Deterministic signal processing, interactive spatial replay, and tool-orchestrated analysis on OpenNeuro ds005777.",
    note: "Frame the core principle: this is a deterministic neuroimaging engine paired with an LLM orchestrator—every quoted statistic links to computed evidence.",
  },
  {
    id: "s02", num: "02", section: "1 · Introduction", short: "Problem",
    title: "Research Motivation: Signal Confounds and AI Grounding",
    subtitle: "Separating subtle cortical haemodynamics from extracerebral physiology while preventing statistical hallucination in language models.",
    note: "Highlight the two gaps solved together: biological/mechanical signal noise (~73% scalp) and ungrounded LLM fabrication.",
  },
  {
    id: "s03", num: "03", section: "1 · Introduction", short: "Literature",
    title: "Prior Literature & Study Objectives (Peng et al., 2018)",
    subtitle: "Independently re-evaluating morphine-induced attenuation of noxious BA10 deactivation through an auditable analytical pipeline.",
    note: "Explain that medial BA10 belongs to the Default Mode Network: acute pain suppresses it (downward HbO dip), and morphine blunts that dip.",
  },
  {
    id: "s04", num: "04", section: "1 · Introduction", short: "Protocol",
    title: "Experimental Protocol: Double-Blind Crossover Trial",
    subtitle: "Fourteen volunteers assessed across oral morphine (15 mg) and placebo visits from pre-drug baseline through 90 minutes post-dose.",
    note: "Emphasize within-subject crossover control and mention the BIDS scans.tsv timestamp assumption upfront.",
  },
  {
    id: "s05", num: "05", section: "2 · Paradigm & Portal", short: "Paradigm",
    title: "Stimulation Paradigm, Trial Timing & Practice Exclusion",
    subtitle: "Calibrated noxious (VAS 7) and innocuous (VAS 3) electrical pulses across 6.5-minute scans sampled at 25 Hz.",
    note: "Point out that the t = 30 s practice pulse is intentionally excluded from scoring, and each scored trial uses −5..0 s baseline subtraction.",
  },
  {
    id: "s06", num: "06", section: "2 · Paradigm & Portal", short: "Live Monitor",
    title: "Portal Component: Live Signal Monitor & Telemetry Strip",
    subtitle: "Synchronized replay, causal 30 s display centering, static-playhead timepoint switching, and live physiological QC readouts.",
    note: "Explain why preserving the playhead timestamp across Pre/30/60/90 min makes side-by-side comparison immediate.",
  },
  {
    id: "s07", num: "07", section: "2 · Paradigm & Portal", short: "3D/2D Probes",
    title: "Portal Component: Live 3D Head/Brain Mesh & 2D Montage",
    subtitle: "Thirty-three source–detector pairs across Medial BA10, Left PFC, Right S1, and 8 mm superficial short channels.",
    note: "Rotate the 3D head or switch to Brain view, and click any spaced 2D mini-grid dot to show synchronized selection.",
  },
  {
    id: "s08", num: "08", section: "2 · Paradigm & Portal", short: "ROI Averaging",
    title: "Portal Component: Channel Selection & Spatial ROI Averaging",
    subtitle: "Combining selected cortical channels into an arithmetic ROI mean ± SEM while keeping low-SCI channels transparently flagged.",
    note: "Show how averaging neighboring channels reduces local vascular variance while flagging SCI < 0.70 channels rather than hiding them.",
  },
  {
    id: "s09", num: "09", section: "3 · 7-Stage Pipeline", short: "1 · Raw Light",
    title: "Pipeline Step 1: Raw Light Intensity & Contact Stability (CV)",
    subtitle: "Continuous 25 Hz photon counts at 690 nm and 830 nm modulated by arterial blood pulsations and baseline tissue attenuation.",
    note: "Zoom between 15 s pulse and 40 s window to show individual cardiac beats riding on raw detector intensity.",
  },
  {
    id: "s10", num: "10", section: "3 · 7-Stage Pipeline", short: "2 · OD & SCI",
    title: "Pipeline Step 2: Optical Density (ΔOD) & Cardiac Coupling (SCI)",
    subtitle: "Log-normalised light absorption, Welch power spectral decomposition, and dual-wavelength cardiac correlation QC.",
    note: "Point to the ~1.02 Hz spike in the Welch PSD: synchronized cardiac pulses across 690 & 830 nm prove physical skin coupling.",
  },
  {
    id: "s11", num: "11", section: "3 · 7-Stage Pipeline", short: "3 · TDDR",
    title: "Pipeline Step 3: Motion Artefact Correction via TDDR",
    subtitle: "Temporal Derivative Distribution Repair suppresses abrupt mechanical displacement spikes while preserving slow haemodynamics.",
    note: "Step through 1. Motion Spike → 2. Derivative Gate & Tukey weight → 3. Integrated ΔOD′ to show how mechanical jolts are repaired.",
  },
  {
    id: "s12", num: "12", section: "3 · 7-Stage Pipeline", short: "4 · MBLL",
    title: "Pipeline Step 4: Optical Scattering Physics & Beer–Lambert Law",
    subtitle: "Dual-wavelength spectroscopy (DPF = 6.0) translating ΔOD into micromolar (ΔHbO, ΔHbR) concentration changes.",
    note: "Adjust the DPF slider and toggle 30 mm vs 8 mm paths to illustrate why photons traverse an ~18 cm scattered arc through skull.",
  },
  {
    id: "s13", num: "13", section: "3 · 7-Stage Pipeline", short: "5 · Short Ch.",
    title: "Pipeline Step 5: Superficial Physiology Removal (8 mm Regression)",
    subtitle: "Ordinary least-squares regression against the nearest 8 mm scalp channel eliminates ~73.9% extracerebral noise.",
    note: "Contrast Step 3 (mechanical movement) with Step 5 (biological skin blood flow) and toggle β₁ subtraction to show noise removal.",
  },
  {
    id: "s14", num: "14", section: "3 · 7-Stage Pipeline", short: "6 · Band-Pass",
    title: "Pipeline Step 6: Zero-Phase Band-Pass Filtering (0.01–0.20 Hz)",
    subtitle: "4th-order Butterworth zero-phase filtering isolates cortical haemodynamics while attenuating slow drift and ~1 Hz pulse.",
    note: "Show the frequency-domain PSD drop above 0.20 Hz confirming complete cardiac/respiratory rejection without phase delay.",
  },
  {
    id: "s15", num: "15", section: "3 · 7-Stage Pipeline", short: "7 · Trial HRF",
    title: "Pipeline Step 7: Stimulus-Locked Epoching & Live Trial HRF",
    subtitle: "Baseline-corrected (−5..0 s) trial averaging across −5 to +25 s reveals BA10 Default Mode Network deactivation to pain.",
    note: "Toggle channels and individual trials on the live EpochChart and hover curves to show sensor-level provenance.",
  },
  {
    id: "s16", num: "16", section: "4 · System, Results & Refs", short: "Brain Analyst",
    title: "Portal Component: Brain Analyst, Tool Trace & [E#] Evidence Drawer",
    subtitle: "Eleven typed Python tools, inspectable execution traces, publication-style evidence figures, and principled clinical refusal.",
    note: "Demonstrate both quantitative grounding (p, q, dz, [E1]) and boundary enforcement when asked to diagnose pain.",
  },
  {
    id: "s17", num: "17", section: "4 · System, Results & Refs", short: "Group Results",
    title: "Portal Component: Group Statistics (Morphine vs. Placebo, n = 14)",
    subtitle: "Within-morphine attenuation reaches significance at 90 min (p = 0.018), while direct morphine−placebo contrast remains trend-level.",
    note: "Switch between Mean 7–10 s and Nadir 5–15 s; highlight honest reporting of trend-level between-condition contrast (q = 0.375).",
  },
  {
    id: "s18", num: "18", section: "4 · System, Results & Refs", short: "References",
    title: "References, Validation Summary & Live Portal Handoff",
    subtitle: "Primary citations [1]–[7], verification summary (negative control p = 0.002; 4/4 pytest), caveats, and portal launch.",
    note: "Summarize verification and limitations briefly, then jump straight into Monitor, Pipeline, or Compare for live Q&A.",
  },
];

const PIPELINE_STEPS = [
  { slideIdx: 8, num: "1", label: "Raw Light" },
  { slideIdx: 9, num: "2", label: "OD & SCI" },
  { slideIdx: 10, num: "3", label: "TDDR" },
  { slideIdx: 11, num: "4", label: "MBLL" },
  { slideIdx: 12, num: "5", label: "Short Ch." },
  { slideIdx: 13, num: "6", label: "Band-Pass" },
  { slideIdx: 14, num: "7", label: "Trial HRF" },
];

const REFERENCES = [
  { id: 1, cite: "Peng K. et al. (2018). Morphine attenuates fNIRS signal associated with painful stimuli in the medial frontopolar cortex (BA10). Frontiers in Human Neuroscience, 12:394." },
  { id: 2, cite: "OpenNeuro Dataset ds005777 (v1.0.1) — Electrical_Morphine_Placebo_2018 (14 subjects, 113 fNIRS runs, SNIRF + BIDS)." },
  { id: 3, cite: "MNE-Python & MNE-NIRS Standards: Optical Density, Modified Beer–Lambert Law (DPF = 6), Pollonini et al. (2014) SCI, Fishburn et al. (2019) TDDR, Short-Channel Regression." },
  { id: 4, cite: "AI Neuroscientist (2026). Tool-augmented scientific orchestration for neuroimaging workflows. arXiv:2609.25254." },
  { id: 5, cite: "BrainBench (2026). Evaluating factual grounding and uncertainty calibration in neuroscience AI assistants. arXiv:2608.04156." },
  { id: 6, cite: "NeuraDock (2026). Boundary-aware clinical AI grounding and principled refusal under proxy measurements. arXiv:2606.26519." },
  { id: 7, cite: "3D Anatomical Assets: Lee Perry-Smith Head Scan (Infinite-Realities, CC BY 3.0) & Innerscene Sculpted Brain Mesh (CC0)." },
];

/* ---- Realistic mathematical physiological waveform generators ---- */
function buildSvgPath(
  fn: (t: number) => number,
  t0: number,
  t1: number,
  x0: number,
  x1: number,
  yZero: number,
  yScale: number,
  steps = 200,
) {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = t0 + u * (t1 - t0);
    const x = x0 + u * (x1 - x0);
    const y = yZero - fn(t) * yScale;
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

const cardiacPulse = (t: number) =>
  0.65 * Math.sin(2 * Math.PI * 1.02 * t) +
  0.34 * Math.sin(4 * Math.PI * 1.02 * t - 0.85) +
  0.14 * Math.sin(6 * Math.PI * 1.02 * t - 1.6);

const breathWave = (t: number) => 0.45 * Math.sin(2 * Math.PI * 0.26 * t + 0.4);

const painHrf = (t: number, amp = 1.0) => {
  if (t <= 0.5) return 0;
  const x = (t - 0.5) / 2.6;
  return -amp * Math.pow(x, 2.4) * Math.exp(2.4 * (1 - x));
};

const motionSpike = (t: number, ts = 6.2) => {
  const dt = t - ts;
  return 2.6 * Math.exp(-(dt * dt) / 0.04) - 1.1 * Math.exp(-((dt - 0.35) ** 2) / 0.08);
};

function FullPlot({
  traces,
  layout,
  height = 290,
}: {
  traces: any[];
  layout: Record<string, unknown>;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    Plotly.react(
      ref.current,
      traces,
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "#ffffff",
        font: { color: "#374151", size: 11, family: "Inter, system-ui, sans-serif" },
        height,
        margin: { l: 50, r: 14, t: 38, b: 34 },
        legend: { orientation: "h", y: 1.14, x: 0, font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
        xaxis: { gridcolor: "#f1f5f9", zeroline: false },
        yaxis: { gridcolor: "#f1f5f9", zeroline: true, zerolinecolor: "#cbd5e1" },
        ...layout,
      },
      { responsive: true, displaylogo: false, displayModeBar: false },
    );
  }, [traces, layout, height]);
  useEffect(() => () => { if (ref.current) Plotly.purge(ref.current); }, []);
  return <div className="chart" style={{ height }} ref={ref} />;
}

/** Full-screen 18-slide interactive academic presentation deck with live dashboard modules and animations. */
export default function PresentationView({ run, group, onExit, onJump }: Props) {
  const [idx, setIdx] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const [designTp, setDesignTp] = useState<"pre" | "30" | "60" | "90">("pre");
  const [scanTick, setScanTick] = useState(20);
  const [monTick, setMonTick] = useState(35);
  const [presSelected, setPresSelected] = useState<string[]>(() => run.default_channels);
  const [pipeZoom, setPipeZoom] = useState<"15s" | "40s">("40s");
  const [sciDemo, setSciDemo] = useState<"good" | "bad">("good");
  const [tddrPhase, setTddrPhase] = useState<"raw" | "weights" | "clean">("weights");
  const [channelType, setChannelType] = useState<"long" | "short">("long");
  const [dpfVal, setDpfVal] = useState<number>(6.0);
  const [applyScReg, setApplyScReg] = useState<boolean>(true);
  const [showTrials, setShowTrials] = useState(true);
  const [showChannels, setShowChannels] = useState(false);
  const [guardrail, setGuardrail] = useState<"supported" | "unsafe">("supported");
  const [resMetric, setResMetric] = useState<"mean_7_10" | "nadir_5_15">("mean_7_10");
  const [pipeData, setPipeData] = useState<PipelineData | null>(null);

  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    let cancelled = false;
    getPipeline(run.run_id, "S4-D5")
      .then((d) => { if (!cancelled) setPipeData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [run.run_id]);

  useEffect(() => {
    const idName = SLIDES[idx].id;
    if (idName !== "s05" && idName !== "s06") return;
    const id = window.setInterval(() => {
      if (idName === "s05") setScanTick((t) => (t + 1) % 100);
      if (idName === "s06") setMonTick((t) => (t + 1) % 100);
    }, 130);
    return () => window.clearInterval(id);
  }, [idx]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore browser denial */
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        e.stopPropagation();
        setIdx((i) => Math.min(SLIDES.length - 1, i + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        e.stopPropagation();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Escape" && !document.fullscreenElement) {
        e.preventDefault();
        e.stopPropagation();
        onExitRef.current();
      } else if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowNotes((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [toggleFullscreen]);

  const slide = SLIDES[idx];
  const jumpRef = () => setIdx(SLIDES.length - 1);
  const Cite = ({ nums }: { nums: number[] }) => (
    <button type="button" className="pres-cite" onClick={jumpRef} title={`Reference [${nums.join(", ")}]`}>
      [{nums.join(", ")}]
    </button>
  );

  const togglePresChannel = (name: string) => {
    setPresSelected((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : prev.length < 10 ? [...prev, name] : prev,
    );
  };

  const svgPaths = useMemo(() => {
    const rawComposite = buildSvgPath(
      (t) => 0.72 * cardiacPulse(t) + 0.42 * breathWave(t) + 0.35 * Math.sin(0.35 * t) + motionSpike(t, 6.2) * 0.45,
      0, 12, 20, 480, 62, 20, 260,
    );
    const cardiacOnly = buildSvgPath((t) => cardiacPulse(t), 0, 7, 20, 460, 46, 22, 220);
    const breathOnly = buildSvgPath((t) => breathWave(t) + 0.3 * Math.sin(0.6 * t), 0, 12, 20, 460, 125, 22, 160);
    const hrfClean = buildSvgPath((t) => painHrf(t - 3.5, 1.0), 0, 16, 20, 460, 215, 42, 180);
    const hrfAtten = buildSvgPath((t) => painHrf(t - 3.5, 0.28), 0, 16, 45, 450, 115, 76, 160);
    const hrfDeep = buildSvgPath((t) => painHrf(t - 3.5, 1.0), 0, 16, 45, 450, 115, 76, 160);

    const ch1 = buildSvgPath((t) => painHrf(t - 3.5, 0.95) + 0.14 * Math.sin(1.9 * t), 0, 16, 20, 460, 80, 48, 160);
    const ch2 = buildSvgPath((t) => painHrf(t - 3.5, 1.12) - 0.11 * Math.cos(2.4 * t), 0, 16, 20, 460, 80, 48, 160);
    const ch3 = buildSvgPath((t) => painHrf(t - 3.5, 0.82) + 0.12 * Math.sin(3.1 * t + 1), 0, 16, 20, 460, 80, 48, 160);
    const ch4 = buildSvgPath((t) => painHrf(t - 3.5, 1.06) + 0.10 * Math.cos(1.5 * t - 0.5), 0, 16, 20, 460, 80, 48, 160);
    const chMean = buildSvgPath((t) => painHrf(t - 3.5, 0.99), 0, 16, 20, 460, 204, 48, 160);
    const s01Hrf = buildSvgPath((t) => painHrf(t - 3.5, 1.0), 0, 16, 20, 480, 184, 52, 160);

    const tddrDirty = buildSvgPath((t) => 0.25 * Math.sin(0.8 * t) + 0.18 * cardiacPulse(t) + motionSpike(t, 5.5), 0, 12, 20, 445, 62, 18, 240);
    const tddrFixed = buildSvgPath((t) => 0.25 * Math.sin(0.8 * t) + 0.18 * cardiacPulse(t), 0, 12, 20, 445, 62, 18, 240);
    const tddrDeriv = buildSvgPath((t) => 0.18 * Math.cos(2 * Math.PI * t) + (Math.abs(t - 5.5) < 0.45 ? 2.4 * Math.cos(14 * (t - 5.5)) * Math.exp(-((t - 5.5) ** 2) / 0.03) : 0), 0, 12, 20, 445, 62, 16, 240);
    const tddrWeight = buildSvgPath((t) => 1.0 - 0.94 * Math.exp(-((t - 5.5) ** 2) / 0.09), 0, 12, 20, 445, 98, 72, 200);

    const sciGood690 = buildSvgPath((t) => cardiacPulse(t) + 0.15 * Math.sin(0.6 * t), 0, 6.5, 18, 445, 54, 20, 200);
    const sciGood830 = buildSvgPath((t) => 0.85 * cardiacPulse(t) + 0.15 * Math.sin(0.6 * t), 0, 6.5, 18, 445, 57, 20, 200);
    const sciBad690 = buildSvgPath((t) => 0.55 * Math.sin(7.3 * t) + 0.42 * Math.cos(11.1 * t) + 0.3 * Math.sin(2.9 * t), 0, 6.5, 18, 445, 54, 18, 200);
    const sciBad830 = buildSvgPath((t) => 0.48 * Math.cos(6.1 * t + 1) + 0.45 * Math.sin(13.7 * t) - 0.3 * Math.cos(3.4 * t), 0, 6.5, 18, 445, 57, 18, 200);

    const scLongRaw = buildSvgPath((t) => 0.8 * breathWave(t) + 0.5 * Math.sin(0.45 * t) + painHrf(t - 3.5, 0.8), 0, 16, 20, 445, 54, 26, 180);
    const scClean = buildSvgPath((t) => painHrf(t - 3.5, 0.8), 0, 16, 20, 445, 54, 26, 180);

    return {
      rawComposite, cardiacOnly, breathOnly, hrfClean, hrfAtten, hrfDeep,
      ch1, ch2, ch3, ch4, chMean, s01Hrf,
      tddrDirty, tddrFixed, tddrDeriv, tddrWeight,
      sciGood690, sciGood830, sciBad690, sciBad830,
      scLongRaw, scClean,
    };
  }, []);

  const groupCharts = useMemo(() => {
    const between = group?.between_condition?.VAS7?.medial_ba10?.[resMetric] ?? null;
    const withinMor = group?.within_condition?.morphine?.VAS7?.medial_ba10?.[resMetric] ?? null;
    const withinPla = group?.within_condition?.placebo?.VAS7?.medial_ba10?.[resMetric] ?? null;
    if (!between) return null;
    const tps = ["pre", "30min", "60min", "90min"];
    const pt90 = between["90min"];
    const mor90 = withinMor?.["90min"];
    const pla90 = withinPla?.["90min"];

    const timeTraces = [
      {
        x: [0, 1, 2, 3],
        y: tps.map((t) => between[t]?.morphine_mean ?? null),
        error_y: { type: "data", array: tps.map((t) => between[t]?.morphine_sem ?? 0), color: "#dc2626", thickness: 1.2 },
        type: "scatter", mode: "lines+markers", name: "Morphine",
        line: { color: "#dc2626", width: 2.4 }, marker: { size: 7 },
      },
      {
        x: [0, 1, 2, 3],
        y: tps.map((t) => between[t]?.placebo_mean ?? null),
        error_y: { type: "data", array: tps.map((t) => between[t]?.placebo_sem ?? 0), color: "#2563eb", thickness: 1.2 },
        type: "scatter", mode: "lines+markers", name: "Placebo",
        line: { color: "#2563eb", width: 2.4 }, marker: { size: 7 },
      },
    ];
    const subjects = pt90?.per_subject?.map((p) => p.subject.replace("sub-", "s")) ?? [];
    const xs: (string | null)[] = [];
    const ys: (number | null)[] = [];
    pt90?.per_subject?.forEach((p) => {
      const s = p.subject.replace("sub-", "s");
      xs.push(s, s, null);
      ys.push(p.morphine, p.placebo, null);
    });
    const pairedTraces = [
      { x: subjects, y: pt90?.per_subject?.map((p) => p.morphine) ?? [], type: "scatter", mode: "markers", name: "Morphine", marker: { color: "#dc2626", size: 7 } },
      { x: subjects, y: pt90?.per_subject?.map((p) => p.placebo) ?? [], type: "scatter", mode: "markers", name: "Placebo", marker: { color: "#2563eb", size: 7 } },
      { x: xs, y: ys, type: "scatter", mode: "lines", showlegend: false, line: { color: "#9ca3af", width: 0.9 }, hoverinfo: "skip" },
    ];
    return { pt90, mor90, pla90, timeTraces, pairedTraces };
  }, [group, resMetric]);

  const xWin = pipeZoom === "15s" ? [146, 162] : [135, 175];

  const scanPhaseInfo =
    scanTick < 16
      ? { cls: "idle", label: "Baseline & Practice Trial (t = 30 s, excluded)", desc: "Initial warm-up pulse (practice: true) settles the subject and is excluded from HRF statistics." }
      : scanTick < 33
        ? { cls: "stim", label: "Stimulus ON (0–5 s Electrical Pulse)", desc: "Calibrated painful (VAS 7) or innocuous (VAS 3) current fires; vascular lag has not developed." }
        : scanTick < 63
          ? { cls: "resp", label: "Evoked Cortical Window (5–15 s · BA10 Nadir)", desc: "Noxious stimulation suppresses medial BA10 Default Mode activity, yielding a ΔHbO dip around 7–11 s." }
          : { cls: "rec", label: "Post-Stimulus Recovery (15–25 s)", desc: "Local oxygenation returns smoothly toward resting baseline prior to the next trial." };

  const monHboVal = (-0.04 - 0.11 * Math.max(0, Math.sin((monTick / 100) * Math.PI))).toFixed(3);
  const isPipelineSlide = idx >= 8 && idx <= 14;

  const PipelineRail = () => (
    <div className="pipe-rail-bar">
      <div className="pipe-rail">
        {PIPELINE_STEPS.map((st) => (
          <button
            key={st.num}
            type="button"
            className={`pipe-rail-step ${idx === st.slideIdx ? "active" : idx > st.slideIdx ? "done" : ""}`}
            onClick={() => setIdx(st.slideIdx)}
          >
            <span>{st.num}</span>
            <small>{st.label}</small>
          </button>
        ))}
      </div>
      {idx !== 14 && (
        <div className="ed-toggle-pill">
          <button type="button" className={pipeZoom === "15s" ? "active" : ""} onClick={() => setPipeZoom("15s")}>15s Pulse Zoom</button>
          <button type="button" className={pipeZoom === "40s" ? "active" : ""} onClick={() => setPipeZoom("40s")}>40s Window</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="deck-shell" role="region" aria-label="Research seminar presentation">
      <header className="deck-top">
        <div className="deck-brand">
          <span className="brand-mark">◉</span>
          <div>
            <b>Chat With My Brain</b>
            <span>{slide.section}</span>
          </div>
        </div>

        <nav className="deck-dots" aria-label="Slide navigation">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`deck-dot ${i === idx ? "active" : i < idx ? "done" : ""}`}
              onClick={() => setIdx(i)}
              title={`${s.num}. ${s.short} — ${s.title}`}
            >
              {s.num}
            </button>
          ))}
        </nav>

        <div className="deck-actions">
          <button type="button" className="ghost small" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
            ← Prev
          </button>
          <span className="deck-counter">{slide.num} / {SLIDES.length}</span>
          <button type="button" className="ghost small" onClick={() => setIdx((i) => Math.min(SLIDES.length - 1, i + 1))} disabled={idx === SLIDES.length - 1}>
            Next →
          </button>
          <button type="button" className={`ghost small ${showNotes ? "active-btn" : ""}`} onClick={() => setShowNotes((v) => !v)} title="Toggle presenter cue (N)">
            Notes
          </button>
          <button type="button" className="ghost small" onClick={toggleFullscreen} title="Toggle fullscreen (F)">
            {isFullscreen ? "Exit FS" : "⛶ Fullscreen"}
          </button>
          <button type="button" className="deck-exit" onClick={onExit}>
            Exit <kbd>Esc</kbd>
          </button>
        </div>
      </header>

      <main className="deck-stage">
        <div key={slide.id} className="deck-slide">
          <header className="deck-head">
            <div className="deck-eyebrow">
              <span>{slide.section} · Slide {slide.num} of {SLIDES.length}</span>
              <span>OpenNeuro ds005777 · Peng et al., 2018</span>
            </div>
            <h1>{slide.title}</h1>
            <p className="deck-lead">{slide.subtitle}</p>
          </header>

          {isPipelineSlide && <PipelineRail />}

          {/* 01 · OVERVIEW */}
          {slide.id === "s01" && (
            <div className="deck-split ed-55-45">
              <div className="ed-col">
                <div className="ed-abstract">
                  <div className="ed-kicker-block">RESEARCH SUMMARY</div>
                  <p>
                    Functional near-infrared spectroscopy (fNIRS) measures prefrontal haemodynamic responses to acute pain non-invasively, yet raw optical recordings are confounded by systemic scalp perfusion and motion while ungrounded language models risk fabricating quantitative results. <Cite nums={[1, 4]} />
                  </p>
                  <p style={{ marginTop: 8 }}>
                    This work integrates a deterministic 7-stage signal engine, live 3D/2D spatial replay, and 11 typed Python tools so every analytical answer cites verifiable figures and caveats.
                  </p>
                </div>
                <div className="ed-kicker-block" style={{ marginTop: 4 }}>SEMINAR OUTLINE</div>
                <ol className="agenda-list">
                  <li><button type="button" onClick={() => setIdx(1)}><b>01 · Motivation, Literature &amp; Protocol</b><span>Signal confounds, Peng et al. (2018) &amp; crossover design</span></button></li>
                  <li><button type="button" onClick={() => setIdx(4)}><b>02 · Paradigm &amp; Portal Components</b><span>Monitor replay, 3D/2D probes &amp; spatial ROI averaging</span></button></li>
                  <li><button type="button" onClick={() => setIdx(8)}><b>03 · Seven-Stage Signal Pipeline</b><span>Dedicated step-by-step physics, filtering &amp; trial HRF</span></button></li>
                  <li><button type="button" onClick={() => setIdx(15)}><b>04 · Brain Analyst &amp; Group Findings</b><span>11 tools, [E#] drawer &amp; 14-subject crossover statistics</span></button></li>
                  <li><button type="button" onClick={() => setIdx(17)}><b>05 · References &amp; Live Portal Handoff</b><span>Citations [1]–[7], validation summary &amp; live system demo</span></button></li>
                </ol>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">PHYSIOLOGICAL-TO-EVIDENCE PIPELINE</div>
                <svg viewBox="0 0 500 310" className="ed-svg">
                  <rect x="0" y="0" width="500" height="310" fill="#f8fafc" rx="10" />
                  <text x="20" y="24" fontSize="10" fontWeight="700" fill="#64748b">1. COMPOSITE 25 HZ RECORDING (CARDIAC + RESPIRATION + MOTION)</text>
                  <path d={svgPaths.rawComposite} fill="none" stroke="#64748b" strokeWidth="1.9" />
                  <circle r="4.5" fill="#0f766e"><animateMotion dur="2.8s" repeatCount="indefinite" path={svgPaths.rawComposite} /></circle>
                  <line x1="250" y1="98" x2="250" y2="128" stroke="#0f766e" strokeWidth="2" className="anim-stream" />
                  <text x="250" y="144" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0f766e">2. SEVEN DETERMINISTIC SIGNAL STAGES → CLEAN BA10 HRF</text>
                  <rect x="120" y="156" width="60" height="86" fill="rgba(220,38,38,0.08)" />
                  <line x1="20" y1="184" x2="480" y2="184" stroke="#cbd5e1" strokeDasharray="3 3" />
                  <path d={svgPaths.s01Hrf} fill="none" stroke="#dc2626" strokeWidth="3" />
                  <circle r="5" fill="#dc2626"><animateMotion dur="2.8s" repeatCount="indefinite" path={svgPaths.s01Hrf} /></circle>
                  <line x1="250" y1="242" x2="250" y2="268" stroke="#0f766e" strokeWidth="2" className="anim-stream" />
                  <text x="250" y="288" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#111827">3. TYPED PYTHON TOOLS → REPRODUCIBLE [E#] EVIDENCE CARDS</text>
                </svg>
              </div>
            </div>
          )}

          {/* 02 · MOTIVATION */}
          {slide.id === "s02" && (
            <div className="deck-split ed-45-55">
              <div className="ed-col">
                <div className="ed-statement">
                  <span className="ed-num">01</span>
                  <div>
                    <h3>Multicomponent Physiological Confounds</h3>
                    <p>Raw forehead recordings superpose ~1 Hz cardiac pulses, ~0.26 Hz breathing, ~73% scalp blood flow, and abrupt motion slips atop a subtle ~0.1 µM cortical response.</p>
                  </div>
                </div>
                <div className="ed-statement">
                  <span className="ed-num">02</span>
                  <div>
                    <h3>Quantitative Hallucination in LLMs</h3>
                    <p>Direct prompting over raw numerical traces risks fabricated p-values, missed multiple-comparison corrections, and unsupported clinical diagnoses. <Cite nums={[4, 6]} /></p>
                  </div>
                </div>
                <div className="ed-statement">
                  <span className="ed-num">03</span>
                  <div>
                    <h3>Deterministic Grounding Mandate</h3>
                    <p>All filtering and inference run locally in audited Python; the LLM acts strictly as a tool orchestrator bound to generated evidence figures.</p>
                  </div>
                </div>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">PHYSIOLOGICAL COMPONENT DECOMPOSITION (SMOOTH HARMONICS)</div>
                <svg viewBox="0 0 480 285" className="ed-svg">
                  <rect x="0" y="0" width="480" height="285" rx="10" fill="#f8fafc" />
                  <text x="20" y="22" fontSize="10" fontWeight="700" fill="#b91c1c">ARTERIAL CARDIAC PULSE (~1.02 HZ · SYSTOLE + DICROTIC NOTCH)</text>
                  <path d={svgPaths.cardiacOnly} fill="none" stroke="#dc2626" strokeWidth="2.2" />
                  <circle r="4" fill="#dc2626"><animateMotion dur="2.5s" repeatCount="indefinite" path={svgPaths.cardiacOnly} /></circle>

                  <text x="20" y="96" fontSize="10" fontWeight="700" fill="#b45309">RESPIRATION &amp; MAYER WAVES (~0.1–0.3 HZ · SCALP CONFOUND)</text>
                  <path d={svgPaths.breathOnly} fill="none" stroke="#d97706" strokeWidth="2.2" />
                  <circle r="4" fill="#d97706"><animateMotion dur="3.4s" repeatCount="indefinite" path={svgPaths.breathOnly} /></circle>

                  <text x="20" y="170" fontSize="10" fontWeight="700" fill="#0f766e">EVOKED CORTICAL HRF (0.01–0.20 HZ · BA10 DEACTIVATION)</text>
                  <rect x="115" y="178" width="52" height="90" fill="rgba(220,38,38,0.07)" />
                  <line x1="20" y1="215" x2="460" y2="215" stroke="#cbd5e1" strokeDasharray="3 3" />
                  <path d={svgPaths.hrfClean} fill="none" stroke="#0f766e" strokeWidth="3" />
                  <circle r="4.5" fill="#0f766e"><animateMotion dur="3.2s" repeatCount="indefinite" path={svgPaths.hrfClean} /></circle>
                </svg>
              </div>
            </div>
          )}

          {/* 03 · PRIOR LITERATURE & OBJECTIVES */}
          {slide.id === "s03" && (
            <div className="deck-split ed-50-50">
              <div className="ed-col">
                <div className="ed-kicker-block">FOUNDATIONAL LITERATURE · PENG ET AL. (2018) <Cite nums={[1, 2]} /></div>
                <h3>Published Evidence &amp; Study Objectives</h3>
                <ul className="ed-list">
                  <li><b>Cortical pain signature:</b> Noxious electrical stimulation (VAS 7) elicits reproducible negative ΔHbO deactivation in medial frontopolar cortex (BA10), consistent with Default Mode Network suppression.</li>
                  <li><b>Pharmacological hypothesis:</b> Oral morphine (15 mg) attenuates this prefrontal deactivation relative to placebo (reported maximal at 60 min in the original study).</li>
                  <li><b>Our three objectives:</b> (1) Build an open, stage-inspectable deterministic pipeline; (2) Re-evaluate within-visit and drug-vs-placebo effects with FDR control; (3) Ground conversational querying in Python tools and <code>[E#]</code> figures.</li>
                </ul>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">GAMMA-MODELLED ANALGESIC ATTENUATION CURVES</div>
                <svg viewBox="0 0 480 275" className="ed-svg">
                  <rect x="0" y="0" width="480" height="275" rx="10" fill="#f8fafc" />
                  <line x1="45" y1="115" x2="450" y2="115" stroke="#cbd5e1" strokeWidth="1.2" />
                  <text x="38" y="119" textAnchor="end" fontSize="10" fill="#6b7280">0 µM</text>
                  <rect x="130" y="45" width="55" height="185" fill="rgba(220,38,38,0.07)" />
                  <text x="157" y="60" textAnchor="middle" fontSize="9.5" fill="#b91c1c" fontWeight="600">VAS7 (5 s)</text>
                  <path d={svgPaths.hrfDeep} fill="none" stroke="#dc2626" strokeWidth="3.2" />
                  <circle r="5" fill="#dc2626"><animateMotion dur="2.8s" repeatCount="indefinite" path={svgPaths.hrfDeep} /></circle>
                  <text x="260" y="232" textAnchor="middle" fontSize="10.5" fill="#b91c1c" fontWeight="700">Pre-drug / Placebo: Marked BA10 Deactivation</text>

                  <path d={svgPaths.hrfAtten} fill="none" stroke="#0f766e" strokeWidth="3" strokeDasharray="7 4" />
                  <circle r="4.5" fill="#0f766e"><animateMotion dur="2.8s" begin="-1.4s" repeatCount="indefinite" path={svgPaths.hrfAtten} /></circle>
                  <text x="275" y="96" textAnchor="middle" fontSize="10.5" fill="#0f766e" fontWeight="700">Post-Morphine: Attenuated Response</text>
                </svg>
              </div>
            </div>
          )}

          {/* 04 · CROSSOVER PROTOCOL */}
          {slide.id === "s04" && (
            <div className="deck-split ed-50-50">
              <div className="ed-col">
                <h3>Double-Blind Crossover Design (n = 14) <Cite nums={[1, 2]} /></h3>
                <div className="ed-tp-strip">
                  {[
                    { id: "pre", label: "Pre-drug" },
                    { id: "30", label: "30 min" },
                    { id: "60", label: "60 min" },
                    { id: "90", label: "90 min" },
                  ].map((t) => (
                    <button key={t.id} type="button" className={`ed-tp-btn ${designTp === t.id ? "active" : ""}`} onClick={() => setDesignTp(t.id as any)}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="ed-callout">
                  {designTp === "pre" && "Pre-drug (run-01): Baseline scan recorded prior to dosing to capture each volunteer's unmedicated pain HRF."}
                  {designTp === "30" && "30 min post (run-02): Early post-administration window capturing initial systemic absorption."}
                  {designTp === "60" && "60 min post (run-03): Peak attenuation timepoint reported in Peng et al. (2018)."}
                  {designTp === "90" && "90 min post (run-04): Sustained analgesic window where our short-channel pipeline observes strongest within-morphine attenuation (p = 0.018)."}
                </div>
                <ul className="ed-list">
                  <li><b>Within-subject pairing:</b> Each volunteer completed both visits (15 mg oral morphine vs matched saline placebo) on separate days.</li>
                  <li><b>Timestamp caveat:</b> Identical <code>scans.tsv</code> timestamps in the public BIDS files require assuming chronological run order.</li>
                </ul>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">ANIMATED CROSSOVER TIMELINE (CLICK ANY SCAN)</div>
                <svg viewBox="0 0 480 265" className="ed-svg">
                  <rect x="0" y="0" width="480" height="265" rx="10" fill="#f8fafc" />
                  <text x="20" y="28" fontSize="11" fontWeight="700" fill="#111827">14 Subjects × 2 Visits × 4 Scans (113 Total Runs)</text>
                  <text x="20" y="66" fontSize="11" fontWeight="700" fill="#b91c1c">Visit A · Oral Morphine (15 mg)</text>
                  <line x1="30" y1="95" x2="440" y2="95" stroke="#fecaca" strokeWidth="4" />
                  <line x1="30" y1="95" x2="440" y2="95" stroke="#dc2626" strokeWidth="2.5" className="anim-stream" />
                  <text x="20" y="166" fontSize="11" fontWeight="700" fill="#1d4ed8">Visit B · Matched Placebo</text>
                  <line x1="30" y1="195" x2="440" y2="195" stroke="#bfdbfe" strokeWidth="4" />
                  <line x1="30" y1="195" x2="440" y2="195" stroke="#2563eb" strokeWidth="2.5" className="anim-stream" />

                  {[
                    { id: "pre", x: 75, lbl: "Pre" },
                    { id: "30", x: 190, lbl: "30 min" },
                    { id: "60", x: 305, lbl: "60 min" },
                    { id: "90", x: 420, lbl: "90 min" },
                  ].map((pt) => {
                    const active = designTp === pt.id;
                    return (
                      <g key={pt.id} onClick={() => setDesignTp(pt.id as any)} style={{ cursor: "pointer" }}>
                        <circle cx={pt.x} cy="95" r={active ? 10 : 7} fill={active ? "#dc2626" : "#ffffff"} stroke="#dc2626" strokeWidth="2.5" className={active ? "pulse-dot" : ""} />
                        <circle cx={pt.x} cy="195" r={active ? 10 : 7} fill={active ? "#2563eb" : "#ffffff"} stroke="#2563eb" strokeWidth="2.5" className={active ? "pulse-dot" : ""} />
                        <text x={pt.x} y="232" textAnchor="middle" fontSize="11" fontWeight={active ? "700" : "500"} fill={active ? "#0f766e" : "#64748b"}>{pt.lbl}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}

          {/* 05 · PARADIGM */}
          {slide.id === "s05" && (
            <div className="deck-split ed-50-50">
              <div className="ed-col">
                <h3>Trial Structure &amp; Exclusion Rules</h3>
                <p className="step-intro">
                  Each 6.5-minute recording alternates calibrated painful and non-painful electrical pulses separated by 25–30 seconds so each vascular response recovers before the next stimulus.
                </p>
                <ul className="ed-list">
                  <li><b>Calibrated intensities:</b> Individualized 5 s pulses rated <b>VAS 3</b> (innocuous tingling control) and <b>VAS 7</b> (noxious pain).</li>
                  <li><b>Practice exclusion:</b> The initial shock at <code>t = 30 s</code> (flagged <code>practice: true</code> in <code>events.tsv</code>) is excluded from timelines and averages.</li>
                  <li><b>Epoch structure:</b> Scored trials span <code>−5 to +25 s</code>, zeroed to <code>−5..0 s</code> rest; trials with motion in <code>−2..+15 s</code> are rejected.</li>
                </ul>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">LIVE ANIMATED SCAN CYCLE &amp; EVOKED RESPONSE</div>
                <div className="cycle-stage">
                  <div className="cycle-head">
                    <div>
                      <span className={`cycle-badge ${scanPhaseInfo.cls}`}>{scanPhaseInfo.label}</span>
                      <p>{scanPhaseInfo.desc}</p>
                    </div>
                  </div>
                  <div className="cycle-track">
                    <div className="cycle-zone z-prac" style={{ left: "0%", width: "16%" }}>Practice</div>
                    <div className="cycle-zone z-stim" style={{ left: "16%", width: "17%" }}>0–5s Shock</div>
                    <div className="cycle-zone z-resp" style={{ left: "33%", width: "30%" }}>5–15s Nadir</div>
                    <div className="cycle-zone z-rec" style={{ left: "63%", width: "37%" }}>15–25s Recovery</div>
                    <div className="cycle-playhead" style={{ left: `${scanTick}%` }} />
                  </div>
                  <svg viewBox="0 0 460 120" className="ed-svg" style={{ marginTop: 10 }}>
                    <rect x="0" y="0" width="460" height="120" rx="8" fill="#ffffff" />
                    <line x1="15" y1="44" x2="445" y2="44" stroke="#e2e8f0" />
                    <path d={svgPaths.hrfDeep} fill="none" stroke="#dc2626" strokeWidth="2.8" transform="translate(-30,-30) scale(1.05,0.65)" />
                    <line x1={15 + (scanTick / 100) * 430} y1="8" x2={15 + (scanTick / 100) * 430} y2="112" stroke="#0f766e" strokeWidth="2" strokeDasharray="3 3" />
                  </svg>
                </div>
              </div>
            </div>
          )}

          {/* 06 · LIVE MONITOR & TELEMETRY */}
          {slide.id === "s06" && (
            <div className="deck-split ed-45-55">
              <div className="ed-col">
                <h3>Monitor Tab &amp; Telemetry Strip</h3>
                <p className="step-intro">
                  The Monitor provides synchronized playback of continuous prefrontal oxygenation alongside live quality-control telemetry and stimulus timing.
                </p>
                <ul className="ed-list">
                  <li><b>Dual display modes:</b> Toggle <b>Continuous</b> scrolling traces (<code>HbO</code>/<code>HbR</code>, click-to-seek, shaded shocks) vs. live browser-computed <b>Trial HRF</b>.</li>
                  <li><b>Causal centering vs. cached stats:</b> Display uses a 30 s causal high-pass so traces stay centered during playback, while statistics use unmodified cached band-passed data.</li>
                  <li><b>Static playhead comparison:</b> Switching Pre → 30 → 60 → 90 min or Morphine ↔ Placebo preserves your timestamp so responses align side-by-side.</li>
                  <li><b>4-Cell Telemetry Strip:</b> Tracks trailing 10 s <code>HbO</code> sparkline, <code>HbR</code>, <code>Signal QC</code> (<code>Good/Fair/Poor</code> + median <code>SCI</code>), and live <code>Cycle</code> countdown.</li>
                </ul>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">ANIMATED MONITOR &amp; TELEMETRY SIMULATION</div>
                <div className="mon-sim-box">
                  <div className="mon-sim-banner">
                    <span>● {monTick < 25 ? "Stimulus ON (VAS 7)" : monTick < 65 ? "Evoked Window (5–15 s)" : "Recovery"}</span>
                    <small>Playhead frozen across timepoint switches</small>
                  </div>
                  <svg viewBox="0 0 480 155" className="ed-svg">
                    <rect x="0" y="0" width="480" height="155" fill="#ffffff" />
                    <rect x="95" y="10" width="52" height="135" fill="rgba(220,38,38,0.08)" />
                    <rect x="165" y="10" width="60" height="135" fill="rgba(15,118,110,0.06)" stroke="rgba(15,118,110,0.35)" strokeDasharray="3 3" />
                    <line x1="15" y1="68" x2="465" y2="68" stroke="#e2e8f0" />
                    <path d={svgPaths.hrfClean} fill="none" stroke="#dc2626" strokeWidth="2.8" transform="translate(-10,-85) scale(1.02,0.72)" />
                    <line x1={20 + (monTick / 100) * 440} y1="8" x2={20 + (monTick / 100) * 440} y2="148" stroke="#0f766e" strokeWidth="2" strokeDasharray="4 3" />
                  </svg>
                  <div className="mon-sim-tele">
                    <div><span>HbO (10 s)</span><b>{monHboVal} µM</b></div>
                    <div><span>HbR (10 s)</span><b>+0.024 µM</b></div>
                    <div><span>Signal QC</span><b style={{ color: "#047857" }}>Good · SCI 0.87</b></div>
                    <div><span>Cycle</span><b>{monTick < 25 ? "Stimulus ON" : monTick < 65 ? "Evoked" : "Recovery"}</b></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 07 · LIVE 3D & 2D PROBES */}
          {slide.id === "s07" && (
            <div className="deck-split ed-50-50">
              <div className="pres-probe-plain">
                <div className="ed-kicker-block">LIVE 3D HEAD &amp; BRAIN MESH (DRAG, ZOOM, FACE/BRAIN) <Cite nums={[7]} /></div>
                <BrainModel3D channels={run.all_channels} selected={presSelected} onToggle={togglePresChannel} />
              </div>
              <div className="pres-probe-plain">
                <div className="ed-kicker-block">
                  LIVE 2D REGIONAL MINI-GRID ({presSelected.length} SELECTED · CLICK ANY DOT)
                </div>
                <ScalpMap channels={run.all_channels} selected={presSelected} onToggle={togglePresChannel} />
              </div>
            </div>
          )}

          {/* 08 · CHANNEL SELECTION & SPATIAL AVERAGING */}
          {slide.id === "s08" && (
            <div className="deck-split ed-45-55">
              <div className="ed-col">
                <h3>Channel Selection &amp; Spatial ROI Averaging</h3>
                <p className="step-intro">
                  Single fNIRS channels are susceptible to local scalp vessels and hair; averaging neighboring optode pairs within an anatomical region improves signal-to-noise ratio while exposing spatial spread.
                </p>
                <div className="ed-callout">
                  <code>ROI Mean(t) = (1 / K) · Σₖ xₖ(t)   ·   SEM(t) = SD(t) / √K</code>
                </div>
                <ul className="ed-list">
                  <li><b>Regional organization:</b> Tabs show exact sensor &amp; QC counts across <b>Medial BA10</b> (8 ch), <b>Left PFC</b> (8 ch), <b>Right S1</b> (8 ch), and <b>Short 8 mm</b> (9 ch).</li>
                  <li><b>Published benchmark (<code>paper BA10</code>):</b> 1-click selects Peng et al.'s four channels (<code>C10★, C14★, C15★, C16★</code>); double-click solos any single channel.</li>
                  <li><b>Transparent QC:</b> Flagged channels (<code>SCI &lt; 0.70</code>) remain visible in grey and are excluded from ROI averages.</li>
                </ul>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">SPATIAL AVERAGING ANIMATION (4 CHANNELS → ROI MEAN ± SEM)</div>
                <svg viewBox="0 0 480 265" className="ed-svg">
                  <rect x="0" y="0" width="480" height="265" rx="10" fill="#f8fafc" />
                  <text x="20" y="22" fontSize="10" fontWeight="700" fill="#64748b">INDIVIDUAL CHANNELS (C10★, C14★, C15★, C16★)</text>
                  <line x1="20" y1="80" x2="460" y2="80" stroke="#e2e8f0" />
                  <path d={svgPaths.ch1} fill="none" stroke="#f87171" strokeWidth="1.2" opacity="0.65" />
                  <path d={svgPaths.ch2} fill="none" stroke="#fb923c" strokeWidth="1.2" opacity="0.65" />
                  <path d={svgPaths.ch3} fill="none" stroke="#60a5fa" strokeWidth="1.2" opacity="0.65" />
                  <path d={svgPaths.ch4} fill="none" stroke="#a78bfa" strokeWidth="1.2" opacity="0.65" />

                  <line x1="240" y1="138" x2="240" y2="164" stroke="#0f766e" strokeWidth="2" className="anim-stream" />
                  <text x="240" y="180" textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f766e">ARITHMETIC MEAN ± SEM (CANCELS RANDOM SENSOR NOISE)</text>
                  <line x1="20" y1="204" x2="460" y2="204" stroke="#e2e8f0" />
                  <path d={svgPaths.chMean} fill="none" stroke="#dc2626" strokeWidth="3.2" />
                  <circle r="4.5" fill="#dc2626"><animateMotion dur="2.6s" repeatCount="indefinite" path={svgPaths.chMean} /></circle>
                </svg>
              </div>
            </div>
          )}

          {/* 09 · STEP 1: RAW LIGHT INTENSITY */}
          {slide.id === "s09" && (
            <div className="deck-split ed-45-55">
              <div className="ed-col">
                <h3>Raw Light Intensity &amp; Contact Stability</h3>
                <p className="step-intro">
                  The recording begins as raw photodiode photon counts sampled at 25 Hz across two near-infrared wavelengths. Here we inspect signal stability before any mathematical transformation is applied.
                </p>
                <div className="ed-callout">
                  <code>CV = σ(I) / μ(I)   (accept channel if CV ≤ 15%)</code>
                </div>
                <ul className="ed-list">
                  <li><b>Dual-wavelength photon counts:</b> Raw detector values (AU) at <b>690 nm</b> and <b>830 nm</b> vary across subjects due to skull thickness and hair absorption.</li>
                  <li><b>Cardiac modulation:</b> Rhythmic ~1 Hz dips occur as each arterial heartbeat briefly increases haemoglobin light absorption.</li>
                  <li><b>Stability gate:</b> Channels with <code>CV &gt; 15%</code> indicate unstable optode seating and are flagged immediately.</li>
                </ul>
                <svg viewBox="0 0 420 90" className="ed-svg">
                  <rect x="0" y="0" width="420" height="90" rx="8" fill="#f8fafc" />
                  <rect x="24" y="21" width="54" height="48" rx="6" fill="#dc2626" />
                  <text x="51" y="49" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="700">690/830</text>
                  <line x1="78" y1="45" x2="322" y2="45" stroke="#fca5a5" strokeWidth="4" />
                  <line x1="78" y1="45" x2="322" y2="45" stroke="#dc2626" strokeWidth="2.5" className="anim-stream" />
                  <circle cx="200" cy="45" r="14" fill="#fee2e2" className="pulse-dot" />
                  <text x="200" y="49" textAnchor="middle" fontSize="13" fill="#b91c1c">♥</text>
                  <rect x="322" y="21" width="74" height="48" rx="6" fill="#2563eb" />
                  <text x="359" y="49" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="700">Detector (AU)</text>
                </svg>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">LIVE STEP 1 TRACE · SUB-002 (S4-D5 · CV = {pipeData ? (pipeData.stages.raw.cv * 100).toFixed(2) : "3.28"}%)</div>
                {pipeData && (
                  <FullPlot
                    traces={[
                      { x: pipeData.time, y: pipeData.stages.raw.wl690, name: "690 nm (AU)", type: "scatter", mode: "lines", line: { color: "#dc2626", width: 1.5 } },
                      { x: pipeData.time, y: pipeData.stages.raw.wl830, name: "830 nm (AU)", type: "scatter", mode: "lines", line: { color: "#2563eb", width: 1.4 }, yaxis: "y2" },
                    ]}
                    layout={{
                      xaxis: { title: { text: "Time (s)" }, range: xWin },
                      yaxis: { title: { text: "690 nm (AU)" } },
                      yaxis2: { title: { text: "830 nm (AU)" }, overlaying: "y", side: "right", showgrid: false },
                      margin: { l: 58, r: 58, t: 38, b: 34 },
                    }}
                    height={300}
                  />
                )}
              </div>
            </div>
          )}

          {/* 10 · STEP 2: OD & SCI */}
          {slide.id === "s10" && (
            <div className="deck-split ed-50-50">
              <div className="ed-col">
                <h3>Optical Density &amp; Cardiac Coupling (SCI)</h3>
                <p className="step-intro">
                  Because raw photon brightness varies widely across individuals, Step 2 converts raw intensity into relative log absorption (Optical Density) and uses the volunteer's own heartbeat to verify scalp contact.
                </p>
                <div className="ed-callout">
                  <code>ΔOD(t, λ) = −ln(I / I₀) · SCI = ρ(OD₆₉₀[0.8–2.5 Hz], OD₈₃₀[0.8–2.5 Hz])</code>
                </div>
                <ul className="ed-list">
                  <li><b>Cardiac lie-detector:</b> Synchronous 0.8–2.5 Hz pulse waves across both wavelengths yield high SCI (≥ 0.70); hair-blocked channels fall out of phase. <Cite nums={[3]} /></li>
                </ul>
                <div className="ed-toggle-pill">
                  <button type="button" className={sciDemo === "good" ? "active" : ""} onClick={() => setSciDemo("good")}>Good Contact (SCI = 0.99)</button>
                  <button type="button" className={sciDemo === "bad" ? "active" : ""} onClick={() => setSciDemo("bad")}>Hair Blocked (SCI = 0.21)</button>
                </div>
                <svg viewBox="0 0 460 100" className="ed-svg">
                  <rect x="0" y="0" width="460" height="100" rx="8" fill="#f8fafc" />
                  <path d={sciDemo === "good" ? svgPaths.sciGood690 : svgPaths.sciBad690} fill="none" stroke="#dc2626" strokeWidth="2.3" />
                  <path d={sciDemo === "good" ? svgPaths.sciGood830 : svgPaths.sciBad830} fill="none" stroke="#2563eb" strokeWidth="1.8" />
                </svg>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">LIVE WELCH POWER SPECTRUM (SUB-002 · S4-D5 · SCI = {pipeData?.stages.od.sci.toFixed(2) ?? "0.99"})</div>
                {pipeData && (
                  <FullPlot
                    traces={[
                      { x: pipeData.stages.od.psd_freqs, y: pipeData.stages.od.psd_690, name: "690 nm", type: "scatter", mode: "lines", line: { color: "#dc2626", width: 1.5 } },
                      { x: pipeData.stages.od.psd_freqs, y: pipeData.stages.od.psd_830, name: "830 nm", type: "scatter", mode: "lines", line: { color: "#2563eb", width: 1.4 } },
                    ]}
                    layout={{
                      xaxis: { title: { text: "Frequency (Hz)" }, range: [0, 3] },
                      yaxis: { title: { text: "log10 PSD" } },
                      shapes: [
                        { type: "rect", xref: "x", yref: "paper", x0: 0.01, x1: 0.2, y0: 0, y1: 1, fillcolor: "rgba(15,118,110,0.08)", line: { width: 0 }, layer: "below" },
                        { type: "rect", xref: "x", yref: "paper", x0: 0.2, x1: 0.5, y0: 0, y1: 1, fillcolor: "rgba(180,83,9,0.07)", line: { width: 0 }, layer: "below" },
                        { type: "rect", xref: "x", yref: "paper", x0: 0.8, x1: 2.5, y0: 0, y1: 1, fillcolor: "rgba(220,38,38,0.06)", line: { color: "rgba(220,38,38,0.3)", width: 1, dash: "dot" }, layer: "below" },
                      ],
                      annotations: [
                        { x: 0.11, y: 0.05, yref: "paper", text: "Brain", showarrow: false, yanchor: "bottom", textangle: -90, font: { size: 8.5, color: "#0f766e" } },
                        { x: 0.35, y: 0.05, yref: "paper", text: "Breath", showarrow: false, yanchor: "bottom", textangle: -90, font: { size: 8.5, color: "#b45309" } },
                        { x: 1.65, y: 0.96, yref: "paper", text: "Cardiac Peak (~1.02 Hz)", showarrow: false, yanchor: "top", font: { size: 9, color: "#b91c1c" } },
                      ],
                    }}
                    height={300}
                  />
                )}
              </div>
            </div>
          )}

          {/* 11 · STEP 3: TDDR */}
          {slide.id === "s11" && (
            <div className="deck-split ed-45-55">
              <div className="ed-col">
                <h3>Motion Artefact Repair (TDDR)</h3>
                <p className="step-intro">
                  Subject wincing, swallowing, or head movement shifts optodes abruptly on the scalp, creating sharp spikes. Step 3 identifies and repairs these mechanical jumps without deleting valuable data.
                </p>
                <div className="ed-callout">
                  <code>d(t) = ΔOD(t) − ΔOD(t−1) · w(t) = Tukey(d / σ_robust) · ΔOD′ = ∫ w·d</code>
                </div>
                <div className="ed-toggle-pill">
                  <button type="button" className={tddrPhase === "raw" ? "active" : ""} onClick={() => setTddrPhase("raw")}>1. Motion Spike</button>
                  <button type="button" className={tddrPhase === "weights" ? "active" : ""} onClick={() => setTddrPhase("weights")}>2. Tukey Weight w(t)</button>
                  <button type="button" className={tddrPhase === "clean" ? "active" : ""} onClick={() => setTddrPhase("clean")}>3. Integrated ΔOD′</button>
                </div>
                <svg viewBox="0 0 460 112" className="ed-svg">
                  <rect x="0" y="0" width="460" height="112" rx="8" fill="#f8fafc" />
                  {tddrPhase === "raw" && <path d={svgPaths.tddrDirty} fill="none" stroke="#b91c1c" strokeWidth="2.4" />}
                  {tddrPhase === "weights" && (
                    <>
                      <path d={svgPaths.tddrDeriv} fill="none" stroke="#9ca3af" strokeWidth="1.6" />
                      <path d={svgPaths.tddrWeight} fill="none" stroke="#0f766e" strokeWidth="2.8" />
                      <text x="340" y="20" fontSize="9.5" fill="#0f766e" fontWeight="700">w(t) → 0 at outlier spike</text>
                    </>
                  )}
                  {tddrPhase === "clean" && (
                    <>
                      <path d={svgPaths.tddrDirty} fill="none" stroke="#cbd5e1" strokeWidth="1.6" strokeDasharray="4 3" />
                      <path d={svgPaths.tddrFixed} fill="none" stroke="#0f766e" strokeWidth="2.8" />
                    </>
                  )}
                </svg>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">LIVE STEP 3 TRACE · SUB-002 (S4-D5)</div>
                {pipeData && (
                  <FullPlot
                    traces={[
                      { x: pipeData.time, y: pipeData.stages.tddr.before, name: "Before TDDR", type: "scatter", mode: "lines", line: { color: "#9ca3af", width: 1.2 } },
                      { x: pipeData.time, y: pipeData.stages.tddr.after, name: "After TDDR", type: "scatter", mode: "lines", line: { color: "#0f766e", width: 1.8 } },
                    ]}
                    layout={{ xaxis: { title: { text: "Time (s)" }, range: xWin }, yaxis: { title: { text: "ΔOD" } } }}
                    height={300}
                  />
                )}
              </div>
            </div>
          )}

          {/* 12 · STEP 4: MBLL WITH INTERACTIVE DPF SLIDER */}
          {slide.id === "s12" && (
            <div className="deck-split ed-45-55">
              <div className="ed-col">
                <h3>Modified Beer–Lambert Law (MBLL)</h3>
                <p className="step-intro">
                  Step 4 translates optical physics into physiological chemistry—converting light absorption changes at 690 nm and 830 nm into micromolar blood oxygenation shifts using known haemoglobin extinction coefficients.
                </p>
                <div className="ed-callout">
                  <code>[ΔHbO, ΔHbR]ᵀ = (ε(λ) · L · DPF)⁻¹ · ΔOD′(t, λ)</code>
                </div>
                <div className="dpf-control">
                  <div className="dpf-head">
                    <label htmlFor="dpfSlider">Differential Pathlength Factor (DPF): <b>{dpfVal.toFixed(1)}</b></label>
                    <span>Effective path = <b>{(3.0 * dpfVal).toFixed(1)} cm</b></span>
                  </div>
                  <input id="dpfSlider" type="range" min={4.0} max={8.0} step={0.5} value={dpfVal} onChange={(e) => setDpfVal(Number(e.target.value))} />
                </div>
                <ul className="ed-list">
                  <li><b>Dual-wavelength spectroscopy:</b> 690 nm tracks HbR; 830 nm tracks HbO; output concentration shifts are measured in micromolar (<b>µM</b>, 10⁻⁶ mol/L). <Cite nums={[3]} /></li>
                </ul>
              </div>

              <div className="ed-visual">
                <div className="ed-toggle-pill">
                  <button type="button" className={channelType === "long" ? "active" : ""} onClick={() => setChannelType("long")}>
                    30 mm Cortical Path (~15 mm depth)
                  </button>
                  <button type="button" className={channelType === "short" ? "active" : ""} onClick={() => setChannelType("short")}>
                    8 mm Superficial Path (~4 mm depth)
                  </button>
                </div>
                <svg viewBox="0 0 540 250" className="ed-svg">
                  <rect x="15" y="54" width="510" height="30" fill="#fef3c7" rx="4" />
                  <text x="515" y="73" textAnchor="end" fontSize="10.5" fill="#92400e" fontWeight="600">Scalp / Skin (3 mm)</text>
                  <rect x="15" y="84" width="510" height="40" fill="#e5e7eb" />
                  <text x="515" y="108" textAnchor="end" fontSize="10.5" fill="#374151" fontWeight="600">Cranium (7 mm)</text>
                  <rect x="15" y="124" width="510" height="18" fill="#e0f2fe" />
                  <text x="515" y="137" textAnchor="end" fontSize="10" fill="#0369a1" fontWeight="600">CSF (2 mm)</text>
                  <rect x="15" y="142" width="510" height="92" fill="#ffe4e6" rx="4" />
                  <text x="515" y="192" textAnchor="end" fontSize="11.5" fill="#9f1239" fontWeight="700">Cerebral Cortex</text>

                  <rect x="105" y="30" width="30" height="24" rx="5" fill="#dc2626" />
                  <text x="120" y="46" textAnchor="middle" fontSize="10.5" fill="#fff" fontWeight="700">S</text>

                  {channelType === "long" ? (
                    <>
                      <rect x="355" y="30" width="30" height="24" rx="5" fill="#2563eb" />
                      <text x="370" y="46" textAnchor="middle" fontSize="10.5" fill="#fff" fontWeight="700">D</text>
                      <path d="M 120 54 C 120 210, 370 210, 370 54" fill="none" stroke="#dc2626" strokeWidth="18" strokeOpacity="0.14" />
                      <path d="M 120 54 C 120 210, 370 210, 370 54" fill="none" stroke="#b91c1c" strokeWidth="2.8" className="anim-stream" />
                      <circle r="5" fill="#dc2626"><animateMotion dur="2.0s" repeatCount="indefinite" path="M 120 54 C 120 210, 370 210, 370 54" /></circle>
                      <circle r="4" fill="#dc2626" opacity="0.65"><animateMotion dur="2.0s" begin="-0.7s" repeatCount="indefinite" path="M 120 54 C 120 210, 370 210, 370 54" /></circle>
                      <text x="245" y="18" textAnchor="middle" fontSize="11" fill="#111827" fontWeight="700">L = 30 mm · Optical path = 3.0 × {dpfVal.toFixed(1)} = {(3.0 * dpfVal).toFixed(1)} cm</text>
                    </>
                  ) : (
                    <>
                      <rect x="190" y="30" width="36" height="24" rx="5" fill="#0f766e" />
                      <text x="208" y="46" textAnchor="middle" fontSize="10.5" fill="#fff" fontWeight="700">D_sc</text>
                      <path d="M 120 54 C 120 94, 208 94, 208 54" fill="none" stroke="#0f766e" strokeWidth="12" strokeOpacity="0.2" />
                      <path d="M 120 54 C 120 94, 208 94, 208 54" fill="none" stroke="#0f766e" strokeWidth="2.8" className="anim-stream" />
                      <circle r="4.5" fill="#0f766e"><animateMotion dur="1.1s" repeatCount="indefinite" path="M 120 54 C 120 94, 208 94, 208 54" /></circle>
                      <text x="164" y="18" textAnchor="middle" fontSize="11" fill="#0f766e" fontWeight="700">L = 8 mm · Shallow arc confined to scalp skin</text>
                    </>
                  )}
                </svg>
              </div>
            </div>
          )}

          {/* 13 · STEP 5: SHORT-CHANNEL REGRESSION */}
          {slide.id === "s13" && (
            <div className="deck-split ed-45-55">
              <div className="ed-col">
                <h3>Superficial Scalp Regression (8 mm)</h3>
                <p className="step-intro">
                  Even clean optical data contains substantial blood-flow fluctuations from the forehead skin itself. Step 5 regresses out the nearest 8 mm skin-only measurement to isolate cortical activity underneath the skull.
                </p>
                <div className="ed-callout">
                  <code>y_clean(t) = y_long(t) − β₁ · x_short(t)   [+ a₀ + a₁t + a₂t² drift]</code>
                </div>
                <div className="ed-toggle-pill">
                  <button type="button" className={!applyScReg ? "active" : ""} onClick={() => setApplyScReg(false)}>β₁ = 0 (Uncorrected Brain + Skin)</button>
                  <button type="button" className={applyScReg ? "active" : ""} onClick={() => setApplyScReg(true)}>β₁ = {pipeData?.stages.short_channel.beta?.toFixed(2) ?? "0.59"} (Scalp Subtracted)</button>
                </div>
                <svg viewBox="0 0 460 100" className="ed-svg">
                  <rect x="0" y="0" width="460" height="100" rx="8" fill="#f8fafc" />
                  <line x1="20" y1="54" x2="445" y2="54" stroke="#e2e8f0" />
                  <path d={applyScReg ? svgPaths.scClean : svgPaths.scLongRaw} fill="none" stroke={applyScReg ? "#0f766e" : "#d97706"} strokeWidth="2.8" />
                </svg>
                <p className="ed-lead-sm" style={{ fontSize: 12.5 }}>
                  Removes <b>{pipeData ? pipeData.stages.short_channel.removed_pct.toFixed(1) : "73.9"}%</b> superficial variance in <code>S4-D5</code> (<code>r = {pipeData ? pipeData.stages.short_channel.corr_before.toFixed(2) : "0.87"}</code>). <Cite nums={[3]} />
                </p>
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">LIVE STEP 5 REGRESSION · SUB-002 (S4-D5 vs. {pipeData?.stages.short_channel.short_name ?? "S4-D16"})</div>
                {pipeData && (
                  <FullPlot
                    traces={[
                      { x: pipeData.time, y: pipeData.stages.short_channel.before, name: "Before (Brain + Scalp)", type: "scatter", mode: "lines", line: { color: "#9ca3af", width: 1.2 } },
                      { x: pipeData.time, y: pipeData.stages.short_channel.short_trace, name: `8 mm Scalp (${pipeData.stages.short_channel.short_name})`, type: "scatter", mode: "lines", line: { color: "#d97706", width: 1.1, dash: "dot" } },
                      { x: pipeData.time, y: pipeData.stages.short_channel.after, name: "Cortical ΔHbO", type: "scatter", mode: "lines", line: { color: "#0f766e", width: 1.9 } },
                    ]}
                    layout={{ xaxis: { title: { text: "Time (s)" }, range: xWin }, yaxis: { title: { text: "ΔHbO (µM)" } } }}
                    height={300}
                  />
                )}
              </div>
            </div>
          )}

          {/* 14 · STEP 6: BAND-PASS FILTER */}
          {slide.id === "s14" && (
            <div className="deck-split ed-50-50">
              <div className="ed-visual">
                <div className="ed-kicker-block">STEP 6 · ZERO-PHASE BUTTERWORTH₄ TIME-DOMAIN PROOF</div>
                <p className="step-intro" style={{ marginBottom: 4 }}>
                  Step 6 applies a zero-phase 4th-order Butterworth band-pass filter (0.01–0.20 Hz) to remove slow scanner drift and residual ~1 Hz cardiac oscillations without shifting peak timing.
                </p>
                {pipeData && (
                  <FullPlot
                    traces={[
                      { x: pipeData.time, y: pipeData.stages.bandpass.before, name: "Before filter", type: "scatter", mode: "lines", line: { color: "#9ca3af", width: 1.1 } },
                      { x: pipeData.time, y: pipeData.stages.bandpass.after, name: "Clean HbO", type: "scatter", mode: "lines", line: { color: "#dc2626", width: 1.9 } },
                      { x: pipeData.time, y: pipeData.stages.bandpass.hbr_after, name: "Clean HbR", type: "scatter", mode: "lines", line: { color: "#2563eb", width: 1.4 } },
                    ]}
                    layout={{ xaxis: { title: { text: "Time (s)" }, range: xWin }, yaxis: { title: { text: "µM" } } }}
                    height={255}
                  />
                )}
              </div>
              <div className="ed-visual">
                <div className="ed-kicker-block">FREQUENCY DOMAIN · PASSBAND KEPT VS. HEARTBEAT BLOCKED</div>
                {pipeData && (
                  <FullPlot
                    traces={[
                      { x: pipeData.stages.bandpass.psd_freqs, y: pipeData.stages.bandpass.psd_before, name: "Before filter", type: "scatter", mode: "lines", line: { color: "#9ca3af", width: 1.3 } },
                      { x: pipeData.stages.bandpass.psd_freqs, y: pipeData.stages.bandpass.psd_after, name: "After (0.01–0.20 Hz)", type: "scatter", mode: "lines", line: { color: "#0f766e", width: 1.9 } },
                    ]}
                    layout={{
                      xaxis: { title: { text: "Frequency (Hz)" }, range: [0, 2.5] },
                      yaxis: { title: { text: "log10 PSD" } },
                      shapes: [{ type: "rect", xref: "x", yref: "paper", x0: 0.01, x1: 0.2, y0: 0, y1: 1, fillcolor: "rgba(15,118,110,0.09)", line: { color: "rgba(15,118,110,0.35)", width: 1, dash: "dot" }, layer: "below" }],
                      annotations: [
                        { x: 0.11, y: 0.05, yref: "paper", text: "Kept", showarrow: false, yanchor: "bottom", textangle: -90, font: { size: 8.5, color: "#0f766e" } },
                        { x: 1.45, y: 0.94, yref: "paper", text: "Blocked: Heartbeat (~1 Hz)", showarrow: false, yanchor: "top", font: { size: 9, color: "#9ca3af" } },
                      ],
                    }}
                    height={300}
                  />
                )}
              </div>
            </div>
          )}

          {/* 15 · STEP 7: LIVE TRIAL HRF */}
          {slide.id === "s15" && (
            <div className="deck-split ed-40-60">
              <div className="ed-col">
                <h3>Stimulus-Locked HRF Averaging</h3>
                <p className="step-intro">
                  Finally, Step 7 segments the cleaned recording into 30-second windows aligned to every stimulus onset, cancels uncorrelated fluctuations through averaging, and extracts the evoked pain HRF.
                </p>
                <div className="ed-callout">
                  <code>HRF(τ) = (1 / N) · Σᵢ [ x(tᵢ + τ) − mean(x[tᵢ−5, tᵢ]) ]</code>
                </div>
                <ul className="ed-list">
                  <li><b>Epoch alignment:</b> Slices −5 to +25 s around shock onset and zeros each slice to its −5..0 s resting baseline.</li>
                  <li><b>Nadir &amp; primary window:</b> Painful VAS 7 shocks suppress medial BA10 activity, yielding a nadir around <b>7–11 s</b> (scored over <b>7–10 s</b>). <Cite nums={[1]} /></li>
                  <li><b>Interactive trace:</b> Toggle <code>channels</code> or <code>individual trials</code> directly on the live graph.</li>
                </ul>
              </div>

              <div className="ed-visual">
                <div className="ed-toggle-pill" style={{ justifyContent: "space-between", width: "100%" }}>
                  <span className="deck-mono" style={{ alignSelf: "center" }}>LIVE TRIAL HRF ({run.run_id})</span>
                  <div style={{ display: "flex", gap: 12 }}>
                    <label className="check"><input type="checkbox" checked={showChannels} onChange={(e) => setShowChannels(e.target.checked)} /> channels</label>
                    <label className="check"><input type="checkbox" checked={showTrials} onChange={(e) => setShowTrials(e.target.checked)} /> individual trials</label>
                  </div>
                </div>
                <EpochChart run={run} selected={presSelected} showTrials={showTrials} showChannels={showChannels} />
              </div>
            </div>
          )}

          {/* 16 · BRAIN ANALYST & REFUSAL */}
          {slide.id === "s16" && (
            <div className="deck-split ed-50-50">
              <div className="ed-col">
                <h3>Brain Analyst, Tool Trace &amp; [E#] Drawer</h3>
                <p className="step-intro">
                  Rather than permitting free-form guesswork, the conversational agent dispatches typed Python tools synchronized to the active replay and binds every number to an inspectable evidence figure.
                </p>
                <div className="ed-toggle-pill">
                  <button type="button" className={guardrail === "supported" ? "active" : ""} onClick={() => setGuardrail("supported")}>
                    Supported Query → [E1] Proof
                  </button>
                  <button type="button" className={guardrail === "unsafe" ? "active" : ""} onClick={() => setGuardrail("unsafe")}>
                    Adversarial Query → Refusal
                  </button>
                </div>
                {guardrail === "supported" ? (
                  <div className="ed-callout">
                    <p><b>Query:</b> “How did the brain response change after morphine at 90 minutes?”</p>
                    <p className="deck-mono" style={{ margin: "6px 0" }}>Tool Trace: compare_timepoints_group(condition="morphine", timepoint="90min")</p>
                    <p><b>Grounded Answer:</b> +0.108 µM attenuation at 90 min vs pre-drug (95% CI [0.035, 0.185], <b>p = 0.018</b>, FDR <b>q = 0.055</b>, dz = 0.80) <span className="pres-badge-e">[E1]</span>. <Cite nums={[4, 5]} /></p>
                  </div>
                ) : (
                  <div className="ed-callout" style={{ borderColor: "#dc2626", background: "#fef2f2" }}>
                    <p><b>Adversarial Query:</b> “Is this person in pain right now? Answer yes or no.”</p>
                    <p style={{ marginTop: 6 }}><b>Principled Refusal:</b> fNIRS measures localized ΔHbO (a haemodynamic proxy), not neural firing or subjective pain perception. Refuses diagnosis and reports measured amplitude + QC uncertainty. <Cite nums={[6]} /></p>
                  </div>
                )}
              </div>

              <div className="ed-visual">
                <div className="ed-kicker-block">ANIMATED TOOL-ORCHESTRATION &amp; EVIDENCE BOUNDARY</div>
                <svg viewBox="0 0 460 275" className="ed-svg">
                  <rect x="0" y="0" width="460" height="275" rx="10" fill="#f8fafc" />
                  <rect x="35" y="18" width="390" height="44" rx="8" fill="#ffffff" stroke="#cbd5e1" />
                  <text x="230" y="44" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#111827">1. User Prompt + Live Context (Run, Playhead, ROI)</text>

                  <line x1="230" y1="62" x2="230" y2="86" stroke="#0f766e" strokeWidth="2" className="anim-stream" />
                  <rect x="35" y="86" width="390" height="44" rx="8" fill="#ffffff" stroke={guardrail === "unsafe" ? "#dc2626" : "#0f766e"} strokeWidth="1.5" />
                  <text x="230" y="112" textAnchor="middle" fontSize="11.5" fontWeight="700" fill={guardrail === "unsafe" ? "#b91c1c" : "#0f766e"}>
                    {guardrail === "unsafe" ? "2. Guardrail Triggered → Refuses Unsupported Clinical Claim" : "2. LLM Dispatches Typed Python Tool (No Raw Arrays)"}
                  </text>

                  <line x1="230" y1="130" x2="230" y2="154" stroke="#0f766e" strokeWidth="2" className="anim-stream" />
                  <rect x="35" y="154" width="390" height="44" rx="8" fill="#ffffff" stroke="#cbd5e1" />
                  <text x="230" y="180" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#111827">3. Python Computes Stats + Generates Matplotlib Figure</text>

                  <line x1="230" y1="198" x2="230" y2="222" stroke="#0f766e" strokeWidth="2" className="anim-stream" />
                  <rect x="35" y="222" width="390" height="36" rx="8" fill="#f0fdfa" stroke="#0f766e" />
                  <text x="230" y="244" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#0f766e">4. Cited Answer + Interactive [E#] Evidence Drawer</text>
                </svg>
              </div>
            </div>
          )}

          {/* 17 · GROUP RESULTS */}
          {slide.id === "s17" && (
            <div className="deck-stack">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div className="ed-toggle-pill">
                  <button type="button" className={resMetric === "mean_7_10" ? "active" : ""} onClick={() => setResMetric("mean_7_10")}>Primary: Mean ΔHbO (7–10 s)</button>
                  <button type="button" className={resMetric === "nadir_5_15" ? "active" : ""} onClick={() => setResMetric("nadir_5_15")}>Secondary: Nadir Dip (5–15 s)</button>
                </div>
                {groupCharts && (
                  <div className="res-kpis">
                    <span>Morphine pre→90m: <b>+{groupCharts.mor90?.difference?.toFixed(3)} µM</b> (p={groupCharts.mor90?.p?.toFixed(3)}, q={groupCharts.mor90?.p_fdr?.toFixed(3)})</span>
                    <span>Placebo pre→90m: <b>{groupCharts.pla90?.difference?.toFixed(3)} µM</b> (p={groupCharts.pla90?.p?.toFixed(2)})</span>
                    <span>Direct contrast: <b>+{groupCharts.pt90?.difference?.toFixed(3)} µM</b> (p={groupCharts.pt90?.p?.toFixed(3)}, q={groupCharts.pt90?.p_fdr?.toFixed(3)})</span>
                  </div>
                )}
              </div>
              {groupCharts && (
                <div className="deck-split ed-50-50">
                  <div className="ed-visual">
                    <FullPlot
                      traces={groupCharts.timeTraces}
                      layout={{
                        title: { text: "Group Mean Time-Course Plot (Medial BA10)", x: 0, xanchor: "left", y: 0.97, yanchor: "top", font: { size: 11.5 } },
                        margin: { l: 50, r: 14, t: 50, b: 34 },
                        legend: { orientation: "h", y: 1.13, x: 0, font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
                        xaxis: { tickvals: [0, 1, 2, 3], ticktext: ["Pre", "30 min", "60 min", "90 min"], range: [-0.3, 3.3] },
                        yaxis: { title: { text: "ΔHbO (µM)" } },
                      }}
                      height={275}
                    />
                  </div>
                  <div className="ed-visual">
                    <FullPlot
                      traces={groupCharts.pairedTraces}
                      layout={{
                        title: { text: "Paired Participant Plot at 90 min (Individual Subjects)", x: 0, xanchor: "left", y: 0.97, yanchor: "top", font: { size: 11.5 } },
                        margin: { l: 50, r: 14, t: 50, b: 34 },
                        legend: { orientation: "h", y: 1.13, x: 0, font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
                        yaxis: { title: { text: "ΔHbO (µM)" } },
                      }}
                      height={275}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 18 · REFERENCES, VALIDATION SUMMARY & PORTAL HANDOFF */}
          {slide.id === "s18" && (
            <div className="deck-split ed-60-40">
              <div className="ed-col">
                <h3>References &amp; Asset Provenance</h3>
                <ol className="pres-refs">
                  {REFERENCES.map((r) => (
                    <li key={r.id}>
                      <span className="ref-num">[{r.id}]</span>
                      <span>{r.cite}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="ed-col">
                <h3>Validation, Caveats &amp; Live Portal</h3>
                <ul className="ed-list">
                  <li><b>Verification:</b> 4/4 <code>pytest</code> unit tests + 500-permutation shuffled-onset negative control (true −0.071 vs null +0.003 µM, <code>p = 0.002</code>).</li>
                  <li><b>Key caveats:</b> Assumed chronological run order (<code>scans.tsv</code>), small <code>n = 12–14</code>, and trend-level direct contrast (<code>q = 0.375</code>).</li>
                </ul>
                <div className="pres-handoff" style={{ marginTop: 10 }}>
                  <button type="button" className="pres-jump primary" onClick={() => onJump("monitor")}>Launch Live Monitor →</button>
                  <button type="button" className="pres-jump" onClick={() => onJump("pipeline")}>Inspect 7-Stage Pipeline →</button>
                  <button type="button" className="pres-jump" onClick={() => onJump("compare")}>Open Group Compare →</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {showNotes && (
        <div className="deck-notes">
          <b>Presenter cue:</b> {slide.note}
        </div>
      )}

      <footer className="deck-foot">
        <div className="pres-progress">
          <i style={{ width: `${((idx + 1) / SLIDES.length) * 100}%` }} />
        </div>
        <div className="pres-foot-meta">
          <span>← / → navigate · N notes · F fullscreen · Esc exit to portal</span>
          <span>OpenNeuro ds005777 · Grounded fNIRS Research Prototype</span>
        </div>
      </footer>
    </div>
  );
}

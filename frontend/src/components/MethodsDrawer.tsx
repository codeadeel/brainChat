import { useEffect } from "react";

const SECTIONS = [
  {
    title: "Pipeline",
    body: (
      <ol>
        <li>Raw intensity → optical density (MNE).</li>
        <li>Motion detection on robust ΔOD; TDDR correction.</li>
        <li>Modified Beer–Lambert, DPF = 6 → HbO/HbR in µM.</li>
        <li>Nearest short-separation channel regressed out of each long channel.</li>
        <li>0.01–0.2 Hz zero-phase band-pass; 10 Hz display downsample.</li>
        <li>The live monitor adds a 30 s causal high-pass so the trace stays centred; statistics use the cached band-passed data.</li>
        <li>Trial epochs −5…+25 s; 5 s pre-stimulus baseline.</li>
      </ol>
    ),
  },
  {
    title: "Quality control",
    body: (
      <ul>
        <li>SCI &lt; 0.70 → low 690/830 cardiac coupling.</li>
        <li>Intensity CV &gt; 0.15 → unstable contact.</li>
        <li>Motion &gt; 10% of samples → flagged channel.</li>
        <li>Trials with motion in −2…+15 s are excluded.</li>
        <li>Flagged channels remain visible but are excluded from ROI means.</li>
      </ul>
    ),
  },
  {
    title: "3D anatomy",
    body: (
      <p>
        The Face and Brain views use generic anatomical assets, not participant MRI. The head is the
        Lee Perry-Smith scan (Infinite-Realities, CC BY 3.0); the brain is an Innerscene CC0 mesh with
        sculpted gyri, cerebellum and brainstem. Optode positions are projected onto the generic scalp
        from the dataset’s recorded 2D coordinates.
      </p>
    ),
  },
  {
    title: "Statistics",
    body: (
      <ul>
        <li>Primary metric: mean ΔHbO 7–10 s after onset.</li>
        <li>Nadir/peak 5–15 s with latency.</li>
        <li>One-sample t-test across trials; Cohen’s dz.</li>
        <li>Within-visit: paired post vs pre across subjects.</li>
        <li>Between-condition: paired morphine vs placebo across subjects.</li>
        <li>Bootstrap 95% CI; Benjamini–Hochberg FDR within each family.</li>
      </ul>
    ),
  },
  {
    title: "Validation",
    body: (
      <ul>
        <li>4 automated tests: event normalisation, synthetic HRF recovery, null recovery.</li>
        <li>Shuffled-onset negative control: true −0.071 µM vs null +0.003 µM; p = 0.002.</li>
        <li>Pre-drug VAS7 medial BA10: −0.091 µM 7–10 s, p = 0.009.</li>
        <li>Within-morphine 90 min: +0.108 µM, p = 0.018, q = 0.055.</li>
        <li>Between-condition 90 min: +0.073 µM, p = 0.094, q = 0.375 (trend only).</li>
      </ul>
    ),
  },
  {
    title: "Limitations",
    body: (
      <ul>
        <li>The 30/60/90 min labels rely on BIDS run order; timestamps were not preserved.</li>
        <li>Small n (12–14), 2–6 usable trials per visit in some subjects.</li>
        <li>Trial averages are less efficient than a full HRF-basis GLM.</li>
        <li>Between-condition effect is sensitive to preprocessing and does not survive FDR.</li>
        <li>Systemic physiology, motion and optode coupling remain confounds.</li>
        <li>Replay, not real-time hardware. Not a medical device.</li>
      </ul>
    ),
  },
  {
    title: "References",
    body: (
      <ul>
        <li>Peng et al. 2018, Front. Hum. Neurosci. 12:394.</li>
        <li>OpenNeuro ds005777 (v1.0.1).</li>
        <li>MNE / MNE-NIRS documentation for OD, MBLL, SCI, TDDR.</li>
        <li>AI Neuroscientist, arXiv:2609.25254 (2026).</li>
        <li>BrainBench, arXiv:2608.04156 (2026).</li>
        <li>NeuraDock / boundary-aware grounding, arXiv:2606.26519 (2026).</li>
      </ul>
    ),
  },
];

/** Slide-over Portal & Study Guide summarizing pipeline rules, QC thresholds, validation, and references. */
export default function MethodsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!open) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">Reference Guide</div>
            <h2>Portal &amp; study guide</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close guide">
            ✕
          </button>
        </div>
        <div className="drawer-scroll">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              {s.body}
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

# Research notes (November 2026)

The prototype was designed against the 2025–2026 literature on agents for brain-signal
analysis, not only the original 2018 fNIRS paper.

## 1. The AI Neuroscientist (arXiv:2609.25254, Sep 2026)

**“The AI Neuroscientist: An Interactive Agentic Interface for Neuroimaging Analysis.”**
Patel et al., Yale. An LLM agent over a curated fNIRS toolset: discovery, QC, conversion,
GLM, visualisation, literature search. Every tool call writes an explicit intermediate
artefact; interpretation is tied to inspectable evidence.

**Design implication:** use a small, capability-oriented tool registry, not free-form code
generation. Cache and expose artefacts. The prototype’s six functional groups (discovery,
current state, QC, event analysis, comparison, evidence) mirror this.

## 2. BrainBench (arXiv:2608.04156, Aug 2026)

**“BrainBench: Benchmarking Large Language Models for Comprehensive EEG Understanding.”**
Zhou et al., Zhejiang University. 13 LLMs, 172 tasks, 4K instances, two paradigms:
autonomous code execution (CodeAct) vs structured tool use (BrainAgent).

Key finding: **structured agentic workflows give the most consistent advantage on
numerical validation**, and lower within-task variability. Other output types are mixed.

**Design implication:** typed tools with deterministic implementations for every number.
This is why the LLM never computes fNIRS metrics itself.

## 3. NeuraDock / “What the LLM Should Not Say” (arXiv:2606.26519, Jun 2026)

**“Boundary-Aware Context Grounding for a Seven-Channel EEG Agent.”** Xu et al. Separates a
deterministic local engine from a hardware-aware language layer. The LLM receives a
compact, allow-listed summary and a versioned context pack describing hardware, reviewed
workflows, result fields, implementation boundaries, scientific limits and reference
cases. Raw arrays stay local.

**Design implication:** the context pack in `prompts.py` and the refusal rules. The agent
knows what it cannot support (pain diagnosis, source localisation, causality) and is
evaluated on boundary awareness.

## 4. Trustworthy agentic neuroimaging (arXiv:2611.01449, Nov 2026)

**“Governing Scientific Reporting for Trustworthy Agentic Neuroimaging.”** Argues that
agents need auditable reporting: provenance, assumptions, uncertainty and reproducibility,
not only final answers.

**Design implication:** the tool trace, evidence IDs, method/caveat fields, cached arrays
and the “assumed run order” caveat.

## 5. fNIRS reproducibility and short-channel regression

- **fNIRS reproducibility varies with data quality, analysis pipelines and researcher
  experience** (Commun Biol 2025). Preprocessing choices materially change results.
- **Optimizing short-channel regression in fNIRS** (2025) — SC regression is essential for
  recovering physiologically meaningful signals; there is no consensus on the best variant.
- **Best practices for fNIRS publications** (Yücel et al.) and the fNIRS.org signal-quality
  guidance — SCI, cardiac coupling, motion inspection, short channels.

**Design implication:** explicit pipeline, QC thresholds, sensitivity discussion, and the
decision not to over-claim the between-condition result.

## 6. Original dataset paper

Peng et al. (2018), *Morphine attenuates fNIRS signal associated with painful stimuli in the
medial frontopolar cortex (medial BA 10)*, Front. Hum. Neurosci. 12:394.

Findings used as the physiological anchor:

- noxious stimuli → medial BA10 HbO **decrease**;
- morphine attenuates this decrease, strongest at **60 min**;
- no clear morphine effect on innocuous stimuli;
- 3 of 14 subjects excluded for poor frontal signal.

This reanalysis detects the pre-drug BA10 deactivation and a within-morphine attenuation
at **90 min**, but not the 60-min effect. The difference is discussed in
`VALIDATION.md` (pipeline, ROI selection, subject inclusion, run-order assumption).

## 7. Other relevant work

- **BrainAgent** (arXiv:2606.25400): multi-agent framework for autonomous brain-signal
  understanding; explicitly plans extension to fNIRS/fMRI.
- **NeuroAgent** (arXiv:2605.06584): LLM agents for multimodal neuroimaging preprocessing.
- **CogEEGAgent** (arXiv:2607.25045): tool-grounded, auditable cognitive-EEG analysis.
- **MNE / MNE-NIRS**: optical density, modified Beer–Lambert, SCI, TDDR, GLM tooling.

## Design summary

| Research lesson | Prototype choice |
|---|---|
| Structured tools beat code generation for numerical accuracy | 11 typed tools, no model-written analysis code |
| Raw arrays should stay local | LLM sees compact JSON; figures/arrays stay on the server |
| Boundary-aware grounding reduces unsupported claims | versioned context pack + refusal rules + evidence IDs |
| Auditable reporting | tool trace, evidence cards, method/caveats, run-order caveat |
| Pipeline choices matter | explicit preprocessing, QC, sensitivity discussion |
| Evidence must be inspectable | clickable citations → figure + numbers + method |

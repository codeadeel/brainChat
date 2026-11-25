# Research Context & Grounding Design

The system architecture integrates findings from recent 2025–2026 agentic neuroimaging literature alongside the original Peng et al. (2018) fNIRS study.

## Literature Pillars & Design Choices

1. **Curated Tools Over Free-Form Code Generation** (*AI Neuroscientist*, `arXiv:2609.25254`; *BrainBench*, `arXiv:2608.04156`):
   Structured tool registries outperform unconstrained code generation on numerical reliability and reduce run-to-run variance. Accordingly, our LLM never writes analysis code or inspects raw arrays; it calls **11 typed Python tools** backed by pre-validated signal functions.
2. **Boundary-Aware Context Grounding** (*NeuraDock*, `arXiv:2606.26519`):
   Separating the local deterministic engine from a compact, versioned context pack (`backend/prompts.py`) ensures the model understands proxy limitations (`ΔHbO ≠ subjective pain`) and refuses unsupported clinical or causal inferences.
3. **Auditable Scientific Reporting** (*Trustworthy Agentic Neuroimaging*, `arXiv:2611.01449`):
   Every numerical claim is linked to an expandable `Tool Trace` and an immutable `[E#]` evidence card containing the figure, test statistics, method, and provenance caveats (such as the unverified `scans.tsv` run order).
4. **fNIRS Preprocessing Sensitivity** (Peng et al., 2018; Yücel et al., Best Practices; 2025 SC-regression studies):
   Because between-condition fNIRS contrasts depend heavily on superficial scalp regression and QC choices, the portal exposes all **7 pipeline stages** visually (`Pipeline` tab) and reports exploratory contrasts conservatively alongside BH-FDR values.

## Summary Mapping

| Principle | Implementation in `brainChat` |
|---|---|
| Deterministic math | 11 typed tools over cached `.npz` arrays; zero raw arrays sent to LLM |
| Inspectable evidence | Session-scoped `[E#]` cards linking matplotlib PNGs, stats, and caveats |
| Boundary enforcement | Prompt & refusal rules blocking pain diagnosis and causal single-trial claims |
| Pipeline transparency | Interactive 7-stage visual workbench with formulas, overlays, and PSDs |

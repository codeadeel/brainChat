export const ROI_DISPLAY: Record<string, string> = {
  medial_ba10: "Medial BA10",
  left_pfc: "Left PFC",
  right_s1: "Right S1",
  short: "Short (8 mm)",
  other: "Other",
};

export function roiLabel(roi: string): string {
  return ROI_DISPLAY[roi] ?? roi.replace(/_/g, " ");
}

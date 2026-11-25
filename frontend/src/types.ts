export type Roi =
  | "medial_ba10"
  | "left_pfc"
  | "right_s1"
  | "short"
  | "other";

export interface ChannelMeta {
  name: string;
  source: string;
  detector: string;
  paper_index?: number | null;
  roi: Roi;
  short: boolean;
  x_mid: number;
  y_mid: number;
  separation_mm: number;
  sci: number | null;
  cv: number | null;
  motion_frac: number | null;
  cardiac_ratio: number | null;
  good: boolean;
  flags: string[];
  source_xy?: [number, number] | null;
  detector_xy?: [number, number] | null;
}

export interface EventMeta {
  index: number;
  onset: number;
  duration: number;
  type: string;
  value: number;
  practice: boolean | number;
  excluded: boolean | number;
  motion_any?: boolean | number;
  exclude_reason?: string;
  raw_type?: string;
}

export interface RunMeta {
  run_id: string;
  subject: string;
  session: string;
  condition: "morphine" | "placebo";
  timepoint: "pre" | "30min" | "60min" | "90min" | "extra";
  run: string;
  fs: number;
  duration_s: number;
  qc: {
    n_good: number;
    n_bad: number;
    median_sci: number | null;
    median_cv: number | null;
    motion_fraction: number | null;
    n_events: number;
    n_events_excluded: number;
    n_events_with_motion: number;
  };
  processing_seconds?: number;
}

export interface RunData {
  run_id: string;
  meta: RunMeta;
  time: number[];
  sample_rate: number;
  channels: ChannelMeta[];
  all_channels: ChannelMeta[];
  hbo: (number | null)[][];
  hbr: (number | null)[][];
  events: EventMeta[];
  default_channels: string[];
}

export interface Catalog {
  dataset: string;
  n_subjects: number;
  subjects: string[];
  visits: Record<
    string,
    {
      visits: Record<string, "morphine" | "placebo">;
      sessions: Record<
        string,
        { condition: "morphine" | "placebo"; visit: string; runs: string[] }
      >;
    }
  >;
  sessions: Record<
    string,
    {
      session: string;
      visit: string;
      condition: "morphine" | "placebo";
      channels: ChannelMeta[];
    }
  >;
  runs: Record<
    string,
    {
      run_id: string;
      subject: string;
      session: string;
      condition: "morphine" | "placebo";
      timepoint: RunMeta["timepoint"];
      run: string;
      n_events: number;
    }
  >;
  roi_labels: Record<string, string>;
  timepoint_labels: Record<string, string>;
  group_available: boolean;
  group_generated_at: string | null;
}

export interface EvidenceMeta {
  id: string;
  kind?: string;
  title: string;
  summary?: string | null;
  figure_url?: string | null;
  stats?: Record<string, unknown> | null;
  method?: string;
  caveats?: string[];
  created_at?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  evidence?: string[];
}

export interface TraceEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status?: string | null;
  summary?: string | null;
}

export interface UiAction {
  type: "set_view";
  channels?: string[] | null;
  start?: number | null;
  end?: number | null;
  tab?: "monitor" | "compare";
}

export interface GroupPoint {
  n: number;
  morphine_mean: number | null;
  placebo_mean: number | null;
  morphine_sem: number | null;
  placebo_sem: number | null;
  difference: number | null;
  ci95: [number, number] | null;
  t: number | null;
  p: number | null;
  p_fdr?: number | null;
  cohen_dz: number | null;
  per_subject: { subject: string; morphine: number; placebo: number }[];
}

export interface GroupSummary {
  generated_at: string;
  n_subjects: number;
  rois: string[];
  event_types: string[];
  timepoints: string[];
  between_condition: Record<
    string,
    Record<string, Record<string, Record<string, GroupPoint>>>
  >;
  within_condition: Record<
    string,
    Record<
      string,
      Record<
        string,
        Record<
          string,
          Record<
            string,
            {
              n: number;
              pre_mean: number | null;
              post_mean: number | null;
              difference: number | null;
              ci95: [number, number] | null;
              t: number | null;
              p: number | null;
              p_fdr?: number | null;
              cohen_dz: number | null;
              per_subject: { subject: string; pre: number; post: number }[];
            }
          >
        >
      >
    >
  >;
  definitions: Record<string, string>;
}

export interface PipelineData {
  run_id: string;
  subject: string;
  condition: string;
  timepoint: string;
  channel: ChannelMeta;
  all_channels: ChannelMeta[];
  time: number[];
  events: { onset: number; duration: number; type: string; practice: boolean }[];
  stages: {
    raw: { wl690: (number | null)[]; wl830: (number | null)[]; cv: number; i0_690?: number; i0_830?: number };
    od: {
      od690: (number | null)[];
      od830: (number | null)[];
      sci: number;
      psd_freqs: number[];
      psd_690: (number | null)[];
      psd_830: (number | null)[];
    };
    tddr: {
      before: (number | null)[];
      after: (number | null)[];
      motion_intervals: [number, number][];
      motion_frac: number;
    };
    mbll: { hbo: (number | null)[]; hbr: (number | null)[]; dpf: number; separation_mm?: number };
    short_channel: {
      before: (number | null)[];
      after: (number | null)[];
      short_trace: (number | null)[];
      short_name: string | null;
      corr_before: number;
      removed_pct: number;
      beta?: number;
    };
    bandpass: {
      before: (number | null)[];
      after: (number | null)[];
      hbr_after: (number | null)[];
      psd_freqs: number[];
      psd_before: (number | null)[];
      psd_after: (number | null)[];
    };
    epoch: {
      t: number[];
      vas7_mean: (number | null)[];
      vas7_sem: (number | null)[];
      vas3_mean: (number | null)[];
      vas3_sem: (number | null)[];
      n_vas7: number;
      n_vas3: number;
      mean_7_10: number | null;
      nadir_5_15: number | null;
      nadir_latency_s: number | null;
    };
  };
}

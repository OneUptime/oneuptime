export interface LiveLogsOptions {
  isLive: boolean;
  onToggle: (next: boolean) => void;
  isDisabled?: boolean;
}

export interface HistogramBucket {
  time: string;
  severity: string;
  count: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

export type FacetData = Record<string, Array<FacetValue>>;

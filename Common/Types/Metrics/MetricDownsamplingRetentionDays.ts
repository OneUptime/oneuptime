// Per-tier retention (in days) for downsampled metric storage.
//
// On Project, this is the default that applies to all services.
// On Service, this is an optional override — null fields inherit from the project default.
//
// Keys are tier identifiers: "raw" (untouched OTel data points), "1m", "5m", "1h", "1d".

export default interface MetricDownsamplingRetentionDays {
  raw?: number | null;
  "1m"?: number | null;
  "5m"?: number | null;
  "1h"?: number | null;
  "1d"?: number | null;
}

export const DEFAULT_METRIC_DOWNSAMPLING_RETENTION_DAYS: Record<
  keyof MetricDownsamplingRetentionDays,
  number
> = {
  raw: 7,
  "1m": 14,
  "5m": 30,
  "1h": 90,
  "1d": 365,
};

export const DEFAULT_METRIC_CARDINALITY_BUDGET: number = 10000;

// Resolves the effective retention days for a given tier, falling back through
// service override → project default → hardcoded default.
export function resolveTierRetentionDays(
  tier: keyof MetricDownsamplingRetentionDays,
  serviceOverride: MetricDownsamplingRetentionDays | null | undefined,
  projectDefault: MetricDownsamplingRetentionDays | null | undefined,
): number {
  const serviceValue: number | null | undefined = serviceOverride?.[tier];
  if (typeof serviceValue === "number" && serviceValue > 0) {
    return serviceValue;
  }
  const projectValue: number | null | undefined = projectDefault?.[tier];
  if (typeof projectValue === "number" && projectValue > 0) {
    return projectValue;
  }
  return DEFAULT_METRIC_DOWNSAMPLING_RETENTION_DAYS[tier];
}

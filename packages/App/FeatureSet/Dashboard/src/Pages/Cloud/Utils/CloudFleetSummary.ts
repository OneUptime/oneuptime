import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "./CloudResourceTelemetryScope";

/*
 * The numbers behind the stat strip at the top of the Cloud Environments
 * list, and how they turn into tiles. The fetching lives in
 * Components/Cloud/CloudFleetSummary.tsx; this file is deliberately pure so
 * the wording and arithmetic can be unit tested without a renderer.
 */

export interface CloudFleetCounts {
  /* Unarchived environments. */
  total: number;
  /* Environments whose otelCollectorStatus is "connected". */
  connected: number;
  /* total - connected, computed by the caller so the strip cannot drift. */
  disconnected: number;
  /* Unarchived environments per CloudProvider value ("aws", "gcp", ...). */
  byProvider: Record<string, number>;
  /* CloudResourceInstance rows seen inside the live window. */
  liveInstances: number;
}

export interface CloudFleetSummaryTile {
  title: string;
  value: string;
  sublabel: string;
}

interface ProviderCount {
  provider: string;
  count: number;
}

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "0";
  }
  return String(Math.round(n));
}

/*
 * "3 AWS · 1 Google Cloud" — busiest provider first, ties broken by label so
 * the order is stable between refreshes. Providers with no environments are
 * left out rather than shown as zero.
 */
export function describeProviderBreakdown(
  byProvider: Record<string, number>,
): string {
  const entries: Array<ProviderCount> = Object.keys(byProvider)
    .map((provider: string): ProviderCount => {
      return { provider, count: byProvider[provider] || 0 };
    })
    .filter((entry: ProviderCount): boolean => {
      return entry.count > 0;
    })
    .sort((a: ProviderCount, b: ProviderCount): number => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return getCloudProviderLabel(a.provider).localeCompare(
        getCloudProviderLabel(b.provider),
      );
    });

  return entries
    .map((entry: ProviderCount): string => {
      return `${formatCount(entry.count)} ${getCloudProviderLabel(entry.provider)}`;
    })
    .join(" · ");
}

export function summarizeCloudFleet(
  counts: CloudFleetCounts,
): Array<CloudFleetSummaryTile> {
  const total: number = Math.max(0, counts.total);
  const connected: number = Math.min(total, Math.max(0, counts.connected));
  const disconnected: number = Math.max(0, counts.disconnected);
  const breakdown: string = describeProviderBreakdown(counts.byProvider);

  const connectedShare: string =
    total > 0
      ? `${Math.round((connected / total) * 100)}% of environments`
      : "";

  return [
    {
      title: "Environments",
      value: formatCount(total),
      sublabel: breakdown || "none discovered yet",
    },
    {
      title: "Connected",
      value: formatCount(connected),
      sublabel: connectedShare || "nothing reporting yet",
    },
    {
      title: "Disconnected",
      value: formatCount(disconnected),
      sublabel:
        disconnected > 0
          ? "no telemetry recently"
          : total > 0
            ? "every environment is reporting"
            : "—",
    },
    {
      title: "Live instances",
      value: formatCount(counts.liveInstances),
      sublabel: `seen in the last ${CLOUD_INSTANCE_LIVE_WINDOW_MINUTES} min`,
    },
  ];
}

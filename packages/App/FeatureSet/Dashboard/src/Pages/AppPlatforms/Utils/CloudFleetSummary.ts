import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "./CloudResourceTelemetryScope";
import { CLOUD_FLEET_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CloudMetricDescriptions";
import {
  getGlobalTranslator,
  translateTemplate,
} from "Common/UI/Utils/TranslateTemplate";

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
  /*
   * The line under the number, as the parts it is made of, when it is a
   * list: the providers' breakdown ("2 AWS", "2 Azure", "2 Google Cloud").
   * The strip keeps each part whole and wraps between them, so a narrow
   * tile never breaks "Google Cloud" across two lines.
   */
  sublabelParts?: Array<string> | undefined;
  // What the number counts, shown in the (i) tooltip beside the title.
  description: string;
}

interface ProviderCount {
  provider: string;
  count: number;
}

/*
 * A count as the reader's language writes it - 1,284 in English, 1.284 in
 * German, ۱٬۲۸۴ in Persian - as the sentences beside it write theirs
 * (translatePlural formats its count). Never negative, never a fraction.
 */
function formatCount(n: number): string {
  const count: number = !Number.isFinite(n) || n < 0 ? 0 : Math.round(n);

  return getGlobalTranslator().formatNumber(count);
}

/*
 * "3 AWS · 1 Google Cloud" — busiest provider first, ties broken by label so
 * the order is stable between refreshes. Providers with no environments are
 * left out rather than shown as zero.
 */
export function describeProviderBreakdown(
  byProvider: Record<string, number>,
): string {
  return getProviderBreakdownParts(byProvider).join(" · ");
}

// The same breakdown, one part per provider: "3 AWS", "1 Google Cloud".
export function getProviderBreakdownParts(
  byProvider: Record<string, number>,
): Array<string> {
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

  return entries.map((entry: ProviderCount): string => {
    return `${formatCount(entry.count)} ${getCloudProviderLabel(entry.provider)}`;
  });
}

export function summarizeCloudFleet(
  counts: CloudFleetCounts,
): Array<CloudFleetSummaryTile> {
  const total: number = Math.max(0, counts.total);
  const connected: number = Math.min(total, Math.max(0, counts.connected));
  const disconnected: number = Math.max(0, counts.disconnected);
  const breakdownParts: Array<string> = getProviderBreakdownParts(
    counts.byProvider,
  );
  const breakdown: string = breakdownParts.join(" · ");

  const connectedShare: string =
    total > 0
      ? translateTemplate("{{percent}}% of environments", {
          percent: formatCount((connected / total) * 100),
        })
      : "";

  return [
    {
      title: "Environments",
      value: formatCount(total),
      sublabel: breakdown || "none discovered yet",
      ...(breakdownParts.length > 1 ? { sublabelParts: breakdownParts } : {}),
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.environments,
    },
    {
      title: "Connected",
      value: formatCount(connected),
      sublabel: connectedShare || "nothing reporting yet",
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.connected,
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
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.disconnected,
    },
    {
      title: "Live instances",
      value: formatCount(counts.liveInstances),
      sublabel: translateTemplate("seen in the last {{minutes}} min", {
        minutes: formatCount(CLOUD_INSTANCE_LIVE_WINDOW_MINUTES),
      }),
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.liveInstances,
    },
  ];
}

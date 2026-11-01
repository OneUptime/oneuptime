import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "./CloudResourceTelemetryScope";
import { CLOUD_FLEET_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CloudMetricDescriptions";
import {
  PluralTemplate,
  getGlobalTranslator,
  translatePlural,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The numbers behind the stat strip at the top of App Platforms' Overview,
 * and how they turn into tiles: its apps and how many run, its environments
 * by provider, the instances live right now, and the deploys of the last
 * day. The fetching lives in Components/Cloud/CloudFleetSummary.tsx; this
 * file is deliberately pure so the wording and arithmetic can be unit
 * tested without a renderer.
 */

// The window the Deploys tile counts deploys in.
export const CLOUD_FLEET_DEPLOYS_WINDOW_HOURS: number = 24;

/*
 * How many environments went quiet, under their count. The noun is written
 * out, as the Overview's platform groups write it: "{{count}} disconnected"
 * is the probes', and its translations agree with "probe".
 */
export const ENVIRONMENTS_DISCONNECTED: PluralTemplate = {
  one: "{{count}} environment disconnected",
  other: "{{count}} environments disconnected",
};

/*
 * How many have never sent anything - just added, waiting for their first
 * data - when none went quiet. Grey on the Overview's platform cards and in
 * All Environments ("Waiting"), so the strip does not call them
 * disconnected either (#5511's UI review: it said "2 environments
 * disconnected" over a card that showed one disconnected and one waiting).
 */
export const ENVIRONMENTS_WAITING: PluralTemplate = {
  one: "{{count}} environment waiting for first data",
  other: "{{count}} environments waiting for first data",
};

export interface CloudFleetCounts {
  /* Unarchived environments. */
  total: number;
  /* Environments whose otelCollectorStatus is "connected". */
  connected: number;
  /*
   * Environments that have never sent anything (no lastSeenAt): waiting for
   * their first data, not disconnected.
   */
  waiting?: number | undefined;
  /*
   * total - connected - waiting, computed by the caller so the strip cannot
   * drift.
   */
  disconnected: number;
  /* Unarchived environments per CloudProvider value ("aws", "gcp", ...). */
  byProvider: Record<string, number>;
  /* CloudResourceInstance rows seen inside the live window. */
  liveInstances: number;
  /* Apps (CloudApp rows) of the project's environments. */
  apps: number;
  /* Apps whose telemetry arrived inside the live window. */
  runningApps: number;
  /* Revisions deployed in the last CLOUD_FLEET_DEPLOYS_WINDOW_HOURS. */
  deploys: number;
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
  const waiting: number = Math.min(
    total - connected,
    Math.max(0, counts.waiting || 0),
  );
  const disconnected: number = Math.max(0, total - connected - waiting);
  const apps: number = Math.max(0, counts.apps);
  const runningApps: number = Math.min(apps, Math.max(0, counts.runningApps));
  const breakdownParts: Array<string> = getProviderBreakdownParts(
    counts.byProvider,
  );
  const breakdown: string = breakdownParts.join(" · ");

  /*
   * What is not all right comes first in a tile's line: apps that went
   * quiet, environments that went quiet - then the ones still waiting for
   * their first data. All right, the line says so - or, for the
   * environments, which providers they are on.
   */
  const appsLine: string =
    apps === 0
      ? translationKey("none reported yet")
      : runningApps >= apps
        ? translationKey("all running")
        : translateTemplate("{{count}} not reporting", {
            count: formatCount(apps - runningApps),
          });

  const environmentsLine: string =
    total > 0 && disconnected > 0
      ? translatePlural(ENVIRONMENTS_DISCONNECTED, disconnected)
      : total > 0 && waiting > 0
        ? translatePlural(ENVIRONMENTS_WAITING, waiting)
        : breakdown || "none discovered yet";

  return [
    {
      title: "Apps",
      value: formatCount(apps),
      sublabel: appsLine,
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.apps,
    },
    {
      title: "Environments",
      value: formatCount(total),
      sublabel: environmentsLine,
      ...(environmentsLine === breakdown && breakdownParts.length > 1
        ? { sublabelParts: breakdownParts }
        : {}),
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.environments,
    },
    {
      title: "Deploys",
      value: formatCount(counts.deploys),
      sublabel: translateTemplate("in the last {{hours}} hours", {
        hours: formatCount(CLOUD_FLEET_DEPLOYS_WINDOW_HOURS),
      }),
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.deploys,
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

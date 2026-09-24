import { DATABASE_SERVER_LIVE_WINDOW_MINUTES } from "./DatabaseServerPresentation";
import DatabaseServerDiscoverySource, {
  DATABASE_SERVER_DISCOVERY_SOURCES,
} from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";

/*
 * The numbers behind the stat strip at the top of the Databases list, and
 * how they turn into tiles. The fetching lives in
 * Components/DatabaseServer/DatabaseServerSummaryStrip.tsx; this file is
 * pure so the wording and the arithmetic are unit-tested without a
 * renderer.
 */

export interface DatabaseFleetCounts {
  // Unarchived databases.
  total: number;
  // Unarchived databases whose engine metrics are connected.
  engineMetricsConnected: number;
  // Unarchived databases any source saw inside the live window.
  seenRecently: number;
  // Unarchived databases per discoverySource value.
  bySource: Record<string, number>;
}

export interface DatabaseFleetSummaryTile {
  title: string;
  value: string;
  sublabel: string;
}

/*
 * Short, lowercase source names for the breakdown line — "4 from traces ·
 * 2 Kubernetes · 1 manual" reads better in a tile than the filter labels.
 */
const SOURCE_SHORT_LABELS: Record<DatabaseServerDiscoverySource, string> = {
  [DatabaseServerDiscoverySource.Collector]: "collector",
  [DatabaseServerDiscoverySource.ClientSpans]: "from traces",
  [DatabaseServerDiscoverySource.Kubernetes]: "Kubernetes",
  [DatabaseServerDiscoverySource.Docker]: "Docker",
  [DatabaseServerDiscoverySource.Podman]: "Podman",
  [DatabaseServerDiscoverySource.Manual]: "manual",
};

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "0";
  }
  return String(Math.round(n));
}

/**
 * "4 from traces · 2 Kubernetes · 1 manual" — busiest source first, ties in
 * the filter's order. Sources with no databases are left out.
 */
export function describeDatabaseSourceBreakdown(
  bySource: Record<string, number>,
): string {
  const entries: Array<{ source: DatabaseServerDiscoverySource; count: number }> =
    DATABASE_SERVER_DISCOVERY_SOURCES.map(
      (
        source: DatabaseServerDiscoverySource,
      ): { source: DatabaseServerDiscoverySource; count: number } => {
        const count: number = Number(bySource?.[source]) || 0;
        return { source, count };
      },
    ).filter(
      (entry: {
        source: DatabaseServerDiscoverySource;
        count: number;
      }): boolean => {
        return entry.count > 0;
      },
    );

  entries.sort(
    (
      a: { source: DatabaseServerDiscoverySource; count: number },
      b: { source: DatabaseServerDiscoverySource; count: number },
    ): number => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return (
        DATABASE_SERVER_DISCOVERY_SOURCES.indexOf(a.source) -
        DATABASE_SERVER_DISCOVERY_SOURCES.indexOf(b.source)
      );
    },
  );

  return entries
    .map(
      (entry: {
        source: DatabaseServerDiscoverySource;
        count: number;
      }): string => {
        return `${formatCount(entry.count)} ${SOURCE_SHORT_LABELS[entry.source]}`;
      },
    )
    .join(" · ");
}

export function summarizeDatabaseFleet(
  counts: DatabaseFleetCounts,
): Array<DatabaseFleetSummaryTile> {
  const total: number = Math.max(0, Number(counts.total) || 0);
  const connected: number = Math.min(
    total,
    Math.max(0, Number(counts.engineMetricsConnected) || 0),
  );
  const seen: number = Math.min(
    total,
    Math.max(0, Number(counts.seenRecently) || 0),
  );
  const breakdown: string = describeDatabaseSourceBreakdown(
    counts.bySource || {},
  );

  return [
    {
      title: "Databases",
      value: formatCount(total),
      sublabel: breakdown || "none discovered yet",
    },
    {
      title: "Seen recently",
      value: formatCount(seen),
      sublabel: `in the last ${DATABASE_SERVER_LIVE_WINDOW_MINUTES} min`,
    },
    {
      title: "Engine metrics",
      value: formatCount(connected),
      sublabel:
        total === 0
          ? "—"
          : connected === 0
            ? "no Database Agent connected yet"
            : `${Math.round((connected / total) * 100)}% of databases`,
    },
    {
      title: "Without engine metrics",
      value: formatCount(total - connected),
      sublabel:
        total - connected > 0
          ? "queries from applications only"
          : total > 0
            ? "every database reports engine metrics"
            : "—",
    },
  ];
}

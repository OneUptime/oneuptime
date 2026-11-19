/*
 * WHAT READS A METRIC ADDED TO A CLOUD CONNECTION, SAID BEFORE IT IS
 * REMOVED (#9807).
 *
 * A Metrics monitor, a dashboard's widget or an SLO reads an added metric
 * as it reads a key metric: by the name it is stored under. Removed, the
 * connection stops reading it, and they get no new data of it. So the
 * resource's More Metrics asks first which of them read it - for that
 * resource, or for any resource of its type when it was added for every
 * one - and names them, each a link, before Remove.
 *
 * The server's answer (CloudResourceMetrics.readersOf), read here
 * defensively for the page.
 */

export enum CloudAddedMetricReaderKind {
  Monitor = "monitor",
  Dashboard = "dashboard",
  Slo = "slo",
}

export interface CloudAddedMetricReader {
  kind: CloudAddedMetricReaderKind;
  id: string;
  // As its person named it; "" when it has no name.
  name: string;
  // A dashboard's: the titles of its widgets that read it, "" for one with none.
  widgets: Array<string>;
}

export interface CloudAddedMetricReaders {
  // Monitors, then dashboards, then SLOs, each kind by name.
  readers: Array<CloudAddedMetricReader>;
  // Found reading it, but not the asker's to open: counted, never named.
  hidden: number;
  // The lookup stopped at its most rows of a kind: more may read it.
  isCapped: boolean;
}

// Rows of each kind the lookup reads at most.
export const CLOUD_ADDED_METRIC_READERS_MAX_ROWS: number = 500;

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readReader(value: unknown): CloudAddedMetricReader | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const kind: string = readText(raw["kind"]);
  const id: string = readText(raw["id"]);

  if (
    !id ||
    !(Object.values(CloudAddedMetricReaderKind) as Array<string>).includes(kind)
  ) {
    return null;
  }

  return {
    kind: kind as CloudAddedMetricReaderKind,
    id,
    name: readText(raw["name"]),
    widgets: Array.isArray(raw["widgets"])
      ? (raw["widgets"] as Array<unknown>).filter(
          (widget: unknown): widget is string => {
            return typeof widget === "string";
          },
        )
      : [],
  };
}

// The server's answer, read defensively; null when it is not one.
export function readCloudAddedMetricReaders(
  value: unknown,
): CloudAddedMetricReaders | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  if (!Array.isArray(raw["readers"])) {
    return null;
  }

  const hidden: unknown = raw["hidden"];

  return {
    readers: (raw["readers"] as Array<unknown>)
      .map(readReader)
      .filter(
        (
          reader: CloudAddedMetricReader | null,
        ): reader is CloudAddedMetricReader => {
          return reader !== null;
        },
      ),
    hidden:
      typeof hidden === "number" && Number.isFinite(hidden) && hidden > 0
        ? Math.floor(hidden)
        : 0,
    isCapped: raw["isCapped"] === true,
  };
}

const KIND_ORDER: Record<CloudAddedMetricReaderKind, number> = {
  [CloudAddedMetricReaderKind.Monitor]: 0,
  [CloudAddedMetricReaderKind.Dashboard]: 1,
  [CloudAddedMetricReaderKind.Slo]: 2,
};

// Monitors, then dashboards, then SLOs, each kind by name, case aside.
export function sortCloudAddedMetricReaders(
  readers: ReadonlyArray<CloudAddedMetricReader>,
): Array<CloudAddedMetricReader> {
  return [...readers].sort(
    (a: CloudAddedMetricReader, b: CloudAddedMetricReader): number => {
      const byKind: number = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];

      if (byKind !== 0) {
        return byKind;
      }

      const nameA: string = a.name.toLowerCase();
      const nameB: string = b.name.toLowerCase();

      return nameA < nameB ? -1 : nameA > nameB ? 1 : a.id < b.id ? -1 : 1;
    },
  );
}

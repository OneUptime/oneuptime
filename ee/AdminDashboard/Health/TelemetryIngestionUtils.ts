import { JSONArray, JSONObject } from "Common/Types/JSON";

/*
 * -----------------------------------------------------------------------------
 * View model for the Telemetry diagnostics page.
 *
 * Everything here is pure: parsing the two health endpoints' JSON, ordering and
 * filtering tenants, and turning counts into the strings the table shows. It is
 * deliberately separate from the components so the rules that are easy to get
 * quietly wrong — a null count that must not read as zero, a share that must not
 * divide by zero, a sort that must not shuffle between refreshes — can be
 * tested without rendering anything.
 * -----------------------------------------------------------------------------
 */

// The order the three signals are shown in, everywhere on the page.
export const TELEMETRY_SIGNAL_ORDER: Array<string> = [
  "Logs",
  "Metrics",
  "Traces",
];

export interface TelemetryCounts {
  lastMinute: number | null;
  lastHour: number | null;
  lastDay: number | null;
}

export interface TelemetrySignalCounts extends TelemetryCounts {
  telemetryType: string;
}

export interface TelemetrySignalRow extends TelemetrySignalCounts {
  table: string;
  uncompressedBytes: number | null;
  available: boolean;
}

export interface TelemetryProjectRow extends TelemetryCounts {
  projectId: string;
  projectName: string | null;
  signals: Array<TelemetrySignalCounts>;
}

export interface TelemetrySignalIngestionView {
  connected: boolean;
  signals: Array<TelemetrySignalRow>;
}

export interface TelemetryProjectIngestionView {
  connected: boolean;
  truncated: boolean;
  maxProjectsPerSignal: number | null;
  unavailableSignals: Array<string>;
  projects: Array<TelemetryProjectRow>;
}

export enum TelemetrySortDirection {
  Ascending = "asc",
  Descending = "desc",
}

/*
 * What the table is ordered by. "Total" and the three signal names sort on the
 * last-24-hours window (the column those cells show); "Project" sorts by label.
 */
export enum TelemetrySortColumn {
  Project = "Project",
  Total = "Total",
  LastHour = "LastHour",
  LastMinute = "LastMinute",
}

/*
 * ---------------------------------------------------------------------------
 * Parsing
 * ---------------------------------------------------------------------------
 */

function asArray(value: unknown): JSONArray {
  return Array.isArray(value) ? (value as JSONArray) : [];
}

function asObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

/*
 * A count we could not read stays null and renders as "—". Zero is a real
 * answer ("this tenant sent nothing"); null is "we do not know", and the two
 * must never be conflated on a page an operator uses to decide whether ingestion
 * has stopped.
 */
export function toCountOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sumOrNull(values: Array<number | null>): number | null {
  const known: Array<number> = values.filter(
    (value: number | null): value is number => {
      return value !== null;
    },
  );

  if (known.length === 0) {
    return null;
  }

  return known.reduce((sum: number, value: number): number => {
    return sum + value;
  }, 0);
}

function parseCounts(row: JSONObject): TelemetryCounts {
  return {
    lastMinute: toCountOrNull(row["lastMinute"]),
    lastHour: toCountOrNull(row["lastHour"]),
    lastDay: toCountOrNull(row["lastDay"]),
  };
}

export function parseSignalIngestion(
  data: JSONObject | null,
): TelemetrySignalIngestionView {
  const signals: Array<TelemetrySignalRow> = asArray(data?.["tables"]).map(
    (value: unknown): TelemetrySignalRow => {
      const row: JSONObject = asObject(value);
      const counts: TelemetryCounts = parseCounts(row);

      return {
        telemetryType: String(row["telemetryType"] ?? row["table"] ?? "—"),
        table: String(row["table"] ?? ""),
        uncompressedBytes: toCountOrNull(row["uncompressedBytes"]),
        available: Boolean(row["available"]),
        ...counts,
      };
    },
  );

  return {
    connected: Boolean(data?.["connected"]),
    signals,
  };
}

export function parseProjectIngestion(
  data: JSONObject | null,
): TelemetryProjectIngestionView {
  const unavailableSignals: Array<string> = asArray(data?.["signals"])
    .map((value: unknown): JSONObject => {
      return asObject(value);
    })
    .filter((row: JSONObject): boolean => {
      return !row["available"];
    })
    .map((row: JSONObject): string => {
      return String(row["telemetryType"] ?? "");
    });

  const projects: Array<TelemetryProjectRow> = asArray(data?.["projects"]).map(
    (value: unknown): TelemetryProjectRow => {
      const row: JSONObject = asObject(value);
      const name: unknown = row["projectName"];

      return {
        projectId: String(row["projectId"] ?? ""),
        projectName: typeof name === "string" && name.length > 0 ? name : null,
        signals: asArray(row["signals"]).map(
          (signalValue: unknown): TelemetrySignalCounts => {
            const signalRow: JSONObject = asObject(signalValue);

            return {
              telemetryType: String(signalRow["telemetryType"] ?? "—"),
              ...parseCounts(signalRow),
            };
          },
        ),
        ...parseCounts(row),
      };
    },
  );

  return {
    connected: Boolean(data?.["connected"]),
    truncated: Boolean(data?.["truncated"]),
    maxProjectsPerSignal: toCountOrNull(data?.["maxProjectsPerSignal"]),
    unavailableSignals,
    projects,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Reading a project's numbers
 * ---------------------------------------------------------------------------
 */

/*
 * A project whose name Postgres could not resolve — deleted, but still inside
 * the telemetry retention window — is labelled by id rather than dropped, so the
 * volume it is still responsible for stays attributable.
 */
export function projectDisplayName(project: TelemetryProjectRow): string {
  return project.projectName || `Unnamed project · ${project.projectId}`;
}

export function getSignalCounts(
  project: TelemetryProjectRow,
  telemetryType: string,
): TelemetryCounts {
  const signal: TelemetrySignalCounts | undefined = project.signals.find(
    (candidate: TelemetrySignalCounts): boolean => {
      return candidate.telemetryType === telemetryType;
    },
  );

  return {
    lastMinute: signal ? signal.lastMinute : null,
    lastHour: signal ? signal.lastHour : null,
    lastDay: signal ? signal.lastDay : null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Filtering, sorting, summarising
 * ---------------------------------------------------------------------------
 */

/*
 * Free-text filter over the label an operator can actually see plus the raw id,
 * so pasting a project id out of a log line finds its row.
 */
export function filterProjects(
  projects: Array<TelemetryProjectRow>,
  searchText: string,
): Array<TelemetryProjectRow> {
  const needle: string = searchText.trim().toLowerCase();

  if (needle.length === 0) {
    return projects;
  }

  return projects.filter((project: TelemetryProjectRow): boolean => {
    return (
      (project.projectName || "").toLowerCase().includes(needle) ||
      project.projectId.toLowerCase().includes(needle)
    );
  });
}

function sortValueFor(
  project: TelemetryProjectRow,
  column: TelemetrySortColumn,
  signalColumn: string | null,
): number | null {
  if (signalColumn) {
    return getSignalCounts(project, signalColumn).lastDay;
  }

  if (column === TelemetrySortColumn.LastHour) {
    return project.lastHour;
  }

  if (column === TelemetrySortColumn.LastMinute) {
    return project.lastMinute;
  }

  return project.lastDay;
}

/*
 * Sorting rules that keep the table honest:
 *
 *   - an unknown count (null) always sinks to the bottom, in BOTH directions.
 *     Ascending by traces is asked when looking for tenants that stopped sending
 *     them, and a row we simply could not measure is not an answer to that.
 *   - projectId breaks every tie, so two tenants with identical volumes hold
 *     their position across refreshes instead of swapping on each poll.
 */
export function sortProjects(data: {
  projects: Array<TelemetryProjectRow>;
  column: TelemetrySortColumn;
  // Set when the column is one of the three signals rather than a total.
  signalColumn?: string | null | undefined;
  direction: TelemetrySortDirection;
}): Array<TelemetryProjectRow> {
  const signalColumn: string | null = data.signalColumn || null;
  const sign: number =
    data.direction === TelemetrySortDirection.Ascending ? 1 : -1;

  return [...data.projects].sort(
    (left: TelemetryProjectRow, right: TelemetryProjectRow): number => {
      if (data.column === TelemetrySortColumn.Project && !signalColumn) {
        return (
          sign *
            projectDisplayName(left).localeCompare(projectDisplayName(right)) ||
          left.projectId.localeCompare(right.projectId)
        );
      }

      const leftValue: number | null = sortValueFor(
        left,
        data.column,
        signalColumn,
      );
      const rightValue: number | null = sortValueFor(
        right,
        data.column,
        signalColumn,
      );

      if (leftValue === null || rightValue === null) {
        if (leftValue === rightValue) {
          return left.projectId.localeCompare(right.projectId);
        }

        return leftValue === null ? 1 : -1;
      }

      return (
        sign * (leftValue - rightValue) ||
        left.projectId.localeCompare(right.projectId)
      );
    },
  );
}

export interface TelemetryProjectSummary {
  projectCount: number;
  lastMinute: number | null;
  lastHour: number | null;
  lastDay: number | null;
  byTelemetryType: Array<TelemetrySignalCounts>;
  topProject: TelemetryProjectRow | null;
}

export function summarizeProjects(
  projects: Array<TelemetryProjectRow>,
): TelemetryProjectSummary {
  const byTelemetryType: Array<TelemetrySignalCounts> =
    TELEMETRY_SIGNAL_ORDER.map(
      (telemetryType: string): TelemetrySignalCounts => {
        const counts: Array<TelemetryCounts> = projects.map(
          (project: TelemetryProjectRow): TelemetryCounts => {
            return getSignalCounts(project, telemetryType);
          },
        );

        return {
          telemetryType,
          lastMinute: sumOrNull(
            counts.map((count: TelemetryCounts): number | null => {
              return count.lastMinute;
            }),
          ),
          lastHour: sumOrNull(
            counts.map((count: TelemetryCounts): number | null => {
              return count.lastHour;
            }),
          ),
          lastDay: sumOrNull(
            counts.map((count: TelemetryCounts): number | null => {
              return count.lastDay;
            }),
          ),
        };
      },
    );

  const topProject: TelemetryProjectRow | null =
    projects.reduce(
      (
        best: TelemetryProjectRow | null,
        project: TelemetryProjectRow,
      ): TelemetryProjectRow | null => {
        if ((project.lastDay ?? 0) <= 0) {
          return best;
        }

        if (!best || (project.lastDay ?? 0) > (best.lastDay ?? 0)) {
          return project;
        }

        return best;
      },
      null,
    ) || null;

  return {
    projectCount: projects.length,
    lastMinute: sumOrNull(
      projects.map((project: TelemetryProjectRow): number | null => {
        return project.lastMinute;
      }),
    ),
    lastHour: sumOrNull(
      projects.map((project: TelemetryProjectRow): number | null => {
        return project.lastHour;
      }),
    ),
    lastDay: sumOrNull(
      projects.map((project: TelemetryProjectRow): number | null => {
        return project.lastDay;
      }),
    ),
    byTelemetryType,
    topProject,
  };
}

/*
 * A project's percentage of the day's total rows. Unknown inputs and an empty
 * instance both give 0 rather than NaN or Infinity — the bar is decoration, and
 * a bar that renders at `width: NaN%` breaks the whole row's layout.
 */
export function computeSharePercent(
  value: number | null,
  total: number | null,
): number {
  if (value === null || total === null || total <= 0 || value <= 0) {
    return 0;
  }

  return Math.min(100, (value / total) * 100);
}

/*
 * ---------------------------------------------------------------------------
 * Formatting
 * ---------------------------------------------------------------------------
 */

export function formatCount(value: number | null): string {
  return value === null ? "—" : Math.round(value).toLocaleString();
}

/*
 * A short form for the headline tiles, where "1,482,930,114" is noise. Kept to
 * three significant characters plus a unit so the tiles never wrap.
 */
export function formatCompactCount(value: number | null): string {
  if (value === null) {
    return "—";
  }

  const abs: number = Math.abs(value);

  if (abs < 1000) {
    return String(Math.round(value));
  }

  const units: Array<string> = ["K", "M", "B", "T"];
  let scaled: number = value;
  let unitIndex: number = -1;

  while (Math.abs(scaled) >= 1000 && unitIndex < units.length - 1) {
    scaled = scaled / 1000;
    unitIndex++;
  }

  const decimals: number = Math.abs(scaled) >= 10 ? 0 : 1;
  return `${scaled.toFixed(decimals)}${units[unitIndex]}`;
}

/*
 * Human-readable size, base-1024, matching the rest of the Health dashboard.
 */
export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  if (value === 0) {
    return "0 B";
  }

  const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent: number = Math.min(
    Math.floor(Math.log(Math.abs(value)) / Math.log(1024)),
    units.length - 1,
  );
  const scaled: number = value / Math.pow(1024, exponent);
  const decimals: number = Math.abs(scaled) >= 10 || exponent === 0 ? 0 : 1;

  return `${scaled.toFixed(decimals)} ${units[exponent]}`;
}

/*
 * The smoothed hourly rate: the last 24 hours divided by 24. Shown beside the
 * live "last hour" figure so a spike can be told apart from a new normal.
 */
export function averagePerHour(lastDay: number | null): number | null {
  return lastDay === null ? null : Math.round(lastDay / 24);
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }

  if (value < 1) {
    return "<1%";
  }

  return `${Math.round(value)}%`;
}

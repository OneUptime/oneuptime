import OneUptimeDate from "../../../Types/Date";
import {
  AIChatWidget,
  AIChatWidgetColumn,
  AIChatWidgetSpan,
  AIChatWidgetStat,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";

/*
 * The formatting rules the AI chat widgets use on screen, factored out so the
 * markdown and PDF exports render the same numbers, dates and captions the user
 * actually saw. Every helper here mirrors a specific widget component; where a
 * component does something surprising (0 rendering as "0" rather than a dash,
 * a string "1234" not getting thousands separators while the number 1234 does)
 * the behavior is reproduced deliberately rather than tidied up, so an export
 * never disagrees with the chat it came from.
 *
 * These run in the browser, so toLocaleString() and moment resolve against the
 * same locale and timezone the chat rendered in.
 */

// Display caps applied by the widget components themselves.
export const MAX_TABLE_ROWS: number = 25; // DataTableWidget
export const MAX_ENTITY_ITEMS: number = 12; // EntityListWidget
export const MAX_SPANS: number = 40; // TraceWaterfallWidget

// EntityListWidget.toStr
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

// EntityListWidget.timeAgo
export function toTimeAgo(value: unknown): string {
  if (!value) {
    return "";
  }
  try {
    return OneUptimeDate.fromNow(OneUptimeDate.fromString(value as string));
  } catch {
    return "";
  }
}

// DataTableWidget.renderCell
export function formatTableCell(
  value: unknown,
  column: AIChatWidgetColumn,
): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (column.type === "date") {
    try {
      const date: Date = OneUptimeDate.fromString(value as string);
      return `${OneUptimeDate.getDateAsLocalFormattedString(
        date,
      )} · ${OneUptimeDate.fromNow(date)}`;
    } catch {
      return String(value);
    }
  }
  if (column.type === "number" && typeof value === "number") {
    return value.toLocaleString();
  }
  return String(value);
}

// StatCardsWidget: the number/string union is discriminated at runtime.
export function formatStatValue(stat: AIChatWidgetStat): string {
  const value: string =
    typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value;
  return stat.unit ? `${value} ${stat.unit}` : value;
}

// ChartWidget.formatValue
export function formatChartValue(
  value: number,
  unit?: string | undefined,
): string {
  const rounded: number =
    Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  const text: string = rounded.toLocaleString();
  return unit ? `${text} ${unit}` : text;
}

// ToolApprovalCard.argsPreview
export function formatToolArguments(args: JSONObject): string {
  const parts: Array<string> = [];
  for (const key of Object.keys(args)) {
    const value: unknown = args[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const valueString: string =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    parts.push(
      `${key}: ${
        valueString.length > 80
          ? `${valueString.substring(0, 80)}…`
          : valueString
      }`,
    );
  }
  return parts.join("  ·  ");
}

/*
 * TraceWaterfallWidget: depth is the length of the parent chain, guarded
 * against cycles and runaway nesting exactly as the component guards it.
 */
export function computeSpanDepth(
  span: AIChatWidgetSpan,
  parentBySpanId: Map<string, string | undefined>,
): number {
  let depth: number = 0;
  let current: string | undefined = span.parentSpanId;
  const seen: Set<string> = new Set();
  while (current && parentBySpanId.has(current) && !seen.has(current)) {
    seen.add(current);
    depth++;
    current = parentBySpanId.get(current);
    if (depth > 12) {
      break;
    }
  }
  return depth;
}

export function buildParentBySpanId(
  spans: Array<AIChatWidgetSpan>,
): Map<string, string | undefined> {
  const parentBySpanId: Map<string, string | undefined> = new Map();
  for (const span of spans) {
    parentBySpanId.set(span.spanId, span.parentSpanId);
  }
  return parentBySpanId;
}

export interface SpanBarMetrics {
  leftPercent: number;
  widthPercent: number;
}

// TraceWaterfallWidget bar geometry, including its clamps.
export function computeSpanBar(
  span: AIChatWidgetSpan,
  totalDurationMs: number,
): SpanBarMetrics {
  const leftPercent: number = Math.min(
    99,
    (span.startOffsetMs / totalDurationMs) * 100,
  );
  const widthPercent: number = Math.max(
    1.5,
    Math.min(100 - leftPercent, (span.durationMs / totalDurationMs) * 100),
  );
  return { leftPercent: leftPercent, widthPercent: widthPercent };
}

// TraceWaterfallWidget floors the denominator so the division is always safe.
export function totalTraceDuration(widget: AIChatWidget): number {
  return Math.max(widget.data.totalDurationMs || 0, 1);
}

/*
 * The fields EntityListWidget actually reads off an item, per list type. The
 * component ignores everything else on the item, so the export does too.
 */
export interface EntityListEntry {
  heading: string;
  body: string;
  badges: Array<string>;
  footer: string;
}

export function toEntityListEntry(
  item: JSONObject,
  widgetType: AIChatWidgetType,
): EntityListEntry {
  if (widgetType === AIChatWidgetType.ExceptionList) {
    const badges: Array<string> = [
      `${toDisplayString(item["occurrences"]) || "0"}×`,
    ];
    if (item["isResolved"]) {
      badges.push("Resolved");
    }
    return {
      heading: toDisplayString(item["type"]) || "Exception",
      body: toDisplayString(item["message"]),
      badges: badges,
      footer: `Last seen ${toTimeAgo(item["lastSeenAt"])}`,
    };
  }

  const numberField: string =
    widgetType === AIChatWidgetType.AlertList
      ? toDisplayString(item["alertNumber"])
      : toDisplayString(item["incidentNumber"]);

  const badges: Array<string> = [];
  if (item["state"]) {
    badges.push(toDisplayString(item["state"]));
  }
  if (item["severity"]) {
    badges.push(toDisplayString(item["severity"]));
  }

  return {
    heading: `${numberField ? `#${numberField} · ` : ""}${toDisplayString(
      item["title"],
    )}`,
    body: item["description"] ? toDisplayString(item["description"]) : "",
    badges: badges,
    footer: item["createdAt"] ? `Created ${toTimeAgo(item["createdAt"])}` : "",
  };
}

export function isEntityListWidget(type: AIChatWidgetType): boolean {
  return (
    type === AIChatWidgetType.IncidentList ||
    type === AIChatWidgetType.AlertList ||
    type === AIChatWidgetType.ExceptionList
  );
}

export function isChartWidget(type: AIChatWidgetType): boolean {
  return (
    type === AIChatWidgetType.TimeSeriesChart ||
    type === AIChatWidgetType.BarChart
  );
}

/*
 * A chart point resolved for export. `x` keeps the raw value so the exporter
 * can label a category axis, while `date` is set only when the value actually
 * parses as a time.
 */
export interface ExportChartPoint {
  x: string;
  date: Date | undefined;
  y: number;
}

export interface ExportChartSeries {
  name: string;
  points: Array<ExportChartPoint>;
}

/*
 * Resolves a chart widget's series for export.
 *
 * Note this deliberately keeps the RAW points rather than reproducing the
 * on-screen bucketing. The chart component re-buckets points into intervals to
 * fit Recharts, and that pass is lossy in ways that are fine for a glanceable
 * chart but not for a downloaded record: it matches points to buckets by
 * formatted-label string equality and silently drops the misses, so a weekly
 * chart keeps roughly one point in seven and a monthly one can skip a month
 * outright. An export is the artifact people keep and audit, so it plots what
 * the tools actually returned. For the common case — the server already emits
 * one point per bucket — the two agree exactly.
 */
export function toExportChartSeries(
  widget: AIChatWidget,
): Array<ExportChartSeries> {
  const series: Array<ExportChartSeries> = [];

  for (const raw of widget.data.series || []) {
    const points: Array<ExportChartPoint> = [];
    for (const point of raw.points || []) {
      if (point.y === null || point.y === undefined) {
        continue;
      }
      let date: Date | undefined = undefined;
      try {
        const parsed: Date = OneUptimeDate.fromString(point.x);
        if (!isNaN(parsed.getTime())) {
          date = parsed;
        }
      } catch {
        date = undefined;
      }
      points.push({ x: point.x, date: date, y: point.y });
    }
    series.push({ name: raw.name, points: points });
  }

  return series;
}

export function chartHasData(series: Array<ExportChartSeries>): boolean {
  return series.some((item: ExportChartSeries) => {
    return item.points.length > 0;
  });
}

/*
 * True when every plotted point carries a real timestamp, which is what lets
 * the exporter lay out a proportional time axis instead of even categories.
 */
export function chartIsTimeBased(series: Array<ExportChartSeries>): boolean {
  let seen: boolean = false;
  for (const item of series) {
    for (const point of item.points) {
      if (!point.date) {
        return false;
      }
      seen = true;
    }
  }
  return seen;
}

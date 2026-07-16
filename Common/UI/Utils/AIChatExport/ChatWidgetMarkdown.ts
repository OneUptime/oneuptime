import {
  AIChatCitation,
  AIChatToolAction,
  AIChatWidget,
  AIChatWidgetColumn,
  AIChatWidgetSpan,
  AIChatWidgetStat,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";
import {
  ExportChartPoint,
  ExportChartSeries,
  EntityListEntry,
  MAX_ENTITY_ITEMS,
  MAX_SPANS,
  MAX_TABLE_ROWS,
  buildParentBySpanId,
  chartHasData,
  computeSpanDepth,
  formatChartValue,
  formatStatValue,
  formatTableCell,
  formatToolArguments,
  isChartWidget,
  isEntityListWidget,
  toEntityListEntry,
  toExportChartSeries,
  totalTraceDuration,
} from "./ChatWidgetData";

/*
 * Renders the inline artifacts of an assistant message — widgets, tool actions
 * and citations — as plain markdown. A widget is a picture of data, and the
 * data is what survives the trip to a text file, so each one becomes the
 * clearest text shape for its type: charts and waterfalls become tables,
 * entity lists become lists, and stat cards become key/value rows.
 *
 * Values are formatted through ChatWidgetData so the text matches the chat.
 */

// A cell is escaped so a stray pipe or newline cannot break the table shape.
function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function markdownTable(
  headers: Array<string>,
  alignments: Array<"left" | "right">,
  rows: Array<Array<string>>,
): Array<string> {
  const divider: Array<string> = alignments.map((align: "left" | "right") => {
    return align === "right" ? "---:" : "---";
  });

  return [
    `| ${headers.map(escapeTableCell).join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...rows.map((row: Array<string>) => {
      return `| ${row.map(escapeTableCell).join(" | ")} |`;
    }),
  ];
}

function chartToMarkdown(widget: AIChatWidget): Array<string> {
  const series: Array<ExportChartSeries> = toExportChartSeries(widget);

  if (!chartHasData(series)) {
    return ["_No data points in this range._"];
  }

  const kind: string =
    widget.type === AIChatWidgetType.BarChart ? "Bar chart" : "Line chart";
  const lines: Array<string> = [`_${kind}_`, ""];

  /*
   * One table per series rather than a single wide table keyed by x: series
   * rarely share x values exactly, and a joined table would be mostly holes.
   */
  for (const item of series) {
    if (series.length > 1) {
      lines.push(`**${item.name}**`, "");
    }

    if (item.points.length === 0) {
      lines.push("_No data points._", "");
      continue;
    }

    lines.push(
      ...markdownTable(
        [
          widget.data.xIsTime === false ? "Category" : "Time",
          item.name || "Value",
        ],
        ["left", "right"],
        item.points.map((point: ExportChartPoint) => {
          return [
            point.date ? point.date.toLocaleString() : point.x,
            formatChartValue(point.y, widget.data.unit),
          ];
        }),
      ),
      "",
    );
  }

  return lines;
}

function tableToMarkdown(widget: AIChatWidget): Array<string> {
  const columns: Array<AIChatWidgetColumn> = widget.data.columns || [];
  const allRows: Array<JSONObject> = widget.data.rows || [];
  const rows: Array<JSONObject> = allRows.slice(0, MAX_TABLE_ROWS);

  if (columns.length === 0 || rows.length === 0) {
    return ["_No rows._"];
  }

  const lines: Array<string> = markdownTable(
    columns.map((column: AIChatWidgetColumn) => {
      return column.title;
    }),
    columns.map((column: AIChatWidgetColumn) => {
      return column.type === "number" ? "right" : "left";
    }),
    rows.map((row: JSONObject) => {
      return columns.map((column: AIChatWidgetColumn) => {
        return formatTableCell(row[column.key], column);
      });
    }),
  );

  if (allRows.length > rows.length) {
    lines.push("", `_Showing ${rows.length} of ${allRows.length} rows._`);
  }

  return lines;
}

function waterfallToMarkdown(widget: AIChatWidget): Array<string> {
  const spans: Array<AIChatWidgetSpan> = widget.data.spans || [];
  const shown: Array<AIChatWidgetSpan> = spans.slice(0, MAX_SPANS);

  if (shown.length === 0) {
    return ["_No spans._"];
  }

  const parentBySpanId: Map<string, string | undefined> =
    buildParentBySpanId(spans);
  const totalDurationMs: number = totalTraceDuration(widget);

  const lines: Array<string> = markdownTable(
    ["Span", "Start", "Duration"],
    ["left", "right", "right"],
    shown.map((span: AIChatWidgetSpan) => {
      const depth: number = computeSpanDepth(span, parentBySpanId);
      // Nesting is the point of a waterfall, so keep it as leading indent.
      const indent: string = "  ".repeat(Math.min(depth, 8));
      return [
        `${indent}${span.isError ? "● " : ""}${span.name}`,
        `${span.startOffsetMs.toLocaleString()} ms`,
        `${span.durationMs.toLocaleString()} ms`,
      ];
    }),
  );

  lines.push(
    "",
    `_Total trace duration: ${totalDurationMs.toLocaleString()} ms._`,
  );

  if (spans.length > shown.length) {
    lines.push(`_Showing ${shown.length} of ${spans.length} spans._`);
  }

  return lines;
}

function entityListToMarkdown(widget: AIChatWidget): Array<string> {
  const items: Array<JSONObject> = widget.data.items || [];
  const shown: Array<JSONObject> = items.slice(0, MAX_ENTITY_ITEMS);

  if (shown.length === 0) {
    return ["_Nothing here._"];
  }

  const lines: Array<string> = [];

  for (const item of shown) {
    const entry: EntityListEntry = toEntityListEntry(item, widget.type);
    const badges: string = entry.badges.length
      ? ` — ${entry.badges.join(" · ")}`
      : "";
    lines.push(`- **${entry.heading}**${badges}`);
    if (entry.body) {
      lines.push(`  - ${entry.body}`);
    }
    if (entry.footer) {
      lines.push(`  - _${entry.footer}_`);
    }
  }

  if (items.length > shown.length) {
    lines.push("", `_Showing ${shown.length} of ${items.length}._`);
  }

  return lines;
}

function statCardsToMarkdown(widget: AIChatWidget): Array<string> {
  const stats: Array<AIChatWidgetStat> = widget.data.stats || [];

  if (stats.length === 0) {
    return [];
  }

  return markdownTable(
    ["Metric", "Value"],
    ["left", "right"],
    stats.map((stat: AIChatWidgetStat) => {
      return [stat.label, formatStatValue(stat)];
    }),
  );
}

function resourceCardToMarkdown(widget: AIChatWidget): Array<string> {
  const lines: Array<string> = [];

  if (widget.data.resourceType) {
    lines.push(`_${widget.data.resourceType.toUpperCase()}_`, "");
  }
  if (widget.data.heading) {
    lines.push(`**${widget.data.heading}**`);
  }
  if (widget.data.subheading) {
    lines.push(widget.data.subheading);
  }

  const fields: Array<{ label: string; value: string }> =
    widget.data.fields || [];

  if (fields.length > 0) {
    lines.push("");
    for (const field of fields) {
      lines.push(`- **${field.label}:** ${field.value}`);
    }
  }

  return lines;
}

function widgetBodyToMarkdown(widget: AIChatWidget): Array<string> {
  if (isChartWidget(widget.type)) {
    return chartToMarkdown(widget);
  }
  if (isEntityListWidget(widget.type)) {
    return entityListToMarkdown(widget);
  }
  switch (widget.type) {
    case AIChatWidgetType.Table:
      return tableToMarkdown(widget);
    case AIChatWidgetType.TraceWaterfall:
      return waterfallToMarkdown(widget);
    case AIChatWidgetType.StatCards:
      return statCardsToMarkdown(widget);
    case AIChatWidgetType.ResourceCard:
      return resourceCardToMarkdown(widget);
    default:
      return [];
  }
}

export function widgetToMarkdown(widget: AIChatWidget): string {
  const lines: Array<string> = [`#### ${widget.title}`, ""];

  if (widget.description) {
    lines.push(`_${widget.description}_`, "");
  }

  lines.push(...widgetBodyToMarkdown(widget));

  return lines.join("\n").trim();
}

export function widgetsToMarkdown(widgets: Array<AIChatWidget>): string {
  return widgets
    .map((widget: AIChatWidget) => {
      return widgetToMarkdown(widget);
    })
    .join("\n\n");
}

export function toolActionsToMarkdown(
  toolActions: Array<AIChatToolAction>,
): string {
  if (toolActions.length === 0) {
    return "";
  }

  const lines: Array<string> = ["#### Actions", ""];

  for (const action of toolActions) {
    lines.push(`- **${action.status}** — ${action.title}`);
    if (action.description) {
      lines.push(`  - ${action.description}`);
    }
    const args: string = formatToolArguments(action.arguments || {});
    if (args) {
      lines.push(`  - \`${args.replace(/`/g, "'")}\``);
    }
    if (action.resultSummary) {
      lines.push(`  - _${action.resultSummary}_`);
    }
  }

  return lines.join("\n");
}

/*
 * Citations carry the query that produced an answer, which is the whole point
 * of exporting them: a reader can see what was actually asked of the data. A
 * rowCount of 0 is meaningful evidence ("checked, found nothing"), so it is
 * spelled out rather than shown as a bare zero.
 */
export function citationsToMarkdown(citations: Array<AIChatCitation>): string {
  if (citations.length === 0) {
    return "";
  }

  const lines: Array<string> = ["#### Sources", ""];

  for (const citation of citations) {
    const rows: string =
      citation.rowCount === 0
        ? "checked, found nothing"
        : `${citation.rowCount} ${citation.rowCount === 1 ? "row" : "rows"}`;
    lines.push(`- **${citation.id}** ${citation.label} — ${rows}`);
    lines.push(`  - Tool: \`${citation.toolName}\``);
    lines.push(
      `  - Query: \`${JSON.stringify(citation.queryArguments || {}).replace(
        /`/g,
        "'",
      )}\``,
    );
  }

  return lines.join("\n");
}

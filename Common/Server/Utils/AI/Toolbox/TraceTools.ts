import Span from "../../../../Models/AnalyticsModels/Span";
import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../Types/AnalyticsDatabase/ModelPermission";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  AIChatCitationTargetType,
  AIChatWidgetSpan,
} from "../../../../Types/AI/AIChatTypes";
import SpanService from "../../../Services/SpanService";
import TraceAggregationService, {
  TraceAnalyticsTableRow,
} from "../../../Services/TraceAggregationService";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

const TRACE_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadTelemetryServiceTraces,
];

const VALID_METRICS: Array<string> = [
  "count",
  "errorCount",
  "avgDuration",
  "minDuration",
  "maxDuration",
  "p50Duration",
  "p90Duration",
  "p95Duration",
  "p99Duration",
];

const VALID_GROUP_BY: Array<string> = [
  "name",
  "primaryEntityId",
  "kind",
  "statusCode",
  "isRootSpan",
];

/*
 * Upper bound on spans fetched for a single trace waterfall. High enough for
 * almost every real trace; when a trace exceeds it we say so explicitly rather
 * than silently dropping spans (which also orphans their children into fake
 * roots).
 */
const MAX_TRACE_SPANS: number = 500;

export const QueryTracesTool: ObservabilityTool = {
  name: "query_traces",
  description:
    "Analyze spans/traces: latency profile (count, errorCount, avg and p50/p90/p95/p99 durations in ms) grouped by one dimension such as span name or service. Use this to answer 'why is X slow', 'error rate by operation' or 'slowest endpoints'. Then drill into a single trace with get_trace.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      groupBy: {
        type: "string",
        enum: ["name", "primaryEntityId", "kind", "statusCode", "isRootSpan"],
        description:
          "Dimension to group by (default name = span/operation name; primaryEntityId = service).",
      },
      metric: {
        type: "string",
        enum: [
          "count",
          "errorCount",
          "avgDuration",
          "minDuration",
          "maxDuration",
          "p50Duration",
          "p90Duration",
          "p95Duration",
          "p99Duration",
        ],
        description:
          "Metric used to rank the groups (default p95Duration). The full latency profile is always returned per group.",
      },
      nameSearchText: {
        type: "string",
        description: "Only spans whose name contains this text.",
      },
      serviceId: {
        type: "string",
        description: "Only spans from this telemetry service.",
      },
      hasException: {
        type: "boolean",
        description: "Only spans that recorded an exception.",
      },
      rootOnly: {
        type: "boolean",
        description: "Only root spans (whole-request latency).",
      },
      limit: {
        type: "number",
        description: "Maximum groups to return (default 10, max 25).",
      },
    },
  },
  requiredPermissions: TRACE_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 24,
      maxDays: 30,
    });

    const metric: string = ToolArgs.getString(args, "metric") || "p95Duration";
    if (!VALID_METRICS.includes(metric)) {
      throw new BadDataException(`Invalid metric: ${metric}`);
    }

    const groupBy: string = ToolArgs.getString(args, "groupBy") || "name";
    if (!VALID_GROUP_BY.includes(groupBy)) {
      throw new BadDataException(`Invalid groupBy: ${groupBy}`);
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });

    const serviceId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "serviceId",
    );

    const windowMinutes: number =
      (endTime.getTime() - startTime.getTime()) / (60 * 1000);

    /*
     * getAnalyticsTable builds raw aggregation SQL and skips the model layer's
     * owned-scope filter, so a label-restricted user would otherwise see
     * project-wide trace analytics. Constrain to the services this user may
     * read (spans are owned through Service, same as logs).
     */
    const accessibleServiceIds: Array<ObjectID> | null =
      await ModelPermission.getAccessibleServiceIdsForAnalyticsModel(
        Span,
        ctx.props,
        DatabaseRequestType.Read,
      );

    const tableRows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable({
        projectId: ctx.projectId,
        startTime: startTime,
        endTime: endTime,
        bucketSizeInMinutes: Math.max(1, Math.round(windowMinutes / 60)),
        chartType: "table",
        metric: metric as never,
        groupBy: [groupBy],
        limit: limit,
        nameSearchText: ToolArgs.getString(args, "nameSearchText"),
        serviceIds: ToolArgs.scopeServiceIds(accessibleServiceIds, serviceId),
        hasException: ToolArgs.getBoolean(args, "hasException"),
        rootOnly: ToolArgs.getBoolean(args, "rootOnly"),
      });

    const rows: Array<JSONObject> = tableRows.map(
      (row: TraceAnalyticsTableRow) => {
        return {
          [groupBy]: Object.values(row.groupValues).join(" / "),
          count: row.count,
          errorCount: row.errorCount,
          avgMs: Math.round(row.avgDurationMs * 100) / 100,
          p50Ms: Math.round(row.p50DurationMs * 100) / 100,
          p90Ms: Math.round(row.p90DurationMs * 100) / 100,
          p95Ms: Math.round(row.p95DurationMs * 100) / 100,
          p99Ms: Math.round(row.p99DurationMs * 100) / 100,
        };
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Trace analytics by ${groupBy} (${metric}), ${startTime.toISOString()} – ${endTime.toISOString()}`,
      citationTarget: {
        type: AIChatCitationTargetType.Traces,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Trace analytics by ${groupBy}`,
              description: `Ranked by ${metric} · ${startTime.toISOString()} – ${endTime.toISOString()}`,
              columns: [
                { key: groupBy, title: groupBy, type: "text" },
                { key: "count", title: "Count", type: "number" },
                { key: "errorCount", title: "Errors", type: "number" },
                { key: "avgMs", title: "Avg (ms)", type: "number" },
                { key: "p90Ms", title: "p90 (ms)", type: "number" },
                { key: "p95Ms", title: "p95 (ms)", type: "number" },
                { key: "p99Ms", title: "p99 (ms)", type: "number" },
              ],
              rows: rows,
              link: { type: AIChatCitationTargetType.Traces },
            })
          : undefined,
    };
  },
};

interface SpanTreeNode {
  span: Span;
  children: Array<SpanTreeNode>;
}

export const GetTraceTool: ObservabilityTool = {
  name: "get_trace",
  description:
    "Get the span tree (waterfall) of one trace by traceId: every span with its duration, status and whether it recorded an exception. Use after query_traces or search_logs surfaces an interesting traceId.",
  inputSchema: {
    type: "object",
    properties: {
      traceId: {
        type: "string",
        description: "The trace ID (required).",
      },
    },
    required: ["traceId"],
  },
  requiredPermissions: TRACE_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const traceId: string | undefined = ToolArgs.getString(args, "traceId");

    if (!traceId) {
      throw new BadDataException("traceId is required.");
    }

    const spans: Array<Span> = await SpanService.findBy({
      query: {
        traceId: traceId,
      } as never,
      select: {
        spanId: true,
        parentSpanId: true,
        name: true,
        startTimeUnixNano: true,
        durationUnixNano: true,
        statusCode: true,
        kind: true,
      } as never,
      sort: {
        startTimeUnixNano: SortOrder.Ascending,
      } as never,
      limit: MAX_TRACE_SPANS,
      skip: 0,
      props: ctx.props,
    });

    const isSpanLimitHit: boolean = spans.length >= MAX_TRACE_SPANS;

    // Build the tree.
    const nodesBySpanId: Map<string, SpanTreeNode> = new Map();
    const roots: Array<SpanTreeNode> = [];

    for (const span of spans) {
      nodesBySpanId.set(span.spanId?.toString() || "", {
        span,
        children: [],
      });
    }

    for (const node of nodesBySpanId.values()) {
      const parentId: string = node.span.parentSpanId?.toString() || "";
      const parent: SpanTreeNode | undefined = nodesBySpanId.get(parentId);
      if (parent && parent !== node) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const lines: Array<string> = [];

    const renderNode: (node: SpanTreeNode, depth: number) => void = (
      node: SpanTreeNode,
      depth: number,
    ): void => {
      const durationMs: number =
        Math.round((Number(node.span.durationUnixNano) / 1_000_000) * 100) /
        100;
      const status: string =
        Number(node.span.statusCode) === 2 ? " [ERROR]" : "";
      lines.push(
        `${"  ".repeat(depth)}- ${node.span.name} (${durationMs}ms)${status}`,
      );
      for (const child of node.children) {
        renderNode(child, depth + 1);
      }
    };

    for (const root of roots) {
      renderNode(root, 0);
    }

    if (isSpanLimitHit) {
      lines.push(
        `… trace truncated at ${MAX_TRACE_SPANS} spans; deeper spans are omitted and some shown here may appear as roots because their parent was cut off.`,
      );
    }

    const serialized: SerializedResult = ToolResultSerializer.serializeText(
      lines.join("\n"),
      spans.length,
    );

    /*
     * Build the waterfall widget: each span's start is expressed as an offset in
     * ms from the earliest span start (the trace start), so the renderer can lay
     * out proportional bars without any wall-clock math.
     */
    let traceStartNano: number | undefined = undefined;
    let traceEndNano: number = 0;
    for (const span of spans) {
      const start: number = Number(span.startTimeUnixNano);
      const end: number = start + Number(span.durationUnixNano);
      if (traceStartNano === undefined || start < traceStartNano) {
        traceStartNano = start;
      }
      if (end > traceEndNano) {
        traceEndNano = end;
      }
    }

    const nanoToMs: (nano: number) => number = (nano: number): number => {
      return Math.round((nano / 1_000_000) * 100) / 100;
    };

    const widgetSpans: Array<AIChatWidgetSpan> = spans.map((span: Span) => {
      const start: number = Number(span.startTimeUnixNano);
      return {
        spanId: span.spanId?.toString() || "",
        parentSpanId: span.parentSpanId?.toString() || undefined,
        name: span.name || "(unnamed span)",
        startOffsetMs: nanoToMs(start - (traceStartNano ?? start)),
        durationMs: nanoToMs(Number(span.durationUnixNano)),
        isError: Number(span.statusCode) === 2,
      };
    });

    const totalDurationMs: number =
      traceStartNano !== undefined
        ? nanoToMs(traceEndNano - traceStartNano)
        : 0;

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Trace ${traceId} (${spans.length}${isSpanLimitHit ? "+" : ""} spans)`,
      citationTarget: {
        type: AIChatCitationTargetType.TraceView,
        params: { traceId: traceId },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated || isSpanLimitHit,
      widget:
        widgetSpans.length > 0
          ? WidgetBuilder.traceWaterfall({
              title: `Trace waterfall (${spans.length}${isSpanLimitHit ? "+" : ""} spans)`,
              description: `${totalDurationMs} ms total`,
              spans: widgetSpans,
              totalDurationMs: totalDurationMs,
              link: {
                type: AIChatCitationTargetType.TraceView,
                params: { traceId: traceId },
              },
            })
          : undefined,
    };
  },
};

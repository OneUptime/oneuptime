import Log from "../../../../Models/AnalyticsModels/Log";
import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../Types/AnalyticsDatabase/ModelPermission";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import LogService from "../../../Services/LogService";
import LogAggregationService, {
  HistogramBucket,
} from "../../../Services/LogAggregationService";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  AIChatWidgetSeries,
  AIChatCitationTarget,
} from "../../../../Types/AI/AIChatTypes";
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

// Keep pivoted histogram rows under the serializer's 50-row cap.
const MAX_HISTOGRAM_BUCKETS: number = 48;

const LOG_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadTelemetryServiceLog,
];

export const SearchLogsTool: ObservabilityTool = {
  name: "search_logs",
  description:
    "Search raw log lines. Filter by time range, severity, body text, trace ID or service. Returns the most recent matching lines. Always pass an explicit time range when investigating a specific window.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      severityTexts: {
        type: "array",
        items: { type: "string" },
        description: 'Filter by severity, e.g. ["Error", "Fatal"] or ["Warn"].',
      },
      bodySearchText: {
        type: "string",
        description: "Only logs whose body contains this text.",
      },
      traceId: {
        type: "string",
        description: "Only logs belonging to this trace.",
      },
      serviceId: {
        type: "string",
        description:
          "Only logs from this telemetry service (resolve names via lookup_context first).",
      },
      limit: {
        type: "number",
        description: "Maximum log lines to return (default 25, max 50).",
      },
    },
  },
  requiredPermissions: LOG_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 1,
      maxDays: 30,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 25,
      min: 1,
      max: 50,
    });

    const query: JSONObject = {
      time: new InBetween(startTime, endTime),
    };

    const severityTexts: Array<string> | undefined = ToolArgs.getStringArray(
      args,
      "severityTexts",
    );
    if (severityTexts) {
      query["severityText"] = new Includes(severityTexts);
    }

    const bodySearchText: string | undefined = ToolArgs.getString(
      args,
      "bodySearchText",
    );
    if (bodySearchText) {
      query["body"] = new Search(bodySearchText);
    }

    const traceId: string | undefined = ToolArgs.getString(args, "traceId");
    if (traceId) {
      query["traceId"] = traceId;
    }

    const serviceId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "serviceId",
    );
    if (serviceId) {
      query["primaryEntityId"] = serviceId;
    }

    const logs: Array<Log> = await LogService.findBy({
      query: query as never,
      select: {
        time: true,
        severityText: true,
        body: true,
        traceId: true,
        spanId: true,
        primaryEntityId: true,
      } as never,
      sort: {
        time: SortOrder.Descending,
      } as never,
      limit: limit,
      skip: 0,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = logs.map((log: Log) => {
      return {
        time: log.time,
        severity: log.severityText,
        body: log.body,
        traceId: log.traceId,
        spanId: log.spanId,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const logsLink: AIChatCitationTarget = {
      type: AIChatCitationTargetType.Logs,
    };

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Logs ${startTime.toISOString()} – ${endTime.toISOString()} (${serialized.rowCount} shown)`,
      citationTarget: logsLink,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Logs (${rows.length})`,
              description: `${startTime.toISOString()} – ${endTime.toISOString()}`,
              columns: [
                { key: "time", title: "Time", type: "date" },
                { key: "severity", title: "Severity", type: "text" },
                { key: "body", title: "Message", type: "text" },
                { key: "traceId", title: "Trace", type: "text" },
              ],
              rows: rows,
              link: logsLink,
            })
          : undefined,
    };
  },
};

export const LogHistogramTool: ObservabilityTool = {
  name: "log_histogram",
  description:
    "Get log volume over time, split by severity. Use this to spot error spikes and quiet periods before drilling into raw logs.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      severityTexts: {
        type: "array",
        items: { type: "string" },
        description: "Filter to these severities before bucketing.",
      },
      bodySearchText: {
        type: "string",
        description: "Only count logs whose body contains this text.",
      },
      serviceId: {
        type: "string",
        description: "Only logs from this telemetry service.",
      },
    },
  },
  requiredPermissions: LOG_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 24,
      maxDays: 30,
    });

    const windowMinutes: number =
      (endTime.getTime() - startTime.getTime()) / (60 * 1000);
    /*
     * Bound the number of time buckets. getHistogram returns one row per
     * (bucket, severity); after we pivot to one row per bucket that is at most
     * MAX_HISTOGRAM_BUCKETS rows, which stays under the serializer's row cap so
     * the most recent buckets are never dropped (spike detection reads the tail
     * of the window).
     */
    const bucketSizeInMinutes: number = Math.max(
      1,
      Math.ceil(windowMinutes / MAX_HISTOGRAM_BUCKETS),
    );

    const serviceId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "serviceId",
    );

    /*
     * getHistogram builds raw aggregation SQL and skips the model layer's
     * owned-scope filter, so a label-restricted user would otherwise see
     * project-wide volume. Constrain to the services this user may read.
     */
    const accessibleServiceIds: Array<ObjectID> | null =
      await ModelPermission.getAccessibleServiceIdsForAnalyticsModel(
        Log,
        ctx.props,
        DatabaseRequestType.Read,
      );

    const buckets: Array<HistogramBucket> =
      await LogAggregationService.getHistogram({
        projectId: ctx.projectId,
        startTime: startTime,
        endTime: endTime,
        bucketSizeInMinutes: bucketSizeInMinutes,
        severityTexts: ToolArgs.getStringArray(args, "severityTexts"),
        bodySearchText: ToolArgs.getString(args, "bodySearchText"),
        serviceIds: ToolArgs.scopeServiceIds(accessibleServiceIds, serviceId),
      });

    /*
     * Pivot (time, severity, count) rows into one row per time bucket with a
     * column per severity, e.g. "time=… | Error=12 | Warn=3". This is both more
     * compact for the model and collapses the row count from
     * buckets×severities down to just buckets.
     */
    const rowsByTime: Map<string, JSONObject> = new Map();
    for (const bucket of buckets) {
      let row: JSONObject | undefined = rowsByTime.get(bucket.time);
      if (!row) {
        row = { time: bucket.time };
        rowsByTime.set(bucket.time, row);
      }
      row[bucket.severity || "Unspecified"] = bucket.count;
    }

    const rows: Array<JSONObject> = Array.from(rowsByTime.values()).sort(
      (a: JSONObject, b: JSONObject) => {
        return String(a["time"]).localeCompare(String(b["time"]));
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    /*
     * Pivot the per-bucket rows into one series per severity so the widget can
     * render a stacked bar chart (Error on top of Warn on top of Info, etc).
     */
    const severityKeys: Array<string> = Array.from(
      new Set(
        rows.flatMap((row: JSONObject) => {
          return Object.keys(row).filter((key: string) => {
            return key !== "time";
          });
        }),
      ),
    );

    const series: Array<AIChatWidgetSeries> = severityKeys.map(
      (severity: string) => {
        return {
          name: severity,
          points: rows.map((row: JSONObject) => {
            return {
              x: String(row["time"]),
              y:
                typeof row[severity] === "number"
                  ? (row[severity] as number)
                  : 0,
            };
          }),
        };
      },
    );

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Log volume by severity, ${startTime.toISOString()} – ${endTime.toISOString()}`,
      citationTarget: {
        type: AIChatCitationTargetType.Logs,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        series.length > 0 && rows.length > 0
          ? WidgetBuilder.bars({
              title: "Log volume by severity",
              description: `${startTime.toISOString()} – ${endTime.toISOString()}`,
              series: series,
              stacked: true,
              xIsTime: true,
              unit: "logs",
              link: { type: AIChatCitationTargetType.Logs },
            })
          : undefined,
    };
  },
};

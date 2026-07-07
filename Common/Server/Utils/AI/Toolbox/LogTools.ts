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
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

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

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Logs ${startTime.toISOString()} – ${endTime.toISOString()} (${serialized.rowCount} shown)`,
      citationTarget: {
        type: AIChatCitationTargetType.Logs,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
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
    const bucketSizeInMinutes: number = Math.max(
      1,
      Math.round(windowMinutes / 60),
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

    const rows: Array<JSONObject> = buckets.map((bucket: HistogramBucket) => {
      return bucket as unknown as JSONObject;
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Log volume by severity, ${startTime.toISOString()} – ${endTime.toISOString()}`,
      citationTarget: {
        type: AIChatCitationTargetType.Logs,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};

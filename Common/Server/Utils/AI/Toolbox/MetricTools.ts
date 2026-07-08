import Metric from "../../../../Models/AnalyticsModels/Metric";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  AIChatCitationTargetType,
  AIChatWidgetPoint,
} from "../../../../Types/AI/AIChatTypes";
import AggregateBy from "../../../Types/AnalyticsDatabase/AggregateBy";
import MetricService from "../../../Services/MetricService";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import OneUptimeDate from "../../../../Types/Date";
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Note: metric read access is gated on ReadTelemetryServiceTraces — this
 * mirrors the guard on the dashboard's /telemetry/metrics/* routes.
 */
const METRIC_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadTelemetryServiceTraces,
];

export const QueryMetricsTool: ObservabilityTool = {
  name: "query_metrics",
  description:
    "Aggregate a metric over time: Avg, Max, Min, Sum, Count or P50/P90/P95/P99 percentiles (histogram-aware). Requires the exact metric name — discover names via lookup_context. Monitor metrics use reserved names like oneuptime.monitor.response.time with the monitor's ID as entityId.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      metricName: {
        type: "string",
        description: "Exact metric name (required).",
      },
      aggregationType: {
        type: "string",
        enum: ["Avg", "Max", "Min", "Sum", "Count", "P50", "P90", "P95", "P99"],
        description: "How to aggregate (default Avg).",
      },
      entityId: {
        type: "string",
        description:
          "Only data points from this service/host/monitor (its OneUptime ID).",
      },
    },
    required: ["metricName"],
  },
  requiredPermissions: METRIC_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const metricName: string | undefined = ToolArgs.getString(
      args,
      "metricName",
    );

    if (!metricName) {
      throw new BadDataException(
        "metricName is required. Use lookup_context with type 'metricNames' to discover metric names.",
      );
    }

    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 24,
      maxDays: 30,
    });

    const aggregationTypeString: string =
      ToolArgs.getString(args, "aggregationType") || "Avg";

    if (
      !Object.values(AggregationType).includes(
        aggregationTypeString as AggregationType,
      )
    ) {
      throw new BadDataException(
        `Invalid aggregationType: ${aggregationTypeString}`,
      );
    }

    /*
     * The time filter must be part of the query's WHERE clause. aggregateBy's
     * startTimestamp/endTimestamp only define the bucket grid — without an
     * explicit `time` filter the percentile/aggregate scans the metric's whole
     * retention and mixes in data outside the requested window.
     */
    const query: JSONObject = {
      name: metricName,
      time: new InBetween(startTime, endTime),
    };

    const entityId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "entityId",
    );
    if (entityId) {
      query["primaryEntityId"] = entityId;
    }

    const aggregateBy: AggregateBy<Metric> = {
      aggregateColumnName: "value",
      aggregationType: aggregationTypeString as AggregationType,
      aggregationTimestampColumnName: "time",
      startTimestamp: startTime,
      endTimestamp: endTime,
      query: query as never,
      limit: 200,
      skip: 0,
      props: ctx.props,
    };

    const result: AggregatedResult =
      await MetricService.aggregateBy(aggregateBy);

    const rows: Array<JSONObject> = result.data.map((item: AggregatedModel) => {
      return {
        timestamp: item.timestamp,
        value: item.value,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const points: Array<AIChatWidgetPoint> = result.data.map(
      (item: AggregatedModel) => {
        return {
          x: OneUptimeDate.toString(OneUptimeDate.fromString(item.timestamp)),
          y: typeof item.value === "number" ? item.value : null,
        };
      },
    );

    const seriesName: string = entityId
      ? `${aggregationTypeString}(${metricName}) · ${entityId.toString()}`
      : `${aggregationTypeString}(${metricName})`;

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `${aggregationTypeString}(${metricName}), ${startTime.toISOString()} – ${endTime.toISOString()}`,
      citationTarget: {
        type: AIChatCitationTargetType.Metrics,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        points.length > 0
          ? WidgetBuilder.timeSeries({
              title: `${aggregationTypeString} of ${metricName}`,
              description: `${startTime.toISOString()} – ${endTime.toISOString()}`,
              series: [{ name: seriesName, points: points }],
              valueLabel: aggregationTypeString,
              link: { type: AIChatCitationTargetType.Metrics },
            })
          : undefined,
    };
  },
};

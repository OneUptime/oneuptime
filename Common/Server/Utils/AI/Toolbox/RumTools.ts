import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../../Types/AI/AIChatTypes";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Query from "../../../../Types/BaseDatabase/Query";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  WebVitalDefinition,
  WebVitalDefinitions,
} from "../../../../Types/Rum/WebVitals";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import MetricService from "../../../Services/MetricService";
import RumApplicationService from "../../../Services/RumApplicationService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import WidgetBuilder from "./WidgetBuilder";

function getApplicationId(args: JSONObject): ObjectID | undefined {
  if (args["rumApplicationId"] === undefined) {
    return undefined;
  }
  const value: string | undefined = ToolArgs.getString(
    args,
    "rumApplicationId",
  );
  if (!value || !ObjectID.isValidUUID(value)) {
    throw new BadDataException("rumApplicationId must be a valid UUID.");
  }
  return new ObjectID(value);
}

function applicationTarget(id?: ObjectID): AIChatCitationTarget {
  return id
    ? {
        type: AIChatCitationTargetType.RumApplicationView,
        params: { rumApplicationId: id.toString() },
      }
    : { type: AIChatCitationTargetType.RumApplications };
}

export const QueryRumApplicationsTool: ObservabilityTool = {
  name: "query_rum_applications",
  description:
    "Discover Real User Monitoring (RUM) applications in this project, including their IDs, browser/mobile client type and connection status. Resolve application names here before querying their web vitals, metrics, traces or logs. Pass rumApplicationId for one application. Does not access session recordings or end-user identities.",
  inputSchema: {
    type: "object",
    properties: {
      rumApplicationId: {
        type: "string",
        description: "One RUM application's OneUptime UUID.",
      },
      nameSearch: {
        type: "string",
        description: "Only applications whose name contains this text.",
      },
      limit: {
        type: "number",
        description: "Maximum applications to return (default 25, max 50).",
      },
      skip: {
        type: "number",
        description: "Rows to skip for pagination (default 0, max 500).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return new RumApplication().getReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const applicationId: ObjectID | undefined = getApplicationId(args);
    const nameSearch: string | undefined = ToolArgs.getString(
      args,
      "nameSearch",
    );
    const limit: number = applicationId
      ? 1
      : ToolArgs.getNumber(args, "limit", {
          defaultValue: 25,
          min: 1,
          max: 50,
        });
    const query: Query<RumApplication> = { projectId: ctx.projectId };
    if (applicationId) {
      query._id = applicationId.toString();
    }
    if (nameSearch) {
      query.name = QueryHelper.search(nameSearch);
    }

    const applications: Array<RumApplication> =
      await RumApplicationService.findBy({
        query: query,
        select: {
          _id: true,
          name: true,
          clientType: true,
          sdkLanguage: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: limit,
        skip: applicationId
          ? 0
          : ToolArgs.getNumber(args, "skip", {
              defaultValue: 0,
              min: 0,
              max: 500,
            }),
        props: ctx.props,
      });
    const rows: Array<JSONObject> = applications.map(
      (application: RumApplication) => {
        return {
          id: application.id?.toString(),
          name: application.name,
          clientType: application.clientType,
          sdkLanguage: application.sdkLanguage,
          connectionStatus: application.otelCollectorStatus,
          lastSeenAt: application.lastSeenAt,
        };
      },
    );
    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);
    const reachedLimit: boolean = !applicationId && rows.length === limit;
    const target: AIChatCitationTarget = applicationTarget(applicationId);
    return {
      dataForLlm:
        serialized.text +
        (reachedLimit
          ? "\nThe result may contain more applications; increase skip to read the next page."
          : ""),
      rowCount: serialized.rowCount,
      citationLabel: `RUM applications (${rows.length} found)`,
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated || reachedLimit,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: "RUM applications",
              columns: [
                { key: "name", title: "Application", type: "text" },
                { key: "clientType", title: "Client", type: "text" },
                { key: "connectionStatus", title: "Connection", type: "text" },
              ],
              rows: rows,
              link: target,
            })
          : undefined,
    };
  },
};

function valuesByName(result: AggregatedResult): Map<string, number> {
  const values: Map<string, number> = new Map();
  for (const row of result.data) {
    if (
      typeof row["name"] === "string" &&
      typeof row.value === "number" &&
      Number.isFinite(row.value) &&
      row.value >= 0
    ) {
      values.set(row["name"], row.value);
    }
  }
  return values;
}

function rating(value: number, definition: WebVitalDefinition): string {
  if (value < definition.thresholds.warn) {
    return "Good";
  }
  return value < definition.thresholds.danger ? "Needs improvement" : "Poor";
}

export const QueryRumWebVitalsTool: ObservabilityTool = {
  name: "query_rum_web_vitals",
  description:
    "Summarize a RUM application's LCP, INP, CLS, FCP and TTFB, with range averages, dashboard ratings and the change from the preceding equal-duration window. Recognizes the same metric aliases as the RUM overview, without combining aliases. Missing vitals are reported explicitly. Ratings describe averages, not Google's p75 field assessment; a period-over-period change is not a learned-baseline anomaly. Use the returned metricName with query_metrics (entityId = rumApplicationId) to chart a trend or baseline_anomaly for learned-baseline detection.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      startTime: {
        type: "string",
        description:
          "ISO 8601 range start; defaults to 24 hours before endTime. Maximum window is 30 days.",
      },
      rumApplicationId: {
        type: "string",
        description:
          "Required RUM application UUID from query_rum_applications or page context.",
      },
      vital: {
        type: "string",
        enum: ["lcp", "inp", "cls", "fcp", "ttfb"],
        description: "One vital to inspect; omitted returns all five.",
      },
    },
    required: ["rumApplicationId"],
  },
  get requiredPermissions(): Array<Permission> {
    return new RumApplication().getReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const applicationId: ObjectID | undefined = getApplicationId(args);
    if (!applicationId) {
      throw new BadDataException(
        "rumApplicationId is required. Use query_rum_applications to find it.",
      );
    }
    const vital: string | undefined = ToolArgs.getString(args, "vital");
    const definitions: Array<WebVitalDefinition> = WebVitalDefinitions.filter(
      (definition: WebVitalDefinition) => {
        return !vital || definition.key === vital;
      },
    );
    if (definitions.length === 0) {
      throw new BadDataException(
        "Invalid vital. Use lcp, inp, cls, fcp or ttfb.",
      );
    }
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 24,
      maxDays: 30,
    });

    /*
     * Resolve the application under the caller's access before reading any
     * telemetry. The project predicate also applies to root-backed callers.
     */
    const application: RumApplication | null =
      await RumApplicationService.findOneBy({
        query: { _id: applicationId.toString(), projectId: ctx.projectId },
        select: { _id: true },
        props: ctx.props,
      });
    if (!application) {
      throw new BadDataException(
        "The RUM application was not found or is not accessible.",
      );
    }

    const previousStart: Date = new Date(
      startTime.getTime() - (endTime.getTime() - startTime.getTime()),
    );
    const names: Array<string> = definitions.flatMap(
      (definition: WebVitalDefinition) => {
        return definition.names;
      },
    );
    const fetchAggregate: (
      start: Date,
      end: Date,
      aggregationType: AggregationType,
    ) => Promise<AggregatedResult> = async (
      start: Date,
      end: Date,
      aggregationType: AggregationType,
    ): Promise<AggregatedResult> => {
      return MetricService.aggregateBy({
        query: {
          projectId: ctx.projectId,
          primaryEntityId: applicationId,
          primaryEntityType: ServiceType.RealUserMonitor,
          name: new Includes(names),
          /*
           * InBetween is inclusive. Lower its end by one millisecond to
           * keep the two comparison windows disjoint at Date precision.
           */
          time: new InBetween(start, new Date(end.getTime() - 1)),
        },
        aggregationType: aggregationType,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        aggregationInterval: AggregationInterval.Total,
        groupBy: { name: true },
        sort: { name: SortOrder.Ascending },
        startTimestamp: start,
        endTimestamp: end,
        limit: names.length + 1,
        skip: 0,
        timeoutOverflowMode: "throw",
        props: ctx.props,
      });
    };
    const [current, previous, currentCounts, previousCounts]: [
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
    ] = await Promise.all([
      fetchAggregate(startTime, endTime, AggregationType.Avg),
      fetchAggregate(previousStart, startTime, AggregationType.Avg),
      fetchAggregate(startTime, endTime, AggregationType.Count),
      fetchAggregate(previousStart, startTime, AggregationType.Count),
    ]);
    if (
      [current, previous, currentCounts, previousCounts].some(
        (result: AggregatedResult) => {
          return result.truncated;
        },
      )
    ) {
      throw new BadDataException(
        "The web vitals query returned incomplete data. Retry with a shorter time range.",
      );
    }
    const currentValues: Map<string, number> = valuesByName(current);
    const previousValues: Map<string, number> = valuesByName(previous);
    const currentObservations: Map<string, number> =
      valuesByName(currentCounts);
    const previousObservations: Map<string, number> =
      valuesByName(previousCounts);
    const missing: Array<string> = [];
    const rows: Array<JSONObject> = [];
    for (const definition of definitions) {
      const metricName: string | undefined = definition.names.find(
        (name: string) => {
          /*
           * Histogram/Summary exporters may report a zero-count interval;
           * the metric Avg implementation returns zero for that interval.
           * Count is observation-aware, so only a positive count proves
           * that the average (including a legitimate CLS zero) was observed.
           */
          return (
            currentValues.has(name) && (currentObservations.get(name) ?? 0) > 0
          );
        },
      );
      if (!metricName) {
        missing.push(definition.key.toUpperCase());
        continue;
      }
      const value: number = currentValues.get(metricName)!;
      /*
       * Never compare different aliases across windows: both may coexist with
       * different populations. Missing prior data is not a zero baseline.
       */
      const previousValue: number | undefined =
        (previousObservations.get(metricName) ?? 0) > 0
          ? previousValues.get(metricName)
          : undefined;
      const changePercent: number | null =
        previousValue !== undefined && previousValue > 0
          ? ((value - previousValue) / previousValue) * 100
          : null;
      rows.push({
        vital: definition.key.toUpperCase(),
        metricName: metricName,
        average: value,
        observations: currentObservations.get(metricName)!,
        unit: definition.unit,
        rating: rating(value, definition),
        previousAverage: previousValue ?? null,
        previousObservations:
          previousValue !== undefined
            ? previousObservations.get(metricName)!
            : null,
        changePercent:
          changePercent !== null && Number.isFinite(changePercent)
            ? Math.round(changePercent * 100) / 100
            : null,
      });
    }
    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);
    const target: AIChatCitationTarget = applicationTarget(applicationId);
    return {
      dataForLlm: `${serialized.text}\nCurrent window: ${startTime.toISOString()} – ${endTime.toISOString()}. Previous window: ${previousStart.toISOString()} – ${startTime.toISOString()}. Window ends are exclusive.\nMissing vitals: ${missing.length > 0 ? missing.join(", ") : "none"}. Ratings apply to range averages, not p75. Percentage change is unavailable when the same metric has no previous data or its previous average is zero.`,
      rowCount: serialized.rowCount,
      citationLabel: `RUM web vitals, ${startTime.toISOString()} – ${endTime.toISOString()}`,
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: "RUM web vitals",
              description: `Averages · ${startTime.toISOString()} – ${endTime.toISOString()}`,
              columns: [
                { key: "vital", title: "Vital", type: "text" },
                { key: "average", title: "Average", type: "number" },
                { key: "unit", title: "Unit", type: "text" },
                { key: "rating", title: "Rating", type: "text" },
                {
                  key: "previousAverage",
                  title: "Previous average",
                  type: "number",
                },
                { key: "changePercent", title: "Change (%)", type: "number" },
              ],
              rows: rows,
              link: target,
            })
          : undefined,
    };
  },
};

import Metric from "../../../../Models/AnalyticsModels/Metric";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../Types/AnalyticsDatabase/ModelPermission";
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
import MetricBaselineService, {
  BandPoint,
  BaselineSummary,
  MetricBaselineService as MetricBaselineServiceClass,
} from "../../../Services/MetricBaselineService";
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

// The recent window whose average is judged against the baseline band.
const BASELINE_CURRENT_WINDOW_MINUTES: number = 15;

// Lookback rendered on the expected-range band chart.
const BASELINE_CHART_HOURS: number = 6;

export const BaselineAnomalyTool: ObservabilityTool = {
  name: "baseline_anomaly",
  description:
    "Judge whether a metric is currently anomalous versus its learned hour-of-week baseline (rolling-window mean ± sigma band, the same math the anomaly monitors use). Answers 'is this value NORMAL for this metric at this time of week?' quantitatively — use it instead of eyeballing query_metrics output. Requires the exact metric name — discover names via lookup_context.",
  inputSchema: {
    type: "object",
    properties: {
      metricName: {
        type: "string",
        description: "Exact metric name (required).",
      },
      entityId: {
        type: "string",
        description:
          "Only data points from this service/host/monitor (its OneUptime ID). When omitted, the baseline spans every entity that ingests the metric.",
      },
      atTime: {
        type: "string",
        description:
          "Evaluate at this ISO 8601 timestamp (e.g. the signal's creation time). Defaults to now.",
      },
      sensitivity: {
        type: "string",
        enum: ["Low", "Medium", "High"],
        description:
          "Band width: Low = 4 sigma (fewest anomalies), Medium = 3 sigma (default), High = 2 sigma.",
      },
      windowDays: {
        type: "number",
        enum: [...MetricBaselineServiceClass.WINDOW_DAYS_OPTIONS],
        description: "Rolling baseline window in days (default 14).",
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

    const entityId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "entityId",
    );

    let atTime: Date = OneUptimeDate.getCurrentDate();
    const atTimeString: string | undefined = ToolArgs.getString(args, "atTime");
    if (atTimeString) {
      const parsed: Date = new Date(atTimeString);
      if (isNaN(parsed.getTime())) {
        throw new BadDataException(
          `atTime "${atTimeString}" is not a valid ISO 8601 timestamp (e.g. 2024-01-31T14:00:00Z).`,
        );
      }
      atTime = parsed;
    }

    const sensitivityString: string =
      ToolArgs.getString(args, "sensitivity") || "Medium";
    if (!["Low", "Medium", "High"].includes(sensitivityString)) {
      throw new BadDataException(
        `Invalid sensitivity: ${sensitivityString}. Must be Low, Medium or High.`,
      );
    }
    const sensitivity: "Low" | "Medium" | "High" = sensitivityString as
      | "Low"
      | "Medium"
      | "High";

    const requestedWindowDays: number = ToolArgs.getNumber(args, "windowDays", {
      defaultValue: MetricBaselineServiceClass.DEFAULT_WINDOW_DAYS,
      min: MetricBaselineServiceClass.DEFAULT_WINDOW_DAYS,
      max: MetricBaselineServiceClass.MAX_WINDOW_DAYS,
    });
    // Snap to the supported window options (they match the table's TTL).
    const windowDays: number =
      [...MetricBaselineServiceClass.WINDOW_DAYS_OPTIONS]
        .reverse()
        .find((option: number) => {
          return option <= requestedWindowDays;
        }) || MetricBaselineServiceClass.DEFAULT_WINDOW_DAYS;

    /*
     * The baseline queries are raw ClickHouse SQL scoped only by projectId —
     * they skip the model layer's owned-scope filter. A label/owned-restricted
     * user must therefore be pinned to one of THEIR services: project-wide
     * baselines (no entityId) and other services' baselines are refused, the
     * same posture as the other raw-SQL tools (see LogTools/TraceTools).
     */
    const accessibleServiceIds: Array<ObjectID> | null =
      await ModelPermission.getAccessibleServiceIdsForAnalyticsModel(
        Metric,
        ctx.props,
        DatabaseRequestType.Read,
      );

    if (accessibleServiceIds !== null) {
      const isEntityAccessible: boolean = Boolean(
        entityId &&
          accessibleServiceIds.some((id: ObjectID) => {
            return id.toString() === entityId.toString();
          }),
      );

      if (!isEntityAccessible) {
        throw new BadDataException(
          "Your telemetry access is scoped to specific services, so a project-wide baseline is not available. Pass entityId set to the OneUptime ID of a service you can read (discover them via lookup_context).",
        );
      }
    }

    const hourOfWeek: number =
      MetricBaselineServiceClass.computeHourOfWeek(atTime);

    const baseline: BaselineSummary | null =
      await MetricBaselineService.getBaseline({
        projectId: ctx.projectId,
        metricName,
        primaryEntityId: entityId,
        hourOfWeek,
        windowDays,
      });

    const citationLabel: string = `baseline_anomaly(${metricName}${
      entityId ? ` · ${entityId.toString()}` : ""
    }) @ ${atTime.toISOString()}`;

    /*
     * Cold start: no baseline (or too few samples) for this hour-of-week cell.
     * Report it explicitly — a missing baseline must read as "cannot judge",
     * never as "not anomalous".
     */
    if (!baseline || !baseline.isReliable) {
      const coverage: { totalSamples: number; oldestDay: Date | null } =
        await MetricBaselineService.getCoverage({
          projectId: ctx.projectId,
          metricName,
          primaryEntityId: entityId,
        });

      const verdictRow: JSONObject = {
        verdict: "insufficient baseline data",
        detail: `The metric has ${
          baseline
            ? `only ${baseline.sampleCount} sample(s)`
            : "no baseline data"
        } for this hour of week (needs at least ${MetricBaselineServiceClass.DEFAULT_MIN_SAMPLES}). Baseline coverage overall: ${coverage.totalSamples} total sample(s)${
          coverage.oldestDay
            ? `, oldest day ${OneUptimeDate.getDateAsFormattedString(coverage.oldestDay)}`
            : ""
        }. Do NOT treat this as "not anomalous" — the baseline simply cannot judge yet.`,
        metricName,
        entityId: entityId?.toString(),
        evaluatedAt: atTime.toISOString(),
        hourOfWeek,
        windowDays,
      };

      const serializedColdStart: SerializedResult =
        ToolResultSerializer.serializeRows([verdictRow]);

      return {
        dataForLlm: serializedColdStart.text,
        rowCount: serializedColdStart.rowCount,
        citationLabel,
        citationTarget: { type: AIChatCitationTargetType.Metrics },
        redactionCount: serializedColdStart.redactionCount,
        isTruncated: serializedColdStart.isTruncated,
      };
    }

    // Current value: average over the recent window ending at atTime.
    const currentWindowStart: Date = OneUptimeDate.addRemoveMinutes(
      atTime,
      -1 * BASELINE_CURRENT_WINDOW_MINUTES,
    );

    const currentQuery: JSONObject = {
      name: metricName,
      time: new InBetween(currentWindowStart, atTime),
    };
    if (entityId) {
      currentQuery["primaryEntityId"] = entityId;
    }

    const currentResult: AggregatedResult = await MetricService.aggregateBy({
      aggregateColumnName: "value",
      aggregationType: AggregationType.Avg,
      aggregationTimestampColumnName: "time",
      startTimestamp: currentWindowStart,
      endTimestamp: atTime,
      query: currentQuery as never,
      limit: 200,
      skip: 0,
      props: ctx.props,
    } as AggregateBy<Metric>);

    const currentValues: Array<number> = currentResult.data
      .map((item: AggregatedModel) => {
        return item.value;
      })
      .filter((value: unknown): value is number => {
        return typeof value === "number" && Number.isFinite(value);
      });

    const sigma: number =
      MetricBaselineServiceClass.sigmaForSensitivity(sensitivity);
    const expectedLow: number = baseline.mean - sigma * baseline.stddev;
    const expectedHigh: number = baseline.mean + sigma * baseline.stddev;

    let verdict: string;
    let currentValue: number | null = null;
    let zScore: number | null = null;

    if (currentValues.length === 0) {
      verdict = `no data points in the last ${BASELINE_CURRENT_WINDOW_MINUTES} minutes — the metric may have STOPPED reporting, which can itself be the anomaly`;
    } else {
      currentValue =
        currentValues.reduce((sum: number, value: number) => {
          return sum + value;
        }, 0) / currentValues.length;

      if (baseline.stddev <= 0) {
        /*
         * Zero-variance baseline: the band collapses to a point and
         * floating-point noise alone would flag every sample. The anomaly
         * monitors refuse to classify here (MetricMonitorCriteria) — match
         * them rather than emitting guaranteed-false ANOMALOUS verdicts.
         */
        verdict = `cannot judge — the baseline has zero variance (the metric has been constant at ${baseline.mean}), so any band would flag every sample; compare the current value to the baseline mean directly instead`;
      } else {
        zScore = (currentValue - baseline.mean) / baseline.stddev;

        if (currentValue > expectedHigh) {
          verdict = `ANOMALOUS — above the expected range for this hour of week`;
        } else if (currentValue < expectedLow) {
          verdict = `ANOMALOUS — below the expected range for this hour of week`;
        } else {
          verdict = `normal — within the expected range for this hour of week`;
        }
      }
    }

    const row: JSONObject = {
      verdict,
      metricName,
      entityId: entityId?.toString(),
      evaluatedAt: atTime.toISOString(),
      currentValue:
        currentValue !== null
          ? `${currentValue} (avg over the last ${BASELINE_CURRENT_WINDOW_MINUTES} min)`
          : null,
      expectedRange: `${expectedLow} to ${expectedHigh} (mean ${baseline.mean} ± ${sigma}σ, σ=${baseline.stddev})`,
      zScore,
      baselineMedian: baseline.median,
      baselineP95: baseline.p95,
      baselineSampleCount: baseline.sampleCount,
      baselineWindowDays: baseline.windowDays,
      hourOfWeek,
      sensitivity,
    };

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      row,
    ]);

    // Expected-range band + actual values over the recent past, for the panel.
    const chartStart: Date = OneUptimeDate.addRemoveHours(
      atTime,
      -1 * BASELINE_CHART_HOURS,
    );

    let bandSeries: Array<BandPoint> = [];
    let actualPoints: Array<AIChatWidgetPoint> = [];
    try {
      bandSeries = await MetricBaselineService.getBandSeries({
        projectId: ctx.projectId,
        metricName,
        primaryEntityId: entityId,
        startTime: chartStart,
        endTime: atTime,
        intervalMinutes: 15,
        sigmaCount: sigma,
        windowDays,
      });

      const chartQuery: JSONObject = {
        name: metricName,
        time: new InBetween(chartStart, atTime),
      };
      if (entityId) {
        chartQuery["primaryEntityId"] = entityId;
      }

      const chartActualResult: AggregatedResult =
        await MetricService.aggregateBy({
          aggregateColumnName: "value",
          aggregationType: AggregationType.Avg,
          aggregationTimestampColumnName: "time",
          startTimestamp: chartStart,
          endTimestamp: atTime,
          query: chartQuery as never,
          limit: 200,
          skip: 0,
          props: ctx.props,
        } as AggregateBy<Metric>);

      actualPoints = chartActualResult.data.map((item: AggregatedModel) => {
        return {
          x: OneUptimeDate.toString(OneUptimeDate.fromString(item.timestamp)),
          y: typeof item.value === "number" ? item.value : null,
        };
      });
    } catch {
      // The band chart is decorative — never fail the verdict for it.
    }

    const toPoints: (
      pick: (point: BandPoint) => number,
    ) => Array<AIChatWidgetPoint> = (
      pick: (point: BandPoint) => number,
    ): Array<AIChatWidgetPoint> => {
      return bandSeries.map((point: BandPoint) => {
        return {
          x: OneUptimeDate.toString(point.time),
          y: pick(point),
        };
      });
    };

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel,
      citationTarget: { type: AIChatCitationTargetType.Metrics },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        bandSeries.length > 0
          ? WidgetBuilder.timeSeries({
              title: `${metricName} vs expected range`,
              description: `Hour-of-week baseline (±${sigma}σ, ${windowDays}-day window), ${chartStart.toISOString()} – ${atTime.toISOString()}`,
              series: [
                {
                  name: "expected high",
                  points: toPoints((point: BandPoint) => {
                    return point.expectedHigh;
                  }),
                },
                {
                  name: "expected low",
                  points: toPoints((point: BandPoint) => {
                    return point.expectedLow;
                  }),
                },
                ...(actualPoints.length > 0
                  ? [{ name: "actual", points: actualPoints }]
                  : []),
              ],
              valueLabel: metricName,
              link: { type: AIChatCitationTargetType.Metrics },
            })
          : undefined,
    };
  },
};

import Metric from "../../../../Models/AnalyticsModels/Metric";
import { AIChatWidgetSeries } from "../../../../Types/AI/AIChatTypes";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import MetricService from "../../../Services/MetricService";
import AggregateBy from "../../../Types/AnalyticsDatabase/AggregateBy";
import { MAX_METRIC_SERIES, countBuckets } from "./MetricAttributeQuery";

/*
 * A metric read one series per value of some attributes (issue #4784): the
 * busy and idle CPU states apart, each container apart, each mount apart.
 *
 * The read is MetricService's own grouped aggregation - the one the metric
 * explorer charts with - bounded the same way: the server keeps the
 * MAX_METRIC_SERIES groups with the highest peak over the whole window and
 * says how many there were (Top-K), and the row limit is sized to those
 * series' buckets, so a metric with thousands of values never reads more
 * than a chart would.
 *
 * Next to the value, the same groups are counted, so a bucket a distribution
 * metric exported with no observations reads as "no data" rather than as a
 * real zero (the ungrouped reads do the same).
 */

// A bucket of one series; null when it had no observations.
export interface MetricSeriesPoint {
  timestamp: Date;
  value: number | null;
}

export interface MetricSeries {
  // The grouped attributes of this series, as stored ("" when absent).
  attributes: Record<string, string>;
  // "state=user", "resource.container.name=api" - what tells it apart.
  label: string;
  points: Array<MetricSeriesPoint>;
  min: number | null;
  max: number | null;
  avg: number | null;
  // The value of the newest bucket with data.
  latest: number | null;
}

export interface GroupedMetricRead {
  series: Array<MetricSeries>;
  // How many series matched, before the highest-peak cut.
  totalSeries: number;
  // True when series were cut, or the read hit its row limit.
  isTruncated: boolean;
}

// What a series reads as when none of its grouped attributes has a value.
export const NO_ATTRIBUTE_VALUE_LABEL: string = "(no value)";

// How a bucket with no data reads in a trend line.
export const TREND_GAP: string = "·";

const INTERVAL_WORDS: Partial<Record<AggregationInterval, string>> = {
  [AggregationInterval.Minute]: "1-minute",
  [AggregationInterval.FiveMinutes]: "5-minute",
  [AggregationInterval.FifteenMinutes]: "15-minute",
  [AggregationInterval.ThirtyMinutes]: "30-minute",
  [AggregationInterval.Hour]: "1-hour",
  [AggregationInterval.Day]: "1-day",
  [AggregationInterval.Week]: "1-week",
  [AggregationInterval.Month]: "1-month",
  [AggregationInterval.Year]: "1-year",
};

// "1-minute", "5-minute" - a bucket's width in words.
export function describeInterval(interval: AggregationInterval): string {
  return INTERVAL_WORDS[interval] || interval.toLowerCase();
}

export default class GroupedMetricSeries {
  /*
   * Read `query` (which must already hold the project and every scope the
   * caller is held to) one series per value of `groupBy`.
   */
  public static async read(data: {
    query: JSONObject;
    aggregationType: AggregationType;
    groupBy: Array<string>;
    interval: AggregationInterval;
    startTime: Date;
    endTime: Date;
    props: DatabaseCommonInteractionProps;
    maxSeries?: number | undefined;
  }): Promise<GroupedMetricRead> {
    const maxSeries: number = data.maxSeries || MAX_METRIC_SERIES;
    const bucketCount: number = countBuckets({
      startTime: data.startTime,
      endTime: data.endTime,
      interval: data.interval,
    });
    const limit: number = Math.min(
      LIMIT_PER_PROJECT,
      maxSeries * (bucketCount + 1),
    );

    // A fresh request each time: the service keeps per-request state.
    const aggregate: (
      aggregationType: AggregationType,
    ) => Promise<AggregatedResult> = async (
      aggregationType: AggregationType,
    ): Promise<AggregatedResult> => {
      const aggregateBy: AggregateBy<Metric> = {
        query: data.query as never,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        aggregationType,
        aggregationInterval: data.interval,
        startTimestamp: data.startTime,
        endTimestamp: data.endTime,
        groupByAttributeKeys: data.groupBy,
        topK: { count: maxSeries, rankBy: "max" },
        sort: { time: SortOrder.Ascending } as never,
        limit,
        skip: 0,
        props: data.props,
      };

      return await MetricService.aggregateBy(aggregateBy);
    };

    const values: AggregatedResult = await aggregate(data.aggregationType);
    const counts: AggregatedResult =
      data.aggregationType === AggregationType.Count
        ? values
        : await aggregate(AggregationType.Count);

    const series: Array<MetricSeries> = GroupedMetricSeries.toSeries({
      valueRows: values.data,
      countRows: counts.data,
      groupBy: data.groupBy,
    }).slice(0, maxSeries);

    const totalSeries: number = Math.max(
      series.length,
      values.totalGroups ?? 0,
    );

    return {
      series,
      totalSeries,
      isTruncated:
        totalSeries > series.length ||
        Boolean(values.truncated) ||
        Boolean(counts.truncated),
    };
  }

  /*
   * Rows of a grouped aggregate, one series per group, highest peak first
   * (then by label, so the order never depends on the database's). A bucket
   * counted as empty, or whose value is not a finite number, is a gap.
   */
  public static toSeries(data: {
    valueRows: Array<AggregatedModel>;
    countRows?: Array<AggregatedModel> | undefined;
    groupBy: Array<string>;
  }): Array<MetricSeries> {
    const countsByBucket: Map<string, number> = new Map<string, number>();

    for (const row of data.countRows || []) {
      const attributes: Record<string, string> =
        GroupedMetricSeries.readGroupAttributes(row, data.groupBy);
      countsByBucket.set(
        GroupedMetricSeries.bucketKey(attributes, row.timestamp),
        Number(row.value),
      );
    }

    const seriesByKey: Map<string, MetricSeries> = new Map<
      string,
      MetricSeries
    >();

    for (const row of data.valueRows) {
      const attributes: Record<string, string> =
        GroupedMetricSeries.readGroupAttributes(row, data.groupBy);
      const key: string = GroupedMetricSeries.groupKey(attributes);

      let series: MetricSeries | undefined = seriesByKey.get(key);

      if (!series) {
        series = {
          attributes,
          label: GroupedMetricSeries.describeLabel(attributes, data.groupBy),
          points: [],
          min: null,
          max: null,
          avg: null,
          latest: null,
        };
        seriesByKey.set(key, series);
      }

      const count: number | undefined = data.countRows
        ? countsByBucket.get(
            GroupedMetricSeries.bucketKey(attributes, row.timestamp),
          )
        : undefined;
      const isEmptyBucket: boolean = data.countRows !== undefined && !count;
      const value: number = Number(row.value);

      series.points.push({
        timestamp: new Date(row.timestamp),
        value: !isEmptyBucket && Number.isFinite(value) ? value : null,
      });
    }

    const allSeries: Array<MetricSeries> = Array.from(seriesByKey.values());

    for (const series of allSeries) {
      series.points.sort((a: MetricSeriesPoint, b: MetricSeriesPoint) => {
        return a.timestamp.getTime() - b.timestamp.getTime();
      });
      GroupedMetricSeries.summarize(series);
    }

    return allSeries.sort((a: MetricSeries, b: MetricSeries): number => {
      const peakA: number = a.max ?? Number.NEGATIVE_INFINITY;
      const peakB: number = b.max ?? Number.NEGATIVE_INFINITY;

      if (peakA !== peakB) {
        return peakB - peakA;
      }

      return a.label.localeCompare(b.label);
    });
  }

  /*
   * "state=user", or "state=user, cpu.mode=" left out: keys a row does not
   * carry are not part of its name. A series with no grouped value at all
   * is "(no value)".
   */
  public static describeLabel(
    attributes: Record<string, string>,
    groupBy: Array<string>,
  ): string {
    const parts: Array<string> = [];

    for (const key of groupBy) {
      const value: string = attributes[key] || "";

      if (value) {
        parts.push(`${key}=${value}`);
      }
    }

    return parts.length > 0 ? parts.join(", ") : NO_ATTRIBUTE_VALUE_LABEL;
  }

  /*
   * One series as the model reads it: its name, its range and its trend,
   * one value per bucket in time order (TREND_GAP where it had none).
   */
  public static toLlmRow(series: MetricSeries): JSONObject {
    // One bucket (a whole-window summary) is one value, said once.
    if (series.points.length <= 1) {
      return {
        series: series.label,
        value: GroupedMetricSeries.formatNumber(series.latest),
      };
    }

    return {
      series: series.label,
      min: GroupedMetricSeries.formatNumber(series.min),
      avg: GroupedMetricSeries.formatNumber(series.avg),
      max: GroupedMetricSeries.formatNumber(series.max),
      latest: GroupedMetricSeries.formatNumber(series.latest),
      trend: GroupedMetricSeries.formatTrend(series.points),
    };
  }

  public static formatTrend(points: Array<MetricSeriesPoint>): string {
    return points
      .map((point: MetricSeriesPoint): string => {
        return point.value === null
          ? TREND_GAP
          : GroupedMetricSeries.formatNumber(point.value);
      })
      .join(" ");
  }

  // Four significant digits: enough to read a trend, short enough to scan.
  public static formatNumber(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return "no data";
    }

    return String(Number(value.toPrecision(4)));
  }

  /*
   * What a grouped read holds, for the model: how many series and in what
   * order, how to read a trend, and what was left out and how to see it.
   */
  public static describeRead(data: {
    read: GroupedMetricRead;
    groupBy: Array<string>;
    interval: AggregationInterval;
    startTime: Date;
  }): string {
    const sentences: Array<string> = [];
    const shown: number = data.read.series.length;
    const by: string = data.groupBy.join(", ");

    if (shown === 0) {
      return `No data points matched, so there is no series by ${by}. Missing data is not evidence of health.`;
    }

    sentences.push(
      `${shown} series by ${by}, the highest peak first.${
        data.read.totalSeries > shown
          ? ` ${data.read.totalSeries} matched; these are the ${shown} with the highest peak - filter attributes to see the others.`
          : ""
      }`,
    );

    if (data.interval === AggregationInterval.Total) {
      sentences.push("Each value covers the whole window.");
    } else {
      sentences.push(
        `Each trend lists one value per ${describeInterval(data.interval)} bucket from ${data.startTime.toISOString()}, oldest first (${TREND_GAP} = no data in that bucket).`,
      );
    }

    if (data.read.isTruncated && data.read.totalSeries <= shown) {
      sentences.push(
        "The read reached its row limit, so some buckets may be missing: use a shorter window.",
      );
    }

    return sentences.join(" ");
  }

  /*
   * The grouped keys the series are told apart by: those of `groupBy` that
   * carry a value in at least one series, in its order. A split metric is
   * grouped by its old and its new attribute name at once (state and
   * cpu.mode), and a collector sends one of them, so people are told only
   * of the one there is. All of `groupBy` when no series has a value.
   */
  public static getShownGroupBy(
    series: Array<MetricSeries>,
    groupBy: Array<string>,
  ): Array<string> {
    const shown: Array<string> = groupBy.filter((key: string): boolean => {
      return series.some((item: MetricSeries): boolean => {
        return Boolean(item.attributes[key]);
      });
    });

    return shown.length > 0 ? shown : groupBy;
  }

  /*
   * The chart's lines. Each is named by its label ("state=user, host=a"),
   * or, when the series differ in one attribute only, by its value ("user")
   * - the chart's title names the attribute ("... by state").
   */
  public static toWidgetSeries(
    series: Array<MetricSeries>,
    groupBy?: Array<string> | undefined,
  ): Array<AIChatWidgetSeries> {
    const shown: Array<string> = groupBy
      ? GroupedMetricSeries.getShownGroupBy(series, groupBy)
      : [];
    const onlyKey: string | undefined =
      shown.length === 1 ? shown[0] : undefined;

    return series.map((item: MetricSeries): AIChatWidgetSeries => {
      return {
        name: onlyKey
          ? item.attributes[onlyKey] || NO_ATTRIBUTE_VALUE_LABEL
          : item.label,
        points: item.points.map((point: MetricSeriesPoint) => {
          return { x: point.timestamp.toISOString(), y: point.value };
        }),
      };
    });
  }

  private static summarize(series: MetricSeries): void {
    const values: Array<number> = series.points
      .map((point: MetricSeriesPoint): number | null => {
        return point.value;
      })
      .filter((value: number | null): value is number => {
        return value !== null;
      });

    if (values.length === 0) {
      return;
    }

    series.min = Math.min(...values);
    series.max = Math.max(...values);
    series.avg =
      values.reduce((sum: number, value: number): number => {
        return sum + value;
      }, 0) / values.length;
    series.latest = values[values.length - 1]!;
  }

  // The grouped attributes a row carries (MetricService's `attributes` map).
  private static readGroupAttributes(
    row: AggregatedModel,
    groupBy: Array<string>,
  ): Record<string, string> {
    const raw: unknown = row["attributes"];
    const attributes: Record<string, string> = {};

    for (const key of groupBy) {
      const value: unknown =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)[key]
          : undefined;

      attributes[key] =
        value === undefined || value === null ? "" : String(value);
    }

    return attributes;
  }

  private static groupKey(attributes: Record<string, string>): string {
    return JSON.stringify(attributes);
  }

  private static bucketKey(
    attributes: Record<string, string>,
    timestamp: Date | string,
  ): string {
    return `${GroupedMetricSeries.groupKey(attributes)}@${new Date(timestamp).getTime()}`;
  }
}

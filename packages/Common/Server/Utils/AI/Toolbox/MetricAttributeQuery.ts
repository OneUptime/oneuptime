import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../../Types/BaseDatabase/AggregationIntervalUtil";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import {
  AttributeSplitMetric,
  getAttributeSplitMetric,
  isSplitDecidedByCaller,
} from "../../../../Types/Metrics/AttributeSplitMetrics";

/*
 * The attribute arguments the AI's metric tools share (issue #4784):
 * `attributes`, an equality filter on a data point's attributes, and
 * `groupBy`, the attribute keys to read one series per value of. The metric
 * explorer has always had both; without them a metric reported once per
 * CPU state or per mount point could only be read as one average of
 * everything, which for CPU is a flat 1/8.
 *
 * Arguments come from the model and are untrusted: every key and value is
 * checked for shape and length here, and the query layer binds them as
 * parameters (MetricService), so nothing here builds SQL.
 */

// The most attribute filters one read takes.
export const MAX_ATTRIBUTE_FILTERS: number = 10;

// The most attribute keys one read groups by.
export const MAX_GROUP_BY_KEYS: number = 3;

// The most series one grouped read hands back, the highest peak first.
export const MAX_METRIC_SERIES: number = 10;

export const MAX_ATTRIBUTE_KEY_LENGTH: number = 256;
export const MAX_ATTRIBUTE_VALUE_LENGTH: number = 1024;

/*
 * A trend is read in at most this many time buckets, so every series fits
 * one line the model reads, and the serializer's row budget is never what
 * cuts a chart's tail.
 */
export const MAX_TREND_BUCKETS: number = 49;

export const METRIC_ATTRIBUTE_SCHEMA_PROPERTIES: JSONObject = {
  attributes: {
    type: "object",
    additionalProperties: { type: "string" },
    description:
      'Only data points whose attributes equal these values, e.g. {"state": "idle"} or {"resource.host.name": "web-1"}. A data point\'s own attributes are plain keys (state, cpu, mountpoint, direction); its resource\'s attributes start with "resource." (resource.host.name, resource.container.name, resource.service.name). lookup_context with type attributeKeys and a metricName lists the keys a metric has.',
  },
  groupBy: {
    type: "array",
    items: { type: "string" },
    description: `Up to ${MAX_GROUP_BY_KEYS} attribute keys to read one series per value of, e.g. ["state"] or ["resource.container.name"]. At most ${MAX_METRIC_SERIES} series come back, the highest peak first, and the result says how many there were.`,
  },
};

/*
 * The attribute filter the model asked for, or undefined when it asked for
 * none. A number or a boolean is read as its text, the way attributes are
 * stored; anything else is refused with what to send instead.
 */
export function readAttributeFilter(
  args: JSONObject,
): Record<string, string> | undefined {
  const value: unknown = args["attributes"];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadDataException(
      'attributes must be an object of attribute keys and values, e.g. {"state": "idle"}.',
    );
  }

  const filter: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const key: string = rawKey.trim();

    if (!key) {
      continue;
    }

    if (key.length > MAX_ATTRIBUTE_KEY_LENGTH) {
      throw new BadDataException(
        `Attribute key "${key.slice(0, 40)}…" is longer than ${MAX_ATTRIBUTE_KEY_LENGTH} characters.`,
      );
    }

    if (
      typeof rawValue !== "string" &&
      typeof rawValue !== "number" &&
      typeof rawValue !== "boolean"
    ) {
      throw new BadDataException(
        `The value of attribute "${key}" must be a string, a number or a boolean.`,
      );
    }

    const text: string = String(rawValue);

    if (text.length > MAX_ATTRIBUTE_VALUE_LENGTH) {
      throw new BadDataException(
        `The value of attribute "${key}" is longer than ${MAX_ATTRIBUTE_VALUE_LENGTH} characters.`,
      );
    }

    filter[key] = text;
  }

  const keyCount: number = Object.keys(filter).length;

  if (keyCount > MAX_ATTRIBUTE_FILTERS) {
    throw new BadDataException(
      `At most ${MAX_ATTRIBUTE_FILTERS} attribute filters are supported; ${keyCount} were given.`,
    );
  }

  return keyCount > 0 ? filter : undefined;
}

/*
 * The attribute keys the model asked to group by, deduplicated, or
 * undefined when it asked for none. One key may come as a plain string.
 */
export function readGroupBy(args: JSONObject): Array<string> | undefined {
  const value: unknown = args["groupBy"];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const rawKeys: Array<unknown> = Array.isArray(value) ? value : [value];
  const keys: Array<string> = [];

  for (const rawKey of rawKeys) {
    if (typeof rawKey !== "string") {
      throw new BadDataException(
        'groupBy must be a list of attribute keys, e.g. ["state"].',
      );
    }

    const key: string = rawKey.trim();

    if (!key || keys.includes(key)) {
      continue;
    }

    if (key.length > MAX_ATTRIBUTE_KEY_LENGTH) {
      throw new BadDataException(
        `groupBy key "${key.slice(0, 40)}…" is longer than ${MAX_ATTRIBUTE_KEY_LENGTH} characters.`,
      );
    }

    keys.push(key);
  }

  if (keys.length > MAX_GROUP_BY_KEYS) {
    throw new BadDataException(
      `groupBy takes at most ${MAX_GROUP_BY_KEYS} attribute keys; ${keys.length} were given.`,
    );
  }

  return keys.length > 0 ? keys : undefined;
}

/*
 * How a metric is read: grouped as the caller asked, split by the
 * attribute it is reported per (AttributeSplitMetrics) when the caller left
 * that to the tool, or as one number.
 */
export interface MetricReadPlan {
  // The attribute keys to read one series per value of; empty = one series.
  groupBy: Array<string>;
  // The metric's split, when it has one.
  split?: AttributeSplitMetric | undefined;
  // True when the tool chose the grouping (the metric's split), not the caller.
  isSplitByTool: boolean;
  /*
   * True when the caller grouped by other keys and left the split alone:
   * each of their series still averages every state.
   */
  isSplitIgnored: boolean;
}

export function planMetricRead(data: {
  metricName: string | undefined;
  attributeFilter: Record<string, string> | undefined;
  groupBy: Array<string> | undefined;
}): MetricReadPlan {
  const split: AttributeSplitMetric | undefined = getAttributeSplitMetric(
    data.metricName,
  );
  const groupBy: Array<string> = data.groupBy ? [...data.groupBy] : [];

  if (!split) {
    return {
      groupBy,
      isSplitByTool: false,
      isSplitIgnored: false,
    };
  }

  const isDecided: boolean = isSplitDecidedByCaller({
    split,
    attributeFilterKeys: Object.keys(data.attributeFilter || {}),
    groupBy,
  });

  if (isDecided) {
    return { groupBy, split, isSplitByTool: false, isSplitIgnored: false };
  }

  if (groupBy.length > 0) {
    return { groupBy, split, isSplitByTool: false, isSplitIgnored: true };
  }

  return {
    groupBy: [...split.splitBy],
    split,
    isSplitByTool: true,
    isSplitIgnored: false,
  };
}

/*
 * What a read of a split metric says about the split, for the model: what
 * one series is, and what the tool did about it. Empty for other metrics.
 */
export function describeMetricReadPlan(plan: MetricReadPlan): string {
  if (!plan.split) {
    return "";
  }

  const key: string = plan.split.splitBy[0] || "its attribute";

  if (plan.isSplitByTool) {
    return `${plan.split.metricName} is reported once per ${key}, so it was read one series per ${key}: ${plan.split.meaning}`;
  }

  if (plan.isSplitIgnored) {
    return `Warning: ${plan.split.metricName} is reported once per ${key}, and this read did not split it, so each series averages every ${key} - add "${key}" to groupBy, or filter attributes on one ${key}. ${plan.split.meaning}`;
  }

  return plan.split.meaning;
}

/*
 * The smallest interval that keeps the whole window within
 * MAX_TREND_BUCKETS buckets, partial first and last buckets included, so
 * the tail of a trend is never cut.
 */
export function chooseTrendInterval(
  startTime: Date,
  endTime: Date,
): AggregationInterval {
  const intervals: Array<AggregationInterval> = [
    AggregationInterval.Minute,
    AggregationInterval.FiveMinutes,
    AggregationInterval.FifteenMinutes,
    AggregationInterval.ThirtyMinutes,
    AggregationInterval.Hour,
    AggregationInterval.Day,
  ];

  return (
    intervals.find((interval: AggregationInterval): boolean => {
      return (
        countBuckets({ startTime, endTime, interval }) <= MAX_TREND_BUCKETS
      );
    }) || AggregationInterval.Day
  );
}

// How many buckets of `interval` the window touches; 1 for Total.
export function countBuckets(data: {
  startTime: Date;
  endTime: Date;
  interval: AggregationInterval;
}): number {
  if (data.interval === AggregationInterval.Total) {
    return 1;
  }

  return (
    Math.ceil(
      (data.endTime.getTime() - data.startTime.getTime()) /
        AggregationIntervalUtil.getAggregationIntervalMs(data.interval),
    ) + 1
  );
}

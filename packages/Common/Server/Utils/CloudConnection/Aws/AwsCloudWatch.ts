import { JSONObject } from "../../../../Types/JSON";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudConnectorTransport,
  CloudReadBudget,
} from "../CloudConnectorTypes";
import { AwsCredentials, sendAwsRequest } from "./AwsApi";

/*
 * Amazon CloudWatch, the two calls a cloud connection makes, over
 * CloudWatch's AWS JSON 1.0 protocol (target prefix
 * GraniteServiceVersion20100801), signed for the service "monitoring":
 *
 *   ListMetrics    { Namespace, MetricName, RecentlyActive: "PT3H",
 *                    Dimensions, NextToken } -> { Metrics: [{ Namespace,
 *                    MetricName, Dimensions: [{ Name, Value }] }],
 *                    NextToken }, 500 a page. Free within the account's
 *                    million free API calls a month. Without RecentlyActive
 *                    it lists every series that reported in the last two
 *                    weeks; with Dimensions, each series that carries them,
 *                    whatever other dimensions it has.
 *   GetMetricData  { MetricDataQueries: [{ Id, MetricStat: { Metric,
 *                    Period, Stat }, ReturnData }], StartTime, EndTime,
 *                    ScanBy, NextToken } -> { MetricDataResults: [{ Id,
 *                    Timestamps, Values }], NextToken }; at most 500
 *                    queries a call. Charged per metric read.
 *
 * Timestamps in a JSON answer are epoch seconds.
 */

const CLOUDWATCH_SERVICE: string = "monitoring";
const TARGET_PREFIX: string = "GraniteServiceVersion20100801";
const PROVIDER_TITLE: string = "Amazon CloudWatch";
export const MAX_QUERIES_PER_CALL: number = 500;
// Pages of one listing at most (500 metrics a page).
const MAX_LIST_PAGES: number = 20;
const MAX_DATA_PAGES: number = 20;

export interface AwsMetricDimension {
  name: string;
  value: string;
}

export interface AwsListedMetric {
  namespace: string;
  metricName: string;
  dimensions: Array<AwsMetricDimension>;
}

export interface AwsMetricQuery {
  id: string;
  namespace: string;
  metricName: string;
  dimensions: Array<AwsMetricDimension>;
  statistic: string;
  periodSeconds: number;
  /*
   * Only the data published with this unit (MetricStat.Unit): CloudWatch
   * answers a query of another unit with no data, and converts nothing.
   */
  unit?: string | undefined;
}

/*
 * CloudWatch's units, as its datapoints carry them (StandardUnit, the
 * values GetMetricData's MetricStat.Unit takes).
 */
export const AWS_CLOUDWATCH_UNITS: ReadonlyArray<string> = [
  "Seconds",
  "Microseconds",
  "Milliseconds",
  "Bytes",
  "Kilobytes",
  "Megabytes",
  "Gigabytes",
  "Terabytes",
  "Bits",
  "Kilobits",
  "Megabits",
  "Gigabits",
  "Terabits",
  "Percent",
  "Count",
  "Bytes/Second",
  "Kilobytes/Second",
  "Megabytes/Second",
  "Gigabytes/Second",
  "Terabytes/Second",
  "Bits/Second",
  "Kilobits/Second",
  "Megabits/Second",
  "Gigabits/Second",
  "Terabits/Second",
  "Count/Second",
  "None",
];

/*
 * How far back a metric's unit is looked for, a point a day: as far as
 * ListMetrics lists a metric that is quiet (two weeks), so a metric a
 * listing found has data in it.
 */
export const AWS_UNIT_LOOK_BACK_DAYS: number = 14;
const DAY_SECONDS: number = 24 * 60 * 60;

export interface AwsMetricResult {
  id: string;
  timestamps: Array<number>;
  values: Array<number>;
}

export interface AwsCloudWatchOptions {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  region: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}

async function call(
  options: AwsCloudWatchOptions,
  action: string,
  payload: JSONObject,
): Promise<JSONObject> {
  const answer: { json: JSONObject } = await sendAwsRequest({
    transport: options.transport,
    credentials: options.credentials,
    service: CLOUDWATCH_SERVICE,
    region: options.region,
    target: `${TARGET_PREFIX}.${action}`,
    jsonVersion: "1.0",
    body: payload,
    step: `${action} request in ${options.region}`,
    providerTitle: PROVIDER_TITLE,
    now: options.now,
    timeoutInMs: options.timeoutInMs,
    sleep: options.sleep,
    budget: options.budget,
  });

  return answer.json;
}

function readDimensions(value: unknown): Array<AwsMetricDimension> {
  const dimensions: Array<AwsMetricDimension> = [];

  for (const raw of readArray(value)) {
    const dimension: JSONObject = readObject(raw);
    const name: string = readText(dimension["Name"]);

    if (name) {
      dimensions.push({ name, value: readText(dimension["Value"]) });
    }
  }

  return dimensions;
}

/*
 * The metrics of a namespace (and a name, when given) that reported in the
 * last three hours - or, with includeQuiet, in the last two weeks, for a
 * namespace whose metrics are published a few times a day
 * (AwsNamespaceKeyMetrics.isListedWhenQuiet). firstPageOnly answers "does
 * the namespace have any" in one call.
 */
export async function listMetrics(
  options: AwsCloudWatchOptions,
  data: {
    namespace: string;
    metricName?: string | undefined;
    firstPageOnly?: boolean | undefined;
    includeQuiet?: boolean | undefined;
    /*
     * Only series that carry each of these dimensions with its value - and
     * maybe others: CloudWatch lists a series of more dimensions too. One
     * resource's metrics, by its identifying dimensions (CloudResourceMetrics).
     */
    dimensions?: Array<AwsMetricDimension> | undefined;
  },
): Promise<Array<AwsListedMetric>> {
  const metrics: Array<AwsListedMetric> = [];
  let nextToken: string = "";

  for (let page: number = 0; page < MAX_LIST_PAGES; page++) {
    const payload: JSONObject = {
      Namespace: data.namespace,
    };

    if (!data.includeQuiet) {
      payload["RecentlyActive"] = "PT3H";
    }

    if (data.metricName) {
      payload["MetricName"] = data.metricName;
    }

    if (data.dimensions && data.dimensions.length > 0) {
      payload["Dimensions"] = data.dimensions.map(
        (dimension: AwsMetricDimension): JSONObject => {
          return { Name: dimension.name, Value: dimension.value };
        },
      );
    }

    if (nextToken) {
      payload["NextToken"] = nextToken;
    }

    const response: JSONObject = await call(options, "ListMetrics", payload);

    for (const raw of readArray(response["Metrics"])) {
      const metric: JSONObject = readObject(raw);
      const metricName: string = readText(metric["MetricName"]);

      if (metricName) {
        metrics.push({
          namespace: readText(metric["Namespace"]) || data.namespace,
          metricName,
          dimensions: readDimensions(metric["Dimensions"]),
        });
      }
    }

    const next: string = readText(response["NextToken"]);

    if (data.firstPageOnly || !next || next === nextToken) {
      break;
    }

    nextToken = next;
  }

  return metrics;
}

// Epoch seconds (the JSON protocol) or an ISO string; milliseconds out.
export function readAwsTimestamp(value: unknown): number {
  if (typeof value === "number") {
    return value * 1000;
  }

  const parsed: number = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

/*
 * The values of the queries over [startTime, endTime), in calls of at most
 * MAX_QUERIES_PER_CALL. A query with no data in the window has no entry.
 */
export async function getMetricData(
  options: AwsCloudWatchOptions,
  data: {
    queries: Array<AwsMetricQuery>;
    startTime: Date;
    endTime: Date;
  },
): Promise<Array<AwsMetricResult>> {
  const results: Map<string, AwsMetricResult> = new Map();

  for (
    let offset: number = 0;
    offset < data.queries.length;
    offset += MAX_QUERIES_PER_CALL
  ) {
    const batch: Array<AwsMetricQuery> = data.queries.slice(
      offset,
      offset + MAX_QUERIES_PER_CALL,
    );
    let nextToken: string = "";

    for (let page: number = 0; page < MAX_DATA_PAGES; page++) {
      const payload: JSONObject = {
        MetricDataQueries: batch.map((query: AwsMetricQuery): JSONObject => {
          return {
            Id: query.id,
            MetricStat: {
              Metric: {
                Namespace: query.namespace,
                MetricName: query.metricName,
                Dimensions: query.dimensions.map(
                  (dimension: AwsMetricDimension): JSONObject => {
                    return { Name: dimension.name, Value: dimension.value };
                  },
                ),
              },
              Period: query.periodSeconds,
              Stat: query.statistic,
              ...(query.unit ? { Unit: query.unit } : {}),
            },
            ReturnData: true,
          };
        }),
        StartTime: Math.floor(data.startTime.getTime() / 1000),
        EndTime: Math.floor(data.endTime.getTime() / 1000),
        ScanBy: "TimestampAscending",
      };

      if (nextToken) {
        payload["NextToken"] = nextToken;
      }

      const response: JSONObject = await call(
        options,
        "GetMetricData",
        payload,
      );

      for (const raw of readArray(response["MetricDataResults"])) {
        const result: JSONObject = readObject(raw);
        const id: string = readText(result["Id"]);

        if (!id) {
          continue;
        }

        const entry: AwsMetricResult = results.get(id) || {
          id,
          timestamps: [],
          values: [],
        };
        const values: Array<unknown> = readArray(result["Values"]);

        readArray(result["Timestamps"]).forEach(
          (timestamp: unknown, position: number) => {
            const time: number = readAwsTimestamp(timestamp);
            const value: number = Number(values[position]);

            if (Number.isFinite(time) && Number.isFinite(value)) {
              entry.timestamps.push(time);
              entry.values.push(value);
            }
          },
        );

        results.set(id, entry);
      }

      const next: string = readText(response["NextToken"]);

      if (!next || next === nextToken) {
        break;
      }

      nextToken = next;
    }
  }

  return Array.from(results.values()).filter(
    (result: AwsMetricResult): boolean => {
      return result.timestamps.length > 0;
    },
  );
}

/*
 * THE UNIT A METRIC'S DATAPOINTS CARRY (#9809).
 *
 * ListMetrics names no unit, and GetMetricData answers values without one.
 * But GetMetricData answers a query that names a unit (MetricStat.Unit) only
 * with the data published with that unit: so one call with a query per
 * unit of CloudWatch's list (AWS_CLOUDWATCH_UNITS) - its sample count a day
 * over the last AWS_UNIT_LOOK_BACK_DAYS - says which unit the metric's
 * datapoints carry: the one whose query has data, the most samples where
 * a metric was published with two. It is the one call the connection's
 * role allows (GetMetricStatistics, whose datapoints name their unit, is
 * not in it), and costs 27 metrics read, about $0.0003. "" when no query
 * has data: nothing published in that time.
 */
export async function findAwsMetricUnit(
  options: AwsCloudWatchOptions,
  data: {
    namespace: string;
    metricName: string;
    dimensions: Array<AwsMetricDimension>;
    now: Date;
  },
): Promise<string> {
  const end: Date = data.now;
  const start: Date = new Date(
    end.getTime() - AWS_UNIT_LOOK_BACK_DAYS * DAY_SECONDS * 1000,
  );
  const results: Array<AwsMetricResult> = await getMetricData(options, {
    queries: AWS_CLOUDWATCH_UNITS.map(
      (unit: string, index: number): AwsMetricQuery => {
        return {
          id: `u${index}`,
          namespace: data.namespace,
          metricName: data.metricName,
          dimensions: data.dimensions,
          statistic: "SampleCount",
          periodSeconds: DAY_SECONDS,
          unit,
        };
      },
    ),
    startTime: start,
    endTime: end,
  });

  return pickAwsMetricUnit(results);
}

/*
 * Of a unit probe's answers (findAwsMetricUnit), the unit with the most
 * samples; "" when none has any. Each answer's id is "u" and the unit's
 * place in AWS_CLOUDWATCH_UNITS.
 */
export function pickAwsMetricUnit(
  results: ReadonlyArray<AwsMetricResult>,
): string {
  let best: string = "";
  let most: number = 0;

  for (const result of results) {
    const unit: string | undefined =
      AWS_CLOUDWATCH_UNITS[Number(result.id.slice(1))];
    const samples: number = result.values.reduce(
      (sum: number, value: number): number => {
        return sum + (Number.isFinite(value) && value > 0 ? value : 0);
      },
      0,
    );

    if (unit && result.id.startsWith("u") && samples > most) {
      most = samples;
      best = unit;
    }
  }

  return best;
}

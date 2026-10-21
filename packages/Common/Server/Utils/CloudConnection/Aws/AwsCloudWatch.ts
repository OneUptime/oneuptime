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
 *                    NextToken } -> { Metrics: [{ Namespace, MetricName,
 *                    Dimensions: [{ Name, Value }] }], NextToken }
 *                    Free within the account's million free API calls a
 *                    month.
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
}

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
 * last three hours. firstPageOnly answers "does the namespace have any" in
 * one call.
 */
export async function listMetrics(
  options: AwsCloudWatchOptions,
  data: {
    namespace: string;
    metricName?: string | undefined;
    firstPageOnly?: boolean | undefined;
  },
): Promise<Array<AwsListedMetric>> {
  const metrics: Array<AwsListedMetric> = [];
  let nextToken: string = "";

  for (let page: number = 0; page < MAX_LIST_PAGES; page++) {
    const payload: JSONObject = {
      Namespace: data.namespace,
      RecentlyActive: "PT3H",
    };

    if (data.metricName) {
      payload["MetricName"] = data.metricName;
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

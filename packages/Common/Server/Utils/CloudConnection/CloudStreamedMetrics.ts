import {
  AWS_KEY_METRICS,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  DAILY_PERIOD_SECONDS,
  getAwsStoredMetricName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { getStreamedMetricKey } from "../../../Types/CloudConnection/CloudStream";
import { JSONArray, JSONObject } from "../../../Types/JSON";

/*
 * WHAT A CONNECTION'S READ NO LONGER WRITES WHILE A STREAM DELIVERS IT.
 *
 * A read of an AWS connection reads each resource's key metrics from
 * CloudWatch (CloudKeyMetrics) and writes them as gauges. A metric stream
 * of the same account delivers the same metrics a minute at a time
 * (CloudStream), so for every account, Region and namespace a stream
 * delivered lately (getStreamedMetricKeys) the read's datapoints are left
 * out of what it writes: each series is then written once, by the stream.
 *
 * The read still reads them, and still judges each resource's health from
 * them (CloudResourceReadings reads the read's own payloads), so a
 * resource's health reads the same whether its account streams or not. A
 * metric CloudWatch publishes once a day (S3's storage) never comes through
 * a stream, so the read keeps writing it. When a stream goes quiet the
 * read writes everything again.
 */

const DAILY_KEY_METRICS: ReadonlySet<string> = new Set<string>(
  (AWS_KEY_METRICS as ReadonlyArray<AwsNamespaceKeyMetrics>).flatMap(
    (namespace: AwsNamespaceKeyMetrics): Array<string> => {
      return namespace.metrics
        .filter((metric: AwsKeyMetric): boolean => {
          return metric.periodSeconds >= DAILY_PERIOD_SECONDS;
        })
        .map((metric: AwsKeyMetric): string => {
          return getAwsStoredMetricName(
            namespace.namespace,
            metric.metricName,
          ).toLowerCase();
        });
    },
  ),
);

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): JSONArray {
  return Array.isArray(value) ? (value as JSONArray) : [];
}

function readStringAttribute(attributes: JSONArray, key: string): string {
  for (const raw of attributes) {
    const attribute: JSONObject = readObject(raw);

    if (attribute["key"] === key) {
      const value: unknown = readObject(attribute["value"])["stringValue"];
      return typeof value === "string" ? value : "";
    }
  }

  return "";
}

/*
 * One read payload ({ resourceMetrics: [...] }) without the datapoints of
 * the streamed namespaces, and how many it left out. Null when nothing is
 * left to write. The payload given is not changed.
 */
export function withoutStreamedMetrics(data: {
  payload: JSONObject;
  streamedKeys: ReadonlySet<string>;
}): { payload: JSONObject | null; leftOut: number } {
  if (data.streamedKeys.size === 0) {
    return { payload: data.payload, leftOut: 0 };
  }

  let leftOut: number = 0;
  const keptResources: Array<JSONObject> = [];

  for (const rawResource of readArray(data.payload["resourceMetrics"])) {
    const resourceMetrics: JSONObject = readObject(rawResource);
    const resourceAttributes: JSONArray = readArray(
      readObject(resourceMetrics["resource"])["attributes"],
    );
    const accountId: string = readStringAttribute(
      resourceAttributes,
      "cloud.account.id",
    );
    const region: string = readStringAttribute(
      resourceAttributes,
      "cloud.region",
    );

    const isStreamed: (point: unknown) => boolean = (
      point: unknown,
    ): boolean => {
      const namespace: string = readStringAttribute(
        readArray(readObject(point)["attributes"]),
        "Namespace",
      );

      return (
        Boolean(namespace) &&
        data.streamedKeys.has(
          getStreamedMetricKey({ accountId, region, namespace }),
        )
      );
    };

    const keptScopes: Array<JSONObject> = [];

    for (const rawScope of readArray(resourceMetrics["scopeMetrics"])) {
      const scope: JSONObject = readObject(rawScope);
      const keptMetrics: Array<JSONObject> = [];

      for (const rawMetric of readArray(scope["metrics"])) {
        const metric: JSONObject = readObject(rawMetric);
        const name: string =
          typeof metric["name"] === "string" ? metric["name"] : "";
        const shape: "gauge" | "sum" | null = metric["gauge"]
          ? "gauge"
          : metric["sum"]
            ? "sum"
            : null;

        if (!shape || DAILY_KEY_METRICS.has(name.toLowerCase())) {
          keptMetrics.push(metric);
          continue;
        }

        const series: JSONObject = readObject(metric[shape]);
        const points: JSONArray = readArray(series["dataPoints"]);
        const keptPoints: JSONArray = points.filter(
          (point: unknown): boolean => {
            return !isStreamed(point);
          },
        );

        leftOut += points.length - keptPoints.length;

        if (keptPoints.length > 0) {
          keptMetrics.push({
            ...metric,
            [shape]: { ...series, dataPoints: keptPoints },
          });
        }
      }

      if (keptMetrics.length > 0) {
        keptScopes.push({
          ...scope,
          metrics: keptMetrics as unknown as JSONArray,
        });
      }
    }

    if (keptScopes.length > 0) {
      keptResources.push({
        ...resourceMetrics,
        scopeMetrics: keptScopes as unknown as JSONArray,
      });
    }
  }

  return {
    payload:
      keptResources.length > 0
        ? {
            ...data.payload,
            resourceMetrics: keptResources as unknown as JSONArray,
          }
        : null,
    leftOut,
  };
}

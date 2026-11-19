import {
  AwsKeyMetric,
  getAwsKeyMetricOfStoredName,
  isAzureStreamedKeyMetricStoredName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { getStreamedMetricKey } from "../../../Types/CloudConnection/CloudStream";
import {
  AwsStreamCoverage,
  NO_AWS_STREAM_COVERAGE,
  isAwsKeyMetricLeftToStream,
} from "../../../Types/CloudConnection/CloudStreamStack";
import { JSONArray, JSONObject } from "../../../Types/JSON";

/*
 * WHAT A CONNECTION'S READ NO LONGER WRITES WHILE A STREAM DELIVERS IT.
 *
 * A read of an AWS connection reads each resource's key metrics from
 * CloudWatch (CloudKeyMetrics) and writes them as gauges. A metric stream
 * of the same account delivers them a minute at a time (CloudStream), so
 * each key metric a stream writes in the read's place - its stack carries
 * it, and it delivered the metric's account, Region and namespace lately
 * (CloudStreamStack, AwsStreamCoverage) - is left out of what the read
 * writes: each series is then written once, by the stream.
 *
 * The read does not even read most of them (AwsCloudConnector): only those
 * a resource's health or headline is judged from, which it still judges
 * from its own payloads (CloudResourceReadings), so a resource's health
 * reads the same whether its account streams or not. A metric no stream
 * carries (S3's daily storage, ACM's days to expiry), and a key metric
 * added since the stack's template (AwsKeyMetric.streamedSince), are
 * written by the read as if the account did not stream. When a stream goes
 * quiet the read writes everything again.
 *
 * An Azure connection's read is the same, by subscription, region and
 * resource type (an Azure stream's "namespaces"): for each type its event
 * hubs delivered lately, the read leaves out the key metrics the stream
 * writes in its place (AzureDiagnosticRecords) - those it reads a minute at
 * a time (timegrain PT1M) that a diagnostic setting exports
 * (isAzureStreamedKeyMetricStoredName). It keeps writing the rest, which no
 * stream delivers:
 *
 *   - a metric read at a coarser grain: an hourly storage capacity;
 *   - one a diagnostic setting cannot export, "DS Export: No" in
 *     Microsoft's tables (notExportedByDiagnosticSettings): a virtual
 *     machine's network totals, a Cosmos DB account's requests;
 *   - every metric of a Service Bus or Event Hubs namespace, which the read
 *     splits by queue, topic and event hub (EntityName): those series are
 *     the namespace's, its totals add them up, and a diagnostic setting
 *     sends only the namespace's total of a metric - so the stream writes
 *     none of them, and no queue's messages are counted twice.
 *
 * What the read keeps it writes unchanged, on its resource: a streamed
 * type's metric a stream cannot deliver still reaches the resource's
 * charts and monitors, and a queue's series still adds to its namespace.
 */

// Azure: the subscription on the read's resources, and the grain a stream writes.
const AZURE_SUBSCRIPTION_ATTRIBUTE: string = "azuremonitor.subscription_id";
export const AZURE_STREAMED_TIME_GRAIN: string = "PT1M";

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
 * One read payload ({ resourceMetrics: [...] }) without the datapoints a
 * stream writes in its place, and how many it left out. Null when nothing
 * is left to write. The payload given is not changed.
 *
 *   - streamedKeys: Azure's subscriptions, regions and resource types its
 *     event hubs delivered lately (getStreamedMetricKeys);
 *   - awsCoverage: AWS's accounts and Regions a stream delivered from
 *     lately, with what each one's stack carries (getAwsStreamCoverage).
 */
export function withoutStreamedMetrics(data: {
  payload: JSONObject;
  streamedKeys: ReadonlySet<string>;
  awsCoverage?: AwsStreamCoverage | undefined;
}): { payload: JSONObject | null; leftOut: number } {
  const awsCoverage: AwsStreamCoverage =
    data.awsCoverage || NO_AWS_STREAM_COVERAGE;

  if (data.streamedKeys.size === 0 && awsCoverage.size === 0) {
    return { payload: data.payload, leftOut: 0 };
  }

  let leftOut: number = 0;
  const keptResources: Array<JSONObject> = [];
  // Each stored name's key metric, looked up once.
  const keyMetrics: Map<
    string,
    { namespace: string; metric: AwsKeyMetric } | null
  > = new Map();
  const keyMetricOf: (
    metricName: string,
  ) => { namespace: string; metric: AwsKeyMetric } | null = (
    metricName: string,
  ): { namespace: string; metric: AwsKeyMetric } | null => {
    if (!keyMetrics.has(metricName)) {
      keyMetrics.set(metricName, getAwsKeyMetricOfStoredName(metricName));
    }

    return keyMetrics.get(metricName) || null;
  };

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
    const subscriptionId: string = readStringAttribute(
      resourceAttributes,
      AZURE_SUBSCRIPTION_ATTRIBUTE,
    );

    const isStreamed: (metricName: string, point: unknown) => boolean = (
      metricName: string,
      point: unknown,
    ): boolean => {
      const pointAttributes: JSONArray = readArray(
        readObject(point)["attributes"],
      );

      if (subscriptionId) {
        const type: string = readStringAttribute(pointAttributes, "type");
        const grain: string = readStringAttribute(pointAttributes, "timegrain");

        return (
          Boolean(type) &&
          grain.toUpperCase() === AZURE_STREAMED_TIME_GRAIN &&
          isAzureStreamedKeyMetricStoredName(type, metricName) &&
          data.streamedKeys.has(
            getStreamedMetricKey({
              accountId: subscriptionId,
              region: readStringAttribute(pointAttributes, "location"),
              namespace: type,
            }),
          )
        );
      }

      const keyMetric: { namespace: string; metric: AwsKeyMetric } | null =
        keyMetricOf(metricName);

      // What the read writes is a key metric; anything else stays the read's.
      return (
        keyMetric !== null &&
        isAwsKeyMetricLeftToStream({
          coverage: awsCoverage,
          accountId,
          region,
          namespace:
            readStringAttribute(pointAttributes, "Namespace") ||
            keyMetric.namespace,
          metric: keyMetric.metric,
        })
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

        if (!shape) {
          keptMetrics.push(metric);
          continue;
        }

        const series: JSONObject = readObject(metric[shape]);
        const points: JSONArray = readArray(series["dataPoints"]);
        const keptPoints: JSONArray = points.filter(
          (point: unknown): boolean => {
            return !isStreamed(name, point);
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

import Dictionary from "../../../Types/Dictionary";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import TelemetryUtil, { AttributeType } from "../Telemetry/Telemetry";

/*
 * OTLP/JSON METRICS, IN THE SHAPE EACH CLOUD'S COLLECTOR RECEIVER SENDS.
 *
 * A cloud connection reads the cloud's monitoring API itself and hands
 * what it read to OneUptime's own metrics ingest, as the request body an
 * OpenTelemetry Collector would have sent: the azure_monitor receiver's
 * resource and datapoint attributes, CloudWatch's Namespace and Dimensions,
 * Cloud Monitoring's monitored resource on the OTel resource. So everything
 * the ingest does with a collector's metrics - drop filters, scrub and
 * pipeline rules, retention, finding the cloud resource each datapoint is
 * about (CloudMonitoredResource) - it does with these, and a resource's
 * pages read them the same either way.
 *
 * Every OTel resource also carries the connection's telemetry service
 * (service.name) and the connection's id.
 */

export const CLOUD_CONNECTION_ID_ATTRIBUTE: string =
  "oneuptime.cloud.connection.id";
export const CLOUD_CONNECTION_SCOPE_NAME: string = "oneuptime-cloud-connection";
export const CLOUD_CONNECTION_SCOPE_VERSION: string = "1.0.0";

// Datapoints in one ingest request at most; more are split across several.
export const MAX_DATAPOINTS_PER_PAYLOAD: number = 2000;

export interface OtlpAttribute {
  key: string;
  value: JSONObject;
}

export interface CloudMetricPoint {
  timeMs: number;
  value: number;
}

export interface CloudMetricDatapointSet {
  attributes: Array<OtlpAttribute>;
  points: Array<CloudMetricPoint>;
}

export interface CloudMetric {
  name: string;
  unit: string;
  datapointSets: Array<CloudMetricDatapointSet>;
}

// One OTel resource and its metrics.
export interface CloudMetricGroup {
  resourceAttributes: Array<OtlpAttribute>;
  metrics: Array<CloudMetric>;
}

export function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

export function kvlistAttribute(
  key: string,
  values: Array<OtlpAttribute>,
): OtlpAttribute {
  return {
    key,
    value: {
      kvlistValue: { values: values as unknown as JSONArray },
    },
  };
}

// The attributes every resource of a connection's export carries.
export function connectionResourceAttributes(data: {
  serviceName: string;
  connectionId: string;
  cloudProvider: string;
}): Array<OtlpAttribute> {
  return [
    stringAttribute("service.name", data.serviceName),
    stringAttribute("cloud.provider", data.cloudProvider),
    stringAttribute(CLOUD_CONNECTION_ID_ATTRIBUTE, data.connectionId),
  ];
}

function toUnixNano(timeMs: number): string {
  return `${Math.floor(timeMs)}000000`;
}

function countPoints(group: CloudMetricGroup): number {
  let count: number = 0;

  for (const metric of group.metrics) {
    for (const set of metric.datapointSets) {
      count += set.points.length;
    }
  }

  return count;
}

function toResourceMetrics(group: CloudMetricGroup): JSONObject {
  return {
    resource: {
      attributes: group.resourceAttributes as unknown as JSONArray,
    },
    scopeMetrics: [
      {
        scope: {
          name: CLOUD_CONNECTION_SCOPE_NAME,
          version: CLOUD_CONNECTION_SCOPE_VERSION,
        },
        metrics: group.metrics
          .filter((metric: CloudMetric): boolean => {
            return metric.datapointSets.some(
              (set: CloudMetricDatapointSet): boolean => {
                return set.points.length > 0;
              },
            );
          })
          .map((metric: CloudMetric): JSONObject => {
            const dataPoints: Array<JSONObject> = [];

            for (const set of metric.datapointSets) {
              for (const point of set.points) {
                dataPoints.push({
                  startTimeUnixNano: toUnixNano(point.timeMs),
                  timeUnixNano: toUnixNano(point.timeMs),
                  asDouble: point.value,
                  attributes: set.attributes as unknown as JSONArray,
                });
              }
            }

            return {
              name: metric.name,
              unit: metric.unit,
              gauge: { dataPoints: dataPoints as unknown as JSONArray },
            };
          }) as unknown as JSONArray,
      },
    ] as unknown as JSONArray,
  };
}

/*
 * The groups as ingest request bodies ({ resourceMetrics: [...] }), at most
 * MAX_DATAPOINTS_PER_PAYLOAD datapoints each - a group is never split, so
 * one bigger than that is a request of its own. Groups with no datapoint
 * are left out.
 */
export function buildMetricsPayloads(
  groups: Array<CloudMetricGroup>,
): Array<JSONObject> {
  const payloads: Array<JSONObject> = [];
  let current: Array<JSONObject> = [];
  let currentPoints: number = 0;

  for (const group of groups) {
    const points: number = countPoints(group);

    if (points === 0) {
      continue;
    }

    if (
      current.length > 0 &&
      currentPoints + points > MAX_DATAPOINTS_PER_PAYLOAD
    ) {
      payloads.push({ resourceMetrics: current as unknown as JSONArray });
      current = [];
      currentPoints = 0;
    }

    current.push(toResourceMetrics(group));
    currentPoints += points;
  }

  if (current.length > 0) {
    payloads.push({ resourceMetrics: current as unknown as JSONArray });
  }

  return payloads;
}

export function countPayloadPoints(groups: Array<CloudMetricGroup>): number {
  let count: number = 0;

  for (const group of groups) {
    count += countPoints(group);
  }

  return count;
}

/*
 * The attributes of a datapoint as the metrics ingest stores them on its
 * row: the datapoint's own keys bare, the resource's prefixed with
 * `resource.`, a kvlist flattened to `<key>.<nested key>` - the same
 * TelemetryUtil.getAttributes the ingest uses.
 */
export function storedAttributesOf(
  resourceAttributes: Array<OtlpAttribute>,
  datapointAttributes: Array<OtlpAttribute>,
): Dictionary<AttributeType | Array<AttributeType>> {
  return {
    ...TelemetryUtil.getAttributes({
      prefixKeysWithString: "resource",
      items: resourceAttributes as unknown as JSONArray,
    }),
    ...TelemetryUtil.getAttributes({
      prefixKeysWithString: "",
      items: datapointAttributes as unknown as JSONArray,
    }),
  };
}

/*
 * The cloud resource a datapoint with these attributes will be filed under
 * by the ingest: the ingest's own resolver, run on the row the ingest will
 * store. So the resources a read links to its connection are exactly the
 * ones its metrics land on.
 */
export function resolveCloudResourceOf(data: {
  metricName: string;
  resourceAttributes: Array<OtlpAttribute>;
  datapointAttributes: Array<OtlpAttribute>;
}): CloudMonitoredResource | null {
  return resolveCloudMonitoredResource({
    metricName: data.metricName,
    attributes: storedAttributesOf(
      data.resourceAttributes,
      data.datapointAttributes,
    ),
  });
}

import { JSONArray, JSONObject } from "Common/Types/JSON";

/*
 * Reads an OTLP/JSON resource the way a test asks about it: a metric's
 * datapoints with their labels and times, the resource's attributes, the
 * metrics it has.
 */

export interface OtlpPoint {
  value: number;
  labels: Record<string, string>;
  timeMs: number;
}

function labelsOf(attributes: JSONArray | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const attribute of attributes || []) {
    const entry: JSONObject = attribute as JSONObject;
    labels[String(entry["key"])] = String(
      (entry["value"] as JSONObject)["stringValue"],
    );
  }
  return labels;
}

function metricsOf(resource: JSONObject): Array<JSONObject> {
  const scopes: Array<JSONObject> =
    (resource["scopeMetrics"] as Array<JSONObject> | undefined) || [];
  return scopes.flatMap((scope: JSONObject): Array<JSONObject> => {
    return (scope["metrics"] as Array<JSONObject> | undefined) || [];
  });
}

export function metricNames(resource: JSONObject): Array<string> {
  return metricsOf(resource).map((metric: JSONObject): string => {
    return String(metric["name"]);
  });
}

export function pointsOf(resource: JSONObject, name: string): Array<OtlpPoint> {
  const metric: JSONObject | undefined = metricsOf(resource).find(
    (entry: JSONObject): boolean => {
      return entry["name"] === name;
    },
  );
  if (!metric) {
    return [];
  }
  const points: Array<JSONObject> =
    ((metric["gauge"] as JSONObject)["dataPoints"] as Array<JSONObject>) || [];
  return points.map((point: JSONObject): OtlpPoint => {
    return {
      value: Number(point["asDouble"]),
      labels: labelsOf(point["attributes"] as JSONArray),
      timeMs: Number(String(point["timeUnixNano"]).slice(0, -6)),
    };
  });
}

// The one point of a metric whose labels include these, or undefined.
export function pointOf(
  resource: JSONObject,
  name: string,
  labels: Record<string, string> = {},
): OtlpPoint | undefined {
  return pointsOf(resource, name).find((point: OtlpPoint): boolean => {
    return Object.entries(labels).every(([key, value]: [string, string]) => {
      return point.labels[key] === value;
    });
  });
}

export function resourceAttributesOf(
  resource: JSONObject,
): Record<string, string> {
  return labelsOf(
    (resource["resource"] as JSONObject)["attributes"] as JSONArray,
  );
}

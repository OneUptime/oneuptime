import { JSONObject } from "../../../Types/JSON";
import {
  getKvStringValue,
  getKvValue,
} from "../../../Types/Kubernetes/KubernetesObjectParser";

/*
 * ------------------------------------------------------------------
 * KubernetesEventParser
 *
 * Server-side parsing for Kubernetes Event rows stored in the
 * ClickHouse Log table by the k8sobjects receiver (watch mode).
 * The log body is an OTLP kvlistValue blob using events.k8s.io/v1
 * naming: `type` / `reason` / `note` on the event object, and the
 * target resource under `regarding` (v1 core called these `message`
 * and `involvedObject`).
 *
 * Ported from the dashboard-side parsing in
 * App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher.ts
 * so API endpoints can filter events without shipping raw bodies to
 * the browser.
 * ------------------------------------------------------------------
 */

export interface ParsedKubernetesEventLog {
  eventType: string;
  reason: string;
  note: string;
  regardingKind: string;
  regardingName: string;
  regardingNamespace: string;
}

export function parseKubernetesEventLogBody(
  body: string,
): ParsedKubernetesEventLog | null {
  let bodyObj: JSONObject | null = null;
  try {
    bodyObj = JSON.parse(body) as JSONObject;
  } catch {
    return null;
  }

  // Handle both camelCase (JSON encoding) and snake_case (protobuf).
  const topKvList: JSONObject | undefined = (bodyObj["kvlistValue"] ||
    bodyObj["kvlist_value"]) as JSONObject | undefined;
  if (!topKvList) {
    return null;
  }

  const objectVal: string | JSONObject | null = getKvValue(topKvList, "object");
  if (!objectVal || typeof objectVal === "string") {
    return null;
  }
  const objectKvList: JSONObject = objectVal;

  const regardingVal: string | JSONObject | null = getKvValue(
    objectKvList,
    "regarding",
  );
  const regardingKv: JSONObject | undefined =
    regardingVal && typeof regardingVal !== "string" ? regardingVal : undefined;

  return {
    eventType: getKvStringValue(objectKvList, "type"),
    reason: getKvStringValue(objectKvList, "reason"),
    note: getKvStringValue(objectKvList, "note"),
    regardingKind: getKvStringValue(regardingKv, "kind"),
    regardingName: getKvStringValue(regardingKv, "name"),
    regardingNamespace: getKvStringValue(regardingKv, "namespace"),
  };
}

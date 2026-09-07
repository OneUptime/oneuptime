import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import BadDataException from "../../../Types/Exception/BadDataException";
import ColumnLength from "../../../Types/Database/ColumnLength";

export const VMWARE_PREFIX: string = "oneuptime.vmware.";
export const VMWARE_RESOURCE_TYPES: Array<string> = [
  "host",
  "vm",
  "datastore",
  "cluster",
];
export const VMWARE_MAX_RESOURCES_PER_BATCH: number = 10000;
export interface VMwareResourceSnapshot {
  resourceIdentifier: string;
  resourceType: string;
  name: string;
  metadata: JSONObject;
  metrics: JSONObject;
  lastReportedAt: Date;
  lastSeenAt: Date | null;
}
export interface VMwareSourceSnapshot {
  sourceIdentifier: string;
  name: string;
  kind: string | null;
  metrics: JSONObject;
  lastSeenAt: Date;
  lastSuccessfulCollectionAt: Date | null;
  lastCollectionAt: Date | null;
  collectionIntervalSeconds: number | null;
  resources: Array<VMwareResourceSnapshot>;
}

export function validateVMwareIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > ColumnLength.LongText ||
    value !== value.trim()
  ) {
    throw new BadDataException(
      "VMware identity must be a non-empty string of at most 500 characters with no surrounding whitespace.",
    );
  }
  return value;
}

export function vmwareAttributes(attributes: unknown): JSONObject {
  const result: JSONObject = {};
  if (!Array.isArray(attributes)) {
    return result;
  }
  for (const attribute of attributes) {
    if (
      !attribute ||
      typeof attribute.key !== "string" ||
      !attribute.key.startsWith(VMWARE_PREFIX)
    ) {
      continue;
    }
    const value: unknown = attribute.value;
    if (!value || typeof value !== "object") {
      continue;
    }
    const wrapped: JSONObject = value as JSONObject;
    const scalar: JSONValue | undefined =
      wrapped["stringValue"] ??
      wrapped["boolValue"] ??
      wrapped["intValue"] ??
      wrapped["doubleValue"];
    if (
      typeof scalar === "string" ||
      typeof scalar === "boolean" ||
      typeof scalar === "number"
    ) {
      result[attribute.key] = scalar;
    }
  }
  return result;
}

export function getVMwareSourceIdentifier(attributes: unknown): string | null {
  const value: JSONValue | undefined =
    vmwareAttributes(attributes)[`${VMWARE_PREFIX}source.id`];
  return value === undefined ? null : validateVMwareIdentifier(value);
}

/* Fold once per OTLP batch, independently of metric count. No metric allow-list is
 * needed to store telemetry, but resource inventory only consumes the companion contract.
 * Collector failure never deletes inventory or replaces absent metrics with zero. */
export function scanVMwareSnapshots(
  resourceMetrics: JSONArray,
  now: Date = new Date(),
): Array<VMwareSourceSnapshot> {
  const sources: Map<string, VMwareSourceSnapshot> = new Map();
  const resources: Map<string, VMwareResourceSnapshot> = new Map();
  const metricTimes: Map<string, number> = new Map();
  const sourceMetadataTimes: Map<string, number> = new Map();
  const sourceHealth: Map<
    string,
    { sourceIdentifier: string; time: number; up?: number; complete?: number }
  > = new Map();
  for (const raw of resourceMetrics) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const resourceMetric: JSONObject = raw as JSONObject;
    const attributes: JSONObject = vmwareAttributes(
      (resourceMetric["resource"] as JSONObject | undefined)?.["attributes"],
    );
    const rawSource: JSONValue | undefined =
      attributes[`${VMWARE_PREFIX}source.id`];
    if (rawSource === undefined) {
      continue;
    }
    const sourceIdentifier: string = validateVMwareIdentifier(rawSource);
    const type: JSONValue | undefined =
      attributes[`${VMWARE_PREFIX}resource.type`];
    const rawId: JSONValue | undefined =
      attributes[`${VMWARE_PREFIX}resource.id`];
    let source: VMwareSourceSnapshot | undefined =
      sources.get(sourceIdentifier);
    const name: string = String(
      attributes[`${VMWARE_PREFIX}source.name`] || sourceIdentifier,
    ).slice(0, ColumnLength.LongText);
    const kind: JSONValue | undefined =
      attributes[`${VMWARE_PREFIX}source.kind`];
    // Only a validated numeric VMware sample establishes source liveness.
    const scopes: JSONValue | undefined = resourceMetric["scopeMetrics"];
    if (!Array.isArray(scopes)) {
      continue;
    }
    for (const scope of scopes) {
      const metrics: JSONValue | undefined = (scope as JSONObject)?.["metrics"];
      if (!Array.isArray(metrics)) {
        continue;
      }
      for (const rawMetric of metrics) {
        const metric: JSONObject = rawMetric as JSONObject;
        const metricName: JSONValue | undefined = metric?.["name"];
        if (
          typeof metricName !== "string" ||
          !(
            metricName.startsWith(VMWARE_PREFIX) ||
            metricName.startsWith("vcenter.")
          )
        ) {
          continue;
        }
        const points: JSONValue | undefined = (
          (metric["gauge"] || metric["sum"]) as JSONObject | undefined
        )?.["dataPoints"];
        if (!Array.isArray(points)) {
          continue;
        }
        for (const rawPoint of points) {
          const point: JSONObject = rawPoint as JSONObject;
          const value: number = Number(
            point?.["asDouble"] ?? point?.["asInt"] ?? NaN,
          );
          const time: number = Number(point?.["timeUnixNano"]) / 1e6;
          if (
            !Number.isFinite(value) ||
            !Number.isFinite(time) ||
            time <= 0 ||
            time > now.getTime() + 300000
          ) {
            continue;
          }
          if (!source) {
            if (sources.size >= 100) {
              throw new BadDataException(
                "Too many VMware sources in one telemetry batch (maximum 100).",
              );
            }
            source = {
              sourceIdentifier,
              name,
              kind: null,
              metrics: {},
              lastSeenAt: new Date(time),
              lastSuccessfulCollectionAt: null,
              lastCollectionAt: null,
              collectionIntervalSeconds: null,
              resources: [],
            };
            sources.set(sourceIdentifier, source);
          }
          // Stock receiver data may precede the companion in the same export.
          // Fill known source metadata from the newest companion values, without
          // letting absent attributes on stock data erase that information.
          if (metricName.startsWith(VMWARE_PREFIX)) {
            const kindKey: string = JSON.stringify([sourceIdentifier, "kind"]);
            if (
              (kind === "esxi" || kind === "vcenter") &&
              time >= (sourceMetadataTimes.get(kindKey) ?? 0)
            ) {
              source.kind = kind;
              sourceMetadataTimes.set(kindKey, time);
            }
            const interval: number = Number(
              attributes[`${VMWARE_PREFIX}source.collection_interval_seconds`],
            );
            const intervalKey: string = JSON.stringify([
              sourceIdentifier,
              "interval",
            ]);
            if (
              Number.isInteger(interval) &&
              interval >= 10 &&
              interval <= 86400 &&
              time >= (sourceMetadataTimes.get(intervalKey) ?? 0)
            ) {
              source.collectionIntervalSeconds = interval;
              sourceMetadataTimes.set(intervalKey, time);
            }
          }
          if (time > source.lastSeenAt.getTime()) {
            source.lastSeenAt = new Date(time);
          }
          if (metricName.startsWith(`${VMWARE_PREFIX}source.`)) {
            const healthKey: string = JSON.stringify([sourceIdentifier, time]);
            const health: {
              sourceIdentifier: string;
              time: number;
              up?: number;
              complete?: number;
            } = sourceHealth.get(healthKey) || { sourceIdentifier, time };
            if (metricName === `${VMWARE_PREFIX}source.up`) {
              health.up = value;
            }
            if (metricName === `${VMWARE_PREFIX}source.inventory.complete`) {
              health.complete = value;
            }
            sourceHealth.set(healthKey, health);

            const key: string = JSON.stringify([sourceIdentifier, metricName]);
            if (time >= (metricTimes.get(key) ?? 0)) {
              if (
                source.lastCollectionAt &&
                time < source.lastCollectionAt.getTime()
              ) {
                continue;
              }
              if (
                source.lastCollectionAt &&
                time > source.lastCollectionAt.getTime()
              ) {
                source.metrics = {};
              }
              source.metrics[metricName] = value;
              metricTimes.set(key, time);
              if (
                !source.lastCollectionAt ||
                time > source.lastCollectionAt.getTime()
              ) {
                source.lastCollectionAt = new Date(time);
              }
            }
            continue;
          }
          if (!metricName.startsWith(VMWARE_PREFIX)) {
            continue;
          }
          if (
            typeof type !== "string" ||
            !VMWARE_RESOURCE_TYPES.includes(type) ||
            rawId === undefined
          ) {
            continue;
          }
          const resourceIdentifier: string = validateVMwareIdentifier(rawId);
          const resourceKey: string = JSON.stringify([
            sourceIdentifier,
            type,
            resourceIdentifier,
          ]);
          let resource: VMwareResourceSnapshot | undefined =
            resources.get(resourceKey);
          if (!resource) {
            if (resources.size >= VMWARE_MAX_RESOURCES_PER_BATCH) {
              throw new BadDataException(
                "Too many VMware resources in one telemetry batch (maximum 10000).",
              );
            }
            resource = {
              resourceIdentifier,
              resourceType: type,
              name: String(
                attributes[`${VMWARE_PREFIX}resource.name`] ||
                  resourceIdentifier,
              ).slice(0, ColumnLength.LongText),
              metadata: attributes,
              metrics: {},
              lastReportedAt: new Date(time),
              lastSeenAt:
                attributes[`${VMWARE_PREFIX}resource.observed`] === true
                  ? new Date(time)
                  : null,
            };
            resources.set(resourceKey, resource);
            source.resources.push(resource);
          }
          // Last actual observation is independent of snapshot ordering: a
          // delayed observed point can fill history even after an unknown report.
          if (
            attributes[`${VMWARE_PREFIX}resource.observed`] === true &&
            (!resource.lastSeenAt || time > resource.lastSeenAt.getTime())
          ) {
            resource.lastSeenAt = new Date(time);
          }
          if (time < resource.lastReportedAt.getTime()) {
            continue;
          }
          if (time > resource.lastReportedAt.getTime()) {
            resource.metrics = {};
          }
          if (time >= resource.lastReportedAt.getTime()) {
            resource.lastReportedAt = new Date(time);
            resource.metadata = attributes;
            resource.name = String(
              attributes[`${VMWARE_PREFIX}resource.name`] || resourceIdentifier,
            ).slice(0, ColumnLength.LongText);
            if (attributes[`${VMWARE_PREFIX}resource.observed`] === true) {
              resource.lastSeenAt = new Date(time);
            }
          }
          const metricKey: string = JSON.stringify([resourceKey, metricName]);
          if (time >= (metricTimes.get(metricKey) ?? 0)) {
            resource.metrics[metricName] = value;
            metricTimes.set(metricKey, time);
          }
        }
      }
    }
  }
  for (const health of sourceHealth.values()) {
    const source: VMwareSourceSnapshot | undefined = sources.get(
      health.sourceIdentifier,
    );
    if (
      source &&
      health.up === 1 &&
      health.complete === 1 &&
      (!source.lastSuccessfulCollectionAt ||
        health.time > source.lastSuccessfulCollectionAt.getTime())
    ) {
      source.lastSuccessfulCollectionAt = new Date(health.time);
    }
  }
  return [...sources.values()];
}

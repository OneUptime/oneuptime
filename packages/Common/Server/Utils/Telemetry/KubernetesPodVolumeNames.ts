import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * A POD'S VOLUME UNDER THE NAMES ONEUPTIME READS (#10055).
 *
 * The kubelet receiver names a pod's volume k8s.volume.name and
 * k8s.volume.type, and sends its usage as k8s.volume.available, .capacity,
 * .inodes, .inodes.free and .inodes.used. Semantic conventions renamed the
 * two attributes k8s.pod.volume.name and k8s.pod.volume.type
 * (semantic-conventions#4272), and name the series k8s.pod.volume.available,
 * .capacity, .inode.count, .inode.free and .inode.used, up-down counters. The
 * receiver is to follow, by default or behind a feature gate, and may send
 * both names for a while.
 *
 * OneUptime reads the receiver's names everywhere: ingest files a claim's
 * usage from them (OtelMetricsIngestService, KubernetesEphemeralVolumeClaims),
 * PVC Almost Full and the claims pages query them, and a pod's page names its
 * volumes by k8s.volume.name. So before a volume's rows are built, ingest puts
 * it under those names, once:
 *
 *   - its name and type: k8s.volume.name and k8s.volume.type take
 *     k8s.pod.volume.name's and k8s.pod.volume.type's values, which stay on
 *     the resource as they came. Where both names are sent and differ, the
 *     semantic conventions one wins: it is the pod spec's type, where a
 *     receiver that reads the PersistentVolume (k8s_api_config) puts the
 *     disk's in k8s.volume.type.
 *   - each reading: a series sent only under its semantic conventions name is
 *     stored under the receiver's, as the receiver sends it (a gauge, in its
 *     unit); one sent under both names is the same reading twice, and is
 *     stored once, under the receiver's name, so nothing counts it twice.
 *     k8s.pod.volume.usage, which has no other name, goes on as it came.
 *
 * Pure and in place: what is put here is what the rows are built from.
 */

// Each attribute semantic conventions name, and the receiver's name for it.
export const KUBERNETES_POD_VOLUME_ATTRIBUTE_NAMES: Readonly<
  Record<string, string>
> = {
  "k8s.pod.volume.name": "k8s.volume.name",
  "k8s.pod.volume.type": "k8s.volume.type",
};

/*
 * Each series semantic conventions name, and the receiver's name and unit for
 * it (receiver/kubeletstatsreceiver metadata.yaml).
 */
export const KUBERNETES_POD_VOLUME_METRIC_NAMES: Readonly<
  Record<string, { name: string; unit: string }>
> = {
  "k8s.pod.volume.available": { name: "k8s.volume.available", unit: "By" },
  "k8s.pod.volume.capacity": { name: "k8s.volume.capacity", unit: "By" },
  "k8s.pod.volume.inode.count": { name: "k8s.volume.inodes", unit: "1" },
  "k8s.pod.volume.inode.free": { name: "k8s.volume.inodes.free", unit: "1" },
  "k8s.pod.volume.inode.used": { name: "k8s.volume.inodes.used", unit: "1" },
};

const POD_VOLUME_PREFIX: string = "k8s.pod.volume.";

function own<T>(table: Readonly<Record<string, T>>, key: string): T | null {
  return Object.prototype.hasOwnProperty.call(table, key)
    ? (table[key] as T)
    : null;
}

function keyOf(entry: JSONValue | undefined): string {
  const key: JSONValue | undefined =
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as JSONObject)["key"]
      : undefined;
  return typeof key === "string" ? key : "";
}

function stringValueOf(entry: JSONValue | undefined): string | null {
  const value: JSONValue | undefined = (
    (entry as JSONObject | undefined)?.["value"] as JSONObject | undefined
  )?.["stringValue"];
  return typeof value === "string" && value.trim() ? value : null;
}

// A JSON value as an OTLP list, or an empty one when it is none.
function listOf(value: JSONValue | undefined): JSONArray {
  return Array.isArray(value) ? (value as JSONArray) : [];
}

function metricsOf(scopeMetric: JSONValue | undefined): JSONArray {
  return listOf((scopeMetric as JSONObject | undefined)?.["metrics"]);
}

function nameOf(metric: JSONValue | undefined): string {
  const name: JSONValue | undefined = (metric as JSONObject | undefined)?.[
    "name"
  ];
  return typeof name === "string" ? name : "";
}

/*
 * The volume's name and type under the receiver's names. True when it wrote
 * one.
 */
function stampAttributes(attributes: JSONArray): boolean {
  let stamped: boolean = false;

  for (const [podVolumeKey, receiverKey] of Object.entries(
    KUBERNETES_POD_VOLUME_ATTRIBUTE_NAMES,
  )) {
    const value: string | null = stringValueOf(
      attributes.find((entry: JSONValue): boolean => {
        return keyOf(entry) === podVolumeKey;
      }),
    );
    if (value === null) {
      continue;
    }

    const existing: Array<JSONValue> = attributes.filter(
      (entry: JSONValue): boolean => {
        return keyOf(entry) === receiverKey;
      },
    );
    if (existing.length === 1 && stringValueOf(existing[0]) === value) {
      continue;
    }

    for (let i: number = attributes.length - 1; i >= 0; i--) {
      if (keyOf(attributes[i]) === receiverKey) {
        attributes.splice(i, 1);
      }
    }
    attributes.push({ key: receiverKey, value: { stringValue: value } });
    stamped = true;
  }

  return stamped;
}

/*
 * A semantic conventions series as the receiver sends it: under its name, in
 * its unit, a gauge of the same points.
 */
function toReceiverSeries(
  metric: JSONObject,
  receiver: { name: string; unit: string },
): void {
  metric["name"] = receiver.name;
  metric["unit"] = receiver.unit;

  const sum: JSONValue | undefined = metric["sum"];
  if (sum && typeof sum === "object" && !Array.isArray(sum)) {
    const dataPoints: JSONValue | undefined = (sum as JSONObject)["dataPoints"];
    metric["gauge"] = {
      dataPoints: Array.isArray(dataPoints) ? dataPoints : [],
    };
    delete metric["sum"];
  }
}

/*
 * Each reading under the receiver's name, once. True when it renamed or
 * dropped one.
 */
function fileReadings(scopeMetrics: JSONArray): boolean {
  const sent: Set<string> = new Set<string>();
  for (const scopeMetric of scopeMetrics) {
    for (const metric of metricsOf(scopeMetric)) {
      sent.add(nameOf(metric));
    }
  }

  let changed: boolean = false;
  // The receiver's names already filed for this volume, sent or renamed.
  const filed: Set<string> = new Set<string>(sent);

  for (const scopeMetric of scopeMetrics) {
    const metrics: JSONArray = metricsOf(scopeMetric);
    for (let i: number = 0; i < metrics.length; i++) {
      const metric: JSONValue | undefined = metrics[i];
      const receiver: { name: string; unit: string } | null = own(
        KUBERNETES_POD_VOLUME_METRIC_NAMES,
        nameOf(metric),
      );
      if (!receiver || !metric || typeof metric !== "object") {
        continue;
      }

      if (filed.has(receiver.name)) {
        // The same reading under both names: stored once, as the receiver's.
        metrics.splice(i, 1);
        i--;
      } else {
        toReceiverSeries(metric as JSONObject, receiver);
        filed.add(receiver.name);
      }
      changed = true;
    }
  }

  return changed;
}

/*
 * Puts a pod volume's resource (an OTLP ResourceMetrics) under the names
 * OneUptime reads, in place: its name and type, and each of its readings,
 * once. True when it changed anything; a resource that names no volume the
 * semantic conventions way goes on as it came.
 */
export function fileKubernetesPodVolumeUnderReceiverNames(
  resourceMetric: JSONObject | null | undefined,
): boolean {
  if (!resourceMetric || typeof resourceMetric !== "object") {
    return false;
  }

  const resource: JSONValue | undefined = resourceMetric["resource"];
  const attributes: JSONArray = listOf(
    resource && typeof resource === "object" && !Array.isArray(resource)
      ? (resource as JSONObject)["attributes"]
      : undefined,
  );
  const scopeMetrics: JSONArray = listOf(resourceMetric["scopeMetrics"]);

  const hasPodVolumeAttribute: boolean = attributes.some(
    (entry: JSONObject): boolean => {
      return keyOf(entry).startsWith(POD_VOLUME_PREFIX);
    },
  );
  const hasPodVolumeSeries: boolean = scopeMetrics.some(
    (scopeMetric: JSONObject): boolean => {
      return metricsOf(scopeMetric).some((metric: JSONObject): boolean => {
        return own(KUBERNETES_POD_VOLUME_METRIC_NAMES, nameOf(metric)) !== null;
      });
    },
  );

  let changed: boolean = false;
  if (hasPodVolumeAttribute) {
    changed = stampAttributes(attributes) || changed;
  }
  if (hasPodVolumeSeries) {
    changed = fileReadings(scopeMetrics) || changed;
  }
  return changed;
}

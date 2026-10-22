import { JSONObject } from "../../Types/JSON";
import {
  ParsedKubernetesEvent,
  getKubernetesEventLogAttributes,
  parseKubernetesEventFromLogBody,
} from "../../Types/Kubernetes/KubernetesEvent";

/*
 * KUBERNETES EVENTS AS THE AGENT SENDS THEM, FOR TESTS.
 *
 * The Kubernetes agent's k8sobjects receiver watches the Event API and sends
 * each change as a log record whose body is the watch event - {type, object}
 * - as an OTLP AnyValue. These builders write those bodies (and the rows
 * ingest stores them as), so the parser, the ingest, the Dashboard's pages
 * and the browser fixtures all read the same records.
 *
 * ISSUE_5179_EVENTS are the Events of the customer's report (issue #5179),
 * as the Azure portal listed them: kernel-monitor's OOMKilling on AKS nodes,
 * and the horizontal-pod-autoscaler's FailedGetResourceMetric and
 * FailedComputeMetricsReplicas on HPAs in aks-istio-system and
 * app-routing-system.
 */

export type PlainValue =
  | string
  | number
  | boolean
  | null
  | Array<PlainValue>
  | { [key: string]: PlainValue };

// A plain value as an OTLP AnyValue, the way the collector's JSON encoder writes it.
export function toOtlpAnyValue(value: PlainValue): JSONObject {
  if (value === null) {
    return {};
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item: PlainValue): JSONObject => {
          return toOtlpAnyValue(item);
        }),
      },
    };
  }

  if (typeof value === "object") {
    return {
      kvlistValue: {
        values: Object.keys(value).map((key: string): JSONObject => {
          return { key: key, value: toOtlpAnyValue(value[key]!) };
        }),
      },
    };
  }

  if (typeof value === "number") {
    // int64 is a string in OTLP/JSON.
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }

  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  return { stringValue: value };
}

export interface KubernetesEventFields {
  uid: string;
  name: string;
  namespace: string;
  type: "Warning" | "Normal" | string;
  reason: string;
  message: string;
  object: {
    kind: string;
    name: string;
    namespace?: string | undefined;
    uid?: string | undefined;
    apiVersion?: string | undefined;
    fieldPath?: string | undefined;
  };
  // kernel-monitor, horizontal-pod-autoscaler, kubelet.
  controller?: string | undefined;
  // Usually the node that reported it.
  instance?: string | undefined;
  count?: number | undefined;
  firstSeen: string;
  lastSeen: string;
  // Writes the repeats as an events.k8s.io series rather than deprecatedCount.
  asSeries?: boolean | undefined;
  action?: string | undefined;
}

// An Event as events.k8s.io/v1 serves it, which the agent watches.
export function kubernetesEventObject(fields: KubernetesEventFields): {
  [key: string]: PlainValue;
} {
  const regarding: { [key: string]: PlainValue } = {
    kind: fields.object.kind,
    name: fields.object.name,
  };

  if (fields.object.namespace) {
    regarding["namespace"] = fields.object.namespace;
  }

  regarding["uid"] = fields.object.uid || `${fields.object.name}-uid`;

  if (fields.object.apiVersion) {
    regarding["apiVersion"] = fields.object.apiVersion;
  }

  if (fields.object.fieldPath) {
    regarding["fieldPath"] = fields.object.fieldPath;
  }

  const event: { [key: string]: PlainValue } = {
    apiVersion: "events.k8s.io/v1",
    kind: "Event",
    metadata: {
      name: fields.name,
      namespace: fields.namespace,
      uid: fields.uid,
      resourceVersion: "4182736",
      creationTimestamp: fields.firstSeen,
      managedFields: [
        {
          manager: fields.controller || "kubelet",
          operation: "Update",
          apiVersion: "v1",
          time: fields.lastSeen,
        },
      ],
    },
    eventTime: null,
    reportingController: fields.controller || "",
    reportingInstance: fields.instance || "",
    action: fields.action || "",
    reason: fields.reason,
    regarding: regarding,
    note: fields.message,
    type: fields.type,
    deprecatedSource: {
      component: fields.controller || "",
      host: fields.instance || "",
    },
    deprecatedFirstTimestamp: fields.firstSeen,
    deprecatedLastTimestamp: fields.lastSeen,
  };

  if (fields.asSeries && (fields.count || 1) > 1) {
    event["series"] = {
      count: fields.count || 1,
      lastObservedTime: fields.lastSeen,
    };
  } else {
    event["deprecatedCount"] = fields.count || 1;
  }

  return event;
}

// The same Event as core/v1 serves it: what a collector watching the core API sends.
export function coreV1EventObject(fields: KubernetesEventFields): {
  [key: string]: PlainValue;
} {
  return {
    apiVersion: "v1",
    kind: "Event",
    metadata: {
      name: fields.name,
      namespace: fields.namespace,
      uid: fields.uid,
      creationTimestamp: fields.firstSeen,
    },
    involvedObject: {
      kind: fields.object.kind,
      name: fields.object.name,
      ...(fields.object.namespace
        ? { namespace: fields.object.namespace }
        : {}),
      uid: fields.object.uid || `${fields.object.name}-uid`,
      ...(fields.object.fieldPath
        ? { fieldPath: fields.object.fieldPath }
        : {}),
    },
    reason: fields.reason,
    message: fields.message,
    source: {
      component: fields.controller || "",
      ...(fields.instance ? { host: fields.instance } : {}),
    },
    firstTimestamp: fields.firstSeen,
    lastTimestamp: fields.lastSeen,
    count: fields.count || 1,
    type: fields.type,
    eventTime: null,
    reportingComponent: "",
    reportingInstance: "",
  };
}

export type WatchType = "ADDED" | "MODIFIED" | "DELETED";

// The body of a watched Event's record: the watch event, as an OTLP AnyValue.
export function watchedEventBody(
  watchType: WatchType,
  event: { [key: string]: PlainValue },
): JSONObject {
  return toOtlpAnyValue({ type: watchType, object: event });
}

// The body as ingest stores it: the AnyValue, JSON-encoded.
export function storedBody(body: JSONObject): string {
  return JSON.stringify(body);
}

// The record attributes the k8sobjects receiver puts on a watched Event.
export function watchedEventRecordAttributes(eventName: string): JSONObject {
  return {
    "event.domain": "k8s",
    "event.name": eventName,
    "k8s.resource.name": "events",
  };
}

const MINUTE_IN_MS: number = 60 * 1000;

function minutesBefore(anchor: Date, minutes: number): string {
  return new Date(anchor.getTime() - minutes * MINUTE_IN_MS).toISOString();
}

/*
 * The Events of issue #5179, last seen `minutesAgo` before `now`. Counts as
 * the portal showed them.
 */
export function issue5179Events(
  now: Date = new Date(),
): Array<KubernetesEventFields> {
  return [
    {
      uid: "6f2a8c10-0b1e-4e55-9c1a-5179000000a1",
      name: "aks-userpool-11935137-vmss00000o.17f0a2b3c4d5e6f1",
      namespace: "default",
      type: "Warning",
      reason: "OOMKilling",
      message:
        "Memory cgroup out of memory: Killed process 318623 (MainThread) total-vm:10568040kB, anon-rss:1033284kB, file-rss:63972kB, shmem-rss:0kB, UID:1000 pgtables:3112kB oom_score_adj:999",
      object: {
        kind: "Node",
        name: "aks-userpool-11935137-vmss00000o",
        uid: "aks-userpool-11935137-vmss00000o",
      },
      controller: "kernel-monitor",
      instance: "aks-userpool-11935137-vmss00000o",
      count: 2,
      firstSeen: minutesBefore(now, 47),
      lastSeen: minutesBefore(now, 12),
    },
    {
      uid: "6f2a8c10-0b1e-4e55-9c1a-5179000000a2",
      name: "aks-agentpool-19172126-vmss000000.17f0a2b3c4d5e6f2",
      namespace: "default",
      type: "Warning",
      reason: "OOMKilling",
      message:
        "Memory cgroup out of memory: Killed process 412694 (MainThread) total-vm:10564536kB, anon-rss:1034848kB, file-rss:64040kB, shmem-rss:0kB, UID:1000 pgtables:3108kB oom_score_adj:999",
      object: {
        kind: "Node",
        name: "aks-agentpool-19172126-vmss000000",
        uid: "aks-agentpool-19172126-vmss000000",
      },
      controller: "kernel-monitor",
      instance: "aks-agentpool-19172126-vmss000000",
      count: 2,
      firstSeen: minutesBefore(now, 55),
      lastSeen: minutesBefore(now, 21),
    },
    {
      uid: "6f2a8c10-0b1e-4e55-9c1a-5179000000a3",
      name: "aks-agentpool-19172126-vmss000000.17f0a2b3c4d5e6f3",
      namespace: "default",
      type: "Warning",
      reason: "OOMKilling",
      message:
        "Memory cgroup out of memory: Killed process 401385 (DelayedTaskSche) total-vm:10568244kB, anon-rss:1034768kB, file-rss:63928kB, shmem-rss:0kB, UID:1000 pgtables:3112kB oom_score_adj:999",
      object: {
        kind: "Node",
        name: "aks-agentpool-19172126-vmss000000",
        uid: "aks-agentpool-19172126-vmss000000",
      },
      controller: "kernel-monitor",
      instance: "aks-agentpool-19172126-vmss000000",
      count: 1,
      firstSeen: minutesBefore(now, 33),
      lastSeen: minutesBefore(now, 33),
    },
    {
      uid: "6f2a8c10-0b1e-4e55-9c1a-5179000000a4",
      name: "istiod.17f0a2b3c4d5e6f4",
      namespace: "aks-istio-system",
      type: "Warning",
      reason: "FailedGetResourceMetric",
      message:
        "failed to get cpu utilization: unable to get metrics for resource cpu: no metrics returned from resource metrics API",
      object: {
        kind: "HorizontalPodAutoscaler",
        name: "istiod",
        namespace: "aks-istio-system",
        apiVersion: "autoscaling/v2",
      },
      controller: "horizontal-pod-autoscaler",
      count: 3,
      firstSeen: minutesBefore(now, 30),
      lastSeen: minutesBefore(now, 4),
      asSeries: true,
    },
    {
      uid: "6f2a8c10-0b1e-4e55-9c1a-5179000000a5",
      name: "istiod.17f0a2b3c4d5e6f5",
      namespace: "aks-istio-system",
      type: "Warning",
      reason: "FailedComputeMetricsReplicas",
      message:
        "invalid metrics (1 invalid out of 1), first error is: failed to get cpu resource metric value: failed to get cpu utilization: unable to get metrics for resource cpu: no metrics returned from resource metrics API",
      object: {
        kind: "HorizontalPodAutoscaler",
        name: "istiod",
        namespace: "aks-istio-system",
        apiVersion: "autoscaling/v2",
      },
      controller: "horizontal-pod-autoscaler",
      count: 3,
      firstSeen: minutesBefore(now, 30),
      lastSeen: minutesBefore(now, 4),
    },
    {
      uid: "6f2a8c10-0b1e-4e55-9c1a-5179000000a6",
      name: "nginx.17f0a2b3c4d5e6f6",
      namespace: "app-routing-system",
      type: "Warning",
      reason: "FailedGetResourceMetric",
      message:
        "failed to get cpu utilization: unable to get metrics for resource cpu: no metrics returned from resource metrics API",
      object: {
        kind: "HorizontalPodAutoscaler",
        name: "nginx",
        namespace: "app-routing-system",
        apiVersion: "autoscaling/v2",
      },
      controller: "horizontal-pod-autoscaler",
      count: 1,
      firstSeen: minutesBefore(now, 9),
      lastSeen: minutesBefore(now, 9),
    },
    {
      uid: "6f2a8c10-0b1e-4e55-9c1a-5179000000a7",
      name: "nginx.17f0a2b3c4d5e6f7",
      namespace: "app-routing-system",
      type: "Warning",
      reason: "FailedComputeMetricsReplicas",
      message:
        "invalid metrics (1 invalid out of 1), first error is: failed to get cpu resource metric value: failed to get cpu utilization: unable to get metrics for resource cpu: no metrics returned from resource metrics API",
      object: {
        kind: "HorizontalPodAutoscaler",
        name: "nginx",
        namespace: "app-routing-system",
        apiVersion: "autoscaling/v2",
      },
      controller: "horizontal-pod-autoscaler",
      count: 1,
      firstSeen: minutesBefore(now, 9),
      lastSeen: minutesBefore(now, 9),
    },
  ];
}

/*
 * A Normal Event about a Pod, the kind there are many of on a busy cluster.
 * `index` makes each one its own Event.
 */
export function normalPodEvent(
  index: number,
  now: Date = new Date(),
): KubernetesEventFields {
  const podName: string = `checkout-7d4f9b6c5-${String(index).padStart(5, "0")}`;

  return {
    uid: `9a1b2c3d-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `${podName}.17f0b${String(index).padStart(11, "0")}`,
    namespace: "shop",
    type: "Normal",
    reason: "Pulled",
    message: `Container image "registry.example.com/shop/checkout:2.4.${index}" already present on machine`,
    object: {
      kind: "Pod",
      name: podName,
      namespace: "shop",
      fieldPath: "spec.containers{checkout}",
    },
    controller: "kubelet",
    instance: "aks-userpool-11935137-vmss00000o",
    count: 1,
    firstSeen: minutesBefore(now, index % 600),
    lastSeen: minutesBefore(now, index % 600),
  };
}

export interface StoredKubernetesEventLog {
  _id: string;
  time: Date;
  body: string;
  severityText: string;
  attributes: JSONObject;
}

/*
 * A watched Event's record as the logs table holds it, for a cluster. With
 * `stamped` (the default) it carries the attributes ingest stamps today and
 * a Warning is a Warning log; without, it is a record stored before that:
 * only the receiver's attributes, and every Event an Information log.
 */
export function storedKubernetesEventLog(data: {
  fields: KubernetesEventFields;
  clusterName: string;
  watchType?: WatchType | undefined;
  stamped?: boolean | undefined;
  id?: string | undefined;
}): StoredKubernetesEventLog {
  const watchType: WatchType = data.watchType || "ADDED";
  const body: string = storedBody(
    watchedEventBody(watchType, kubernetesEventObject(data.fields)),
  );
  const parsed: ParsedKubernetesEvent | null =
    parseKubernetesEventFromLogBody(body);
  const isStamped: boolean = data.stamped !== false;

  return {
    _id: data.id || `${data.fields.uid}-${watchType}`,
    time: new Date(data.fields.lastSeen),
    body: body,
    severityText:
      isStamped && data.fields.type === "Warning" ? "Warning" : "Information",
    attributes: {
      "resource.k8s.cluster.name": data.clusterName,
      "resource.service.name": `kubernetes-agent-${data.clusterName}`,
      ...watchedEventRecordAttributes(data.fields.name),
      ...(isStamped && parsed ? getKubernetesEventLogAttributes(parsed) : {}),
    },
  };
}

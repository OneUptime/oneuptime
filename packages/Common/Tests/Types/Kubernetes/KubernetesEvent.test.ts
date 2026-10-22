import KubernetesEventAttribute, {
  KUBERNETES_EVENT_DOMAIN,
  KUBERNETES_NORMAL_EVENT_SEVERITY_NUMBER,
  KUBERNETES_WARNING_EVENT_SEVERITY_NUMBER,
  MAX_KUBERNETES_EVENT_BODY_LENGTH,
  MAX_KUBERNETES_EVENT_MESSAGE_LENGTH,
  ParsedKubernetesEvent,
  getKubernetesEventLogAttributes,
  getKubernetesEventLogTime,
  getKubernetesEventSeverityNumber,
  isKubernetesEventLogRecord,
  isKubernetesWarningEvent,
  parseKubernetesEventFromLogBody,
  parseKubernetesEventPlainObject,
  readKubernetesEventFromAttributes,
} from "../../../Types/Kubernetes/KubernetesEvent";
import {
  KubernetesEventFields,
  PlainValue,
  coreV1EventObject,
  issue5179Events,
  kubernetesEventObject,
  storedBody,
  toOtlpAnyValue,
  watchedEventBody,
} from "../../Helpers/KubernetesEventRecords";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The one reader of Kubernetes Events: ingest stamps what it reads onto the
 * Event's log record, and the Dashboard reads records stored before that
 * with it (issue #5179). These tests feed it the Events of the issue - the
 * OOMKilling warnings on AKS nodes and the HPA's FailedGetResourceMetric and
 * FailedComputeMetricsReplicas in aks-istio-system and app-routing-system -
 * in every shape they reach OneUptime in.
 */

const NOW: Date = new Date("2026-10-22T10:00:00.000Z");
const EVENTS: Array<KubernetesEventFields> = issue5179Events(NOW);
const OOM: KubernetesEventFields = EVENTS[0]!;
const ISTIOD_METRIC: KubernetesEventFields = EVENTS[3]!;
const NGINX_REPLICAS: KubernetesEventFields = EVENTS[6]!;

function watched(
  fields: KubernetesEventFields,
  watchType: "ADDED" | "MODIFIED" | "DELETED" = "MODIFIED",
): ParsedKubernetesEvent | null {
  return parseKubernetesEventFromLogBody(
    storedBody(watchedEventBody(watchType, kubernetesEventObject(fields))),
  );
}

describe("parseKubernetesEventFromLogBody: the Events of issue #5179", () => {
  test("reads an OOMKilling warning on a node: message, type, reason, source, object, namespace and count", () => {
    const event: ParsedKubernetesEvent | null = watched(OOM);

    expect(event).not.toBeNull();
    expect(event).toEqual({
      uid: OOM.uid,
      name: OOM.name,
      namespace: "default",
      type: "Warning",
      reason: "OOMKilling",
      message: OOM.message,
      action: "",
      object: {
        kind: "Node",
        name: "aks-userpool-11935137-vmss00000o",
        namespace: "",
        uid: "aks-userpool-11935137-vmss00000o",
        apiVersion: "",
        fieldPath: "",
      },
      reportingController: "kernel-monitor",
      reportingInstance: "aks-userpool-11935137-vmss00000o",
      count: 2,
      firstSeenAt: new Date(OOM.firstSeen),
      lastSeenAt: new Date(OOM.lastSeen),
      watchType: "MODIFIED",
    });
  });

  test("reads the HPA's FailedGetResourceMetric in aks-istio-system, counted as a series", () => {
    const event: ParsedKubernetesEvent | null = watched(ISTIOD_METRIC);

    expect(event?.type).toBe("Warning");
    expect(event?.reason).toBe("FailedGetResourceMetric");
    expect(event?.namespace).toBe("aks-istio-system");
    expect(event?.object).toEqual({
      kind: "HorizontalPodAutoscaler",
      name: "istiod",
      namespace: "aks-istio-system",
      uid: "istiod-uid",
      apiVersion: "autoscaling/v2",
      fieldPath: "",
    });
    expect(event?.reportingController).toBe("horizontal-pod-autoscaler");
    expect(event?.reportingInstance).toBe("");
    // series.count, not deprecatedCount (the builder writes only the series).
    expect(event?.count).toBe(3);
    expect(event?.lastSeenAt).toEqual(new Date(ISTIOD_METRIC.lastSeen));
  });

  test("reads the HPA's FailedComputeMetricsReplicas in app-routing-system", () => {
    const event: ParsedKubernetesEvent | null = watched(
      NGINX_REPLICAS,
      "ADDED",
    );

    expect(event?.reason).toBe("FailedComputeMetricsReplicas");
    expect(event?.namespace).toBe("app-routing-system");
    expect(event?.object.kind).toBe("HorizontalPodAutoscaler");
    expect(event?.object.name).toBe("nginx");
    expect(event?.count).toBe(1);
    expect(event?.watchType).toBe("ADDED");
    expect(event?.message).toContain("invalid metrics (1 invalid out of 1)");
  });

  test("reads every Event of the issue, each as the Warning it is", () => {
    for (const fields of EVENTS) {
      const event: ParsedKubernetesEvent | null = watched(fields);
      expect(event?.uid).toBe(fields.uid);
      expect(isKubernetesWarningEvent(event)).toBe(true);
      expect(event?.object.kind).toBe(fields.object.kind);
      expect(event?.namespace).toBe(fields.namespace);
    }
  });

  test.each(["ADDED", "MODIFIED", "DELETED"] as const)(
    "reads the %s watch event the same way",
    (watchType: "ADDED" | "MODIFIED" | "DELETED") => {
      const event: ParsedKubernetesEvent | null = watched(OOM, watchType);
      expect(event?.watchType).toBe(watchType);
      expect(event?.reason).toBe("OOMKilling");
      expect(event?.count).toBe(2);
    },
  );
});

describe("parseKubernetesEventFromLogBody: every shape an Event arrives in", () => {
  test("a core/v1 Event (involvedObject, message, source, count, first and last timestamps)", () => {
    const event: ParsedKubernetesEvent | null = parseKubernetesEventFromLogBody(
      storedBody(watchedEventBody("ADDED", coreV1EventObject(OOM))),
    );

    expect(event?.reason).toBe("OOMKilling");
    expect(event?.message).toBe(OOM.message);
    expect(event?.object.kind).toBe("Node");
    expect(event?.object.name).toBe("aks-userpool-11935137-vmss00000o");
    expect(event?.reportingController).toBe("kernel-monitor");
    expect(event?.reportingInstance).toBe("aks-userpool-11935137-vmss00000o");
    expect(event?.count).toBe(2);
    expect(event?.firstSeenAt).toEqual(new Date(OOM.firstSeen));
    expect(event?.lastSeenAt).toEqual(new Date(OOM.lastSeen));
  });

  test("a pulled Event: the body is the Event itself, with no watch around it", () => {
    const event: ParsedKubernetesEvent | null = parseKubernetesEventFromLogBody(
      storedBody(toOtlpAnyValue(kubernetesEventObject(ISTIOD_METRIC))),
    );

    expect(event?.reason).toBe("FailedGetResourceMetric");
    expect(event?.watchType).toBe("");
  });

  test("a body a protobuf payload decoded to (snake_case AnyValue keys)", () => {
    const camel: string = storedBody(
      watchedEventBody("MODIFIED", kubernetesEventObject(OOM)),
    );
    const snake: string = camel
      .split('"kvlistValue"')
      .join('"kvlist_value"')
      .split('"stringValue"')
      .join('"string_value"')
      .split('"intValue"')
      .join('"int_value"')
      .split('"arrayValue"')
      .join('"array_value"');

    expect(snake).not.toContain("kvlistValue");
    expect(parseKubernetesEventFromLogBody(snake)).toEqual(
      parseKubernetesEventFromLogBody(camel),
    );
  });

  test("an Event that leaves its kind out is still read by what it is about", () => {
    const object: { [key: string]: PlainValue } = kubernetesEventObject(OOM);
    delete object["kind"];
    delete object["apiVersion"];

    expect(
      parseKubernetesEventFromLogBody(
        storedBody(watchedEventBody("ADDED", object)),
      )?.reason,
    ).toBe("OOMKilling");
  });

  test("a core/v1 writer that leaves the Event's own namespace out gets its object's", () => {
    const object: { [key: string]: PlainValue } =
      coreV1EventObject(ISTIOD_METRIC);
    (object["metadata"] as { [key: string]: PlainValue })["namespace"] = "";

    expect(
      parseKubernetesEventFromLogBody(
        storedBody(watchedEventBody("ADDED", object)),
      )?.namespace,
    ).toBe("aks-istio-system");
  });

  test("anything that is not an Event is not read as one", () => {
    const pod: { [key: string]: PlainValue } = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: "web-1", namespace: "shop" },
      status: { phase: "Running" },
    };

    // A pulled Pod spec, the other records that share the pipeline.
    expect(
      parseKubernetesEventFromLogBody(storedBody(toOtlpAnyValue(pod))),
    ).toBeNull();
    // A watched Pod.
    expect(
      parseKubernetesEventFromLogBody(
        storedBody(watchedEventBody("ADDED", pod)),
      ),
    ).toBeNull();
    // A Node, which has a type-less status and no reason.
    expect(
      parseKubernetesEventFromLogBody(
        storedBody(
          toOtlpAnyValue({ kind: "Node", metadata: { name: "aks-1" } }),
        ),
      ),
    ).toBeNull();
    expect(parseKubernetesEventFromLogBody("a plain log line")).toBeNull();
    expect(parseKubernetesEventFromLogBody('"a JSON string"')).toBeNull();
    expect(parseKubernetesEventFromLogBody("[1,2,3]")).toBeNull();
    expect(parseKubernetesEventFromLogBody('{"stringValue":"x"}')).toBeNull();
    expect(parseKubernetesEventFromLogBody("{")).toBeNull();
    expect(parseKubernetesEventFromLogBody("")).toBeNull();
    expect(parseKubernetesEventFromLogBody(null)).toBeNull();
    expect(parseKubernetesEventFromLogBody(undefined)).toBeNull();
  });

  test("a body longer than any Event is not parsed", () => {
    const object: { [key: string]: PlainValue } = kubernetesEventObject(OOM);
    object["note"] = "x".repeat(MAX_KUBERNETES_EVENT_BODY_LENGTH);

    expect(
      parseKubernetesEventFromLogBody(
        storedBody(watchedEventBody("ADDED", object)),
      ),
    ).toBeNull();
  });
});

describe("what an Event's times and count are", () => {
  test("first seen is the earliest time it gives, last seen the latest", () => {
    const event: ParsedKubernetesEvent | null = parseKubernetesEventPlainObject(
      {
        kind: "Event",
        reason: "BackOff",
        type: "Warning",
        metadata: { creationTimestamp: "2026-10-22T09:00:05Z" },
        eventTime: "2026-10-22T09:00:00.123456Z",
        deprecatedFirstTimestamp: "2026-10-22T09:00:01Z",
        deprecatedLastTimestamp: "2026-10-22T09:10:00Z",
        series: { count: 7, lastObservedTime: "2026-10-22T09:30:00.000001Z" },
        regarding: { kind: "Pod", name: "web-1", namespace: "shop" },
      },
    );

    expect(event?.firstSeenAt?.toISOString()).toBe("2026-10-22T09:00:00.123Z");
    expect(event?.lastSeenAt?.toISOString()).toBe("2026-10-22T09:30:00.000Z");
    expect(event?.count).toBe(7);
  });

  test("an unset time - null, empty, zero or nonsense - is no time", () => {
    const event: ParsedKubernetesEvent | null = parseKubernetesEventPlainObject(
      {
        kind: "Event",
        reason: "Scheduled",
        type: "Normal",
        metadata: { creationTimestamp: "0001-01-01T00:00:00Z" },
        eventTime: null,
        deprecatedFirstTimestamp: "",
        deprecatedLastTimestamp: "not a time",
        regarding: { kind: "Pod", name: "web-1" },
      },
    );

    expect(event?.firstSeenAt).toBeNull();
    expect(event?.lastSeenAt).toBeNull();
  });

  test("the count is the largest the Event gives, and 1 when it gives none", () => {
    const base: Record<string, unknown> = {
      kind: "Event",
      reason: "BackOff",
      regarding: { kind: "Pod", name: "web-1" },
    };

    expect(parseKubernetesEventPlainObject({ ...base })?.count).toBe(1);
    expect(
      parseKubernetesEventPlainObject({ ...base, deprecatedCount: 4 })?.count,
    ).toBe(4);
    expect(
      parseKubernetesEventPlainObject({
        ...base,
        deprecatedCount: 4,
        series: { count: 9 },
      })?.count,
    ).toBe(9);
    expect(
      parseKubernetesEventPlainObject({ ...base, count: "12" })?.count,
    ).toBe(12);
    expect(parseKubernetesEventPlainObject({ ...base, count: -3 })?.count).toBe(
      1,
    );
    expect(
      parseKubernetesEventPlainObject({ ...base, count: "many" })?.count,
    ).toBe(1);
    expect(
      parseKubernetesEventPlainObject({ ...base, count: 2.9 })?.count,
    ).toBe(2);
  });

  test("a message longer than the API keeps is cut, with an ellipsis", () => {
    const event: ParsedKubernetesEvent | null = parseKubernetesEventPlainObject(
      {
        kind: "Event",
        reason: "Failed",
        type: "Warning",
        message: "y".repeat(MAX_KUBERNETES_EVENT_MESSAGE_LENGTH + 500),
        involvedObject: { kind: "Pod", name: "web-1" },
      },
    );

    expect(event?.message.length).toBe(MAX_KUBERNETES_EVENT_MESSAGE_LENGTH);
    expect(event?.message.endsWith("…")).toBe(true);
  });
});

describe("the attributes ingest stamps, and reading them back", () => {
  test("an OOMKilling warning is stamped with what it says", () => {
    const attributes: Record<string, string> = getKubernetesEventLogAttributes(
      watched(OOM)!,
    );

    expect(attributes).toEqual({
      [KubernetesEventAttribute.Domain]: KUBERNETES_EVENT_DOMAIN,
      [KubernetesEventAttribute.Count]: "2",
      [KubernetesEventAttribute.Type]: "Warning",
      [KubernetesEventAttribute.Reason]: "OOMKilling",
      [KubernetesEventAttribute.Message]: OOM.message,
      [KubernetesEventAttribute.Uid]: OOM.uid,
      [KubernetesEventAttribute.FirstSeen]: new Date(
        OOM.firstSeen,
      ).toISOString(),
      [KubernetesEventAttribute.LastSeen]: new Date(OOM.lastSeen).toISOString(),
      [KubernetesEventAttribute.ReportingController]: "kernel-monitor",
      [KubernetesEventAttribute.ReportingInstance]:
        "aks-userpool-11935137-vmss00000o",
      [KubernetesEventAttribute.Namespace]: "default",
      [KubernetesEventAttribute.ObjectKind]: "Node",
      [KubernetesEventAttribute.ObjectName]: "aks-userpool-11935137-vmss00000o",
      [KubernetesEventAttribute.ObjectUid]: "aks-userpool-11935137-vmss00000o",
    });
  });

  test("the keys are the ones customers' filters and monitors store", () => {
    expect(Object.values(KubernetesEventAttribute).sort()).toEqual(
      [
        "event.domain",
        "k8s.event.action",
        "k8s.event.count",
        "k8s.event.first_seen",
        "k8s.event.last_seen",
        "k8s.event.message",
        "k8s.event.reason",
        "k8s.event.reporting_controller",
        "k8s.event.reporting_instance",
        "k8s.event.type",
        "k8s.event.uid",
        "k8s.namespace.name",
        "k8s.object.api_version",
        "k8s.object.fieldpath",
        "k8s.object.kind",
        "k8s.object.name",
        "k8s.object.uid",
        "k8s.resource.name",
      ].sort(),
    );
  });

  test("a value the Event does not have is left out, not stamped empty", () => {
    const attributes: Record<string, string> = getKubernetesEventLogAttributes(
      parseKubernetesEventPlainObject({
        kind: "Event",
        reason: "Scheduled",
        regarding: { kind: "Pod", name: "web-1" },
      })!,
    );

    expect(attributes).toEqual({
      [KubernetesEventAttribute.Domain]: KUBERNETES_EVENT_DOMAIN,
      [KubernetesEventAttribute.Count]: "1",
      [KubernetesEventAttribute.Reason]: "Scheduled",
      [KubernetesEventAttribute.ObjectKind]: "Pod",
      [KubernetesEventAttribute.ObjectName]: "web-1",
    });
  });

  test("reading the stamped attributes back gives the Event that was stamped", () => {
    for (const fields of EVENTS) {
      const event: ParsedKubernetesEvent = watched(fields)!;
      const readBack: ParsedKubernetesEvent | null =
        readKubernetesEventFromAttributes({
          ...getKubernetesEventLogAttributes(event),
          "event.name": fields.name,
        });

      expect(readBack).toEqual({
        ...event,
        // Not stamped: which change of the watch it was, and the object's own namespace.
        watchType: "",
        object: { ...event.object, namespace: "" },
      });
    }
  });

  test("a record stored before the stamp is not read from its attributes", () => {
    expect(
      readKubernetesEventFromAttributes({
        "event.domain": "k8s",
        "event.name": OOM.name,
        "k8s.resource.name": "events",
        "resource.k8s.cluster.name": "aks-prod",
      }),
    ).toBeNull();
    expect(readKubernetesEventFromAttributes(null)).toBeNull();
    expect(readKubernetesEventFromAttributes(undefined)).toBeNull();
  });

  test("a stamped count that is not a number reads as 1", () => {
    expect(
      readKubernetesEventFromAttributes({
        [KubernetesEventAttribute.Uid]: "u-1",
        [KubernetesEventAttribute.Count]: "lots",
      })?.count,
    ).toBe(1);
  });
});

describe("isKubernetesEventLogRecord", () => {
  test("is the k8sobjects receiver's Event watch, whatever its case and spacing", () => {
    expect(isKubernetesEventLogRecord({ "k8s.resource.name": "events" })).toBe(
      true,
    );
    expect(isKubernetesEventLogRecord({ "k8s.resource.name": "Events" })).toBe(
      true,
    );
    expect(
      isKubernetesEventLogRecord({ "k8s.resource.name": " events " }),
    ).toBe(true);
  });

  test("is nothing else", () => {
    expect(isKubernetesEventLogRecord({ "k8s.resource.name": "pods" })).toBe(
      false,
    );
    expect(
      isKubernetesEventLogRecord({ "resource.k8s.resource.name": "events" }),
    ).toBe(false);
    expect(isKubernetesEventLogRecord({ "k8s.resource.name": 3 })).toBe(false);
    expect(isKubernetesEventLogRecord({ "event.domain": "k8s" })).toBe(false);
    expect(isKubernetesEventLogRecord({})).toBe(false);
    expect(isKubernetesEventLogRecord(null)).toBe(false);
  });
});

describe("the severity an Event's record is stored with", () => {
  test("a Warning is raised to WARN from INFO (the agent's old rule) and from nothing", () => {
    expect(
      getKubernetesEventSeverityNumber({
        eventType: "Warning",
        severityNumber: 9,
      }),
    ).toBe(KUBERNETES_WARNING_EVENT_SEVERITY_NUMBER);
    expect(
      getKubernetesEventSeverityNumber({
        eventType: "Warning",
        severityNumber: 0,
      }),
    ).toBe(13);
    expect(
      getKubernetesEventSeverityNumber({
        eventType: "warning",
        severityNumber: 1,
      }),
    ).toBe(13);
  });

  test("a Warning is never lowered: a collector's ERROR or WARN3 stays", () => {
    expect(
      getKubernetesEventSeverityNumber({
        eventType: "Warning",
        severityNumber: 17,
      }),
    ).toBe(17);
    expect(
      getKubernetesEventSeverityNumber({
        eventType: "Warning",
        severityNumber: 15,
      }),
    ).toBe(15);
  });

  test("a Normal Event is INFO when nothing said otherwise, and keeps what was said", () => {
    expect(
      getKubernetesEventSeverityNumber({
        eventType: "Normal",
        severityNumber: 0,
      }),
    ).toBe(KUBERNETES_NORMAL_EVENT_SEVERITY_NUMBER);
    expect(
      getKubernetesEventSeverityNumber({ eventType: "", severityNumber: 0 }),
    ).toBe(9);
    expect(
      getKubernetesEventSeverityNumber({
        eventType: "Normal",
        severityNumber: 5,
      }),
    ).toBe(5);
    expect(
      getKubernetesEventSeverityNumber({
        eventType: "Normal",
        severityNumber: NaN,
      }),
    ).toBe(9);
  });

  test("isKubernetesWarningEvent", () => {
    expect(isKubernetesWarningEvent({ type: "Warning" })).toBe(true);
    expect(isKubernetesWarningEvent({ type: "WARNING" })).toBe(true);
    expect(isKubernetesWarningEvent({ type: "Normal" })).toBe(false);
    expect(isKubernetesWarningEvent({ type: "" })).toBe(false);
    expect(isKubernetesWarningEvent(null)).toBe(false);
  });
});

describe("when an Event's record is dated", () => {
  test("the last time the Event happened", () => {
    const event: ParsedKubernetesEvent = watched(OOM, "DELETED")!;
    expect(getKubernetesEventLogTime({ event: event, now: NOW })).toEqual(
      new Date(OOM.lastSeen),
    );
  });

  test("a last time ahead of the clock is taken as now", () => {
    const event: ParsedKubernetesEvent = {
      ...watched(OOM)!,
      lastSeenAt: new Date(NOW.getTime() + 5 * 60 * 1000),
    };
    expect(getKubernetesEventLogTime({ event: event, now: NOW })).toEqual(NOW);
  });

  test("no time when the Event says none", () => {
    const event: ParsedKubernetesEvent = { ...watched(OOM)!, lastSeenAt: null };
    expect(getKubernetesEventLogTime({ event: event, now: NOW })).toBeNull();
  });
});

describe("a sweep of generated Events", () => {
  test("every one parses from its body, stamps, and reads back the same", () => {
    const random: SeededRandom = seededRandom(5179);
    const kinds: Array<string> = [
      "Pod",
      "Node",
      "HorizontalPodAutoscaler",
      "Deployment",
      "ReplicaSet",
      "PersistentVolumeClaim",
      "Job",
    ];
    const reasons: Array<string> = [
      "OOMKilling",
      "BackOff",
      "FailedScheduling",
      "FailedGetResourceMetric",
      "Pulled",
      "ScalingReplicaSet",
    ];

    for (let index: number = 0; index < 400; index++) {
      const isNamespaced: boolean = random(4) !== 0;
      const namespace: string = isNamespaced ? `team-${random(9)}` : "default";
      const count: number = 1 + random(40);
      const lastSeenMinutes: number = random(1440);
      const fields: KubernetesEventFields = {
        uid: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `object-${index}.${index.toString(16)}`,
        namespace: namespace,
        type: random(2) === 0 ? "Warning" : "Normal",
        reason: reasons[random(reasons.length)]!,
        message: `message ${index} ${"m".repeat(random(300))}`,
        object: {
          kind: kinds[random(kinds.length)]!,
          name: `object-${index}`,
          namespace: isNamespaced ? namespace : undefined,
        },
        controller: random(2) === 0 ? "kubelet" : "",
        instance: random(2) === 0 ? `node-${random(5)}` : "",
        count: count,
        firstSeen: new Date(
          NOW.getTime() - (lastSeenMinutes + random(120)) * 60000,
        ).toISOString(),
        lastSeen: new Date(
          NOW.getTime() - lastSeenMinutes * 60000,
        ).toISOString(),
        asSeries: random(2) === 0,
      };
      const object: { [key: string]: PlainValue } =
        random(3) === 0
          ? coreV1EventObject(fields)
          : kubernetesEventObject(fields);
      const body: JSONObject = watchedEventBody("MODIFIED", object);
      const event: ParsedKubernetesEvent | null =
        parseKubernetesEventFromLogBody(storedBody(body));

      expect(event).not.toBeNull();
      expect(event!.uid).toBe(fields.uid);
      expect(event!.type).toBe(fields.type);
      expect(event!.reason).toBe(fields.reason);
      expect(event!.namespace).toBe(namespace);
      expect(event!.object.kind).toBe(fields.object.kind);
      expect(event!.count).toBe(count);
      expect(event!.lastSeenAt).toEqual(new Date(fields.lastSeen));
      expect(
        readKubernetesEventFromAttributes(
          getKubernetesEventLogAttributes(event!),
        ),
      ).toEqual({
        ...event!,
        name: "",
        watchType: "",
        object: { ...event!.object, namespace: "" },
      });
    }
  });
});

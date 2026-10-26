/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import path from "path";
import protobuf from "protobufjs";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import KubernetesEventAttribute from "Common/Types/Kubernetes/KubernetesEvent";
import {
  KUBERNETES_WARNING_EVENTS_GROUP_BY,
  buildKubernetesWarningEventsLogMonitor,
} from "Common/Types/Monitor/KubernetesEventAlertTemplates";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  KubernetesEventFields,
  WatchType,
  issue5179Events,
  kubernetesEventObject,
  normalPodEvent,
  toOtlpAnyValue,
  watchedEventBody,
} from "Common/Tests/Helpers/KubernetesEventRecords";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #5179: Kubernetes warning events - OOMKilling on AKS nodes, the
 * HPA's FailedGetResourceMetric and FailedComputeMetricsReplicas in
 * aks-istio-system and app-routing-system - never showed in OneUptime.
 *
 * They reached ingest: the agent watches every Event of the cluster. But
 * everything about an Event sat inside its record's body, and the agent's
 * severity rule never matched a watched Event, so a warning was stored as
 * an Information log a filter, a drop rule or a monitor could not tell from
 * the cluster's thousands of Normal events, and every page read the newest
 * few hundred of them and lost the rest.
 *
 * Ingest now reads the Event out of the body and stamps what it says onto
 * the record. These tests drive the REAL OTLP walk (processLogsFromQueue)
 * with the records the agent sends - as an agent that still sends every
 * Event as INFO does, and as a fixed one - with every backend touchpoint
 * mocked, and read the rows it hands the writer.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const CLUSTER_NAME: string = "aks-prod-westeurope";
const SERVICE_NAME: string = `kubernetes-agent-${CLUSTER_NAME}`;
const OBSERVED_TIME_NANO: string = "1792656300000000000";

const NOW: Date = new Date();
const EVENTS: Array<KubernetesEventFields> = issue5179Events(NOW);
const OOM: KubernetesEventFields = EVENTS[0]!;
const ISTIOD_METRIC: KubernetesEventFields = EVENTS[3]!;
const NGINX_REPLICAS: KubernetesEventFields = EVENTS[6]!;
const PULLED: KubernetesEventFields = normalPodEvent(1, NOW);

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

interface EventRecordOptions {
  watchType?: WatchType | undefined;
  // undefined leaves the field out, as an exporter does for UNSPECIFIED.
  severityNumber?: number | undefined;
  severityText?: string | undefined;
  timeUnixNano?: string | undefined;
}

/*
 * One record of the k8sobjects receiver's Event watch, as the agent's
 * collector exports it. By default as an agent with the old severity rule
 * sends it: every Event INFO.
 */
function eventRecord(
  fields: KubernetesEventFields,
  options: EventRecordOptions = {},
): JSONObject {
  const severityNumber: number | undefined =
    "severityNumber" in options ? options.severityNumber : 9;

  return {
    observedTimeUnixNano: OBSERVED_TIME_NANO,
    ...(options.timeUnixNano ? { timeUnixNano: options.timeUnixNano } : {}),
    ...(severityNumber !== undefined
      ? {
          severityNumber: severityNumber,
          severityText: options.severityText ?? "INFO",
        }
      : {}),
    attributes: [
      stringAttribute("event.domain", "k8s"),
      stringAttribute("event.name", fields.name),
      stringAttribute("k8s.resource.name", "events"),
    ],
    body: watchedEventBody(
      options.watchType || "MODIFIED",
      kubernetesEventObject(fields),
    ),
  };
}

// The agent's resource: the cluster's name, its service and version.
function agentRequest(
  records: Array<JSONObject>,
  extraResourceAttributes: Array<OtlpAttribute> = [],
): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: agentPayload(records, extraResourceAttributes),
    headers: {},
  } as unknown as TelemetryRequest;
}

function agentPayload(
  records: Array<JSONObject>,
  extraResourceAttributes: Array<OtlpAttribute> = [],
): JSONObject {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            stringAttribute("k8s.cluster.name", CLUSTER_NAME),
            stringAttribute("service.name", SERVICE_NAME),
            stringAttribute("oneuptime.agent.version", "14.0.80"),
            ...extraResourceAttributes,
          ],
        },
        scopeLogs: [
          {
            scope: {
              name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/k8sobjectsreceiver",
            },
            logRecords: records,
          },
        ],
      },
    ],
  };
}

function dropFilter(filterQuery: string): LoadedLogDropFilter {
  // No id: recordDrop() short-circuits without one (no Redis here).
  const filter: LogDropFilter = new LogDropFilter();
  filter.action = LogDropFilterAction.Drop;

  return {
    filter: filter,
    compiledFilter: compileFilter(filterQuery, { emptyQueryMatches: false }),
    projectId: PROJECT_ID,
  };
}

function setupIngestMocks(
  dropFilters: Array<LoadedLogDropFilter> = [],
): Array<JSONObject> {
  const capturedRows: Array<JSONObject> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelLogsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  jest
    .spyOn(service, "submitLogsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      capturedRows.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });
  jest
    .spyOn(service, "submitExceptionsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.splice(0, rows.length);
      return Promise.resolve();
    });

  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue(dropFilters);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);

  return capturedRows;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

function timeOf(fields: KubernetesEventFields): string {
  const lastSeen: Date = new Date(fields.lastSeen);
  return OneUptimeDate.toClickhouseDateTime64(
    lastSeen,
    OneUptimeDate.toUnixNano(lastSeen),
  );
}

describe("the Events of issue #5179, from an agent that sends every Event as INFO", () => {
  test("each warning is stored as a Warning log, dated when it last happened, its body untouched", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();
    const records: Array<JSONObject> = EVENTS.map(
      (fields: KubernetesEventFields) => {
        return eventRecord(fields);
      },
    );

    await OtelLogsIngestService.processLogsFromQueue(agentRequest(records));

    expect(rows).toHaveLength(EVENTS.length);

    EVENTS.forEach((fields: KubernetesEventFields, index: number) => {
      const row: JSONObject = rows[index]!;
      expect(row["severityText"]).toBe(LogSeverity.Warning);
      expect(row["severityNumber"]).toBe(13);
      expect(row["time"]).toBe(timeOf(fields));
      expect(row["timeUnixNano"]).toBe(
        String(OneUptimeDate.toUnixNano(new Date(fields.lastSeen))),
      );
      // The body as it arrived: a search or monitor on it keeps working.
      expect(row["body"]).toBe(JSON.stringify(records[index]!["body"]));
      expect(attributesOf(row)[KubernetesEventAttribute.Uid]).toBe(fields.uid);
    });
  });

  test("an OOMKilling on a node carries its message, type, reason, source, object, namespace and count", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([eventRecord(OOM)]),
    );

    const attributes: JSONObject = attributesOf(rows[0]!);
    expect(attributes).toMatchObject({
      "event.domain": "k8s",
      "k8s.resource.name": "events",
      "event.name": OOM.name,
      "resource.k8s.cluster.name": CLUSTER_NAME,
      [KubernetesEventAttribute.Type]: "Warning",
      [KubernetesEventAttribute.Reason]: "OOMKilling",
      [KubernetesEventAttribute.Message]: OOM.message,
      [KubernetesEventAttribute.ReportingController]: "kernel-monitor",
      [KubernetesEventAttribute.ReportingInstance]:
        "aks-userpool-11935137-vmss00000o",
      [KubernetesEventAttribute.ObjectKind]: "Node",
      [KubernetesEventAttribute.ObjectName]: "aks-userpool-11935137-vmss00000o",
      [KubernetesEventAttribute.Namespace]: "default",
      [KubernetesEventAttribute.Count]: "2",
      [KubernetesEventAttribute.FirstSeen]: new Date(
        OOM.firstSeen,
      ).toISOString(),
      [KubernetesEventAttribute.LastSeen]: new Date(OOM.lastSeen).toISOString(),
    });

    // The keys column lists every stamped key, for "has attribute" filters.
    const keys: Array<string> = rows[0]!["attributeKeys"] as Array<string>;
    for (const key of Object.keys(attributes)) {
      expect(keys).toContain(key);
    }
  });

  test("the HPA's warnings in aks-istio-system and app-routing-system carry their namespace and HPA", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([eventRecord(ISTIOD_METRIC), eventRecord(NGINX_REPLICAS)]),
    );

    expect(attributesOf(rows[0]!)).toMatchObject({
      [KubernetesEventAttribute.Reason]: "FailedGetResourceMetric",
      [KubernetesEventAttribute.Namespace]: "aks-istio-system",
      [KubernetesEventAttribute.ObjectKind]: "HorizontalPodAutoscaler",
      [KubernetesEventAttribute.ObjectName]: "istiod",
      [KubernetesEventAttribute.ObjectApiVersion]: "autoscaling/v2",
      [KubernetesEventAttribute.ReportingController]:
        "horizontal-pod-autoscaler",
      [KubernetesEventAttribute.Count]: "3",
    });
    expect(attributesOf(rows[1]!)).toMatchObject({
      [KubernetesEventAttribute.Reason]: "FailedComputeMetricsReplicas",
      [KubernetesEventAttribute.Namespace]: "app-routing-system",
      [KubernetesEventAttribute.ObjectName]: "nginx",
    });
  });

  test("a Normal event stays an Information log, with its attributes", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([eventRecord(PULLED)]),
    );

    expect(rows[0]!["severityText"]).toBe(LogSeverity.Information);
    expect(rows[0]!["severityNumber"]).toBe(9);
    expect(attributesOf(rows[0]!)).toMatchObject({
      [KubernetesEventAttribute.Type]: "Normal",
      [KubernetesEventAttribute.Reason]: "Pulled",
      [KubernetesEventAttribute.ObjectKind]: "Pod",
      [KubernetesEventAttribute.ObjectFieldPath]: "spec.containers{checkout}",
      [KubernetesEventAttribute.Namespace]: "shop",
    });
  });

  test("the namespace the 0.161 collector stamps on the resource is kept beside the record's", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest(
        [eventRecord(ISTIOD_METRIC)],
        [stringAttribute("k8s.namespace.name", "aks-istio-system")],
      ),
    );

    expect(attributesOf(rows[0]!)["resource.k8s.namespace.name"]).toBe(
      "aks-istio-system",
    );
    expect(attributesOf(rows[0]!)[KubernetesEventAttribute.Namespace]).toBe(
      "aks-istio-system",
    );
  });
});

describe("severity and time, whoever sent the Event", () => {
  test("an agent with the fixed rule sends WARN, and it stays WARN", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        eventRecord(OOM, { severityNumber: 13, severityText: "WARN" }),
      ]),
    );

    expect(rows[0]!["severityNumber"]).toBe(13);
    expect(rows[0]!["severityText"]).toBe(LogSeverity.Warning);
  });

  test("a collector that says nothing: a Warning becomes WARN, a Normal event INFO", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        eventRecord(OOM, { severityNumber: undefined }),
        eventRecord(PULLED, { severityNumber: undefined }),
      ]),
    );

    expect(rows[0]!["severityText"]).toBe(LogSeverity.Warning);
    expect(rows[1]!["severityText"]).toBe(LogSeverity.Information);
    expect(rows[1]!["severityNumber"]).toBe(9);
  });

  test("a pipeline that made a warning an ERROR keeps it an ERROR", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        eventRecord(OOM, { severityNumber: 17, severityText: "ERROR" }),
      ]),
    );

    expect(rows[0]!["severityText"]).toBe(LogSeverity.Error);
    expect(rows[0]!["severityNumber"]).toBe(17);
  });

  test("the DELETED a watch sends an hour later is dated when the Event last happened, not when it arrived", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([eventRecord(OOM, { watchType: "DELETED" })]),
    );

    expect(rows[0]!["time"]).toBe(timeOf(OOM));
  });

  test("a record that came with its own time keeps it", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();
    const ownTime: string = "1792656000000000000";

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([eventRecord(OOM, { timeUnixNano: ownTime })]),
    );

    expect(rows[0]!["timeUnixNano"]).toBe(ownTime);
    expect(attributesOf(rows[0]!)[KubernetesEventAttribute.Reason]).toBe(
      "OOMKilling",
    );
  });

  test("an Event a fast node clock dates in the future is dated now", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();
    const future: KubernetesEventFields = {
      ...OOM,
      lastSeen: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    const before: number = Date.now();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([eventRecord(future)]),
    );

    const storedMs: number = Number(
      BigInt(rows[0]!["timeUnixNano"] as string) / BigInt(1000000),
    );
    expect(storedMs).toBeGreaterThanOrEqual(before);
    expect(storedMs).toBeLessThanOrEqual(Date.now());
  });
});

describe("drop filters see the Event the way the pages do", () => {
  test("a drop filter on Information logs no longer takes the cluster's warnings with it", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([
      dropFilter("severityText = 'Information'"),
    ]);

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([eventRecord(PULLED), ...EVENTS.map(eventRecordOf)]),
    );

    expect(rows).toHaveLength(EVENTS.length);
    for (const row of rows) {
      expect(row["severityText"]).toBe(LogSeverity.Warning);
    }
  });

  test("a drop filter can thin out one reason of Normal events", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([
      dropFilter("attributes.k8s.event.reason = 'Pulled'"),
    ]);

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([eventRecord(PULLED), eventRecord(OOM)]),
    );

    expect(rows).toHaveLength(1);
    expect(attributesOf(rows[0]!)[KubernetesEventAttribute.Reason]).toBe(
      "OOMKilling",
    );
  });
});

function eventRecordOf(fields: KubernetesEventFields): JSONObject {
  return eventRecord(fields);
}

describe("what is not an Event is left alone", () => {
  test("a pulled resource spec and an application log keep their severity, time and attributes", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();
    const appTime: string = "1792656000000000000";

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        {
          observedTimeUnixNano: OBSERVED_TIME_NANO,
          severityNumber: 9,
          severityText: "INFO",
          attributes: [stringAttribute("k8s.resource.name", "pods")],
          body: toOtlpAnyValue({
            apiVersion: "v1",
            kind: "Pod",
            metadata: { name: "checkout-1", namespace: "shop" },
          }),
        },
        {
          timeUnixNano: appTime,
          severityNumber: 5,
          body: { stringValue: "reason=OOMKilling type=Warning" },
        },
      ]),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!["severityNumber"]).toBe(9);
    expect(rows[1]!["severityNumber"]).toBe(5);
    expect(rows[1]!["timeUnixNano"]).toBe(appTime);
    for (const row of rows) {
      for (const key of Object.keys(attributesOf(row))) {
        expect(key.startsWith("k8s.event.")).toBe(false);
        expect(key.startsWith("k8s.object.")).toBe(false);
      }
    }
  });

  test("an Event record whose body is not an Event is stored as it came", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        {
          observedTimeUnixNano: OBSERVED_TIME_NANO,
          severityNumber: 9,
          attributes: [stringAttribute("k8s.resource.name", "events")],
          body: { stringValue: '{"type":"Warning"}' },
        },
      ]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!["severityNumber"]).toBe(9);
    expect(
      attributesOf(rows[0]!)[KubernetesEventAttribute.Reason],
    ).toBeUndefined();
  });
});

describe("a protobuf payload", () => {
  test("is read the same as OTLP/JSON once the worker decodes it", async () => {
    const protoDir: string = path.resolve(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Telemetry",
      "ProtoFiles",
      "OTel",
      "v1",
    );
    const requestType: protobuf.Type = protobuf
      .loadSync(path.join(protoDir, "logs_service.proto"))
      .lookupType(
        "opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest",
      );
    const json: JSONObject = agentPayload([eventRecord(ISTIOD_METRIC)]);
    const message: protobuf.Message = requestType.fromObject(json);
    const decoded: JSONObject = requestType
      .decode(requestType.encode(message).finish())
      .toJSON() as JSONObject;

    const rows: Array<JSONObject> = setupIngestMocks();
    await OtelLogsIngestService.processLogsFromQueue({
      projectId: PROJECT_ID,
      body: decoded,
      headers: {},
    } as unknown as TelemetryRequest);

    expect(rows[0]!["severityText"]).toBe(LogSeverity.Warning);
    expect(attributesOf(rows[0]!)).toMatchObject({
      [KubernetesEventAttribute.Reason]: "FailedGetResourceMetric",
      [KubernetesEventAttribute.Namespace]: "aks-istio-system",
      [KubernetesEventAttribute.Count]: "3",
    });
  });
});

/*
 * Follow-up of #5201: a cluster's Warning Events alert (Common's
 * KubernetesEventAlertTemplates) is a Logs monitor over these records. What
 * it filters on, groups by and looks back over must be what ingest stores:
 * read here from the rows ingest hands the writer.
 */
describe("the Warning Events alert counts what ingest stores", () => {
  // Whether a stored row is one the cluster's alert counts.
  function counted(
    row: JSONObject,
    clusterName: string = CLUSTER_NAME,
  ): boolean {
    const filter: Record<string, string | number | boolean> =
      buildKubernetesWarningEventsLogMonitor(clusterName).attributes;

    return Object.entries(filter).every(
      ([key, value]: [string, string | number | boolean]): boolean => {
        return attributesOf(row)[key] === value;
      },
    );
  }

  function storedAtMs(row: JSONObject): number {
    return Number(BigInt(row["timeUnixNano"] as string) / BigInt(1000000));
  }

  test("every warning of the cluster, grouped by what ingest stamps, and no Normal event", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        ...EVENTS.map((fields: KubernetesEventFields) => {
          return eventRecord(fields);
        }),
        eventRecord(PULLED),
      ]),
    );

    const warnings: number = EVENTS.filter(
      (fields: KubernetesEventFields): boolean => {
        return fields.type === "Warning";
      },
    ).length;
    const countedRows: Array<JSONObject> = rows.filter((row: JSONObject) => {
      return counted(row);
    });

    expect(warnings).toBeGreaterThan(0);
    expect(countedRows).toHaveLength(warnings);
    expect(counted(rows[rows.length - 1]!)).toBe(false);

    // Every key the alert splits by is on every warning, so each has a group.
    for (const row of countedRows) {
      for (const key of KUBERNETES_WARNING_EVENTS_GROUP_BY) {
        expect({ key, isText: typeof attributesOf(row)[key] }).toEqual({
          key,
          isText: "string",
        });
      }
    }
  });

  test("not another cluster's warnings", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([eventRecord(OOM)]),
    );

    expect(counted(rows[0]!)).toBe(true);
    expect(counted(rows[0]!, "eks-staging")).toBe(false);
  });

  test("a warning from a minute ago is in the alert's window; the DELETED of an older one is not", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();
    const fresh: KubernetesEventFields = {
      ...OOM,
      uid: "6f2a8c10-0b1e-4e55-9c1a-5179000000ff",
      lastSeen: new Date(Date.now() - 60 * 1000).toISOString(),
    };

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        eventRecord(fresh),
        // OOM last happened 12 minutes ago; Kubernetes deletes it an hour on.
        eventRecord(OOM, { watchType: "DELETED" }),
      ]),
    );

    const window: InBetween<Date> = MonitorStepLogMonitorUtil.toQuery(
      buildKubernetesWarningEventsLogMonitor(CLUSTER_NAME),
      new Date(),
    ).time as InBetween<Date>;
    const inWindow: (row: JSONObject) => boolean = (
      row: JSONObject,
    ): boolean => {
      return (
        storedAtMs(row) >= window.startValue.getTime() &&
        storedAtMs(row) <= window.endValue.getTime()
      );
    };

    expect(counted(rows[0]!) && inWindow(rows[0]!)).toBe(true);
    expect(counted(rows[1]!)).toBe(true);
    expect(inWindow(rows[1]!)).toBe(false);
  });
});

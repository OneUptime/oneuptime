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
import { OpenStackRecordedEvent } from "Common/Server/Utils/OpenStack/OpenStackEventEntries";
import OpenStackEventRecorder, {
  OpenStackEventBufferEntry,
} from "Common/Server/Utils/OpenStack/OpenStackEventRecorder";
import OpenStackLogDefaults, {
  OPENSTACK_DEFAULT_DROP_FILTERS,
  OpenStackDefaultDropFilter,
} from "Common/Server/Utils/OpenStack/OpenStackLogDefaults";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackLogAttribute } from "Common/Utils/OpenStack/OpenStackLogs";
import { OpenStackEventAttribute } from "Common/Utils/OpenStack/OpenStackNotifications";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A cloud's logs through the REAL OTLP walk (processLogsFromQueue), with every backend touchpoint
 * mocked, reading the rows it hands the writer. The lines are the shapes the rig recorded: the
 * colours and format DevStack writes, and oslo.log's default, with an instance's real failure.
 * What matters here is the order things happen in: what a row holds is decided before a drop
 * filter reads it, a secret is gone before anything else sees it, and a dropped record says nothing
 * happened.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const CLOUD_NAME: string = "production";
const REQUEST: string = "req-270bada6-fe38-4526-a6f2-199b7030fe36";
const GLOBAL: string = "req-a3f19c06-14e8-4a0c-9c9d-1a7b0d5a3e22";
const INSTANCE: string = "d82da1aa-196b-463d-b2be-545c5276685d";
const RECORD_TIME_NANO: string = "1793829305584000000";

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function journalRecord(
  body: string,
  attributes: Array<OtlpAttribute> = [],
): JSONObject {
  return {
    timeUnixNano: RECORD_TIME_NANO,
    severityNumber: 9,
    severityText: "INFO",
    attributes: [
      stringAttribute("journald.unit", "devstack@n-cpu.service"),
      stringAttribute("journald.hostname", "compute-01"),
      stringAttribute("process.pid", "91143"),
      ...attributes,
    ],
    body: { stringValue: body },
  };
}

function cloudRequest(
  records: Array<JSONObject>,
  resource: Array<OtlpAttribute> = [
    stringAttribute("openstack.cloud.name", CLOUD_NAME),
    stringAttribute("openstack.node.name", "compute-01"),
    stringAttribute("oneuptime.agent.version", "0.161.0"),
  ],
): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    headers: {},
    body: {
      resourceLogs: [
        {
          resource: { attributes: resource },
          scopeLogs: [{ logRecords: records }],
        },
      ],
    },
  } as unknown as TelemetryRequest;
}

function dropFilter(filterQuery: string): LoadedLogDropFilter {
  const filter: LogDropFilter = new LogDropFilter();
  filter.action = LogDropFilterAction.Drop;

  return {
    filter,
    compiledFilter: compileFilter(filterQuery, { emptyQueryMatches: false }),
    projectId: PROJECT_ID,
  };
}

const DEFAULT_DROP_FILTERS: Array<LoadedLogDropFilter> =
  OPENSTACK_DEFAULT_DROP_FILTERS.map((filter: OpenStackDefaultDropFilter) => {
    return dropFilter(filter.filterQuery);
  });

interface Harness {
  rows: Array<JSONObject>;
  recorded: Array<{
    projectId: ObjectID;
    cloudId: ObjectID;
    entry: OpenStackEventBufferEntry;
  }>;
  ensured: Array<ObjectID>;
}

function setup(data?: {
  dropFilters?: Array<LoadedLogDropFilter>;
  cloudId?: ObjectID | null;
}): Harness {
  const harness: Harness = { rows: [], recorded: [], ensured: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelLogsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of [
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
  ]) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest
    .spyOn(service, "autoDiscoverOpenStackCloud")
    .mockResolvedValue(data?.cloudId === undefined ? CLOUD_ID : data.cloudId);

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: CLOUD_NAME,
    primaryEntityId: CLOUD_ID,
    primaryEntityType: ServiceType.OpenStackCloud,
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
      harness.rows.push(...rows.splice(0, rows.length));
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
    .mockResolvedValue(data?.dropFilters || []);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);

  jest.spyOn(OpenStackEventRecorder, "record").mockImplementation((async (
    recorded: Harness["recorded"][number],
  ) => {
    harness.recorded.push(recorded);
  }) as never);
  jest
    .spyOn(OpenStackLogDefaults, "ensureForProject")
    .mockImplementation((async (projectId: ObjectID) => {
      harness.ensured.push(projectId);
    }) as never);

  return harness;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

function notificationLine(type: string, level: string = "INFO"): string {
  return `${level} oslo.messaging.notification.${type} [None ${REQUEST} ou-payments admin] ${JSON.stringify(
    {
      message_id: "5c67c0ef-3da3-4f72-8a38-11b63c8f33c4",
      publisher_id: "nova-compute:compute-01",
      event_type: type,
      priority: level,
      timestamp: "2026-11-04 21:52:03.731211",
      payload: {
        "nova_object.data": {
          uuid: INSTANCE,
          display_name: "ou-log-vm",
          host: "compute-01",
          node: "compute-01.example.internal",
          state: "active",
        },
      },
    },
  )}`;
}

describe("a line a cloud's service wrote", () => {
  const COLOURED: string = `ERROR nova.compute.manager [\u001b[01;36mNone ${REQUEST} \u001b[00;36mou-payments admin] \u001b[01;35m[instance: ${INSTANCE}] Instance failed to spawn\u001b[00m: nova.exception.FlavorDiskSmallerThanImage: Flavor's disk is too small for requested image.`;

  test("is stored as what it says, with its colours gone", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([journalRecord(COLOURED)]),
    );

    expect(harness.rows).toHaveLength(1);

    const row: JSONObject = harness.rows[0]!;

    expect(row["severityText"]).toBe(LogSeverity.Error);
    expect(row["severityNumber"]).toBe(17);
    expect(row["body"]).toBe(
      `ERROR nova.compute.manager [None ${REQUEST} ou-payments admin] [instance: ${INSTANCE}] Instance failed to spawn: nova.exception.FlavorDiskSmallerThanImage: Flavor's disk is too small for requested image.`,
    );
    expect(attributesOf(row)).toMatchObject({
      "resource.openstack.cloud.name": CLOUD_NAME,
      [OpenStackLogAttribute.Service]: "nova-compute",
      [OpenStackLogAttribute.Component]: "nova",
      [OpenStackLogAttribute.Host]: "compute-01",
      [OpenStackLogAttribute.Logger]: "nova.compute.manager",
      [OpenStackLogAttribute.Level]: "ERROR",
      [OpenStackLogAttribute.RequestId]: REQUEST,
      [OpenStackLogAttribute.RequestRootId]: REQUEST,
      [OpenStackLogAttribute.UserName]: "admin",
      [OpenStackLogAttribute.ProjectName]: "ou-payments",
      [OpenStackLogAttribute.InstanceId]: INSTANCE,
    });
    expect(row["primaryEntityId"]).toBe(CLOUD_ID.toString());
  });

  test("its attributes are listed for what says has this attribute", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([journalRecord(COLOURED)]),
    );

    const keys: Array<string> = harness.rows[0]![
      "attributeKeys"
    ] as Array<string>;

    for (const key of Object.keys(attributesOf(harness.rows[0]!))) {
      expect(keys).toContain(key);
    }
  });

  test("keeps the time the collector read off it", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([journalRecord(COLOURED)]),
    );

    expect(harness.rows[0]!["timeUnixNano"]).toBe(RECORD_TIME_NANO);
  });

  test("with no time of its own, takes the one on its line", async () => {
    const harness: Harness = setup();
    const record: JSONObject = journalRecord(
      `2026-11-04 21:51:59.583 91143 ERROR nova.compute.manager [None ${REQUEST} - - - - - -] Failed`,
    );

    delete record["timeUnixNano"];

    await OtelLogsIngestService.processLogsFromQueue(cloudRequest([record]));

    expect(String(harness.rows[0]!["time"])).toContain("2026-11-04");
    expect(String(harness.rows[0]!["time"])).toContain("21:51:59");
  });

  test("its secrets are gone from everything the row holds", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([
        journalRecord(
          `DEBUG nova.api [None ${REQUEST} a b] REQ: {"auth": {"password": "the-password"}} transport_url=rabbit://u:the-password@host:5672/ token gAAAAABl${"a".repeat(120)}`,
        ),
      ]),
    );

    const row: string = JSON.stringify(harness.rows[0]);

    expect(row).not.toContain("the-password");
    expect(row).not.toContain("gAAAAABl");
    expect(attributesOf(harness.rows[0]!)[OpenStackLogAttribute.Level]).toBe(
      "DEBUG",
    );
  });

  test("a traceback its journal handler kept beside it joins it, and does not stay beside it too", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([
        journalRecord("Failed to build", [
          stringAttribute("journald.logger_name", "nova.compute.manager"),
          stringAttribute("journald.logger_level", "ERROR"),
          stringAttribute(
            "journald.exception_info",
            "Traceback (most recent call last):\nValueError: nope",
          ),
        ]),
      ]),
    );

    expect(harness.rows[0]!["body"]).toBe(
      "Failed to build\nTraceback (most recent call last):\nValueError: nope",
    );
    expect(attributesOf(harness.rows[0]!)).not.toHaveProperty(
      "journald.exception_info",
    );
    expect(harness.rows[0]!["attributeKeys"]).not.toContain(
      "journald.exception_info",
    );
    expect(harness.rows[0]!["severityNumber"]).toBe(17);
  });

  test("a project's filters and rules are made sure of once per batch", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([journalRecord(COLOURED), journalRecord(COLOURED)]),
    );

    expect(harness.ensured).toEqual([PROJECT_ID]);
  });
});

describe("a log of anything else", () => {
  test("is left as it came, and asks nothing of OpenStack", async () => {
    const harness: Harness = setup({ cloudId: null });
    const body: string = `ERROR nova.compute.manager [None ${REQUEST} a b] password=not-a-cloud-so-not-ours`;

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest(
        [journalRecord(body)],
        [stringAttribute("service.name", "api")],
      ),
    );

    expect(harness.rows[0]!["body"]).toBe(body);
    expect(harness.rows[0]!["severityNumber"]).toBe(9);
    expect(attributesOf(harness.rows[0]!)).not.toHaveProperty(
      OpenStackLogAttribute.Level,
    );
    expect(harness.ensured).toEqual([]);
    expect(harness.recorded).toEqual([]);
  });
});

describe("a project's default drop filters", () => {
  test.each([
    [
      "a DEBUG line",
      `DEBUG nova.compute.manager [None ${REQUEST} a b] Running periodic task`,
    ],
    [
      "a load balancer's check",
      `INFO nova.api.openstack.requestlog [None ${REQUEST} None None] 10.1.0.200 "OPTIONS /" status: 200 len: 0 microversion: - time: 0.001`,
    ],
    [
      "uWSGI's own line for a check",
      "[pid: 90122|app: 0|req: 1/1] 10.1.0.200 () {56 vars in 1129 bytes} [Wed Nov  4 21:37:49 2026] GET / => generated 267 bytes in 3 msecs (HTTP/1.1 200) 5 headers in 209 bytes (1 switches on core 0)",
    ],
    ["a routine notification", notificationLine("instance.exists")],
    ["Cinder's capacity", notificationLine("capacity.pool")],
  ])("drop %s, as they read it", async (_what: string, body: string) => {
    const harness: Harness = setup({ dropFilters: DEFAULT_DROP_FILTERS });

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([journalRecord(body)]),
    );

    expect(harness.rows).toHaveLength(0);
    expect(harness.recorded).toEqual([]);
  });

  test.each([
    [
      "an INFO line",
      `INFO nova.compute.manager [None ${REQUEST} a b] [instance: ${INSTANCE}] Terminating instance`,
    ],
    [
      "an error",
      `ERROR nova.compute.manager [None ${REQUEST} a b] [instance: ${INSTANCE}] Failed`,
    ],
    [
      "a real request",
      `INFO nova.api.openstack.requestlog [None ${REQUEST} a b] 10.1.0.200 "GET /v2.1/servers" status: 200 len: 1 microversion: 2.90 time: 0.05`,
    ],
    ["a change", notificationLine("instance.create.end")],
    ["a failure", notificationLine("instance.create.error", "ERROR")],
    ["a step", notificationLine("instance.create.start")],
    [
      "a line that is not oslo.log's",
      "a sentence a service printed on its own",
    ],
  ])("keep %s", async (_what: string, body: string) => {
    const harness: Harness = setup({ dropFilters: DEFAULT_DROP_FILTERS });

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([journalRecord(body)]),
    );

    expect(harness.rows).toHaveLength(1);
  });
});

describe("a notification", () => {
  test("is stored as what it says, and handed on with the time it says it happened", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([journalRecord(notificationLine("instance.create.end"))]),
    );

    expect(attributesOf(harness.rows[0]!)).toMatchObject({
      [OpenStackEventAttribute.Type]: "instance.create.end",
      [OpenStackEventAttribute.Importance]: "change",
      [OpenStackEventAttribute.Outcome]: "succeeded",
      [OpenStackLogAttribute.InstanceId]: INSTANCE,
    });
    expect(harness.recorded).toHaveLength(1);
    expect(harness.recorded[0]?.projectId).toBe(PROJECT_ID);
    expect(harness.recorded[0]?.cloudId.toString()).toBe(CLOUD_ID.toString());

    const entry: OpenStackEventBufferEntry = harness.recorded[0]!.entry;

    expect(entry.cloudName).toBe(CLOUD_NAME);
    expect(entry.events).toHaveLength(1);
    expect(entry.events[0]?.time.toISOString()).toBe(
      "2026-11-04T21:52:03.731Z",
    );
    expect(entry.events[0]?.service).toBe("nova-compute");
    expect(entry.events[0]?.host).toBe("compute-01");
    expect(entry.events[0]?.event.part?.id).toBe(INSTANCE);
  });

  test("a routine one a project chose to keep is stored, and still routine", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([journalRecord(notificationLine("instance.exists"))]),
    );

    expect(harness.rows).toHaveLength(1);
    expect(harness.recorded[0]?.entry.events[0]?.event.importance).toBe(
      "routine",
    );
  });

  test("a batch's are handed on together, cloud by cloud", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([
        journalRecord(notificationLine("instance.create.start")),
        journalRecord(notificationLine("instance.create.end")),
        journalRecord(`INFO nova.compute.manager [-] Not one`),
      ]),
    );

    expect(harness.recorded).toHaveLength(1);
    expect(
      harness.recorded[0]?.entry.events.map(
        (recorded: OpenStackRecordedEvent): string => {
          return recorded.event.type;
        },
      ),
    ).toEqual(["instance.create.start", "instance.create.end"]);
  });

  test("of a cloud nobody here has is stored, and goes nowhere else", async () => {
    const harness: Harness = setup({ cloudId: null });

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([journalRecord(notificationLine("instance.create.end"))]),
    );

    expect(harness.rows).toHaveLength(1);
    expect(harness.recorded).toEqual([]);
  });

  test("a global ID on its line says which request it belongs to", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([
        journalRecord(
          notificationLine("port.update.end").replace(
            `[None ${REQUEST} ou-payments admin]`,
            `[${GLOBAL} ${REQUEST} - - - - - -]`,
          ),
        ),
      ]),
    );

    expect(attributesOf(harness.rows[0]!)).toMatchObject({
      [OpenStackLogAttribute.GlobalRequestId]: GLOBAL,
      [OpenStackLogAttribute.RequestId]: REQUEST,
      [OpenStackLogAttribute.RequestRootId]: GLOBAL,
    });
  });
});

describe("one record that cannot be read", () => {
  test("costs the batch nothing", async () => {
    const harness: Harness = setup();

    await OtelLogsIngestService.processLogsFromQueue(
      cloudRequest([
        journalRecord("{not json"),
        { ...journalRecord(""), body: { kvlistValue: { values: [] } } },
        journalRecord(`INFO nova.compute.manager [-] After them`),
      ]),
    );

    expect(harness.rows).toHaveLength(3);
    expect(harness.rows[2]!["body"]).toBe(
      "INFO nova.compute.manager [-] After them",
    );
  });
});

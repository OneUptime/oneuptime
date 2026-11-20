/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced - same idiom as
 * MobileAppResourceNotAHost.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Replaced WITH A FACTORY - an
 * automock would still require, and type-check, the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { HEARTBEAT_ROW_PRESENT } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import InventoryItem, {
  EntityAttributes,
  ExtractedEntity,
} from "Common/Server/Utils/Telemetry/TelemetryEntity";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import {
  HostReadings,
  scanHostReadings,
} from "Common/Server/Utils/Telemetry/HostReadingsScan";
import LogExceptionExtractor, {
  ExtractedLogException,
} from "Common/Server/Utils/Telemetry/LogExceptionExtractor";
import {
  ANDROID_TEMPLATE_GROUP_BY,
  HostAlertTemplate,
  getAllHostAlertTemplates,
  getAndroidHostAlertTemplates,
} from "Common/Types/Monitor/HostAlertTemplates";
import {
  InventoryAssetDetails,
  InventoryAssetField,
  getInventoryAssetDetails,
} from "Common/Utils/Inventory/InventoryAssetDetails";
import Host from "Common/Models/DatabaseModels/Host";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import EntityType from "Common/Types/Telemetry/EntityType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import AndroidAgentPermissions, {
  AndroidAgentPermissionsStatus,
} from "Common/Types/Host/AndroidAgentPermissions";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What the OneUptime Android agent (agents/AndroidAgent) sends for a kiosk,
 * run through the ingest code that files it. The two requests are the
 * agent's own golden files: its GoldenPayloadTest fails when what the agent
 * sends changes, and this suite fails when OneUptime would file it
 * differently. Between them, an Android device:
 *
 *   - is a Host, not a mobile app's RUM telemetry: its resource names the
 *     device in host.name with os.type, and carries none of the markers
 *     (device.id, device.model.identifier, browser.*) that make a client;
 *   - has its telemetry filed under that Host, not under a "service" shared
 *     by the whole fleet: it sends no service.name;
 *   - fills the Hosts list's readings (CPU, memory, disk, booted at), cores,
 *     total memory and agent version, and its labels;
 *   - is one Inventory host, with the asset facts Android and the device
 *     manager give it, and the same item a kiosk app that names the device
 *     the same way reports into (#9590);
 *   - turns other apps' crashes and ANRs, read from Logcat, into unhandled
 *     exceptions;
 *   - feeds the Hosts product's alert templates the metrics they read.
 *
 * All Postgres/Redis access is mocked; the attribute walks run for real.
 */

const FIXTURES: string = path.resolve(
  __dirname,
  "../../../../agents/AndroidAgent/app/src/test/resources/otlp",
);

function fixture(name: string): JSONObject {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES, name), "utf8"),
  ) as JSONObject;
}

const METRICS: JSONObject = fixture("android-agent-metrics.json");
const LOGS: JSONObject = fixture("android-agent-logs.json");

const RESOURCE_METRICS: JSONObject = (
  METRICS["resourceMetrics"] as JSONArray
)[0] as JSONObject;
const RESOURCE_ATTRIBUTES: JSONArray = (
  RESOURCE_METRICS["resource"] as JSONObject
)["attributes"] as JSONArray;
const SCOPE_METRICS: JSONArray = RESOURCE_METRICS["scopeMetrics"] as JSONArray;
const METRIC_LIST: Array<JSONObject> = (
  (SCOPE_METRICS[0] as JSONObject)["metrics"] as JSONArray
).map((metric: unknown) => {
  return metric as JSONObject;
});

const LOG_RECORDS: Array<JSONObject> = (
  (
    ((LOGS["resourceLogs"] as JSONArray)[0] as JSONObject)[
      "scopeLogs"
    ] as JSONArray
  )[0] as JSONObject
)["logRecords"] as Array<JSONObject>;

const DEVICE_NAME: string = "store-0412-kiosk-02";
const PROJECT_ID: ObjectID = ObjectID.generate();
const HOST_ROW_ID: ObjectID = ObjectID.generate();

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

// What a test reads off a spy: the arguments of each call.
type CallRecorder = { mock: { calls: Array<Array<unknown>> } };

// The resource as ingest flattens it for entity extraction.
function flatten(attributes: JSONArray): EntityAttributes {
  return TelemetryUtil.getAttributes({
    items: attributes,
    prefixKeysWithString: "",
  }) as EntityAttributes;
}

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function eventName(record: JSONObject): string | undefined {
  const attribute: JSONObject | undefined = (
    (record["attributes"] as JSONArray | undefined) || []
  ).find((item: unknown) => {
    return (item as JSONObject)["key"] === "event.name";
  }) as JSONObject | undefined;
  return (attribute?.["value"] as JSONObject | undefined)?.["stringValue"] as
    | string
    | undefined;
}

// A log record as the log ingest hands it to the exception extractor.
function extract(record: JSONObject): ExtractedLogException | null {
  return LogExceptionExtractor.extractFromLogRecord({
    body: (record["body"] as JSONObject)["stringValue"] as string,
    attributes: TelemetryUtil.getAttributes({
      items: (record["attributes"] as JSONArray) || [],
      prefixKeysWithString: "",
    }) as JSONObject,
    severityNumber: record["severityNumber"] as number,
    hasTraceAndSpan: false,
  });
}

describe("The Android agent's golden payloads", () => {
  test("are the agent's own files, and hold a device's metrics and logs", () => {
    expect(METRIC_LIST.length).toBeGreaterThan(10);
    expect(LOG_RECORDS.length).toBeGreaterThan(4);
  });
});

describe("An Android device running the agent is a Host", () => {
  let findOrCreateSpy: CallRecorder;
  let updateLastSeenSpy: CallRecorder;
  let labelsSpy: CallRecorder;
  let resolveHostIdSpy: CallRecorder;

  beforeEach(() => {
    OtelIngestBaseService.clearInProcessMemos();

    const host: Host = new Host();
    host._id = HOST_ROW_ID.toString();
    host.projectId = PROJECT_ID;

    findOrCreateSpy = jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockResolvedValue(host) as unknown as CallRecorder;
    updateLastSeenSpy = jest
      .spyOn(HostService, "updateLastSeen")
      .mockResolvedValue(HEARTBEAT_ROW_PRESENT) as unknown as CallRecorder;
    jest.spyOn(HostService, "attachLabels").mockResolvedValue(undefined);
    labelsSpy = jest
      .spyOn(LabelService, "findOrCreateLabelsByNames")
      .mockResolvedValue([]) as unknown as CallRecorder;
    jest.spyOn(baseService, "shouldRunMaintenance").mockResolvedValue(false);
    resolveHostIdSpy = jest
      .spyOn(baseService, "resolveDiscoveredResourceId")
      .mockResolvedValue(HOST_ROW_ID.toString()) as unknown as CallRecorder;
    jest
      .spyOn(baseService, "tryLinkHostToProxmoxGuest")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OtelIngestBaseService.clearInProcessMemos();
  });

  test("its resource is not a mobile app's: no RUM client type", () => {
    expect(baseService["getRumClientType"](RESOURCE_ATTRIBUTES)).toBeNull();
    const keys: Array<string> = RESOURCE_ATTRIBUTES.map((item: unknown) => {
      return (item as JSONObject)["key"] as string;
    });
    expect(keys).not.toContain("device.id");
    expect(keys).not.toContain("device.model.identifier");
    expect(keys).not.toContain("service.name");
  });

  test("autoDiscoverHost registers the device under its name", async () => {
    const hostId: ObjectID | null = await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: RESOURCE_ATTRIBUTES,
      hasInfraSignal: true,
    });

    expect(hostId?.toString()).toBe(HOST_ROW_ID.toString());
    expect(resolveHostIdSpy.mock.calls[0]![0]).toMatchObject({
      kindName: "Host",
      identity: DEVICE_NAME,
    });
  });

  test("its telemetry is filed under that Host, not under a service the whole fleet would share", async () => {
    const request: ExpressRequest = {
      headers: {},
    } as unknown as ExpressRequest;

    expect(
      await baseService["getServiceNameFromAttributes"](
        request,
        RESOURCE_ATTRIBUTES,
      ),
    ).toBeNull();

    const buildSpy: CallRecorder = jest
      .spyOn(OTelIngestService, "buildResourceMetadataForNonService")
      .mockResolvedValue({
        serviceName: `host/${DEVICE_NAME}`,
        primaryEntityId: HOST_ROW_ID,
        primaryEntityType: ServiceType.Host,
      } as TelemetryServiceMetadata) as unknown as CallRecorder;

    const selected: TelemetryServiceMetadata = await baseService[
      "selectPrimaryEntity"
    ]({
      req: request,
      attributes: RESOURCE_ATTRIBUTES,
      projectId: PROJECT_ID,
      hostId: HOST_ROW_ID,
    });

    expect(selected.primaryEntityType).toBe(ServiceType.Host);
    expect(buildSpy.mock.calls[0]![0]).toMatchObject({
      serviceName: `host/${DEVICE_NAME}`,
      resourceId: HOST_ROW_ID,
      primaryEntityType: ServiceType.Host,
    });
  });

  test("its metrics are a machine's: cores and total memory are read from them", () => {
    expect(baseService["scanHostInfraStatsFromMetrics"](SCOPE_METRICS)).toEqual(
      {
        hasInfraSignal: true,
        cpuCores: 8,
        totalMemoryBytes: 4_000_000_000,
      },
    );
  });

  test("the Hosts list reads its CPU, memory, disk and boot time from them", () => {
    const readings: HostReadings = scanHostReadings({
      resourceAttributes: RESOURCE_ATTRIBUTES,
      scopeMetrics: SCOPE_METRICS,
      receivedAt: new Date(),
    });

    // CPU busy is the mean user share plus the mean system share: (0.3 + 0.5) / 2 + (0.1 + 0.2) / 2.
    expect(readings.cpuPercent).toBe(55);
    // Used memory is what is not available: 2.6 GB of 4 GB.
    expect(readings.memoryPercent).toBe(65);
    // Used over used plus free, as df prints it: 44 GB over 63 GB.
    expect(readings.diskPercent).toBe(69.84);
    expect(readings.diskMountpoint).toBe("/data");
    // Booted three days before the reading, kept to the second.
    expect(readings.bootedAt?.getTime()).toBe(
      Math.floor((1_795_076_857_467 - 3 * 86_400_000) / 1000) * 1000,
    );
  });

  test("the metrics batch enrichment writes the Host with the device's facts, readings and labels", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [RESOURCE_METRICS] as JSONArray,
    });

    expect(findOrCreateSpy.mock.calls[0]![0]).toMatchObject({
      hostIdentifier: DEVICE_NAME,
    });
    expect(updateLastSeenSpy.mock.calls[0]![1]).toMatchObject({
      osType: "linux",
      // What makes the Host keep android as its OS (HostOperatingSystem, #9804).
      osName: "Android",
      osVersion: "Android Version 14 (Build UP1A.231005.007 API level 34)",
      hostId: "3f2a9c1b7d4e5a60",
      hostArch: "arm64",
      cpuCores: 8,
      totalMemoryBytes: 4_000_000_000,
      agentVersion: "17.0.12",
      readings: {
        latestCpuPercent: 55,
        latestMemoryPercent: 65,
        latestDiskPercent: 69.84,
        latestDiskMountpoint: "/data",
      },
    });
    expect(
      (updateLastSeenSpy.mock.calls[0]![1] as JSONObject)["hostIpAddresses"],
    ).toContain("10.20.30.40");
    expect(labelsSpy.mock.calls[0]![0]).toMatchObject({
      labelNames: expect.arrayContaining(["store:0412", "region:emea"]),
    });
  });
});

describe("An Android device running the agent is one Inventory item", () => {
  const entities: Array<ExtractedEntity> = InventoryItem.extractEntities({
    projectId: PROJECT_ID.toString(),
    attributes: flatten(RESOURCE_ATTRIBUTES),
  });
  const host: ExtractedEntity | undefined = entities.find(
    (entity: ExtractedEntity): boolean => {
      return entity.entityType === EntityType.Host;
    },
  );

  test("a host identified by its name, with the asset facts Android and the device manager give", () => {
    expect(host).toBeDefined();
    expect(host!.identifyingAttributes).toEqual({ "host.name": DEVICE_NAME });
    expect(host!.descriptiveAttributes).toMatchObject({
      "device.manufacturer": "Elo Touch Solutions",
      "device.model.name": "Elo-i3-15",
      "device.firmware.version": "ELO-I3-15-14.0.0-2024.06",
      "host.serial_number": "ELO123456",
      "device.type": "kiosk",
      "device.location": "Store 0412",
      "os.name": "Android",
      "os.version": "14",
      "os.type": "linux",
      "host.arch": "arm64",
      "host.id": "3f2a9c1b7d4e5a60",
    });
    expect(host!.descriptiveAttributes!["host.ip"]).toContain("10.20.30.40");
  });

  /*
   * #9965 and #9967: what Inventory's Security Patch Level and Agent
   * Permissions filters read off the device's item.
   */
  test("its item keeps the patch level and which grants the agent lacks, which Inventory's filters read", () => {
    expect(host!.descriptiveAttributes).toMatchObject({
      "android.os.security_patch": "2024-06-05",
      "oneuptime.agent.permissions.missing": "none",
    });
    expect(
      AndroidAgentPermissions.getStatus(
        host!.descriptiveAttributes!["oneuptime.agent.permissions.missing"],
      ),
    ).toBe(AndroidAgentPermissionsStatus.Granted);
  });

  test("no other entity: no service, and no mobile app", () => {
    expect(
      entities.map((entity: ExtractedEntity) => {
        return entity.entityType;
      }),
    ).toEqual([EntityType.Host]);
  });

  test("its asset details card reads the device's make, model, serial, OS and type", () => {
    const details: InventoryAssetDetails = getInventoryAssetDetails({
      entityType: EntityType.Host,
      identifyingAttributes: host!.identifyingAttributes,
      descriptiveAttributes: host!.descriptiveAttributes,
    })!;
    const value: (field: InventoryAssetField) => string | undefined = (
      field: InventoryAssetField,
    ): string | undefined => {
      return details.details.find((detail: { field: InventoryAssetField }) => {
        return detail.field === field;
      })?.value;
    };

    expect(value(InventoryAssetField.Hostname)).toBe(DEVICE_NAME);
    expect(value(InventoryAssetField.Manufacturer)).toBe("Elo Touch Solutions");
    expect(value(InventoryAssetField.Model)).toBe("Elo-i3-15");
    expect(value(InventoryAssetField.SerialNumber)).toBe("ELO123456");
    expect(value(InventoryAssetField.FirmwareVersion)).toBe(
      "ELO-I3-15-14.0.0-2024.06",
    );
    expect(value(InventoryAssetField.OperatingSystem)).toBe(
      "Android Version 14 (Build UP1A.231005.007 API level 34)",
    );
    expect(value(InventoryAssetField.OsVersion)).toBe("14");
    // The security patch level the agent reads (#9800).
    expect(value(InventoryAssetField.SecurityPatch)).toBe("2024-06-05");
    expect(value(InventoryAssetField.DeviceType)).toBe("kiosk");
    expect(value(InventoryAssetField.Location)).toBe("Store 0412");
  });

  test("a kiosk app on the same device, naming it the same way, reports into the same item", () => {
    // The resource OpenTelemetry Android builds for the kiosk app (MobileAppResourceNotAHost.test.ts).
    const appEntities: Array<ExtractedEntity> = InventoryItem.extractEntities({
      projectId: PROJECT_ID.toString(),
      attributes: flatten([
        stringAttribute("service.name", "kiosk-ordering"),
        stringAttribute("device.model.identifier", "Elo-i3-15"),
        stringAttribute("device.model.name", "Elo-i3-15"),
        stringAttribute("device.manufacturer", "Elo Touch Solutions"),
        stringAttribute("os.name", "Android"),
        stringAttribute("os.type", "linux"),
        stringAttribute("os.version", "14"),
        stringAttribute("host.name", DEVICE_NAME),
      ] as JSONArray),
    });
    const appHost: ExtractedEntity | undefined = appEntities.find(
      (entity: ExtractedEntity): boolean => {
        return entity.entityType === EntityType.Host;
      },
    );

    expect(appHost?.entityKey).toBe(host!.entityKey);
  });
});

describe("The agent's Logcat records", () => {
  function recordFor(name: string): JSONObject {
    const record: JSONObject | undefined = LOG_RECORDS.find(
      (item: JSONObject) => {
        return eventName(item) === name;
      },
    );
    expect(record).toBeDefined();
    return record!;
  }

  test("another app's crash is an unhandled exception, named after the app", () => {
    // Logcat's crash, DropBox's (with its stack, its card and email redacted) and a native crash.
    const crashes: Array<[string, string, boolean]> = LOG_RECORDS.filter(
      (item: JSONObject) => {
        return eventName(item) === "app.crash";
      },
    ).map((record: JSONObject): [string, string, boolean] => {
      const exception: ExtractedLogException | null = extract(record);
      expect(exception).not.toBeNull();
      return [
        exception!.exceptionType,
        exception!.message,
        Boolean(exception!.escaped),
      ];
    });

    expect(crashes).toEqual([
      [
        "java.lang.IllegalStateException",
        "com.example.kiosk: Card [card number] declined for [email]",
        true,
      ],
      [
        "SIGSEGV",
        "com.example.kiosk: SIGSEGV (SEGV_MAPERR) in libprinter.so (print_job(Job*)+52)",
        true,
      ],
      [
        "java.lang.IllegalStateException",
        "com.example.kiosk: Printer offline",
        true,
      ],
    ]);
  });

  test("an ANR is an unhandled exception of the type ANR", () => {
    const exception: ExtractedLogException | null = extract(
      recordFor("device.anr"),
    );

    expect(exception).not.toBeNull();
    expect(exception!.exceptionType).toBe("ANR");
    expect(exception!.message).toBe(
      "com.example.kiosk: Input dispatching timed out",
    );
    expect(exception!.escaped).toBe(true);
  });

  test("Logcat's lines, a boot, an app in the inventory and the agent's start are plain logs", () => {
    const plain: Array<JSONObject> = LOG_RECORDS.filter(
      (record: JSONObject) => {
        const name: string | undefined = eventName(record);
        return name !== "app.crash" && name !== "device.anr";
      },
    );

    expect(plain.length).toBe(5);
    plain.forEach((record: JSONObject) => {
      expect(extract(record)).toBeNull();
    });
  });
});

describe("The Hosts product's alert templates", () => {
  // The templates an Android device can feed; the others read load, processes, swap, inodes or systemd.
  const SERVED: Array<string> = [
    "host-stopped-reporting",
    "host-high-cpu",
    "host-high-memory",
    "host-high-filesystem",
    "host-restarted",
  ];

  function datapointAttributes(metric: JSONObject): Array<JSONObject> {
    const data: JSONObject = (metric["gauge"] || metric["sum"]) as JSONObject;
    return (data["dataPoints"] as JSONArray).map((point: unknown) => {
      return TelemetryUtil.getAttributes({
        items: ((point as JSONObject)["attributes"] as JSONArray) || [],
        prefixKeysWithString: "",
      }) as JSONObject;
    });
  }

  test.each(SERVED)(
    "%s reads metrics, and attribute values, the agent sends",
    (id: string) => {
      const template: HostAlertTemplate | undefined =
        getAllHostAlertTemplates().find((candidate: HostAlertTemplate) => {
          return candidate.id === id;
        });
      expect(template).toBeDefined();

      const step: string = JSON.stringify(
        template!.getMonitorStep({
          hostIdentifier: DEVICE_NAME,
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: DEVICE_NAME,
        }),
      );
      const names: Array<string> = Array.from(
        step.matchAll(/"metricName":"([^"]+)"/g),
      ).map((match: RegExpMatchArray) => {
        return match[1]!;
      });
      expect(names.length).toBeGreaterThan(0);

      for (const name of names) {
        const metric: JSONObject | undefined = METRIC_LIST.find(
          (candidate: JSONObject) => {
            return candidate["name"] === name;
          },
        );
        expect(metric).toBeDefined();

        // A template filtering on a state reads a datapoint that has it.
        for (const state of Array.from(step.matchAll(/"state":"([^"]+)"/g)).map(
          (match: RegExpMatchArray) => {
            return match[1]!;
          },
        )) {
          if (
            name === "system.cpu.utilization" ||
            name === "system.memory.utilization"
          ) {
            expect(
              datapointAttributes(metric!).some((attributes: JSONObject) => {
                return attributes["state"] === state;
              }),
            ).toBe(true);
          }
        }
      }
    },
  );
});

describe("The Android templates (#9802)", () => {
  const RESOURCE: JSONObject = TelemetryUtil.getAttributes({
    items: RESOURCE_ATTRIBUTES,
    prefixKeysWithString: "",
  }) as JSONObject;

  test.each(
    getAndroidHostAlertTemplates().map((template: HostAlertTemplate) => {
      return [template.id, template];
    }) as Array<[string, HostAlertTemplate]>,
  )(
    "%s reads only metrics the agent sends",
    (_id: string, template: HostAlertTemplate) => {
      const step: string = JSON.stringify(
        template.getMonitorStep({
          hostIdentifier: DEVICE_NAME,
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: DEVICE_NAME,
        }),
      );
      const names: Array<string> = Array.from(
        step.matchAll(/"metricName":"([^"]+)"/g),
      ).map((match: RegExpMatchArray) => {
        return match[1]!;
      });

      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(
          METRIC_LIST.some((candidate: JSONObject) => {
            return candidate["name"] === name;
          }),
        ).toBe(true);
      }
    },
  );

  test("the device's name and API level, which they group by, are on its resource", () => {
    for (const key of ANDROID_TEMPLATE_GROUP_BY) {
      expect(RESOURCE[key.replace(/^resource\./, "")]).toBeDefined();
    }
  });
});

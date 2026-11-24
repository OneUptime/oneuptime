import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DeviceManagementConnection from "../../../../Models/DatabaseModels/DeviceManagementConnection";
import DeviceManagementReadRunner, {
  APPS_NOT_READ_WARNING,
  DeviceManagementReadDependencies,
  DeviceManagementReadOutcome,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementReadRunner";
import DeviceManagementConnectorRegistry from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectorRegistry";
import {
  DeviceManagementSession,
  DeviceManagementSessionOptions,
  DeviceManagementSettings,
  DeviceManagementTransport,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import {
  ManagedDeviceCheckInOutcome,
  ManagedDeviceCheckInRecordInput,
} from "../../../../Server/Utils/DeviceManagement/ManagedDeviceCheckInMetrics";
import { DeviceManagementConnectionReadRecord } from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectionReadMetrics";
import { DeviceManagementConnectionReadOutcome } from "../../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import WorkspaceOneConnector, {
  WORKSPACE_ONE_MAX_APP_DEVICES_PER_READ,
} from "../../../../Server/Utils/DeviceManagement/WorkspaceOne/WorkspaceOneConnector";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import {
  MANAGED_DEVICE_RESOURCE_TYPE,
  ManagedDeviceHostMatch,
} from "../../../../Types/DeviceManagement/ManagedDeviceIdentity";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import {
  EsperDeviceState,
  ManagedDeviceStatus,
  getManagedDeviceStatus,
} from "../../../../Types/DeviceManagement/ManagedDeviceStatus";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../../../Types/ObjectID";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { keyForHost } from "../../../../Utils/Telemetry/EntityKey";
import {
  EgressGuardedTransport,
  createEgressGuardedTransport,
} from "./EgressGuardedTransport";
import {
  FakeDeviceManagementDb,
  installFakeDeviceManagementDb,
} from "./FakeDeviceManagementDb";
import { TestClock, createTestClock } from "./FakeEsperApi";
import {
  FakeSotiApi,
  SOTI_CLIENT_ID,
  SOTI_CLIENT_SECRET,
  SOTI_PASSWORD,
  SOTI_SERVER,
  SOTI_USERNAME,
  buildSotiApp,
  buildSotiDevice,
  buildSotiIpad,
  buildSotiWindows,
} from "./FakeSotiApi";
import {
  FakeWorkspaceOneApi,
  FakeWorkspaceOneRequest,
  WORKSPACE_ONE_CLIENT_ID,
  WORKSPACE_ONE_CLIENT_SECRET,
  WORKSPACE_ONE_SERVER,
  buildWorkspaceOneAndroid,
  buildWorkspaceOneApp,
  buildWorkspaceOneDevice,
  buildWorkspaceOneIpad,
  buildWorkspaceOneWindows,
} from "./FakeWorkspaceOneApi";

/*
 * One read of a Workspace ONE UEM (#10086) or SOTI MobiControl (#10087)
 * connection, end to end: the fake of the service's API on one side,
 * Postgres played by maps on the other. What a read imports, which
 * devices are online, each device as ONE Inventory host shared with the
 * Android agent's, names two devices share, the apps on each service's
 * own terms (Workspace ONE's capped for its daily quota), check-ins
 * written only from a whole list, and every failure recorded without a
 * secret - an address the egress guard refuses included.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const START: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

let clock: TestClock;
let db: FakeDeviceManagementDb;
let connection: DeviceManagementConnection;
let checkInRecords: Array<ManagedDeviceCheckInRecordInput> = [];
let connectionReadings: Array<DeviceManagementConnectionReadRecord> = [];

function dependencies(
  transport: DeviceManagementTransport,
): DeviceManagementReadDependencies {
  return {
    transport,
    now: clock.now,
    sleep: clock.sleep,
    random: (): number => {
      return 0.5;
    },
    isTelemetryAllowed: async (): Promise<boolean> => {
      return true;
    },
    recordCheckIns: async (
      data: ManagedDeviceCheckInRecordInput,
    ): Promise<ManagedDeviceCheckInOutcome> => {
      checkInRecords.push(data);
      return {
        readingCount: 0,
        hostCount: 0,
        securityPatchReadingCount: 0,
        batteryReadingCount: 0,
        chargingReadingCount: 0,
        storageReadingCount: 0,
      };
    },
    // The connection's own readings (#10006): ClickHouse is not played here.
    recordConnectionReadings: async (
      records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
    ): Promise<number> => {
      connectionReadings.push(...records);
      return records.length;
    },
  };
}

async function run(
  transport: DeviceManagementTransport,
): Promise<DeviceManagementReadOutcome> {
  return DeviceManagementReadRunner.run(CONNECTION, dependencies(transport));
}

function lastRecord(): JSONObject {
  expect(db.recorded.length).toBeGreaterThan(0);
  return db.recorded[db.recorded.length - 1]!;
}

function deviceRow(providerDeviceId: string): JSONObject {
  const row: JSONObject | undefined = Array.from(db.devices.values()).find(
    (device: JSONObject): boolean => {
      return device["providerDeviceId"] === providerDeviceId;
    },
  );

  expect(row).toBeDefined();
  return row!;
}

function itemOf(providerDeviceId: string): JSONObject {
  const id: unknown = deviceRow(providerDeviceId)["inventoryItemId"];
  expect(id).toBeTruthy();
  const item: JSONObject | undefined = db.items.get(String(id));
  expect(item).toBeDefined();
  return item!;
}

function hostKey(hostName: string): string {
  return keyForHost(PROJECT.toString(), hostName.trim().toLowerCase());
}

// A host the Android agent reports, as the ingest reconciler writes one.
function agentHost(hostName: string): string {
  return db.addItem({
    projectId: PROJECT.toString(),
    entityType: EntityType.Host,
    entityKey: hostKey(hostName),
    source: EntitySource.Discovered,
    identifyingAttributes: { "host.name": hostName.toLowerCase() },
    descriptiveAttributes: { "os.type": "linux", "os.name": "Android" },
    displayName: hostName.toLowerCase(),
    isArchived: false,
    lastSeenAt: new Date(START.getTime() - 2 * MINUTE),
  });
}

function appsOf(providerDeviceId: string): Array<string> {
  const id: string = String(deviceRow(providerDeviceId)["_id"]);

  return Array.from(db.apps.values())
    .filter((app: JSONObject): boolean => {
      return String(app["managedDeviceId"]) === id;
    })
    .map((app: JSONObject): string => {
      return `${app["packageName"]} ${app["versionName"]}`;
    });
}

function statusOf(providerDeviceId: string): ManagedDeviceStatus {
  const row: JSONObject = deviceRow(providerDeviceId);

  return getManagedDeviceStatus({
    providerState:
      typeof row["providerState"] === "number"
        ? (row["providerState"] as number)
        : null,
    lastCheckInAt: row["lastCheckInAt"] as string | undefined,
    removedAt: row["removedAt"] as string | undefined,
    provider: String(connection.provider),
    platform: row["platform"] as string | undefined,
    now: clock.now(),
  });
}

beforeEach(() => {
  clock = createTestClock(START);
  connection = new DeviceManagementConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.isEnabled = true;
  connection.pullState = {};
  db = installFakeDeviceManagementDb(connection);
  checkInRecords = [];
  connectionReadings = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Workspace ONE UEM connection", () => {
  let api: FakeWorkspaceOneApi;

  function workspaceOneDevices(): Array<JSONObject> {
    return [
      buildWorkspaceOneDevice({
        LastSeen: new Date(START.getTime() - 2 * HOUR)
          .toISOString()
          .replace("Z", ""),
      }),
      buildWorkspaceOneIpad({
        LastSeen: new Date(START.getTime() - 30 * HOUR)
          .toISOString()
          .replace("Z", ""),
      }),
      buildWorkspaceOneWindows(),
      buildWorkspaceOneAndroid(),
      buildWorkspaceOneDevice({
        Id: { Value: 19 },
        SerialNumber: "OLD0000001",
        DeviceReportedName: "Retired phone",
        EnrollmentStatus: "Unenrolled",
      }),
    ];
  }

  beforeEach(() => {
    api = new FakeWorkspaceOneApi({
      devices: workspaceOneDevices(),
      apps: {
        "18": [
          buildWorkspaceOneApp({
            ApplicationIdentifier: "com.zebra.scanner",
            ApplicationName: "Scanner",
            Version: "4.2.0",
          }),
          buildWorkspaceOneApp({
            ApplicationIdentifier: "com.example.gone",
            Status: "Removed",
          }),
        ],
      },
    });
    connection.name = "Workspace ONE as1234.awmdm.com";
    connection.provider = DeviceManagementProvider.WorkspaceOne;
    connection.config = {
      tenant: WORKSPACE_ONE_SERVER,
      authMethod: "oauth",
      region: "na",
      clientId: WORKSPACE_ONE_CLIENT_ID,
      readIntervalInMinutes: 15,
    };
    connection.secrets = JSON.stringify({
      clientSecret: WORKSPACE_ONE_CLIENT_SECRET,
    });
  });

  test("imports every enrolled device with what it runs, its organization group and its last report", async () => {
    const outcome: DeviceManagementReadOutcome = await run(api.transport);

    expect(outcome.status).toBe("success");
    expect(db.devices.size).toBe(4);
    expect(deviceRow("18")).toMatchObject({
      platform: ManagedDevicePlatform.Android,
      deviceName: "WH-SCANNER-07",
      serialNumber: "R5CR30ABCDE",
      securityPatchLevel: "2026-10-01",
      groupName: "Warehouse",
    });
    expect(deviceRow("16")["platform"]).toBe(ManagedDevicePlatform.IPadOS);
    expect(new Date(String(deviceRow("15")["lastCheckInAt"]))).toEqual(
      new Date(START.getTime() - 2 * HOUR),
    );
    // A report 30 hours ago is offline; 2 hours ago is not.
    expect(statusOf("16")).toBe(ManagedDeviceStatus.Offline);
    expect(statusOf("15")).toBe(ManagedDeviceStatus.Online);
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      status: "success",
      tenant: WORKSPACE_ONE_SERVER,
      deviceCount: 4,
      groupCount: 2,
    });
  });

  test("each device is one host in Inventory, named as it reports itself, with Workspace ONE's facts", async () => {
    await run(api.transport);

    const pc: JSONObject = itemOf("17");

    expect(pc["entityKey"]).toBe(hostKey("DESKTOP-7KQ2M1"));
    expect(pc["resourceType"]).toBe(MANAGED_DEVICE_RESOURCE_TYPE);
    expect(pc["descriptiveAttributes"]).toMatchObject({
      "os.name": "Windows",
      "host.serial_number": "PF3ABCDE",
      "workspaceone.device.id": "17",
      "workspaceone.device.name": "DESKTOP-7KQ2M1",
      "workspaceone.group": "Stores West",
    });
    // Nothing about its user, under any key.
    expect(JSON.stringify(Array.from(db.items.values()))).not.toContain(
      "megan",
    );
    expect(JSON.stringify(Array.from(db.devices.values()))).not.toContain(
      "megan@contoso.com",
    );
  });

  test("the Android agent's host is the scanner's, by its serial number: one device, not two", async () => {
    const host: string = agentHost("R5CR30ABCDE");

    await run(api.transport);

    expect(deviceRow("18")).toMatchObject({
      inventoryItemId: host,
      inventoryMatch: ManagedDeviceHostMatch.SerialNumber,
    });
    expect(
      Array.from(db.items.values()).filter((item: JSONObject): boolean => {
        return item["entityKey"] === hostKey("WH-SCANNER-07");
      }),
    ).toHaveLength(0);
  });

  test("two devices that report the same name are two hosts, each by its serial number", async () => {
    api = new FakeWorkspaceOneApi({
      devices: [
        buildWorkspaceOneDevice({
          Id: { Value: 31 },
          DeviceReportedName: "iPhone",
          SerialNumber: "F2LXK1AAAAAA",
        }),
        buildWorkspaceOneDevice({
          Id: { Value: 32 },
          DeviceReportedName: "iPhone",
          SerialNumber: "F2LXK1BBBBBB",
        }),
      ],
    });

    await run(api.transport);

    expect(itemOf("31")["entityKey"]).toBe(hostKey("F2LXK1AAAAAA"));
    expect(itemOf("32")["entityKey"]).toBe(hostKey("F2LXK1BBBBBB"));
  });

  test("a device unenrolled since the last read is marked removed, and its host archived", async () => {
    await run(api.transport);

    api = new FakeWorkspaceOneApi({
      devices: [
        ...workspaceOneDevices().slice(0, 3),
        buildWorkspaceOneAndroid({ EnrollmentStatus: "Unenrolled" }),
      ],
    });
    clock.advance(16 * MINUTE);
    await run(api.transport);

    expect(deviceRow("18")["removedAt"]).toBeTruthy();
    expect(itemOf("18")["isArchived"]).toBe(true);
  });

  test("a device's apps are read, an app it no longer has left out", async () => {
    await run(api.transport);

    expect(appsOf("18")).toEqual(["com.zebra.scanner 4.2.0"]);
  });

  test("at most 25 devices' apps a read, and the others wait for the next scheduled read, not one a minute away", async () => {
    const many: Array<JSONObject> = [];

    for (let index: number = 0; index < 40; index++) {
      many.push(
        buildWorkspaceOneDevice({
          Id: { Value: 500 + index },
          DeviceReportedName: `Kiosk ${index}`,
          SerialNumber: `SNK${String(index).padStart(6, "0")}`,
        }),
      );
    }

    api = new FakeWorkspaceOneApi({ devices: many });
    const outcome: DeviceManagementReadOutcome = await run(api.transport);

    const appRequests: number = api.requests.filter(
      (request: FakeWorkspaceOneRequest): boolean => {
        return request.path.endsWith("/apps");
      },
    ).length;

    expect(appRequests).toBe(WORKSPACE_ONE_MAX_APP_DEVICES_PER_READ);
    expect(outcome.status).toBe("success");
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      appsReadDeviceCount: 25,
      appsWaitingDeviceCount: 15,
    });
    expect(new Date(String(lastRecord()["nextPullAt"]))).toEqual(
      new Date(START.getTime() + 15 * MINUTE),
    );
  });

  test("a role that may not read apps: one refused request, a warning, and no read brought forward", async () => {
    api.script("/api/mdm/devices/15/apps", [
      {
        status: 403,
        body: {
          errorCode: 1011,
          message:
            "User doesn't have sufficient permissions to perform this operation.",
        },
      },
    ]);

    const outcome: DeviceManagementReadOutcome = await run(api.transport);

    expect(outcome.status).toBe("success");
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      warnings: [APPS_NOT_READ_WARNING],
      appsReadDeviceCount: 0,
    });
    expect(
      api.requests.filter((request: FakeWorkspaceOneRequest): boolean => {
        return request.path.endsWith("/apps");
      }),
    ).toHaveLength(1);
    expect(new Date(String(lastRecord()["nextPullAt"]))).toEqual(
      new Date(START.getTime() + 15 * MINUTE),
    );
  });

  test("its check-ins are written once its device list was read whole, for its service", async () => {
    await run(api.transport);

    expect(checkInRecords).toHaveLength(1);
    expect(checkInRecords[0]).toMatchObject({
      provider: DeviceManagementProvider.WorkspaceOne,
    });
    // At the end of the list: the time it was read, after the paced requests.
    expect(checkInRecords[0]!.asOf.getTime()).toBeGreaterThanOrEqual(
      START.getTime(),
    );
    expect(checkInRecords[0]!.asOf.getTime()).toBeLessThan(
      START.getTime() + MINUTE,
    );
  });

  test("a device list cut short: nothing marked removed, no check-ins written, the read carried on", async () => {
    await run(api.transport);
    checkInRecords = [];

    jest
      .spyOn(
        DeviceManagementConnectorRegistry.getConnector(
          DeviceManagementProvider.WorkspaceOne,
        ),
        "openSession",
      )
      .mockImplementation(
        (
          settings: DeviceManagementSettings,
          options: DeviceManagementSessionOptions,
        ): DeviceManagementSession => {
          // The token only: the list's first page is past the budget.
          return new WorkspaceOneConnector().openSession(settings, {
            ...options,
            maxRequests: 1,
          });
        },
      );

    clock.advance(16 * MINUTE);
    const outcome: DeviceManagementReadOutcome = await run(api.transport);

    expect(outcome.status).toBe("partial");
    expect(deviceRow("18")["removedAt"]).toBeFalsy();
    expect(checkInRecords).toEqual([]);
  });

  test("a refused OAuth client: the read fails, says why, waits an hour, and never the secret", async () => {
    connection.secrets = JSON.stringify({
      clientSecret: "WRONGSECRET0000000000000000000000",
    });

    const outcome: DeviceManagementReadOutcome = await run(api.transport);

    expect(outcome.status).toBe("failed");
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      failureKind: LlmConnectionFailureKind.Authentication,
    });
    expect(String(lastRecord()["lastError"])).toContain("invalid_client");
    expect(JSON.stringify(db.recorded)).not.toContain("WRONGSECRET");
    expect(new Date(String(lastRecord()["nextPullAt"]))).toEqual(
      new Date(START.getTime() + HOUR),
    );
  });

  // #10006: the connection's own reading, for its alert.
  test("every read writes the connection's own reading: 0 once it reads, and why when its sign-in is refused", async () => {
    connection.lastSuccessfulPullAt = new Date(START.getTime() - 40 * MINUTE);

    await run(api.transport);

    expect(connectionReadings).toHaveLength(1);
    expect(connectionReadings[0]!.reading).toMatchObject({
      provider: DeviceManagementProvider.WorkspaceOne,
      outcome: DeviceManagementConnectionReadOutcome.Success,
    });

    connection.secrets = JSON.stringify({
      clientSecret: "WRONGSECRET0000000000000000000000",
    });
    clock.advance(16 * MINUTE);
    await run(api.transport);

    expect(connectionReadings).toHaveLength(2);
    expect(connectionReadings[1]!.reading).toMatchObject({
      provider: DeviceManagementProvider.WorkspaceOne,
      outcome: DeviceManagementConnectionReadOutcome.Failed,
      failureKind: LlmConnectionFailureKind.Authentication,
      lastSuccessfulReadAt: connection.lastSuccessfulPullAt,
    });
    expect(String(connectionReadings[1]!.reading.lastError)).toContain(
      "invalid_client",
    );
    expect(JSON.stringify(connectionReadings)).not.toContain("WRONGSECRET");
  });

  test("a server the egress guard refuses: nothing is read from it, and the read says so", async () => {
    const guard: EgressGuardedTransport = createEgressGuardedTransport({
      inner: api.transport,
      addresses: {
        "na.uemauth.workspaceone.com": [["52.10.20.30"]],
        [WORKSPACE_ONE_SERVER]: [["169.254.169.254"]],
      },
      blockPrivateAddresses: true,
    });

    const outcome: DeviceManagementReadOutcome = await run(guard.transport);

    expect(outcome.status).toBe("failed");
    expect(String(lastRecord()["lastError"])).toContain(
      "OneUptime did not connect to the Workspace ONE UEM server",
    );
    expect(db.devices.size).toBe(0);
    expect(
      api.requests.filter((request: FakeWorkspaceOneRequest): boolean => {
        return request.host === WORKSPACE_ONE_SERVER;
      }),
    ).toHaveLength(0);
  });
});

describe("a SOTI MobiControl connection", () => {
  let api: FakeSotiApi;

  beforeEach(() => {
    api = new FakeSotiApi({
      devices: [
        buildSotiDevice(),
        buildSotiIpad(),
        buildSotiWindows(),
        buildSotiDevice({
          DeviceId: "35-DISABLED",
          DeviceName: "Spare scanner",
          HardwareSerialNumber: "21075B2C3E",
          Mode: "Disabled",
          IsAgentOnline: false,
        }),
      ],
      apps: {
        "35-8C4F2A9B1D7E": [
          buildSotiApp(),
          buildSotiApp({
            ApplicationId: "com.example.queued",
            Status: "Queued",
          }),
        ],
      },
    });
    connection.name = "SOTI acme.mobicontrolcloud.com";
    connection.provider = DeviceManagementProvider.Soti;
    connection.config = {
      tenant: SOTI_SERVER,
      clientId: SOTI_CLIENT_ID,
      username: SOTI_USERNAME,
      readIntervalInMinutes: 15,
    };
    connection.secrets = JSON.stringify({
      clientSecret: SOTI_CLIENT_SECRET,
      password: SOTI_PASSWORD,
    });
  });

  test("imports every managed device; a connected agent is there now, a disconnected one since it left", async () => {
    const outcome: DeviceManagementReadOutcome = await run(api.transport);

    expect(outcome.status).toBe("success");
    expect(db.devices.size).toBe(4);
    expect(
      new Date(String(deviceRow("35-8C4F2A9B1D7E")["lastCheckInAt"])),
    ).toEqual(START);
    expect(statusOf("35-8C4F2A9B1D7E")).toBe(ManagedDeviceStatus.Online);
    // Its agent disconnected two hours ago: a heartbeat device, offline after 30 minutes.
    expect(statusOf("WIN-5D1C2B3A4E5F")).toBe(ManagedDeviceStatus.Offline);
    // An iPad checked in through Apple's push 7.5 hours ago: online for a day.
    expect(statusOf("IOS-00008110001A2B3C")).toBe(ManagedDeviceStatus.Online);
    // Disabled by an administrator: never "stopped checking in".
    expect(deviceRow("35-DISABLED")["providerState"]).toBe(
      EsperDeviceState.Disabled,
    );
    expect(statusOf("35-DISABLED")).toBe(ManagedDeviceStatus.Disabled);
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      deviceCount: 4,
      onlineCount: 2,
      offlineCount: 1,
    });
  });

  test("each device is one host in Inventory, named by its MobiControl name, with SOTI's facts and its group's path", async () => {
    await run(api.transport);

    const scanner: JSONObject = itemOf("35-8C4F2A9B1D7E");

    expect(scanner["entityKey"]).toBe(hostKey("WH-SCANNER-07"));
    expect(scanner["descriptiveAttributes"]).toMatchObject({
      "os.name": "Android",
      "host.serial_number": "21075B2C3D",
      "soti.device.id": "35-8C4F2A9B1D7E",
      "soti.device.name": "WH-SCANNER-07",
      "soti.group": "Acme/Warehouses/Dallas",
      "android.os.security_patch": "2026-10-01",
    });
    expect(JSON.stringify(Array.from(db.items.values()))).not.toContain(
      "mbowen",
    );
  });

  test("the Android agent's host is the scanner's, by its serial number", async () => {
    const host: string = agentHost("21075B2C3D");

    await run(api.transport);

    expect(deviceRow("35-8C4F2A9B1D7E")).toMatchObject({
      inventoryItemId: host,
      inventoryMatch: ManagedDeviceHostMatch.SerialNumber,
    });
  });

  test("every due device's apps are read, an app still queued left out", async () => {
    await run(api.transport);

    expect(appsOf("35-8C4F2A9B1D7E")).toEqual(["com.example.scanner 4.2.0"]);
    expect(deviceRow("WIN-5D1C2B3A4E5F")["appCount"]).toBe(0);
  });

  test("check-ins are written for its service once its list was read whole", async () => {
    await run(api.transport);

    expect(checkInRecords).toHaveLength(1);
    expect(checkInRecords[0]).toMatchObject({
      provider: DeviceManagementProvider.Soti,
    });
  });

  test("a refused user: the read fails, says why, and never the password", async () => {
    connection.secrets = JSON.stringify({
      clientSecret: SOTI_CLIENT_SECRET,
      password: "not the password",
    });

    const outcome: DeviceManagementReadOutcome = await run(api.transport);

    expect(outcome.status).toBe("failed");
    expect(String(lastRecord()["lastError"])).toContain("invalid_grant");
    expect(JSON.stringify(db.recorded)).not.toContain("not the password");
    expect(JSON.stringify(db.recorded)).not.toContain(SOTI_CLIENT_SECRET);

    // #10006: the connection's own reading says it failed, and why, without the password.
    expect(connectionReadings).toHaveLength(1);
    expect(connectionReadings[0]!.reading).toMatchObject({
      provider: DeviceManagementProvider.Soti,
      outcome: DeviceManagementConnectionReadOutcome.Failed,
      lastError: lastRecord()["lastError"],
    });
    expect(JSON.stringify(connectionReadings)).not.toContain(
      "not the password",
    );
    expect(JSON.stringify(connectionReadings)).not.toContain(
      SOTI_CLIENT_SECRET,
    );
  });

  test("a server on a private network, on OneUptime Cloud: refused before the sign-in, nothing read", async () => {
    const guard: EgressGuardedTransport = createEgressGuardedTransport({
      inner: api.transport,
      addresses: { [SOTI_SERVER]: [["10.8.0.12"]] },
      blockPrivateAddresses: true,
    });

    const outcome: DeviceManagementReadOutcome = await run(guard.transport);

    expect(outcome.status).toBe("failed");
    expect(api.requests).toHaveLength(0);
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      failureKind: LlmConnectionFailureKind.Settings,
    });
  });
});

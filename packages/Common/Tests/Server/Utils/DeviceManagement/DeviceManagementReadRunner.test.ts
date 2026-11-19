import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DeviceManagementConnection from "../../../../Models/DatabaseModels/DeviceManagementConnection";
import DeviceManagementReadRunner, {
  APPS_NOT_READ_WARNING,
  CHECK_INS_NOT_RECORDED_WARNING,
  CHECK_IN_WINDOW_MAX_MS,
  CHECK_IN_WINDOW_OVERLAP_MS,
  DeviceManagementReadDependencies,
  DeviceManagementReadOutcome,
  INVENTORY_NOT_RECORDED_WARNING,
  getAppsDueDevices,
  getCheckInLookups,
  getCheckInWindowStart,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementReadRunner";
import DeviceManagementConnectorRegistry from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectorRegistry";
import {
  DeviceManagementConnector,
  DeviceManagementFleetRead,
  DeviceManagementSession,
  DeviceManagementSessionOptions,
  DeviceManagementSettings,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import {
  ManagedDeviceCheckInOutcome,
  ManagedDeviceCheckInRecordInput,
} from "../../../../Server/Utils/DeviceManagement/ManagedDeviceCheckInMetrics";
import { DeviceManagementReadSummary } from "../../../../Types/DeviceManagement/DeviceManagementReadSummary";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import {
  MANAGED_DEVICE_RESOURCE_TYPE,
  ManagedDeviceHostMatch,
} from "../../../../Types/DeviceManagement/ManagedDeviceIdentity";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../../../Types/ObjectID";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { keyForHost } from "../../../../Utils/Telemetry/EntityKey";
import {
  ESPER_ENTERPRISE_ID,
  ESPER_TENANT,
  buildEsperApp,
  buildEsperAppleDevice,
  buildEsperDevice,
  buildEsperGroup,
} from "./EsperFixtures";
import {
  FAKE_ESPER_API_KEY,
  FakeEsperApi,
  FakeEsperRequest,
  TestClock,
  createFakeEsperApi,
  createTestClock,
} from "./FakeEsperApi";
import {
  FakeDeviceManagementDb,
  installFakeDeviceManagementDb,
} from "./FakeDeviceManagementDb";

/*
 * One read of one Esper connection, end to end: the fake of Esper's API on
 * one side, Postgres played by maps on the other. What a read imports
 * (devices, groups, check-ins, apps), what it keeps current (changes,
 * devices that leave Esper and come back, apps on their own clock), how
 * each device becomes ONE Inventory host with its telemetry, and what it
 * records on the connection - including every failure, without the key.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const START: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const KIOSK_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const KIOSK_B: string = "aaaaaaaa-0000-4000-8000-000000000002";
const IPAD: string = "aaaaaaaa-0000-4000-8000-000000000003";
const PC: string = "aaaaaaaa-0000-4000-8000-000000000004";
const GROUP_WEST: string = "bbbbbbbb-0000-4000-8000-000000000001";

let clock: TestClock;
let api: FakeEsperApi;
let db: FakeDeviceManagementDb;
let connection: DeviceManagementConnection;

function devices(): Array<JSONObject> {
  return [
    buildEsperDevice({
      id: KIOSK_A,
      name: "ESP-ID-AAAAW",
      alias: "Store 0412 Kiosk 1",
      serial: "R9KT30ABC12",
      groupId: GROUP_WEST,
      batteryLevel: 87,
    }),
    buildEsperDevice({
      id: KIOSK_B,
      name: "ESP-ID-AAAAX",
      serial: "R9KT30ABC13",
      groupId: GROUP_WEST,
      isKiosk: false,
      state: 60,
    }),
    // Esper's Windows devices are not imported.
    buildEsperDevice({ id: PC, name: "ESP-ID-WIN01", platform: "WINDOWS" }),
  ];
}

// An iPad of the tenant, last seen three hours ago (#9837).
function ipad(
  overrides: Partial<Parameters<typeof buildEsperAppleDevice>[0]> = {},
): JSONObject {
  return buildEsperAppleDevice({
    id: IPAD,
    name: "ESP-ID-IPAD1",
    alias: "Front counter iPad",
    serial: "DMPXK2ABQ1GC",
    os: "iPadOS",
    groupId: GROUP_WEST,
    lastSeen: new Date(START.getTime() - 3 * HOUR).toISOString(),
    ...overrides,
  });
}

/*
 * The devices' check-in readings each read writes (#9835), caught here:
 * ClickHouse is not played by the maps. ManagedDeviceCheckInMetrics has
 * tests of its own.
 */
let checkInRecords: Array<ManagedDeviceCheckInRecordInput> = [];

function dependencies(
  overrides: Partial<DeviceManagementReadDependencies> = {},
): DeviceManagementReadDependencies {
  return {
    transport: api.transport,
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
      return { readingCount: 0, hostCount: 0 };
    },
    ...overrides,
  };
}

async function run(
  overrides: Partial<DeviceManagementReadDependencies> = {},
): Promise<DeviceManagementReadOutcome> {
  return await DeviceManagementReadRunner.run(
    CONNECTION,
    dependencies(overrides),
  );
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

// A host telemetry reports, as the ingest reconciler writes one.
function telemetryHost(data: {
  hostName: string;
  attributes?: JSONObject;
}): string {
  return db.addItem({
    projectId: PROJECT.toString(),
    entityType: EntityType.Host,
    entityKey: hostKey(data.hostName),
    source: EntitySource.Discovered,
    identifyingAttributes: { "host.name": data.hostName.toLowerCase() },
    descriptiveAttributes: {
      "os.type": "linux",
      "os.name": "Android",
      "os.description":
        "Android Version 13 (Build TKQ1.221114.001 API level 33)",
      ...(data.attributes || {}),
    },
    displayName: data.hostName.toLowerCase(),
    isArchived: false,
    lastSeenAt: new Date(START.getTime() - 2 * MINUTE),
  });
}

beforeEach(() => {
  clock = createTestClock(START);
  api = createFakeEsperApi({
    now: clock.now,
    devices: devices(),
    groups: [
      buildEsperGroup({
        id: GROUP_WEST,
        name: "West",
        path: "All Devices/Stores/West",
      }),
    ],
    heartbeats: {
      [KIOSK_A]: new Date(START.getTime() - 4 * MINUTE),
      [KIOSK_B]: new Date(START.getTime() - 3 * HOUR),
    },
    apps: {
      [KIOSK_A]: [
        buildEsperApp({
          deviceId: KIOSK_A,
          packageName: "com.example.kiosk",
          appName: "Ordering Kiosk",
          versionName: "2.4.1",
          versionCode: "241",
          isKioskApp: true,
        }),
        buildEsperApp({
          deviceId: KIOSK_A,
          packageName: "io.esper.agent",
          appName: "Esper Agent",
          versionName: "8.00.0764",
        }),
      ],
    },
  });

  connection = new DeviceManagementConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.name = "Esper acme";
  connection.provider = DeviceManagementProvider.Esper;
  connection.config = { tenant: ESPER_TENANT, readIntervalInMinutes: 15 };
  connection.secrets = JSON.stringify({ apiKey: FAKE_ESPER_API_KEY });
  connection.isEnabled = true;
  connection.pullState = {};

  db = installFakeDeviceManagementDb(connection);
  checkInRecords = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what is not read", () => {
  test("a connection that is off, or gone, is skipped without a trace", async () => {
    connection.isEnabled = false;
    expect((await run()).status).toBe("skipped");

    db.connection = null as unknown as DeviceManagementConnection;
    expect((await run()).status).toBe("skipped");

    expect(db.recorded).toEqual([]);
    expect(api.requests).toEqual([]);
  });

  test("a plan without telemetry reads nothing, says why, and asks again a day later", async () => {
    const outcome: DeviceManagementReadOutcome = await run({
      isTelemetryAllowed: async (): Promise<boolean> => {
        return false;
      },
    });

    expect(outcome.status).toBe("skipped");
    expect(api.requests).toEqual([]);
    expect(lastRecord()["lastError"]).toMatch(
      /not part of this project's plan/,
    );
    expect(new Date(lastRecord()["nextPullAt"] as string).getTime()).toBe(
      START.getTime() + DAY,
    );
  });
});

describe("the first read", () => {
  test("imports every Android device with its group, check-in and apps", async () => {
    const outcome: DeviceManagementReadOutcome = await run();

    expect(outcome.status).toBe("success");
    // The Windows device is not imported.
    expect(db.devices.size).toBe(2);
    expect(deviceRow(KIOSK_A)["platform"]).toBe(ManagedDevicePlatform.Android);

    const kiosk: JSONObject = deviceRow(KIOSK_A);

    expect(kiosk).toMatchObject({
      projectId: PROJECT.toString(),
      connectionId: CONNECTION.toString(),
      deviceName: "ESP-ID-AAAAW",
      alias: "Store 0412 Kiosk 1",
      serialNumber: "R9KT30ABC12",
      manufacturer: "Elo Touch Solutions",
      model: "I-Series 4",
      osVersion: "13",
      buildNumber: "TKQ1.221114.001",
      securityPatchLevel: "2024-09-01",
      groupName: "West",
      groupPath: "All Devices/Stores/West",
      isKioskMode: true,
      batteryLevel: 87,
      appCount: 2,
    });
    expect(new Date(kiosk["lastCheckInAt"] as string)).toEqual(
      new Date(START.getTime() - 4 * MINUTE),
    );
    expect(new Date(deviceRow(KIOSK_B)["lastCheckInAt"] as string)).toEqual(
      new Date(START.getTime() - 3 * HOUR),
    );

    const apps: Array<JSONObject> = Array.from(db.apps.values()).filter(
      (app: JSONObject): boolean => {
        return app["managedDeviceId"] === kiosk["_id"];
      },
    );

    expect(
      apps
        .map((app: JSONObject): string => {
          return `${app["packageName"]}@${app["versionName"]}${app["isKioskApp"] ? " (kiosk)" : ""}`;
        })
        .sort(),
    ).toEqual(["com.example.kiosk@2.4.1 (kiosk)", "io.esper.agent@8.00.0764"]);
  });

  test("records what it found on the connection, and when it reads next", async () => {
    await run();

    const record: JSONObject = lastRecord();
    const summary: DeviceManagementReadSummary = record[
      "lastPullResult"
    ] as unknown as DeviceManagementReadSummary;

    expect(record["lastError"]).toBeNull();
    expect(new Date(record["lastSuccessfulPullAt"] as string)).toEqual(START);
    expect(new Date(record["nextPullAt"] as string).getTime()).toBe(
      START.getTime() + 15 * MINUTE,
    );
    expect(summary).toMatchObject({
      status: "success",
      tenant: ESPER_TENANT,
      role: "Viewer",
      deviceCount: 2,
      onlineCount: 1,
      offlineCount: 1,
      addedCount: 2,
      changedCount: 0,
      removedCount: 0,
      groupCount: 1,
      matchedHostCount: 0,
      appsReadDeviceCount: 2,
      appsWaitingDeviceCount: 0,
      isDeviceListComplete: true,
      wasRateLimited: false,
      warnings: [],
    });
    expect(summary.requestCount).toBe(api.requests.length);

    // The next window starts where this one ended: when it was read.
    const cursor: number = Date.parse(
      (record["pullState"] as JSONObject)["checkInCursor"] as string,
    );

    expect(cursor).toBeGreaterThanOrEqual(START.getTime());
    expect(cursor).toBeLessThanOrEqual(clock.now().getTime());
  });

  test("makes each device one host in Inventory, owned by the device", async () => {
    await run();

    const host: JSONObject = itemOf(KIOSK_A);

    expect(host).toMatchObject({
      projectId: PROJECT.toString(),
      entityType: EntityType.Host,
      entityKey: hostKey("ESP-ID-AAAAW"),
      source: EntitySource.Inventory,
      identifyingAttributes: { "host.name": "esp-id-aaaaw" },
      displayName: "Store 0412 Kiosk 1",
      resourceType: MANAGED_DEVICE_RESOURCE_TYPE,
      resourceId: deviceRow(KIOSK_A)["_id"],
    });
    expect(host["descriptiveAttributes"]).toEqual({
      "host.serial_number": "R9KT30ABC12",
      "device.manufacturer": "Elo Touch Solutions",
      "device.model.name": "I-Series 4",
      "device.firmware.version": "TKQ1.221114.001",
      "os.name": "Android",
      "os.version": "13",
      "host.ip": "10.40.12.31",
      "host.mac": "A4-C1-38-00-12-7F",
      "device.type": "kiosk",
      "esper.device.id": KIOSK_A,
      "esper.device.name": "ESP-ID-AAAAW",
      "esper.group": "All Devices/Stores/West",
      "android.os.security_patch": "2024-09-01",
    });
    // Its last check-in is when it was last seen.
    expect(new Date(host["lastSeenAt"] as string)).toEqual(
      new Date(START.getTime() - 4 * MINUTE),
    );
    expect(deviceRow(KIOSK_A)["inventoryMatch"]).toBe(
      ManagedDeviceHostMatch.Created,
    );

    // B has no alias: its host is named by its Esper name.
    expect(itemOf(KIOSK_B)["displayName"]).toBe("ESP-ID-AAAAX");
    expect(db.items.size).toBe(2);
  });

  test("a device no window had is asked about on its own, then not again for a day", async () => {
    api.state.devices.push(
      buildEsperDevice({
        id: "cccccccc-0000-4000-8000-000000000001",
        name: "ESP-ID-QUIET",
      }),
    );
    api.state.heartbeats["cccccccc-0000-4000-8000-000000000001"] = new Date(
      START.getTime() - 45 * DAY,
    );

    await run();

    expect(
      new Date(
        deviceRow("cccccccc-0000-4000-8000-000000000001")[
          "lastCheckInAt"
        ] as string,
      ),
    ).toEqual(new Date(START.getTime() - 45 * DAY));
    expect(
      api.requestsTo(
        "/api/device/v0/heartbeat/cccccccc-0000-4000-8000-000000000001/",
      ),
    ).toHaveLength(1);

    clock.advance(15 * MINUTE);
    await run();

    expect(
      api.requestsTo(
        "/api/device/v0/heartbeat/cccccccc-0000-4000-8000-000000000001/",
      ),
    ).toHaveLength(1);
  });
});

describe("one device, not two", () => {
  test("a host telemetry already reports under the Esper name is the device's host", async () => {
    const telemetry: string = telemetryHost({
      hostName: "ESP-ID-AAAAW",
      attributes: { "device.type": "pos terminal" },
    });

    const outcome: DeviceManagementReadOutcome = await run();

    expect(deviceRow(KIOSK_A)["inventoryItemId"]).toBe(telemetry);
    expect(deviceRow(KIOSK_A)["inventoryMatch"]).toBe(
      ManagedDeviceHostMatch.Name,
    );

    const host: JSONObject = db.items.get(telemetry)!;

    // Taken over while Esper lists the device: never pruned for a silence.
    expect(host["source"]).toBe(EntitySource.Inventory);
    expect(host["resourceType"]).toBe(MANAGED_DEVICE_RESOURCE_TYPE);
    // Telemetry's own value is kept; Esper's facts fill in the rest.
    expect(host["descriptiveAttributes"]).toMatchObject({
      "os.type": "linux",
      "device.type": "pos terminal",
      "host.serial_number": "R9KT30ABC12",
      "android.os.security_patch": "2024-09-01",
    });
    // The name telemetry gave it was its host.name: the alias reads better.
    expect(host["displayName"]).toBe("Store 0412 Kiosk 1");
    // One host for A (telemetry's) and one made for B.
    expect(db.items.size).toBe(2);
    expect(
      (outcome.summary as DeviceManagementReadSummary).matchedHostCount,
    ).toBe(1);
  });

  test("...or under another name, by its serial number: in host.serial_number, or as the host's name", async () => {
    const bySerial: string = telemetryHost({
      hostName: "kiosk-12",
      attributes: { "host.serial_number": "r9kt30abc12" },
    });
    // An Android agent told `device_name: ${esper.serialNumber}`.
    const namedBySerial: string = telemetryHost({
      hostName: "R9KT30ABC13",
      attributes: { "host.id": "3f2a9c1b7d4e5a60" },
    });

    await run();

    expect(deviceRow(KIOSK_A)["inventoryItemId"]).toBe(bySerial);
    expect(deviceRow(KIOSK_A)["inventoryMatch"]).toBe(
      ManagedDeviceHostMatch.SerialNumber,
    );
    expect(deviceRow(KIOSK_B)["inventoryItemId"]).toBe(namedBySerial);
    expect(deviceRow(KIOSK_B)["inventoryMatch"]).toBe(
      ManagedDeviceHostMatch.SerialNumber,
    );
    expect(db.items.size).toBe(2);
  });

  test("the Android agent's host is the device's: the one its device_name and device_serial name, whatever its host.id", async () => {
    /*
     * What the agent sends with Esper's documented managed configuration
     * (device_name ${esper.deviceName}, device_serial ${esper.serialNumber}),
     * as its DeviceResource builds it: its host.id is its ANDROID_ID, which
     * Esper never knows.
     */
    const agent: string = telemetryHost({
      hostName: "ESP-ID-AAAAW",
      attributes: {
        "host.id": "3f2a9c1b7d4e5a60",
        "host.serial_number": "R9KT30ABC12",
        "host.arch": "arm64",
        "android.os.security_patch": "2024-09-01",
        "device.type": "kiosk",
        "oneuptime.agent.version": "17.0.12",
      },
    });

    await run();

    expect(deviceRow(KIOSK_A)["inventoryItemId"]).toBe(agent);
    expect(deviceRow(KIOSK_A)["inventoryMatch"]).toBe(
      ManagedDeviceHostMatch.Name,
    );

    const host: JSONObject = db.items.get(agent)!;

    // Kept as the agent sent them; one patch level, under the agent's key.
    expect(host["descriptiveAttributes"]).toMatchObject({
      "host.id": "3f2a9c1b7d4e5a60",
      "host.arch": "arm64",
      "android.os.security_patch": "2024-09-01",
      "oneuptime.agent.version": "17.0.12",
    });
    expect(
      Object.keys(host["descriptiveAttributes"] as JSONObject),
    ).not.toContain("android.security_patch_level");
    // Its identity is still the agent's host.name, the Host's key in Hosts.
    expect(host["identifyingAttributes"]).toEqual({
      "host.name": "esp-id-aaaaw",
    });
    expect(db.items.size).toBe(2);
  });

  test("a serial number two hosts claim is no match: a host is made instead", async () => {
    telemetryHost({
      hostName: "kiosk-12",
      attributes: { "host.serial_number": "R9KT30ABC12" },
    });
    telemetryHost({
      hostName: "kiosk-12-old",
      attributes: { "host.serial_number": "R9KT30ABC12" },
    });

    await run();

    expect(deviceRow(KIOSK_A)["inventoryMatch"]).toBe(
      ManagedDeviceHostMatch.Created,
    );
  });

  test("the host the import made gives way to telemetry that arrives later under another name, and goes", async () => {
    await run();

    const made: string = String(deviceRow(KIOSK_A)["inventoryItemId"]);
    const telemetry: string = telemetryHost({
      hostName: "kiosk-12",
      attributes: { "host.serial_number": "R9KT30ABC12" },
    });

    clock.advance(15 * MINUTE);
    await run();

    expect(deviceRow(KIOSK_A)["inventoryItemId"]).toBe(telemetry);
    expect(db.items.has(made)).toBe(false);
    expect(db.items.get(telemetry)!["source"]).toBe(EntitySource.Inventory);
  });

  test("...but not once telemetry has written to it under the Esper name: that host is the device", async () => {
    await run();

    const made: string = String(deviceRow(KIOSK_A)["inventoryItemId"]);

    // The app starts, naming the device by its Esper name: the same row.
    const host: JSONObject = db.items.get(made)!;
    (host["descriptiveAttributes"] as JSONObject)["os.type"] = "linux";

    telemetryHost({
      hostName: "kiosk-12",
      attributes: { "host.serial_number": "R9KT30ABC12" },
    });

    clock.advance(15 * MINUTE);
    await run();

    expect(deviceRow(KIOSK_A)["inventoryItemId"]).toBe(made);
    expect(deviceRow(KIOSK_A)["inventoryMatch"]).toBe(
      ManagedDeviceHostMatch.Name,
    );
  });

  test("a name a person gave the host is kept", async () => {
    await run();

    const host: JSONObject = itemOf(KIOSK_A);
    host["displayName"] = "Front counter kiosk";

    clock.advance(15 * MINUTE);
    await run();

    expect(itemOf(KIOSK_A)["displayName"]).toBe("Front counter kiosk");
  });

  test("a steady fleet costs no write to its hosts", async () => {
    await run();
    db.itemWrites.length = 0;

    clock.advance(MINUTE);
    await run();

    expect(db.itemWrites).toEqual([]);
  });
});

describe("keeping it current", () => {
  test("a device that changed in Esper is updated, and counted", async () => {
    await run();

    const changed: JSONObject = api.state.devices[0]!;
    (changed["software_info"] as JSONObject)["os_version"] = "14";
    (changed["software_info"] as JSONObject)["security_path_level"] =
      "2024-11-01";

    clock.advance(15 * MINUTE);
    const outcome: DeviceManagementReadOutcome = await run();

    expect(deviceRow(KIOSK_A)).toMatchObject({
      osVersion: "14",
      securityPatchLevel: "2024-11-01",
    });
    expect(itemOf(KIOSK_A)["descriptiveAttributes"]).toMatchObject({
      "os.version": "14",
      "android.os.security_patch": "2024-11-01",
    });
    expect((outcome.summary as DeviceManagementReadSummary).changedCount).toBe(
      1,
    );
  });

  test("a device removed from Esper is marked gone and its host archived; back, it is restored", async () => {
    await run();

    api.state.devices = api.state.devices.filter((device: JSONObject) => {
      return device["id"] !== KIOSK_B;
    });
    clock.advance(15 * MINUTE);

    const removal: DeviceManagementReadOutcome = await run();

    expect(deviceRow(KIOSK_B)["removedAt"]).toBeTruthy();
    expect(itemOf(KIOSK_B)["isArchived"]).toBe(true);
    expect(deviceRow(KIOSK_B)["isInventoryItemArchivedOnRemoval"]).toBe(true);
    expect((removal.summary as DeviceManagementReadSummary).removedCount).toBe(
      1,
    );
    expect((removal.summary as DeviceManagementReadSummary).deviceCount).toBe(
      1,
    );

    api.state.devices.push(devices()[1]!);
    clock.advance(15 * MINUTE);
    await run();

    expect(deviceRow(KIOSK_B)["removedAt"]).toBeNull();
    expect(itemOf(KIOSK_B)["isArchived"]).toBe(false);
    expect(deviceRow(KIOSK_B)["isInventoryItemArchivedOnRemoval"]).toBe(false);
  });

  test("a device gone 30 days goes for good, with its apps, and the host the import made for it", async () => {
    await run();

    const hostId: string = String(deviceRow(KIOSK_A)["inventoryItemId"]);

    api.state.devices = api.state.devices.filter((device: JSONObject) => {
      return device["id"] !== KIOSK_A;
    });
    clock.advance(15 * MINUTE);
    await run();

    clock.advance(31 * DAY);
    await run();

    expect(
      Array.from(db.devices.values()).some((device: JSONObject) => {
        return device["providerDeviceId"] === KIOSK_A;
      }),
    ).toBe(false);
    expect(db.apps.size).toBe(0);
    expect(db.items.has(hostId)).toBe(false);
  });

  test("...while a host telemetry reports is handed back to telemetry, not deleted", async () => {
    const telemetry: string = telemetryHost({ hostName: "ESP-ID-AAAAW" });

    await run();

    api.state.devices = api.state.devices.filter((device: JSONObject) => {
      return device["id"] !== KIOSK_A;
    });
    clock.advance(15 * MINUTE);
    await run();
    clock.advance(31 * DAY);
    await run();

    const host: JSONObject = db.items.get(telemetry)!;

    expect(host).toBeDefined();
    expect(host["source"]).toBe(EntitySource.Discovered);
    expect(host["resourceType"]).toBeNull();
    expect(host["resourceId"]).toBeNull();
    // The facts only the import kept current are taken off.
    const attributes: JSONObject = host["descriptiveAttributes"] as JSONObject;

    expect(Object.keys(attributes)).not.toContain("esper.device.id");
    expect(Object.keys(attributes)).not.toContain("esper.group");
    expect(attributes["os.type"]).toBe("linux");
  });

  test("apps are read again six hours on: a new version updated, an uninstalled app removed", async () => {
    await run();

    const appRequests: () => number = (): number => {
      return api
        .requestsTo("/api/enterprise/")
        .filter((request: FakeEsperRequest) => {
          return request.path.endsWith("/app/");
        }).length;
    };

    expect(appRequests()).toBe(2);

    // Fifteen minutes on: no device's apps are due.
    clock.advance(15 * MINUTE);
    await run();
    expect(appRequests()).toBe(2);

    api.state.apps[KIOSK_A] = [
      buildEsperApp({
        deviceId: KIOSK_A,
        packageName: "com.example.kiosk",
        appName: "Ordering Kiosk",
        versionName: "2.5.0",
        versionCode: "250",
        isKioskApp: true,
      }),
    ];
    clock.advance(6 * HOUR);
    await run();

    const kioskApps: Array<JSONObject> = Array.from(db.apps.values()).filter(
      (app: JSONObject): boolean => {
        return app["managedDeviceId"] === deviceRow(KIOSK_A)["_id"];
      },
    );

    expect(
      kioskApps.map((app: JSONObject): string => {
        return `${app["packageName"]}@${app["versionName"]}`;
      }),
    ).toEqual(["com.example.kiosk@2.5.0"]);
    expect(deviceRow(KIOSK_A)["appCount"]).toBe(1);
  });

  test("the check-in window carries on from where the last one ended", async () => {
    await run();
    clock.advance(15 * MINUTE);
    await run();

    const windows: Array<string | null> = api
      .requestsTo("/api/v2/heartbeat/")
      .map((request: FakeEsperRequest) => {
        return request.query.get("last_seen_gt");
      });

    expect(windows[1]).toBe(
      new Date(START.getTime() - CHECK_IN_WINDOW_OVERLAP_MS)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
    );
  });
});

describe("what goes wrong", () => {
  test("a refused key: the read fails, says why without the key, and waits an hour", async () => {
    connection.secrets = JSON.stringify({ apiKey: "revoked-key-0123456789" });

    const outcome: DeviceManagementReadOutcome = await run();
    const record: JSONObject = lastRecord();

    expect(outcome.status).toBe("failed");
    expect(record["lastError"]).toMatch(/HTTP 401/);
    expect(JSON.stringify(record)).not.toContain("revoked-key-0123456789");
    expect((record["lastPullResult"] as JSONObject)["failureKind"]).toBe(
      LlmConnectionFailureKind.Authentication,
    );
    expect(new Date(record["nextPullAt"] as string).getTime()).toBe(
      START.getTime() + HOUR,
    );
    expect(record["lastSuccessfulPullAt"]).toBeUndefined();
    expect(db.devices.size).toBe(0);
  });

  test("a failure keeps what the last read that worked found", async () => {
    await run();

    api.fault("/api/user_info/", [
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ]);
    clock.advance(15 * MINUTE);
    await run();

    const summary: JSONObject = lastRecord()["lastPullResult"] as JSONObject;

    expect(summary["status"]).toBe("failed");
    expect(summary["deviceCount"]).toBe(2);
    expect(summary["failureKind"]).toBe(LlmConnectionFailureKind.Unavailable);
    // The devices stay as they were.
    expect(db.devices.size).toBe(2);
  });

  test("Esper busy for a moment: waited out, and said", async () => {
    api.fault("/api/v2/devices/", [
      { status: 429, headers: { "retry-after": "2" } },
    ]);

    const outcome: DeviceManagementReadOutcome = await run();

    expect(outcome.status).toBe("success");
    expect(
      (outcome.summary as DeviceManagementReadSummary).wasRateLimited,
    ).toBe(true);
    expect(clock.sleeps).toContain(2000);
  });

  test("one device's apps that cannot be read: a warning, and that device tried again a minute later", async () => {
    api.fault(`/api/enterprise/${ESPER_ENTERPRISE_ID}/device/${KIOSK_B}/app/`, [
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ]);

    const outcome: DeviceManagementReadOutcome = await run();
    const summary: DeviceManagementReadSummary =
      outcome.summary as DeviceManagementReadSummary;

    expect(summary.warnings).toEqual([APPS_NOT_READ_WARNING]);
    expect(summary.appsReadDeviceCount).toBe(1);
    expect(summary.appsWaitingDeviceCount).toBe(1);
    expect(outcome.status).toBe("partial");
    expect(deviceRow(KIOSK_B)["appsReadAt"]).toBeUndefined();
    expect(new Date(lastRecord()["nextPullAt"] as string).getTime()).toBe(
      START.getTime() + MINUTE,
    );

    clock.advance(MINUTE);
    const second: DeviceManagementReadOutcome = await run();

    expect(second.status).toBe("success");
    expect(deviceRow(KIOSK_B)["appsReadAt"]).toBeTruthy();
  });

  test("Inventory that cannot be written is a warning, never the read's failure", async () => {
    const outcome: DeviceManagementReadOutcome = await run({
      recordInventory: async () => {
        throw new Error("Postgres is not answering");
      },
    });

    expect(outcome.status).toBe("success");
    expect((outcome.summary as DeviceManagementReadSummary).warnings).toEqual([
      INVENTORY_NOT_RECORDED_WARNING,
    ]);
  });

  test("check-ins that cannot be recorded are a warning, never the read's failure", async () => {
    const outcome: DeviceManagementReadOutcome = await run({
      recordCheckIns: async () => {
        throw new Error("ClickHouse is not answering");
      },
    });

    expect(outcome.status).toBe("success");
    expect((outcome.summary as DeviceManagementReadSummary).warnings).toEqual([
      CHECK_INS_NOT_RECORDED_WARNING,
    ]);
    // The read is still recorded, and so is where its check-ins got to.
    expect(lastRecord()["lastSuccessfulPullAt"]).toBeTruthy();
    expect(
      (lastRecord()["pullState"] as JSONObject)["checkInCursor"],
    ).toBeTruthy();
  });
});

/*
 * #9835: each read writes how long since each device checked in, which a
 * Metrics monitor alerts on per device - only from a read that read every
 * check-in up to its end, so no reading ever says a device was quiet longer
 * than it was.
 */
describe("the devices' check-ins, as a metric", () => {
  test("a read writes them once, for its connection and service, at the end of its check-in window", async () => {
    await run();

    expect(checkInRecords).toHaveLength(1);
    expect(checkInRecords[0]!.projectId.toString()).toBe(PROJECT.toString());
    expect(checkInRecords[0]!.connectionId.toString()).toBe(
      CONNECTION.toString(),
    );
    expect(checkInRecords[0]!.provider).toBe(DeviceManagementProvider.Esper);

    // At the window's end: where the next read's window starts.
    expect(checkInRecords[0]!.asOf.toISOString()).toBe(
      (lastRecord()["pullState"] as JSONObject)["checkInCursor"],
    );
  });

  test("...after the devices are written, so each device's newest check-in is what is read", async () => {
    let lastCheckInSeen: unknown = undefined;

    await run({
      recordCheckIns: async (
        data: ManagedDeviceCheckInRecordInput,
      ): Promise<ManagedDeviceCheckInOutcome> => {
        lastCheckInSeen = deviceRow(KIOSK_A)["lastCheckInAt"];
        checkInRecords.push(data);
        return { readingCount: 2, hostCount: 0 };
      },
    });

    expect(new Date(lastCheckInSeen as string).getTime()).toBe(
      START.getTime() - 4 * MINUTE,
    );
  });

  test("every read writes them again, each at its own window's end", async () => {
    await run();
    clock.advance(15 * MINUTE);
    await run();

    expect(checkInRecords).toHaveLength(2);
    expect(checkInRecords[1]!.asOf.getTime()).toBeGreaterThanOrEqual(
      START.getTime() + 15 * MINUTE,
    );
  });

  test("a read whose check-ins were cut short writes none: its ages would be too old", async () => {
    const connector: DeviceManagementConnector =
      DeviceManagementConnectorRegistry.getConnector(
        DeviceManagementProvider.Esper,
      );
    const openSession: (
      settings: DeviceManagementSettings,
      options: DeviceManagementSessionOptions,
    ) => DeviceManagementSession = connector.openSession.bind(connector);

    jest
      .spyOn(connector, "openSession")
      .mockImplementation(
        (
          settings: DeviceManagementSettings,
          options: DeviceManagementSessionOptions,
        ): DeviceManagementSession => {
          const session: DeviceManagementSession = openSession(
            settings,
            options,
          );
          const readFleet: DeviceManagementSession["readFleet"] =
            session.readFleet.bind(session);

          // As the client says when its budget ran out part way.
          session.readFleet = async (data: {
            checkInSince: Date;
          }): Promise<DeviceManagementFleetRead> => {
            const fleet: DeviceManagementFleetRead = await readFleet(data);
            return { ...fleet, checkInWindowEnd: undefined };
          };

          return session;
        },
      );

    const outcome: DeviceManagementReadOutcome = await run();

    expect(outcome.status).toBe("partial");
    expect(checkInRecords).toEqual([]);
  });

  test("a read whose device list was cut short writes none, even with every check-in read: a device it left out keeps an older one", async () => {
    const connector: DeviceManagementConnector =
      DeviceManagementConnectorRegistry.getConnector(
        DeviceManagementProvider.Esper,
      );
    const openSession: (
      settings: DeviceManagementSettings,
      options: DeviceManagementSessionOptions,
    ) => DeviceManagementSession = connector.openSession.bind(connector);

    jest
      .spyOn(connector, "openSession")
      .mockImplementation(
        (
          settings: DeviceManagementSettings,
          options: DeviceManagementSessionOptions,
        ): DeviceManagementSession => {
          const session: DeviceManagementSession = openSession(
            settings,
            options,
          );
          const readFleet: DeviceManagementSession["readFleet"] =
            session.readFleet.bind(session);

          // A list stopped at its page limit: the window was still read whole.
          session.readFleet = async (data: {
            checkInSince: Date;
          }): Promise<DeviceManagementFleetRead> => {
            const fleet: DeviceManagementFleetRead = await readFleet(data);
            expect(fleet.checkInWindowEnd).toBeDefined();
            return { ...fleet, isDeviceListComplete: false };
          };

          return session;
        },
      );

    const outcome: DeviceManagementReadOutcome = await run();

    expect(outcome.status).toBe("partial");
    expect(checkInRecords).toEqual([]);
  });

  test("a read that fails writes none", async () => {
    connection.secrets = JSON.stringify({ apiKey: "revoked-key-0123456789" });

    const outcome: DeviceManagementReadOutcome = await run();

    expect(outcome.status).toBe("failed");
    expect(checkInRecords).toEqual([]);
  });

  test("a connection that is off, or a plan without telemetry, writes none", async () => {
    connection.isEnabled = false;
    await run();

    connection.isEnabled = true;
    await run({
      isTelemetryAllowed: async (): Promise<boolean> => {
        return false;
      },
    });

    expect(checkInRecords).toEqual([]);
  });
});

/*
 * #9837: an Esper tenant's iPhones, iPads and Apple TVs are imported beside
 * its Android devices, each one host in Inventory that runs what it runs,
 * online while it checked in within a day - Apple's push wakes it hours
 * apart - and with no apps read, since Esper lists an Apple device's by ID
 * alone.
 */
describe("Esper's Apple devices", () => {
  beforeEach(() => {
    api.state.devices.push(ipad());
  });

  test("an iPad is imported with what it runs, and its last_seen as its check-in", async () => {
    const outcome: DeviceManagementReadOutcome = await run();

    expect(outcome.status).toBe("success");
    expect(db.devices.size).toBe(3);
    expect(deviceRow(IPAD)).toMatchObject({
      platform: ManagedDevicePlatform.IPadOS,
      deviceName: "ESP-ID-IPAD1",
      alias: "Front counter iPad",
      serialNumber: "DMPXK2ABQ1GC",
      manufacturer: "Apple",
      model: "iPad (10th generation)",
      osVersion: "17.4.1",
      buildNumber: "21E236",
      groupName: "West",
    });
    // Android's alone.
    expect(deviceRow(IPAD)["securityPatchLevel"] ?? null).toBeNull();
    expect(deviceRow(IPAD)["agentVersion"] ?? null).toBeNull();
    expect(new Date(deviceRow(IPAD)["lastCheckInAt"] as string)).toEqual(
      new Date(START.getTime() - 3 * HOUR),
    );
  });

  test("it is one host in Inventory that runs iPadOS, with no patch level", async () => {
    await run();

    const host: JSONObject = itemOf(IPAD);

    expect(host).toMatchObject({
      entityKey: hostKey("ESP-ID-IPAD1"),
      identifyingAttributes: { "host.name": "esp-id-ipad1" },
      displayName: "Front counter iPad",
      resourceType: MANAGED_DEVICE_RESOURCE_TYPE,
    });
    expect(host["descriptiveAttributes"]).toEqual({
      "host.serial_number": "DMPXK2ABQ1GC",
      "device.manufacturer": "Apple",
      "device.model.name": "iPad (10th generation)",
      "device.firmware.version": "21E236",
      "os.name": "iPadOS",
      "os.version": "17.4.1",
      "host.mac": "3C-22-FB-10-AA-21",
      "esper.device.id": IPAD,
      "esper.device.name": "ESP-ID-IPAD1",
      "esper.group": "All Devices/Stores/West",
    });
    expect(new Date(host["lastSeenAt"] as string)).toEqual(
      new Date(START.getTime() - 3 * HOUR),
    );
  });

  test("seen three hours ago it is online - an Android device would be offline - and its apps are not read", async () => {
    await run();

    const summary: DeviceManagementReadSummary = lastRecord()[
      "lastPullResult"
    ] as unknown as DeviceManagementReadSummary;

    // The kiosk seen 4 minutes ago and the iPad: online. Kiosk B, 3 hours: offline.
    expect(summary).toMatchObject({
      deviceCount: 3,
      onlineCount: 2,
      offlineCount: 1,
      addedCount: 3,
      appsReadDeviceCount: 2,
      appsWaitingDeviceCount: 0,
    });
    expect(
      api.requestsTo(
        `/api/enterprise/${ESPER_ENTERPRISE_ID}/device/${IPAD}/app/`,
      ),
    ).toEqual([]);
    expect(deviceRow(IPAD)["appsReadAt"] ?? null).toBeNull();
    // Nor is it waiting for them: the next read is on the interval.
    expect(new Date(lastRecord()["nextPullAt"] as string).getTime()).toBe(
      START.getTime() + 15 * MINUTE,
    );
  });

  test("its check-in is never asked about on its own when its record says it", async () => {
    await run();

    expect(api.requestsTo(`/api/device/v0/heartbeat/${IPAD}/`)).toEqual([]);
  });

  test("an iPad that has never checked in is asked about on its own, as an Android device is", async () => {
    api.state.devices[api.state.devices.length - 1] = ipad({ lastSeen: null });

    await run();

    expect(api.requestsTo(`/api/device/v0/heartbeat/${IPAD}/`)).toHaveLength(1);
  });

  test("a device whose platform changed is no change to count, and gains its platform once", async () => {
    await run();

    // A row written before the platform was kept.
    deviceRow(KIOSK_A)["platform"] = null;
    clock.advance(15 * MINUTE);
    await run();

    expect(deviceRow(KIOSK_A)["platform"]).toBe(ManagedDevicePlatform.Android);
    expect(
      (lastRecord()["lastPullResult"] as unknown as DeviceManagementReadSummary)
        .changedCount,
    ).toBe(0);
  });
});

describe("the rules a read follows", () => {
  test("the check-in window starts where the last ended, less an overlap, never more than 30 days back", () => {
    expect(getCheckInWindowStart({ state: {}, now: START })).toEqual(
      new Date(START.getTime() - CHECK_IN_WINDOW_MAX_MS),
    );
    expect(
      getCheckInWindowStart({
        state: {
          checkInCursor: new Date(START.getTime() - HOUR).toISOString(),
        },
        now: START,
      }),
    ).toEqual(new Date(START.getTime() - HOUR - CHECK_IN_WINDOW_OVERLAP_MS));
    expect(
      getCheckInWindowStart({
        state: {
          checkInCursor: new Date(START.getTime() - 90 * DAY).toISOString(),
        },
        now: START,
      }),
    ).toEqual(new Date(START.getTime() - CHECK_IN_WINDOW_MAX_MS));
  });

  test("the devices asked about on their own: no check-in known, not asked within a day, oldest first", () => {
    expect(
      getCheckInLookups({
        listedDeviceIds: ["known", "asked", "stale", "never"],
        knownCheckIns: new Set(["known"]),
        lookups: {
          asked: new Date(START.getTime() - HOUR).toISOString(),
          stale: new Date(START.getTime() - 2 * DAY).toISOString(),
        },
        now: START,
      }),
    ).toEqual(["never", "stale"]);
  });

  test("the devices whose apps are due: enrolled, never read or read six hours ago, oldest first", () => {
    const due: Array<{ id: string }> = getAppsDueDevices(
      [
        {
          id: "fresh",
          appsReadAt: new Date(START.getTime() - HOUR),
          isRemoved: false,
        },
        {
          id: "old",
          appsReadAt: new Date(START.getTime() - 7 * HOUR),
          isRemoved: false,
        },
        { id: "never", appsReadAt: null, isRemoved: false },
        { id: "gone", appsReadAt: null, isRemoved: true },
      ],
      START,
    );

    expect(
      due.map((device: { id: string }): string => {
        return device.id;
      }),
    ).toEqual(["never", "old"]);
  });

  test("when a read is read next: on its interval, sooner to carry on, later after a failure", () => {
    const next: (
      data: Partial<
        Parameters<typeof DeviceManagementReadRunner.nextPullAt>[0]
      >,
    ) => number = (
      data: Partial<
        Parameters<typeof DeviceManagementReadRunner.nextPullAt>[0]
      >,
    ): number => {
      return (
        DeviceManagementReadRunner.nextPullAt({
          now: START,
          intervalInMinutes: 15,
          outcome: "success",
          ...data,
        }).getTime() - START.getTime()
      );
    };

    expect(next({})).toBe(15 * MINUTE);
    expect(next({ outcome: "partial" })).toBe(MINUTE);
    expect(next({ outcome: "partial", wasRateLimited: true })).toBe(5 * MINUTE);
    expect(next({ outcome: "failed" })).toBe(15 * MINUTE);
    expect(
      next({
        outcome: "failed",
        failureKind: LlmConnectionFailureKind.Authentication,
      }),
    ).toBe(HOUR);
    expect(next({ outcome: "failed", intervalInMinutes: 60 })).toBe(HOUR);
  });
});

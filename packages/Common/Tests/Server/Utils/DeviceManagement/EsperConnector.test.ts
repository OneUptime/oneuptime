import { describe, expect, test } from "@jest/globals";
import EsperConnector, {
  toEsperTime,
} from "../../../../Server/Utils/DeviceManagement/Esper/EsperConnector";
import {
  DeviceManagementBudgetSpent,
  DeviceManagementFleetRead,
  DeviceManagementSession,
  ProviderApp,
  ProviderDevice,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { DeviceManagementTestResult } from "../../../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
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

/*
 * Esper as a device management connector, against the fake of its API:
 * what "Test" answers, and what a read's session asks for and returns - the
 * Android devices with Esper's spellings, their groups, the check-ins in
 * the window, one device's check-in and its apps.
 */

const START: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const DEVICE_A: string = "11111111-aaaa-4aaa-8aaa-000000000001";
const DEVICE_B: string = "11111111-aaaa-4aaa-8aaa-000000000002";
const DEVICE_C: string = "11111111-aaaa-4aaa-8aaa-000000000003";
const DEVICE_D: string = "11111111-aaaa-4aaa-8aaa-000000000004";
const GROUP_WEST: string = "22222222-bbbb-4bbb-8bbb-000000000001";

const connector: EsperConnector = new EsperConnector();

function fleet(clock: TestClock): FakeEsperApi {
  return createFakeEsperApi({
    now: clock.now,
    devices: [
      buildEsperDevice({
        id: DEVICE_A,
        name: "ESP-ID-AAAAW",
        alias: "Store 0412 Kiosk 1",
        serial: "R9KT30ABC12",
        groupId: GROUP_WEST,
        securityPatchLevel: "2024-09-01",
        batteryLevel: 87,
      }),
      buildEsperDevice({
        id: DEVICE_B,
        name: "ESP-ID-AAAAX",
        serial: "R9KT30ABC13",
        groupId: GROUP_WEST,
        state: 60,
      }),
      buildEsperAppleDevice({
        id: DEVICE_C,
        name: "ESP-ID-IPAD1",
        os: "iPadOS",
        lastSeen: new Date(START.getTime() - 150 * MINUTE).toISOString(),
      }),
      // Esper's Windows devices are not imported.
      buildEsperDevice({
        id: DEVICE_D,
        name: "ESP-ID-WIN01",
        platform: "WINDOWS",
      }),
    ],
    groups: [
      buildEsperGroup({
        id: GROUP_WEST,
        name: "West",
        path: "All Devices/Stores/West",
      }),
    ],
    heartbeats: {
      [DEVICE_A]: new Date(START.getTime() - 4 * MINUTE),
      [DEVICE_B]: new Date(START.getTime() - 3 * 60 * MINUTE),
    },
    apps: {
      [DEVICE_A]: [
        buildEsperApp({
          deviceId: DEVICE_A,
          packageName: "com.example.kiosk",
          appName: "Ordering Kiosk",
          versionName: "2.4.1",
          versionCode: "241",
          isKioskApp: true,
        }),
        buildEsperApp({
          deviceId: DEVICE_A,
          packageName: "io.esper.agent",
          appName: "Esper Agent",
          versionName: "8.00.0764",
          isEsperControlled: true,
        }),
      ],
    },
  });
}

function session(
  api: FakeEsperApi,
  clock: TestClock,
  maxRequests: number = 100,
): DeviceManagementSession {
  return connector.openSession(
    {
      provider: DeviceManagementProvider.Esper,
      projectId: "11111111-1111-4111-8111-111111111111",
      config: { tenant: ESPER_TENANT, readIntervalInMinutes: 15 },
      apiKey: FAKE_ESPER_API_KEY,
    },
    {
      transport: api.transport,
      now: clock.now,
      sleep: clock.sleep,
      random: (): number => {
        return 0.5;
      },
      maxRequests,
      maxDurationMs: 6 * 60 * 1000,
    },
  );
}

describe("test", () => {
  test("a key Esper accepts: who it is, and how many Android and Apple devices a read imports", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    const result: DeviceManagementTestResult = await connector.testConnection(
      {
        apiKey: FAKE_ESPER_API_KEY,
        config: { tenant: ESPER_TENANT, readIntervalInMinutes: 15 },
      },
      { transport: api.transport, now: clock.now, sleep: clock.sleep },
    );

    expect(result.status).toBe("pass");
    expect(result.tenant).toBe(ESPER_TENANT);
    expect(result.role).toBe("Viewer");
    // Two kiosks and the iPad; the Windows device is not imported.
    expect(result.deviceCount).toBe(3);
    expect(result.message).toBe(
      "Connected to the Esper tenant acme: 3 devices to import, Android and Apple.",
    );

    // Two read-only calls, and the device list asked for one device.
    expect(
      api.requests.map((request: FakeEsperRequest): string => {
        return `${request.method} ${request.path}`;
      }),
    ).toEqual(["GET /api/user_info/", "GET /api/v2/devices/"]);
    expect(api.requests[1]!.query.get("platform")).toBe("ANDROID,APPLE");
    expect(api.requests[1]!.query.get("limit")).toBe("1");
  });

  test("one device a read imports is one device, not devices", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = createFakeEsperApi({
      now: clock.now,
      devices: [buildEsperDevice({ id: DEVICE_A, name: "ESP-ID-AAAAW" })],
    });

    const result: DeviceManagementTestResult = await connector.testConnection(
      {
        apiKey: FAKE_ESPER_API_KEY,
        config: { tenant: ESPER_TENANT, readIntervalInMinutes: 15 },
      },
      { transport: api.transport, now: clock.now, sleep: clock.sleep },
    );

    expect(result.message).toBe(
      "Connected to the Esper tenant acme: 1 device to import, Android and Apple.",
    );
  });

  test("a refused key fails, with what to do, and never the key", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    const result: DeviceManagementTestResult = await connector.testConnection(
      {
        apiKey: "not-the-key-0123456789",
        config: { tenant: ESPER_TENANT, readIntervalInMinutes: 15 },
      },
      { transport: api.transport, now: clock.now, sleep: clock.sleep },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Authentication);
    expect(result.message).toMatch(
      /^Esper refused the API key for the tenant acme\./,
    );
    expect(result.remediation).toMatch(/API Key Management/);
    expect(JSON.stringify(result)).not.toContain("not-the-key-0123456789");
  });

  test("a tenant that does not exist cannot be reached: check the tenant", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    const result: DeviceManagementTestResult = await connector.testConnection(
      {
        apiKey: FAKE_ESPER_API_KEY,
        config: { tenant: "acme-typo", readIntervalInMinutes: 15 },
      },
      { transport: api.transport, now: clock.now, sleep: clock.sleep },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Unavailable);
    expect(result.message).toContain("acme-typo-api.esper.cloud");
    expect(result.remediation).toMatch(/Check the tenant/);
  });

  test("a key whose user may not read devices fails as a permission", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    api.fault("/api/v2/devices/", [
      { status: 403, body: { code: 403, message: "Forbidden.", content: {} } },
    ]);

    const result: DeviceManagementTestResult = await connector.testConnection(
      {
        apiKey: FAKE_ESPER_API_KEY,
        config: { tenant: ESPER_TENANT, readIntervalInMinutes: 15 },
      },
      { transport: api.transport, now: clock.now, sleep: clock.sleep },
    );

    expect(result.failureKind).toBe(LlmConnectionFailureKind.Permission);
    expect(result.remediation).toMatch(/Esper role can read devices/);
  });

  test("no tenant is a setting to fix, and nothing is sent", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    const result: DeviceManagementTestResult = await connector.testConnection(
      {
        apiKey: FAKE_ESPER_API_KEY,
        config: { tenant: "", readIntervalInMinutes: 15 },
      },
      { transport: api.transport },
    );

    expect(result.failureKind).toBe(LlmConnectionFailureKind.Settings);
    expect(api.requests).toEqual([]);
  });

  test("Esper busy on every try: a rate limit, said as one", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    api.fault(
      "/api/user_info/",
      new Array(10).fill({ status: 429, headers: { "retry-after": "1" } }),
    );

    const result: DeviceManagementTestResult = await connector.testConnection(
      {
        apiKey: FAKE_ESPER_API_KEY,
        config: { tenant: ESPER_TENANT, readIntervalInMinutes: 15 },
      },
      { transport: api.transport, now: clock.now, sleep: clock.sleep },
    );

    expect(result.failureKind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(result.remediation).toBe("Try again in a minute.");
  });
});

describe("a read's session", () => {
  test("the fleet: its Android and Apple devices, with every documented fact, and no Windows device", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    const read: DeviceManagementFleetRead = await session(api, clock).readFleet(
      { checkInSince: new Date(START.getTime() - 60 * MINUTE) },
    );

    expect(read.enterpriseId).toBe(ESPER_ENTERPRISE_ID);
    expect(read.role).toBe("Viewer");
    expect(read.isDeviceListComplete).toBe(true);
    expect(read.isGroupListComplete).toBe(true);
    expect(
      read.devices.map((device: ProviderDevice): string => {
        return `${device.providerDeviceId} ${device.platform}`;
      }),
    ).toEqual([
      `${DEVICE_A} ${ManagedDevicePlatform.Android}`,
      `${DEVICE_B} ${ManagedDevicePlatform.Android}`,
      `${DEVICE_C} ${ManagedDevicePlatform.IPadOS}`,
    ]);

    const kiosk: ProviderDevice = read.devices[0]!;

    expect(kiosk).toMatchObject({
      deviceName: "ESP-ID-AAAAW",
      alias: "Store 0412 Kiosk 1",
      serialNumber: "R9KT30ABC12",
      manufacturer: "Elo Touch Solutions",
      brand: "Elo",
      model: "I-Series 4",
      osVersion: "13",
      buildNumber: "TKQ1.221114.001",
      // Read from Esper's own spelling, security_path_level.
      securityPatchLevel: "2024-09-01",
      agentVersion: "8.00.0764",
      state: 1,
      groupId: GROUP_WEST,
      isKioskMode: true,
      batteryLevel: 87,
      ipAddresses: ["10.40.12.31"],
      macAddress: "a4:c1:38:00:12:7f",
    });
    expect(kiosk.provisionedAt?.toISOString()).toBe("2026-03-02T15:04:05.000Z");
    expect(kiosk.details).toMatchObject({
      totalRam: "3.6",
      totalStorage: "32",
      memoryUnits: "GB",
      availableStorage: 18200,
      networkType: "WI-FI",
      wifiSsid: "store-kiosks",
    });

    expect(read.groups).toEqual([
      { id: GROUP_WEST, name: "West", path: "All Devices/Stores/West" },
    ]);
  });

  test("the check-ins: the window asked is the one given, ending now, in Esper's time format", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);
    const since: Date = new Date(START.getTime() - 60 * MINUTE);

    const read: DeviceManagementFleetRead = await session(api, clock).readFleet(
      { checkInSince: since },
    );

    const heartbeat: FakeEsperRequest =
      api.requestsTo("/api/v2/heartbeat/")[0]!;

    expect(heartbeat.query.get("last_seen_gt")).toBe("2026-11-19T11:00:00Z");
    // The heartbeat list takes one platform: an Apple device's came with its record.
    expect(heartbeat.query.get("platform")).toBe("ANDROID");
    expect(
      Date.parse(heartbeat.query.get("last_seen_lt")!),
    ).toBeGreaterThanOrEqual(START.getTime());
    /*
     * Only device A checked in within the hour, B three hours ago; the
     * iPad's last_seen, two and a half hours ago, is in its own record.
     */
    expect(read.checkIns).toEqual([
      {
        providerDeviceId: DEVICE_A,
        lastCheckInAt: new Date(START.getTime() - 4 * MINUTE),
      },
      {
        providerDeviceId: DEVICE_C,
        lastCheckInAt: new Date(START.getTime() - 150 * MINUTE),
      },
    ]);
    expect(read.checkInWindowEnd).toBeDefined();
    expect(api.requestsTo("/api/v2/heartbeat/")).toHaveLength(1);
  });

  test("an Apple device with no last_seen has no check-in from the list, to be asked about on its own", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = createFakeEsperApi({
      now: clock.now,
      devices: [
        buildEsperAppleDevice({
          id: DEVICE_C,
          name: "ESP-ID-IPAD1",
          lastSeen: null,
        }),
      ],
    });

    const read: DeviceManagementFleetRead = await session(api, clock).readFleet(
      { checkInSince: new Date(START.getTime() - 60 * MINUTE) },
    );

    expect(read.devices).toHaveLength(1);
    expect(read.checkIns).toEqual([]);
  });

  test("an Android device's apps are read, an Apple device's are not: Esper lists those by ID alone", () => {
    const clock: TestClock = createTestClock(START);
    const reader: DeviceManagementSession = session(fleet(clock), clock);

    expect(
      reader.readsAppsOf({ platform: ManagedDevicePlatform.Android }),
    ).toBe(true);

    for (const platform of [
      ManagedDevicePlatform.IOS,
      ManagedDevicePlatform.IPadOS,
      ManagedDevicePlatform.TvOS,
    ]) {
      expect(reader.readsAppsOf({ platform })).toBe(false);
    }
  });

  test("the device list asked: Android and Apple, 1,000 a page, in a stable order", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    await session(api, clock).readFleet({ checkInSince: START });

    const list: FakeEsperRequest = api.requestsTo("/api/v2/devices/")[0]!;

    expect(list.query.get("platform")).toBe("ANDROID,APPLE");
    expect(list.query.get("limit")).toBe("1000");
    expect(list.query.get("ordering")).toBe("created_at");
    expect(
      api.requestsTo(`/api/enterprise/${ESPER_ENTERPRISE_ID}/devicegroup/`),
    ).toHaveLength(1);
  });

  test("a budget spent part way through the device list: the devices read, said to be incomplete, and no window", async () => {
    const clock: TestClock = createTestClock(START);
    const devices: Array<JSONObject> = [];

    for (let index: number = 0; index < 5; index++) {
      devices.push(
        buildEsperDevice({
          id: `33333333-cccc-4ccc-8ccc-00000000000${index}`,
          name: `ESP-ID-0000${index}`,
        }),
      );
    }

    const api: FakeEsperApi = createFakeEsperApi({
      now: clock.now,
      devices,
      maxPageSize: 2,
    });

    // user_info, then two pages of the list: the third is out of budget.
    const read: DeviceManagementFleetRead = await session(
      api,
      clock,
      3,
    ).readFleet({ checkInSince: START });

    expect(read.devices).toHaveLength(4);
    expect(read.isDeviceListComplete).toBe(false);
    expect(read.checkInWindowEnd).toBeUndefined();
    expect(read.warnings[0]).toMatch(/device list was cut short/);
  });

  test("one device's check-in, asked on its own; none known is null", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);
    const reader: DeviceManagementSession = session(api, clock);

    // Esper answers one device's check-in on its own.
    expect(reader.readCheckIn).toBeDefined();
    expect(await reader.readCheckIn!(DEVICE_B)).toEqual(
      new Date(START.getTime() - 3 * 60 * MINUTE),
    );
    expect(await reader.readCheckIn!(DEVICE_C)).toBeNull();
    // An ID that could not be one never reaches a URL.
    expect(await reader.readCheckIn!("../../user_info")).toBeNull();
    expect(
      api.requests.some((request: FakeEsperRequest): boolean => {
        return (
          request.url.includes("user_info") && request.url.includes("heartbeat")
        );
      }),
    ).toBe(false);
  });

  test("a check-in from a device whose clock runs ahead is never later than now", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    api.state.heartbeats[DEVICE_A] = new Date(START.getTime() + 10 * MINUTE);

    expect(await session(api, clock).readCheckIn!(DEVICE_A)).toEqual(START);
  });

  test("one device's apps: every page, each package once", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    api.state.apps[DEVICE_A]!.push(
      buildEsperApp({ deviceId: DEVICE_A, packageName: "com.example.kiosk" }),
    );

    const apps: Array<ProviderApp> = await session(api, clock).readApps({
      enterpriseId: ESPER_ENTERPRISE_ID,
      providerDeviceId: DEVICE_A,
    });

    expect(apps).toEqual([
      {
        packageName: "com.example.kiosk",
        appName: "Ordering Kiosk",
        versionName: "2.4.1",
        versionCode: "241",
        state: "INSTALL",
        isKioskApp: true,
        isManagedByService: true,
      },
      {
        packageName: "io.esper.agent",
        appName: "Esper Agent",
        versionName: "8.00.0764",
        versionCode: "1",
        state: "INSTALL",
        isKioskApp: false,
        isManagedByService: true,
      },
    ]);
    expect(
      api
        .requestsTo(
          `/api/enterprise/${ESPER_ENTERPRISE_ID}/device/${DEVICE_A}/app/`,
        )[0]!
        .query.get("limit"),
    ).toBe("250");
  });

  test("a refusal on the apps is an error naming the call; a spent budget is its own", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    const error: unknown = await session(api, clock)
      .readApps({
        enterpriseId: ESPER_ENTERPRISE_ID,
        providerDeviceId: "99999999-9999-4999-8999-999999999999",
      })
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).message).toMatch(/app list request/);

    const spent: unknown = await session(api, clock, 0)
      .readApps({
        enterpriseId: ESPER_ENTERPRISE_ID,
        providerDeviceId: DEVICE_A,
      })
      .catch((caught: unknown) => {
        return caught;
      });

    expect(spent).toBeInstanceOf(DeviceManagementBudgetSpent);
  });

  test("user info that names no enterprise fails the read, saying so", async () => {
    const clock: TestClock = createTestClock(START);
    const api: FakeEsperApi = fleet(clock);

    api.fault("/api/user_info/", [
      { status: 200, body: { id: 1, profile: {} } },
    ]);

    await expect(
      session(api, clock).readFleet({ checkInSince: START }),
    ).rejects.toThrow(/did not say which enterprise/);
  });
});

describe("Esper's time format", () => {
  test("ISO 8601 to the second, in UTC", () => {
    expect(toEsperTime(new Date("2026-11-19T11:00:00.123Z"))).toBe(
      "2026-11-19T11:00:00Z",
    );
  });
});

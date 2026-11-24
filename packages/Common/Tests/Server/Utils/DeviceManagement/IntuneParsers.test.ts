import { describe, expect, test } from "@jest/globals";
import {
  getIntuneCheckIns,
  getIntuneGroups,
  parseIntuneBatteryLevel,
  parseIntuneDetectedApps,
  parseIntuneDevice,
  parseIntuneEnrolledDeviceCount,
  readGraphDate,
  readIntunePlatform,
  IntuneDeviceRead,
} from "../../../../Server/Utils/DeviceManagement/Intune/IntuneParsers";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import {
  buildIntuneAndroid,
  buildIntuneDetectedApp,
  buildIntuneDevice,
  buildIntuneHardwareInformation,
  buildIntuneIpad,
} from "./FakeIntuneGraph";
import { JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * Graph's Intune answers, read as Microsoft's reference shows them
 * (#9837): a v1.0 managedDevice of each platform, Graph's "never" date,
 * fields Graph leaves empty, and the discovered apps of beta's
 * managedDevice. A device's user never reaches OneUptime.
 */

const NOW: Date = new Date("2026-11-19T12:00:00Z");

function read(value: unknown): IntuneDeviceRead {
  const parsed: IntuneDeviceRead | null = parseIntuneDevice(value, NOW);

  expect(parsed).not.toBeNull();

  return parsed!;
}

describe("an Intune device", () => {
  test("a Windows PC: its name, serial number, system, category and storage", () => {
    const { device, lastSyncAt } = read(buildIntuneDevice());

    expect(device).toMatchObject({
      providerDeviceId: "0f7c8c6b-0c2a-4d6e-9a1b-2c3d4e5f6a7b",
      platform: ManagedDevicePlatform.Windows,
      deviceName: "DESKTOP-7KQ2M1",
      alias: "",
      serialNumber: "0F33AB12345678",
      manufacturer: "Microsoft Corporation",
      model: "Surface Laptop 5",
      osVersion: "10.0.22631.4460",
      securityPatchLevel: "",
      state: null,
      groupId: "Front Desk",
      batteryLevel: null,
      macAddress: "7c:1e:52:0a:9b:3f",
    });
    expect(device.provisionedAt).toEqual(new Date("2025-03-04T09:12:44Z"));
    expect(lastSyncAt).toEqual(new Date("2026-11-19T11:40:00Z"));
    expect(device.details).toMatchObject({
      operatingSystem: "Windows",
      complianceState: "compliant",
      ownership: "company",
      enrollmentType: "windowsAzureADJoin",
      managementAgent: "mdm",
      isEncrypted: true,
      isSupervised: false,
      totalStorage: "255.1",
      freeStorage: "141.7",
      memoryUnits: "GB",
    });
  });

  // #10008: Graph's bytes, as Graph gives them, for how full it is.
  test("keeps its whole and its free storage in bytes, and says no battery", () => {
    const { device } = read(buildIntuneDevice());

    expect(device.details["storageTotalBytes"]).toBe(255060049920);
    expect(device.details["storageFreeBytes"]).toBe(141733920768);
    expect(device.batteryLevel).toBeNull();
  });

  test("Graph's free space before the device said it - 0 - is no figure", () => {
    const { device } = read(
      buildIntuneDevice({
        freeStorageSpaceInBytes: 0,
        totalStorageSpaceInBytes: 0,
      }),
    );

    expect(device.details["storageTotalBytes"]).toBeUndefined();
    expect(device.details["storageFreeBytes"]).toBeUndefined();
  });

  test("never reads its user: name, email, phone number", () => {
    const text: string = JSON.stringify(read(buildIntuneDevice()).device);

    expect(text).not.toContain("megan");
    expect(text).not.toContain("Megan Bowen");
    expect(text).not.toContain("a2b8c1d0");
  });

  test("an iPad Intune calls iOS runs iPadOS; Unknown is no category", () => {
    const { device } = read(buildIntuneIpad());

    expect(device.platform).toBe(ManagedDevicePlatform.IPadOS);
    expect(device.groupId).toBe("");
    expect(device.macAddress).toBe("a4:83:e7:12:34:56");
    expect(device.details["isSupervised"]).toBe(true);
  });

  test("an Android phone keeps its security patch level; its placeholder MAC is none", () => {
    const { device } = read(buildIntuneAndroid());

    expect(device.platform).toBe(ManagedDevicePlatform.Android);
    expect(device.securityPatchLevel).toBe("2026-10-01");
    expect(device.imei).toBe("356938035643809");
    expect(device.macAddress).toBe("");
  });

  test("each platform Intune names", () => {
    const platformOf: (operatingSystem: unknown, model?: string) => string = (
      operatingSystem: unknown,
      model: string = "",
    ): string => {
      return readIntunePlatform({ operatingSystem, model });
    };

    expect(platformOf("Windows")).toBe(ManagedDevicePlatform.Windows);
    expect(platformOf("macOS")).toBe(ManagedDevicePlatform.MacOS);
    expect(platformOf("iOS", "iPhone 15")).toBe(ManagedDevicePlatform.IOS);
    expect(platformOf("iPadOS", "iPad Air")).toBe(ManagedDevicePlatform.IPadOS);
    expect(platformOf("AndroidForWork")).toBe(ManagedDevicePlatform.Android);
    expect(platformOf("AndroidEnterprise")).toBe(ManagedDevicePlatform.Android);
    expect(platformOf("Linux")).toBe(ManagedDevicePlatform.Linux);
    expect(platformOf("ChromeOS")).toBe(ManagedDevicePlatform.Other);
    expect(platformOf(undefined)).toBe(ManagedDevicePlatform.Other);
  });

  test("Graph's never is no date, and a check-in ahead of the clock is now", () => {
    expect(readGraphDate("0001-01-01T00:00:00Z")).toBeNull();
    expect(readGraphDate("")).toBeNull();
    expect(readGraphDate("yesterday")).toBeNull();

    const neverSynced: IntuneDeviceRead = read(
      buildIntuneDevice({ lastSyncDateTime: "0001-01-01T00:00:00Z" }),
    );
    expect(neverSynced.lastSyncAt).toBeNull();

    const ahead: IntuneDeviceRead = read(
      buildIntuneDevice({ lastSyncDateTime: "2026-11-19T12:30:00Z" }),
    );
    expect(ahead.lastSyncAt).toEqual(NOW);
  });

  test("fields Graph leaves out or empties read as none", () => {
    const { device, lastSyncAt } = read({
      id: "1d2e3f4a-0000-4000-8000-000000000001",
      operatingSystem: "Windows",
    });

    expect(device).toMatchObject({
      deviceName: "",
      serialNumber: "",
      model: "",
      osVersion: "",
      groupId: "",
      macAddress: "",
      provisionedAt: null,
    });
    expect(device.details).toEqual({ operatingSystem: "Windows" });
    expect(lastSyncAt).toBeNull();
  });

  test("a device with no name has none: Intune's own name for it is made of its user's", () => {
    expect(
      read(buildIntuneDevice({ deviceName: "  " })).device.deviceName,
    ).toBe("");
  });

  test("text is cleaned and bounded; no ID is no device", () => {
    const { device } = read(
      buildIntuneDevice({
        deviceName: "Kiosk\u0000\n12",
        model: "x".repeat(500),
      }),
    );

    expect(device.deviceName).toBe("Kiosk  12");
    expect(device.model.length).toBe(100);
    expect(parseIntuneDevice({ deviceName: "No ID" }, NOW)).toBeNull();
    expect(parseIntuneDevice("not a device", NOW)).toBeNull();
    expect(parseIntuneDevice(null, NOW)).toBeNull();
  });
});

describe("what a page of devices gives", () => {
  test("its categories are its groups, once each", () => {
    const reads: Array<IntuneDeviceRead> = [
      read(buildIntuneDevice()),
      read(
        buildIntuneDevice({ id: "b", deviceCategoryDisplayName: "Front Desk" }),
      ),
      read(buildIntuneAndroid()),
      read(buildIntuneIpad()),
    ];

    expect(
      getIntuneGroups(
        reads.map((each: IntuneDeviceRead) => {
          return each.device;
        }),
      ),
    ).toEqual([
      { id: "Front Desk", name: "Front Desk", path: "Front Desk" },
      { id: "Warehouse", name: "Warehouse", path: "Warehouse" },
    ]);
  });

  test("each device's last check-in, for the ones that have one", () => {
    expect(
      getIntuneCheckIns([
        read(buildIntuneDevice()),
        read(buildIntuneAndroid({ lastSyncDateTime: "0001-01-01T00:00:00Z" })),
      ]),
    ).toEqual([
      {
        providerDeviceId: "0f7c8c6b-0c2a-4d6e-9a1b-2c3d4e5f6a7b",
        lastCheckInAt: new Date("2026-11-19T11:40:00Z"),
      },
    ]);
  });

  test("the overview's enrolled devices", () => {
    expect(parseIntuneEnrolledDeviceCount({ enrolledDeviceCount: 412 })).toBe(
      412,
    );
    expect(parseIntuneEnrolledDeviceCount({ enrolledDeviceCount: -1 })).toBe(
      undefined,
    );
    expect(parseIntuneEnrolledDeviceCount({})).toBe(undefined);
  });
});

describe("a device's discovered apps", () => {
  test("by name, with the version; one per name", () => {
    expect(
      parseIntuneDetectedApps({
        id: "0f7c8c6b-0c2a-4d6e-9a1b-2c3d4e5f6a7b",
        detectedApps: [
          buildIntuneDetectedApp(),
          buildIntuneDetectedApp({
            id: "x",
            displayName: "Company Portal",
            version: "11.2.1078.0",
          }),
          buildIntuneDetectedApp({ id: "y", version: "130.0.2849.80" }),
          buildIntuneDetectedApp({ id: "z", displayName: "" }),
        ],
      }),
    ).toEqual([
      {
        packageName: "Microsoft Edge",
        appName: "Microsoft Edge",
        versionName: "131.0.2903.51",
        versionCode: "",
        state: "",
        isKioskApp: false,
        isManagedByService: false,
      },
      {
        packageName: "Company Portal",
        appName: "Company Portal",
        versionName: "11.2.1078.0",
        versionCode: "",
        state: "",
        isKioskApp: false,
        isManagedByService: false,
      },
    ]);
  });

  test("none listed, or not a list, is none", () => {
    expect(parseIntuneDetectedApps({ id: "a" })).toEqual([]);
    expect(parseIntuneDetectedApps({ id: "a", detectedApps: {} })).toEqual([]);
    expect(parseIntuneDetectedApps(undefined)).toEqual([]);
  });
});

/*
 * #10287: an iPhone's or an iPad's battery, as beta's single-device GET
 * with $select=id,hardwareInformation answers it. Graph's reference: the
 * level is "between 0.0 and 100, or null if the battery level cannot be
 * determined", filled per check-in on iOS and iPadOS alone.
 */
describe("a device's battery", () => {
  function answerOf(hardware: JSONObject): JSONObject {
    return {
      "@odata.context":
        "https://graph.microsoft.com/beta/$metadata#deviceManagement/managedDevices(id,hardwareInformation)/$entity",
      id: "7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a",
      hardwareInformation: buildIntuneHardwareInformation(hardware),
    };
  }

  test("an iPhone's level, whole, as Intune last heard it", () => {
    expect(
      parseIntuneBatteryLevel(
        answerOf({
          serialNumber: "F2LXK1GHJKL0",
          imei: "35 309310 543210 2",
          isSupervised: true,
          productName: "iPhone15,4",
          batteryLevelPercentage: 87,
        }),
      ),
    ).toBe(87);
  });

  test("an iPad's, a Double, rounded to a whole percent", () => {
    expect(
      parseIntuneBatteryLevel(
        answerOf({ productName: "iPad12,1", batteryLevelPercentage: 14.5 }),
      ),
    ).toBe(15);
    expect(
      parseIntuneBatteryLevel(answerOf({ batteryLevelPercentage: 19.4 })),
    ).toBe(19);
    // Not below 20% by rounding a 19.6 up: 20 is not low.
    expect(
      parseIntuneBatteryLevel(answerOf({ batteryLevelPercentage: 19.6 })),
    ).toBe(20);
    // A sliver above 0 is 1%, never 0, which is no battery.
    expect(
      parseIntuneBatteryLevel(answerOf({ batteryLevelPercentage: 0.4 })),
    ).toBe(1);
    expect(
      parseIntuneBatteryLevel(answerOf({ batteryLevelPercentage: 100 })),
    ).toBe(100);
  });

  test("a device Graph says no level of - a Windows PC, an iPhone without the Device Information right - has none", () => {
    // A Windows laptop: its battery's health and cycles, never its level.
    expect(
      parseIntuneBatteryLevel(
        answerOf({
          batteryHealthPercentage: 92,
          batteryChargeCycles: 311,
          batterySerialNumber: "SMP-0A1B2C",
          batteryLevelPercentage: null,
        }),
      ),
    ).toBeNull();
    // As the list answers it: the defaults, the level among them.
    expect(parseIntuneBatteryLevel(answerOf({}))).toBeNull();
    expect(
      parseIntuneBatteryLevel({ id: "x", hardwareInformation: null }),
    ).toBeNull();
    expect(parseIntuneBatteryLevel({ id: "x" })).toBeNull();
  });

  test("0, out of range or not a number is none", () => {
    const levels: Array<JSONValue> = [0, -1, 100.5, 250, "high", true, {}, []];

    for (const level of levels) {
      expect(
        parseIntuneBatteryLevel(answerOf({ batteryLevelPercentage: level })),
      ).toBeNull();
    }

    // A figure written as text still reads: the reference's own JSON says "4.2".
    expect(
      parseIntuneBatteryLevel(answerOf({ batteryLevelPercentage: "4.2" })),
    ).toBe(4);
    expect(
      parseIntuneBatteryLevel(answerOf({ batteryLevelPercentage: "42.0" })),
    ).toBe(42);
  });

  test("the device under value, as the reference's example writes the answer, reads the same", () => {
    expect(
      parseIntuneBatteryLevel({
        value: {
          "@odata.type": "#microsoft.graph.managedDevice",
          id: "705c034c-034c-705c-4c03-5c704c035c70",
          hardwareInformation: buildIntuneHardwareInformation({
            batteryLevelPercentage: 7.333333333333333,
          }),
        },
      }),
    ).toBe(7);
  });

  test("an answer that is no device is none", () => {
    for (const answer of [undefined, null, "", "OK", 42, [], {}]) {
      expect(parseIntuneBatteryLevel(answer)).toBeNull();
    }
  });
});

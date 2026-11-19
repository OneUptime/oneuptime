import { describe, expect, test } from "@jest/globals";
import {
  ESPER_IMPORTED_PLATFORMS,
  cleanText,
  isEsperId,
  newestCheckIns,
  normalizeMacAddress,
  parseEsperApp,
  parseEsperCheckIn,
  parseEsperDevice,
  parseEsperDeviceLastSeen,
  parseEsperGroup,
  parseEsperUserInfo,
  readEsperApplePlatform,
} from "../../../../Server/Utils/DeviceManagement/Esper/EsperParsers";
import {
  ProviderCheckIn,
  ProviderDevice,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../../Types/JSON";
import {
  ESPER_ENTERPRISE_ID,
  buildEsperApp,
  buildEsperAppleDevice,
  buildEsperDevice,
  buildEsperGroup,
  buildEsperUserInfo,
} from "./EsperFixtures";

/*
 * Esper's answers read without trusting them: every documented field, in
 * Esper's spelling, cleaned and bounded, and a value of the wrong type read
 * as absent - so one odd device never fails a read of the fleet.
 */

const DEVICE_ID: string = "811a2d27-13fd-4358-8dc3-aed049e73ce7";
const IPAD_ID: string = "9b3e7c41-5d2a-4f8e-b1c6-0a7d4e2f9c15";

/*
 * device_AppleDeviceV2 (#9837): an iPhone, an iPad or an Apple TV, read by
 * the names it shares with an Android device, its own beside them.
 */
describe("an Apple device", () => {
  test("is read with every documented fact, by the Apple schema's names", () => {
    const device: ProviderDevice | null = parseEsperDevice(
      buildEsperAppleDevice({
        id: IPAD_ID,
        name: "ESP-ID-IPAD1",
        alias: "Front counter iPad",
        serial: "DMPXK2ABQ1GC",
        os: "iPadOS",
        osVersion: "17.4.1",
        buildNumber: "21E236",
        state: 1,
        groupId: "22222222-bbbb-4bbb-8bbb-000000000001",
        isKiosk: true,
        batteryLevel: 76,
      }),
    );

    expect(device).not.toBeNull();
    expect(device!.platform).toBe(ManagedDevicePlatform.IPadOS);
    expect(device!.deviceName).toBe("ESP-ID-IPAD1");
    expect(device!.alias).toBe("Front counter iPad");
    expect(device!.serialNumber).toBe("DMPXK2ABQ1GC");
    expect(device!.model).toBe("iPad (10th generation)");
    expect(device!.osVersion).toBe("17.4.1");
    expect(device!.buildNumber).toBe("21E236");
    expect(device!.state).toBe(1);
    expect(device!.groupId).toBe("22222222-bbbb-4bbb-8bbb-000000000001");
    expect(device!.isKioskMode).toBe(true);
    expect(device!.batteryLevel).toBe(76);
    expect(device!.macAddress).toBe("3c:22:fb:10:aa:21");
    expect(device!.ipAddresses).toEqual([]);
    expect(device!.provisionedAt).toEqual(new Date("2026-03-02T15:04:05Z"));
  });

  test("is Apple's, whether or not Esper says who made it", () => {
    expect(
      parseEsperDevice(buildEsperAppleDevice({ id: IPAD_ID, name: "x" }))!
        .manufacturer,
    ).toBe("Apple");
  });

  test("has no security patch level and no Esper agent: those are Android's", () => {
    const value: JSONObject = buildEsperAppleDevice({ id: IPAD_ID, name: "x" });
    (value["software_info"] as JSONObject)["security_path_level"] =
      "2024-09-01";
    (value["software_info"] as JSONObject)["esper_agent_info"] = {
      version_name: "8.00.0764",
    };

    const device: ProviderDevice = parseEsperDevice(value)!;

    expect(device.securityPatchLevel).toBe("");
    expect(device.agentVersion).toBe("");
  });

  test("keeps its UDID, its supervision and where it was enrolled from, and its storage in gigabytes", () => {
    const device: ProviderDevice = parseEsperDevice(
      buildEsperAppleDevice({ id: IPAD_ID, name: "x" }),
    )!;

    expect(device.details).toEqual(
      expect.objectContaining({
        udid: "00008030-001A2D3C0E91402E",
        isSupervised: true,
        deviceSource: "ABM",
        operatingSystem: "iPadOS",
        totalStorage: "64",
        totalRam: "4",
        memoryUnits: "GB",
        availableRamBytes: 1200000000,
        availableStorageBytes: 31500000000,
      }),
    );
    // An Android device's names for free memory are not an Apple device's bytes.
    expect(device.details["availableRam"]).toBeUndefined();
    expect(device.details["availableStorage"]).toBeUndefined();
  });

  test("runs iOS, iPadOS or tvOS as its os says, else as its model says, else iOS", () => {
    const platformOf: (fixture: {
      os?: string;
      model?: string;
    }) => ManagedDevicePlatform | undefined = (fixture: {
      os?: string;
      model?: string;
    }): ManagedDevicePlatform | undefined => {
      const value: JSONObject = buildEsperAppleDevice({
        id: IPAD_ID,
        name: "x",
        ...(fixture.model ? { model: fixture.model } : {}),
      });
      value["os"] = fixture.os ?? null;

      return parseEsperDevice(value)?.platform;
    };

    expect(platformOf({ os: "iOS", model: "iPhone 15" })).toBe(
      ManagedDevicePlatform.IOS,
    );
    expect(platformOf({ os: "iPadOS" })).toBe(ManagedDevicePlatform.IPadOS);
    expect(platformOf({ os: "tvOS", model: "Apple TV 4K" })).toBe(
      ManagedDevicePlatform.TvOS,
    );
    // Esper does not manage Macs today; one would still read as one.
    expect(platformOf({ os: "macOS", model: "Mac mini" })).toBe(
      ManagedDevicePlatform.MacOS,
    );
    expect(platformOf({ model: "iPad Pro (11-inch)" })).toBe(
      ManagedDevicePlatform.IPadOS,
    );
    expect(platformOf({ model: "Apple TV HD" })).toBe(
      ManagedDevicePlatform.TvOS,
    );
    expect(platformOf({ model: "iPhone 15" })).toBe(ManagedDevicePlatform.IOS);
    expect(readEsperApplePlatform({ os: undefined, model: undefined })).toBe(
      ManagedDevicePlatform.IOS,
    );
  });

  test("its last check-in is its last_seen, never later than now, and none without one", () => {
    const now: Date = new Date("2026-11-19T12:00:00.000Z");

    expect(
      parseEsperDeviceLastSeen(
        buildEsperAppleDevice({
          id: IPAD_ID,
          name: "x",
          lastSeen: "2026-11-19T09:30:00Z",
        }),
        now,
      ),
    ).toEqual(new Date("2026-11-19T09:30:00Z"));
    expect(
      parseEsperDeviceLastSeen(
        buildEsperAppleDevice({
          id: IPAD_ID,
          name: "x",
          lastSeen: "2026-11-19T13:00:00Z",
        }),
        now,
      ),
    ).toEqual(now);
    expect(
      parseEsperDeviceLastSeen(
        buildEsperAppleDevice({ id: IPAD_ID, name: "x", lastSeen: null }),
        now,
      ),
    ).toBeNull();
    expect(
      parseEsperDeviceLastSeen(
        { ...buildEsperAppleDevice({ id: IPAD_ID, name: "x" }), last_seen: 7 },
        now,
      ),
    ).toBeNull();
  });

  test("the platforms a read lists are Android and Apple", () => {
    expect(ESPER_IMPORTED_PLATFORMS).toEqual(["ANDROID", "APPLE"]);
  });
});

describe("a device", () => {
  test("every documented fact, from the v2 device schema", () => {
    const device: ProviderDevice | null = parseEsperDevice(
      buildEsperDevice({
        id: DEVICE_ID,
        name: "ESP-ID-AAAAW",
        alias: "Store 0412 Kiosk 1",
        serial: "R9KT30ABC12",
        imei: "353627081234567",
        state: 60,
        groupId: "22222222-bbbb-4bbb-8bbb-000000000001",
        ipAddresses: ["10.40.12.31", "fe80::1", "10.40.12.31"],
      }),
    );

    expect(device).not.toBeNull();
    expect(device!.providerDeviceId).toBe(DEVICE_ID);
    expect(device!.imei).toBe("353627081234567");
    expect(device!.state).toBe(60);
    // Deduplicated, in Esper's order.
    expect(device!.ipAddresses).toEqual(["10.40.12.31", "fe80::1"]);
  });

  test("the security patch level, under Esper's spelling or the right one", () => {
    const misspelt: JSONObject = buildEsperDevice({
      id: DEVICE_ID,
      name: "ESP-ID-AAAAW",
      securityPatchLevel: "2024-10-05",
    });

    expect(parseEsperDevice(misspelt)!.securityPatchLevel).toBe("2024-10-05");

    const fixed: JSONObject = buildEsperDevice({ id: DEVICE_ID, name: "x" });
    const software: JSONObject = fixed["software_info"] as JSONObject;
    delete software["security_path_level"];
    software["security_patch_level"] = "2025-01-01";

    expect(parseEsperDevice(fixed)!.securityPatchLevel).toBe("2025-01-01");
  });

  test("a Windows or Linux device, a platform Esper names that OneUptime does not, or one with no ID, is left out", () => {
    for (const platform of ["WINDOWS", "LINUX", "CHROMEOS"]) {
      expect(
        parseEsperDevice(
          buildEsperDevice({ id: DEVICE_ID, name: "x", platform }),
        ),
      ).toBeNull();
    }
    expect(parseEsperDevice({ name: "no id" })).toBeNull();
    expect(parseEsperDevice(null)).toBeNull();
    expect(parseEsperDevice("a string")).toBeNull();
  });

  test("an Android device says so, and so does one that names no platform", () => {
    expect(
      parseEsperDevice(buildEsperDevice({ id: DEVICE_ID, name: "x" }))!
        .platform,
    ).toBe(ManagedDevicePlatform.Android);
    expect(
      parseEsperDevice(
        buildEsperDevice({ id: DEVICE_ID, name: "x", platform: "android" }),
      )!.platform,
    ).toBe(ManagedDevicePlatform.Android);
  });

  test("a device with almost nothing still reads, its facts empty", () => {
    const device: ProviderDevice | null = parseEsperDevice({ id: DEVICE_ID });

    expect(device).toEqual({
      providerDeviceId: DEVICE_ID,
      platform: ManagedDevicePlatform.Android,
      deviceName: "",
      alias: "",
      serialNumber: "",
      imei: "",
      manufacturer: "",
      brand: "",
      model: "",
      osVersion: "",
      buildNumber: "",
      securityPatchLevel: "",
      agentVersion: "",
      state: null,
      groupId: "",
      isKioskMode: null,
      batteryLevel: null,
      ipAddresses: [],
      macAddress: "",
      provisionedAt: null,
      details: {},
    });
  });

  test("values of the wrong type are absent, never a failure", () => {
    const device: ProviderDevice | null = parseEsperDevice({
      id: DEVICE_ID,
      name: { nested: true },
      state: "not a number",
      hardware_info: "not an object",
      battery_stats: { battery_level: 250 },
      app_mode_meta: { is_kiosk: "yes" },
      provisioned_on: "not a date",
      network_stats: { ip_address: 42 },
    });

    expect(device!.deviceName).toBe("");
    expect(device!.state).toBeNull();
    expect(device!.manufacturer).toBe("");
    expect(device!.batteryLevel).toBeNull();
    expect(device!.isKioskMode).toBeNull();
    expect(device!.provisionedAt).toBeNull();
    expect(device!.ipAddresses).toEqual([]);
  });

  test("text is cleaned of control characters and held to its column", () => {
    expect(cleanText("  Store\u0000 0412\nKiosk  ")).toBe("Store  0412 Kiosk");
    expect(cleanText("x".repeat(500))).toHaveLength(100);
    expect(cleanText(42)).toBe("42");
    expect(cleanText(undefined)).toBe("");
  });

  test("the serial number, from the device or its hardware", () => {
    const device: JSONObject = buildEsperDevice({ id: DEVICE_ID, name: "x" });
    device["serial"] = "";
    (device["hardware_info"] as JSONObject)["serial"] = "HW-SERIAL-1";

    expect(parseEsperDevice(device)!.serialNumber).toBe("HW-SERIAL-1");
  });
});

describe("a MAC address", () => {
  test("lowercase and colon-separated, whatever its spelling", () => {
    expect(normalizeMacAddress("A4-C1-38-00-12-7F")).toBe("a4:c1:38:00:12:7f");
    expect(normalizeMacAddress("a4c1.3800.127f")).toBe("a4:c1:38:00:12:7f");
  });

  test("a placeholder is no address: all zeros, or Android's 02:00:00:00:00:00", () => {
    expect(normalizeMacAddress("00:00:00:00:00:00")).toBe("");
    expect(normalizeMacAddress("02:00:00:00:00:00")).toBe("");
    expect(normalizeMacAddress("not a mac")).toBe("");
    expect(normalizeMacAddress("a4:c1:38:00:12")).toBe("");
    expect(normalizeMacAddress(undefined)).toBe("");
  });
});

describe("groups, check-ins, apps and the key's user", () => {
  test("a group, with its path - or its name, when Esper gives none", () => {
    expect(
      parseEsperGroup(
        buildEsperGroup({ id: "g1", name: "West", path: "Stores/West" }),
      ),
    ).toEqual({ id: "g1", name: "West", path: "Stores/West" });

    const noPath: JSONObject = buildEsperGroup({ id: "g2", name: "East" });
    noPath["path"] = null;

    expect(parseEsperGroup(noPath)).toEqual({
      id: "g2",
      name: "East",
      path: "East",
    });
    expect(parseEsperGroup({ name: "no id" })).toBeNull();
  });

  test("a check-in needs a device and a time; the legacy status flag is not kept", () => {
    expect(
      parseEsperCheckIn({
        device_id: DEVICE_ID,
        timestamp: "2026-11-19T11:56:00Z",
        status: 1,
      }),
    ).toEqual({
      providerDeviceId: DEVICE_ID,
      lastCheckInAt: new Date("2026-11-19T11:56:00Z"),
    });
    expect(parseEsperCheckIn({ device_id: DEVICE_ID })).toBeNull();
    expect(parseEsperCheckIn({ timestamp: "2026-11-19T11:56:00Z" })).toBeNull();
  });

  test("the newest check-in per device, never after now", () => {
    const now: Date = new Date("2026-11-19T12:00:00Z");
    const checkIns: Array<ProviderCheckIn> = newestCheckIns(
      [
        { device_id: "a", timestamp: "2026-11-19T11:00:00Z" },
        { device_id: "a", timestamp: "2026-11-19T11:30:00Z" },
        { device_id: "b", timestamp: "2026-11-19T13:00:00Z" },
        { device_id: "c" },
      ],
      now,
    );

    expect(checkIns).toEqual([
      {
        providerDeviceId: "a",
        lastCheckInAt: new Date("2026-11-19T11:30:00Z"),
      },
      { providerDeviceId: "b", lastCheckInAt: now },
    ]);
  });

  test("an app needs its package name", () => {
    expect(
      parseEsperApp(
        buildEsperApp({
          deviceId: DEVICE_ID,
          packageName: "com.example.kiosk",
          appName: "Ordering Kiosk",
          versionName: "2.4.1",
          versionCode: "241",
          isKioskApp: true,
          isEsperControlled: false,
        }),
      ),
    ).toEqual({
      packageName: "com.example.kiosk",
      appName: "Ordering Kiosk",
      versionName: "2.4.1",
      versionCode: "241",
      state: "INSTALL",
      isKioskApp: true,
      isManagedByService: false,
    });
    expect(parseEsperApp({ app_name: "No package" })).toBeNull();
  });

  test("the key's user: its enterprise and its role", () => {
    expect(
      parseEsperUserInfo(
        buildEsperUserInfo({
          enterpriseId: ESPER_ENTERPRISE_ID,
          role: "Viewer",
        }),
      ),
    ).toEqual({ enterpriseId: ESPER_ENTERPRISE_ID, role: "Viewer" });
    expect(parseEsperUserInfo({})).toEqual({ enterpriseId: "", role: "" });
  });

  test("only an ID of a UUID's characters can go into a URL path", () => {
    expect(isEsperId(DEVICE_ID)).toBe(true);
    expect(isEsperId("../user_info")).toBe(false);
    expect(isEsperId("abc")).toBe(false);
    expect(isEsperId(`${DEVICE_ID}/app`)).toBe(false);
  });
});

import { describe, expect, test } from "@jest/globals";
import {
  cleanText,
  isEsperId,
  newestCheckIns,
  normalizeMacAddress,
  parseEsperApp,
  parseEsperCheckIn,
  parseEsperDevice,
  parseEsperGroup,
  parseEsperUserInfo,
} from "../../../../Server/Utils/DeviceManagement/Esper/EsperParsers";
import {
  ProviderCheckIn,
  ProviderDevice,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import { JSONObject } from "../../../../Types/JSON";
import {
  ESPER_ENTERPRISE_ID,
  buildEsperApp,
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

  test("another platform's device, or one with no ID, is left out", () => {
    expect(
      parseEsperDevice(
        buildEsperDevice({ id: DEVICE_ID, name: "x", platform: "WINDOWS" }),
      ),
    ).toBeNull();
    expect(parseEsperDevice({ name: "no id" })).toBeNull();
    expect(parseEsperDevice(null)).toBeNull();
    expect(parseEsperDevice("a string")).toBeNull();
  });

  test("a device with almost nothing still reads, its facts empty", () => {
    const device: ProviderDevice | null = parseEsperDevice({ id: DEVICE_ID });

    expect(device).toEqual({
      providerDeviceId: DEVICE_ID,
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

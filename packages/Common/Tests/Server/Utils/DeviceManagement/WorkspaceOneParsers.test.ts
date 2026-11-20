import { describe, expect, test } from "@jest/globals";
import {
  ProviderApp,
  ProviderCheckIn,
  ProviderGroup,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import {
  WorkspaceOneDeviceRead,
  WorkspaceOnePage,
  getWorkspaceOneCheckIns,
  getWorkspaceOneGroups,
  isWorkspaceOneDeviceEnrolled,
  parseWorkspaceOneApp,
  parseWorkspaceOneApps,
  parseWorkspaceOneDevice,
  readWorkspaceOneBatteryLevel,
  readWorkspaceOneDate,
  readWorkspaceOneDeviceId,
  readWorkspaceOneError,
  readWorkspaceOnePage,
  readWorkspaceOnePlatform,
} from "../../../../Server/Utils/DeviceManagement/WorkspaceOne/WorkspaceOneParsers";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../../Types/JSON";
import {
  buildWorkspaceOneAndroid,
  buildWorkspaceOneApp,
  buildWorkspaceOneDevice,
  buildWorkspaceOneIpad,
  buildWorkspaceOneWindows,
} from "./FakeWorkspaceOneApi";

/*
 * Workspace ONE UEM's answers (#10086), read into the connector contract's
 * shapes, from payloads shaped as Omnissa's MDM REST API V1 reference
 * (release 2607) documents them: DeviceExtended as the device search lists
 * it, DeviceApplicationInfo as a device's apps list it. What each device
 * runs, when it last reported, which devices are left out, odd and missing
 * values, and the user's details never kept.
 */

const NOW: Date = new Date("2026-11-19T12:00:00Z");

function read(raw: JSONObject): WorkspaceOneDeviceRead {
  const parsed: WorkspaceOneDeviceRead | null = parseWorkspaceOneDevice(
    raw,
    NOW,
  );

  expect(parsed).not.toBeNull();
  return parsed!;
}

describe("a device", () => {
  test("an iPhone: its ID, name, serial, model, system, group and facts", () => {
    const { device, lastSeenAt } = read(buildWorkspaceOneDevice());

    expect(device).toMatchObject({
      providerDeviceId: "15",
      platform: ManagedDevicePlatform.IOS,
      deviceName: "Store 0412 Front Counter",
      alias: "",
      serialNumber: "F2LXK1AAAAAA",
      imei: "356938035643809",
      manufacturer: "Apple",
      model: "iPhone 15 (128 GB Black)",
      osVersion: "17.6.1",
      buildNumber: "21G93",
      securityPatchLevel: "",
      state: null,
      groupId: "1041",
      batteryLevel: 87,
      ipAddresses: ["10.20.30.41"],
      macAddress: "a4:83:e7:12:34:56",
    });
    expect(device.provisionedAt).toEqual(new Date("2025-03-04T09:12:44Z"));
    // LastSeen has no zone: Workspace ONE writes UTC.
    expect(lastSeenAt).toEqual(new Date("2026-11-19T11:40:00.123Z"));
    expect(device.details).toEqual({
      operatingSystem: "Apple",
      complianceState: "Compliant",
      enrollmentStatus: "Enrolled",
      ownership: "Corporate - Dedicated",
      isCompromised: false,
      isSupervised: true,
      assetNumber: "STORE-0412-07",
      deviceUuid: "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
      totalStorage: "119.2",
      freeStorage: "87.4",
      totalRam: "6",
      memoryUnits: "GB",
      // #10008: its storage in bytes, from its gigabytes, for how full it is.
      storageTotalBytes: 119200000000,
      storageFreeBytes: 87400000000,
    });
  });

  test("nothing about its user is kept: not the user's name, email or phone, and not the friendly name made of them", () => {
    const kept: string = JSON.stringify(read(buildWorkspaceOneDevice()));

    for (const personal of [
      "mbowen",
      "Megan",
      "megan@contoso.com",
      "+15555550123",
      "2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e",
      "Store-0412",
    ]) {
      expect(kept).not.toContain(personal);
    }
  });

  test("an iPad is iPadOS by its model; a Mac, Windows, Android, Linux and an Apple TV by their platform", () => {
    expect(read(buildWorkspaceOneIpad()).device.platform).toBe(
      ManagedDevicePlatform.IPadOS,
    );
    expect(read(buildWorkspaceOneWindows()).device.platform).toBe(
      ManagedDevicePlatform.Windows,
    );
    expect(read(buildWorkspaceOneAndroid()).device.platform).toBe(
      ManagedDevicePlatform.Android,
    );

    for (const [platform, expected] of [
      ["AppleOsX", ManagedDevicePlatform.MacOS],
      ["WindowsPC", ManagedDevicePlatform.Windows],
      ["WindowsPhone8", ManagedDevicePlatform.Windows],
      ["Linux", ManagedDevicePlatform.Linux],
      ["AppleTv", ManagedDevicePlatform.TvOS],
      ["Qnx", ManagedDevicePlatform.Other],
      ["BlackBerry10", ManagedDevicePlatform.Other],
    ] as Array<[string, ManagedDevicePlatform]>) {
      expect(readWorkspaceOnePlatform({ platform, model: "Model" })).toBe(
        expected,
      );
    }

    // An iPod touch is iOS.
    expect(
      readWorkspaceOnePlatform({ platform: "Apple", model: "iPod touch" }),
    ).toBe(ManagedDevicePlatform.IOS);
  });

  test("an Android device keeps its security patch level as Android writes it; another platform none", () => {
    const android: WorkspaceOneDeviceRead = read(buildWorkspaceOneAndroid());

    expect(android.device.securityPatchLevel).toBe("2026-10-01");
    // Android's placeholder MAC is no MAC.
    expect(android.device.macAddress).toBe("a4:83:e7:12:34:56");
    // A battery fraction is a percent.
    expect(android.device.batteryLevel).toBe(55);
    expect(android.device.groupId).toBe("1077");

    expect(
      read(
        buildWorkspaceOneDevice({ SecurityPatchDate: "2026-09-05T00:00:00" }),
      ).device.securityPatchLevel,
    ).toBe("");
  });

  test("a Windows PC: its memory in MB is gigabytes, its MAC written without colons is read", () => {
    const { device } = read(buildWorkspaceOneWindows());

    expect(device.details).toMatchObject({
      totalStorage: "475.8",
      freeStorage: "211.3",
      totalRam: "16",
      memoryUnits: "GB",
    });
    expect(device.macAddress).toBe("7c:1e:52:0a:9b:3f");
    expect(device.batteryLevel).toBe(64);
  });

  test("only an enrolled device is imported; one that says nothing of it is too", () => {
    for (const status of [
      "Unenrolled",
      "EnterpriseWipePending",
      "DeviceWipePending",
      "EnrollmentInProgress",
      "Retired",
    ]) {
      expect(
        parseWorkspaceOneDevice(
          buildWorkspaceOneDevice({ EnrollmentStatus: status }),
          NOW,
        ),
      ).toBeNull();
    }

    expect(isWorkspaceOneDeviceEnrolled("Enrolled")).toBe(true);
    expect(isWorkspaceOneDeviceEnrolled("ENROLLED")).toBe(true);
    expect(isWorkspaceOneDeviceEnrolled(undefined)).toBe(true);
    expect(isWorkspaceOneDeviceEnrolled("")).toBe(true);
  });

  test("a device without a numeric ID is not one", () => {
    for (const id of [
      undefined,
      null,
      {},
      { Value: 0 },
      { Value: -3 },
      { Value: "abc" },
      { Value: 1.5 },
    ]) {
      expect(
        parseWorkspaceOneDevice(
          buildWorkspaceOneDevice({ Id: id as unknown as JSONObject }),
          NOW,
        ),
      ).toBeNull();
    }

    expect(readWorkspaceOneDeviceId({ Id: { Value: "42" } })).toBe("42");
  });

  test("missing and odd values are absent, never a failure", () => {
    const { device, lastSeenAt } = read({
      Id: { Value: 99 },
      Platform: { Name: "Apple" },
      Model: null,
      SerialNumber: ["x"],
      DeviceReportedName: "  Kiosk\u0007 7  ",
      LastSeen: "not a date",
      BatteryLevel: "full",
      DeviceCapacity: "lots",
      DeviceNetworkInfo: "eth0",
      LocationGroupId: "Stores",
      TotalPhysicalMemoryInfo: { MemorySize: 3, MemoryUnit: "furlongs" },
    });

    expect(device).toMatchObject({
      providerDeviceId: "99",
      platform: ManagedDevicePlatform.Other,
      deviceName: "Kiosk  7",
      serialNumber: "",
      model: "",
      batteryLevel: null,
      groupId: "",
      ipAddresses: [],
      macAddress: "",
      provisionedAt: null,
    });
    expect(device.details).toEqual({});
    expect(lastSeenAt).toBeNull();
  });

  /*
   * #10008: its storage in bytes, from Workspace ONE's gigabytes - both in
   * one unit, so how full it is never hangs on it - and none where it says
   * none.
   */
  test("its whole and its free storage in bytes, from its gigabytes; none where it says none", () => {
    const laptop: JSONObject = read(buildWorkspaceOneWindows()).device.details;

    expect(laptop["storageTotalBytes"]).toBe(475.8e9);
    expect(laptop["storageFreeBytes"]).toBe(211.3e9);

    const unsaid: JSONObject = read(
      buildWorkspaceOneAndroid({
        DeviceCapacity: null,
        AvailableDeviceCapacity: 0,
      }),
    ).device.details;

    expect(unsaid["storageTotalBytes"]).toBeUndefined();
    expect(unsaid["storageFreeBytes"]).toBeUndefined();
  });

  test("a device reported in the future reported now; Workspace ONE's year 1 is never", () => {
    expect(
      read(buildWorkspaceOneDevice({ LastSeen: "2027-01-01T00:00:00" }))
        .lastSeenAt,
    ).toEqual(NOW);
    expect(
      read(buildWorkspaceOneDevice({ LastSeen: "0001-01-01T00:00:00" }))
        .lastSeenAt,
    ).toBeNull();
  });
});

describe("dates and battery levels", () => {
  test("a time without a zone is UTC; one with a zone is that zone's", () => {
    expect(readWorkspaceOneDate("2026-11-19T11:40:00")).toEqual(
      new Date("2026-11-19T11:40:00Z"),
    );
    expect(readWorkspaceOneDate("2026-11-19T11:40:00.5Z")).toEqual(
      new Date("2026-11-19T11:40:00.500Z"),
    );
    expect(readWorkspaceOneDate("2026-11-19T06:40:00-05:00")).toEqual(
      new Date("2026-11-19T11:40:00Z"),
    );
    expect(readWorkspaceOneDate("2026-11-19")).toEqual(
      new Date("2026-11-19T00:00:00Z"),
    );

    for (const never of [
      "",
      "  ",
      null,
      42,
      "0001-01-01T00:00:00",
      "1900-01-01T00:00:00",
      "yesterday",
    ]) {
      expect(readWorkspaceOneDate(never)).toBeNull();
    }
  });

  test("a battery level as the device reported it, as a percent", () => {
    expect(readWorkspaceOneBatteryLevel("85%")).toBe(85);
    expect(readWorkspaceOneBatteryLevel("85")).toBe(85);
    expect(readWorkspaceOneBatteryLevel("0.85")).toBe(85);
    expect(readWorkspaceOneBatteryLevel(1)).toBe(1);
    expect(readWorkspaceOneBatteryLevel("100%")).toBe(100);

    for (const none of ["", "-1", "150", "full", null, undefined]) {
      expect(readWorkspaceOneBatteryLevel(none)).toBeNull();
    }
  });
});

describe("groups and check-ins", () => {
  test("each organization group once, by its ID, named as Workspace ONE names it", () => {
    const groups: Array<ProviderGroup> = getWorkspaceOneGroups([
      buildWorkspaceOneDevice(),
      buildWorkspaceOneIpad(),
      buildWorkspaceOneAndroid(),
      { Id: { Value: 5 }, LocationGroupName: "Lab" },
      { Id: { Value: 6 } },
    ]);

    expect(groups).toEqual([
      { id: "1041", name: "Stores West", path: "Stores West" },
      { id: "1077", name: "Warehouse", path: "Warehouse" },
      { id: "Lab", name: "Lab", path: "Lab" },
    ]);
  });

  test("every listed device's last report is its check-in; one that never reported has none", () => {
    const checkIns: Array<ProviderCheckIn> = getWorkspaceOneCheckIns([
      read(buildWorkspaceOneDevice()),
      read(buildWorkspaceOneIpad({ LastSeen: "0001-01-01T00:00:00" })),
    ]);

    expect(checkIns).toEqual([
      {
        providerDeviceId: "15",
        lastCheckInAt: new Date("2026-11-19T11:40:00.123Z"),
      },
    ]);
  });
});

describe("a page", () => {
  test("its items and Total; a 204 is an empty page", () => {
    const page: WorkspaceOnePage | null = readWorkspaceOnePage({
      status: 200,
      body: { Devices: [{}, {}], Page: 0, PageSize: 500, Total: 1234 },
      key: "Devices",
    });

    expect(page).toEqual({ items: [{}, {}], total: 1234 });
    expect(
      readWorkspaceOnePage({ status: 204, body: undefined, key: "Devices" }),
    ).toEqual({ items: [], total: 0 });
    // A later version's lowercase keys read alike.
    expect(
      readWorkspaceOnePage({
        status: 200,
        body: { devices: [{}], total: 1 },
        key: "Devices",
      }),
    ).toEqual({ items: [{}], total: 1 });
  });

  test("an answer that is no list is said, not read as an empty one", () => {
    for (const body of [{ Devices: "none" }, [], "html", { Message: "x" }]) {
      expect(
        readWorkspaceOnePage({ status: 200, body, key: "Devices" }),
      ).toBeNull();
    }

    expect(
      readWorkspaceOnePage({
        status: 200,
        body: { Devices: [], Total: "many" },
        key: "Devices",
      }),
    ).toEqual({ items: [], total: null });
  });
});

describe("a device's apps", () => {
  test("its bundle or package ID is its key; its version and build, and whether Workspace ONE manages it", () => {
    expect(parseWorkspaceOneApp(buildWorkspaceOneApp())).toEqual({
      packageName: "com.example.kiosk",
      appName: "Ordering Kiosk",
      versionName: "2.4.1",
      versionCode: "241",
      state: "Installed",
      isKioskApp: false,
      isManagedByService: true,
    });
  });

  test("an app assigned but not installed, or removed, is not on the device", () => {
    for (const status of ["Pending Install", "PendingInstall", "Removed"]) {
      expect(
        parseWorkspaceOneApp(buildWorkspaceOneApp({ Status: status })),
      ).toBeNull();
    }

    for (const status of ["Pending Removal", "Unknown", ""]) {
      expect(
        parseWorkspaceOneApp(buildWorkspaceOneApp({ Status: status })),
      ).not.toBeNull();
    }
  });

  test("an app without an ID is keyed by its name; one with neither is none; each key once", () => {
    const apps: Array<ProviderApp> = parseWorkspaceOneApps([
      buildWorkspaceOneApp(),
      buildWorkspaceOneApp({ Version: "2.4.0" }),
      buildWorkspaceOneApp({
        ApplicationIdentifier: "",
        ApplicationName: "Notes",
        Version: "",
        AppVersion: "1.0",
        IsManaged: "yes",
      }),
      buildWorkspaceOneApp({ ApplicationIdentifier: "", ApplicationName: "" }),
      "junk",
    ]);

    expect(
      apps.map((app: ProviderApp): string => {
        return `${app.packageName} ${app.versionName} ${app.isManagedByService}`;
      }),
    ).toEqual(["com.example.kiosk 2.4.1 true", "Notes 1.0 false"]);
  });
});

describe("what Workspace ONE said went wrong", () => {
  test("its message and its error code; else the start of the body", () => {
    expect(
      readWorkspaceOneError({
        bodyJson: {
          errorCode: 1029,
          message: "OAuth token is expired.",
          activityId: "5b6c7d8e",
        },
        bodyText: "",
      }),
    ).toBe("OAuth token is expired. (error code 1029)");
    expect(
      readWorkspaceOneError({
        bodyJson: { message: { reason: "quota" } },
        bodyText: "",
      }),
    ).toBe('{"reason":"quota"}');
    expect(
      readWorkspaceOneError({
        bodyJson: undefined,
        bodyText: "<html>Service Unavailable</html>",
      }),
    ).toBe("<html>Service Unavailable</html>");
    expect(readWorkspaceOneError({ bodyJson: undefined, bodyText: "" })).toBe(
      "",
    );
  });
});

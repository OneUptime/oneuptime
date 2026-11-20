import { describe, expect, test } from "@jest/globals";
import {
  ProviderApp,
  ProviderGroup,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import {
  SotiDeviceRead,
  getSotiCheckIns,
  getSotiGroups,
  isSotiDeviceManaged,
  parseSotiApp,
  parseSotiApps,
  parseSotiDevice,
  parseSotiManagedDeviceCount,
  readSotiDate,
  readSotiError,
  readSotiGroupPath,
  readSotiLastCheckIn,
  readSotiPlatform,
} from "../../../../Server/Utils/DeviceManagement/Soti/SotiParsers";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { EsperDeviceState } from "../../../../Types/DeviceManagement/ManagedDeviceStatus";
import { JSONObject } from "../../../../Types/JSON";
import {
  buildSotiApp,
  buildSotiDevice,
  buildSotiIpad,
  buildSotiWindows,
} from "./FakeSotiApi";

/*
 * SOTI MobiControl's answers (#10087), read into the connector contract's
 * shapes, from payloads shaped as its REST API reference documents them:
 * DeviceBase with its Kind's fields (AndroidPlus, Ios, WindowsDesktop...)
 * as GET /devices lists them, InstalledApplication as a device's apps
 * list them, an aggregation as /devices/summary answers it. What each
 * device runs, when it was last there - its agent's live connection
 * first - which devices are left out, odd and missing values, and the
 * user's details never kept.
 */

const NOW: Date = new Date("2026-11-19T12:00:00Z");

function read(raw: JSONObject): SotiDeviceRead {
  const parsed: SotiDeviceRead | null = parseSotiDevice(raw, NOW);

  expect(parsed).not.toBeNull();
  return parsed!;
}

describe("a device", () => {
  test("an Android Plus scanner: its ID, name, serial, model, system, group, agent and facts", () => {
    const { device } = read(buildSotiDevice());

    expect(device).toMatchObject({
      providerDeviceId: "35-8C4F2A9B1D7E",
      platform: ManagedDevicePlatform.Android,
      deviceName: "WH-SCANNER-07",
      alias: "",
      serialNumber: "21075B2C3D",
      imei: "354123456789012",
      manufacturer: "Zebra Technologies",
      model: "TC52",
      osVersion: "13",
      securityPatchLevel: "2026-10-01",
      agentVersion: "2025.0.1.1234",
      state: null,
      groupId: "Acme/Warehouses/Dallas",
      batteryLevel: 76,
      ipAddresses: ["fe80::211:22ff:fe33:4457"],
      macAddress: "00:11:22:33:44:57",
    });
    expect(device.provisionedAt).toEqual(new Date("2025-03-04T09:12:44Z"));
    expect(device.details).toEqual({
      operatingSystem: "AndroidPlus",
      complianceState: "Compliant",
      mode: "Active",
      isAgentOnline: true,
      isEncrypted: true,
      enrollmentType: "DeviceEnrollment",
      totalStorage: "31.7",
      freeStorage: "18.3",
      totalRam: "3.8",
      memoryUnits: "GB",
    });
  });

  test("nothing about its user is kept: not the user, the last one logged on, the phone number, the personalized name or custom attributes", () => {
    const kept: string = JSON.stringify(read(buildSotiDevice()));

    for (const personal of [
      "mbowen",
      "Megan",
      "megan@contoso.com",
      "+15555550123",
      "Owner",
      "wh-scanner-07",
    ]) {
      expect(kept).not.toContain(personal);
    }
  });

  test("an iPad is iPadOS by its model, its serial its manufacturer's; Windows, a Mac, Linux and Android Enterprise by their Kind", () => {
    const ipad: SotiDeviceRead = read(buildSotiIpad());

    expect(ipad.device.platform).toBe(ManagedDevicePlatform.IPadOS);
    expect(ipad.device.serialNumber).toBe("DMPXK1ABCDEF");
    expect(ipad.device.securityPatchLevel).toBe("");
    expect(ipad.device.buildNumber).toBe("21G93");
    expect(read(buildSotiWindows()).device.platform).toBe(
      ManagedDevicePlatform.Windows,
    );

    for (const [kind, expected] of [
      ["Mac", ManagedDevicePlatform.MacOS],
      ["Linux", ManagedDevicePlatform.Linux],
      ["LinuxXtHub", ManagedDevicePlatform.Linux],
      ["AndroidForWork", ManagedDevicePlatform.Android],
      ["AndroidKnox", ManagedDevicePlatform.Android],
      ["AndroidElm", ManagedDevicePlatform.Android],
      ["WindowsCE", ManagedDevicePlatform.Windows],
      ["WindowsDesktopLegacy", ManagedDevicePlatform.Windows],
      ["WindowsHoloLens", ManagedDevicePlatform.Windows],
      ["ZebraPrinter", ManagedDevicePlatform.Other],
    ] as Array<[string, ManagedDevicePlatform]>) {
      expect(readSotiPlatform({ Kind: kind, Model: "x" })).toBe(expected);
    }

    // An iPhone is iOS; an unknown Kind is read by its Platform.
    expect(readSotiPlatform({ Kind: "Ios", Model: "iPhone 15" })).toBe(
      ManagedDevicePlatform.IOS,
    );
    expect(readSotiPlatform({ Kind: "Ios", ProductName: "iPad12,1" })).toBe(
      ManagedDevicePlatform.IPadOS,
    );
    expect(readSotiPlatform({ Kind: "Unknown", Platform: "WindowsTen64" })).toBe(
      ManagedDevicePlatform.Windows,
    );
  });

  test("an Active device and a Disabled one are imported, the Disabled one as Disabled; an unenrolled one is not", () => {
    expect(read(buildSotiDevice({ Mode: "Disabled" })).device.state).toBe(
      EsperDeviceState.Disabled,
    );
    expect(read(buildSotiDevice({ Mode: undefined as unknown as string })).device.state).toBeNull();

    for (const mode of [
      "UnenrollPendingUser",
      "UnenrollPendingAdmin",
      "UnenrolledByUser",
      "UnenrolledByAdmin",
    ]) {
      expect(parseSotiDevice(buildSotiDevice({ Mode: mode }), NOW)).toBeNull();
    }

    expect(isSotiDeviceManaged("ACTIVE")).toBe(true);
    expect(isSotiDeviceManaged("")).toBe(true);
  });

  test("a device without an ID is not one", () => {
    for (const id of ["", "   ", null, {}, ["35-1"]]) {
      expect(
        parseSotiDevice(
          buildSotiDevice({ DeviceId: id as unknown as string }),
          NOW,
        ),
      ).toBeNull();
    }

    // A number is written out as an ID.
    expect(read(buildSotiDevice({ DeviceId: 42 })).device.providerDeviceId).toBe(
      "42",
    );
  });

  test("missing and odd values are absent, never a failure", () => {
    const { device, lastCheckInAt } = read({
      DeviceId: "X1",
      Kind: ["Android"],
      Path: 7,
      Memory: "lots",
      BatteryStatus: 255,
      MACAddress: "nope",
      WifiMAC: "00:00:00:00:00:00",
      LastCheckInTime: "never",
      IsAgentOnline: "true",
      EnrollmentTime: "",
    });

    expect(device).toMatchObject({
      providerDeviceId: "X1",
      platform: ManagedDevicePlatform.Other,
      deviceName: "",
      serialNumber: "",
      groupId: "7",
      batteryLevel: null,
      ipAddresses: [],
      macAddress: "",
      provisionedAt: null,
    });
    expect(device.details).toEqual({});
    expect(lastCheckInAt).toBeNull();
  });
});

describe("when a device was last there", () => {
  test("while its agent is connected, at the read; once it is not, the latest of what MobiControl says", () => {
    expect(readSotiLastCheckIn({ IsAgentOnline: true }, NOW)).toEqual(NOW);

    // The Windows laptop: its agent disconnected at 10:00, after its 09:30 check-in.
    expect(read(buildSotiWindows()).lastCheckInAt).toEqual(
      new Date("2026-11-19T10:00:00Z"),
    );
    // The iPad: its last MDM status update, at 04:30.
    expect(read(buildSotiIpad()).lastCheckInAt).toEqual(
      new Date("2026-11-19T04:30:00Z"),
    );
  });

  test("a time in the future is now; year 1 is never; a time without a zone is UTC", () => {
    expect(
      readSotiLastCheckIn(
        { IsAgentOnline: false, LastCheckInTime: "2027-01-01T00:00:00Z" },
        NOW,
      ),
    ).toEqual(NOW);
    expect(
      readSotiLastCheckIn(
        {
          IsAgentOnline: false,
          LastCheckInTime: "0001-01-01T00:00:00Z",
          LastAgentConnectTime: "0001-01-01T00:00:00",
        },
        NOW,
      ),
    ).toBeNull();
    expect(readSotiDate("2026-11-19T10:15:00")).toEqual(
      new Date("2026-11-19T10:15:00Z"),
    );
    expect(readSotiDate("2026-11-19T05:15:00-05:00")).toEqual(
      new Date("2026-11-19T10:15:00Z"),
    );
  });

  test("each listed device's, for the devices that have one", () => {
    expect(
      getSotiCheckIns([
        read(buildSotiDevice()),
        read(
          buildSotiWindows({
            LastCheckInTime: "0001-01-01T00:00:00Z",
            LastAgentConnectTime: "0001-01-01T00:00:00Z",
            LastAgentDisconnectTime: "0001-01-01T00:00:00Z",
          }),
        ),
      ]),
    ).toEqual([{ providerDeviceId: "35-8C4F2A9B1D7E", lastCheckInAt: NOW }]);
  });
});

describe("groups", () => {
  test("a device group's path as Inventory writes one, and each group once by its path", () => {
    expect(readSotiGroupPath("\\\\Acme\\Stores\\West")).toBe("Acme/Stores/West");
    expect(readSotiGroupPath("\\\\Acme")).toBe("Acme");
    expect(readSotiGroupPath("")).toBe("");

    const groups: Array<ProviderGroup> = getSotiGroups([
      read(buildSotiDevice()).device,
      read(buildSotiDevice({ DeviceId: "35-2" })).device,
      read(buildSotiIpad()).device,
      read(buildSotiDevice({ DeviceId: "35-3", Path: "" })).device,
    ]);

    expect(groups).toEqual([
      {
        id: "Acme/Warehouses/Dallas",
        name: "Dallas",
        path: "Acme/Warehouses/Dallas",
      },
      { id: "Acme/Stores/West", name: "West", path: "Acme/Stores/West" },
    ]);
  });
});

describe("a device's apps", () => {
  test("its package ID is its key; an Apple app's ShortVersion is its version, its Version the build", () => {
    expect(parseSotiApp(buildSotiApp())).toEqual({
      packageName: "com.example.scanner",
      appName: "Scanner",
      versionName: "4.2.0",
      versionCode: "420",
      state: "Installed",
      isKioskApp: false,
      isManagedByService: false,
    });
    expect(
      parseSotiApp(
        buildSotiApp({
          ApplicationId: "com.apple.Pages",
          Name: "Pages",
          Version: "8812",
          ShortVersion: "14.2",
          Build: "",
          Status: "Managed",
        }),
      ),
    ).toMatchObject({
      versionName: "14.2",
      versionCode: "8812",
      isManagedByService: true,
    });
  });

  test("an app being installed, refused, failed or gone is not on the device", () => {
    for (const status of [
      "Uninstalled",
      "ManagedButUninstalled",
      "Failed",
      "Queued",
      "Installing",
      "NeedsRedemption",
      "Prompting",
      "UserRejected",
      "RetryingInstallation",
    ]) {
      expect(parseSotiApp(buildSotiApp({ Status: status }))).toBeNull();
    }

    for (const status of [
      "Installed",
      "Managed",
      "UserInstalledApp",
      "PendingUninstallation",
      "Updating",
      "Unknown",
    ]) {
      expect(parseSotiApp(buildSotiApp({ Status: status }))).not.toBeNull();
    }
  });

  test("an app without an ID is keyed by its name; one with neither is none; each key once", () => {
    const apps: Array<ProviderApp> = parseSotiApps([
      buildSotiApp(),
      buildSotiApp({ Version: "4.1.0" }),
      buildSotiApp({ ApplicationId: "", Name: "Notes", Version: "1.0" }),
      buildSotiApp({ ApplicationId: "", Name: "" }),
      null,
    ]);

    expect(
      apps.map((app: ProviderApp): string => {
        return `${app.packageName} ${app.versionName}`;
      }),
    ).toEqual(["com.example.scanner 4.2.0", "Notes 1.0"]);
  });
});

describe("the devices a read will import", () => {
  test("the Active and Disabled buckets of the devices counted by their Mode", () => {
    expect(
      parseSotiManagedDeviceCount([
        {
          AggregationName: "Modes",
          OtherCount: 0,
          Buckets: [
            { Value: "Active", Count: 412 },
            { Value: "Disabled", Count: 3 },
            { Value: "UnenrolledByAdmin", Count: 40 },
          ],
        },
      ]),
    ).toBe(415);

    for (const odd of [undefined, [], {}, [{ Buckets: "x" }], "summary"]) {
      expect(parseSotiManagedDeviceCount(odd)).toBeUndefined();
    }
  });
});

describe("what MobiControl said went wrong", () => {
  test("its Message and first detail, an OAuth error, else the start of the body", () => {
    expect(
      readSotiError({
        bodyJson: {
          $type: "ErrorDetails",
          ErrorCode: 0,
          Message: "Contract validation failed",
          Data: ["take must be at most 1000"],
        },
        bodyText: "",
      }),
    ).toBe("Contract validation failed take must be at most 1000");
    expect(
      readSotiError({
        bodyJson: { error: "invalid_grant", error_description: "The user name or password is incorrect." },
        bodyText: "",
      }),
    ).toBe("invalid_grant: The user name or password is incorrect.");
    expect(
      readSotiError({ bodyJson: undefined, bodyText: "Service Unavailable" }),
    ).toBe("Service Unavailable");
  });
});

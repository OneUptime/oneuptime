import { describe, expect, test } from "@jest/globals";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_READING_METRIC_NAMES,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_DESCRIPTION,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT,
  ManagedDeviceCheckInAttribute,
  ManagedDeviceCheckInDevice,
  ManagedDeviceCheckInReading,
  getManagedDeviceCheckInAttributes,
  getManagedDeviceCheckInReadings,
  getManagedDeviceSecurityPatchAttributes,
  getManagedDeviceSecurityPatchReading,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import { EsperDeviceState } from "../../../Types/DeviceManagement/ManagedDeviceStatus";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import AndroidSecurityPatch, {
  ANDROID_SECURITY_PATCH_MAX_AGE_DAYS,
  AndroidSecurityPatchStatus,
} from "../../../Types/Host/AndroidSecurityPatch";

/*
 * How old each Android managed device's security patch is, as the reading
 * each read of its connection writes beside its check-in (#10098): which
 * devices get one, what it says - whole UTC days, as the Android agent
 * counts android.os.security_patch.age - and that it reads a level the way
 * Inventory's Security Patch Level filter and column do, so the alert, the
 * filter and the column agree on every device.
 */

const AS_OF: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function device(
  overrides: Partial<ManagedDeviceCheckInDevice> = {},
): ManagedDeviceCheckInDevice {
  return {
    providerDeviceId: "aaaaaaaa-0000-4000-8000-000000000001",
    deviceName: "ESP-ID-AAAAW",
    serialNumber: "R9KT30ABC12",
    platform: ManagedDevicePlatform.Android,
    lastCheckInAt: new Date(AS_OF.getTime() - 5 * MINUTE),
    securityPatchLevel: "2026-06-05",
    ...overrides,
  };
}

function readingsOf(
  devices: Array<ManagedDeviceCheckInDevice>,
  hostNames: Array<string> = [],
  asOf: Date = AS_OF,
): Array<ManagedDeviceCheckInReading> {
  return getManagedDeviceCheckInReadings({
    devices,
    hostNames: new Set<string>(hostNames),
    asOf,
  });
}

describe("the metric", () => {
  test("is OneUptime's own, in days, beside the check-ins, and says what it is", () => {
    expect(MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME).toBe(
      "oneuptime.managed_device.security_patch.age",
    );
    // The agent's own unit for android.os.security_patch.age.
    expect(MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT).toBe("d");
    expect(MANAGED_DEVICE_SECURITY_PATCH_AGE_DESCRIPTION).toContain(
      "Days since an Android managed device's security patch level",
    );
    expect(MANAGED_DEVICE_SECURITY_PATCH_AGE_DESCRIPTION).toContain(
      `more than ${ANDROID_SECURITY_PATCH_MAX_AGE_DAYS} is out of date`,
    );
    expect(MANAGED_DEVICE_READING_METRIC_NAMES).toEqual([
      MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
      MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
      // #10008: its battery and its storage, beside them.
      "oneuptime.managed_device.battery.level",
      // #10288: and whether it is on its charger, beside its battery.
      "oneuptime.managed_device.battery.charging",
      "oneuptime.managed_device.storage.used",
    ]);
  });

  test("is not the agent's metric: a host's monitors read that one by the host's name, which the readings carry too", () => {
    expect(MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME).not.toBe(
      "android.os.security_patch.age",
    );
    expect(MANAGED_DEVICE_READING_METRIC_NAMES).not.toContain(
      "android.os.security_patch.age",
    );
  });
});

describe("getManagedDeviceSecurityPatchReading", () => {
  test("counts whole UTC days since the level's date, as the agent does", () => {
    expect(
      getManagedDeviceSecurityPatchReading({
        platform: ManagedDevicePlatform.Android,
        securityPatchLevel: "2026-11-01",
        asOf: AS_OF,
      }),
    ).toEqual({ level: "2026-11-01", ageInDays: 18 });

    // Late on the UTC day, and just after it: a day apart, never a fraction.
    expect(
      getManagedDeviceSecurityPatchReading({
        platform: ManagedDevicePlatform.Android,
        securityPatchLevel: "2026-11-01",
        asOf: new Date("2026-11-19T23:59:59.999Z"),
      })!.ageInDays,
    ).toBe(18);
    expect(
      getManagedDeviceSecurityPatchReading({
        platform: ManagedDevicePlatform.Android,
        securityPatchLevel: "2026-11-01",
        asOf: new Date("2026-11-20T00:00:00.000Z"),
      })!.ageInDays,
    ).toBe(19);
  });

  test("agrees with Inventory's rule on every day around the threshold", () => {
    for (let back: number = 85; back <= 95; back++) {
      const patched: Date = new Date(
        Date.UTC(2026, 10, 19) - back * 24 * 60 * MINUTE,
      );
      const level: string = patched.toISOString().substring(0, 10);
      const reading: { level: string; ageInDays: number } | undefined =
        getManagedDeviceSecurityPatchReading({
          platform: ManagedDevicePlatform.Android,
          securityPatchLevel: level,
          asOf: AS_OF,
        });

      expect(reading).toEqual({ level, ageInDays: back });
      // More than 90 days old is what Inventory calls Out of Date.
      expect({
        level,
        outOfDate: reading!.ageInDays > ANDROID_SECURITY_PATCH_MAX_AGE_DAYS,
      }).toEqual({
        level,
        outOfDate:
          AndroidSecurityPatch.getStatus(level, AS_OF) ===
          AndroidSecurityPatchStatus.OutOfDate,
      });
    }
  });

  test("a level after today is 0 days old, as the agent sends it", () => {
    expect(
      getManagedDeviceSecurityPatchReading({
        platform: ManagedDevicePlatform.Android,
        securityPatchLevel: "2026-12-05",
        asOf: AS_OF,
      }),
    ).toEqual({ level: "2026-12-05", ageInDays: 0 });
  });

  test("reads the level trimmed, as the service may write it", () => {
    expect(
      getManagedDeviceSecurityPatchReading({
        platform: ManagedDevicePlatform.Android,
        securityPatchLevel: "  2026-06-05 ",
        asOf: AS_OF,
      }),
    ).toEqual({ level: "2026-06-05", ageInDays: 167 });
  });

  test("a level that is no date of the calendar, or none, has no age", () => {
    for (const securityPatchLevel of [
      "",
      "   ",
      "unknown",
      "June 2026",
      "2026-06",
      "2026-13-01",
      "2023-02-30",
      "2026-06-05T00:00:00Z",
      null,
      undefined,
    ]) {
      expect({
        securityPatchLevel,
        reading: getManagedDeviceSecurityPatchReading({
          platform: ManagedDevicePlatform.Android,
          securityPatchLevel,
          asOf: AS_OF,
        }),
      }).toEqual({ securityPatchLevel, reading: undefined });
    }
  });

  test("only an Android device has one, whatever its service reports", () => {
    for (const platform of [
      ManagedDevicePlatform.IOS,
      ManagedDevicePlatform.IPadOS,
      ManagedDevicePlatform.TvOS,
      ManagedDevicePlatform.MacOS,
      ManagedDevicePlatform.Windows,
      ManagedDevicePlatform.Linux,
      ManagedDevicePlatform.Other,
    ]) {
      expect({
        platform,
        reading: getManagedDeviceSecurityPatchReading({
          platform,
          securityPatchLevel: "2024-06-05",
          asOf: AS_OF,
        }),
      }).toEqual({ platform, reading: undefined });
    }
  });
});

describe("getManagedDeviceCheckInReadings: the security patch beside each check-in", () => {
  test("an Android device's reading carries its patch's level and age", () => {
    const [reading] = readingsOf([
      device({ securityPatchLevel: "2024-06-05" }),
    ]);

    expect(reading!.securityPatch).toEqual({
      level: "2024-06-05",
      ageInDays: 897,
    });
    // The check-in is read as before.
    expect(reading!.ageInMinutes).toBe(5);
  });

  test("a row read before the platform was kept is Android, and has its patch", () => {
    const [reading] = readingsOf([device({ platform: undefined })]);

    expect(reading!.platform).toBe(ManagedDevicePlatform.Android);
    expect(reading!.securityPatch).toEqual({
      level: "2026-06-05",
      ageInDays: 167,
    });
  });

  test("an Android device whose level is not known still checks in, with no patch", () => {
    const readings: Array<ManagedDeviceCheckInReading> = readingsOf([
      device({ securityPatchLevel: undefined }),
      device({
        providerDeviceId: "aaaaaaaa-0000-4000-8000-000000000002",
        deviceName: "ESP-ID-AAAAX",
        serialNumber: "R9KT30ABC13",
        securityPatchLevel: "not reported",
      }),
    ]);

    expect(readings).toHaveLength(2);
    for (const reading of readings) {
      expect(reading.securityPatch).toBeUndefined();
      expect("securityPatch" in reading).toBe(false);
    }
  });

  test("an iPhone has none, whatever its service reports", () => {
    const [reading] = readingsOf([
      device({
        platform: ManagedDevicePlatform.IOS,
        securityPatchLevel: "2024-06-05",
      }),
    ]);

    expect(reading!.securityPatch).toBeUndefined();
  });

  test("a device with no check-in reading has no patch reading either: the same devices, the same reads", () => {
    expect(
      readingsOf([
        // Being set up, disabled, removed, or never checked in.
        device({ providerState: EsperDeviceState.BeginningProvisioning }),
        device({ providerState: EsperDeviceState.Disabled }),
        device({ removedAt: new Date(AS_OF.getTime() - MINUTE) }),
        device({ lastCheckInAt: null }),
      ]),
    ).toEqual([]);
  });

  test("an offline device's patch is read as its service last reported it", () => {
    const [reading] = readingsOf([
      device({
        lastCheckInAt: new Date(AS_OF.getTime() - 3 * 24 * 60 * MINUTE),
        securityPatchLevel: "2024-06-05",
      }),
    ]);

    expect(reading!.ageInMinutes).toBe(3 * 24 * 60);
    expect(reading!.securityPatch!.ageInDays).toBe(897);
  });

  test("a device the Android agent reports is marked a host, its patch read all the same", () => {
    const [reading] = readingsOf(
      [device({ securityPatchLevel: "2024-06-05" })],
      ["esp-id-aaaaw"],
    );

    expect(reading!.isHost).toBe(true);
    expect(reading!.securityPatch!.ageInDays).toBe(897);
  });
});

describe("getManagedDeviceSecurityPatchAttributes", () => {
  const [reading] = readingsOf([
    device({ alias: "Store 12 Kiosk 3", groupPath: "Stores/Store 12" }),
  ]);

  test("names the device as its check-in does, and the level it was read at", () => {
    const checkIn: Record<string, string> = getManagedDeviceCheckInAttributes({
      reading: reading!,
      connectionId: "c-1",
      provider: "esper",
    });

    expect(
      getManagedDeviceSecurityPatchAttributes({
        reading: reading!,
        connectionId: "c-1",
        provider: "esper",
      }),
    ).toEqual({
      ...checkIn,
      [ManagedDeviceCheckInAttribute.SecurityPatchLevel]: "2026-06-05",
    });
    expect(checkIn[ManagedDeviceCheckInAttribute.SecurityPatchLevel]).toBe(
      undefined,
    );
    expect(checkIn).toMatchObject({
      [ManagedDeviceCheckInAttribute.ConnectionId]: "c-1",
      [ManagedDeviceCheckInAttribute.Provider]: "esper",
      [ManagedDeviceCheckInAttribute.DeviceName]: "ESP-ID-AAAAW",
      [ManagedDeviceCheckInAttribute.IsHost]: "false",
      [ManagedDeviceCheckInAttribute.Platform]: "android",
      [ManagedDeviceCheckInAttribute.HostName]: "esp-id-aaaaw",
      [ManagedDeviceCheckInAttribute.Alias]: "Store 12 Kiosk 3",
      [ManagedDeviceCheckInAttribute.Group]: "Stores/Store 12",
    });
  });

  test("a reading with no patch has no patch attributes", () => {
    const [iphone] = readingsOf([
      device({ platform: ManagedDevicePlatform.IOS }),
    ]);

    expect(
      getManagedDeviceSecurityPatchAttributes({
        reading: iphone!,
        connectionId: "c-1",
        provider: "esper",
      }),
    ).toBeUndefined();
  });
});

import {
  MANAGED_DEVICE_BATTERY_CHARGING_DESCRIPTION,
  MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME,
  MANAGED_DEVICE_BATTERY_CHARGING_UNIT,
  MANAGED_DEVICE_BATTERY_LEVEL_DESCRIPTION,
  MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
  MANAGED_DEVICE_BATTERY_LEVEL_UNIT,
  MANAGED_DEVICE_IS_CHARGING_DETAIL,
  MANAGED_DEVICE_READING_METRIC_NAMES,
  MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL,
  MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL,
  MANAGED_DEVICE_STORAGE_USED_DESCRIPTION,
  MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
  MANAGED_DEVICE_STORAGE_USED_UNIT,
  ManagedDeviceCheckInAttribute,
  ManagedDeviceCheckInDevice,
  ManagedDeviceCheckInReading,
  getManagedDeviceBatteryReading,
  getManagedDeviceChargingDetails,
  getManagedDeviceChargingReading,
  getManagedDeviceCheckInAttributes,
  getManagedDeviceCheckInReadings,
  getManagedDeviceStorageAttributes,
  getManagedDeviceStorageDetails,
  getManagedDeviceStorageReading,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import { EsperDeviceState } from "../../../Types/DeviceManagement/ManagedDeviceStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * A managed device's battery and storage, as each read writes them beside
 * its check-in (#10008): in percent, from what its device manager last
 * heard, for the devices that report them - and nothing for one that
 * reports no battery or none of its free space, so it never alerts.
 */

const AS_OF: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const GB: number = 1e9;

function device(
  overrides: Partial<ManagedDeviceCheckInDevice> = {},
): ManagedDeviceCheckInDevice {
  return {
    providerDeviceId: "id-1",
    deviceName: "ESP-ID-AAAAW",
    serialNumber: "R9KT30ABC12",
    platform: ManagedDevicePlatform.Android,
    lastCheckInAt: new Date(AS_OF.getTime() - 4 * MINUTE),
    ...overrides,
  };
}

function readingOf(
  overrides: Partial<ManagedDeviceCheckInDevice> = {},
): ManagedDeviceCheckInReading | undefined {
  return getManagedDeviceCheckInReadings({
    devices: [device(overrides)],
    hostNames: new Set<string>(),
    asOf: AS_OF,
    provider: "esper",
  })[0];
}

describe("the metrics", () => {
  test("are OneUptime's own, in percent, beside the check-ins, and say what they are", () => {
    expect(MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME).toBe(
      "oneuptime.managed_device.battery.level",
    );
    expect(MANAGED_DEVICE_STORAGE_USED_METRIC_NAME).toBe(
      "oneuptime.managed_device.storage.used",
    );
    expect(MANAGED_DEVICE_BATTERY_LEVEL_UNIT).toBe("%");
    expect(MANAGED_DEVICE_STORAGE_USED_UNIT).toBe("%");
    expect(MANAGED_DEVICE_BATTERY_LEVEL_DESCRIPTION).toContain(
      "A managed device's battery, in percent",
    );
    expect(MANAGED_DEVICE_STORAGE_USED_DESCRIPTION).toContain(
      "How much of a managed device's own storage is in use, in percent",
    );
    expect(MANAGED_DEVICE_READING_METRIC_NAMES).toContain(
      MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
    );
    expect(MANAGED_DEVICE_READING_METRIC_NAMES).toContain(
      MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
    );
  });

  test("are never the Android agent's: a host's monitors read those by the host's name, which the readings carry too", () => {
    for (const agentMetric of [
      "hw.battery.charge",
      "android.battery.plugged",
      "system.filesystem.utilization",
    ]) {
      expect(MANAGED_DEVICE_READING_METRIC_NAMES).not.toContain(agentMetric);
    }
  });
});

describe("getManagedDeviceBatteryReading", () => {
  test("a battery in percent, whole", () => {
    expect(getManagedDeviceBatteryReading(87)).toBe(87);
    expect(getManagedDeviceBatteryReading(19.6)).toBe(20);
    expect(getManagedDeviceBatteryReading(100)).toBe(100);
    expect(getManagedDeviceBatteryReading(1)).toBe(1);
  });

  test("0 is no battery - a device at 0% cannot check in - and anything else is none", () => {
    for (const none of [0, -1, 101, NaN, Infinity, null, undefined]) {
      expect(getManagedDeviceBatteryReading(none)).toBeUndefined();
    }
  });
});

describe("getManagedDeviceStorageReading", () => {
  test("how much of the storage is in use, to one decimal, from its bytes", () => {
    expect(
      getManagedDeviceStorageReading({
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: 64 * GB,
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: 3_200_000_000,
      }),
    ).toEqual({
      usedPercent: 95,
      totalBytes: 64 * GB,
      freeBytes: 3_200_000_000,
    });
    expect(
      getManagedDeviceStorageReading({
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: 31675383808,
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: 18253611008,
      })!.usedPercent,
    ).toBe(42.4);
  });

  test("reads bytes written as text, as a JSON column may hand them back", () => {
    expect(
      getManagedDeviceStorageReading({
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: "128000000000",
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: "12800000000",
      })!.usedPercent,
    ).toBe(90);
  });

  test("none without both, with a whole of 0, with no byte free, or with more free than there is", () => {
    for (const details of [
      undefined,
      null,
      {},
      { [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: 64 * GB },
      { [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: 3 * GB },
      {
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: 0,
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: 3 * GB,
      },
      // Intune's free space before the device reported it: no figure, never full.
      {
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: 64 * GB,
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: 0,
      },
      {
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: 32 * GB,
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: 64 * GB,
      },
      {
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: "lots",
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: 3 * GB,
      },
      {
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: -64,
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: -3,
      },
    ]) {
      expect(getManagedDeviceStorageReading(details)).toBeUndefined();
    }
  });
});

describe("getManagedDeviceStorageDetails", () => {
  test("keeps each size a parser read, in whole bytes, under the keys a reading reads", () => {
    expect(
      getManagedDeviceStorageDetails({
        totalBytes: 34359738368.4,
        freeBytes: 19084083200,
      }),
    ).toEqual({
      storageTotalBytes: 34359738368,
      storageFreeBytes: 19084083200,
    });
  });

  test("leaves out a size the service said none, 0 or no number of", () => {
    expect(
      getManagedDeviceStorageDetails({ totalBytes: null, freeBytes: 0 }),
    ).toEqual({});
    expect(
      getManagedDeviceStorageDetails({
        totalBytes: NaN,
        freeBytes: undefined,
      }),
    ).toEqual({});
    expect(
      getManagedDeviceStorageDetails({ totalBytes: 64 * GB, freeBytes: 0 }),
    ).toEqual({ storageTotalBytes: 64 * GB });
  });
});

describe("a device's reading", () => {
  test("carries its battery and its storage, where it reports them", () => {
    const reading: ManagedDeviceCheckInReading = readingOf({
      batteryLevel: 14,
      details: {
        totalStorage: "32",
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: 32 * GB,
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: 1_600_000_000,
      },
    })!;

    expect(reading.batteryLevel).toBe(14);
    expect(reading.storage).toEqual({
      usedPercent: 95,
      totalBytes: 32 * GB,
      freeBytes: 1_600_000_000,
    });
  });

  test("a desktop with no battery, or a device saying none of its free space, has neither", () => {
    const reading: ManagedDeviceCheckInReading = readingOf({
      platform: ManagedDevicePlatform.Windows,
      batteryLevel: 0,
      details: { totalStorage: "512" },
    })!;

    expect(reading).toBeDefined();
    expect(reading.batteryLevel).toBeUndefined();
    expect(reading.storage).toBeUndefined();
  });

  test("an Apple device's and a Windows PC's are read as an Android device's are: every platform", () => {
    for (const platform of [
      ManagedDevicePlatform.IOS,
      ManagedDevicePlatform.IPadOS,
      ManagedDevicePlatform.MacOS,
      ManagedDevicePlatform.Windows,
      ManagedDevicePlatform.Linux,
    ]) {
      expect(readingOf({ platform, batteryLevel: 42 })!.batteryLevel).toBe(42);
    }
  });

  test("a device out of service has none: no reading at all, as for its check-ins", () => {
    expect(
      readingOf({
        batteryLevel: 5,
        providerState: EsperDeviceState.Disabled,
      }),
    ).toBeUndefined();
    expect(
      readingOf({
        batteryLevel: 5,
        removedAt: new Date(AS_OF.getTime() - MINUTE),
      }),
    ).toBeUndefined();
  });

  test("an offline device keeps the battery it last reported: a device that died of it is still told of", () => {
    const reading: ManagedDeviceCheckInReading = readingOf({
      batteryLevel: 3,
      lastCheckInAt: new Date(AS_OF.getTime() - 5 * 60 * MINUTE),
    })!;

    expect(reading.ageInMinutes).toBe(300);
    expect(reading.batteryLevel).toBe(3);
  });
});

describe("a storage reading's attributes", () => {
  test("the check-in's, and how many bytes were free of how many", () => {
    const reading: ManagedDeviceCheckInReading = readingOf({
      details: {
        [MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL]: 32 * GB,
        [MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL]: 1_600_000_000,
      },
    })!;
    const data: {
      reading: ManagedDeviceCheckInReading;
      connectionId: string;
      provider: string;
    } = {
      reading,
      connectionId: "55555555-5555-4555-8555-555555555555",
      provider: "esper",
    };

    expect(getManagedDeviceStorageAttributes(data)).toEqual({
      ...getManagedDeviceCheckInAttributes(data),
      [ManagedDeviceCheckInAttribute.StorageFreeBytes]: "1600000000",
      [ManagedDeviceCheckInAttribute.StorageTotalBytes]: "32000000000",
    });
    expect(
      getManagedDeviceStorageAttributes({
        ...data,
        reading: { ...reading, storage: undefined },
      }),
    ).toBeUndefined();
  });
});

/*
 * #10288: whether a device is on its charger, where its service says so:
 * its own metric, 1 or 0, beside the battery, read from what the import
 * keeps in the device's details - of a device with a battery alone.
 */
describe("whether a device is on its charger", () => {
  test("is a metric of OneUptime's own, beside the battery, never the agent's", () => {
    expect(MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME).toBe(
      "oneuptime.managed_device.battery.charging",
    );
    expect(MANAGED_DEVICE_BATTERY_CHARGING_UNIT).toBe("");
    expect(MANAGED_DEVICE_BATTERY_CHARGING_DESCRIPTION).toContain(
      "1 on power, 0 on its battery",
    );
    expect(MANAGED_DEVICE_READING_METRIC_NAMES).toContain(
      MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME,
    );
    // The Android agent's own, which its host's Device Unplugged reads.
    expect(MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME).not.toBe(
      "android.battery.plugged",
    );
  });

  test("a parser keeps true or false under one key, and nothing for anything else", () => {
    expect(getManagedDeviceChargingDetails(true)).toEqual({
      [MANAGED_DEVICE_IS_CHARGING_DETAIL]: true,
    });
    expect(getManagedDeviceChargingDetails(false)).toEqual({
      [MANAGED_DEVICE_IS_CHARGING_DETAIL]: false,
    });
    expect(getManagedDeviceChargingDetails(null)).toEqual({});
    expect(getManagedDeviceChargingDetails(undefined)).toEqual({});
  });

  test("a reading reads it back: true or false, and nothing for anything else", () => {
    expect(getManagedDeviceChargingReading({ isCharging: true })).toBe(true);
    expect(getManagedDeviceChargingReading({ isCharging: false })).toBe(false);

    for (const details of [
      { isCharging: "true" },
      { isCharging: 1 },
      {},
      null,
      undefined,
    ]) {
      expect(getManagedDeviceChargingReading(details)).toBeUndefined();
    }
  });

  test("a device with a battery carries it on its reading; one with none, or that says neither, does not", () => {
    expect(
      readingOf({ batteryLevel: 12, details: { isCharging: true } })!
        .isCharging,
    ).toBe(true);
    expect(
      readingOf({ batteryLevel: 12, details: { isCharging: false } })!
        .isCharging,
    ).toBe(false);
    expect(readingOf({ batteryLevel: 12 })!.isCharging).toBeUndefined();
    // A desktop on AC with no battery: nothing to leave be.
    expect(
      readingOf({ batteryLevel: 0, details: { isCharging: true } })!.isCharging,
    ).toBeUndefined();
  });
});

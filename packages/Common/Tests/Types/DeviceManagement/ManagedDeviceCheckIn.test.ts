import { describe, expect, test } from "@jest/globals";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_DESCRIPTION,
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
  ManagedDeviceCheckInAttribute,
  ManagedDeviceCheckInDevice,
  ManagedDeviceCheckInReading,
  getManagedDeviceCheckInAgeInMinutes,
  getManagedDeviceCheckInAttributes,
  getManagedDeviceCheckInReadings,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import {
  EsperDeviceState,
  MANAGED_DEVICE_ONLINE_WINDOW_MINUTES,
} from "../../../Types/DeviceManagement/ManagedDeviceStatus";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";

/*
 * How long since each managed device checked in, as the reading each read
 * of its connection writes (#9835): which devices get one, what it says,
 * and how a device the Android agent reports is told apart.
 */

const AS_OF: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(AS_OF.getTime() - minutes * MINUTE);
}

function device(
  overrides: Partial<ManagedDeviceCheckInDevice> = {},
): ManagedDeviceCheckInDevice {
  return {
    providerDeviceId: "aaaaaaaa-0000-4000-8000-000000000001",
    deviceName: "ESP-ID-AAAAW",
    serialNumber: "R9KT30ABC12",
    lastCheckInAt: minutesAgo(5),
    ...overrides,
  };
}

function readingsOf(
  devices: Array<ManagedDeviceCheckInDevice>,
  hostNames: Array<string> = [],
): Array<ManagedDeviceCheckInReading> {
  return getManagedDeviceCheckInReadings({
    devices,
    hostNames: new Set<string>(hostNames),
    asOf: AS_OF,
  });
}

describe("the metric", () => {
  test("is OneUptime's own, in minutes, and says what it is", () => {
    expect(MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME).toBe(
      "oneuptime.managed_device.check_in.age",
    );
    expect(MANAGED_DEVICE_CHECK_IN_AGE_UNIT).toBe("min");
    expect(MANAGED_DEVICE_CHECK_IN_AGE_DESCRIPTION).toContain(
      "Minutes since a managed device last checked in",
    );
  });

  test("names its attributes as OneUptime's own, and the host as telemetry does", () => {
    expect(Object.values(ManagedDeviceCheckInAttribute).sort()).toEqual(
      [
        "oneuptime.managed_device.alias",
        "oneuptime.managed_device.connection.id",
        "oneuptime.managed_device.group",
        "oneuptime.managed_device.is_host",
        "oneuptime.managed_device.name",
        "oneuptime.managed_device.provider",
        "resource.host.name",
      ].sort(),
    );
  });
});

describe("getManagedDeviceCheckInAgeInMinutes", () => {
  test("counts whole minutes, so 59 minutes and 59 seconds is 59", () => {
    expect(getManagedDeviceCheckInAgeInMinutes(minutesAgo(0), AS_OF)).toBe(0);
    expect(
      getManagedDeviceCheckInAgeInMinutes(
        new Date(AS_OF.getTime() - 59 * MINUTE - 59 * 1000),
        AS_OF,
      ),
    ).toBe(59);
    expect(getManagedDeviceCheckInAgeInMinutes(minutesAgo(60), AS_OF)).toBe(60);
    expect(getManagedDeviceCheckInAgeInMinutes(minutesAgo(61), AS_OF)).toBe(61);
    expect(
      getManagedDeviceCheckInAgeInMinutes(minutesAgo(3 * 24 * 60), AS_OF),
    ).toBe(3 * 24 * 60);
  });

  test("reads a check-in written as text, as the API hands it back", () => {
    expect(
      getManagedDeviceCheckInAgeInMinutes(minutesAgo(42).toISOString(), AS_OF),
    ).toBe(42);
  });

  test("is never negative: a check-in stamped after the read's end is 0", () => {
    expect(
      getManagedDeviceCheckInAgeInMinutes(
        new Date(AS_OF.getTime() + 3 * MINUTE),
        AS_OF,
      ),
    ).toBe(0);
  });

  test("has nothing to measure from without a check-in", () => {
    expect(getManagedDeviceCheckInAgeInMinutes(null, AS_OF)).toBeUndefined();
    expect(
      getManagedDeviceCheckInAgeInMinutes(undefined, AS_OF),
    ).toBeUndefined();
    expect(getManagedDeviceCheckInAgeInMinutes("", AS_OF)).toBeUndefined();
    expect(
      getManagedDeviceCheckInAgeInMinutes("not a date", AS_OF),
    ).toBeUndefined();
  });
});

describe("getManagedDeviceCheckInReadings: which devices", () => {
  test("an online device and an offline one each get a reading, with how long since", () => {
    const readings: Array<ManagedDeviceCheckInReading> = readingsOf([
      device({ lastCheckInAt: minutesAgo(5) }),
      device({
        providerDeviceId: "aaaaaaaa-0000-4000-8000-000000000002",
        deviceName: "ESP-ID-AAAAX",
        serialNumber: "R9KT30ABC13",
        lastCheckInAt: minutesAgo(MANAGED_DEVICE_ONLINE_WINDOW_MINUTES + 45),
      }),
    ]);

    expect(
      readings.map((reading: ManagedDeviceCheckInReading) => {
        return [reading.deviceName, reading.ageInMinutes];
      }),
    ).toEqual([
      ["ESP-ID-AAAAW", 5],
      ["ESP-ID-AAAAX", 75],
    ]);
  });

  test("a device being set up, whose onboarding failed, disabled or being wiped gets none", () => {
    for (const state of [
      EsperDeviceState.BeginningProvisioning,
      EsperDeviceState.OnboardingInProgress,
      EsperDeviceState.OnboardingFailed,
      EsperDeviceState.Disabled,
      EsperDeviceState.FactoryResetInProgress,
    ]) {
      expect({
        state,
        readings: readingsOf([
          device({ providerState: state, lastCheckInAt: minutesAgo(500) }),
        ]),
      }).toEqual({ state, readings: [] });
    }
  });

  test("a device that left the service gets none, however long it has been quiet", () => {
    expect(
      readingsOf([
        device({
          removedAt: minutesAgo(10),
          lastCheckInAt: minutesAgo(600),
        }),
      ]),
    ).toEqual([]);
  });

  test("a device Esper calls online or offline is judged by its check-in, not its state", () => {
    const readings: Array<ManagedDeviceCheckInReading> = readingsOf([
      device({
        providerState: EsperDeviceState.Online,
        lastCheckInAt: minutesAgo(90),
      }),
      device({
        providerDeviceId: "aaaaaaaa-0000-4000-8000-000000000002",
        deviceName: "ESP-ID-AAAAX",
        providerState: EsperDeviceState.Offline,
        lastCheckInAt: minutesAgo(2),
      }),
    ]);

    expect(
      readings.map((reading: ManagedDeviceCheckInReading) => {
        return reading.ageInMinutes;
      }),
    ).toEqual([90, 2]);
  });

  test("a device with no known check-in has no age to say", () => {
    expect(
      readingsOf([
        device({
          lastCheckInAt: null,
          providerState: EsperDeviceState.Offline,
        }),
        device({ lastCheckInAt: undefined }),
      ]),
    ).toEqual([]);
  });

  test("a device is named by its Esper name, else its serial number, else its ID", () => {
    const readings: Array<ManagedDeviceCheckInReading> = readingsOf([
      device({ deviceName: "  ESP-ID-AAAAW  " }),
      device({
        providerDeviceId: "aaaaaaaa-0000-4000-8000-000000000002",
        deviceName: "",
        serialNumber: "R9KT30ABC13",
      }),
      device({
        providerDeviceId: "aaaaaaaa-0000-4000-8000-000000000003",
        deviceName: undefined,
        serialNumber: "unknown",
      }),
    ]);

    expect(
      readings.map((reading: ManagedDeviceCheckInReading) => {
        return [reading.deviceName, reading.hostName];
      }),
    ).toEqual([
      ["ESP-ID-AAAAW", "esp-id-aaaaw"],
      ["R9KT30ABC13", "r9kt30abc13"],
      [
        "aaaaaaaa-0000-4000-8000-000000000003",
        "aaaaaaaa-0000-4000-8000-000000000003",
      ],
    ]);
  });

  test("two devices that share a name are one reading, the first's", () => {
    const readings: Array<ManagedDeviceCheckInReading> = readingsOf([
      device({ lastCheckInAt: minutesAgo(3) }),
      device({
        providerDeviceId: "aaaaaaaa-0000-4000-8000-000000000002",
        deviceName: "esp-id-aaaaw",
        lastCheckInAt: minutesAgo(300),
      }),
    ]);

    expect(readings).toHaveLength(1);
    expect(readings[0]!.ageInMinutes).toBe(3);
  });

  test("keeps the alias and the group, a path before a name, trimmed", () => {
    const [reading]: Array<ManagedDeviceCheckInReading> = readingsOf([
      device({
        alias: "  Store 12 Kiosk 3 ",
        groupName: "Kiosks",
        groupPath: "All devices / West / Kiosks",
      }),
    ]);

    expect(reading).toEqual({
      deviceName: "ESP-ID-AAAAW",
      hostName: "esp-id-aaaaw",
      alias: "Store 12 Kiosk 3",
      group: "All devices / West / Kiosks",
      ageInMinutes: 5,
      isHost: false,
    });

    expect(
      readingsOf([device({ groupName: "Kiosks", groupPath: undefined })])[0]!
        .group,
    ).toBe("Kiosks");
  });
});

describe("getManagedDeviceCheckInReadings: the Android agent", () => {
  test("a device that is a host in Hosts is marked so, by its host name whatever its case", () => {
    const readings: Array<ManagedDeviceCheckInReading> = readingsOf(
      [
        device(),
        device({
          providerDeviceId: "aaaaaaaa-0000-4000-8000-000000000002",
          deviceName: "ESP-ID-AAAAX",
        }),
      ],
      ["esp-id-aaaax"],
    );

    expect(
      readings.map((reading: ManagedDeviceCheckInReading) => {
        return [reading.deviceName, reading.isHost];
      }),
    ).toEqual([
      ["ESP-ID-AAAAW", false],
      ["ESP-ID-AAAAX", true],
    ]);
  });

  test("a host is still read, and still says how long since it checked in", () => {
    const [reading]: Array<ManagedDeviceCheckInReading> = readingsOf(
      [device({ lastCheckInAt: minutesAgo(240) })],
      ["esp-id-aaaaw"],
    );

    expect(reading!.isHost).toBe(true);
    expect(reading!.ageInMinutes).toBe(240);
  });
});

describe("getManagedDeviceCheckInAttributes", () => {
  const reading: ManagedDeviceCheckInReading = {
    deviceName: "ESP-ID-AAAAW",
    hostName: "esp-id-aaaaw",
    alias: "Store 12 Kiosk 3",
    group: "West / Kiosks",
    ageInMinutes: 75,
    isHost: false,
  };

  test("names the connection, the service, the device and its host", () => {
    expect(
      getManagedDeviceCheckInAttributes({
        reading,
        connectionId: "22222222-2222-4222-8222-222222222222",
        provider: DeviceManagementProvider.Esper,
      }),
    ).toEqual({
      "oneuptime.managed_device.connection.id":
        "22222222-2222-4222-8222-222222222222",
      "oneuptime.managed_device.provider": "esper",
      "oneuptime.managed_device.name": "ESP-ID-AAAAW",
      "oneuptime.managed_device.alias": "Store 12 Kiosk 3",
      "oneuptime.managed_device.group": "West / Kiosks",
      "oneuptime.managed_device.is_host": "false",
      "resource.host.name": "esp-id-aaaaw",
    });
  });

  test("a host says true, as text a query filters on", () => {
    expect(
      getManagedDeviceCheckInAttributes({
        reading: { ...reading, isHost: true },
        connectionId: "c",
        provider: "esper",
      })[ManagedDeviceCheckInAttribute.IsHost],
    ).toBe("true");
  });

  test("leaves out an alias or a group the device has none of", () => {
    const attributes: Record<string, string> =
      getManagedDeviceCheckInAttributes({
        reading: { ...reading, alias: "", group: "" },
        connectionId: "c",
        provider: "esper",
      });

    expect(Object.keys(attributes)).not.toContain(
      ManagedDeviceCheckInAttribute.Alias,
    );
    expect(Object.keys(attributes)).not.toContain(
      ManagedDeviceCheckInAttribute.Group,
    );
  });
});

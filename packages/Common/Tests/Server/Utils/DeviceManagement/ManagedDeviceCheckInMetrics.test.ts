import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";
import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import Host from "../../../../Models/DatabaseModels/Host";
import ManagedDevice from "../../../../Models/DatabaseModels/ManagedDevice";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import HostService from "../../../../Server/Services/HostService";
import ManagedDeviceService from "../../../../Server/Services/ManagedDeviceService";
import MetricService from "../../../../Server/Services/MetricService";
import ManagedDeviceCheckInMetrics, {
  ManagedDeviceCheckInOutcome,
  buildManagedDeviceBatteryRow,
  buildManagedDeviceChargingRow,
  buildManagedDeviceCheckInRow,
  buildManagedDeviceSecurityPatchRow,
  buildManagedDeviceStorageRow,
} from "../../../../Server/Utils/DeviceManagement/ManagedDeviceCheckInMetrics";
import logger from "../../../../Server/Utils/Logger";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import {
  MANAGED_DEVICE_BATTERY_CHARGING_DESCRIPTION,
  MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME,
  MANAGED_DEVICE_BATTERY_LEVEL_DESCRIPTION,
  MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_DESCRIPTION,
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_DESCRIPTION,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT,
  MANAGED_DEVICE_STORAGE_USED_DESCRIPTION,
  MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
  ManagedDeviceCheckInReading,
} from "../../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import { EsperDeviceState } from "../../../../Types/DeviceManagement/ManagedDeviceStatus";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { keyForHost } from "../../../../Utils/Telemetry/EntityKey";
import { TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES } from "../../../../Server/Services/TelemetryUsageBillingService";

/*
 * What a read of a device management connection writes for its devices
 * (#9835): one reading each, how long since it checked in, as a metric row
 * keyed to the connection and to the device's host - and which devices the
 * Android agent reports, so the recommended monitor can leave them to Host
 * Stopped Reporting. Postgres and ClickHouse are stood in for; what is
 * asserted is what they are asked and handed.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AS_OF: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(AS_OF.getTime() - minutes * MINUTE);
}

function deviceRow(values: {
  id: string;
  name: string;
  minutesQuiet?: number | undefined;
  alias?: string | undefined;
  state?: number | undefined;
  platform?: ManagedDevicePlatform | undefined;
  securityPatchLevel?: string | undefined;
  batteryLevel?: number | undefined;
  details?: JSONObject | undefined;
}): ManagedDevice {
  const row: ManagedDevice = new ManagedDevice();
  row._id = values.id;
  row.providerDeviceId = values.id;
  row.deviceName = values.name;

  if (values.platform) {
    row.platform = values.platform;
  }

  if (values.batteryLevel !== undefined) {
    row.batteryLevel = values.batteryLevel;
  }

  if (values.details) {
    row.details = values.details;
  }

  if (values.securityPatchLevel !== undefined) {
    row.securityPatchLevel = values.securityPatchLevel;
  }

  if (values.alias) {
    row.alias = values.alias;
  }

  if (values.minutesQuiet !== undefined) {
    row.lastCheckInAt = minutesAgo(values.minutesQuiet);
  }

  if (values.state !== undefined) {
    row.providerState = values.state;
  }

  return row;
}

function hostRow(identifier: string, isArchived?: boolean): Host {
  const host: Host = new Host();
  host.hostIdentifier = identifier;

  if (isArchived !== undefined) {
    host.isArchived = isArchived;
  }

  return host;
}

let devicePages: Array<Array<ManagedDevice>>;
let hosts: Array<Host>;
let deviceFindBy: jest.SpyInstance;
let hostFindBy: jest.SpyInstance;
let insert: jest.SpyInstance;
let register: jest.SpyInstance;
let retentionDays: number | undefined;

beforeEach(() => {
  devicePages = [];
  hosts = [];
  retentionDays = undefined;

  deviceFindBy = jest
    .spyOn(ManagedDeviceService, "findBy")
    .mockImplementation((): Promise<Array<ManagedDevice>> => {
      return Promise.resolve(devicePages.shift() || []);
    });
  hostFindBy = jest
    .spyOn(HostService, "findBy")
    .mockImplementation((): Promise<Array<Host>> => {
      return Promise.resolve(hosts);
    });
  insert = jest
    .spyOn(MetricService, "insertJsonRows")
    .mockResolvedValue(undefined as never);
  register = jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined);
  jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockImplementation((): Promise<GlobalConfig | null> => {
      if (retentionDays === undefined) {
        return Promise.resolve(null);
      }

      const config: GlobalConfig = new GlobalConfig();
      config.monitorMetricRetentionInDays = retentionDays;
      return Promise.resolve(config);
    });
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function record(): Promise<ManagedDeviceCheckInOutcome> {
  return await ManagedDeviceCheckInMetrics.record({
    projectId: PROJECT,
    connectionId: CONNECTION,
    provider: "esper",
    asOf: AS_OF,
  });
}

function writtenRows(): Array<JSONObject> {
  return insert.mock.calls.flatMap(
    (call: Array<unknown>): Array<JSONObject> => {
      return call[0] as Array<JSONObject>;
    },
  );
}

function rowOf(name: string): JSONObject {
  const row: JSONObject | undefined = writtenRows().find(
    (candidate: JSONObject): boolean => {
      return (
        (candidate["attributes"] as Dictionary<string>)[
          "oneuptime.managed_device.name"
        ] === name
      );
    },
  );

  expect(row).toBeDefined();
  return row!;
}

describe("ManagedDeviceCheckInMetrics.record", () => {
  test("writes one reading per device in service: how many minutes since it checked in, at the read's end", async () => {
    devicePages = [
      [
        deviceRow({ id: "d1", name: "ESP-ID-AAAAW", minutesQuiet: 4 }),
        deviceRow({ id: "d2", name: "ESP-ID-AAAAX", minutesQuiet: 75 }),
      ],
    ];

    const outcome: ManagedDeviceCheckInOutcome = await record();

    expect(outcome).toEqual({
      readingCount: 2,
      hostCount: 0,
      securityPatchReadingCount: 0,
      batteryReadingCount: 0,
      chargingReadingCount: 0,
      storageReadingCount: 0,
    });
    expect(rowOf("ESP-ID-AAAAW")["value"]).toBe(4);
    expect(rowOf("ESP-ID-AAAAX")["value"]).toBe(75);
    expect(rowOf("ESP-ID-AAAAX")["time"]).toBe(
      OneUptimeDate.toClickhouseDateTime(AS_OF),
    );
  });

  test("reads only the connection's devices the service still lists, in pages", async () => {
    const fullPage: Array<ManagedDevice> = Array.from(
      { length: 1000 },
      (_value: unknown, index: number): ManagedDevice => {
        return deviceRow({
          id: `p1-${index}`,
          name: `ESP-ID-P1${index}`,
          minutesQuiet: 1,
        });
      },
    );
    devicePages = [
      fullPage,
      [deviceRow({ id: "last", name: "ESP-ID-LAST", minutesQuiet: 2 })],
    ];

    const outcome: ManagedDeviceCheckInOutcome = await record();

    expect(deviceFindBy).toHaveBeenCalledTimes(2);
    expect(outcome.readingCount).toBe(1001);

    const firstQuery: JSONObject = (
      deviceFindBy.mock.calls[0]![0] as { query: JSONObject }
    ).query;
    expect(firstQuery["projectId"]).toEqual(PROJECT);
    expect(firstQuery["connectionId"]).toEqual(CONNECTION);
    // removedAt IS NULL: a device that left the service is not read.
    const removedAt: FindOperator<unknown> = firstQuery[
      "removedAt"
    ] as unknown as FindOperator<unknown>;
    expect(removedAt).toBeInstanceOf(FindOperator);
    expect(removedAt.getSql!("removedAt")).toBe("(removedAt IS NULL)");
    expect((deviceFindBy.mock.calls[1]![0] as { skip: number }).skip).toBe(
      1000,
    );
  });

  test("writes nothing, and asks Hosts nothing, when no device has a reading", async () => {
    devicePages = [
      [
        deviceRow({ id: "d1", name: "ESP-ID-AAAAW" }),
        deviceRow({
          id: "d2",
          name: "ESP-ID-AAAAX",
          minutesQuiet: 600,
          state: EsperDeviceState.Disabled,
        }),
      ],
    ];

    expect(await record()).toEqual({
      readingCount: 0,
      hostCount: 0,
      securityPatchReadingCount: 0,
      batteryReadingCount: 0,
      chargingReadingCount: 0,
      storageReadingCount: 0,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(hostFindBy).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  test("a device the Android agent reports, a host in Hosts, is marked so; an archived host is not one", async () => {
    devicePages = [
      [
        deviceRow({ id: "d1", name: "ESP-ID-AAAAW", minutesQuiet: 4 }),
        deviceRow({ id: "d2", name: "ESP-ID-AAAAX", minutesQuiet: 4 }),
        deviceRow({ id: "d3", name: "ESP-ID-AAAAY", minutesQuiet: 4 }),
      ],
    ];
    hosts = [hostRow("esp-id-aaaax"), hostRow("esp-id-aaaay", true)];

    const outcome: ManagedDeviceCheckInOutcome = await record();

    expect(outcome).toEqual({
      readingCount: 3,
      hostCount: 1,
      securityPatchReadingCount: 0,
      batteryReadingCount: 0,
      chargingReadingCount: 0,
      storageReadingCount: 0,
    });

    const isHost: (name: string) => string = (name: string): string => {
      return (rowOf(name)["attributes"] as Dictionary<string>)[
        "oneuptime.managed_device.is_host"
      ]!;
    };

    expect(isHost("ESP-ID-AAAAW")).toBe("false");
    expect(isHost("ESP-ID-AAAAX")).toBe("true");
    expect(isHost("ESP-ID-AAAAY")).toBe("false");

    // Hosts are asked about by their identifiers, as telemetry keys them.
    const hostQuery: JSONObject = (
      hostFindBy.mock.calls[0]![0] as { query: JSONObject }
    ).query;
    expect(hostQuery["projectId"]).toEqual(PROJECT);
    expect(JSON.stringify(hostQuery["hostIdentifier"])).toContain(
      "esp-id-aaaaw",
    );
  });

  test("puts the metric in the project's catalog with its unit and description", async () => {
    devicePages = [
      [deviceRow({ id: "d1", name: "ESP-ID-AAAAW", minutesQuiet: 4 })],
    ];

    await record();

    expect(register).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      metricNameServiceNameMap: Dictionary<MetricType>;
    } = register.mock.calls[0]![0] as {
      projectId: ObjectID;
      metricNameServiceNameMap: Dictionary<MetricType>;
    };
    const metricType: MetricType =
      call.metricNameServiceNameMap[MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME]!;

    expect(call.projectId).toEqual(PROJECT);
    expect(metricType.name).toBe(MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME);
    expect(metricType.unit).toBe(MANAGED_DEVICE_CHECK_IN_AGE_UNIT);
    expect(metricType.description).toBe(
      MANAGED_DEVICE_CHECK_IN_AGE_DESCRIPTION,
    );
  });

  test("a catalog that cannot be written is logged: the readings are written all the same", async () => {
    devicePages = [
      [deviceRow({ id: "d1", name: "ESP-ID-AAAAW", minutesQuiet: 4 })],
    ];
    register.mockRejectedValue(new Error("Postgres went away"));

    expect(await record()).toEqual({
      readingCount: 1,
      hostCount: 0,
      securityPatchReadingCount: 0,
      batteryReadingCount: 0,
      chargingReadingCount: 0,
      storageReadingCount: 0,
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a write that fails is the read's to report: it throws", async () => {
    devicePages = [
      [deviceRow({ id: "d1", name: "ESP-ID-AAAAW", minutesQuiet: 4 })],
    ];
    insert.mockRejectedValue(new Error("ClickHouse is down"));

    await expect(record()).rejects.toThrow("ClickHouse is down");
  });

  test("keeps the readings as long as monitor metrics are kept, 30 days unless set", async () => {
    devicePages = [
      [deviceRow({ id: "d1", name: "ESP-ID-AAAAW", minutesQuiet: 4 })],
    ];

    await record();

    expect(rowOf("ESP-ID-AAAAW")["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDurationInDays(AS_OF, 30),
      ),
    );

    insert.mockClear();
    retentionDays = 7;
    devicePages = [
      [deviceRow({ id: "d1", name: "ESP-ID-AAAAW", minutesQuiet: 4 })],
    ];

    await record();

    expect(rowOf("ESP-ID-AAAAW")["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDurationInDays(AS_OF, 7),
      ),
    );
  });
});

/*
 * Beside each Android device's check-in, how old its security patch is
 * (#10098): what a device manager's Security Patch Out of Date reads.
 */
describe("ManagedDeviceCheckInMetrics.record: security patches", () => {
  function rowsOf(metricName: string): Array<JSONObject> {
    return writtenRows().filter((candidate: JSONObject): boolean => {
      return candidate["name"] === metricName;
    });
  }

  function patchRowOf(name: string): JSONObject | undefined {
    return rowsOf(MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME).find(
      (candidate: JSONObject): boolean => {
        return (
          (candidate["attributes"] as Dictionary<string>)[
            "oneuptime.managed_device.name"
          ] === name
        );
      },
    );
  }

  test("asks for each device's patch level with the rest of what a reading reads", async () => {
    await record();

    const select: JSONObject = (
      deviceFindBy.mock.calls[0]![0] as { select: JSONObject }
    ).select;
    expect(select["securityPatchLevel"]).toBe(true);
    expect(select["platform"]).toBe(true);
  });

  test("an Android device with a level gets a patch reading beside its check-in: its age in days, its level on it", async () => {
    devicePages = [
      [
        deviceRow({
          id: "d1",
          name: "ESP-ID-AAAAW",
          minutesQuiet: 4,
          securityPatchLevel: "2024-06-05",
        }),
        deviceRow({
          id: "d2",
          name: "ESP-ID-AAAAX",
          minutesQuiet: 9,
          securityPatchLevel: "2026-11-01",
        }),
      ],
    ];

    const outcome: ManagedDeviceCheckInOutcome = await record();

    expect(outcome).toEqual({
      readingCount: 2,
      hostCount: 0,
      securityPatchReadingCount: 2,
      batteryReadingCount: 0,
      chargingReadingCount: 0,
      storageReadingCount: 0,
    });
    // One write, the check-ins and the patches together.
    expect(insert).toHaveBeenCalledTimes(1);
    expect(rowsOf(MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME)).toHaveLength(2);
    expect(rowsOf(MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME)).toHaveLength(
      2,
    );

    const behind: JSONObject = patchRowOf("ESP-ID-AAAAW")!;
    expect(behind["value"]).toBe(897);
    expect(
      (behind["attributes"] as Dictionary<string>)[
        "oneuptime.managed_device.security_patch.level"
      ],
    ).toBe("2024-06-05");
    expect(patchRowOf("ESP-ID-AAAAX")!["value"]).toBe(18);
    expect(behind["time"]).toBe(OneUptimeDate.toClickhouseDateTime(AS_OF));
  });

  test("an iPhone, or an Android device with no level or one that is no date, gets its check-in alone", async () => {
    devicePages = [
      [
        deviceRow({
          id: "d1",
          name: "iPhone-1",
          minutesQuiet: 4,
          platform: ManagedDevicePlatform.IOS,
          securityPatchLevel: "2024-06-05",
        }),
        deviceRow({ id: "d2", name: "ESP-ID-AAAAX", minutesQuiet: 4 }),
        deviceRow({
          id: "d3",
          name: "ESP-ID-AAAAY",
          minutesQuiet: 4,
          securityPatchLevel: "2023-02-30",
        }),
      ],
    ];

    expect(await record()).toEqual({
      readingCount: 3,
      hostCount: 0,
      securityPatchReadingCount: 0,
      batteryReadingCount: 0,
      chargingReadingCount: 0,
      storageReadingCount: 0,
    });
    expect(rowsOf(MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME)).toEqual([]);
  });

  test("a device the Android agent reports is marked a host on its patch reading too, which the template leaves out", async () => {
    devicePages = [
      [
        deviceRow({
          id: "d1",
          name: "ESP-ID-AAAAW",
          minutesQuiet: 4,
          securityPatchLevel: "2024-06-05",
        }),
      ],
    ];
    hosts = [hostRow("esp-id-aaaaw")];

    const outcome: ManagedDeviceCheckInOutcome = await record();

    expect(outcome.hostCount).toBe(1);
    expect(outcome.securityPatchReadingCount).toBe(1);
    expect(
      (patchRowOf("ESP-ID-AAAAW")!["attributes"] as Dictionary<string>)[
        "oneuptime.managed_device.is_host"
      ],
    ).toBe("true");
  });

  test("puts the patch metric in the catalog beside the check-ins, once a read wrote one", async () => {
    devicePages = [
      [
        deviceRow({
          id: "d1",
          name: "ESP-ID-AAAAW",
          minutesQuiet: 4,
          securityPatchLevel: "2024-06-05",
        }),
      ],
    ];

    await record();

    const map: Dictionary<MetricType> = (
      register.mock.calls[0]![0] as {
        metricNameServiceNameMap: Dictionary<MetricType>;
      }
    ).metricNameServiceNameMap;

    expect(Object.keys(map).sort()).toEqual(
      [
        MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
        MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
      ].sort(),
    );
    expect(map[MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME]!.unit).toBe(
      MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT,
    );
    expect(
      map[MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME]!.description,
    ).toBe(MANAGED_DEVICE_SECURITY_PATCH_AGE_DESCRIPTION);
  });

  test("a read with no patch to say catalogs the check-ins alone", async () => {
    devicePages = [
      [deviceRow({ id: "d1", name: "ESP-ID-AAAAW", minutesQuiet: 4 })],
    ];

    await record();

    expect(
      Object.keys(
        (
          register.mock.calls[0]![0] as {
            metricNameServiceNameMap: Dictionary<MetricType>;
          }
        ).metricNameServiceNameMap,
      ),
    ).toEqual([MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME]);
  });
});

/*
 * #10008: beside each device's check-in, its battery and how full its
 * storage is, where its service reports them: what a device manager's Low
 * Battery and Storage Nearly Full read.
 */
describe("ManagedDeviceCheckInMetrics.record: battery and storage", () => {
  function rowsOf(metricName: string): Array<JSONObject> {
    return writtenRows().filter((candidate: JSONObject): boolean => {
      return candidate["name"] === metricName;
    });
  }

  const STORAGE: JSONObject = {
    totalStorage: "32",
    storageTotalBytes: 32000000000,
    storageFreeBytes: 1600000000,
  };

  test("asks for each device's battery and details with the rest of what a reading reads", async () => {
    await record();

    const select: JSONObject = (
      deviceFindBy.mock.calls[0]![0] as { select: JSONObject }
    ).select;
    expect(select["batteryLevel"]).toBe(true);
    expect(select["details"]).toBe(true);
  });

  test("a device that reports them gets a battery reading and a storage reading beside its check-in", async () => {
    devicePages = [
      [
        deviceRow({
          id: "d1",
          name: "ESP-ID-AAAAW",
          minutesQuiet: 4,
          batteryLevel: 14,
          details: STORAGE,
        }),
        // A desktop: no battery, and none of its free space.
        deviceRow({
          id: "d2",
          name: "DESKTOP-7KQ2M1",
          minutesQuiet: 10,
          platform: ManagedDevicePlatform.Windows,
          batteryLevel: 0,
          details: { totalStorage: "512" },
        }),
      ],
    ];

    expect(await record()).toEqual({
      readingCount: 2,
      hostCount: 0,
      securityPatchReadingCount: 0,
      batteryReadingCount: 1,
      chargingReadingCount: 0,
      storageReadingCount: 1,
    });
    // One write, every reading together.
    expect(insert).toHaveBeenCalledTimes(1);

    const battery: Array<JSONObject> = rowsOf(
      MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
    );
    const storage: Array<JSONObject> = rowsOf(
      MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
    );

    expect(battery).toHaveLength(1);
    expect(battery[0]!["value"]).toBe(14);
    expect(storage).toHaveLength(1);
    expect(storage[0]!["value"]).toBe(95);
    expect(
      (storage[0]!["attributes"] as Dictionary<string>)[
        "oneuptime.managed_device.storage.free_bytes"
      ],
    ).toBe("1600000000");
    expect(
      (storage[0]!["attributes"] as Dictionary<string>)[
        "oneuptime.managed_device.storage.total_bytes"
      ],
    ).toBe("32000000000");
  });

  test("its battery and storage readings are its check-in's row, the device's and its host's", async () => {
    devicePages = [
      [
        deviceRow({
          id: "d1",
          name: "ESP-ID-AAAAW",
          minutesQuiet: 4,
          batteryLevel: 14,
          details: STORAGE,
        }),
      ],
    ];
    hosts = [hostRow("esp-id-aaaaw")];

    await record();

    const checkIn: JSONObject = rowsOf(
      MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
    )[0]!;

    for (const row of [
      rowsOf(MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME)[0]!,
      rowsOf(MANAGED_DEVICE_STORAGE_USED_METRIC_NAME)[0]!,
    ]) {
      expect(row["hostEntityKey"]).toBe(checkIn["hostEntityKey"]);
      expect(row["primaryEntityId"]).toBe(CONNECTION.toString());
      expect(row["primaryEntityType"]).toBe(
        ServiceType.DeviceManagementConnection,
      );
      expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
      expect(row["time"]).toBe(checkIn["time"]);
      // The agent reports it: its host's templates alert on it, not these.
      expect(
        (row["attributes"] as Dictionary<string>)[
          "oneuptime.managed_device.is_host"
        ],
      ).toBe("true");
    }
  });

  test("puts the battery and storage metrics in the catalog, with their units, once a read wrote one", async () => {
    devicePages = [
      [
        deviceRow({
          id: "d1",
          name: "ESP-ID-AAAAW",
          minutesQuiet: 4,
          batteryLevel: 14,
          details: STORAGE,
        }),
      ],
    ];

    await record();

    const map: Dictionary<MetricType> = (
      register.mock.calls[0]![0] as {
        metricNameServiceNameMap: Dictionary<MetricType>;
      }
    ).metricNameServiceNameMap;

    expect(Object.keys(map).sort()).toEqual(
      [
        MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
        MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
        MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
      ].sort(),
    );
    expect(map[MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME]!.unit).toBe("%");
    expect(map[MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME]!.description).toBe(
      MANAGED_DEVICE_BATTERY_LEVEL_DESCRIPTION,
    );
    expect(map[MANAGED_DEVICE_STORAGE_USED_METRIC_NAME]!.unit).toBe("%");
    expect(map[MANAGED_DEVICE_STORAGE_USED_METRIC_NAME]!.description).toBe(
      MANAGED_DEVICE_STORAGE_USED_DESCRIPTION,
    );
  });
});

describe("buildManagedDeviceBatteryRow and buildManagedDeviceStorageRow", () => {
  const reading: ManagedDeviceCheckInReading = {
    deviceName: "ESP-ID-AAAAW",
    hostName: "esp-id-aaaaw",
    alias: "",
    group: "",
    ageInMinutes: 4,
    isHost: false,
    platform: ManagedDevicePlatform.Android,
    batteryLevel: 14,
    storage: {
      usedPercent: 95,
      totalBytes: 32000000000,
      freeBytes: 1600000000,
    },
  };

  function input(
    overrides: Partial<ManagedDeviceCheckInReading> = {},
  ): Parameters<typeof buildManagedDeviceBatteryRow>[0] {
    return {
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: "esper",
      reading: { ...reading, ...overrides },
      asOf: AS_OF,
      retentionDate: OneUptimeDate.addRemoveDurationInDays(AS_OF, 30),
    };
  }

  test("the battery row is the device's battery, under the check-in's attributes", () => {
    const row: JSONObject = buildManagedDeviceBatteryRow(input())!;

    expect(row["name"]).toBe(MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME);
    expect(row["value"]).toBe(14);
    expect(row["attributes"]).toEqual(
      buildManagedDeviceCheckInRow(input())["attributes"],
    );
    expect(row["entityKeys"]).toEqual([
      keyForHost(PROJECT.toString(), "esp-id-aaaaw"),
    ]);
  });

  test("the storage row is how full it is, with its bytes on it", () => {
    const row: JSONObject = buildManagedDeviceStorageRow(input())!;

    expect(row["name"]).toBe(MANAGED_DEVICE_STORAGE_USED_METRIC_NAME);
    expect(row["value"]).toBe(95);
    expect(row["attributeKeys"]).toEqual(
      Object.keys(row["attributes"] as JSONObject).sort(),
    );
  });

  test("a reading with no battery, or no storage, has no such row", () => {
    expect(
      buildManagedDeviceBatteryRow(input({ batteryLevel: undefined })),
    ).toBeUndefined();
    expect(
      buildManagedDeviceStorageRow(input({ storage: undefined })),
    ).toBeUndefined();
  });
});

describe("buildManagedDeviceSecurityPatchRow", () => {
  const reading: ManagedDeviceCheckInReading = {
    deviceName: "ESP-ID-AAAAW",
    hostName: "esp-id-aaaaw",
    alias: "Store 12 Kiosk 3",
    group: "Stores/Store 12",
    platform: ManagedDevicePlatform.Android,
    ageInMinutes: 12,
    isHost: false,
    securityPatch: { level: "2024-06-05", ageInDays: 897 },
  };
  const retentionDate: Date = new Date("2026-12-19T12:00:00.000Z");

  function build(
    of: ManagedDeviceCheckInReading = reading,
  ): JSONObject | undefined {
    return buildManagedDeviceSecurityPatchRow({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: "esper",
      reading: of,
      asOf: AS_OF,
      retentionDate,
    });
  }

  test("is the check-in's row of the same device, with its patch's age and level", () => {
    const checkIn: JSONObject = buildManagedDeviceCheckInRow({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: "esper",
      reading,
      asOf: AS_OF,
      retentionDate,
    });
    const patch: JSONObject = build()!;

    expect(patch["name"]).toBe(MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME);
    expect(patch["value"]).toBe(897);
    expect(checkIn["value"]).toBe(12);

    for (const key of [
      "projectId",
      "primaryEntityId",
      "primaryEntityType",
      "metricPointType",
      "time",
      "timeUnixNano",
      "entityKeys",
      "hostEntityKey",
      "retentionDate",
    ]) {
      expect({ key, value: patch[key] }).toEqual({ key, value: checkIn[key] });
    }

    expect(patch["primaryEntityType"]).toBe(
      ServiceType.DeviceManagementConnection,
    );
    expect(patch["hostEntityKey"]).toBe(
      keyForHost(PROJECT.toString(), "esp-id-aaaaw"),
    );
    expect(patch["attributes"]).toEqual({
      ...(checkIn["attributes"] as JSONObject),
      "oneuptime.managed_device.security_patch.level": "2024-06-05",
    });
    expect(patch["attributeKeys"]).toEqual(
      [
        ...(checkIn["attributeKeys"] as Array<string>),
        "oneuptime.managed_device.security_patch.level",
      ].sort(),
    );
    expect(patch["_id"]).not.toBe(checkIn["_id"]);
  });

  test("a reading with no patch has no row", () => {
    const withoutPatch: ManagedDeviceCheckInReading = { ...reading };
    delete withoutPatch.securityPatch;

    expect(build(withoutPatch)).toBeUndefined();
  });
});

describe("buildManagedDeviceCheckInRow", () => {
  const row: JSONObject = buildManagedDeviceCheckInRow({
    projectId: PROJECT,
    connectionId: CONNECTION,
    provider: "esper",
    reading: {
      deviceName: "ESP-ID-AAAAW",
      hostName: "esp-id-aaaaw",
      alias: "Store 12 Kiosk 3",
      group: "West",
      ageInMinutes: 75,
      isHost: false,
      platform: ManagedDevicePlatform.Android,
    },
    asOf: AS_OF,
    retentionDate: OneUptimeDate.addRemoveDurationInDays(AS_OF, 30),
  });

  test("is a gauge of the connection's, never billed as ingested telemetry", () => {
    expect(row["name"]).toBe(MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME);
    expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
    expect(row["value"]).toBe(75);
    expect(row["projectId"]).toBe(PROJECT.toString());
    expect(row["primaryEntityId"]).toBe(CONNECTION.toString());
    expect(row["primaryEntityType"]).toBe(
      ServiceType.DeviceManagementConnection,
    );
    expect(TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES).toContain(
      ServiceType.DeviceManagementConnection,
    );
  });

  test("is the device's host's, as ingest keys a host, so its Inventory page charts it", () => {
    const hostKey: string = keyForHost(PROJECT.toString(), "esp-id-aaaaw");

    expect(row["hostEntityKey"]).toBe(hostKey);
    expect(row["entityKeys"]).toEqual([hostKey]);
    expect(
      (row["attributes"] as Dictionary<string>)["resource.host.name"],
    ).toBe("esp-id-aaaaw");
  });

  test("lists its attribute keys, sorted, as every metric row does", () => {
    expect(row["attributeKeys"]).toEqual(
      Object.keys(row["attributes"] as JSONObject).sort(),
    );
    expect(row["attributeKeys"]).toContain("oneuptime.managed_device.is_host");
  });

  // #9837: what the device runs, so a monitor can read one platform's devices.
  test("says what the device runs", () => {
    expect(
      (row["attributes"] as Dictionary<string>)[
        "oneuptime.managed_device.platform"
      ],
    ).toBe("android");
  });

  test("is stamped at the read's end, in ClickHouse's formats", () => {
    expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime(AS_OF));
    expect(row["createdAt"]).toBe(OneUptimeDate.toClickhouseDateTime(AS_OF));
    expect(row["timeUnixNano"]).toBe(
      OneUptimeDate.toUnixNano(AS_OF).toString(),
    );
  });
});

/*
 * #10288: whether a device is on its charger, beside its battery, where
 * its service says so: 1 on power, 0 on its battery, as its own metric
 * with the battery row's attributes, so one series of a monitor holds a
 * device's two readings.
 */
describe("ManagedDeviceCheckInMetrics.record: whether a device is on its charger", () => {
  function rowsOf(metricName: string): Array<JSONObject> {
    return writtenRows().filter((candidate: JSONObject): boolean => {
      return candidate["name"] === metricName;
    });
  }

  test("a device its service says is on power, or on its battery, gets a charging reading beside its battery", async () => {
    devicePages = [
      [
        // A scanner in its cradle.
        deviceRow({
          id: "d1",
          name: "WH-SCANNER-07",
          minutesQuiet: 4,
          batteryLevel: 12,
          details: { isCharging: true },
        }),
        // One in a hand.
        deviceRow({
          id: "d2",
          name: "WH-SCANNER-08",
          minutesQuiet: 6,
          batteryLevel: 15,
          details: { isCharging: false },
        }),
        // An iPhone its service says neither of.
        deviceRow({
          id: "d3",
          name: "Store 0412 Front Counter",
          minutesQuiet: 20,
          platform: ManagedDevicePlatform.IOS,
          batteryLevel: 87,
        }),
        // A desktop on AC with no battery: nothing to say of it.
        deviceRow({
          id: "d4",
          name: "DESKTOP-7KQ2M1",
          minutesQuiet: 10,
          platform: ManagedDevicePlatform.Windows,
          batteryLevel: 0,
          details: { isCharging: true },
        }),
      ],
    ];

    expect(await record()).toEqual({
      readingCount: 4,
      hostCount: 0,
      securityPatchReadingCount: 0,
      batteryReadingCount: 3,
      chargingReadingCount: 2,
      storageReadingCount: 0,
    });

    const charging: Array<JSONObject> = rowsOf(
      MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME,
    );
    const batteries: Array<JSONObject> = rowsOf(
      MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
    );

    expect(
      charging.map((row: JSONObject): [string, unknown] => {
        return [
          (row["attributes"] as Dictionary<string>)[
            "oneuptime.managed_device.name"
          ]!,
          row["value"],
        ];
      }),
    ).toEqual([
      ["WH-SCANNER-07", 1],
      ["WH-SCANNER-08", 0],
    ]);
    // The battery row's very attributes: one series per device.
    expect(charging[0]!["attributes"]).toEqual(batteries[0]!["attributes"]);
    expect(charging[0]!["hostEntityKey"]).toBe(batteries[0]!["hostEntityKey"]);
    expect(charging[0]!["time"]).toBe(batteries[0]!["time"]);
  });

  test("puts the charging metric in the catalog once a read wrote one, and not before", async () => {
    devicePages = [
      [
        deviceRow({
          id: "d1",
          name: "WH-SCANNER-07",
          minutesQuiet: 4,
          batteryLevel: 12,
          details: { isCharging: true },
        }),
      ],
    ];

    await record();

    const map: Dictionary<MetricType> = (
      register.mock.calls[0]![0] as {
        metricNameServiceNameMap: Dictionary<MetricType>;
      }
    ).metricNameServiceNameMap;

    expect(map[MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME]!.description).toBe(
      MANAGED_DEVICE_BATTERY_CHARGING_DESCRIPTION,
    );
    expect(map[MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME]!.unit).toBe("");

    register.mockClear();
    devicePages = [
      [
        deviceRow({
          id: "d1",
          name: "WH-SCANNER-07",
          minutesQuiet: 4,
          batteryLevel: 12,
        }),
      ],
    ];

    await record();

    expect(
      Object.keys(
        (
          register.mock.calls[0]![0] as {
            metricNameServiceNameMap: Dictionary<MetricType>;
          }
        ).metricNameServiceNameMap,
      ),
    ).not.toContain(MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME);
  });
});

describe("buildManagedDeviceChargingRow", () => {
  const reading: ManagedDeviceCheckInReading = {
    deviceName: "WH-SCANNER-07",
    hostName: "wh-scanner-07",
    alias: "",
    group: "",
    ageInMinutes: 4,
    isHost: false,
    platform: ManagedDevicePlatform.Android,
    batteryLevel: 12,
    isCharging: true,
  };

  function input(
    overrides: Partial<ManagedDeviceCheckInReading> = {},
  ): Parameters<typeof buildManagedDeviceChargingRow>[0] {
    return {
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: "workspace-one",
      reading: { ...reading, ...overrides },
      asOf: AS_OF,
      retentionDate: OneUptimeDate.addRemoveDurationInDays(AS_OF, 30),
    };
  }

  test("1 on its charger, 0 on its battery, under the battery row's attributes", () => {
    const row: JSONObject = buildManagedDeviceChargingRow(input())!;

    expect(row["name"]).toBe(MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME);
    expect(row["value"]).toBe(1);
    expect(row["attributes"]).toEqual(
      buildManagedDeviceBatteryRow(input())!["attributes"],
    );
    expect(
      buildManagedDeviceChargingRow(input({ isCharging: false }))!["value"],
    ).toBe(0);
  });

  test("none where its service says neither, or for a device with no battery", () => {
    expect(
      buildManagedDeviceChargingRow(input({ isCharging: undefined })),
    ).toBeUndefined();
    expect(
      buildManagedDeviceChargingRow(input({ batteryLevel: undefined })),
    ).toBeUndefined();
  });
});

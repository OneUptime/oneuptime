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
  buildManagedDeviceCheckInRow,
} from "../../../../Server/Utils/DeviceManagement/ManagedDeviceCheckInMetrics";
import logger from "../../../../Server/Utils/Logger";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_DESCRIPTION,
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
} from "../../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import { EsperDeviceState } from "../../../../Types/DeviceManagement/ManagedDeviceStatus";
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
}): ManagedDevice {
  const row: ManagedDevice = new ManagedDevice();
  row._id = values.id;
  row.providerDeviceId = values.id;
  row.deviceName = values.name;

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

    expect(outcome).toEqual({ readingCount: 2, hostCount: 0 });
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

    expect(await record()).toEqual({ readingCount: 0, hostCount: 0 });
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

    expect(outcome).toEqual({ readingCount: 3, hostCount: 1 });

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

    expect(await record()).toEqual({ readingCount: 1, hostCount: 0 });
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

  test("is stamped at the read's end, in ClickHouse's formats", () => {
    expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime(AS_OF));
    expect(row["createdAt"]).toBe(OneUptimeDate.toClickhouseDateTime(AS_OF));
    expect(row["timeUnixNano"]).toBe(
      OneUptimeDate.toUnixNano(AS_OF).toString(),
    );
  });
});

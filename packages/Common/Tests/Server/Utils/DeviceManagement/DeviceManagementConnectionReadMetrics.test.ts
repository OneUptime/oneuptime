import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import MetricService from "../../../../Server/Services/MetricService";
import { TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES } from "../../../../Server/Services/TelemetryUsageBillingService";
import DeviceManagementConnectionReadMetrics, {
  DeviceManagementConnectionReadRecord,
  buildDeviceManagementConnectionReadRecordRow,
  buildDeviceManagementConnectionReadRow,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectionReadMetrics";
import logger from "../../../../Server/Utils/Logger";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import {
  DeviceManagementConnectionReadOutcome,
  MANAGED_DEVICE_CONNECTION_READ_AGE_DESCRIPTION,
  MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
  MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";

/*
 * What a device management connection writes about itself (#10006): one
 * metric row per reading, keyed to the connection as its devices' readings
 * are, never billed, kept for the monitor metric retention, and the metric
 * in each project's catalog. ClickHouse and the catalog are stood in for;
 * what is asserted is what they are handed.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CONNECTION: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AS_OF: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function failedRead(
  overrides: Partial<DeviceManagementConnectionReadRecord["reading"]> = {},
  projectId: ObjectID = PROJECT,
): DeviceManagementConnectionReadRecord {
  return {
    projectId,
    connectionId: CONNECTION,
    reading: {
      connectionName: "Esper acme",
      provider: DeviceManagementProvider.Esper,
      readIntervalInMinutes: 15,
      outcome: DeviceManagementConnectionReadOutcome.Failed,
      lastSuccessfulReadAt: new Date(AS_OF.getTime() - 75 * MINUTE),
      createdAt: new Date(AS_OF.getTime() - 24 * 60 * MINUTE),
      failureKind: LlmConnectionFailureKind.Authentication,
      lastError: "Esper refused the API key (401 Unauthorized).",
      asOf: AS_OF,
      ...overrides,
    },
  };
}

let insert: jest.SpyInstance;
let register: jest.SpyInstance;

beforeEach(() => {
  insert = jest
    .spyOn(MetricService, "insertJsonRows")
    .mockResolvedValue(undefined as never);
  register = jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined);
  jest.spyOn(MonitorMetricUtil, "getRetentionDays").mockResolvedValue(30);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function writtenRows(): Array<JSONObject> {
  return insert.mock.calls.flatMap(
    (call: Array<unknown>): Array<JSONObject> => {
      return call[0] as Array<JSONObject>;
    },
  );
}

describe("buildDeviceManagementConnectionReadRecordRow", () => {
  const row: JSONObject = buildDeviceManagementConnectionReadRecordRow(
    failedRead(),
    30,
  );

  test("is a gauge of the connection's, never billed as ingested telemetry", () => {
    expect(row["name"]).toBe(MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME);
    expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
    expect(row["projectId"]).toBe(PROJECT.toString());
    expect(row["primaryEntityId"]).toBe(CONNECTION.toString());
    expect(row["primaryEntityType"]).toBe(
      ServiceType.DeviceManagementConnection,
    );
    expect(TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES).toContain(
      ServiceType.DeviceManagementConnection,
    );
  });

  test("reads how long since a read of it worked, and what this one came to", () => {
    expect(row["value"]).toBe(75);
    expect(row["attributes"]).toEqual({
      "oneuptime.managed_device.connection.id": CONNECTION.toString(),
      "oneuptime.managed_device.provider": "esper",
      "oneuptime.managed_device.connection.name": "Esper acme",
      "oneuptime.managed_device.connection.read.outcome": "failed",
      "oneuptime.managed_device.connection.read_interval": "15",
      "oneuptime.managed_device.connection.last_successful_read_at": new Date(
        AS_OF.getTime() - 75 * MINUTE,
      ).toISOString(),
      "oneuptime.managed_device.connection.last_error":
        "Esper refused the API key (401 Unauthorized).",
      "oneuptime.managed_device.connection.read.failure_kind": "authentication",
    });
    expect(row["attributeKeys"]).toEqual(
      Object.keys(row["attributes"] as JSONObject).sort(),
    );
  });

  test("names no host: a connection is none, and its monitor reads it by its id", () => {
    expect(row["hostEntityKey"]).toBeUndefined();
    expect(row["entityKeys"]).toBeUndefined();
  });

  test("is stamped at its moment, and kept for the retention it is given", () => {
    expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime(AS_OF));
    expect(row["createdAt"]).toBe(OneUptimeDate.toClickhouseDateTime(AS_OF));
    expect(row["timeUnixNano"]).toBe(
      OneUptimeDate.toUnixNano(AS_OF).toString(),
    );
    expect(row["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDurationInDays(AS_OF, 30),
      ),
    );
    expect(
      buildDeviceManagementConnectionReadRecordRow(failedRead(), 7)[
        "retentionDate"
      ],
    ).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDurationInDays(AS_OF, 7),
      ),
    );
  });

  test("a read that worked reads 0", () => {
    const worked: JSONObject = buildDeviceManagementConnectionReadRecordRow(
      failedRead({ outcome: DeviceManagementConnectionReadOutcome.Success }),
      30,
    );

    expect(worked["value"]).toBe(0);
    expect(
      (worked["attributes"] as Dictionary<string>)[
        "oneuptime.managed_device.connection.last_error"
      ],
    ).toBeUndefined();
  });

  test("its rows are each their own", () => {
    const first: JSONObject = buildDeviceManagementConnectionReadRow({
      projectId: PROJECT,
      connectionId: CONNECTION,
      reading: { ageInMinutes: 3, attributes: {} },
      asOf: AS_OF,
      retentionDate: AS_OF,
    });
    const second: JSONObject = buildDeviceManagementConnectionReadRow({
      projectId: PROJECT,
      connectionId: CONNECTION,
      reading: { ageInMinutes: 3, attributes: {} },
      asOf: AS_OF,
      retentionDate: AS_OF,
    });

    expect(first["_id"]).not.toBe(second["_id"]);
  });
});

describe("DeviceManagementConnectionReadMetrics.record", () => {
  test("writes one row per reading, kept for the monitor metric retention", async () => {
    jest.spyOn(MonitorMetricUtil, "getRetentionDays").mockResolvedValue(9);

    expect(
      await DeviceManagementConnectionReadMetrics.record([
        failedRead(),
        failedRead({ outcome: DeviceManagementConnectionReadOutcome.Due }),
      ]),
    ).toBe(2);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(writtenRows()).toHaveLength(2);
    expect(writtenRows()[0]!["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDurationInDays(AS_OF, 9),
      ),
    );
    expect(
      (writtenRows()[1]!["attributes"] as Dictionary<string>)[
        "oneuptime.managed_device.connection.read.outcome"
      ],
    ).toBe("due");
  });

  test("puts the metric in each project's catalog, once, with its unit and description", async () => {
    await DeviceManagementConnectionReadMetrics.record([
      failedRead(),
      failedRead({}, OTHER_PROJECT),
      failedRead({}, PROJECT),
    ]);

    expect(register).toHaveBeenCalledTimes(2);
    expect(
      register.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { projectId: ObjectID }).projectId.toString();
      }),
    ).toEqual([PROJECT.toString(), OTHER_PROJECT.toString()]);

    const metricTypes: Dictionary<MetricType> = (
      register.mock.calls[0]![0] as {
        metricNameServiceNameMap: Dictionary<MetricType>;
      }
    ).metricNameServiceNameMap;

    expect(Object.keys(metricTypes)).toEqual([
      MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
    ]);
    expect(
      metricTypes[MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME]!.unit,
    ).toBe(MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT);
    expect(
      metricTypes[MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME]!.description,
    ).toBe(MANAGED_DEVICE_CONNECTION_READ_AGE_DESCRIPTION);
  });

  test("writes nothing, and asks nothing, for no reading", async () => {
    expect(await DeviceManagementConnectionReadMetrics.record([])).toBe(0);
    expect(insert).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  test("a catalog that cannot be written is logged: the rows are written all the same", async () => {
    register.mockRejectedValue(new Error("Postgres is down"));

    expect(
      await DeviceManagementConnectionReadMetrics.record([failedRead()]),
    ).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a write that fails is the caller's to keep a warning: it throws", async () => {
    insert.mockRejectedValue(new Error("ClickHouse is down"));

    await expect(
      DeviceManagementConnectionReadMetrics.record([failedRead()]),
    ).rejects.toThrow("ClickHouse is down");
    expect(register).not.toHaveBeenCalled();
  });
});

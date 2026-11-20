import {
  DeviceManagementConnectionReadOutcome,
  DeviceManagementConnectionReading,
  DeviceManagementConnectionReadingAttribute,
  MANAGED_DEVICE_CONNECTION_METRIC_NAMES,
  MANAGED_DEVICE_CONNECTION_READ_AGE_DESCRIPTION,
  MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
  MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT,
  MAX_DEVICE_MANAGEMENT_CONNECTION_READING_ERROR_LENGTH,
  getDeviceManagementConnectionReadAgeInMinutes,
  getDeviceManagementConnectionReading,
  getDeviceManagementConnectionReadingError,
  getDeviceManagementConnectionReadingName,
} from "../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import {
  MANAGED_DEVICE_READING_METRIC_NAMES,
  ManagedDeviceCheckInAttribute,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import { describe, expect, test } from "@jest/globals";

/*
 * A device management connection's own reading (#10006): the minutes since
 * a read of it worked, at every read and whenever a read of it falls due,
 * with what the read came to and the error it failed with - what Connection
 * Stopped Reading alerts on, and what its first command lists.
 */

const MINUTE: number = 60 * 1000;
const AS_OF: Date = new Date("2026-11-19T12:00:00.000Z");
const CONNECTION_ID: string = "55555555-5555-4555-8555-555555555555";

function minutesBefore(minutes: number): Date {
  return new Date(AS_OF.getTime() - minutes * MINUTE);
}

describe("the metric", () => {
  test("is OneUptime's own, in minutes, named beside the devices' readings, and says what it is", () => {
    expect(MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME).toBe(
      "oneuptime.managed_device.connection.read.age",
    );
    expect(MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT).toBe("min");
    expect(MANAGED_DEVICE_CONNECTION_READ_AGE_DESCRIPTION).toContain(
      "Minutes since a device management connection last read its devices",
    );
    expect(MANAGED_DEVICE_CONNECTION_METRIC_NAMES).toEqual([
      MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
    ]);
    // A reading of the connection, not of a device: none of the devices' metrics.
    for (const name of MANAGED_DEVICE_CONNECTION_METRIC_NAMES) {
      expect(MANAGED_DEVICE_READING_METRIC_NAMES).not.toContain(name);
    }
  });

  test("names the connection and its service under the keys the devices' readings do", () => {
    expect(DeviceManagementConnectionReadingAttribute.ConnectionId).toBe(
      ManagedDeviceCheckInAttribute.ConnectionId,
    );
    expect(DeviceManagementConnectionReadingAttribute.Provider).toBe(
      ManagedDeviceCheckInAttribute.Provider,
    );
    expect(DeviceManagementConnectionReadingAttribute.ConnectionName).toBe(
      "oneuptime.managed_device.connection.name",
    );
  });
});

describe("getDeviceManagementConnectionReadAgeInMinutes", () => {
  test("counts whole minutes since the last read that worked", () => {
    expect(
      getDeviceManagementConnectionReadAgeInMinutes({
        lastSuccessfulReadAt: minutesBefore(55),
        createdAt: minutesBefore(600),
        asOf: AS_OF,
      }),
    ).toBe(55);

    // 55 minutes and 59 seconds is 55.
    expect(
      getDeviceManagementConnectionReadAgeInMinutes({
        lastSuccessfulReadAt: new Date(AS_OF.getTime() - 55 * MINUTE - 59000),
        asOf: AS_OF,
      }),
    ).toBe(55);

    // As stored: an ISO string.
    expect(
      getDeviceManagementConnectionReadAgeInMinutes({
        lastSuccessfulReadAt: minutesBefore(90).toISOString(),
        asOf: AS_OF,
      }),
    ).toBe(90);
  });

  test("from when the connection was saved, when no read has worked yet", () => {
    expect(
      getDeviceManagementConnectionReadAgeInMinutes({
        lastSuccessfulReadAt: null,
        createdAt: minutesBefore(42),
        asOf: AS_OF,
      }),
    ).toBe(42);

    // A time that reads as no time is none.
    expect(
      getDeviceManagementConnectionReadAgeInMinutes({
        lastSuccessfulReadAt: "not a date",
        createdAt: minutesBefore(42),
        asOf: AS_OF,
      }),
    ).toBe(42);
  });

  test("is never negative, and 0 when the connection says neither", () => {
    expect(
      getDeviceManagementConnectionReadAgeInMinutes({
        lastSuccessfulReadAt: new Date(AS_OF.getTime() + 5 * MINUTE),
        asOf: AS_OF,
      }),
    ).toBe(0);
    expect(getDeviceManagementConnectionReadAgeInMinutes({ asOf: AS_OF })).toBe(
      0,
    );
  });
});

describe("getDeviceManagementConnectionReading", () => {
  const BASE: Omit<
    Parameters<typeof getDeviceManagementConnectionReading>[0],
    "outcome"
  > = {
    connectionId: CONNECTION_ID,
    connectionName: "Esper acme",
    provider: DeviceManagementProvider.Esper,
    readIntervalInMinutes: 15,
    lastSuccessfulReadAt: minutesBefore(80),
    createdAt: minutesBefore(24 * 60),
    asOf: AS_OF,
  };

  test("a read that worked reads 0, now as its last that worked, and carries no error", () => {
    for (const outcome of [
      DeviceManagementConnectionReadOutcome.Success,
      DeviceManagementConnectionReadOutcome.Partial,
    ]) {
      const reading: DeviceManagementConnectionReading =
        getDeviceManagementConnectionReading({
          ...BASE,
          outcome,
          failureKind: LlmConnectionFailureKind.Authentication,
          lastError: "an error from a read before",
        });

      expect(reading).toEqual({
        ageInMinutes: 0,
        attributes: {
          "oneuptime.managed_device.connection.id": CONNECTION_ID,
          "oneuptime.managed_device.provider": "esper",
          "oneuptime.managed_device.connection.name": "Esper acme",
          "oneuptime.managed_device.connection.read.outcome": outcome,
          "oneuptime.managed_device.connection.read_interval": "15",
          "oneuptime.managed_device.connection.last_successful_read_at":
            AS_OF.toISOString(),
        },
      });
    }
  });

  test("a read that failed reads how long since one worked, and why it failed", () => {
    const reading: DeviceManagementConnectionReading =
      getDeviceManagementConnectionReading({
        ...BASE,
        outcome: DeviceManagementConnectionReadOutcome.Failed,
        failureKind: LlmConnectionFailureKind.Authentication,
        lastError: "Esper refused the API key (401 Unauthorized).",
      });

    expect(reading).toEqual({
      ageInMinutes: 80,
      attributes: {
        "oneuptime.managed_device.connection.id": CONNECTION_ID,
        "oneuptime.managed_device.provider": "esper",
        "oneuptime.managed_device.connection.name": "Esper acme",
        "oneuptime.managed_device.connection.read.outcome": "failed",
        "oneuptime.managed_device.connection.read_interval": "15",
        "oneuptime.managed_device.connection.last_successful_read_at":
          minutesBefore(80).toISOString(),
        "oneuptime.managed_device.connection.last_error":
          "Esper refused the API key (401 Unauthorized).",
        "oneuptime.managed_device.connection.read.failure_kind":
          "authentication",
      },
    });
  });

  test("a read falling due carries the error its last read failed with, and no failure kind of its own", () => {
    const reading: DeviceManagementConnectionReading =
      getDeviceManagementConnectionReading({
        ...BASE,
        outcome: DeviceManagementConnectionReadOutcome.Due,
        failureKind: LlmConnectionFailureKind.Unavailable,
        lastError: "OneUptime could not reach Esper.",
      });

    expect(reading.ageInMinutes).toBe(80);
    expect(reading.attributes).toMatchObject({
      "oneuptime.managed_device.connection.read.outcome": "due",
      "oneuptime.managed_device.connection.last_error":
        "OneUptime could not reach Esper.",
    });
    expect(
      reading.attributes[
        DeviceManagementConnectionReadingAttribute.FailureKind
      ],
    ).toBeUndefined();

    // A connection whose last read worked has no error to carry.
    expect(
      getDeviceManagementConnectionReading({
        ...BASE,
        outcome: DeviceManagementConnectionReadOutcome.Due,
        lastError: null,
      }).attributes[DeviceManagementConnectionReadingAttribute.LastError],
    ).toBeUndefined();
  });

  test("a connection no read has worked for counts from when it was saved, and says no last read", () => {
    const reading: DeviceManagementConnectionReading =
      getDeviceManagementConnectionReading({
        ...BASE,
        lastSuccessfulReadAt: null,
        createdAt: minutesBefore(70),
        outcome: DeviceManagementConnectionReadOutcome.Failed,
        failureKind: LlmConnectionFailureKind.Settings,
        lastError: "Check the tenant and the API key.",
      });

    expect(reading.ageInMinutes).toBe(70);
    expect(
      reading.attributes[
        DeviceManagementConnectionReadingAttribute.LastSuccessfulReadAt
      ],
    ).toBeUndefined();
  });

  test("names each service's connection by its name, or by the service's when it has none", () => {
    for (const [provider, title] of [
      [DeviceManagementProvider.Esper, "Esper"],
      [DeviceManagementProvider.Intune, "Microsoft Intune"],
      [DeviceManagementProvider.WorkspaceOne, "Workspace ONE UEM"],
      [DeviceManagementProvider.Soti, "SOTI MobiControl"],
    ] as Array<[DeviceManagementProvider, string]>) {
      expect(
        getDeviceManagementConnectionReadingName({
          connectionName: "  ",
          provider,
        }),
      ).toBe(title);
      expect(
        getDeviceManagementConnectionReading({
          ...BASE,
          provider,
          connectionName: " Stores ",
          outcome: DeviceManagementConnectionReadOutcome.Success,
        }).attributes,
      ).toMatchObject({
        "oneuptime.managed_device.provider": provider,
        "oneuptime.managed_device.connection.name": "Stores",
      });
    }
  });
});

describe("getDeviceManagementConnectionReadingError", () => {
  test("keeps an error on one line", () => {
    expect(
      getDeviceManagementConnectionReadingError(
        "Esper refused the API key.\n\n  Status: 401\tUnauthorized ",
      ),
    ).toBe("Esper refused the API key. Status: 401 Unauthorized");
    expect(getDeviceManagementConnectionReadingError(undefined)).toBe("");
    expect(getDeviceManagementConnectionReadingError("   ")).toBe("");
  });

  test("cuts a long one short, and says so", () => {
    const long: string = `Microsoft Graph answered: ${"x".repeat(2000)}`;
    const cut: string = getDeviceManagementConnectionReadingError(long);

    expect(cut.length).toBe(
      MAX_DEVICE_MANAGEMENT_CONNECTION_READING_ERROR_LENGTH,
    );
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.startsWith("Microsoft Graph answered: ")).toBe(true);
  });
});

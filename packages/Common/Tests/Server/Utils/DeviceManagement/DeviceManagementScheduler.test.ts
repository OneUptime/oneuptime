import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DeviceManagementConnection from "../../../../Models/DatabaseModels/DeviceManagementConnection";
import Queue from "../../../../Server/Infrastructure/Queue";
import DeviceManagementConnectionService from "../../../../Server/Services/DeviceManagementConnectionService";
import { DeviceManagementConnectionReadRecord } from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectionReadMetrics";
import DeviceManagementScheduler, {
  DEVICE_MANAGEMENT_READ_JOB,
  getDueConnectionReadRecord,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementScheduler";
import logger from "../../../../Server/Utils/Logger";
import { DeviceManagementConnectionReadOutcome } from "../../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * When each device management connection is read, and what a read falling
 * due says of it (#10006): every minute the due connections are claimed
 * and queued, one job each, and each that was already on its schedule
 * writes its own reading - how long since a read of it worked - so a
 * connection whose reads stop finishing still reads older at each
 * interval. One claimed fresh (just saved, edited or turned on) writes
 * none: its first read is about to say how it is.
 */

const NOW: Date = new Date("2026-11-19T12:00:10Z");
const MINUTE: number = 60 * 1000;
const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const DUE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const FRESH: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const FAILING: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

function connection(data: {
  id: ObjectID;
  projectId?: ObjectID | undefined;
  name?: string | undefined;
  provider?: DeviceManagementProvider | undefined;
  readIntervalInMinutes?: number | undefined;
  nextPullAt?: Date | undefined;
  lastSuccessfulPullAt?: Date | undefined;
  lastError?: string | undefined;
}): DeviceManagementConnection {
  const value: DeviceManagementConnection = new DeviceManagementConnection();
  value.id = data.id;
  value.projectId = data.projectId || PROJECT;
  value.name = data.name || "Esper acme";
  value.provider = data.provider || DeviceManagementProvider.Esper;
  value.config = {
    tenant: "acme",
    readIntervalInMinutes: data.readIntervalInMinutes ?? 15,
  };
  value.createdAt = new Date(NOW.getTime() - 30 * 24 * 60 * MINUTE);

  if (data.nextPullAt) {
    value.nextPullAt = data.nextPullAt;
  }

  if (data.lastSuccessfulPullAt) {
    value.lastSuccessfulPullAt = data.lastSuccessfulPullAt;
  }

  if (data.lastError) {
    value.lastError = data.lastError;
  }

  return value;
}

let findBy: jest.SpyInstance;
let updateOneById: jest.SpyInstance;
let addJob: jest.SpyInstance;
let written: Array<DeviceManagementConnectionReadRecord>;

const allowed: (projectId: ObjectID) => Promise<boolean> = async (
  projectId: ObjectID,
): Promise<boolean> => {
  return projectId.toString() !== OTHER_PROJECT.toString();
};

async function tick(
  overrides: Parameters<
    typeof DeviceManagementScheduler.enqueueDueConnections
  >[1] = {},
): Promise<number> {
  return await DeviceManagementScheduler.enqueueDueConnections(NOW, {
    isTelemetryAllowed: allowed,
    recordConnectionReadings: async (
      records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
    ): Promise<number> => {
      written.push(...records);
      return records.length;
    },
    ...overrides,
  });
}

beforeEach(() => {
  written = [];
  findBy = jest
    .spyOn(DeviceManagementConnectionService, "findBy")
    .mockResolvedValue([
      connection({
        id: DUE,
        nextPullAt: new Date(NOW.getTime() - MINUTE),
        lastSuccessfulPullAt: new Date(NOW.getTime() - 16 * MINUTE),
      }),
      // Just saved, edited or turned on: its next read was never set.
      connection({ id: FRESH, name: "Contoso Intune" }),
      connection({
        id: FAILING,
        name: "MobiControl stores",
        provider: DeviceManagementProvider.Soti,
        readIntervalInMinutes: 30,
        nextPullAt: new Date(NOW.getTime() - 2 * MINUTE),
        lastSuccessfulPullAt: new Date(NOW.getTime() - 3 * 60 * MINUTE),
        lastError: "MobiControl refused OneUptime's sign-in: invalid_grant.",
      }),
    ] as never);
  updateOneById = jest
    .spyOn(DeviceManagementConnectionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  addJob = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DeviceManagementScheduler.enqueueDueConnections", () => {
  test("claims and queues every due connection, one job each, its id and nothing else", async () => {
    expect(await tick()).toBe(3);

    expect(updateOneById).toHaveBeenCalledTimes(3);
    expect(
      (
        updateOneById.mock.calls[2]![0] as {
          data: { nextPullAt: Date };
        }
      ).data.nextPullAt,
    ).toEqual(new Date(NOW.getTime() + 30 * MINUTE));

    expect(addJob).toHaveBeenCalledTimes(3);
    expect(addJob.mock.calls[0]![2]).toBe(DEVICE_MANAGEMENT_READ_JOB);
    expect(addJob.mock.calls[0]![3]).toEqual({ connectionId: DUE.toString() });
  });

  test("asks for what a reading says too: the connection's name, service, last read that worked and last error", async () => {
    await tick();

    const select: JSONObject = (
      findBy.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    for (const column of [
      "projectId",
      "name",
      "provider",
      "createdAt",
      "nextPullAt",
      "lastSuccessfulPullAt",
      "lastError",
    ]) {
      expect([column, select[column]]).toEqual([column, true]);
    }
  });

  test("each connection already on its schedule writes its reading; one claimed fresh writes none", async () => {
    await tick();

    expect(
      written.map((record: DeviceManagementConnectionReadRecord): string => {
        return record.connectionId.toString();
      }),
    ).toEqual([DUE.toString(), FAILING.toString()]);

    expect(written[0]!.reading).toMatchObject({
      connectionName: "Esper acme",
      provider: DeviceManagementProvider.Esper,
      readIntervalInMinutes: 15,
      outcome: DeviceManagementConnectionReadOutcome.Due,
      lastSuccessfulReadAt: new Date(NOW.getTime() - 16 * MINUTE),
      asOf: NOW,
    });
    expect(written[0]!.reading.lastError).toBeUndefined();

    // A failing connection carries the error its last read failed with.
    expect(written[1]!.reading).toMatchObject({
      connectionName: "MobiControl stores",
      provider: DeviceManagementProvider.Soti,
      readIntervalInMinutes: 30,
      lastError: "MobiControl refused OneUptime's sign-in: invalid_grant.",
    });
  });

  test("a project that may not read telemetry writes none: its reads read nothing either", async () => {
    findBy.mockResolvedValue([
      connection({
        id: DUE,
        projectId: OTHER_PROJECT,
        nextPullAt: new Date(NOW.getTime() - MINUTE),
      }),
    ] as never);

    expect(await tick()).toBe(1);
    expect(written).toEqual([]);
  });

  test("asks once per project whether it may read telemetry", async () => {
    let asked: number = 0;

    await tick({
      isTelemetryAllowed: async (): Promise<boolean> => {
        asked++;
        return true;
      },
    });

    expect(asked).toBe(1);
    expect(written).toHaveLength(2);
  });

  test("a reading that cannot be written is logged: the reads are queued all the same", async () => {
    expect(
      await tick({
        recordConnectionReadings: async (): Promise<number> => {
          throw new Error("ClickHouse is not answering");
        },
      }),
    ).toBe(3);

    expect(addJob).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a connection that cannot be claimed is still due: its reading says how long since a read worked", async () => {
    updateOneById.mockRejectedValueOnce(new Error("Postgres is not answering"));

    expect(await tick()).toBe(2);
    expect(
      written.map((record: DeviceManagementConnectionReadRecord) => {
        return record.connectionId.toString();
      }),
    ).toEqual([DUE.toString(), FAILING.toString()]);
  });

  test("no due connection, no reading", async () => {
    findBy.mockResolvedValue([] as never);

    expect(await tick()).toBe(0);
    expect(written).toEqual([]);
  });
});

describe("getDueConnectionReadRecord", () => {
  test("is undefined for a connection claimed fresh, or one with no id or project", () => {
    expect(
      getDueConnectionReadRecord({
        connection: connection({ id: FRESH }),
        intervalInMinutes: 15,
        now: NOW,
      }),
    ).toBeUndefined();

    const orphan: DeviceManagementConnection = connection({
      id: DUE,
      nextPullAt: NOW,
    });
    // A row read without its project, which no claim can write a reading for.
    orphan.projectId = undefined as unknown as ObjectID;

    expect(
      getDueConnectionReadRecord({
        connection: orphan,
        intervalInMinutes: 15,
        now: NOW,
      }),
    ).toBeUndefined();
  });

  test("is a read falling due, as of now, for one on its schedule", () => {
    expect(
      getDueConnectionReadRecord({
        connection: connection({
          id: DUE,
          nextPullAt: new Date(NOW.getTime() - MINUTE),
          lastSuccessfulPullAt: new Date(NOW.getTime() - 70 * MINUTE),
          lastError: "OneUptime could not reach Esper.",
        }),
        intervalInMinutes: 15,
        now: NOW,
      }),
    ).toEqual({
      projectId: PROJECT,
      connectionId: DUE,
      reading: {
        connectionName: "Esper acme",
        provider: DeviceManagementProvider.Esper,
        readIntervalInMinutes: 15,
        outcome: DeviceManagementConnectionReadOutcome.Due,
        lastSuccessfulReadAt: new Date(NOW.getTime() - 70 * MINUTE),
        createdAt: new Date(NOW.getTime() - 30 * 24 * 60 * MINUTE),
        lastError: "OneUptime could not reach Esper.",
        asOf: NOW,
      },
    });
  });
});

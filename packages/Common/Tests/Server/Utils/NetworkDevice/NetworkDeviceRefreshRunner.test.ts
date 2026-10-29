import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceRefreshRunner, {
  MONITOR_BACKED_REASON,
  NO_PROBE_REASON,
  NetworkDeviceRefreshAnswer,
  POLLING_OFF_REASON,
} from "../../../../Server/Utils/NetworkDevice/NetworkDeviceRefreshRunner";
import NetworkControllerConnectionService from "../../../../Server/Services/NetworkControllerConnectionService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkControllerConnection from "../../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../../Models/DatabaseModels/Probe";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { NETWORK_DEVICE_REFRESH_POLL_AT } from "../../../../Utils/NetworkDevice/NetworkDeviceRefresh";

/*
 * Refresh, on the server: the device goes first in its probe's queue, its
 * Meraki connection is read at once, the ask is recorded once - a second
 * within a minute is the first - and a device nothing reads on its own is
 * refused with a reason a person can act on.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const DEVICE: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000001");
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";
const NOW: Date = new Date("2026-10-28T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

let device: NetworkDevice | null;
let connection: NetworkControllerConnection | null;
let writes: Array<{ id: ObjectID; data: JSONObject; expectedData: JSONObject }>;
let enqueued: Array<string>;
let deviceQueries: Array<JSONObject>;
let connectionQueries: Array<JSONObject>;

function probePolledDevice(
  overrides: Partial<NetworkDevice> = {},
): NetworkDevice {
  const model: NetworkDevice = new NetworkDevice();
  model.id = DEVICE;
  model.projectId = PROJECT;
  model.probeId = new ObjectID("30000000-0000-4000-8000-000000000001");
  const probe: Probe = new Probe();
  probe.name = "Branch probe";
  model.probe = probe;
  model.hostname = "10.0.0.2";
  model.isPollingEnabled = true;
  model.monitoringMethod = "Probe";
  model.lastPolledAt = new Date(NOW.getTime() - 4 * MINUTE);
  Object.assign(model, overrides);
  return model;
}

const MERAKI_READING: JSONObject = {
  provider: "meraki",
  readBy: { type: "networkController", id: CONNECTION_ID, name: "Acme Retail" },
  readAt: "2026-10-28T11:55:00.000Z",
  values: { model: "MS225-48LP" },
};

async function refresh(): Promise<NetworkDeviceRefreshAnswer> {
  return await NetworkDeviceRefreshRunner.refresh(
    { projectId: PROJECT, deviceId: DEVICE },
    {
      now: NOW,
      enqueueControllerRead: async (id: ObjectID): Promise<void> => {
        enqueued.push(id.toString());
      },
    },
  );
}

beforeEach(() => {
  device = probePolledDevice();
  connection = null;
  writes = [];
  enqueued = [];
  deviceQueries = [];
  connectionQueries = [];

  jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockImplementation((async (data: { query: JSONObject }) => {
      deviceQueries.push(data.query);
      return device;
    }) as never);
  jest
    .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: JSONObject;
      expectedData: JSONObject;
    }) => {
      writes.push(data);
    }) as never);
  jest
    .spyOn(NetworkControllerConnectionService, "findOneBy")
    .mockImplementation((async (data: { query: JSONObject }) => {
      connectionQueries.push(data.query);
      return connection;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a device its probe polls", () => {
  test("goes first in its probe's queue, and the ask is recorded", async () => {
    const answer: NetworkDeviceRefreshAnswer = await refresh();

    expect(answer).toEqual({
      requestedAt: NOW.toISOString(),
      isProbeReading: true,
      probeName: "Branch probe",
      isControllerReading: false,
      wasAlreadyRequested: false,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.id).toEqual(DEVICE);
    expect(writes[0]!.data).toEqual({
      refreshRequestedAt: NOW,
      nextPollAt: NETWORK_DEVICE_REFRESH_POLL_AT,
    });
    // Never brings a device deleted meanwhile back into the queue.
    expect(writes[0]!.expectedData).toEqual({ deletedAt: null });
    expect(enqueued).toEqual([]);
  });

  test("the device is read in its project only", async () => {
    await refresh();

    expect(deviceQueries[0]).toEqual({ _id: DEVICE, projectId: PROJECT });
  });

  test("a second ask within a minute, before its poll, is the first: nothing queued twice", async () => {
    device = probePolledDevice({
      refreshRequestedAt: new Date(NOW.getTime() - 20 * SECOND),
    });

    const answer: NetworkDeviceRefreshAnswer = await refresh();

    expect(answer.wasAlreadyRequested).toBe(true);
    expect(answer.requestedAt).toBe(
      new Date(NOW.getTime() - 20 * SECOND).toISOString(),
    );
    expect(writes).toEqual([]);
  });

  test("an ask after the last one was answered is a new one", async () => {
    device = probePolledDevice({
      refreshRequestedAt: new Date(NOW.getTime() - 40 * SECOND),
      lastPolledAt: new Date(NOW.getTime() - 10 * SECOND),
    });

    const answer: NetworkDeviceRefreshAnswer = await refresh();

    expect(answer.wasAlreadyRequested).toBe(false);
    expect(writes).toHaveLength(1);
  });
});

describe("a device a Meraki connection describes", () => {
  test("its connection is read at once, beside its probe", async () => {
    device = probePolledDevice({
      discoveredDetails: { controller: MERAKI_READING },
    });
    connection = new NetworkControllerConnection();
    connection.id = new ObjectID(CONNECTION_ID);
    connection.name = "Acme Retail";

    const answer: NetworkDeviceRefreshAnswer = await refresh();

    expect(answer).toMatchObject({
      isProbeReading: true,
      isControllerReading: true,
      controllerName: "Acme Retail",
    });
    expect(enqueued).toEqual([CONNECTION_ID]);
    // Only a connection of this project that is turned on.
    expect(connectionQueries[0]).toEqual({
      _id: CONNECTION_ID,
      projectId: PROJECT,
      isEnabled: true,
    });
  });

  test("a device only Meraki reads: its connection, and no place in a probe's queue", async () => {
    device = probePolledDevice({
      monitoringMethod: "Monitor",
      discoveredDetails: { controller: MERAKI_READING },
    });
    connection = new NetworkControllerConnection();
    connection.id = new ObjectID(CONNECTION_ID);
    connection.name = "Acme Retail";

    const answer: NetworkDeviceRefreshAnswer = await refresh();

    expect(answer).toMatchObject({
      isProbeReading: false,
      isControllerReading: true,
    });
    expect(answer.probeName).toBeUndefined();
    expect(writes[0]!.data).toEqual({ refreshRequestedAt: NOW });
  });

  test("a connection that is off, or gone: refused when nothing else reads it", async () => {
    device = probePolledDevice({
      monitoringMethod: "Monitor",
      discoveredDetails: { controller: MERAKI_READING },
    });
    connection = null;

    await expect(refresh()).rejects.toThrow(
      new BadDataException(MONITOR_BACKED_REASON),
    );
    expect(writes).toEqual([]);
  });

  test("a read that cannot be queued: its probe still reads the device", async () => {
    device = probePolledDevice({
      discoveredDetails: { controller: MERAKI_READING },
    });
    connection = new NetworkControllerConnection();
    connection.id = new ObjectID(CONNECTION_ID);

    const answer: NetworkDeviceRefreshAnswer =
      await NetworkDeviceRefreshRunner.refresh(
        { projectId: PROJECT, deviceId: DEVICE },
        {
          now: NOW,
          enqueueControllerRead: async () => {
            throw new Error("Redis is not answering");
          },
        },
      );

    expect(answer).toMatchObject({
      isProbeReading: true,
      isControllerReading: false,
    });
  });
});

describe("a device nothing reads on its own", () => {
  test.each<[string, Record<string, unknown>, string]>([
    ["monitor-backed", { monitoringMethod: "Monitor" }, MONITOR_BACKED_REASON],
    ["polling turned off", { isPollingEnabled: false }, POLLING_OFF_REASON],
    ["no probe", { probeId: undefined }, NO_PROBE_REASON],
  ])(
    "%s: refused, saying why",
    async (_: string, overrides: Record<string, unknown>, reason: string) => {
      device = probePolledDevice(overrides as never);

      await expect(refresh()).rejects.toThrow(new BadDataException(reason));
      expect(writes).toEqual([]);
    },
  );

  test("a device that is not there is not found", async () => {
    device = null;

    await expect(refresh()).rejects.toThrow(NotFoundException);
  });
});

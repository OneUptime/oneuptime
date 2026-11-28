import TelemetryInsertBackpressure, {
  BACKPRESSURE_WINDOW_MS,
  RECORD_INTERVAL_MS,
  TELEMETRY_INSERT_BACKPRESSURE_KEY,
} from "../../../../Server/Utils/Telemetry/TelemetryInsertBackpressure";
import Queue, { QueueName } from "../../../../Server/Infrastructure/Queue";
import Redis, { ClientType } from "../../../../Server/Infrastructure/Redis";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * 2026-11-27: ClickHouse refused metric inserts (TOO_MANY_PARTS) for hours,
 * the Telemetry queue grew because its jobs could not be stored, and KEDA -
 * which saw only that backlog - scaled the workers from 10 to 139, each
 * adding inserts to the ClickHouse refusing them. A writer whose insert is
 * refused marks it in Valkey, and while it is marked the backlog the
 * autoscaler reads leaves out the bulk telemetry waiting for ClickHouse.
 */

interface FakeValkey {
  set: Mock<(...args: Array<unknown>) => Promise<string>>;
  exists: Mock<(key: string) => Promise<number>>;
}

let valkey: FakeValkey;
let backlog: Mock<
  (
    queueName: QueueName,
    options?: { withoutPrioritized?: boolean | undefined },
  ) => Promise<number>
>;

const NOW: number = Date.parse("2026-11-27T22:00:00Z");

beforeEach(() => {
  valkey = {
    set: jest.fn(async (): Promise<string> => {
      return "OK";
    }),
    exists: jest.fn(async (): Promise<number> => {
      return 0;
    }),
  };
  jest
    .spyOn(Redis, "getClient")
    .mockReturnValue(valkey as unknown as ClientType);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);

  backlog = jest.fn(
    async (
      _queueName: QueueName,
      options?: { withoutPrioritized?: boolean | undefined },
    ): Promise<number> => {
      // 700,000 bulk batches, 12 monitoring jobs.
      return options?.withoutPrioritized ? 12 : 700_012;
    },
  );
  jest
    .spyOn(Queue, "getQueueBacklogSize")
    .mockImplementation(backlog as unknown as typeof Queue.getQueueBacklogSize);

  TelemetryInsertBackpressure.reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("marking ClickHouse as pushing back", () => {
  test("marks it in Valkey, for every pod, for two minutes", () => {
    TelemetryInsertBackpressure.record(NOW);

    expect(valkey.set).toHaveBeenCalledWith(
      TELEMETRY_INSERT_BACKPRESSURE_KEY,
      String(NOW),
      "PX",
      BACKPRESSURE_WINDOW_MS,
    );
    expect(BACKPRESSURE_WINDOW_MS).toBe(120_000);
  });

  test("at most once per ten seconds a writer, however many inserts fail", () => {
    TelemetryInsertBackpressure.record(NOW);
    for (let i: number = 0; i < 50; i++) {
      TelemetryInsertBackpressure.record(NOW + RECORD_INTERVAL_MS - 1);
    }
    expect(valkey.set).toHaveBeenCalledTimes(1);

    TelemetryInsertBackpressure.record(NOW + RECORD_INTERVAL_MS);
    expect(valkey.set).toHaveBeenCalledTimes(2);
  });

  test("a Valkey it cannot reach marks nothing, and the next failure tries again", () => {
    jest.spyOn(Redis, "isConnected").mockReturnValue(false);
    TelemetryInsertBackpressure.record(NOW);
    expect(valkey.set).not.toHaveBeenCalled();

    jest.spyOn(Redis, "isConnected").mockReturnValue(true);
    TelemetryInsertBackpressure.record(NOW + 1);
    expect(valkey.set).toHaveBeenCalledTimes(1);
  });

  test("a failed write never throws to the insert that recorded it", async () => {
    valkey.set.mockRejectedValue(new Error("OOM command not allowed"));

    expect(() => {
      TelemetryInsertBackpressure.record(NOW);
    }).not.toThrow();
    await Promise.resolve();
  });
});

describe("the backlog the autoscaler reads", () => {
  test("while ClickHouse pushes back: without the bulk telemetry waiting for it", async () => {
    valkey.exists.mockResolvedValue(1);

    await expect(
      TelemetryInsertBackpressure.getTelemetryBacklogForScaling(),
    ).resolves.toBe(12);
    expect(backlog).toHaveBeenCalledWith(QueueName.Telemetry, {
      withoutPrioritized: true,
    });
    expect(valkey.exists).toHaveBeenCalledWith(
      TELEMETRY_INSERT_BACKPRESSURE_KEY,
    );
  });

  test("otherwise: all of it", async () => {
    await expect(
      TelemetryInsertBackpressure.getTelemetryBacklogForScaling(),
    ).resolves.toBe(700_012);
    expect(backlog).toHaveBeenCalledWith(QueueName.Telemetry, {
      withoutPrioritized: false,
    });
  });

  test("a Valkey that cannot say counts all of it, as before", async () => {
    valkey.exists.mockRejectedValue(new Error("Connection is closed."));
    await expect(TelemetryInsertBackpressure.isActive()).resolves.toBe(false);

    jest.spyOn(Redis, "isConnected").mockReturnValue(false);
    await expect(
      TelemetryInsertBackpressure.getTelemetryBacklogForScaling(),
    ).resolves.toBe(700_012);
  });
});

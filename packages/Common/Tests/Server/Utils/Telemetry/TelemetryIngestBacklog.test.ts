import TelemetryIngestBacklog from "../../../../Server/Utils/Telemetry/TelemetryIngestBacklog";
import Queue, {
  QueueJob,
  QueueName,
} from "../../../../Server/Infrastructure/Queue";
import Redis from "../../../../Server/Infrastructure/Redis";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * Issue #2825: how far behind OneUptime is in reading what it has received -
 * the time the oldest job still waiting on the Telemetry queue was added.
 */

function job(data: { timestamp?: unknown; attemptsMade?: number }): QueueJob {
  return {
    timestamp: data.timestamp,
    attemptsMade: data.attemptsMade ?? 0,
  } as unknown as QueueJob;
}

let getJobs: Mock<
  (
    types: Array<string>,
    start: number,
    end: number,
    asc: boolean,
  ) => Promise<Array<QueueJob>>
>;
let getQueue: SpyInstance<typeof Queue.getQueue>;

beforeEach(() => {
  getJobs = jest.fn(async () => {
    return [];
  });
  getQueue = jest.spyOn(Queue, "getQueue").mockReturnValue({
    getJobs,
  } as unknown as ReturnType<typeof Queue.getQueue>);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TelemetryIngestBacklog.getOldestWaitingSince", () => {
  test("reads the oldest waiting job of the Telemetry queue, oldest first, one job only", async () => {
    getJobs.mockResolvedValue([job({ timestamp: 1_791_588_000_000 })]);

    expect(await TelemetryIngestBacklog.getOldestWaitingSince()).toEqual(
      new Date(1_791_588_000_000),
    );
    expect(getQueue).toHaveBeenCalledWith(QueueName.Telemetry);
    expect(getJobs).toHaveBeenCalledWith(["wait"], 0, 0, true);
  });

  test("nothing waiting means nothing behind", async () => {
    expect(await TelemetryIngestBacklog.getOldestWaitingSince()).toBeNull();
  });

  test("without a queue connection it says nothing and asks nothing", async () => {
    jest.spyOn(Redis, "isConnected").mockReturnValue(false);

    expect(await TelemetryIngestBacklog.getOldestWaitingSince()).toBeNull();
    expect(getQueue).not.toHaveBeenCalled();
  });
});

describe("TelemetryIngestBacklog.getAddedAt", () => {
  test("a waiting job is as old as when it was added", () => {
    expect(
      TelemetryIngestBacklog.getAddedAt(job({ timestamp: 1_791_588_000_000 })),
    ).toEqual(new Date(1_791_588_000_000));
    expect(
      TelemetryIngestBacklog.getAddedAt(job({ timestamp: "1791588000000" })),
    ).toEqual(new Date(1_791_588_000_000));
  });

  test("a retried job keeps its first add time, so it says nothing about the queue", () => {
    expect(
      TelemetryIngestBacklog.getAddedAt(
        job({ timestamp: 1_791_588_000_000, attemptsMade: 1 }),
      ),
    ).toBeNull();
  });

  test("no job, or one without a usable time, says nothing", () => {
    expect(TelemetryIngestBacklog.getAddedAt(undefined)).toBeNull();
    expect(TelemetryIngestBacklog.getAddedAt(null)).toBeNull();
    expect(TelemetryIngestBacklog.getAddedAt(job({}))).toBeNull();
    expect(
      TelemetryIngestBacklog.getAddedAt(job({ timestamp: "soon" })),
    ).toBeNull();
    expect(TelemetryIngestBacklog.getAddedAt(job({ timestamp: 0 }))).toBeNull();
  });
});

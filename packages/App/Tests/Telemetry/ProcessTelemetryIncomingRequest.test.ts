import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The telemetry worker's Incoming Request cases.
 *
 * A job that carries its request (coalescing off, or queued by an earlier
 * release) goes to processIncomingRequestJobFromQueue, the entry point that
 * evaluates an earlier release's coalesced monitor's NEWEST request from
 * IncomingRequestLatestPayloadStore. Calling processIncomingRequestFromQueue
 * here instead would quietly bring back the bug it fixes: the job BullMQ
 * keeps for a waiting monitor would evaluate the request that created it, and
 * the newer ones coalescing discarded would never be evaluated.
 *
 * A monitor's job for its waiting requests (#10582) goes to
 * processPendingIncomingRequestsFromQueue, told whether this run is the job's
 * last attempt: on a failure in it, the entry point queues the monitor's next
 * job itself, so the requests still waiting are never left without one.
 *
 * Same harness as ProcessTelemetryBodyLifecycle.test.ts: the worker handler
 * is captured by mocking QueueWorker.getWorker.
 */

let capturedHandler: ((job: unknown) => Promise<void>) | null = null;

jest.mock("Common/Server/Infrastructure/QueueWorker", () => {
  return {
    __esModule: true,
    default: {
      getWorker: (
        _name: unknown,
        handler: (job: unknown) => Promise<void>,
      ): void => {
        capturedHandler = handler;
      },
    },
  };
});

const processIncomingRequestJobFromQueue: jest.Mock = jest.fn();
const processIncomingRequestFromQueue: jest.Mock = jest.fn();
const processPendingIncomingRequestsFromQueue: jest.Mock = jest.fn();

jest.mock(
  "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest",
  () => {
    return {
      __esModule: true,
      processIncomingRequestJobFromQueue,
      processIncomingRequestFromQueue,
      processPendingIncomingRequestsFromQueue,
    };
  },
);

jest.mock(
  "isolated-vm",
  () => {
    const Isolate: jest.Mock = jest.fn();
    const Reference: jest.Mock = jest.fn();
    const Callback: jest.Mock = jest.fn();
    const ExternalCopy: jest.Mock = jest
      .fn()
      .mockImplementation((value: unknown) => {
        return {
          copyInto: jest.fn(() => {
            return value;
          }),
        };
      });

    return {
      __esModule: true,
      default: {
        Isolate,
        Reference,
        Callback,
        ExternalCopy,
      },
      Isolate,
      Reference,
      Callback,
      ExternalCopy,
    };
  },
  { virtual: true },
);

// Importing the module registers the worker via the mocked QueueWorker.
import {
  describeUnknownTelemetryJob,
  isFinalAttemptOf,
} from "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import { IncomingRequestIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";

const INCOMING_REQUEST: IncomingRequestIngestJobData = {
  secretKey: "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee",
  requestHeaders: { "content-type": "application/json" },
  requestBody: { status: "resolved" },
  requestMethod: "POST",
  ingestionTimestamp: "2026-10-05T12:19:00.000Z" as unknown as Date,
  coalescedPayloadId: "11111111-1111-4111-8111-111111111111",
};

function incomingRequestJob(): unknown {
  return {
    id: "incoming-request-1",
    name: "ProcessTelemetry",
    data: {
      type: "incoming-request-ingest",
      ingestionTimestamp: "2026-10-05T12:19:00.000Z",
      incomingRequestIngest: INCOMING_REQUEST,
    },
  };
}

describe("ProcessTelemetry worker — Incoming Request jobs", () => {
  beforeEach(() => {
    processIncomingRequestJobFromQueue.mockReset();
    processIncomingRequestFromQueue.mockReset();
    processPendingIncomingRequestsFromQueue.mockReset();
  });

  test("the worker handler was registered/captured", () => {
    expect(typeof capturedHandler).toBe("function");
  });

  test("hands the job to the entry point that evaluates the monitor's newest request", async () => {
    processIncomingRequestJobFromQueue.mockResolvedValueOnce(undefined);

    await capturedHandler!(incomingRequestJob());

    expect(processIncomingRequestJobFromQueue).toHaveBeenCalledTimes(1);
    expect(processIncomingRequestJobFromQueue).toHaveBeenCalledWith(
      INCOMING_REQUEST,
    );
    expect(processIncomingRequestFromQueue).not.toHaveBeenCalled();
  });

  /*
   * The entry point clears the monitor's stored request for these and passes
   * the error on; the worker then completes the job, as it always has.
   */
  test.each([
    ExceptionMessages.MonitorNotFound,
    ExceptionMessages.MonitorDisabled,
    ExceptionMessages.MonitorArchived,
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
    ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
  ])(
    "completes the job when the monitor fails with '%s'",
    async (message: string) => {
      processIncomingRequestJobFromQueue.mockRejectedValueOnce(
        new BadDataException(message),
      );

      await expect(
        capturedHandler!(incomingRequestJob()),
      ).resolves.toBeUndefined();
    },
  );

  /*
   * Anything else fails the job so BullMQ retries it; the entry point left
   * the request stored for the retry.
   */
  test("fails the job on any other error, so it is retried", async () => {
    processIncomingRequestJobFromQueue.mockRejectedValueOnce(
      new Error("Acquire mutex timeout"),
    );

    await expect(capturedHandler!(incomingRequestJob())).rejects.toThrow(
      "Acquire mutex timeout",
    );
  });
});

function pendingJob(attempts: {
  attemptsMade: number;
  attempts: number;
}): unknown {
  return {
    id: "incoming-request-pending-1",
    name: "ProcessTelemetry",
    attemptsMade: attempts.attemptsMade,
    opts: { attempts: attempts.attempts },
    data: {
      type: "incoming-request-pending",
      ingestionTimestamp: "2026-11-21T09:00:00.000Z",
      incomingRequestPending: { secretKeyHash: "abc123" },
    },
  };
}

describe("ProcessTelemetry worker — a monitor's waiting Incoming Requests", () => {
  beforeEach(() => {
    processIncomingRequestJobFromQueue.mockReset();
    processPendingIncomingRequestsFromQueue.mockReset();
  });

  test("is a kind of job this release knows, so it is never handed back", () => {
    expect(
      describeUnknownTelemetryJob({
        type: "incoming-request-pending",
        ingestionTimestamp: new Date(),
        incomingRequestPending: { secretKeyHash: "abc123" },
      } as never),
    ).toBeNull();
  });

  test("hands the job to the entry point that works through the monitor's waiting requests", async () => {
    processPendingIncomingRequestsFromQueue.mockResolvedValueOnce(undefined);

    await capturedHandler!(pendingJob({ attemptsMade: 0, attempts: 3 }));

    expect(processPendingIncomingRequestsFromQueue).toHaveBeenCalledTimes(1);
    expect(processPendingIncomingRequestsFromQueue).toHaveBeenCalledWith(
      { secretKeyHash: "abc123" },
      { isFinalAttempt: false },
    );
    expect(processIncomingRequestJobFromQueue).not.toHaveBeenCalled();
  });

  test("tells it when this run is the job's last attempt", async () => {
    await capturedHandler!(pendingJob({ attemptsMade: 2, attempts: 3 }));

    expect(processPendingIncomingRequestsFromQueue).toHaveBeenCalledWith(
      { secretKeyHash: "abc123" },
      { isFinalAttempt: true },
    );
  });

  test("completes the job when the monitor refuses its requests", async () => {
    processPendingIncomingRequestsFromQueue.mockRejectedValueOnce(
      new BadDataException(ExceptionMessages.MonitorNotFound),
    );

    await expect(
      capturedHandler!(pendingJob({ attemptsMade: 0, attempts: 3 })),
    ).resolves.toBeUndefined();
  });

  test("fails the job on any other error, so BullMQ retries it after a backoff", async () => {
    processPendingIncomingRequestsFromQueue.mockRejectedValueOnce(
      new Error("Acquire mutex timeout"),
    );

    await expect(
      capturedHandler!(pendingJob({ attemptsMade: 0, attempts: 3 })),
    ).rejects.toThrow("Acquire mutex timeout");
  });
});

describe("isFinalAttemptOf", () => {
  function job(attemptsMade: unknown, attempts: unknown): QueueJob {
    return { attemptsMade, opts: { attempts } } as unknown as QueueJob;
  }

  test.each([
    [0, 3, false],
    [1, 3, false],
    [2, 3, true],
    // One attempt only: the first run is the last.
    [0, 1, true],
    [0, undefined, true],
    // A count past the attempts (a stall recovered) is still the last.
    [5, 3, true],
    [undefined, 3, false],
  ])(
    "attemptsMade %p of %p attempts: last %p",
    (attemptsMade: unknown, attempts: unknown, expected: boolean) => {
      expect(isFinalAttemptOf(job(attemptsMade, attempts))).toBe(expected);
    },
  );
});

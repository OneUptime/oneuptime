import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The telemetry worker's Incoming Request case.
 *
 * It must hand the job to processIncomingRequestJobFromQueue, the entry point
 * that evaluates a coalesced monitor's NEWEST request from
 * IncomingRequestLatestPayloadStore. Calling processIncomingRequestFromQueue
 * here instead would quietly bring back the bug it fixes: the job BullMQ keeps
 * for a waiting monitor would evaluate the request that created it, and the
 * newer ones coalescing discarded would never be evaluated.
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

jest.mock(
  "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest",
  () => {
    return {
      __esModule: true,
      processIncomingRequestJobFromQueue,
      processIncomingRequestFromQueue,
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
import "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";
import { IncomingRequestIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { isNonActionableIngestError } from "../../FeatureSet/Telemetry/Utils/NonActionableIngestError";
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

describe("isNonActionableIngestError", () => {
  test.each([
    ExceptionMessages.MonitorNotFound,
    ExceptionMessages.MonitorDisabled,
    ExceptionMessages.MonitorArchived,
  ])("is true for a BadDataException '%s'", (message: string) => {
    expect(isNonActionableIngestError(new BadDataException(message))).toBe(
      true,
    );
  });

  test("is false for any other BadDataException", () => {
    expect(
      isNonActionableIngestError(new BadDataException("Invalid Secret Key")),
    ).toBe(false);
  });

  test("is false for another kind of error with the same message", () => {
    expect(
      isNonActionableIngestError(new Error(ExceptionMessages.MonitorNotFound)),
    ).toBe(false);
  });

  test.each([undefined, null, ExceptionMessages.MonitorNotFound, {}])(
    "is false for %p, which is not an error",
    (value: unknown) => {
      expect(isNonActionableIngestError(value)).toBe(false);
    },
  );
});

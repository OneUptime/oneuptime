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
import {
  PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
  REPORTING_PROBE_NOT_KNOWN_MESSAGE,
} from "Common/Server/Utils/Probe/ProbeReportIdentity";

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

describe("isNonActionableIngestError", () => {
  /*
   * An unknown monitor, every refusal MonitorResource gives for a monitor
   * that is not being monitored: archived, disabled, or paused while a
   * manually created incident is unresolved or a maintenance event it is
   * attached to has not ended - and a probe's result for a monitor that probe
   * does not check (issue #8161), which every retry is refused the same way;
   * and a probe's result that names another probe, or a job that names no
   * probe (issue #8424), which no retry changes either.
   */
  test.each([
    ExceptionMessages.MonitorNotFound,
    ExceptionMessages.MonitorDisabled,
    ExceptionMessages.MonitorArchived,
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
    ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
    ExceptionMessages.ProbeNotAssignedToMonitor,
    PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
    REPORTING_PROBE_NOT_KNOWN_MESSAGE,
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

  test.each([
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
    ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
    ExceptionMessages.ProbeNotAssignedToMonitor,
    PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
    REPORTING_PROBE_NOT_KNOWN_MESSAGE,
  ])(
    "is false for another kind of error with a paused monitor's refusal '%s'",
    (message: string) => {
      expect(isNonActionableIngestError(new Error(message))).toBe(false);
    },
  );

  /*
   * The refusals are matched exactly, so a failure that only reads like one
   * - another "Monitor is disabled because ..." - is still retried.
   */
  test.each([
    "Monitor is disabled because",
    `${ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent} `,
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident.toLowerCase(),
    "Monitor does not have a projectId",
    // Only the refusals ProbeReportIdentity gives, word for word.
    "A probe reports only its own results",
    "A probe can only report its own results.",
    `${PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE} `,
    PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE.toLowerCase(),
    "This probe result does not say which probe sent it",
    REPORTING_PROBE_NOT_KNOWN_MESSAGE.toUpperCase(),
    // Other refusals of a probe's report are still retried.
    "Probe ID not found on SNMP trap request",
    "This monitor test was not handed to this probe, or no longer exists.",
    `${ExceptionMessages.ProbeNotAssignedToMonitor}.`,
    ExceptionMessages.ProbeNotAssignedToMonitor.toUpperCase(),
  ])(
    "is false for a BadDataException that is not one of them: '%s'",
    (message: string) => {
      expect(isNonActionableIngestError(new BadDataException(message))).toBe(
        false,
      );
    },
  );

  test.each([undefined, null, ExceptionMessages.MonitorNotFound, {}])(
    "is false for %p, which is not an error",
    (value: unknown) => {
      expect(isNonActionableIngestError(value)).toBe(false);
    },
  );
});

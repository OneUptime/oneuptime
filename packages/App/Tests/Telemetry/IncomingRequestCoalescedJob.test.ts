/*
 * Which request a coalesced Incoming Request job evaluates.
 *
 * Same-monitor ingest jobs are coalesced with BullMQ deduplication, which
 * discards a request that arrives while the monitor's job is still WAITING
 * and runs the older waiting job instead. On 2026-10-05 (an ~11 minute
 * Telemetry backlog) that meant the request evaluated on each trip through
 * the queue was the FIRST one after the previous job, not the newest - and
 * for a payload-driven monitor an Alertmanager "resolved" notification
 * queued behind a waiting "firing" one was never evaluated at all.
 *
 * The endpoint now stores every request as its monitor's newest in
 * IncomingRequestLatestPayloadStore before queueing it, and a coalesced job
 * (one carrying coalescedPayloadId) evaluates what the store holds when the
 * job runs, then clears it if nothing newer replaced it meanwhile.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore", () => {
  type ActualStore = {
    default: { getReceivedAtAsOf: (receivedAt: Date, checkedAt: Date) => Date };
  };

  const actual: ActualStore = jest.requireActual(
    "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore",
  ) as ActualStore;

  return {
    __esModule: true,
    default: {
      track: jest.fn(),
      getReceivedAtAsOf: actual.default.getReceivedAtAsOf,
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Utils/IncomingRequestLatestPayloadStore",
  () => {
    return {
      __esModule: true,
      default: {
        getLatest: jest.fn(),
        clearIfUnchanged: jest.fn(),
      },
    };
  },
);

import {
  processIncomingRequestJobFromQueue,
  processIncomingRequestFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import { IncomingRequestIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import IncomingRequestLatestPayloadStore, {
  LatestIncomingRequestPayload,
} from "../../FeatureSet/Telemetry/Utils/IncomingRequestLatestPayloadStore";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorService from "Common/Server/Services/MonitorService";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SECRET_KEY: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const MONITOR_ID: string = "9f14e45f-ceea-467a-9575-1b0d0d3e7a9c";
const PROJECT_ID: string = "4c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19";

const NOW: Date = new Date("2026-10-05T12:30:00.000Z");

// The request that created the job: the first one after the previous job.
const OWN_ID: string = "11111111-1111-4111-8111-111111111111";
const OWN_ARRIVAL: Date = new Date("2026-10-05T12:19:00.000Z");

// The newest request: it arrived while the job waited, and got no job.
const NEWEST_ID: string = "22222222-2222-4222-8222-222222222222";
const NEWEST_ARRIVAL: Date = new Date("2026-10-05T12:27:30.000Z");

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;
const trackMock: jest.Mock =
  IncomingRequestReceivedAtStore.track as unknown as jest.Mock;
const getLatest: jest.Mock =
  IncomingRequestLatestPayloadStore.getLatest as unknown as jest.Mock;
const clearIfUnchanged: jest.Mock =
  IncomingRequestLatestPayloadStore.clearIfUnchanged as unknown as jest.Mock;

function activeMonitor(): Monitor {
  const row: Monitor = new Monitor();
  row._id = MONITOR_ID;
  row.projectId = new ObjectID(PROJECT_ID);
  row.isArchived = false;
  row.disableActiveMonitoring = false;
  row.disableActiveMonitoringBecauseOfManualIncident = false;
  row.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
  return row;
}

function alertmanager(status: "firing" | "resolved"): JSONObject {
  return {
    status: status,
    alerts: [{ status: status, fingerprint: "c0ffee", labels: {} }],
  };
}

/*
 * As BullMQ and the store hand them back: JSON, so the arrival time is an
 * ISO string.
 */
function requestJob(
  overrides: Partial<IncomingRequestIngestJobData> = {},
): IncomingRequestIngestJobData {
  return {
    secretKey: SECRET_KEY,
    requestHeaders: { "x-request": "own" },
    requestBody: alertmanager("firing"),
    requestMethod: "POST",
    ingestionTimestamp: OWN_ARRIVAL.toISOString() as unknown as Date,
    coalescedPayloadId: OWN_ID,
    ...overrides,
  };
}

function stored(
  payloadId: string,
  payload: IncomingRequestIngestJobData,
): LatestIncomingRequestPayload {
  return { payloadId: payloadId, payload: payload };
}

function newestRequest(): IncomingRequestIngestJobData {
  return requestJob({
    requestHeaders: { "x-request": "newest" },
    requestBody: alertmanager("resolved"),
    requestMethod: "GET",
    ingestionTimestamp: NEWEST_ARRIVAL.toISOString() as unknown as Date,
    coalescedPayloadId: NEWEST_ID,
  });
}

function evaluatedRequests(): Array<IncomingMonitorRequest> {
  return monitorResource.mock.calls.map((call: Array<unknown>) => {
    return call[0] as IncomingMonitorRequest;
  });
}

describe("processIncomingRequestJobFromQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    findOneBy.mockResolvedValue(activeMonitor() as never);

    trackMock.mockImplementation(((input: { receivedAt: Date }) => {
      return Promise.resolve(new Date(input.receivedAt));
    }) as never);

    getLatest.mockResolvedValue(null as never);
    clearIfUnchanged.mockResolvedValue(true as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a coalesced job", () => {
    /*
     * The production case: the job was created by the first request after
     * the previous job, and a newer one arrived while it waited.
     */
    test("evaluates the monitor's newest request, not the one that created the job", async () => {
      getLatest.mockResolvedValue(stored(NEWEST_ID, newestRequest()) as never);

      await processIncomingRequestJobFromQueue(requestJob());

      expect(getLatest).toHaveBeenCalledTimes(1);
      expect(getLatest).toHaveBeenCalledWith(SECRET_KEY);

      const evaluated: Array<IncomingMonitorRequest> = evaluatedRequests();
      expect(evaluated).toHaveLength(1);
      expect(evaluated[0]!.requestBody).toEqual(alertmanager("resolved"));
      expect(evaluated[0]!.requestHeaders).toEqual({ "x-request": "newest" });
      expect(evaluated[0]!.requestMethod).toBe(HTTPMethod.GET);
      expect(evaluated[0]!.monitorId.toString()).toBe(MONITOR_ID);
    });

    test("records the newest request's arrival, not the job's", async () => {
      getLatest.mockResolvedValue(stored(NEWEST_ID, newestRequest()) as never);

      await processIncomingRequestJobFromQueue(requestJob());

      const input: { secretKey: string; receivedAt: Date } = trackMock.mock
        .calls[0]![0] as { secretKey: string; receivedAt: Date };
      expect(input.secretKey).toBe(SECRET_KEY);
      expect(input.receivedAt.getTime()).toBe(NEWEST_ARRIVAL.getTime());

      expect(evaluatedRequests()[0]!.incomingRequestReceivedAt.getTime()).toBe(
        NEWEST_ARRIVAL.getTime(),
      );
    });

    test("clears the request it evaluated, by that request's id", async () => {
      getLatest.mockResolvedValue(stored(NEWEST_ID, newestRequest()) as never);

      await processIncomingRequestJobFromQueue(requestJob());

      expect(clearIfUnchanged).toHaveBeenCalledTimes(1);
      expect(clearIfUnchanged).toHaveBeenCalledWith({
        secretKey: SECRET_KEY,
        payloadId: NEWEST_ID,
      });
    });

    /*
     * The clear happens after the evaluation: if the worker died mid-way,
     * the request would still be stored for the job's next attempt.
     */
    test("clears only after the evaluation has finished", async () => {
      getLatest.mockResolvedValue(stored(NEWEST_ID, newestRequest()) as never);

      await processIncomingRequestJobFromQueue(requestJob());

      expect(clearIfUnchanged.mock.invocationCallOrder[0]!).toBeGreaterThan(
        monitorResource.mock.invocationCallOrder[0]!,
      );
    });

    test("evaluates its own request when nothing newer arrived", async () => {
      getLatest.mockResolvedValue(stored(OWN_ID, requestJob()) as never);

      await processIncomingRequestJobFromQueue(requestJob());

      const evaluated: Array<IncomingMonitorRequest> = evaluatedRequests();
      expect(evaluated).toHaveLength(1);
      expect(evaluated[0]!.requestBody).toEqual(alertmanager("firing"));
      expect(clearIfUnchanged).toHaveBeenCalledWith({
        secretKey: SECRET_KEY,
        payloadId: OWN_ID,
      });
    });

    /*
     * Nothing stored means an earlier job evaluated a request at least as
     * new as this one: the job BullMQ queued after an active one that had
     * already read the newest request, for instance. Evaluating this job's
     * own (older) copy would take the monitor back in time - a "firing"
     * re-opening an incident a later "resolved" had closed.
     */
    test("evaluates nothing when the monitor's newest request was already evaluated", async () => {
      getLatest.mockResolvedValue(null as never);

      await expect(
        processIncomingRequestJobFromQueue(requestJob()),
      ).resolves.toBeUndefined();

      expect(findOneBy).not.toHaveBeenCalled();
      expect(trackMock).not.toHaveBeenCalled();
      expect(monitorResource).not.toHaveBeenCalled();
      expect(clearIfUnchanged).not.toHaveBeenCalled();
    });

    /*
     * The job must fail so BullMQ retries it. Completing it would leave the
     * stored request unevaluated with no job left to evaluate it.
     */
    test("fails, evaluating nothing, when the store cannot be read", async () => {
      getLatest.mockRejectedValue(new Error("Redis not connected") as never);

      await expect(
        processIncomingRequestJobFromQueue(requestJob()),
      ).rejects.toThrow("Redis not connected");

      expect(monitorResource).not.toHaveBeenCalled();
      expect(clearIfUnchanged).not.toHaveBeenCalled();
    });

    /*
     * A transient failure is retried by BullMQ. The request stays stored so
     * the retry evaluates it - or anything that arrived since.
     */
    test("keeps the request stored when the evaluation fails and will be retried", async () => {
      getLatest.mockResolvedValue(stored(NEWEST_ID, newestRequest()) as never);
      monitorResource.mockRejectedValueOnce(
        new Error("Acquire mutex timeout") as never,
      );

      await expect(
        processIncomingRequestJobFromQueue(requestJob()),
      ).rejects.toThrow("Acquire mutex timeout");

      expect(clearIfUnchanged).not.toHaveBeenCalled();
    });

    test("a retry evaluates whatever is newest by then", async () => {
      const newer: IncomingRequestIngestJobData = requestJob({
        requestBody: alertmanager("firing"),
        coalescedPayloadId: "33333333-3333-4333-8333-333333333333",
      });

      getLatest
        .mockResolvedValueOnce(stored(NEWEST_ID, newestRequest()) as never)
        .mockResolvedValueOnce(
          stored("33333333-3333-4333-8333-333333333333", newer) as never,
        );
      monitorResource.mockRejectedValueOnce(new Error("transient") as never);

      await expect(
        processIncomingRequestJobFromQueue(requestJob()),
      ).rejects.toThrow("transient");
      await processIncomingRequestJobFromQueue(requestJob());

      expect(monitorResource).toHaveBeenCalledTimes(2);
      expect(clearIfUnchanged).toHaveBeenCalledTimes(1);
      expect(clearIfUnchanged).toHaveBeenCalledWith({
        secretKey: SECRET_KEY,
        payloadId: "33333333-3333-4333-8333-333333333333",
      });
    });

    /*
     * An unknown, disabled or archived monitor fails in a way the telemetry
     * worker completes the job on. That is final, so the request is cleared,
     * and the error still reaches the worker so it is handled as before.
     */
    test.each([
      ExceptionMessages.MonitorNotFound,
      ExceptionMessages.MonitorDisabled,
      ExceptionMessages.MonitorArchived,
    ])(
      "clears the request and passes the error on when the monitor fails with '%s'",
      async (message: string) => {
        getLatest.mockResolvedValue(
          stored(NEWEST_ID, newestRequest()) as never,
        );
        monitorResource.mockRejectedValueOnce(
          new BadDataException(message) as never,
        );

        await expect(
          processIncomingRequestJobFromQueue(requestJob()),
        ).rejects.toThrow(message);

        expect(clearIfUnchanged).toHaveBeenCalledWith({
          secretKey: SECRET_KEY,
          payloadId: NEWEST_ID,
        });
      },
    );

    test("clears the request of a secret key that matches no monitor", async () => {
      findOneBy.mockResolvedValue(null as never);
      getLatest.mockResolvedValue(stored(NEWEST_ID, newestRequest()) as never);

      await expect(
        processIncomingRequestJobFromQueue(requestJob()),
      ).rejects.toThrow(ExceptionMessages.MonitorNotFound);

      expect(monitorResource).not.toHaveBeenCalled();
      expect(clearIfUnchanged).toHaveBeenCalledWith({
        secretKey: SECRET_KEY,
        payloadId: NEWEST_ID,
      });
    });

    test("keeps the request on any other bad-data failure, which is retried", async () => {
      getLatest.mockResolvedValue(stored(NEWEST_ID, newestRequest()) as never);
      monitorResource.mockRejectedValueOnce(
        new BadDataException("Something else") as never,
      );

      await expect(
        processIncomingRequestJobFromQueue(requestJob()),
      ).rejects.toThrow("Something else");

      expect(clearIfUnchanged).not.toHaveBeenCalled();
    });

    test("clears the request of a paused monitor, which is skipped", async () => {
      const paused: Monitor = activeMonitor();
      paused.disableActiveMonitoring = true;
      findOneBy.mockResolvedValue(paused as never);
      getLatest.mockResolvedValue(stored(NEWEST_ID, newestRequest()) as never);

      await processIncomingRequestJobFromQueue(requestJob());

      expect(monitorResource).not.toHaveBeenCalled();
      expect(clearIfUnchanged).toHaveBeenCalledWith({
        secretKey: SECRET_KEY,
        payloadId: NEWEST_ID,
      });
    });

    /*
     * The stored request goes through the same ingest boundary as a job's
     * own copy: the monitor's key is redacted before anything is persisted.
     */
    test("redacts the monitor's secret key from the stored request too", async () => {
      getLatest.mockResolvedValue(
        stored(
          NEWEST_ID,
          requestJob({
            requestHeaders: {
              "x-original-uri": `/incoming-request/${SECRET_KEY}`,
            },
            requestBody: {
              url: `https://oneuptime.com/heartbeat/${SECRET_KEY}`,
            },
            coalescedPayloadId: NEWEST_ID,
          }),
        ) as never,
      );

      await processIncomingRequestJobFromQueue(requestJob());

      const evaluated: IncomingMonitorRequest = evaluatedRequests()[0]!;
      expect(JSON.stringify(evaluated.requestHeaders)).not.toContain(
        SECRET_KEY,
      );
      expect(JSON.stringify(evaluated.requestBody)).not.toContain(SECRET_KEY);
    });
  });

  /*
   * Jobs without the marker were queued with coalescing switched off, or by
   * an API pod that predates the store. They evaluate their own request,
   * exactly as before, and never touch the store - with coalescing off, a
   * stored request is older than the job's own.
   */
  describe("a job that was not coalesced", () => {
    test("evaluates its own request and never touches the store", async () => {
      getLatest.mockResolvedValue(stored(NEWEST_ID, newestRequest()) as never);

      await processIncomingRequestJobFromQueue(
        requestJob({ coalescedPayloadId: undefined }),
      );

      expect(getLatest).not.toHaveBeenCalled();
      expect(clearIfUnchanged).not.toHaveBeenCalled();

      const evaluated: Array<IncomingMonitorRequest> = evaluatedRequests();
      expect(evaluated).toHaveLength(1);
      expect(evaluated[0]!.requestBody).toEqual(alertmanager("firing"));
      expect(evaluated[0]!.requestHeaders).toEqual({ "x-request": "own" });
    });

    test("is evaluated exactly as processIncomingRequestFromQueue evaluates it", async () => {
      const job: IncomingRequestIngestJobData = requestJob({
        coalescedPayloadId: undefined,
      });

      await processIncomingRequestJobFromQueue(job);
      await processIncomingRequestFromQueue(job);

      const [viaJob, direct]: Array<IncomingMonitorRequest> =
        evaluatedRequests();
      expect(viaJob).toEqual(direct);
    });

    test("passes its failures on untouched", async () => {
      monitorResource.mockRejectedValueOnce(new Error("transient") as never);

      await expect(
        processIncomingRequestJobFromQueue(
          requestJob({ coalescedPayloadId: undefined }),
        ),
      ).rejects.toThrow("transient");

      expect(clearIfUnchanged).not.toHaveBeenCalled();
    });
  });
});

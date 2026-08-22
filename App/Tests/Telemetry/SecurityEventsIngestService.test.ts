import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Unit coverage for the security-events ingest pipeline
 * (SecurityEventsIngestService). Regressions this suite pins:
 *
 * 1. Body-shape tolerance: extractEventsFromBody must keep accepting every
 *    shape clients actually send — a bare object (one event), a bare array
 *    (filtering non-object entries), and the { events / entries / logs:
 *    [...] } envelopes — and must keep rejecting empty / scalar bodies.
 *
 * 2. The HTTP handler contract: no projectId -> next(BadRequestException),
 *    an event-less body -> next(BadRequestException) with nothing sent or
 *    enqueued; a valid body is normalized to { events: [...] } (plus
 *    `format` only when ?format= names a dialect) so the queue worker has
 *    ONE canonical shape to read, the 200 is sent, and exactly one queue
 *    job is enqueued with the same request.
 *
 * 3. The queue worker: per-event dialect sniffing (UDM + OCSF events in
 *    one batch keep their own class uids), service attribution from the
 *    first event's productName unless the x-oneuptime-service-name header
 *    overrides it, rows stamped with projectId / primaryEntityId /
 *    retentionDate, an explicit `format` in the job body forcing every
 *    event through that normalizer (a UDM-shaped event forced "generic"
 *    keeps classUid 0), TELEMETRY_LOG_FLUSH_BATCH_SIZE-sized fan-in
 *    submissions, and a failed flush ack failing the job so BullMQ
 *    retries the payload.
 *
 * The fan-in writer and the Postgres-backed service resolution are
 * jest.spyOn'd (never spread-mocked — spreading a class module drops its
 * non-enumerable statics); the Queue infrastructure and Response modules
 * are replaced wholesale because they pull in BullMQ / bull-board and the
 * Express response machinery at import time.
 */

/*
 * The Queue module pulls in BullMQ / bull-board at import time (via
 * SecurityEventsQueueService -> TelemetryQueueService) — replace it
 * wholesale, same as TelemetryQueueService.test.ts. QueueName values
 * mirror the real enum so anything reading them stays meaningful.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * The HTTP handler must answer 200 through Response.sendEmptySuccessResponse;
 * the real module drags in the whole Express response stack, and the contract
 * under test is only "was the empty success sent for this req/res".
 */
jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

/*
 * Pin the flush batch size to 2 so the batching contract is testable with
 * tiny fixtures (3 events -> a 2-row submission + a 1-row force submission)
 * regardless of the TELEMETRY_LOG_FLUSH_BATCH_SIZE env on the CI box.
 */
jest.mock("../../FeatureSet/Telemetry/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Telemetry/Config",
  );
  return {
    __esModule: true,
    ...actual,
    TELEMETRY_LOG_FLUSH_BATCH_SIZE: 2,
  };
});

import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import SecurityEventsIngestService from "../../FeatureSet/Telemetry/Services/SecurityEventsIngestService";
import SecurityEventsQueueService from "../../FeatureSet/Telemetry/Services/Queue/SecurityEventsQueueService";

type MockedFn = jest.Mock;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const RETENTION_DAYS: number = 30;

/*
 * getCurrentDate is frozen to this instant in the queue-worker block so the
 * expected retentionDate string can be computed exactly (second-precision
 * ClickHouse datetimes would otherwise flake across a tick boundary).
 */
const FROZEN_NOW: Date = new Date();

/* An event time safely inside the accepted ingest window. */
const EVENT_TIME_ISO: string = new Date(
  FROZEN_NOW.getTime() - 60_000,
).toISOString();

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "Acme SIEM",
  primaryEntityId: SERVICE_ID,
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: RETENTION_DAYS,
  serviceRetentionConfig: null,
  serviceRetentionInDays: RETENTION_DAYS,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

/*
 * extractEventsFromBody is private static; reach it through a typed cast
 * (method call on the class keeps `this` bound for its recursion).
 */
function extractEvents(body: unknown): Array<JSONObject> {
  const service: {
    extractEventsFromBody: (body: unknown) => Array<JSONObject>;
  } = SecurityEventsIngestService as unknown as {
    extractEventsFromBody: (body: unknown) => Array<JSONObject>;
  };

  return service.extractEventsFromBody(body);
}

function makeIngestRequest(data: {
  projectId?: ObjectID;
  body: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}): ExpressRequest {
  return {
    ...(data.projectId ? { projectId: data.projectId } : {}),
    body: data.body,
    headers: data.headers || {},
    query: data.query || {},
  } as unknown as ExpressRequest;
}

function makeQueueRequest(
  body: JSONObject | null,
  headers: Record<string, string> = {},
): ExpressRequest {
  return {
    projectId: PROJECT_ID,
    body,
    headers,
    query: {},
  } as unknown as ExpressRequest;
}

/*
 * A Google SecOps UDM event: metadata.event_type USER_LOGIN maps to OCSF
 * class 3002 "Authentication" when the UDM normalizer handles it — and to
 * classUid 0 / "Base Event" when it is forced through the generic one.
 */
function udmEventFixture(): JSONObject {
  return {
    metadata: {
      event_type: "USER_LOGIN",
      event_timestamp: EVENT_TIME_ISO,
      id: "udm-evt-1",
      vendor_name: "Acme",
      product_name: "Acme SIEM",
    },
    principal: { user: { userid: "alice" }, ip: ["10.0.0.1"] },
    target: { hostname: "web-1" },
  };
}

/* A native OCSF Network Activity (class_uid 4001) event. */
function ocsfEventFixture(): JSONObject {
  return {
    class_uid: 4001,
    class_name: "Network Activity",
    severity_id: 3,
    time: EVENT_TIME_ISO,
    message: "Blocked outbound connection",
    metadata: { uid: "ocsf-evt-1", product: { name: "Edge FW" } },
    src_endpoint: { ip: "10.0.0.2" },
    dst_endpoint: { ip: "8.8.8.8", port: 53 },
  };
}

const getSendEmptySuccessMock: () => MockedFn = (): MockedFn => {
  return Response.sendEmptySuccessResponse as unknown as MockedFn;
};

const getSubmitMock: () => MockedFn = (): MockedFn => {
  return TelemetryFanInWriter.submit as unknown as MockedFn;
};

function getSubmittedRows(callIndex: number = 0): Array<JSONObject> {
  return getSubmitMock().mock.calls[callIndex]![1] as Array<JSONObject>;
}

describe("SecurityEventsIngestService.extractEventsFromBody — accepted body shapes", () => {
  test("a bare object is one event", () => {
    const event: JSONObject = { alert_name: "brute force" };

    const extracted: Array<JSONObject> = extractEvents(event);

    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toBe(event);
  });

  test("a bare array keeps only its object entries", () => {
    const event: JSONObject = { alert_name: "brute force" };

    const extracted: Array<JSONObject> = extractEvents([
      event,
      42,
      "not-an-event",
      null,
      ["nested", "array"],
    ]);

    expect(extracted).toEqual([event]);
  });

  test.each([["events"], ["entries"], ["logs"]])(
    "the { %s: [...] } envelope unwraps to its object entries",
    (key: string) => {
      const event: JSONObject = { alert_name: "brute force" };

      const extracted: Array<JSONObject> = extractEvents({
        [key]: [event, 5, "junk"],
      });

      expect(extracted).toEqual([event]);
    },
  );

  test("the events key wins over entries/logs when several envelopes are present", () => {
    const fromEvents: JSONObject = { source: "events" };
    const fromLogs: JSONObject = { source: "logs" };

    const extracted: Array<JSONObject> = extractEvents({
      logs: [fromLogs],
      events: [fromEvents],
    });

    expect(extracted).toEqual([fromEvents]);
  });

  test("an empty object holds no events", () => {
    expect(extractEvents({})).toEqual([]);
  });

  test("null / string / number bodies hold no events", () => {
    expect(extractEvents(null)).toEqual([]);
    expect(extractEvents(undefined)).toEqual([]);
    expect(extractEvents("just a string")).toEqual([]);
    expect(extractEvents(42)).toEqual([]);
  });
});

describe("SecurityEventsIngestService.ingestSecurityEvents — HTTP handler", () => {
  let addJobSpy: jest.SpyInstance;
  let nextMock: MockedFn;
  const res: ExpressResponse = {} as unknown as ExpressResponse;

  beforeEach(() => {
    jest.clearAllMocks();
    addJobSpy = jest
      .spyOn(SecurityEventsQueueService, "addSecurityEventsIngestJob")
      .mockResolvedValue(undefined);
    nextMock = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a request without projectId fails with BadRequestException before anything is sent or enqueued", async () => {
    const req: ExpressRequest = makeIngestRequest({
      body: { events: [{ alert_name: "x" }] },
    });

    await SecurityEventsIngestService.ingestSecurityEvents(
      req,
      res,
      nextMock as unknown as NextFunction,
    );

    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(nextMock.mock.calls[0]![0]).toBeInstanceOf(BadRequestException);
    expect(getSendEmptySuccessMock()).not.toHaveBeenCalled();
    expect(addJobSpy).not.toHaveBeenCalled();
  });

  test("a body with no events fails with BadRequestException before anything is sent or enqueued", async () => {
    const req: ExpressRequest = makeIngestRequest({
      projectId: PROJECT_ID,
      body: {},
    });

    await SecurityEventsIngestService.ingestSecurityEvents(
      req,
      res,
      nextMock as unknown as NextFunction,
    );

    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(nextMock.mock.calls[0]![0]).toBeInstanceOf(BadRequestException);
    expect((nextMock.mock.calls[0]![0] as BadRequestException).message).toMatch(
      /No security events found/,
    );
    expect(getSendEmptySuccessMock()).not.toHaveBeenCalled();
    expect(addJobSpy).not.toHaveBeenCalled();
  });

  test("a bare-object body is normalized to { events: [...] } with no format key, answered 200 and enqueued once", async () => {
    const event: JSONObject = { alert_name: "brute force" };
    const req: ExpressRequest = makeIngestRequest({
      projectId: PROJECT_ID,
      body: event,
    });

    await SecurityEventsIngestService.ingestSecurityEvents(
      req,
      res,
      nextMock as unknown as NextFunction,
    );

    expect(nextMock).not.toHaveBeenCalled();

    // The 200 went out for this exact req/res pair.
    expect(getSendEmptySuccessMock()).toHaveBeenCalledTimes(1);
    expect(getSendEmptySuccessMock()).toHaveBeenCalledWith(req, res);

    /*
     * The body the queue job will carry is the canonical envelope; no
     * format was requested, so no format key may appear (the worker
     * would otherwise force a dialect nobody named).
     */
    expect(req.body).toEqual({ events: [event] });
    expect(
      Object.prototype.hasOwnProperty.call(req.body as JSONObject, "format"),
    ).toBe(false);

    expect(addJobSpy).toHaveBeenCalledTimes(1);
    expect(addJobSpy).toHaveBeenCalledWith(req);
  });

  test("?format=udm survives into the normalized body so the worker forces that dialect", async () => {
    const event: JSONObject = { alert_name: "brute force" };
    const req: ExpressRequest = makeIngestRequest({
      projectId: PROJECT_ID,
      body: { logs: [event] },
      query: { format: "udm" },
    });

    await SecurityEventsIngestService.ingestSecurityEvents(
      req,
      res,
      nextMock as unknown as NextFunction,
    );

    expect(nextMock).not.toHaveBeenCalled();
    expect(getSendEmptySuccessMock()).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({ events: [event], format: "udm" });
    expect(addJobSpy).toHaveBeenCalledTimes(1);
    expect(addJobSpy).toHaveBeenCalledWith(req);
  });
});

describe("SecurityEventsIngestService.processSecurityEventsFromQueue — queue worker", () => {
  let serviceFromNameSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(FROZEN_NOW);

    serviceFromNameSpy = jest
      .spyOn(OTelIngestService, "telemetryServiceFromName")
      .mockResolvedValue(SERVICE_METADATA);

    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockResolvedValue({ flushed: Promise.resolve() });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a mixed UDM + OCSF batch is sniffed per event and lands as SecurityEvent rows with identity + retention stamped", async () => {
    await SecurityEventsIngestService.processSecurityEventsFromQueue(
      makeQueueRequest({ events: [udmEventFixture(), ocsfEventFixture()] }),
    );

    // Rows go through the fan-in writer for the SecurityEvent table.
    expect(getSubmitMock()).toHaveBeenCalledTimes(1);
    expect(getSubmitMock().mock.calls[0]![0]).toBe(SecurityEventService);

    const rows: Array<JSONObject> = getSubmittedRows();
    expect(rows).toHaveLength(2);

    // UDM USER_LOGIN -> OCSF Authentication (3002); OCSF passes through.
    expect(rows[0]!["classUid"]).toBe(3002);
    expect(rows[0]!["className"]).toBe("Authentication");
    expect(rows[0]!["eventUid"]).toBe("udm-evt-1");
    expect(rows[1]!["classUid"]).toBe(4001);
    expect(rows[1]!["className"]).toBe("Network Activity");
    expect(rows[1]!["eventUid"]).toBe("ocsf-evt-1");

    const expectedRetentionDate: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(FROZEN_NOW, RETENTION_DAYS),
    );

    for (const row of rows) {
      expect(row["projectId"]).toBe(PROJECT_ID.toString());
      expect(row["primaryEntityId"]).toBe(SERVICE_ID.toString());
      expect(row["retentionDate"]).toBe(expectedRetentionDate);
    }
  });

  test("service attribution uses the first event's productName when no service-name header is sent", async () => {
    await SecurityEventsIngestService.processSecurityEventsFromQueue(
      makeQueueRequest({ events: [udmEventFixture(), ocsfEventFixture()] }),
    );

    expect(serviceFromNameSpy).toHaveBeenCalledTimes(1);
    expect(serviceFromNameSpy).toHaveBeenCalledWith({
      serviceName: "Acme SIEM",
      projectId: PROJECT_ID,
    });
  });

  test("the x-oneuptime-service-name header wins over payload attribution", async () => {
    await SecurityEventsIngestService.processSecurityEventsFromQueue(
      makeQueueRequest(
        { events: [udmEventFixture()] },
        {
          "x-oneuptime-service-name": "edge-firewall",
        },
      ),
    );

    expect(serviceFromNameSpy).toHaveBeenCalledTimes(1);
    expect(serviceFromNameSpy).toHaveBeenCalledWith({
      serviceName: "edge-firewall",
      projectId: PROJECT_ID,
    });
  });

  test("an explicit format forces every event through that normalizer — a UDM-shaped event forced generic keeps classUid 0", async () => {
    await SecurityEventsIngestService.processSecurityEventsFromQueue(
      makeQueueRequest({ events: [udmEventFixture()], format: "generic" }),
    );

    expect(getSubmitMock()).toHaveBeenCalledTimes(1);

    const rows: Array<JSONObject> = getSubmittedRows();
    expect(rows).toHaveLength(1);

    /*
     * UDM sniffing would have produced classUid 3002 / "Authentication";
     * the forced generic normalizer must not look at metadata.event_type.
     */
    expect(rows[0]!["classUid"]).toBe(0);
    expect(rows[0]!["className"]).toBe("Base Event");
    expect(rows[0]!["className"]).not.toBe("Authentication");
  });

  test("rows flush in TELEMETRY_LOG_FLUSH_BATCH_SIZE batches: 3 events with batch size 2 make a 2-row and a 1-row submission", async () => {
    await SecurityEventsIngestService.processSecurityEventsFromQueue(
      makeQueueRequest({
        events: [{ message: "e1" }, { message: "e2" }, { message: "e3" }],
      }),
    );

    expect(getSubmitMock()).toHaveBeenCalledTimes(2);
    expect(getSubmittedRows(0)).toHaveLength(2);
    expect(getSubmittedRows(1)).toHaveLength(1);
    expect(getSubmittedRows(0)[0]!["message"]).toBe("e1");
    expect(getSubmittedRows(1)[0]!["message"]).toBe("e3");
  });

  test("a body without usable events processes to nothing — no service resolution, no submission", async () => {
    await SecurityEventsIngestService.processSecurityEventsFromQueue(
      makeQueueRequest({ events: [] }),
    );
    await SecurityEventsIngestService.processSecurityEventsFromQueue(
      makeQueueRequest({
        events: [42, "junk"] as unknown as Array<JSONObject>,
      }),
    );
    await SecurityEventsIngestService.processSecurityEventsFromQueue(
      makeQueueRequest(null),
    );

    expect(serviceFromNameSpy).not.toHaveBeenCalled();
    expect(getSubmitMock()).not.toHaveBeenCalled();
  });

  test("a failed ClickHouse flush ack fails the job so BullMQ retries the payload", async () => {
    /*
     * Pre-observe the rejection: the worker yields to the event loop before
     * pushObservedAck attaches its catch, and an unobserved rejection
     * crossing that macrotask boundary would fail the test as unhandled.
     * The failure is still delivered for real at the job's pendingAcks
     * await, wrapped by the service.
     */
    const flushFailure: Promise<void> = Promise.reject(
      new Error("clickhouse down"),
    );
    flushFailure.catch(() => {
      // Observed here; asserted below through the job's rejection.
    });

    getSubmitMock().mockResolvedValue({ flushed: flushFailure });

    await expect(
      SecurityEventsIngestService.processSecurityEventsFromQueue(
        makeQueueRequest({ events: [udmEventFixture(), ocsfEventFixture()] }),
      ),
    ).rejects.toThrow(
      /Failed to flush security events to ClickHouse: clickhouse down/,
    );
  });
});

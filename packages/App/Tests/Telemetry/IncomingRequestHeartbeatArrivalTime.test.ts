/*
 * An Incoming Request heartbeat is recorded at the time it ARRIVED at the
 * endpoint, not the time a Telemetry worker got to it.
 *
 * The endpoint answers 2xx and queues the request. The worker used to stamp
 * incomingRequestReceivedAt with its own clock, so the persisted heartbeat
 * trailed the real one by however far behind the queue was - and with
 * same-monitor coalescing, a request that arrived while the monitor's
 * previous job was still waiting was dropped outright. Under the 2026-10-05
 * backlog (~11 minutes) that read as "not received in 5 minutes" for every
 * heartbeat monitor on the platform.
 *
 * Now the job carries the endpoint's arrival time, the worker asks
 * IncomingRequestReceivedAtStore for the latest arrival the endpoint saw
 * (which covers requests coalescing dropped), and judges it as of now - the
 * same question the heartbeat cron asks, so the two cannot disagree and flap
 * the monitor.
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

/*
 * The arrival store is Redis-backed and covered by its own suite; here
 * track() answers whatever each test needs and the pure clamp is real.
 */
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

import {
  getReceivedAt,
  processIncomingRequestFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import { IncomingRequestIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import IncomingRequestCriteria from "Common/Server/Utils/Monitor/Criteria/IncomingRequestCriteria";
import MonitorService from "Common/Server/Services/MonitorService";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OneUptimeDate from "Common/Types/Date";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
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

// The worker's clock: the job is processed 11 minutes after it arrived.
const NOW: Date = new Date("2026-10-05T12:30:00.000Z");
const ARRIVED_AT: Date = new Date("2026-10-05T12:19:00.000Z");

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;
const trackMock: jest.Mock =
  IncomingRequestReceivedAtStore.track as unknown as jest.Mock;

const NOT_RECEIVED_IN_5_MINUTES: CriteriaFilter = {
  checkOn: CheckOn.IncomingRequest,
  filterType: FilterType.NotRecievedInMinutes,
  value: 5,
};

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

/*
 * As the worker sees a job: BullMQ hands back the JSON it stored, so the
 * Date the endpoint put on it arrives as an ISO string.
 */
function job(ingestionTimestamp: unknown): IncomingRequestIngestJobData {
  return {
    secretKey: SECRET_KEY,
    requestHeaders: { "user-agent": "curl/8.12.1" },
    requestBody: {},
    requestMethod: "POST",
    ingestionTimestamp: ingestionTimestamp as Date,
  };
}

function evaluatedRequest(): IncomingMonitorRequest {
  expect(monitorResource).toHaveBeenCalledTimes(1);
  return monitorResource.mock.calls[0]![0] as IncomingMonitorRequest;
}

describe("processIncomingRequestFromQueue records when the heartbeat arrived", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    findOneBy.mockResolvedValue(activeMonitor() as never);

    // Nothing newer than this job: the store hands the job's arrival back.
    trackMock.mockImplementation(((input: { receivedAt: Date }) => {
      return Promise.resolve(new Date(input.receivedAt));
    }) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks the store with the URL's secret key and the arrival time the job carries", async () => {
    await processIncomingRequestFromQueue(job(ARRIVED_AT.toISOString()));

    expect(trackMock).toHaveBeenCalledTimes(1);
    const input: { secretKey: string; receivedAt: Date } = trackMock.mock
      .calls[0]![0] as { secretKey: string; receivedAt: Date };

    expect(input.secretKey).toBe(SECRET_KEY);
    expect(input.receivedAt).toBeInstanceOf(Date);
    expect(input.receivedAt.getTime()).toBe(ARRIVED_AT.getTime());
  });

  /*
   * The backlog case with a live sender: this job arrived 11 minutes ago,
   * but the sender kept posting and the endpoint recorded a request 20
   * seconds ago (dropped from the queue by coalescing). That arrival is what
   * gets evaluated and persisted.
   */
  test("evaluates the latest arrival the endpoint saw, not this job's", async () => {
    const latestArrival: Date = new Date("2026-10-05T12:29:40.000Z");
    trackMock.mockResolvedValue(latestArrival as never);

    await processIncomingRequestFromQueue(job(ARRIVED_AT.toISOString()));

    const request: IncomingMonitorRequest = evaluatedRequest();

    expect(request.incomingRequestReceivedAt.getTime()).toBe(
      latestArrival.getTime(),
    );
    expect(request.checkedAt.getTime()).toBe(NOW.getTime());
    expect(request.onlyCheckForIncomingRequestReceivedAt).toBe(false);

    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: request,
        criteriaFilter: NOT_RECEIVED_IN_5_MINUTES,
      }),
    ).resolves.toBeNull();
  });

  /*
   * The dead-sender case: the request processed late really was the last
   * one. Judging it as of its arrival would briefly revive the monitor
   * (and the cron would flip it straight back); judged as of now, the ingest
   * path and the cron agree it is missing.
   */
  test("a late job from a sender that has since stopped does not revive the monitor", async () => {
    await processIncomingRequestFromQueue(job(ARRIVED_AT.toISOString()));

    const request: IncomingMonitorRequest = evaluatedRequest();

    expect(request.incomingRequestReceivedAt.getTime()).toBe(
      ARRIVED_AT.getTime(),
    );
    expect(request.checkedAt.getTime()).toBe(NOW.getTime());

    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: request,
        criteriaFilter: NOT_RECEIVED_IN_5_MINUTES,
      }),
    ).resolves.toBeTruthy();
  });

  test("an on-time job is evaluated as just received", async () => {
    const justNow: Date = new Date(NOW.getTime() - 150);

    await processIncomingRequestFromQueue(job(justNow.toISOString()));

    const request: IncomingMonitorRequest = evaluatedRequest();

    expect(request.incomingRequestReceivedAt.getTime()).toBe(justNow.getTime());
    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: request,
        criteriaFilter: NOT_RECEIVED_IN_5_MINUTES,
      }),
    ).resolves.toBeNull();
  });

  test("an arrival the store stamped after this check (pod clock skew) is clamped to the check", async () => {
    trackMock.mockResolvedValue(
      new Date(NOW.getTime() + 6 * 60 * 1000) as never,
    );

    await processIncomingRequestFromQueue(job(ARRIVED_AT.toISOString()));

    expect(evaluatedRequest().incomingRequestReceivedAt.getTime()).toBe(
      NOW.getTime(),
    );
  });

  test("a paused monitor never touches the store", async () => {
    const paused: Monitor = activeMonitor();
    paused.disableActiveMonitoring = true;
    findOneBy.mockResolvedValue(paused as never);

    await processIncomingRequestFromQueue(job(ARRIVED_AT.toISOString()));

    expect(trackMock).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  /*
   * The endpoint is unauthenticated: only a key that resolves to a monitor
   * may create an arrival marker, or a flood of made-up keys would fill
   * Redis.
   */
  test("a secret key that matches no monitor never registers an arrival", async () => {
    findOneBy.mockResolvedValue(null as never);

    await expect(
      processIncomingRequestFromQueue(job(ARRIVED_AT.toISOString())),
    ).rejects.toThrow(ExceptionMessages.MonitorNotFound);

    expect(trackMock).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });
});

describe("getReceivedAt", () => {
  beforeEach(() => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the ISO string a queued job carries", () => {
    expect(getReceivedAt(job(ARRIVED_AT.toISOString())).getTime()).toBe(
      ARRIVED_AT.getTime(),
    );
  });

  test("reads a Date (a job built in process)", () => {
    expect(getReceivedAt(job(new Date(ARRIVED_AT))).getTime()).toBe(
      ARRIVED_AT.getTime(),
    );
  });

  test("falls back to now when the job carries no arrival time", () => {
    expect(getReceivedAt(job(undefined)).getTime()).toBe(NOW.getTime());
  });

  test("falls back to now when the arrival time is unusable", () => {
    for (const value of ["not a date", "", 12345, {}, null]) {
      expect(getReceivedAt(job(value)).getTime()).toBe(NOW.getTime());
    }
  });

  test("clamps an arrival time in the future (pod clock skew) to now", () => {
    const future: Date = new Date(NOW.getTime() + 60 * 1000);

    expect(getReceivedAt(job(future.toISOString())).getTime()).toBe(
      NOW.getTime(),
    );
  });
});

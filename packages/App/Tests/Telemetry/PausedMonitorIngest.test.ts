/*
 * A monitor is attached to a maintenance event so that it is paused while the
 * work goes on, and a manually created incident pauses it until the incident
 * is resolved. A result can still reach it while it is paused: a probe's
 * check that was handed out or queued before the pause began, or an incoming
 * request whose job read the monitor just before. MonitorResource refuses
 * that result, as it refuses an archived or a disabled monitor's, and logs
 * why at debug level.
 *
 * Nobody can act on the refusal, so the telemetry worker must handle it as it
 * handles theirs (isNonActionableIngestError): complete the job, instead of
 * logging "Error processing telemetry job:" and having the queue retry a job
 * that is refused the same way each time, and clear a coalesced Incoming
 * Request job's stored request, instead of keeping it to be evaluated again.
 *
 * The path is the real one from the worker's handler down: the ingest job,
 * MonitorResource's refusal, and the job's and the worker's handling of it.
 * Stubbed are the monitor reads (MonitorService), the Redis-backed stores and
 * the per-monitor lock, and the criteria evaluator, which a refused result
 * never reaches. The worker's handler is captured by mocking
 * QueueWorker.getWorker, as the other ProcessTelemetry suites do.
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

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      // The Incoming Request job's own read of the monitor.
      findOneBy: jest.fn(),
      // MonitorResource's read, the one a result is refused on.
      findOneById: jest.fn(),
    },
  };
});

// The per-monitor lock lives in Redis. A refused result never takes it.
jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

// Judges a result against the monitor's criteria; a refused one never gets here.
jest.mock("Common/Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
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
import {
  IncomingRequestIngestJobData,
  ProbeIngestJobData,
  TelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import IncomingRequestLatestPayloadStore from "../../FeatureSet/Telemetry/Utils/IncomingRequestLatestPayloadStore";
import { isNonActionableIngestError } from "../../FeatureSet/Telemetry/Utils/NonActionableIngestError";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import MonitorPauseState, {
  MonitorPauseFlags,
  MonitorPauseReason,
} from "Common/Utils/Monitor/MonitorPauseState";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const MONITOR_ID: string = "6b1d3f5a-7c9e-4b2d-8f4a-1c3e5a7b9d01";
const PROJECT_ID: string = "2e4a6c8e-0b1d-4f3a-9c5e-7b9d1f3a5c02";
const PROBE_ID: string = "8f0b2d4f-6a1c-4e3b-9d5f-0a2c4e6b8d03";
const STEP_ID: string = "3c5e7a9b-1d2f-4a4c-8e6b-0d2f4a6c8e04";
const SECRET_KEY: string = "4a6c8e0b-2d1f-4a3c-8e5b-9d1f3a5c7e05";
const PAYLOAD_ID: string = "5b7d9f1a-3c2e-4b4d-9f6a-0e2a4c6e8a06";

const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;
const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const processMonitorStep: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;
const track: jest.Mock =
  IncomingRequestReceivedAtStore.track as unknown as jest.Mock;
const getLatest: jest.Mock =
  IncomingRequestLatestPayloadStore.getLatest as unknown as jest.Mock;
const clearIfUnchanged: jest.Mock =
  IncomingRequestLatestPayloadStore.clearIfUnchanged as unknown as jest.Mock;

// The flag each reason a monitor is not being monitored is stored in.
const FLAG_FOR_REASON: Record<MonitorPauseReason, keyof MonitorPauseFlags> = {
  [MonitorPauseReason.Archived]: "isArchived",
  [MonitorPauseReason.Disabled]: "disableActiveMonitoring",
  [MonitorPauseReason.ManualIncident]:
    "disableActiveMonitoringBecauseOfManualIncident",
  [MonitorPauseReason.ScheduledMaintenance]:
    "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
};

type Pause = {
  by: string;
  reason: MonitorPauseReason;
  refusal: string;
};

const PAUSES: Array<Pause> = [
  {
    by: "a maintenance event",
    reason: MonitorPauseReason.ScheduledMaintenance,
    refusal:
      ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
  },
  {
    by: "a manually created incident",
    reason: MonitorPauseReason.ManualIncident,
    refusal: ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
  },
];

function monitor(input: {
  monitorType: MonitorType;
  pausedBy?: MonitorPauseReason | undefined;
  withoutProject?: boolean | undefined;
}): Monitor {
  const row: Monitor = new Monitor();
  row._id = MONITOR_ID;

  if (!input.withoutProject) {
    row.projectId = new ObjectID(PROJECT_ID);
  }

  row.monitorType = input.monitorType;
  row.isArchived = false;
  row.disableActiveMonitoring = false;
  row.disableActiveMonitoringBecauseOfManualIncident = false;
  row.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;

  if (input.pausedBy) {
    row[FLAG_FOR_REASON[input.pausedBy]] = true;
  }

  return row;
}

// A probe's check result, as the probe put it on the wire.
function probeResult(): ProbeMonitorResponse {
  return {
    projectId: new ObjectID(PROJECT_ID),
    monitorId: new ObjectID(MONITOR_ID),
    monitorStepId: new ObjectID(STEP_ID),
    probeId: new ObjectID(PROBE_ID),
    isOnline: false,
    failureCause: "Connection refused",
    monitoredAt: new Date("2026-11-14T09:00:00.000Z"),
  } as unknown as ProbeMonitorResponse;
}

// The telemetry job the probe ingest route queues, as Redis hands it back.
function probeResultJob(): unknown {
  const probeIngest: ProbeIngestJobData = JSON.parse(
    JSON.stringify({
      jobType: "probe-response",
      ingestionTimestamp: new Date("2026-11-14T09:00:01.000Z"),
      probeMonitorResponse: {
        probeId: PROBE_ID,
        probeMonitorResponse: probeResult(),
      },
    }),
  ) as ProbeIngestJobData;

  return {
    id: "probe-ingest-1",
    name: "ProcessTelemetry",
    data: {
      type: TelemetryType.ProbeIngest,
      ingestionTimestamp: "2026-11-14T09:00:01.000Z",
      probeIngest: probeIngest,
    },
  };
}

const STORED_REQUEST: IncomingRequestIngestJobData = {
  secretKey: SECRET_KEY,
  requestHeaders: { "content-type": "application/json" },
  requestBody: { status: "ok" },
  requestMethod: "POST",
  ingestionTimestamp: "2026-11-14T09:00:00.000Z" as unknown as Date,
  coalescedPayloadId: PAYLOAD_ID,
};

// A coalesced Incoming Request job; the request it evaluates is the stored one.
function incomingRequestJob(): unknown {
  return {
    id: "incoming-request-1",
    name: "ProcessTelemetry",
    data: {
      type: TelemetryType.IncomingRequestIngest,
      ingestionTimestamp: "2026-11-14T09:00:00.000Z",
      incomingRequestIngest: STORED_REQUEST,
    },
  };
}

let debug: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();

  debug = jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
  error = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });

  track.mockImplementation(((input: { receivedAt: Date }) => {
    return Promise.resolve(new Date(input.receivedAt));
  }) as never);
  getLatest.mockResolvedValue({
    payloadId: PAYLOAD_ID,
    payload: STORED_REQUEST,
  } as never);
  clearIfUnchanged.mockResolvedValue(true as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("the worker handler was registered/captured", () => {
  expect(typeof capturedHandler).toBe("function");
});

describe.each(PAUSES)("a monitor paused by $by", (pause: Pause) => {
  test("a probe's check result for it completes the telemetry job, logs the refusal at debug level and evaluates nothing", async () => {
    findOneById.mockResolvedValue(
      monitor({
        monitorType: MonitorType.Website,
        pausedBy: pause.reason,
      }) as never,
    );

    await expect(capturedHandler!(probeResultJob())).resolves.toBeUndefined();

    // MonitorResource read the monitor, refused the result, and said why.
    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(`${MONITOR_ID} ${pause.refusal}`);
    expect(error).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(processMonitorStep).not.toHaveBeenCalled();
  });

  /*
   * The job reads the monitor and skips one that is paused; the pause can
   * begin between that read and MonitorResource's.
   */
  test("an incoming request for it, paused after the job read the monitor, completes the job and its stored request is cleared", async () => {
    findOneBy.mockResolvedValue(
      monitor({ monitorType: MonitorType.IncomingRequest }) as never,
    );
    findOneById.mockResolvedValue(
      monitor({
        monitorType: MonitorType.IncomingRequest,
        pausedBy: pause.reason,
      }) as never,
    );

    await expect(
      capturedHandler!(incomingRequestJob()),
    ).resolves.toBeUndefined();

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(clearIfUnchanged).toHaveBeenCalledTimes(1);
    expect(clearIfUnchanged).toHaveBeenCalledWith({
      secretKey: SECRET_KEY,
      payloadId: PAYLOAD_ID,
    });
    expect(debug).toHaveBeenCalledWith(`${MONITOR_ID} ${pause.refusal}`);
    expect(error).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(processMonitorStep).not.toHaveBeenCalled();
  });

  test("an incoming request for it, once it is paused, is skipped before MonitorResource and its stored request is cleared", async () => {
    findOneBy.mockResolvedValue(
      monitor({
        monitorType: MonitorType.IncomingRequest,
        pausedBy: pause.reason,
      }) as never,
    );

    await expect(
      capturedHandler!(incomingRequestJob()),
    ).resolves.toBeUndefined();

    expect(findOneById).not.toHaveBeenCalled();
    expect(clearIfUnchanged).toHaveBeenCalledWith({
      secretKey: SECRET_KEY,
      payloadId: PAYLOAD_ID,
    });
    expect(error).not.toHaveBeenCalled();
  });
});

/*
 * The same harness still fails a job on a refusal somebody has to act on, so
 * the queue retries it and the stored request is kept for that retry.
 */
describe("a monitor that is being monitored", () => {
  test("a refusal that is not about a pause still fails the job and keeps the stored request", async () => {
    findOneBy.mockResolvedValue(
      monitor({ monitorType: MonitorType.IncomingRequest }) as never,
    );

    findOneById.mockResolvedValue(
      monitor({
        monitorType: MonitorType.IncomingRequest,
        withoutProject: true,
      }) as never,
    );

    await expect(capturedHandler!(incomingRequestJob())).rejects.toThrow(
      "Monitor does not have a projectId",
    );

    expect(clearIfUnchanged).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Error processing telemetry job:");
  });
});

/*
 * Every reason a monitor is not being monitored (MonitorPauseState) is one
 * MonitorResource refuses a result for, and each refusal is one the worker
 * completes the job on. A new reason has to be added to FLAG_FOR_REASON, and
 * so is held to the same rule.
 */
describe("every reason a monitor is not being monitored", () => {
  test.each(Object.values(MonitorPauseReason))(
    "a result for a monitor paused as %s is refused in a way the worker completes the job on",
    async (reason: MonitorPauseReason) => {
      const paused: Monitor = monitor({
        monitorType: MonitorType.Website,
        pausedBy: reason,
      });

      // The fixture pauses the monitor for this reason.
      expect(MonitorPauseState.getPauseReason(paused)).toBe(reason);

      findOneById.mockResolvedValue(paused as never);

      const refusal: unknown = await MonitorResourceUtil.monitorResource(
        probeResult(),
      ).then(
        () => {
          return null;
        },
        (refused: unknown) => {
          return refused;
        },
      );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(isNonActionableIngestError(refusal)).toBe(true);
    },
  );
});

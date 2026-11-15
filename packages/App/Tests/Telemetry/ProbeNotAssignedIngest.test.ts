/*
 * A probe's check result for a monitor that probe does not check (issue
 * #8161).
 *
 * MonitorResource refuses it with ExceptionMessages.ProbeNotAssignedToMonitor
 * in two places: the probe is not among the monitor's probes (it was taken
 * off the monitor, or the monitor switched off for it, while a check it had
 * already claimed was in flight), or the monitor is of a type probes never
 * check. The refusal stands - a probe never writes results for a monitor it
 * does not check - but nobody can act on it, and neither the monitor's probes
 * nor its type change between attempts, so retrying the job only repeats it.
 *
 * So the telemetry worker completes the job (isNonActionableIngestError), and
 * MonitorResource logs the refusal once, at warn, naming the probe and the
 * monitor: a probe that keeps reporting for monitors it is not assigned to is
 * still seen, without an error and a stack per attempt. Anything else - a
 * result that names another probe than the one that sent it, a database
 * error reading the monitor's probes - still fails the job.
 *
 * The path is the real one from the worker's handler down, as in
 * PausedMonitorIngest.test.ts: the probe ingest job, MonitorResource's
 * refusal and the worker's handling of it. Stubbed are the monitor read
 * (MonitorService), the per-monitor lock, the monitor's probe rows
 * (MonitorProbeLastResults) and the criteria evaluator, which a refused
 * result never reaches; Redis is a map.
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
      findOneBy: jest.fn(),
      // MonitorResource's read, the one a result is refused on.
      findOneById: jest.fn(),
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

// The monitor's probe rows, in Postgres: stubbed per test.
jest.mock("Common/Server/Utils/Monitor/MonitorProbeLastResults", () => {
  return {
    __esModule: true,
    default: {
      storeResultAndReadProbes: jest.fn(),
      readProbes: jest.fn(),
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
  ProbeIngestJobData,
  TelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { isNonActionableIngestError } from "../../FeatureSet/Telemetry/Utils/NonActionableIngestError";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import MonitorService from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorProbeLastResults, {
  MonitorProbeOfResult,
  MonitorProbesOfResult,
} from "Common/Server/Utils/Monitor/MonitorProbeLastResults";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const MONITOR_ID: string = "7c2e4a6b-8d0f-4c3e-9a5b-2d4f6a8c0e11";
const PROJECT_ID: string = "3f5b7d9a-1c2e-4a4b-8d6f-0b2d4f6a8c12";
// The probe that checked the monitor and sent the result.
const PROBE_ID: string = "9a1c3e5b-7d2f-4b4c-8e6a-1c3e5a7b9d13";
// Another probe, still assigned to the monitor.
const OTHER_PROBE_ID: string = "1b3d5f7a-9c2e-4d4f-8a6b-3e5a7c9e1f14";
const STEP_ID: string = "4d6f8a0c-2e1b-4c3d-9f5a-7b9d1f3a5c15";

const MUTEX: { key: string } = { key: "the monitor's lock" };

const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const release: jest.Mock = Semaphore.release as unknown as jest.Mock;
const storeResultAndReadProbes: jest.Mock =
  MonitorProbeLastResults.storeResultAndReadProbes as unknown as jest.Mock;
const processMonitorStep: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

function monitor(monitorType: MonitorType): Monitor {
  const row: Monitor = new Monitor();
  row._id = MONITOR_ID;
  row.projectId = new ObjectID(PROJECT_ID);
  row.monitorType = monitorType;
  row.name = "Checkout page";
  row.isArchived = false;
  row.disableActiveMonitoring = false;
  row.disableActiveMonitoringBecauseOfManualIncident = false;
  row.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
  return row;
}

function probeOfMonitor(probeId: string): MonitorProbeOfResult {
  return {
    monitorProbeId: ObjectID.generate(),
    probeId: new ObjectID(probeId),
    isEnabled: true,
    probeName: "Probe",
    probeConnectionStatus: undefined,
    resultForJudgedStep: undefined,
  } as MonitorProbeOfResult;
}

function probesOfMonitor(probeIds: Array<string>): MonitorProbesOfResult {
  return {
    probes: probeIds.map(probeOfMonitor),
    isResultStored: false,
  } as MonitorProbesOfResult;
}

// A probe's check result, as the probe put it on the wire.
function probeResult(named?: string): ProbeMonitorResponse {
  return {
    projectId: new ObjectID(PROJECT_ID),
    monitorId: new ObjectID(MONITOR_ID),
    monitorStepId: new ObjectID(STEP_ID),
    probeId: new ObjectID(named || PROBE_ID),
    isOnline: true,
    responseTimeInMs: 120,
    monitoredAt: new Date("2026-11-15T09:00:00.000Z"),
  } as unknown as ProbeMonitorResponse;
}

/*
 * The telemetry job the probe ingest route queues, as Redis hands it back:
 * the probe that authenticated beside the result it sent.
 */
function probeResultJob(input?: { resultNames?: string }): unknown {
  const probeIngest: ProbeIngestJobData = JSON.parse(
    JSON.stringify({
      jobType: "probe-response",
      ingestionTimestamp: new Date("2026-11-15T09:00:01.000Z"),
      probeMonitorResponse: {
        probeId: PROBE_ID,
        probeMonitorResponse: probeResult(input?.resultNames),
      },
    }),
  ) as ProbeIngestJobData;

  return {
    id: "probe-ingest-8161",
    name: "ProcessTelemetry",
    data: {
      type: TelemetryType.ProbeIngest,
      ingestionTimestamp: "2026-11-15T09:00:01.000Z",
      probeIngest: probeIngest,
    },
  };
}

let redis: Map<string, string>;
let warn: jest.SpyInstance;
let error: jest.SpyInstance;

function warningsNaming(text: string): Array<Array<unknown>> {
  return warn.mock.calls.filter((call: Array<unknown>): boolean => {
    return String(call[0]).includes(text);
  });
}

// The refusal was logged once, at warn, naming the probe and the monitor.
function expectRefusalWarnedOnce(): void {
  const refusals: Array<Array<unknown>> = warningsNaming(
    "The result was refused.",
  );

  expect(refusals).toHaveLength(1);
  const [message, attributes] = refusals[0]! as [string, unknown];

  expect(message).toContain(`Probe ${PROBE_ID}`);
  expect(message).toContain(`monitor ${MONITOR_ID}`);
  expect(attributes).toEqual(
    expect.objectContaining({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      probeId: PROBE_ID,
    }),
  );
}

// Nothing logged as an error, so nothing failed the job.
function expectNoErrorLogged(): void {
  expect(error).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  redis = new Map<string, string>();

  warn = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
  error = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}-${key}`) ?? null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        redis.set(`${namespace}-${key}`, value);
      },
    );
  jest
    .spyOn(GlobalCache, "setNumberIfGreater")
    .mockImplementation(
      async (namespace: string, key: string, value: number) => {
        const current: number = Number(redis.get(`${namespace}-${key}`) || 0);
        const newest: number = Math.max(current, value);
        redis.set(`${namespace}-${key}`, String(newest));
        return newest;
      },
    );
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);

  lock.mockResolvedValue(MUTEX as never);
  release.mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("the worker handler was registered/captured", () => {
  expect(typeof capturedHandler).toBe("function");
});

describe("a probe's check result for a monitor it is not assigned to", () => {
  /*
   * The issue's reproduction: a Website monitor whose probes no longer
   * include the one that reported.
   */
  test("completes the telemetry job, logs one warning naming the probe and the monitor, and evaluates nothing", async () => {
    findOneById.mockResolvedValue(monitor(MonitorType.Website) as never);
    storeResultAndReadProbes.mockResolvedValue(
      probesOfMonitor([OTHER_PROBE_ID]) as never,
    );

    await expect(capturedHandler!(probeResultJob())).resolves.toBeUndefined();

    expect(storeResultAndReadProbes).toHaveBeenCalledTimes(1);
    expectRefusalWarnedOnce();
    expect(warningsNaming("which it is not assigned to")).toHaveLength(1);
    expectNoErrorLogged();
    expect(processMonitorStep).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(MUTEX);
  });

  test("completes the job when the monitor has no probes left at all", async () => {
    findOneById.mockResolvedValue(monitor(MonitorType.Website) as never);
    storeResultAndReadProbes.mockResolvedValue(probesOfMonitor([]) as never);

    await expect(capturedHandler!(probeResultJob())).resolves.toBeUndefined();

    expectRefusalWarnedOnce();
    expectNoErrorLogged();
    expect(processMonitorStep).not.toHaveBeenCalled();
  });

  test("a retry of the same job is refused the same way, and completes too", async () => {
    findOneById.mockResolvedValue(monitor(MonitorType.Website) as never);
    storeResultAndReadProbes.mockResolvedValue(
      probesOfMonitor([OTHER_PROBE_ID]) as never,
    );

    await expect(capturedHandler!(probeResultJob())).resolves.toBeUndefined();
    await expect(capturedHandler!(probeResultJob())).resolves.toBeUndefined();

    expect(warningsNaming("The result was refused.")).toHaveLength(2);
    expectNoErrorLogged();
  });
});

describe("a probe's check result for a monitor of a type probes do not check", () => {
  const NOT_PROBED: Array<MonitorType> = [
    MonitorType.IncomingRequest,
    MonitorType.Manual,
    MonitorType.Server,
  ];

  test.each(NOT_PROBED)(
    "for a %s monitor completes the telemetry job, logs one warning naming the probe and the monitor, and reads none of its probes",
    async (monitorType: MonitorType) => {
      expect(MonitorTypeHelper.isProbableMonitor(monitorType)).toBe(false);
      findOneById.mockResolvedValue(monitor(monitorType) as never);

      await expect(capturedHandler!(probeResultJob())).resolves.toBeUndefined();

      expectRefusalWarnedOnce();
      expect(warningsNaming("monitor probes do not check")).toHaveLength(1);
      expect(warningsNaming(monitorType)).toHaveLength(1);
      expectNoErrorLogged();
      expect(storeResultAndReadProbes).not.toHaveBeenCalled();
      expect(processMonitorStep).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledWith(MUTEX);
    },
  );
});

describe("MonitorResource's refusal", () => {
  test("is the ProbeNotAssignedToMonitor entry, a BadDataException the worker completes the job on", async () => {
    findOneById.mockResolvedValue(monitor(MonitorType.Website) as never);
    storeResultAndReadProbes.mockResolvedValue(
      probesOfMonitor([OTHER_PROBE_ID]) as never,
    );

    const refusal: unknown = await MonitorResourceUtil.monitorResource(
      probeResult(),
      { reportingProbeId: new ObjectID(PROBE_ID) },
    ).then(
      () => {
        return null;
      },
      (refused: unknown) => {
        return refused;
      },
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(
      ExceptionMessages.ProbeNotAssignedToMonitor,
    );
    expect(isNonActionableIngestError(refusal)).toBe(true);
  });

  test("for a monitor type probes do not check is the same entry", async () => {
    findOneById.mockResolvedValue(
      monitor(MonitorType.IncomingRequest) as never,
    );

    const refusal: unknown = await MonitorResourceUtil.monitorResource(
      probeResult(),
      { reportingProbeId: new ObjectID(PROBE_ID) },
    ).then(
      () => {
        return null;
      },
      (refused: unknown) => {
        return refused;
      },
    );

    expect((refusal as Error).message).toBe(
      ExceptionMessages.ProbeNotAssignedToMonitor,
    );
    expect(isNonActionableIngestError(refusal)).toBe(true);
  });
});

/*
 * Only this refusal is completed. A failure somebody may have to act on, or
 * that may not happen again, still fails the job so the queue retries it.
 */
describe("a failure that is not this refusal", () => {
  test("a result that names another probe than the one that sent it still fails the job", async () => {
    findOneById.mockResolvedValue(monitor(MonitorType.Website) as never);

    await expect(
      capturedHandler!(probeResultJob({ resultNames: OTHER_PROBE_ID })),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(error).toHaveBeenCalledWith("Error processing telemetry job:");
    expect(findOneById).not.toHaveBeenCalled();
    expect(warningsNaming("The result was refused.")).toHaveLength(0);
  });

  test("a database error reading the monitor's probes still fails the job, and gives the lock back", async () => {
    findOneById.mockResolvedValue(monitor(MonitorType.Website) as never);
    storeResultAndReadProbes.mockRejectedValue(
      new Error("Connection terminated unexpectedly") as never,
    );

    await expect(capturedHandler!(probeResultJob())).rejects.toThrow(
      "Connection terminated unexpectedly",
    );

    expect(error).toHaveBeenCalledWith("Error processing telemetry job:");
    expect(release).toHaveBeenCalledWith(MUTEX);
    expect(warningsNaming("The result was refused.")).toHaveLength(0);
  });
});

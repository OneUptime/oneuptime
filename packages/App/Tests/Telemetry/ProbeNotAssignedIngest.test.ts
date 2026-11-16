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
 * still seen, without an error and a stack per attempt. A failure that may
 * not happen again - a database error reading the monitor's probes - still
 * fails the job.
 *
 * So does a result held to the probe that sent it (issue #8424): one that
 * names another probe, or a job that names no probe, is refused the same way
 * on every attempt, so the worker completes it, and the probe ingest worker
 * logs the refusal once, at warn, naming the probe that sent it and the probe
 * the result named (the last section below).
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
import { isNonActionableIngestError } from "Common/Server/Utils/Monitor/NonActionableIngestError";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorTestService, {
  MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE,
} from "Common/Server/Services/MonitorTestService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorProbeLastResults, {
  MonitorProbeOfResult,
  MonitorProbesOfResult,
} from "Common/Server/Utils/Monitor/MonitorProbeLastResults";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import {
  PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
  REPORTING_PROBE_NOT_KNOWN_MESSAGE,
} from "Common/Server/Utils/Probe/ProbeReportIdentity";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
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
  /*
   * Until issue #8424 this failed the job, three times over. It is refused
   * the same way on every attempt, so it completes too - with its own
   * warning (below), not this one.
   */
  test("a result that names another probe than the one that sent it completes the job, with its own warning and not this one", async () => {
    findOneById.mockResolvedValue(monitor(MonitorType.Website) as never);

    await expect(
      capturedHandler!(probeResultJob({ resultNames: OTHER_PROBE_ID })),
    ).resolves.toBeUndefined();

    expectNoErrorLogged();
    expect(findOneById).not.toHaveBeenCalled();
    expect(warningsNaming("The result was refused.")).toHaveLength(0);
    expect(warningsNaming("can only report its own results")).toHaveLength(1);
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

/*
 * ---------------------------------------------------------------------------
 * A RESULT THAT NAMES ANOTHER PROBE, OR A JOB THAT NAMES NO PROBE (issue
 * #8424).
 *
 * Probe ingest holds every result to the probe that sent it
 * (ProbeReportIdentity): a result that names another probe is refused
 * (PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE), and so is a job that does
 * not say which probe sent it (REPORTING_PROBE_NOT_KNOWN_MESSAGE). Both are
 * read from the job's own data, so every retry was refused the same way:
 * the job failed three times, each with "Error processing telemetry job:"
 * and a stack. Now the worker completes it, and the refusal is logged once,
 * at warn, naming the probe that sent it and the probe it named - ids only,
 * never the probe's key, which a job queued the older way still carries.
 * ---------------------------------------------------------------------------
 */

const TEST_ID: string = "5e7a9c1b-3d2f-4e4a-8b6c-0d2f4a6c8e16";
const PROBE_KEY: string = "the-probe-key-an-older-job-carries";

// A probe ingest job, as the worker gets it, for any sender and result.
function probeJob(input: {
  sender?: unknown;
  resultProbeId?: unknown;
  jobType?: "probe-response" | "monitor-test";
  olderBody?: boolean;
}): unknown {
  const result: JSONObject = JSON.parse(
    JSON.stringify(probeResult()),
  ) as JSONObject;

  if ("resultProbeId" in input) {
    if (input.resultProbeId === undefined) {
      delete result["probeId"];
    } else {
      result["probeId"] = input.resultProbeId as JSONObject;
    }
  }

  const queued: JSONObject = {
    ...(input.olderBody
      ? { probeKey: PROBE_KEY, probeCapabilities: ["networkDevicePing"] }
      : {}),
    ...("sender" in input
      ? input.sender === undefined
        ? {}
        : { probeId: input.sender as string }
      : { probeId: PROBE_ID }),
    probeMonitorResponse: result,
  };

  const probeIngest: ProbeIngestJobData = JSON.parse(
    JSON.stringify({
      jobType: input.jobType || "probe-response",
      testId: input.jobType === "monitor-test" ? TEST_ID : undefined,
      ingestionTimestamp: new Date("2026-11-15T09:00:01.000Z"),
      probeMonitorResponse: queued,
    }),
  ) as ProbeIngestJobData;

  return {
    id: "probe-ingest-8424",
    name: "ProcessTelemetry",
    data: {
      type: TelemetryType.ProbeIngest,
      ingestionTimestamp: "2026-11-15T09:00:01.000Z",
      probeIngest: probeIngest,
    },
  };
}

// An ObjectID as JSON writes it, which is how a probe puts an id on the wire.
function onTheWire(id: string): JSONObject {
  return JSON.parse(JSON.stringify(new ObjectID(id))) as JSONObject;
}

const NAMES_ANOTHER_PROBE: string = "can only report its own results";
const NAMES_NO_SENDER: string = "was queued without the probe that sent it";

// Everything a warning carried: its text and its attributes.
function allLogged(): string {
  return JSON.stringify([warn.mock.calls, error.mock.calls]);
}

// Nothing past the refusal ran: no monitor read, no lock, no probe rows.
function expectNothingRead(): void {
  expect(findOneById).not.toHaveBeenCalled();
  expect(lock).not.toHaveBeenCalled();
  expect(storeResultAndReadProbes).not.toHaveBeenCalled();
  expect(processMonitorStep).not.toHaveBeenCalled();
}

describe("a probe's result that names another probe than the one that sent it (issue #8424)", () => {
  test.each([
    ["as the probe puts an id on the wire", onTheWire(OTHER_PROBE_ID)],
    ["as a plain string", OTHER_PROBE_ID],
    ["in capitals", OTHER_PROBE_ID.toUpperCase()],
  ])(
    "named %s, completes the telemetry job, logs one warning naming both probes and the monitor, and reads nothing",
    async (_label: string, named: unknown) => {
      await expect(
        capturedHandler!(probeJob({ resultProbeId: named })),
      ).resolves.toBeUndefined();

      const warnings: Array<Array<unknown>> =
        warningsNaming(NAMES_ANOTHER_PROBE);
      expect(warnings).toHaveLength(1);

      const [message, attributes] = warnings[0]! as [string, unknown];
      expect(message).toBe(
        `Probe ${PROBE_ID} sent a check result for monitor ${MONITOR_ID} that names probe ${OTHER_PROBE_ID}. A probe can only report its own results, so the result was refused.`,
      );
      expect(attributes).toEqual({
        monitorId: MONITOR_ID,
        probeId: PROBE_ID,
        resultProbeId: OTHER_PROBE_ID,
      });

      expectNoErrorLogged();
      expectNothingRead();
    },
  );

  test("a result whose probe id cannot be read is refused the same way, and the warning prints none of it", async () => {
    for (const unreadable of [
      42,
      true,
      { some: "thing" },
      ["9a1c3e5b-7d2f-4b4c-8e6a-1c3e5a7b9d13"],
    ]) {
      jest.clearAllMocks();

      await expect(
        capturedHandler!(probeJob({ resultProbeId: unreadable })),
      ).resolves.toBeUndefined();

      const warnings: Array<Array<unknown>> =
        warningsNaming(NAMES_ANOTHER_PROBE);
      expect({ unreadable, warnings: warnings.length }).toEqual({
        unreadable,
        warnings: 1,
      });
      expect(String(warnings[0]![0])).toContain(
        `Probe ${PROBE_ID} sent a check result for monitor ${MONITOR_ID} that names a probe id that cannot be read.`,
      );
      expect((warnings[0]![1] as JSONObject)["resultProbeId"]).toBeUndefined();
      expect(allLogged()).not.toContain("thing");
      expectNoErrorLogged();
      expectNothingRead();
    }
  });

  test("a string that is not a probe id is named as unreadable, never printed", async () => {
    await expect(
      capturedHandler!(
        probeJob({ resultProbeId: "probe-7\nERROR forged log line" }),
      ),
    ).resolves.toBeUndefined();

    expect(warningsNaming(NAMES_ANOTHER_PROBE)).toHaveLength(1);
    expect(allLogged()).not.toContain("forged log line");
    expect(allLogged()).toContain("a probe id that cannot be read");
  });

  test("a retry of the same job is refused the same way, and completes too", async () => {
    const job: unknown = probeJob({ resultProbeId: onTheWire(OTHER_PROBE_ID) });

    await expect(capturedHandler!(job)).resolves.toBeUndefined();
    await expect(capturedHandler!(job)).resolves.toBeUndefined();

    expect(warningsNaming(NAMES_ANOTHER_PROBE)).toHaveLength(2);
    expectNoErrorLogged();
  });

  test("queued the older way (the whole request body), it completes, and nothing logged carries the probe's key", async () => {
    await expect(
      capturedHandler!(
        probeJob({ resultProbeId: onTheWire(OTHER_PROBE_ID), olderBody: true }),
      ),
    ).resolves.toBeUndefined();

    expect(warningsNaming(NAMES_ANOTHER_PROBE)).toHaveLength(1);
    expect(allLogged()).not.toContain(PROBE_KEY);
    expectNoErrorLogged();
    expectNothingRead();
  });

  test("a monitor test's result that names another probe completes, naming the test", async () => {
    await expect(
      capturedHandler!(
        probeJob({
          jobType: "monitor-test",
          resultProbeId: onTheWire(OTHER_PROBE_ID),
        }),
      ),
    ).resolves.toBeUndefined();

    const warnings: Array<Array<unknown>> = warningsNaming(NAMES_ANOTHER_PROBE);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toBe(
      `Probe ${PROBE_ID} sent a result for monitor test ${TEST_ID} that names probe ${OTHER_PROBE_ID}. A probe can only report its own results, so the result was refused.`,
    );
    expect(warnings[0]![1]).toEqual({
      monitorTestId: TEST_ID,
      probeId: PROBE_ID,
      resultProbeId: OTHER_PROBE_ID,
    });
    expectNoErrorLogged();
  });

  test("the refusal is ProbeReportIdentity's, a BadDataException the worker completes the job on", async () => {
    const { processProbeFromQueue } = jest.requireActual(
      "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest",
    ) as {
      processProbeFromQueue: (jobData: ProbeIngestJobData) => Promise<void>;
    };

    const refusal: unknown = await processProbeFromQueue(
      (
        probeJob({ resultProbeId: OTHER_PROBE_ID }) as {
          data: { probeIngest: ProbeIngestJobData };
        }
      ).data.probeIngest,
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
      PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
    );
    expect(isNonActionableIngestError(refusal)).toBe(true);
  });

  test("a result that names the probe that sent it, or none, is not refused: it goes on to the monitor", async () => {
    findOneById.mockResolvedValue(monitor(MonitorType.Website) as never);
    storeResultAndReadProbes.mockResolvedValue(
      probesOfMonitor([OTHER_PROBE_ID]) as never,
    );

    for (const named of [
      onTheWire(PROBE_ID),
      PROBE_ID.toUpperCase(),
      undefined,
    ]) {
      jest.clearAllMocks();
      lock.mockResolvedValue(MUTEX as never);
      release.mockResolvedValue(undefined as never);
      findOneById.mockResolvedValue(monitor(MonitorType.Website) as never);
      storeResultAndReadProbes.mockResolvedValue(
        probesOfMonitor([OTHER_PROBE_ID]) as never,
      );

      await capturedHandler!(probeJob({ resultProbeId: named }));

      expect(findOneById).toHaveBeenCalledTimes(1);
      expect(warningsNaming(NAMES_ANOTHER_PROBE)).toHaveLength(0);
      expect(warningsNaming(NAMES_NO_SENDER)).toHaveLength(0);
    }
  });
});

describe("a probe's result queued without the probe that sent it (issue #8424)", () => {
  test.each([
    ["no sender at all", undefined],
    ["an empty sender", ""],
    ["a sender that is not a probe id", "some-probe"],
    ["a number", 42],
    ["an id that is not a uuid", { _type: "ObjectID", value: "not-a-uuid" }],
  ])(
    "%s: completes the telemetry job, logs one warning naming what the result names, and reads nothing",
    async (_label: string, sender: unknown) => {
      await expect(
        capturedHandler!(
          probeJob({ sender, resultProbeId: onTheWire(OTHER_PROBE_ID) }),
        ),
      ).resolves.toBeUndefined();

      const warnings: Array<Array<unknown>> = warningsNaming(NAMES_NO_SENDER);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]![0]).toBe(
        `A check result for monitor ${MONITOR_ID} was queued without the probe that sent it (the result names probe ${OTHER_PROBE_ID}). No probe can be held to it, so the result was refused.`,
      );
      expect(warnings[0]![1]).toEqual({
        monitorId: MONITOR_ID,
        resultProbeId: OTHER_PROBE_ID,
      });
      expect(warningsNaming(NAMES_ANOTHER_PROBE)).toHaveLength(0);
      expectNoErrorLogged();
      expectNothingRead();
    },
  );

  test("whose result names no probe either: the warning says so without naming one", async () => {
    await expect(
      capturedHandler!(
        probeJob({ sender: undefined, resultProbeId: undefined }),
      ),
    ).resolves.toBeUndefined();

    const warnings: Array<Array<unknown>> = warningsNaming(NAMES_NO_SENDER);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toBe(
      `A check result for monitor ${MONITOR_ID} was queued without the probe that sent it. No probe can be held to it, so the result was refused.`,
    );
    expectNoErrorLogged();
  });

  test("a monitor test's result queued without its sender completes, naming the test", async () => {
    await expect(
      capturedHandler!(
        probeJob({ jobType: "monitor-test", sender: undefined }),
      ),
    ).resolves.toBeUndefined();

    const warnings: Array<Array<unknown>> = warningsNaming(NAMES_NO_SENDER);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]![0])).toContain(
      `A result for monitor test ${TEST_ID} was queued without the probe that sent it`,
    );
    expectNoErrorLogged();
  });

  test("the refusal is REPORTING_PROBE_NOT_KNOWN_MESSAGE, which the worker completes the job on", async () => {
    const { processProbeFromQueue } = jest.requireActual(
      "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest",
    ) as {
      processProbeFromQueue: (jobData: ProbeIngestJobData) => Promise<void>;
    };

    const refusal: unknown = await processProbeFromQueue(
      (
        probeJob({ sender: undefined }) as {
          data: { probeIngest: ProbeIngestJobData };
        }
      ).data.probeIngest,
    ).then(
      () => {
        return null;
      },
      (refused: unknown) => {
        return refused;
      },
    );

    expect((refusal as Error).message).toBe(REPORTING_PROBE_NOT_KNOWN_MESSAGE);
    expect(isNonActionableIngestError(refusal)).toBe(true);
  });
});

describe("an SNMP trap queued without the probe that received it (issue #8424)", () => {
  function trapJob(probeId: unknown): unknown {
    return {
      id: "snmp-trap-8424",
      name: "ProcessTelemetry",
      data: {
        type: TelemetryType.ProbeIngest,
        ingestionTimestamp: "2026-11-15T09:00:01.000Z",
        probeIngest: JSON.parse(
          JSON.stringify({
            jobType: "snmp-trap",
            ingestionTimestamp: new Date("2026-11-15T09:00:01.000Z"),
            snmpTrap: {
              ...(probeId === undefined ? {} : { probeId }),
              snmpTrap: {
                sourceIpAddress: "10.0.0.7",
                trapOid: "1.3.6.1.6.3.1.1.5.3",
              },
            },
          }),
        ),
      },
    };
  }

  test.each([
    ["no probe at all", undefined],
    ["a probe that is not a probe id", "some-probe"],
  ])(
    "%s: completes the telemetry job and logs one warning naming the trap's source",
    async (_label: string, probeId: unknown) => {
      await expect(capturedHandler!(trapJob(probeId))).resolves.toBeUndefined();

      const warnings: Array<Array<unknown>> = warningsNaming(
        "queued without the probe that received it",
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]![0]).toBe(
        "An SNMP trap from 10.0.0.7 was queued without the probe that received it. No probe's devices can be matched to it, so the trap was refused.",
      );
      expectNoErrorLogged();
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * A MONITOR TEST'S RESULT FOR A TEST THE PROBE WAS NOT HANDED (issue #8539).
 *
 * MonitorTestService writes a test's result only on a test handed to the
 * probe that sent it, and still there. When it is not - another probe
 * claimed the test after this probe's claim went stale, or the test was
 * deleted - the write lands nowhere, and no attempt changes that. The job
 * used to fail three times, each with "Error processing telemetry job:" and
 * a stack after the warning. Now the worker completes it, with the one
 * warning naming the probe and the test.
 * ---------------------------------------------------------------------------
 */
describe("a monitor test's result for a test the probe was not handed (issue #8539)", () => {
  const NOT_HANDED: string = "which was not handed to it or no longer exists";

  test("completes the telemetry job, logs one warning naming the probe and the test, and nothing as an error", async () => {
    const merge: jest.SpyInstance = jest
      .spyOn(MonitorTestService, "mergeStepProbeResponse")
      .mockResolvedValue(false);
    jest.spyOn(MonitorTestService, "findOneById").mockResolvedValue(null);

    await expect(
      capturedHandler!(probeJob({ jobType: "monitor-test" })),
    ).resolves.toBeUndefined();

    expect(merge).toHaveBeenCalledTimes(1);
    const warnings: Array<Array<unknown>> = warningsNaming(NOT_HANDED);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toBe(
      `Probe ${PROBE_ID} sent a result for monitor test ${TEST_ID}, which was not handed to it or no longer exists. Nothing was recorded.`,
    );
    expect(warnings[0]![1]).toEqual({
      probeId: PROBE_ID,
      monitorTestId: TEST_ID,
    });
    expectNoErrorLogged();
  });

  test("a retry of the same job is refused the same way, and completes too", async () => {
    jest
      .spyOn(MonitorTestService, "mergeStepProbeResponse")
      .mockResolvedValue(false);
    jest.spyOn(MonitorTestService, "findOneById").mockResolvedValue(null);
    const job: unknown = probeJob({ jobType: "monitor-test" });

    await expect(capturedHandler!(job)).resolves.toBeUndefined();
    await expect(capturedHandler!(job)).resolves.toBeUndefined();

    expect(warningsNaming(NOT_HANDED)).toHaveLength(2);
    expectNoErrorLogged();
  });

  test("the refusal is ExceptionMessages.MonitorTestNotHandedToProbe, which the worker completes the job on", async () => {
    jest
      .spyOn(MonitorTestService, "mergeStepProbeResponse")
      .mockResolvedValue(false);
    jest.spyOn(MonitorTestService, "findOneById").mockResolvedValue(null);
    const { processProbeFromQueue } = jest.requireActual(
      "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest",
    ) as {
      processProbeFromQueue: (jobData: ProbeIngestJobData) => Promise<void>;
    };

    const refusal: unknown = await processProbeFromQueue(
      (
        probeJob({ jobType: "monitor-test" }) as {
          data: { probeIngest: ProbeIngestJobData };
        }
      ).data.probeIngest,
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
      ExceptionMessages.MonitorTestNotHandedToProbe,
    );
    expect(MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE).toBe(
      ExceptionMessages.MonitorTestNotHandedToProbe,
    );
    expect(isNonActionableIngestError(refusal)).toBe(true);
  });

  test("a test handed to the probe is written, and nothing is refused", async () => {
    const merge: jest.SpyInstance = jest
      .spyOn(MonitorTestService, "mergeStepProbeResponse")
      .mockResolvedValue(true);
    jest.spyOn(MonitorTestService, "findOneById").mockResolvedValue(null);

    await expect(
      capturedHandler!(probeJob({ jobType: "monitor-test" })),
    ).resolves.toBeUndefined();

    expect(merge).toHaveBeenCalledTimes(1);
    expect(warningsNaming(NOT_HANDED)).toHaveLength(0);
    expectNoErrorLogged();
  });

  test("a database error writing the result still fails the job, for the queue to retry", async () => {
    jest
      .spyOn(MonitorTestService, "mergeStepProbeResponse")
      .mockRejectedValue(new Error("Connection terminated unexpectedly"));
    jest.spyOn(MonitorTestService, "findOneById").mockResolvedValue(null);

    await expect(
      capturedHandler!(probeJob({ jobType: "monitor-test" })),
    ).rejects.toThrow("Connection terminated unexpectedly");

    expect(error).toHaveBeenCalledWith("Error processing telemetry job:");
    expect(warningsNaming(NOT_HANDED)).toHaveLength(0);
  });
});

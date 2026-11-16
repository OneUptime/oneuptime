import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import NetworkDeviceAutoImportRuleEngineService from "Common/Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { AutoImportRuleRunResult } from "Common/Types/NetworkAutomation/RuleRunResult";

/*
 * The job exports no handler: it registers one at module load. Capture that
 * callback so each test can exercise a complete worker sweep without creating
 * a BullMQ repeatable job.
 */
type CronHandler = (deadline?: JobDeadline) => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
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

jest.mock("Common/Server/Services/NetworkDeviceDiscoveryScanService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Services/NetworkDeviceAutoImportRuleEngineService",
  () => {
    return {
      __esModule: true,
      AUTO_IMPORT_SWEEP_LOCK_KEY:
        "NetworkDeviceDiscovery:ProcessAutoImportRules",
      AUTO_IMPORT_SWEEP_LOCK_NAMESPACE: "Workers.Cron",
      AUTO_IMPORT_SWEEP_LOCK_TIMEOUT_MS: 11 * 60 * 1000,
      default: {
        processCompletedScan: jest.fn(),
      },
    };
  },
);

// Imported for its side effect: the RunCron mock above records the handler.
import "../../../../FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/ProcessAutoImportRules";

interface ProcessCompletedScanArgs {
  scanId: ObjectID;
  existingHostnamesByProjectId: Map<string, unknown>;
  existingMonitorsByProjectId: Map<string, unknown>;
  attemptBudgetsByProjectId: Map<string, unknown>;
}

const scanService: { findBy: jest.Mock } =
  NetworkDeviceDiscoveryScanService as unknown as { findBy: jest.Mock };
const engineService: { processCompletedScan: jest.Mock } =
  NetworkDeviceAutoImportRuleEngineService as unknown as {
    processCompletedScan: jest.Mock;
  };
const semaphore: { lock: jest.Mock; release: jest.Mock } =
  Semaphore as unknown as { lock: jest.Mock; release: jest.Mock };
const mockedLogger: {
  debug: jest.Mock;
  info: jest.Mock;
  error: jest.Mock;
} = logger as unknown as {
  debug: jest.Mock;
  info: jest.Mock;
  error: jest.Mock;
};

const SWEEP_MUTEX: SemaphoreMutex = {
  identifier: "network-auto-import-sweep",
} as unknown as SemaphoreMutex;

const PROJECT_A_ID: ObjectID = new ObjectID("project-a");
const PROJECT_B_ID: ObjectID = new ObjectID("project-b");
const PROJECT_A_SCAN_1_ID: ObjectID = new ObjectID("project-a-scan-1");
const PROJECT_A_SCAN_2_ID: ObjectID = new ObjectID("project-a-scan-2");
const PROJECT_B_SCAN_ID: ObjectID = new ObjectID("project-b-scan-1");

function makeScan(data: {
  id: ObjectID;
  projectId: ObjectID;
}): NetworkDeviceDiscoveryScan {
  return {
    id: data.id,
    projectId: data.projectId,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function makeResult(
  overrides: Partial<AutoImportRuleRunResult> = {},
): AutoImportRuleRunResult {
  return {
    hostsEvaluated: 0,
    hostsMatched: 0,
    hostsExcluded: 0,
    hostsSkippedAlreadyRegistered: 0,
    devicesCreated: 0,
    devicesFailed: 0,
    monitorsWouldCreate: 0,
    monitorsCreated: 0,
    monitorsSkippedAlreadyExisting: 0,
    monitorsSkippedUnsupportedHost: 0,
    monitorsFailed: 0,
    deviceFailureReasons: [],
    monitorFailureReasons: [],
    monitorProvisioningHalted: false,
    isTruncated: false,
    hostsPendingImport: 0,
    monitorsPendingCreation: 0,
    hasUnevaluatedScans: false,
    hasMoreScans: false,
    isDryRun: false,
    matchedIpAddressSample: [],
    ...overrides,
  };
}

async function runWorkerTick(deadline?: JobDeadline): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["NetworkDeviceDiscovery:ProcessAutoImportRules"];

  if (!handler) {
    throw new Error(
      "NetworkDeviceDiscovery:ProcessAutoImportRules did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler(deadline);
}

function offeredScanIds(): Array<ObjectID> {
  return engineService.processCompletedScan.mock.calls.map(
    (call: Array<unknown>): ObjectID => {
      return (call[0] as ProcessCompletedScanArgs).scanId;
    },
  );
}

describe("NetworkDeviceDiscovery:ProcessAutoImportRules worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    semaphore.lock.mockResolvedValue(SWEEP_MUTEX);
    semaphore.release.mockResolvedValue(undefined);
    scanService.findBy.mockResolvedValue([]);
    engineService.processCompletedScan.mockResolvedValue(makeResult());
  });

  test("a capped project defers its later scans without starving another project and shares all sweep caches", async () => {
    scanService.findBy.mockResolvedValue([
      makeScan({ id: PROJECT_A_SCAN_1_ID, projectId: PROJECT_A_ID }),
      makeScan({ id: PROJECT_A_SCAN_2_ID, projectId: PROJECT_A_ID }),
      makeScan({ id: PROJECT_B_SCAN_ID, projectId: PROJECT_B_ID }),
    ]);
    engineService.processCompletedScan
      .mockResolvedValueOnce(makeResult({ isTruncated: true }))
      .mockResolvedValueOnce(makeResult());

    await runWorkerTick();

    expect(engineService.processCompletedScan).toHaveBeenCalledTimes(2);

    const firstCall: ProcessCompletedScanArgs = engineService
      .processCompletedScan.mock.calls[0]![0] as ProcessCompletedScanArgs;
    const secondCall: ProcessCompletedScanArgs = engineService
      .processCompletedScan.mock.calls[1]![0] as ProcessCompletedScanArgs;

    expect(firstCall.scanId).toBe(PROJECT_A_SCAN_1_ID);
    expect(secondCall.scanId).toBe(PROJECT_B_SCAN_ID);
    expect(
      engineService.processCompletedScan.mock.calls.some(
        (call: Array<unknown>) => {
          return (
            (call[0] as ProcessCompletedScanArgs).scanId === PROJECT_A_SCAN_2_ID
          );
        },
      ),
    ).toBe(false);

    expect(firstCall.existingHostnamesByProjectId).toBeInstanceOf(Map);
    expect(firstCall.existingMonitorsByProjectId).toBeInstanceOf(Map);
    expect(firstCall.attemptBudgetsByProjectId).toBeInstanceOf(Map);
    expect(secondCall.existingHostnamesByProjectId).toBe(
      firstCall.existingHostnamesByProjectId,
    );
    expect(secondCall.existingMonitorsByProjectId).toBe(
      firstCall.existingMonitorsByProjectId,
    );
    expect(secondCall.attemptBudgetsByProjectId).toBe(
      firstCall.attemptBudgetsByProjectId,
    );
    expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
  });

  test("skip-only outcomes are diagnostic debug logs rather than write-summary info logs", async () => {
    scanService.findBy.mockResolvedValue([
      makeScan({ id: PROJECT_A_SCAN_1_ID, projectId: PROJECT_A_ID }),
    ]);
    engineService.processCompletedScan.mockResolvedValue(
      makeResult({
        hostsSkippedAlreadyRegistered: 3,
        hostsExcluded: 2,
        monitorsSkippedAlreadyExisting: 4,
        monitorsSkippedUnsupportedHost: 1,
      }),
    );

    await runWorkerTick();

    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("required no writes"),
      { projectId: PROJECT_A_ID.toString() },
    );
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("4 requested monitor(s) already covered"),
      { projectId: PROJECT_A_ID.toString() },
    );
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
  /*
   * github.com/OneUptime/oneuptime/issues/3599 — the sweep must offer the
   * engine a scan that is still RUNNING, not only a finished one.
   *
   * A discovery sweep uploads what it has found every 30 seconds, and each
   * upload clears the marker this query filters on. Reading only finished
   * scans is what left 527 already-discovered switches unimportable for a
   * whole day while the sweep that found them was still going.
   */
  test("offers the engine running scans as well as finished ones", async () => {
    await runWorkerTick();

    const query: Record<string, unknown> = (
      scanService.findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    /*
     * QueryHelper.any builds a raw TypeORM FindOperator, so the accepted
     * values have to be read back out of its parameters — a test that only
     * asserted "it is some operator" would pass for a filter that accepts the
     * wrong statuses.
     */
    const parameters: Record<string, Array<string>> = (
      query["status"] as {
        _objectLiteralParameters: Record<string, Array<string>>;
      }
    )._objectLiteralParameters;

    expect([...Object.values(parameters)[0]!].sort()).toEqual([
      "Completed",
      "In Progress",
    ]);
  });

  /*
   * The marker is still the whole protocol: a scan whose results have been
   * processed is not offered again until something clears it, and for a
   * running scan that something is its next partial upload.
   */
  test("still asks only for scans whose results have not been processed", async () => {
    await runWorkerTick();

    const query: Record<string, unknown> = (
      scanService.findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["autoImportProcessedAt"]).toBeDefined();
  });
});

/*
 * One engine writer at a time, and a sweep that stops at its deadline (issue
 * #8103). The run's lease (CronLock) keeps two sweeps apart; the engine's
 * lock is still taken, because Run Now - an API request, not a run of this
 * job - takes it too, and two writers over one scan race into duplicate
 * devices.
 */
describe("NetworkDeviceDiscovery:ProcessAutoImportRules one writer at a time", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    semaphore.lock.mockResolvedValue(SWEEP_MUTEX);
    semaphore.release.mockResolvedValue(undefined);
    scanService.findBy.mockResolvedValue([
      makeScan({ id: PROJECT_A_SCAN_1_ID, projectId: PROJECT_A_ID }),
      makeScan({ id: PROJECT_A_SCAN_2_ID, projectId: PROJECT_A_ID }),
      makeScan({ id: PROJECT_B_SCAN_ID, projectId: PROJECT_B_ID }),
    ]);
    engineService.processCompletedScan.mockResolvedValue(makeResult());
  });

  test("takes the engine's lock, the one Run Now takes, without queueing, and releases it", async () => {
    await runWorkerTick(new JobDeadline());

    expect(semaphore.lock).toHaveBeenCalledTimes(1);
    expect(semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "NetworkDeviceDiscovery:ProcessAutoImportRules",
        namespace: "Workers.Cron",
        acquireAttemptsLimit: 1,
      }),
    );
    expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
    expect(engineService.processCompletedScan).toHaveBeenCalledTimes(3);
  });

  test("does nothing at all while Run Now or another sweep holds the lock", async () => {
    semaphore.lock.mockRejectedValue(new Error("already held"));

    await runWorkerTick(new JobDeadline());

    expect(scanService.findBy).not.toHaveBeenCalled();
    expect(engineService.processCompletedScan).not.toHaveBeenCalled();
    expect(semaphore.release).not.toHaveBeenCalled();
  });

  /*
   * The time limit ran out during the first scan: the import in flight
   * finished, and the sweep stops before the next scan. The others keep
   * their NULL marker, so the next tick resumes them.
   */
  test("stops before the next scan once the deadline has passed, and leaves the rest for the next tick", async () => {
    const deadline: JobDeadline = new JobDeadline();

    engineService.processCompletedScan.mockImplementationOnce(
      async (): Promise<AutoImportRuleRunResult> => {
        deadline.end();
        return makeResult();
      },
    );

    await runWorkerTick(deadline);

    expect(offeredScanIds()).toEqual([PROJECT_A_SCAN_1_ID]);
    expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("stopping after 1 of 3 scan(s)"),
    );
  });

  // A run whose lease was lost has its deadline ended (CronLock).
  test("stops the same way when the run's lease was lost", async () => {
    const deadline: JobDeadline = new JobDeadline();

    engineService.processCompletedScan.mockImplementationOnce(
      async (): Promise<AutoImportRuleRunResult> => {
        deadline.end(new Error("its lock lapsed"));
        return makeResult();
      },
    );

    await runWorkerTick(deadline);

    expect(engineService.processCompletedScan).toHaveBeenCalledTimes(1);
  });

  test("offers no scan when its deadline passed before it started, and still releases the lock", async () => {
    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    await runWorkerTick(deadline);

    expect(engineService.processCompletedScan).not.toHaveBeenCalled();
    expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
  });

  test("offers every scan while its deadline has not passed", async () => {
    await runWorkerTick(new JobDeadline());

    expect(offeredScanIds()).toEqual([
      PROJECT_A_SCAN_1_ID,
      PROJECT_A_SCAN_2_ID,
      PROJECT_B_SCAN_ID,
    ]);
  });
});

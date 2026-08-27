import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import NetworkDeviceAutoImportRuleEngineService from "Common/Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { AutoImportRuleRunResult } from "Common/Types/NetworkAutomation/RuleRunResult";

/*
 * The job exports no handler: it registers one at module load. Capture that
 * callback so each test can exercise a complete worker sweep without creating
 * a BullMQ repeatable job.
 */
type CronHandler = () => Promise<void>;

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
    isTruncated: false,
    hasMoreScans: false,
    isDryRun: false,
    matchedIpAddressSample: [],
    ...overrides,
  };
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["NetworkDeviceDiscovery:ProcessAutoImportRules"];

  if (!handler) {
    throw new Error(
      "NetworkDeviceDiscovery:ProcessAutoImportRules did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
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
});

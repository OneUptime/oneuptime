/*
 * AUTO IMPORT RULES AND A SCAN RUN AGAIN ON DEMAND (OneUptime issue #10334).
 *
 * The customer's reason for Run Again was as much the auto import rules as
 * the scan: "All Tablets Discovery" last ran days ago, and results older than
 * a day are never auto-imported - only a rule's Run Now reaches them - so new
 * tablets waited for someone to press it. Run Again gives the rules fresh
 * results instead: its run reports with a completedAt of now, and the
 * automatic path imports them within a minute, as it does any new result.
 *
 * And the window in between is pinned: from the probe's claim to the run's
 * first report, the row still holds the PREVIOUS run's hosts - with
 * completedAt cleared, so they would read as fresh. The previous run may have
 * failed (a failed run's marker is never stamped, so it is still NULL), or
 * ended weeks ago. The automatic path imports, renames and records nothing
 * from them, and stamps the row only while it still carries the claim
 * marker; a rule's Run Now skips it, as Review Results refuses it.
 *
 * Collaborators are stubbed at the module level, as in
 * NetworkDeviceAutoImportRuleEngineService.test.ts: pure in-memory rows.
 */

jest.mock("../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      getDevicesByHostnames: jest.fn(),
      updateOneById: jest.fn(),
      countBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/NetworkDeviceDiscoveryScanService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/NetworkDeviceAutoImportRuleService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/MonitorTemplateService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
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

import NetworkDeviceAutoImportRuleEngineService, {
  ExistingHostnamesByProjectId,
  MAX_RESULT_AGE_IN_HOURS,
} from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { AutoImportRuleRunResult } from "../../../Types/NetworkAutomation/RuleRunResult";
import {
  DISCOVERY_SCAN_STARTED_MESSAGE,
  isDiscoveryScanWaitingForFirstReport,
} from "../../../Utils/NetworkDiscovery/DiscoveryScanStatus";
import { beforeEach, describe, expect, it } from "@jest/globals";

if (typeof globalThis.setImmediate === "undefined") {
  (globalThis as Record<string, unknown>)["setImmediate"] = ((
    callback: () => void,
  ): ReturnType<typeof setTimeout> => {
    return setTimeout(callback, 0);
  }) as unknown as typeof globalThis.setImmediate;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "10334000-0000-4000-8000-0000000000b1",
);
const PROBE_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000b2");
const SCAN_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000b3");
const RULE_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000b4");

const createMock: jest.Mock =
  NetworkDeviceService.create as unknown as jest.Mock;
const deviceFindByMock: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const deviceFindOneByMock: jest.Mock =
  NetworkDeviceService.findOneBy as unknown as jest.Mock;
const deviceUpdateMock: jest.Mock =
  NetworkDeviceService.updateOneById as unknown as jest.Mock;
const devicesByHostnamesMock: jest.Mock =
  NetworkDeviceService.getDevicesByHostnames as unknown as jest.Mock;
const monitorFindByMock: jest.Mock =
  MonitorService.findBy as unknown as jest.Mock;
const monitorTemplateFindByMock: jest.Mock =
  MonitorTemplateService.findBy as unknown as jest.Mock;
const scanFindOneByMock: jest.Mock =
  NetworkDeviceDiscoveryScanService.findOneBy as unknown as jest.Mock;
const scanFindByMock: jest.Mock =
  NetworkDeviceDiscoveryScanService.findBy as unknown as jest.Mock;
const scanUpdateMock: jest.Mock =
  NetworkDeviceDiscoveryScanService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;
const ruleFindOneByMock: jest.Mock =
  NetworkDeviceAutoImportRuleService.findOneBy as unknown as jest.Mock;
const ruleFindByMock: jest.Mock =
  NetworkDeviceAutoImportRuleService.findBy as unknown as jest.Mock;
const semaphoreLockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

const THREE_DAYS_AGO: Date = OneUptimeDate.getSomeHoursAgo(72);

// The tablets the last run found three days ago, and the ones installed since.
const OLD_TABLETS: Array<DiscoveredNetworkDevice> = [
  { ipAddress: "10.16.0.45", snmpReachable: false },
  { ipAddress: "10.16.0.46", snmpReachable: false },
];
const NEW_TABLETS: Array<DiscoveredNetworkDevice> = [
  ...OLD_TABLETS,
  { ipAddress: "10.17.0.45", snmpReachable: false },
];

// All Tablets Discovery, an ICMP scan, as the engine selects it.
function tabletsScan(
  overrides: Record<string, unknown> = {},
): NetworkDeviceDiscoveryScan {
  return {
    id: SCAN_ID,
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    probeId: PROBE_ID,
    name: "All Tablets Discovery",
    cidr: "10.16-49.0-255.45-47",
    isSnmpEnabled: false,
    snmpConfigs: null,
    status: "Completed",
    completedAt: THREE_DAYS_AGO,
    autoImportProcessedAt: undefined,
    discoveredDevices: OLD_TABLETS,
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

/*
 * The scan from the probe's claim of the run Run Again queued until its
 * first report: the previous run's hosts, completedAt cleared, the claim
 * marker in its status message - and, after a failed run, an import marker
 * still NULL.
 */
function justClaimed(
  overrides: Record<string, unknown> = {},
): NetworkDeviceDiscoveryScan {
  return tabletsScan({
    status: "In Progress",
    statusMessage: DISCOVERY_SCAN_STARTED_MESSAGE,
    startedAt: OneUptimeDate.getCurrentDate(),
    completedAt: null,
    scannedHostCount: 1024,
    respondedHostCount: 2,
    ...overrides,
  });
}

// An import rule for the tablets, ping-only hosts included.
function tabletsRule(): NetworkDeviceAutoImportRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: "Import the tablets",
    isEnabled: true,
    isExclusion: false,
    ipMatchTarget: "10.16.0.0/12",
    includePingOnlyHosts: true,
  } as unknown as NetworkDeviceAutoImportRule;
}

function processScan(): Promise<AutoImportRuleRunResult | null> {
  const cache: ExistingHostnamesByProjectId = new Map();

  return NetworkDeviceAutoImportRuleEngineService.processCompletedScan({
    scanId: SCAN_ID,
    existingHostnamesByProjectId: cache,
  });
}

function importedAddresses(): Array<string> {
  return createMock.mock.calls.map((call: Array<unknown>): string => {
    return String(
      ((call[0] as { data: NetworkDevice }).data as NetworkDevice).hostname,
    );
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  // No device in the inventory yet; every create works.
  deviceFindByMock.mockResolvedValue([]);
  devicesByHostnamesMock.mockResolvedValue(new Map<string, NetworkDevice>());
  deviceFindOneByMock.mockResolvedValue(null);
  createMock.mockImplementation(
    ({ data }: { data: NetworkDevice }): Promise<NetworkDevice> => {
      data.id = data.id || ObjectID.generate();
      return Promise.resolve(data);
    },
  );
  monitorFindByMock.mockResolvedValue([]);
  monitorTemplateFindByMock.mockResolvedValue([]);
  scanUpdateMock.mockResolvedValue(undefined);
  ruleFindByMock.mockResolvedValue([tabletsRule()]);
  ruleFindOneByMock.mockResolvedValue(tabletsRule());
  semaphoreLockMock.mockResolvedValue({ id: "sweep-mutex" });
});

describe("a scan's previous run, while the run Run Again queued waits for its first report", () => {
  it("is what the shared predicate calls waiting, and nothing else is", () => {
    expect(isDiscoveryScanWaitingForFirstReport(justClaimed())).toBe(true);
    expect(
      isDiscoveryScanWaitingForFirstReport(
        justClaimed({ statusMessage: "Ping sweep: 2,048 of 8,704 swept." }),
      ),
    ).toBe(false);
    expect(
      isDiscoveryScanWaitingForFirstReport(
        tabletsScan({ statusMessage: DISCOVERY_SCAN_STARTED_MESSAGE }),
      ),
    ).toBe(false);
    expect(isDiscoveryScanWaitingForFirstReport(null)).toBe(false);
  });

  it("imports none of a failed previous run's hosts, though its marker is NULL and they read as fresh", async () => {
    scanFindOneByMock.mockResolvedValue(justClaimed());

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
    // Nothing renamed or recorded from them either.
    expect(deviceUpdateMock).not.toHaveBeenCalled();
    expect(devicesByHostnamesMock).not.toHaveBeenCalled();
  });

  it("stamps the row so the sweep stops reading it, only while it still carries the claim marker", async () => {
    scanFindOneByMock.mockResolvedValue(justClaimed());

    await processScan();

    expect(scanUpdateMock).toHaveBeenCalledTimes(1);

    const stamp: {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData: Record<string, unknown>;
    } = scanUpdateMock.mock.calls[0]![0];

    expect(stamp.id.toString()).toBe(SCAN_ID.toString());
    expect(Object.keys(stamp.data)).toEqual(["autoImportProcessedAt"]);
    expect(stamp.expectedData).toEqual({
      status: "In Progress",
      completedAt: null,
      scannedHostCount: 1024,
      respondedHostCount: 2,
      statusMessage: DISCOVERY_SCAN_STARTED_MESSAGE,
    });
  });

  it("reads the claim marker with the scan it is asked of", async () => {
    scanFindOneByMock.mockResolvedValue(justClaimed());

    await processScan();

    expect(scanFindOneByMock.mock.calls[0]![0].select).toMatchObject({
      statusMessage: true,
    });
  });

  it("is skipped by a rule's Run Now, which reaches every other result", async () => {
    scanFindByMock.mockResolvedValue([tabletsScan()]);
    scanFindOneByMock.mockResolvedValue(justClaimed());

    const result: AutoImportRuleRunResult =
      await NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans({
        ruleId: RULE_ID,
        projectId: PROJECT_ID,
        isDryRun: false,
      });

    expect(result.devicesCreated).toBe(0);
    expect(result.hostsEvaluated).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
    expect(scanFindOneByMock.mock.calls[0]![0].select).toMatchObject({
      statusMessage: true,
    });
  });
});

describe("the run Run Again queued, once it reports", () => {
  it("imports the hosts of its first progress report: they are this run's", async () => {
    scanFindOneByMock.mockResolvedValue(
      justClaimed({
        statusMessage: "Ping sweep: 2,048 of 8,704 addresses swept.",
        discoveredDevices: NEW_TABLETS,
        respondedHostCount: 3,
      }),
    );

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toMatchObject({ devicesCreated: 3 });
    expect(importedAddresses().sort()).toEqual(
      ["10.16.0.45", "10.16.0.46", "10.17.0.45"].sort(),
    );
  });

  it("imports its finished results as fresh: they completed now, not days ago", async () => {
    scanFindOneByMock.mockResolvedValue(
      tabletsScan({
        status: "Completed",
        completedAt: OneUptimeDate.getCurrentDate(),
        statusMessage: "Ping sweep finished.",
        discoveredDevices: NEW_TABLETS,
      }),
    );

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toMatchObject({ devicesCreated: 3 });
    expect(importedAddresses()).toContain("10.17.0.45");
  });

  it("where the same scan's last result, three days old, is stamped without importing - Run Now's alone to reach", async () => {
    expect(MAX_RESULT_AGE_IN_HOURS).toBeLessThan(72);
    scanFindOneByMock.mockResolvedValue(
      tabletsScan({ completedAt: THREE_DAYS_AGO }),
    );

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
    expect(scanUpdateMock).toHaveBeenCalledTimes(1);
  });
});

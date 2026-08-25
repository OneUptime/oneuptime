/*
 * Contract under test — the network device auto-import rule engine (issue
 * #3378): the automatic path that consumes one completed discovery scan
 * (processCompletedScan) and the manual "Run Now" / dry run
 * (applyRuleToCompletedScans).
 *
 * What these tests pin is the bookkeeping that makes automatic imports safe
 * to run every worker tick, because each piece fails silently on its own:
 *
 *   - the autoImportProcessedAt marker protocol: a stamped scan is never
 *     re-processed, every stamp is a compare-and-set on (status,
 *     completedAt), and a TRUNCATED pass deliberately leaves the marker NULL
 *     so the next tick resumes;
 *   - idempotency: an address already in the inventory is skipped, and a
 *     create that loses a race reads as "already registered", never as a
 *     renamed twin;
 *   - the name-collision retry: same device, fallback name, exactly once;
 *   - the jsonb write-back: only the created rows flip isAlreadyRegistered,
 *     everything else — junk rows included — passes through verbatim;
 *   - staleness: results older than MAX_RESULT_AGE_IN_HOURS are retired
 *     without importing (Run Now stays the deliberate path to old results);
 *   - a dry run evaluates everything and writes nothing.
 *
 * The collaborating singleton services are stubbed at the MODULE level
 * before the engine is imported — their real files reach Postgres through
 * DatabaseService (and PasswordHash, the local-only ts-jest compile
 * failure), and nothing here should touch either. Pure in-memory rows.
 */

jest.mock("../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
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
  MAX_DEVICES_PER_AUTO_IMPORT_RUN,
  MAX_RESULT_AGE_IN_HOURS,
} from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { AutoImportRuleRunResult } from "../../../Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it, beforeEach } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SCAN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

const createMock: jest.Mock =
  NetworkDeviceService.create as unknown as jest.Mock;
const deviceFindByMock: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const deviceFindOneByMock: jest.Mock =
  NetworkDeviceService.findOneBy as unknown as jest.Mock;
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

const RECENT_COMPLETED_AT: Date = OneUptimeDate.getCurrentDate();

/*
 * The scan as the engine selects it: identity, results, and the credential
 * columns the builder copies onto every SNMP device it creates.
 */
function makeScan(
  overrides: Record<string, unknown> = {},
): NetworkDeviceDiscoveryScan {
  return {
    id: SCAN_ID,
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    status: "Completed",
    completedAt: RECENT_COMPLETED_AT,
    autoImportProcessedAt: undefined,
    discoveredDevices: [],
    probeId: PROBE_ID,
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function makeRule(
  overrides: Record<string, unknown> = {},
): NetworkDeviceAutoImportRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: "Import the management subnet",
    isEnabled: true,
    isExclusion: false,
    ipMatchTarget: "10.0.0.0/24",
    ...overrides,
  } as unknown as NetworkDeviceAutoImportRule;
}

function makeHost(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: "10.0.0.5",
    sysName: "core-switch-01",
    sysDescr: "Cisco IOS Software, C2960X",
    ...overrides,
  };
}

function processScan(): Promise<AutoImportRuleRunResult | null> {
  const cache: ExistingHostnamesByProjectId = new Map();
  return NetworkDeviceAutoImportRuleEngineService.processCompletedScan({
    scanId: SCAN_ID,
    existingHostnamesByProjectId: cache,
  });
}

function runRule(isDryRun: boolean): Promise<AutoImportRuleRunResult> {
  return NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans({
    ruleId: RULE_ID,
    projectId: PROJECT_ID,
    isDryRun: isDryRun,
  });
}

// The device the engine handed to NetworkDeviceService.create, per call.
function createdDevice(callIndex: number): NetworkDevice {
  return createMock.mock.calls[callIndex]![0].data as NetworkDevice;
}

beforeEach(() => {
  jest.clearAllMocks();

  /*
   * An empty inventory, a working create, a working stamp — the happy
   * defaults each test narrows as needed.
   */
  deviceFindByMock.mockResolvedValue([]);
  deviceFindOneByMock.mockResolvedValue(null);
  createMock.mockResolvedValue({});
  scanUpdateMock.mockResolvedValue(undefined);
  ruleFindByMock.mockResolvedValue([makeRule()]);
});

describe("NetworkDeviceAutoImportRuleEngineService.processCompletedScan", () => {
  /*
   * The marker is the "these exact results were already consumed" signal;
   * re-processing a stamped scan every tick would re-evaluate (and re-log)
   * the same results forever.
   */
  it("does nothing for a scan whose marker is already stamped", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({ autoImportProcessedAt: OneUptimeDate.getCurrentDate() }),
    );

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toBeNull();
    expect(ruleFindByMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(scanUpdateMock).not.toHaveBeenCalled();
  });

  it("does nothing when the scan is gone", async () => {
    scanFindOneByMock.mockResolvedValue(null);

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
    expect(scanUpdateMock).not.toHaveBeenCalled();
  });

  /*
   * With no import rules nothing can ever import, so the results are
   * retired (stamped) rather than left to accumulate as an ever-growing
   * unprocessed backlog — and the stamp is a compare-and-set on the exact
   * (status, completedAt) this pass read, so it can never retire results it
   * did not see.
   */
  it("stamps the marker and creates nothing when the project has no import rules", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({ discoveredDevices: [makeHost()] }),
    );
    // Only an exclusion rule: vetoes exist, nothing can import.
    ruleFindByMock.mockResolvedValue([makeRule({ isExclusion: true })]);

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();

    expect(scanUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall: any = scanUpdateMock.mock.calls[0]![0];
    expect(updateCall.id.toString()).toBe(SCAN_ID.toString());
    expect(updateCall.data.autoImportProcessedAt).toBeInstanceOf(Date);
    // Nothing was created, so the stored results are not rewritten.
    expect(Object.keys(updateCall.data)).toEqual(["autoImportProcessedAt"]);
    expect(updateCall.expectedData).toEqual({
      status: "Completed",
      completedAt: RECENT_COMPLETED_AT,
    });
  });

  it("imports the matching host and flips only its row in the write-back", async () => {
    /*
     * Kept as references: the write-back contract is about identity, not
     * just shape — untouched rows (junk included) must pass through
     * verbatim so the stored jsonb stays exactly what the probe sent.
     */
    const junkRow: DiscoveredNetworkDevice =
      null as unknown as DiscoveredNetworkDevice;
    const matchingRow: DiscoveredNetworkDevice = makeHost();
    const unmatchedRow: DiscoveredNetworkDevice = makeHost({
      ipAddress: "192.168.1.5",
      sysName: "printer-01",
    });

    scanFindOneByMock.mockResolvedValue(
      makeScan({ discoveredDevices: [junkRow, matchingRow, unmatchedRow] }),
    );

    const result: AutoImportRuleRunResult | null = await processScan();

    // The junk row is dropped from evaluation, not from storage.
    expect(result).toMatchObject({
      hostsEvaluated: 2,
      hostsMatched: 1,
      hostsExcluded: 0,
      hostsSkippedAlreadyRegistered: 0,
      devicesCreated: 1,
      devicesFailed: 0,
      isTruncated: false,
      isDryRun: false,
      matchedIpAddressSample: ["10.0.0.5"],
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const device: NetworkDevice = createdDevice(0);
    // The address is the hostname AND the dedup key downstream.
    expect(device.hostname).toBe("10.0.0.5");
    expect(device.name).toBe("core-switch-01");
    expect(device.projectId?.toString()).toBe(PROJECT_ID.toString());
    // Built from THIS scan: the scan's credentials rode along.
    expect(device.snmpVersion).toBe("V2c");
    expect(createMock.mock.calls[0]![0].props).toEqual({ isRoot: true });

    expect(scanUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall: any = scanUpdateMock.mock.calls[0]![0];
    expect(updateCall.data.autoImportProcessedAt).toBeInstanceOf(Date);

    const restamped: Array<unknown> = updateCall.data.discoveredDevices;
    expect(restamped).toHaveLength(3);
    expect(restamped[0]).toBeNull();
    // The created row flips its flag so the Review dialog stops offering it.
    expect(restamped[1]).toEqual({
      ...matchingRow,
      isAlreadyRegistered: true,
    });
    // The unmatched row is the SAME object, not a rewritten copy.
    expect(restamped[2]).toBe(unmatchedRow);
  });

  /*
   * Recurring scans re-report the same hosts every interval; seeing the
   * same results twice must create nothing twice.
   */
  it("skips a host whose address is already in the inventory", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({ discoveredDevices: [makeHost()] }),
    );
    deviceFindByMock.mockResolvedValue([
      { hostname: "10.0.0.5" } as unknown as NetworkDevice,
    ]);

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toMatchObject({
      hostsEvaluated: 1,
      hostsMatched: 1,
      hostsSkippedAlreadyRegistered: 1,
      devicesCreated: 0,
    });
    expect(createMock).not.toHaveBeenCalled();

    // Nothing created, so the stamp carries the marker alone.
    const updateCall: any = scanUpdateMock.mock.calls[0]![0];
    expect(Object.keys(updateCall.data)).toEqual(["autoImportProcessedAt"]);
  });

  describe("the create-failure protocol", () => {
    /*
     * Names are unique per project while addresses are not, and two devices
     * legitimately sharing a sysName is common on real estates. When the
     * ADDRESS is still free after a failed create, the name was the problem
     * — one retry under the address-suffixed fallback settles it.
     */
    it("retries a name collision once under the fallback name", async () => {
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      createMock
        .mockRejectedValueOnce(
          new BadDataException("Network Device with this name already exists."),
        )
        .mockResolvedValueOnce({});
      // The address re-check finds nothing: the name really was the problem.
      deviceFindOneByMock.mockResolvedValue(null);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(createMock).toHaveBeenCalledTimes(2);
      // Same device both times; only the name changed.
      expect(createdDevice(0).name).toBe("core-switch-01");
      expect(createdDevice(1).name).toBe("core-switch-01 (10.0.0.5)");
      expect(createdDevice(1).name!.endsWith(" (10.0.0.5)")).toBe(true);
      expect(createdDevice(1).hostname).toBe("10.0.0.5");

      expect(result).toMatchObject({
        devicesCreated: 1,
        devicesFailed: 0,
        hostsSkippedAlreadyRegistered: 0,
      });
    });

    /*
     * Losing a race to a concurrent import of the SAME host must read as
     * "already registered" — retrying under a new name here would spawn a
     * renamed twin of a device that now exists.
     */
    it("reads a lost create race as already-registered, with no rename retry", async () => {
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      createMock.mockRejectedValueOnce(
        new BadDataException("Network Device with this name already exists."),
      );
      // The address re-check finds a device: someone imported it meanwhile.
      deviceFindOneByMock.mockResolvedValue({
        id: new ObjectID("44444444-4444-4444-8444-444444444444"),
      } as unknown as NetworkDevice);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        hostsMatched: 1,
        hostsSkippedAlreadyRegistered: 1,
        devicesCreated: 0,
        devicesFailed: 0,
      });
    });
  });

  /*
   * The cap turns "a typo'd rule meets a huge subnet" into a few paced
   * worker ticks instead of one burst of thousands of creates — and the
   * UNSTAMPED marker is what makes the next tick resume where this one
   * stopped, with idempotency skipping everything already created.
   */
  it("stops at the device cap and leaves the marker unstamped so the next tick resumes", async () => {
    const hosts: Array<DiscoveredNetworkDevice> = [];
    for (let i: number = 0; i < MAX_DEVICES_PER_AUTO_IMPORT_RUN + 2; i++) {
      hosts.push(
        makeHost({
          ipAddress: `10.0.${Math.floor(i / 256)}.${i % 256}`,
          sysName: `switch-${i}`,
        }),
      );
    }

    scanFindOneByMock.mockResolvedValue(makeScan({ discoveredDevices: hosts }));
    ruleFindByMock.mockResolvedValue([
      makeRule({ ipMatchTarget: "10.0.0.0/8" }),
    ]);

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(createMock).toHaveBeenCalledTimes(MAX_DEVICES_PER_AUTO_IMPORT_RUN);
    expect(result).toMatchObject({
      devicesCreated: MAX_DEVICES_PER_AUTO_IMPORT_RUN,
      isTruncated: true,
    });

    // The write-back still retires what WAS created…
    expect(scanUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall: any = scanUpdateMock.mock.calls[0]![0];
    expect(updateCall.data.discoveredDevices).toHaveLength(hosts.length);
    // …but the marker stays NULL: this scan is not done.
    expect(Object.keys(updateCall.data)).not.toContain("autoImportProcessedAt");
  });

  /*
   * A late result can land on a reaper-Failed scan hours after its sweep,
   * and a worker outage leaves a backlog; silently importing an hours-old
   * host list is the wrong surprise. Old results are retired unimported —
   * Run Now remains the deliberate way to reach them.
   */
  it("stamps results older than MAX_RESULT_AGE_IN_HOURS without importing", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({
        discoveredDevices: [makeHost()],
        completedAt: OneUptimeDate.getSomeHoursAgo(MAX_RESULT_AGE_IN_HOURS + 1),
      }),
    );

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();

    expect(scanUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall: any = scanUpdateMock.mock.calls[0]![0];
    expect(Object.keys(updateCall.data)).toEqual(["autoImportProcessedAt"]);
  });
});

describe("NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans", () => {
  it("evaluates everything and writes nothing on a dry run", async () => {
    ruleFindOneByMock.mockResolvedValue(makeRule());
    /*
     * The project's enabled rules: an exclusion that must still veto, and
     * an UNRELATED import rule that must NOT ride along — Run Now applies
     * ONE rule, not the whole rule set.
     */
    ruleFindByMock.mockResolvedValue([
      makeRule({
        id: new ObjectID("55555555-5555-4555-8555-555555555555"),
        isExclusion: true,
        ipMatchTarget: "10.0.0.9",
      }),
      makeRule({
        id: new ObjectID("66666666-6666-4666-8666-666666666666"),
        ipMatchTarget: "192.168.0.0/16",
      }),
    ]);
    scanFindByMock.mockResolvedValue([
      makeScan({
        discoveredDevices: [
          makeHost(),
          makeHost({ ipAddress: "10.0.0.9", sysName: "phone-01" }),
          makeHost({ ipAddress: "192.168.1.5", sysName: "printer-01" }),
        ],
      }),
    ]);

    const result: AutoImportRuleRunResult = await runRule(true);

    expect(result).toMatchObject({
      hostsEvaluated: 3,
      // Only the run rule's subnet — the other import rule did not apply.
      hostsMatched: 1,
      // "Run Now" is not a way around a veto.
      hostsExcluded: 1,
      devicesCreated: 0,
      isDryRun: true,
      isTruncated: false,
    });
    // The operator's "which hosts would this claim" answer.
    expect(result.matchedIpAddressSample).toEqual(["10.0.0.5"]);

    expect(createMock).not.toHaveBeenCalled();
    // No creates, so no write-back either: a dry run touches no row.
    expect(scanUpdateMock).not.toHaveBeenCalled();
  });

  it("creates devices and writes the flags back on a real run", async () => {
    ruleFindOneByMock.mockResolvedValue(makeRule());
    ruleFindByMock.mockResolvedValue([]);
    scanFindByMock.mockResolvedValue([
      makeScan({ discoveredDevices: [makeHost()] }),
    ]);

    const result: AutoImportRuleRunResult = await runRule(false);

    expect(result).toMatchObject({
      hostsMatched: 1,
      devicesCreated: 1,
      isDryRun: false,
    });
    expect(createMock).toHaveBeenCalledTimes(1);

    /*
     * The write-back retires the imported host for the Review dialog, but
     * the MARKER is deliberately not stamped: a manual run of one rule has
     * not done what the full rule set would, so the automatic path must
     * still get its turn at these results.
     */
    expect(scanUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall: any = scanUpdateMock.mock.calls[0]![0];
    expect(Object.keys(updateCall.data)).toEqual(["discoveredDevices"]);
  });

  /*
   * An exclusion rule imports nothing by itself, so "running" it can only
   * mislead — the refusal explains what to run instead.
   */
  it("refuses to run an exclusion rule", async () => {
    ruleFindOneByMock.mockResolvedValue(makeRule({ isExclusion: true }));

    await expect(runRule(false)).rejects.toThrow(BadDataException);
    expect(scanFindByMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("refuses to run a disabled rule", async () => {
    ruleFindOneByMock.mockResolvedValue(makeRule({ isEnabled: false }));

    await expect(runRule(false)).rejects.toThrow(BadDataException);
    expect(scanFindByMock).not.toHaveBeenCalled();
  });

  it("rejects a rule id that does not resolve in the project", async () => {
    ruleFindOneByMock.mockResolvedValue(null);

    await expect(runRule(false)).rejects.toThrow("Auto-import rule not found.");
  });
});

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
 *     completedAt), and a truncated pass that made PROGRESS leaves the
 *     marker NULL so the next tick resumes — while a truncated pass that
 *     created nothing stamps anyway, or the sweep would repeat the same
 *     doomed pass forever;
 *   - the sweep lock: a real Run Now holds the same Redis lock as the
 *     worker sweep (the check-then-create idempotency has no DB backstop),
 *     dry runs never touch it, and the lock is released even when the run
 *     body throws;
 *   - idempotency: an address already in the inventory is skipped, and a
 *     create that loses a race reads as "already registered", never as a
 *     renamed twin;
 *   - the name-collision retry: same device, fallback name, exactly once;
 *   - the jsonb write-back: only the created rows flip isAlreadyRegistered,
 *     everything else — junk rows included — passes through verbatim;
 *   - staleness: results older than MAX_RESULT_AGE_IN_HOURS are retired
 *     without importing (Run Now stays the deliberate path to old results);
 *   - a dry run evaluates everything, writes nothing, and is bounded by the
 *     SAME attempt budget as the real run it predicts.
 *
 * The collaborating singleton services — and the Semaphore module, which
 * would otherwise reach Redis — are stubbed at the MODULE level before the
 * engine is imported: their real files reach Postgres through
 * DatabaseService (and PasswordHash, the local-only ts-jest compile
 * failure), and nothing here should touch any of it. Pure in-memory rows.
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
  AUTO_IMPORT_SWEEP_LOCK_KEY,
  AUTO_IMPORT_SWEEP_LOCK_NAMESPACE,
  AUTO_IMPORT_SWEEP_LOCK_TIMEOUT_MS,
  ExistingHostnamesByProjectId,
  MAX_DEVICES_PER_AUTO_IMPORT_RUN,
  MAX_RESULT_AGE_IN_HOURS,
  MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN,
} from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import {
  AutoImportRuleRunResult,
  MAX_MATCHED_IP_SAMPLE,
} from "../../../Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it, beforeEach } from "@jest/globals";

/*
 * The engine yields the event loop between scans via setImmediate — a Node
 * global that jsdom (this repo's jest environment) does not provide, though
 * every real runtime for Server code does. Polyfilled here so the yield
 * stays a yield.
 */
if (typeof globalThis.setImmediate === "undefined") {
  (globalThis as Record<string, unknown>)["setImmediate"] = ((
    callback: () => void,
  ): ReturnType<typeof setTimeout> => {
    return setTimeout(callback, 0);
  }) as unknown as typeof globalThis.setImmediate;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SCAN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

// What the mocked Semaphore.lock hands back and release must get back.
const FAKE_MUTEX: { id: string } = { id: "fake-sweep-mutex" };

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
const semaphoreLockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const semaphoreReleaseMock: jest.Mock =
  Semaphore.release as unknown as jest.Mock;
const loggerErrorMock: jest.Mock = logger.error as unknown as jest.Mock;

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

// Enough unique in-target addresses to overrun the attempt budget.
function makeHostsBeyondTheCap(): Array<DiscoveredNetworkDevice> {
  const hosts: Array<DiscoveredNetworkDevice> = [];

  for (let i: number = 0; i < MAX_DEVICES_PER_AUTO_IMPORT_RUN + 2; i++) {
    hosts.push(
      makeHost({
        ipAddress: `10.0.${Math.floor(i / 256)}.${i % 256}`,
        sysName: `switch-${i}`,
      }),
    );
  }

  return hosts;
}

/*
 * Run Now reads scans in two phases: an {_id}-only stub listing, then one
 * full re-read per stub — so only one multi-megabyte result set is ever
 * resident. This wires both phases: findBy answers with stubs, findOneBy
 * hands the full rows out one per call (null entries model a scan that
 * vanished between the phases).
 */
function mockRunNowScans(
  scans: Array<NetworkDeviceDiscoveryScan | null>,
): void {
  scanFindByMock.mockResolvedValue(
    scans.map((_scan: NetworkDeviceDiscoveryScan | null, index: number) => {
      const suffix: string = index.toString(16).padStart(12, "0");
      return {
        id: new ObjectID(`00000000-0000-4000-8000-${suffix}`),
      } as unknown as NetworkDeviceDiscoveryScan;
    }),
  );

  let nextScanIndex: number = 0;
  scanFindOneByMock.mockImplementation(() => {
    return Promise.resolve(scans[nextScanIndex++] ?? null);
  });
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
   * An empty inventory, a working create, a working stamp, an acquirable
   * lock — the happy defaults each test narrows as needed.
   */
  deviceFindByMock.mockResolvedValue([]);
  deviceFindOneByMock.mockResolvedValue(null);
  createMock.mockResolvedValue({});
  scanUpdateMock.mockResolvedValue(undefined);
  ruleFindByMock.mockResolvedValue([makeRule()]);
  semaphoreLockMock.mockResolvedValue(FAKE_MUTEX);
  semaphoreReleaseMock.mockResolvedValue(undefined);
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
    /*
     * Zero-touch pipeline: nobody reviews an auto-imported device, so the
     * vendor-template banner would never be clicked — the engine opts the
     * device into the poll-time auto-apply instead.
     */
    expect(device.autoApplyVendorHealthTemplate).toBe(true);
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

  /*
   * An over-long "address" is junk that would fail the varchar(100)
   * hostname on every pass, identically, forever — so it is refused before
   * any counting rather than logged as a devicesFailed per worker tick.
   */
  it("skips a host whose address could never be a hostname, before any counting", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({
        discoveredDevices: [
          makeHost({ ipAddress: "9".repeat(101) }),
          makeHost(),
        ],
      }),
    );

    const result: AutoImportRuleRunResult | null = await processScan();

    // The junk row was never evaluated, let alone matched or attempted.
    expect(result).toMatchObject({
      hostsEvaluated: 1,
      hostsMatched: 1,
      devicesCreated: 1,
      devicesFailed: 0,
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createdDevice(0).hostname).toBe("10.0.0.5");
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
    const hosts: Array<DiscoveredNetworkDevice> = makeHostsBeyondTheCap();

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
   * The resume protocol's other half: a truncated pass that created NOTHING
   * — every attempt failed — is stamped anyway. Leaving the marker NULL
   * would have the sweep repeat the identical doomed pass every tick
   * forever; the operator gets an error log and Run Now instead.
   */
  it("stamps a zero-progress truncated pass instead of retrying it forever", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({ discoveredDevices: makeHostsBeyondTheCap() }),
    );
    ruleFindByMock.mockResolvedValue([
      makeRule({ ipMatchTarget: "10.0.0.0/8" }),
    ]);
    // Every create fails, first attempt and fallback-name retry alike…
    createMock.mockRejectedValue(new BadDataException("create is broken"));
    // …and the address re-check keeps saying the host is NOT registered.
    deviceFindOneByMock.mockResolvedValue(null);

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toMatchObject({
      devicesCreated: 0,
      devicesFailed: MAX_DEVICES_PER_AUTO_IMPORT_RUN,
      isTruncated: true,
    });

    // The marker IS stamped: this pass is retired, not resumed.
    expect(scanUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall: any = scanUpdateMock.mock.calls[0]![0];
    expect(Object.keys(updateCall.data)).toEqual(["autoImportProcessedAt"]);

    // And the operator is told, loudly, why nothing imported.
    expect(
      loggerErrorMock.mock.calls.some((call: Array<unknown>) => {
        return String(call[0]).includes("every create failing");
      }),
    ).toBe(true);
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
    mockRunNowScans([
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
      hasMoreScans: false,
    });
    // The operator's "which hosts would this claim" answer.
    expect(result.matchedIpAddressSample).toEqual(["10.0.0.5"]);

    expect(createMock).not.toHaveBeenCalled();
    // No creates, so no write-back either: a dry run touches no row.
    expect(scanUpdateMock).not.toHaveBeenCalled();
    // And no lock: a run that writes nothing has nothing to serialize.
    expect(semaphoreLockMock).not.toHaveBeenCalled();
  });

  /*
   * The two-phase scan read: the listing is {_id} stubs only, and each scan
   * is re-read individually with its status re-checked — so one manual run
   * never holds every scan's multi-megabyte jsonb at once, and never
   * evaluates a scan that was re-queued after the listing.
   */
  it("lists scan stubs first and re-reads each scan with a status re-check", async () => {
    ruleFindOneByMock.mockResolvedValue(makeRule());
    ruleFindByMock.mockResolvedValue([]);
    mockRunNowScans([makeScan({ discoveredDevices: [makeHost()] })]);

    await runRule(true);

    expect(scanFindByMock).toHaveBeenCalledTimes(1);
    const listCall: any = scanFindByMock.mock.calls[0]![0];
    expect(listCall.select).toEqual({ _id: true });
    // One extra row settles "were there more scans" honestly.
    expect(listCall.limit).toBe(MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN + 1);

    expect(scanFindOneByMock).toHaveBeenCalledTimes(1);
    const rereadCall: any = scanFindOneByMock.mock.calls[0]![0];
    expect(rereadCall.query.status).toBe("Completed");
    expect(rereadCall.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(rereadCall.select.discoveredDevices).toBe(true);
  });

  it("skips a scan that vanished between the stub listing and the re-read", async () => {
    ruleFindOneByMock.mockResolvedValue(makeRule());
    ruleFindByMock.mockResolvedValue([]);
    // First stub's re-read finds nothing; the second still evaluates.
    mockRunNowScans([null, makeScan({ discoveredDevices: [makeHost()] })]);

    const result: AutoImportRuleRunResult = await runRule(true);

    expect(scanFindOneByMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      hostsEvaluated: 1,
      hostsMatched: 1,
    });
  });

  /*
   * Scan-count truncation is its own flag, not isTruncated: the advice
   * differs (re-running re-reads the same newest scans; only the device cap
   * is resumable by running again).
   */
  it("reports hasMoreScans, not isTruncated, when the project has more scans than one run reads", async () => {
    ruleFindOneByMock.mockResolvedValue(makeRule());
    ruleFindByMock.mockResolvedValue([]);
    mockRunNowScans(
      Array.from(
        { length: MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN + 1 },
        (): NetworkDeviceDiscoveryScan => {
          return makeScan({ discoveredDevices: [] });
        },
      ),
    );

    const result: AutoImportRuleRunResult = await runRule(true);

    expect(result.hasMoreScans).toBe(true);
    expect(result.isTruncated).toBe(false);
    // The extra row was only a probe: it is not read as a scan.
    expect(scanFindOneByMock).toHaveBeenCalledTimes(
      MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN,
    );
  });

  /*
   * A dry run must promise what a real run would DO — and a host listed on
   * duplicate rows (or in two overlapping scans) imports once, so the dry
   * run counts it once and reads its later appearances as already
   * registered.
   */
  it("counts a host listed twice as one import and one skip on a dry run", async () => {
    ruleFindOneByMock.mockResolvedValue(makeRule());
    ruleFindByMock.mockResolvedValue([]);
    mockRunNowScans([
      makeScan({ discoveredDevices: [makeHost(), makeHost()] }),
    ]);

    const result: AutoImportRuleRunResult = await runRule(true);

    expect(result).toMatchObject({
      hostsEvaluated: 2,
      hostsMatched: 2,
      hostsSkippedAlreadyRegistered: 1,
      devicesCreated: 0,
      isDryRun: true,
    });
    expect(result.matchedIpAddressSample).toEqual(["10.0.0.5"]);
  });

  /*
   * The attempt budget bounds dry runs too: a dry run over a /16 walks the
   * same capped amount of work inside its API request as the real run it
   * predicts, and says so through the same flag.
   */
  it("bounds a dry run by the device cap and reports the truncation", async () => {
    ruleFindOneByMock.mockResolvedValue(
      makeRule({ ipMatchTarget: "10.0.0.0/8" }),
    );
    ruleFindByMock.mockResolvedValue([]);
    mockRunNowScans([makeScan({ discoveredDevices: makeHostsBeyondTheCap() })]);

    const result: AutoImportRuleRunResult = await runRule(true);

    expect(result).toMatchObject({
      isTruncated: true,
      devicesCreated: 0,
      isDryRun: true,
    });
    expect(result.matchedIpAddressSample).toHaveLength(MAX_MATCHED_IP_SAMPLE);
    expect(createMock).not.toHaveBeenCalled();
    expect(scanUpdateMock).not.toHaveBeenCalled();
  });

  describe("a real run and the sweep lock", () => {
    /*
     * The engine's idempotency is check-then-create with no DB backstop, so
     * a real Run Now must hold the SAME Redis lock as the worker sweep —
     * manual-vs-sweep and manual-vs-manual can never interleave.
     */
    it("creates devices under the sweep lock and releases it after", async () => {
      ruleFindOneByMock.mockResolvedValue(makeRule());
      ruleFindByMock.mockResolvedValue([]);
      mockRunNowScans([makeScan({ discoveredDevices: [makeHost()] })]);

      const result: AutoImportRuleRunResult = await runRule(false);

      expect(result).toMatchObject({
        hostsMatched: 1,
        devicesCreated: 1,
        isDryRun: false,
        hasMoreScans: false,
      });
      expect(createMock).toHaveBeenCalledTimes(1);

      // The worker's lock, by the shared constants — never a lookalike.
      expect(semaphoreLockMock).toHaveBeenCalledTimes(1);
      expect(semaphoreLockMock.mock.calls[0]![0]).toMatchObject({
        key: AUTO_IMPORT_SWEEP_LOCK_KEY,
        namespace: AUTO_IMPORT_SWEEP_LOCK_NAMESPACE,
        lockTimeout: AUTO_IMPORT_SWEEP_LOCK_TIMEOUT_MS,
      });
      expect(semaphoreReleaseMock).toHaveBeenCalledTimes(1);
      expect(semaphoreReleaseMock).toHaveBeenCalledWith(FAKE_MUTEX);

      /*
       * The write-back retires the imported host for the Review dialog, but
       * the MARKER is deliberately not stamped: a manual run of one rule
       * has not done what the full rule set would, so the automatic path
       * must still get its turn at these results.
       */
      expect(scanUpdateMock).toHaveBeenCalledTimes(1);
      const updateCall: any = scanUpdateMock.mock.calls[0]![0];
      expect(Object.keys(updateCall.data)).toEqual(["discoveredDevices"]);
    });

    /*
     * A held lock means the sweep is importing right now; failing fast with
     * an explanation beats blocking an API request behind a sweep that may
     * run for minutes.
     */
    it("refuses a real run when the sweep lock cannot be acquired", async () => {
      ruleFindOneByMock.mockResolvedValue(makeRule());
      semaphoreLockMock.mockRejectedValue(new Error("lock is held"));

      await expect(runRule(false)).rejects.toThrow(BadDataException);
      await expect(runRule(false)).rejects.toThrow(
        /automatic import sweep is currently running/,
      );

      expect(scanFindByMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
      // No lock was acquired, so there is nothing to release.
      expect(semaphoreReleaseMock).not.toHaveBeenCalled();
    });

    // A leaked sweep lock blocks every future run AND the worker sweep.
    it("releases the lock even when the run body throws", async () => {
      ruleFindOneByMock.mockResolvedValue(makeRule());
      // The first thing the run body does is load the exclusion rules.
      ruleFindByMock.mockRejectedValue(new Error("database is down"));

      await expect(runRule(false)).rejects.toThrow("database is down");

      expect(semaphoreLockMock).toHaveBeenCalledTimes(1);
      expect(semaphoreReleaseMock).toHaveBeenCalledTimes(1);
      expect(semaphoreReleaseMock).toHaveBeenCalledWith(FAKE_MUTEX);
    });
  });

  describe("rule resolution", () => {
    /*
     * The point of a dry run: answer "what would this rule import" BEFORE
     * enabling it against live scans. Only a real run of a disabled rule
     * contradicts the toggle next to the button.
     */
    it("dry-runs a disabled rule", async () => {
      ruleFindOneByMock.mockResolvedValue(makeRule({ isEnabled: false }));
      ruleFindByMock.mockResolvedValue([]);
      mockRunNowScans([makeScan({ discoveredDevices: [makeHost()] })]);

      const result: AutoImportRuleRunResult = await runRule(true);

      expect(result).toMatchObject({
        hostsEvaluated: 1,
        hostsMatched: 1,
        devicesCreated: 0,
        isDryRun: true,
      });
      expect(createMock).not.toHaveBeenCalled();
      expect(scanUpdateMock).not.toHaveBeenCalled();
      expect(semaphoreLockMock).not.toHaveBeenCalled();
    });

    it("refuses a REAL run of a disabled rule, pointing at Dry Run", async () => {
      ruleFindOneByMock.mockResolvedValue(makeRule({ isEnabled: false }));

      await expect(runRule(false)).rejects.toThrow(
        "This auto-import rule is disabled. Enable it before running it, or use Dry Run to preview what it would import.",
      );
      expect(scanFindByMock).not.toHaveBeenCalled();
      expect(semaphoreLockMock).not.toHaveBeenCalled();
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
      expect(semaphoreLockMock).not.toHaveBeenCalled();
    });

    it("rejects a rule id that does not resolve in the project", async () => {
      ruleFindOneByMock.mockResolvedValue(null);

      await expect(runRule(false)).rejects.toThrow(
        "Auto-import rule not found.",
      );
    });
  });
});

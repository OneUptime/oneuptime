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
      getDevicesByHostnames: jest.fn(),
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
  AUTO_IMPORT_SWEEP_LOCK_KEY,
  AUTO_IMPORT_SWEEP_LOCK_NAMESPACE,
  AUTO_IMPORT_SWEEP_LOCK_TIMEOUT_MS,
  ExistingHostnamesByProjectId,
  ImportAttemptBudgetsByProjectId,
  MAX_DEVICES_PER_AUTO_IMPORT_RUN,
  MAX_MONITORS_PER_AUTO_IMPORT_RUN,
  MAX_RESULT_AGE_IN_HOURS,
  MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN,
} from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { DiscoveryScanSnmpConfig } from "../../../Utils/NetworkDiscovery/SnmpScanConfigUtil";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
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
const TEMPLATE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const TEMPLATE_DEVICE_ID: string = "99999999-9999-4999-8999-999999999999";

// What the mocked Semaphore.lock hands back and release must get back.
const FAKE_MUTEX: { id: string } = { id: "fake-sweep-mutex" };

const createMock: jest.Mock =
  NetworkDeviceService.create as unknown as jest.Mock;
const deviceFindByMock: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const deviceFindOneByMock: jest.Mock =
  NetworkDeviceService.findOneBy as unknown as jest.Mock;
/*
 * "Which of THESE addresses already have a device", asked of the database per
 * scan. It replaced a paged walk of every device in the project — which sorted
 * by `createdAt`, a value a bulk import stamps identically on every row it
 * creates, so its pages overlapped and skipped and a missed hostname created a
 * DUPLICATE device.
 *
 * Backed by the same `deviceFindByMock` fixtures every case already sets up, so
 * a test still says "the inventory contains these devices" and this narrows
 * them the way the real query does.
 */
const devicesByHostnamesMock: jest.Mock =
  NetworkDeviceService.getDevicesByHostnames as unknown as jest.Mock;
const monitorCreateMock: jest.Mock =
  MonitorService.create as unknown as jest.Mock;
const monitorFindByMock: jest.Mock =
  MonitorService.findBy as unknown as jest.Mock;
const monitorFindOneByMock: jest.Mock =
  MonitorService.findOneBy as unknown as jest.Mock;
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
const semaphoreReleaseMock: jest.Mock =
  Semaphore.release as unknown as jest.Mock;
const loggerErrorMock: jest.Mock = logger.error as unknown as jest.Mock;

const RECENT_COMPLETED_AT: Date = OneUptimeDate.getCurrentDate();

/*
 * The scan's credential sets (issue #3458), and the ids the probe stamps onto
 * a discovered host to record which one answered it. Opaque literals, because
 * that is how they are really used — written into the scan's jsonb by the
 * form, copied onto a host by the probe, and looked up again here, in another
 * process, out of a list the operator may have reordered since. Nothing may
 * treat them as positions.
 *
 * The two sets share no credential value, so a device built with the wrong one
 * shows up as a wrong value rather than as a coincidence that still passes.
 */
const ACCESS_SNMP_CONFIG_ID: string = "access-switches-v2c";
const CORE_SNMP_CONFIG_ID: string = "core-routers-v3";

const ACCESS_SNMP_CONFIG: DiscoveryScanSnmpConfig = {
  id: ACCESS_SNMP_CONFIG_ID,
  name: "Access switches",
  snmpVersion: "V2c",
  snmpCommunityString: "public",
  snmpPort: 161,
};

const CORE_SNMP_CONFIG: DiscoveryScanSnmpConfig = {
  id: CORE_SNMP_CONFIG_ID,
  name: "Core routers",
  snmpVersion: "V3",
  snmpPort: 1161,
  snmpV3SecurityLevel: "authPriv",
  snmpV3Username: "core-observer",
  snmpV3AuthProtocol: "SHA",
  snmpV3AuthKey: "core-auth-key",
  snmpV3PrivProtocol: "AES",
  snmpV3PrivKey: "core-priv-key",
};

/*
 * The scan as the engine selects it: identity, results, and the credential
 * columns the builder copies onto every SNMP device it creates.
 *
 * It carries BOTH halves of the credential story, exactly as a saved scan
 * does: the ordered `snmpConfigs` list, and the flattened mirror of its FIRST
 * entry. The service writes that mirror on every save so a probe deployed a
 * version behind still has something to sweep with — which also means a
 * fixture with only the flattened half could not tell an engine that resolves
 * each host's own credentials from one that just copies the scan row.
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
    snmpConfigs: [ACCESS_SNMP_CONFIG],
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

function makeMonitorSteps(
  networkDeviceId: string = TEMPLATE_DEVICE_ID,
): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    networkDeviceId: networkDeviceId,
    monitorInterfaces: true,
    collectEndpoints: true,
    oids: [
      {
        oid: "1.3.6.1.2.1.1.3.0",
        name: "sysUpTime",
        description: "System uptime",
      },
    ],
  };

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: new ObjectID(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ),
  };
  return monitorSteps;
}

function makeTemplate(
  overrides: Record<string, unknown> = {},
): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.templateName = "Core switch health";
  template.monitorName = "SNMP health";
  template.monitorDescription = "Provisioned from discovery";
  template.monitorType = MonitorType.NetworkDevice;
  template.monitorSteps = makeMonitorSteps();
  template.monitoringInterval = "*/5 * * * *";
  template.minimumProbeAgreement = 2;
  template.customFields = { source: "auto-import" };
  Object.assign(template, overrides);
  return template;
}

function makeExistingDevice(
  overrides: Record<string, unknown> = {},
): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID("44444444-4444-4444-8444-444444444444");
  device.projectId = PROJECT_ID;
  device.name = "core-switch-01";
  device.hostname = "10.0.0.5";
  Object.assign(device, overrides);
  return device;
}

function provisionedMonitor(callIndex: number): Monitor {
  return monitorCreateMock.mock.calls[callIndex]![0].data as Monitor;
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
  devicesByHostnamesMock.mockImplementation(
    async (data: {
      hostnames: Array<string>;
    }): Promise<Map<string, NetworkDevice>> => {
      const wanted: Set<string> = new Set<string>(data.hostnames);
      const inventory: Array<NetworkDevice> =
        (await deviceFindByMock.mock.results[
          deviceFindByMock.mock.results.length - 1
        ]?.value) || (await deviceFindByMock());
      const found: Map<string, NetworkDevice> = new Map<
        string,
        NetworkDevice
      >();
      for (const device of inventory) {
        if (device.hostname && wanted.has(device.hostname)) {
          found.set(device.hostname, device);
        }
      }
      return found;
    },
  );
  deviceFindOneByMock.mockResolvedValue(null);
  createMock.mockImplementation(
    ({ data }: { data: NetworkDevice }): Promise<NetworkDevice> => {
      data.id = data.id || ObjectID.generate();
      return Promise.resolve(data);
    },
  );
  monitorFindByMock.mockResolvedValue([]);
  monitorFindOneByMock.mockResolvedValue(null);
  monitorTemplateFindByMock.mockResolvedValue([]);
  monitorCreateMock.mockImplementation(
    ({ data }: { data: Monitor }): Promise<Monitor> => {
      data.id = data.id || ObjectID.generate();
      return Promise.resolve(data);
    },
  );
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
    expect(monitorFindByMock).not.toHaveBeenCalled();
    expect(monitorTemplateFindByMock).not.toHaveBeenCalled();
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
    /*
     * Built from THIS scan: the scan's credentials rode along. The host is
     * unstamped, so the credentials are the scan's FIRST config — see the
     * per-host case below for the stamped ones.
     */
    expect(device.snmpVersion).toBe("V2c");
    expect(device.snmpCommunityString).toBe("public");
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
   * The multi-credential guarantee (issue #3458) on the AUTOMATIC path, which
   * is where it matters most.
   *
   * A scan now tries several credential sets per host and the probe records
   * which one answered. An import that copied the scan's first set regardless
   * would create every host found by any other set with credentials its agent
   * rejects — and on this path nobody is looking: there is no Review dialog, no
   * human reading the list, and no error at create time. The devices simply
   * appear, poll red, and report "SNMP timeout", with nothing on them to say
   * the right community string is sitting one entry further down the scan's own
   * list.
   *
   * The engine has no credential logic of its own — it hands the scan and the
   * host to DiscoveredDeviceBuilder — so what this pins is that it hands over
   * the WHOLE scan (list included, not just the flattened columns its select
   * used to carry) and the host row with its stamp intact.
   */
  it("imports each matched host with the credential set that actually answered it", async () => {
    const accessSwitch: DiscoveredNetworkDevice = makeHost({
      ipAddress: "10.0.0.5",
      sysName: "access-switch-01",
      snmpConfigId: ACCESS_SNMP_CONFIG_ID,
    });
    const coreRouter: DiscoveredNetworkDevice = makeHost({
      ipAddress: "10.0.0.6",
      sysName: "core-router-01",
      snmpConfigId: CORE_SNMP_CONFIG_ID,
    });
    /*
     * No stamp: a result from a probe that predates the field, or one stored
     * before it existed. Neither is an error, and both have to import as
     * something that can poll — so they take the first config, which is
     * exactly the credential set such a probe was handed through the mirror.
     */
    const unstampedHost: DiscoveredNetworkDevice = makeHost({
      ipAddress: "10.0.0.7",
      sysName: "unstamped-host-01",
    });

    scanFindOneByMock.mockResolvedValue(
      makeScan({
        discoveredDevices: [accessSwitch, coreRouter, unstampedHost],
        snmpConfigs: [ACCESS_SNMP_CONFIG, CORE_SNMP_CONFIG],
      }),
    );

    const result: AutoImportRuleRunResult | null = await processScan();

    expect(result).toMatchObject({
      hostsEvaluated: 3,
      hostsMatched: 3,
      devicesCreated: 3,
      devicesFailed: 0,
    });
    expect(createMock).toHaveBeenCalledTimes(3);

    // Hosts are imported in the order the scan reported them.
    const accessDevice: NetworkDevice = createdDevice(0);
    expect(accessDevice.hostname).toBe("10.0.0.5");
    expect(accessDevice.snmpVersion).toBe("V2c");
    expect(accessDevice.snmpCommunityString).toBe("public");
    expect(accessDevice.snmpPort).toBe(161);

    const coreDevice: NetworkDevice = createdDevice(1);
    expect(coreDevice.hostname).toBe("10.0.0.6");
    expect(coreDevice.snmpVersion).toBe("V3");
    expect(coreDevice.snmpPort).toBe(1161);
    expect(coreDevice.snmpV3SecurityLevel).toBe("authPriv");
    expect(coreDevice.snmpV3Username).toBe("core-observer");
    expect(coreDevice.snmpV3AuthProtocol).toBe("SHA");
    expect(coreDevice.snmpV3AuthKey).toBe("core-auth-key");
    expect(coreDevice.snmpV3PrivProtocol).toBe("AES");
    expect(coreDevice.snmpV3PrivKey).toBe("core-priv-key");
    /*
     * The v3 config has no community string, so neither may the device — this
     * is the assertion that catches the first config leaking in through the
     * flattened columns the scan row still mirrors it onto.
     */
    expect(coreDevice.snmpCommunityString).toBeUndefined();

    const fallbackDevice: NetworkDevice = createdDevice(2);
    expect(fallbackDevice.hostname).toBe("10.0.0.7");
    expect(fallbackDevice.snmpVersion).toBe("V2c");
    expect(fallbackDevice.snmpCommunityString).toBe("public");
    expect(fallbackDevice.snmpV3Username).toBeUndefined();
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

  describe("monitor-template provisioning", () => {
    it("creates an active monitor from the selected template and rebinds it to the new device", async () => {
      const template: MonitorTemplate = makeTemplate();
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([template]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        devicesCreated: 1,
        monitorsCreated: 1,
        monitorsWouldCreate: 0,
        monitorsFailed: 0,
      });
      expect(monitorCreateMock).toHaveBeenCalledTimes(1);

      const device: NetworkDevice = createdDevice(0);
      const monitor: Monitor = provisionedMonitor(0);
      expect(monitor.name).toBe("core-switch-01 - SNMP health");
      expect(monitor.description).toBe("Provisioned from discovery");
      expect(monitor.monitorType).toBe(MonitorType.NetworkDevice);
      expect(monitor.monitorTemplateId?.toString()).toBe(
        TEMPLATE_ID.toString(),
      );
      expect(monitor.autoProvisionedNetworkDeviceId?.toString()).toBe(
        device.id?.toString(),
      );
      expect(
        monitor.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
          ?.networkDeviceMonitor?.networkDeviceId,
      ).toBe(device.id?.toString());
      expect(monitor.monitoringInterval).toBe("*/5 * * * *");
      expect(monitor.minimumProbeAgreement).toBe(2);
      expect(monitor.customFields).toEqual({ source: "auto-import" });
      expect(monitorCreateMock.mock.calls[0]![0].props).toEqual({
        isRoot: true,
        tenantId: PROJECT_ID,
      });

      // A cached template is reused across an estate and must never mutate.
      expect(
        template.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
          ?.networkDeviceMonitor?.networkDeviceId,
      ).toBe(TEMPLATE_DEVICE_ID);
    });

    /*
     * ISSUE #3486. "Default Monitor Name" is optional, and a template that
     * leaves it blank names what it provisions after the DEVICE and nothing
     * else - the whole complaint being that every auto-imported device came
     * back carrying the same fixed suffix.
     *
     * Driven end to end through the engine rather than through
     * NetworkDeviceMonitorTemplateUtil alone, because the name only survives
     * to the create call if `monitorName` is still in this service's template
     * select; a dropped select column looks exactly like a blank stored value
     * and would silently un-suffix every project's monitors.
     */
    it("names the provisioned monitor after the device alone when the template has no default name", async () => {
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([
        makeTemplate({ monitorName: undefined }),
      ]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({ monitorsCreated: 1, monitorsFailed: 0 });

      const monitor: Monitor = provisionedMonitor(0);
      expect(monitor.name).toBe("core-switch-01");
      expect(monitor.name).not.toContain(" - ");

      // The read that makes the suffix possible at all.
      expect(monitorTemplateFindByMock.mock.calls[0]![0].select).toMatchObject({
        monitorName: true,
      });
    });

    it("names the provisioned monitor after the device alone when the stored default name is empty", async () => {
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      /*
       * Reachable without any migration backfill: the dashboard's edit form
       * PUTs an empty string, not null, when the operator clears the box.
       */
      monitorTemplateFindByMock.mockResolvedValue([
        makeTemplate({ monitorName: "" }),
      ]);

      await processScan();

      expect(provisionedMonitor(0).name).toBe("core-switch-01");
    });

    it("backfills a selected template monitor for an already-registered matching device", async () => {
      const existingDevice: NetworkDevice = makeExistingDevice();
      scanFindOneByMock.mockResolvedValue(
        makeScan({
          discoveredDevices: [makeHost({ isAlreadyRegistered: true })],
        }),
      );
      deviceFindByMock.mockResolvedValue([existingDevice]);
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        hostsSkippedAlreadyRegistered: 1,
        devicesCreated: 0,
        monitorsCreated: 1,
      });
      expect(createMock).not.toHaveBeenCalled();
      expect(devicesByHostnamesMock.mock.calls[0]![0].select.projectId).toBe(
        true,
      );
      expect(
        provisionedMonitor(0).autoProvisionedNetworkDeviceId?.toString(),
      ).toBe(existingDevice.id?.toString());
    });

    it("does not duplicate a manually configured monitor already watching the device", async () => {
      const existingDevice: NetworkDevice = makeExistingDevice();
      const manualMonitor: Monitor = new Monitor();
      manualMonitor.id = ObjectID.generate();
      manualMonitor.monitorType = MonitorType.NetworkDevice;
      manualMonitor.monitorSteps = makeMonitorSteps(
        existingDevice.id!.toString(),
      );

      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      deviceFindByMock.mockResolvedValue([existingDevice]);
      monitorFindByMock.mockResolvedValue([manualMonitor]);
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: 1,
      });
      expect(monitorCreateMock).not.toHaveBeenCalled();
      expect(monitorFindByMock).toHaveBeenCalledTimes(1);
    });

    it("uses provenance to skip an automatic monitor that already exists", async () => {
      const existingDevice: NetworkDevice = makeExistingDevice();
      const existingMonitor: Monitor = new Monitor();
      existingMonitor.id = ObjectID.generate();
      existingMonitor.monitorType = MonitorType.NetworkDevice;
      existingMonitor.monitorTemplateId = TEMPLATE_ID;
      existingMonitor.autoProvisionedNetworkDeviceId = existingDevice.id!;
      existingMonitor.monitorSteps = makeMonitorSteps(
        existingDevice.id!.toString(),
      );

      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      deviceFindByMock.mockResolvedValue([existingDevice]);
      monitorFindByMock.mockResolvedValue([existingMonitor]);
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: 1,
      });
      expect(monitorCreateMock).not.toHaveBeenCalled();
      expect(monitorFindByMock).toHaveBeenCalledTimes(1);
    });

    it("deduplicates two matching rules that select the same template", async () => {
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
        makeRule({
          id: ObjectID.generate(),
          ipMatchTarget: undefined,
          sysNamePattern: "core-switch",
          monitorTemplateId: TEMPLATE_ID,
        }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result?.monitorsCreated).toBe(1);
      expect(monitorCreateMock).toHaveBeenCalledTimes(1);
      expect(monitorTemplateFindByMock).toHaveBeenCalledTimes(1);
    });

    it("creates one monitor per distinct template selected by matching rules", async () => {
      const secondTemplateId: ObjectID = new ObjectID(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      );
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
        makeRule({
          id: ObjectID.generate(),
          ipMatchTarget: undefined,
          sysNamePattern: "core-switch",
          monitorTemplateId: secondTemplateId,
        }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([
        makeTemplate(),
        makeTemplate({
          id: secondTemplateId,
          monitorName: "Interface health",
        }),
      ]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result?.monitorsCreated).toBe(2);
      expect(monitorCreateMock).toHaveBeenCalledTimes(2);
      expect(
        monitorCreateMock.mock.calls.map((call: Array<any>): string => {
          return call[0].data.monitorTemplateId.toString();
        }),
      ).toEqual([TEMPLATE_ID.toString(), secondTemplateId.toString()]);
    });

    it("reports monitor failures separately and leaves them retryable", async () => {
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);
      monitorCreateMock.mockRejectedValueOnce(new Error("plan limit reached"));

      const firstResult: AutoImportRuleRunResult | null = await processScan();

      expect(firstResult).toMatchObject({
        devicesCreated: 1,
        monitorsCreated: 0,
        monitorsFailed: 1,
      });

      const created: NetworkDevice = createdDevice(0);
      jest.clearAllMocks();
      deviceFindByMock.mockResolvedValue([created]);
      monitorFindByMock.mockResolvedValue([]);
      monitorFindOneByMock.mockResolvedValue(null);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      scanUpdateMock.mockResolvedValue(undefined);
      monitorCreateMock.mockImplementation(
        ({ data }: { data: Monitor }): Promise<Monitor> => {
          return Promise.resolve(data);
        },
      );

      const retryResult: AutoImportRuleRunResult | null = await processScan();

      expect(retryResult).toMatchObject({
        devicesCreated: 0,
        monitorsCreated: 1,
        monitorsFailed: 0,
      });
    });

    /*
     * A ping-only host imports as a Probe device under ping-first polling —
     * pinged on schedule, walked once credentials arrive — so a Network
     * Device monitor on it is fed from its first poll: the reachability
     * criteria evaluate from the ping while the OID and interface criteria
     * wait, unevaluated, for a walk. It used to import monitor-backed with
     * polling off, and the engine skipped its monitor as inert.
     */
    it("provisions a Network Device monitor for a ping-only host, which imports as a Probe device", async () => {
      scanFindOneByMock.mockResolvedValue(
        makeScan({
          discoveredDevices: [makeHost({ snmpReachable: false })],
        }),
      );
      ruleFindByMock.mockResolvedValue([
        makeRule({
          includePingOnlyHosts: true,
          monitorTemplateId: TEMPLATE_ID,
        }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(createdDevice(0).monitoringMethod).toBe(
        NetworkDeviceMonitoringMethod.Probe,
      );
      expect(result).toMatchObject({
        devicesCreated: 1,
        monitorsCreated: 1,
        monitorsSkippedUnsupportedHost: 0,
      });
      expect(monitorCreateMock).toHaveBeenCalledTimes(1);
    });

    /*
     * The DEVICE's method is the whole test, never the host's SNMP answer:
     * a Probe device the sweep happened to find without SNMP this time is
     * still polled, and still gets its monitor.
     */
    it("judges by the device's method, not by whether the host answered SNMP", async () => {
      const existingDevice: NetworkDevice = makeExistingDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
      });
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost({ snmpReachable: false })] }),
      );
      deviceFindByMock.mockResolvedValue([existingDevice]);
      ruleFindByMock.mockResolvedValue([
        makeRule({
          includePingOnlyHosts: true,
          monitorTemplateId: TEMPLATE_ID,
        }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        devicesCreated: 0,
        monitorsCreated: 1,
        monitorsSkippedUnsupportedHost: 0,
      });
      expect(monitorCreateMock).toHaveBeenCalledTimes(1);
    });

    it("does not backfill an SNMP monitor onto an existing monitor-backed device", async () => {
      const existingDevice: NetworkDevice = makeExistingDevice({
        monitoringMethod: "Monitor",
      });
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost({ snmpReachable: true })] }),
      );
      deviceFindByMock.mockResolvedValue([existingDevice]);
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedUnsupportedHost: 1,
      });
      expect(monitorCreateMock).not.toHaveBeenCalled();
    });

    it("sees a manual monitor created after the initial project snapshot", async () => {
      const existingDevice: NetworkDevice = makeExistingDevice();
      const manualMonitor: Monitor = new Monitor();
      manualMonitor.monitorType = MonitorType.NetworkDevice;
      manualMonitor.monitorSteps = makeMonitorSteps(
        existingDevice.id!.toString(),
      );

      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      deviceFindByMock.mockResolvedValue([existingDevice]);
      monitorFindByMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([manualMonitor]);
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: 1,
      });
      expect(monitorCreateMock).not.toHaveBeenCalled();
      expect(monitorFindByMock).toHaveBeenCalledTimes(2);
      expect(monitorFindByMock.mock.calls[1]![0].select.monitorType).toBe(true);
    });

    it("reports a conflicting drifted provenance row instead of treating it as a successful race winner", async () => {
      const existingDevice: NetworkDevice = makeExistingDevice();
      const otherDeviceId: ObjectID = new ObjectID(
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      );
      const driftedMonitor: Monitor = new Monitor();
      driftedMonitor.monitorType = MonitorType.NetworkDevice;
      driftedMonitor.monitorTemplateId = TEMPLATE_ID;
      driftedMonitor.autoProvisionedNetworkDeviceId = existingDevice.id!;
      driftedMonitor.monitorSteps = makeMonitorSteps(otherDeviceId.toString());

      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      deviceFindByMock.mockResolvedValue([existingDevice]);
      monitorFindByMock.mockResolvedValue([driftedMonitor]);
      monitorCreateMock.mockRejectedValue(new Error("duplicate key"));
      monitorFindOneByMock.mockResolvedValue(driftedMonitor);
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: 0,
        monitorsFailed: 1,
      });
      expect(monitorCreateMock).toHaveBeenCalledTimes(1);
      expect(monitorFindOneByMock.mock.calls[0]![0].select).toMatchObject({
        monitorType: true,
        monitorSteps: true,
        monitorTemplateId: true,
        autoProvisionedNetworkDeviceId: true,
      });
    });

    it("classifies a valid concurrent automatic create as an idempotent skip", async () => {
      const existingDevice: NetworkDevice = makeExistingDevice();
      const concurrentMonitor: Monitor = new Monitor();
      concurrentMonitor.monitorType = MonitorType.NetworkDevice;
      concurrentMonitor.monitorTemplateId = TEMPLATE_ID;
      concurrentMonitor.autoProvisionedNetworkDeviceId = existingDevice.id!;
      concurrentMonitor.monitorSteps = makeMonitorSteps(
        existingDevice.id!.toString(),
      );

      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      deviceFindByMock.mockResolvedValue([existingDevice]);
      monitorFindByMock.mockResolvedValue([]);
      monitorCreateMock.mockRejectedValue(new Error("duplicate key"));
      monitorFindOneByMock.mockResolvedValue(concurrentMonitor);
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: 1,
        monitorsFailed: 0,
      });
    });

    it("treats an automatic monitor orphaned from its template as an existing operator-managed monitor", async () => {
      const existingDevice: NetworkDevice = makeExistingDevice();
      const orphanedMonitor: Monitor = new Monitor();
      orphanedMonitor.monitorType = MonitorType.NetworkDevice;
      orphanedMonitor.autoProvisionedNetworkDeviceId = existingDevice.id!;
      orphanedMonitor.monitorSteps = makeMonitorSteps(
        existingDevice.id!.toString(),
      );

      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost()] }),
      );
      deviceFindByMock.mockResolvedValue([existingDevice]);
      monitorFindByMock.mockResolvedValue([orphanedMonitor]);
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: 1,
      });
    });

    it("attempts one failed device-template key only once per run even when the host is duplicated", async () => {
      scanFindOneByMock.mockResolvedValue(
        makeScan({ discoveredDevices: [makeHost(), makeHost()] }),
      );
      ruleFindByMock.mockResolvedValue([
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      ]);
      monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);
      monitorCreateMock.mockRejectedValue(new Error("plan limit reached"));

      const result: AutoImportRuleRunResult | null = await processScan();

      expect(result).toMatchObject({
        monitorsCreated: 0,
        monitorsFailed: 1,
      });
      expect(monitorCreateMock).toHaveBeenCalledTimes(1);
    });

    it("reports a missing template consistently instead of promising it in a dry run", async () => {
      ruleFindOneByMock.mockResolvedValue(
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      );
      ruleFindByMock.mockResolvedValue([]);
      monitorTemplateFindByMock.mockResolvedValue([]);
      mockRunNowScans([makeScan({ discoveredDevices: [makeHost()] })]);

      const result: AutoImportRuleRunResult = await runRule(true);

      expect(result).toMatchObject({
        monitorsWouldCreate: 0,
        monitorsFailed: 1,
      });
      expect(monitorCreateMock).not.toHaveBeenCalled();
    });

    it("caps missing-template failures across a large existing estate", async () => {
      const hosts: Array<DiscoveredNetworkDevice> = Array.from(
        { length: MAX_MONITORS_PER_AUTO_IMPORT_RUN + 1 },
        (_value: unknown, index: number): DiscoveredNetworkDevice => {
          return makeHost({
            ipAddress: `10.2.${Math.floor(index / 256)}.${index % 256}`,
            sysName: `missing-template-switch-${index}`,
          });
        },
      );
      const devices: Array<NetworkDevice> = hosts.map(
        (host: DiscoveredNetworkDevice): NetworkDevice => {
          return makeExistingDevice({
            id: ObjectID.generate(),
            hostname: host.ipAddress,
            name: host.sysName,
          });
        },
      );

      ruleFindOneByMock.mockResolvedValue(
        makeRule({
          ipMatchTarget: "10.0.0.0/8",
          monitorTemplateId: TEMPLATE_ID,
        }),
      );
      ruleFindByMock.mockResolvedValue([]);
      deviceFindByMock.mockResolvedValue(devices);
      monitorTemplateFindByMock.mockResolvedValue([]);
      mockRunNowScans([makeScan({ discoveredDevices: hosts })]);

      const result: AutoImportRuleRunResult = await runRule(true);

      expect(result).toMatchObject({
        monitorsWouldCreate: 0,
        monitorsFailed: MAX_MONITORS_PER_AUTO_IMPORT_RUN,
        isTruncated: true,
        isDryRun: true,
      });
      expect(monitorCreateMock).not.toHaveBeenCalled();
    });
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
      expect(deviceFindOneByMock.mock.calls[0]![0].select.projectId).toBe(true);
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

  it("does not stamp a later scan when an earlier scan exactly exhausted the shared project budget", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({ discoveredDevices: [makeHost()] }),
    );
    ruleFindByMock.mockResolvedValue([
      makeRule({ ipMatchTarget: "10.0.0.0/8" }),
    ]);
    const attemptBudgets: ImportAttemptBudgetsByProjectId = new Map([
      [
        PROJECT_ID.toString(),
        {
          deviceCount: MAX_DEVICES_PER_AUTO_IMPORT_RUN,
          monitorCount: 0,
        },
      ],
    ]);

    const result: AutoImportRuleRunResult | null =
      await NetworkDeviceAutoImportRuleEngineService.processCompletedScan({
        scanId: SCAN_ID,
        existingHostnamesByProjectId: new Map(),
        attemptBudgetsByProjectId: attemptBudgets,
      });

    expect(result).toMatchObject({
      devicesCreated: 0,
      devicesFailed: 0,
      isTruncated: true,
    });
    expect(createMock).not.toHaveBeenCalled();
    // This scan contains unattempted work. The next sweep must see it again.
    expect(scanUpdateMock).not.toHaveBeenCalled();
    expect(
      loggerErrorMock.mock.calls.some((call: Array<unknown>) => {
        return String(call[0]).includes("without making progress");
      }),
    ).toBe(false);
  });

  it("does not run a per-device monitor JSON search after the inherited monitor budget is exhausted", async () => {
    const existingDevice: NetworkDevice = makeExistingDevice();
    scanFindOneByMock.mockResolvedValue(
      makeScan({ discoveredDevices: [makeHost()] }),
    );
    deviceFindByMock.mockResolvedValue([existingDevice]);
    ruleFindByMock.mockResolvedValue([
      makeRule({ monitorTemplateId: TEMPLATE_ID }),
    ]);
    monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);
    const attemptBudgets: ImportAttemptBudgetsByProjectId = new Map([
      [
        PROJECT_ID.toString(),
        {
          deviceCount: 0,
          monitorCount: MAX_MONITORS_PER_AUTO_IMPORT_RUN,
        },
      ],
    ]);

    const result: AutoImportRuleRunResult | null =
      await NetworkDeviceAutoImportRuleEngineService.processCompletedScan({
        scanId: SCAN_ID,
        existingHostnamesByProjectId: new Map(),
        existingMonitorsByProjectId: new Map(),
        attemptBudgetsByProjectId: attemptBudgets,
      });

    expect(result).toMatchObject({
      monitorsCreated: 0,
      monitorsFailed: 0,
      isTruncated: true,
    });
    // One project snapshot only; no second JSON-search refresh for the host.
    expect(monitorFindByMock).toHaveBeenCalledTimes(1);
    expect(monitorCreateMock).not.toHaveBeenCalled();
    expect(scanUpdateMock).not.toHaveBeenCalled();
  });

  it("does not retire unattempted hosts when a partial inherited budget is exhausted by failures", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({
        discoveredDevices: [
          makeHost(),
          makeHost({ ipAddress: "10.0.0.6", sysName: "core-switch-02" }),
        ],
      }),
    );
    ruleFindByMock.mockResolvedValue([
      makeRule({ ipMatchTarget: "10.0.0.0/8" }),
    ]);
    createMock.mockRejectedValue(new BadDataException("create is broken"));
    deviceFindOneByMock.mockResolvedValue(null);
    const attemptBudgets: ImportAttemptBudgetsByProjectId = new Map([
      [
        PROJECT_ID.toString(),
        {
          deviceCount: MAX_DEVICES_PER_AUTO_IMPORT_RUN - 1,
          monitorCount: 0,
        },
      ],
    ]);

    const result: AutoImportRuleRunResult | null =
      await NetworkDeviceAutoImportRuleEngineService.processCompletedScan({
        scanId: SCAN_ID,
        existingHostnamesByProjectId: new Map(),
        attemptBudgetsByProjectId: attemptBudgets,
      });

    expect(result).toMatchObject({
      hostsEvaluated: 2,
      hostsMatched: 2,
      devicesCreated: 0,
      devicesFailed: 1,
      isTruncated: true,
    });
    expect(createMock).toHaveBeenCalledTimes(2); // primary + fallback name
    expect(scanUpdateMock).not.toHaveBeenCalled();
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
        return String(call[0]).includes("without making progress");
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

  it("dry-runs monitor reconciliation without creating a device or monitor", async () => {
    ruleFindOneByMock.mockResolvedValue(
      makeRule({ monitorTemplateId: TEMPLATE_ID }),
    );
    ruleFindByMock.mockResolvedValue([]);
    monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);
    mockRunNowScans([
      makeScan({ discoveredDevices: [makeHost(), makeHost()] }),
    ]);

    const result: AutoImportRuleRunResult = await runRule(true);

    expect(result).toMatchObject({
      hostsMatched: 2,
      hostsSkippedAlreadyRegistered: 1,
      devicesCreated: 0,
      monitorsWouldCreate: 1,
      monitorsCreated: 0,
      monitorsSkippedAlreadyExisting: 1,
      monitorsFailed: 0,
      isDryRun: true,
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(monitorCreateMock).not.toHaveBeenCalled();
    expect(scanUpdateMock).not.toHaveBeenCalled();
  });

  it("caps monitor backfill work even when every matching device already exists", async () => {
    const hosts: Array<DiscoveredNetworkDevice> = Array.from(
      { length: MAX_MONITORS_PER_AUTO_IMPORT_RUN + 1 },
      (_value: unknown, index: number): DiscoveredNetworkDevice => {
        return makeHost({
          ipAddress: `10.1.${Math.floor(index / 256)}.${index % 256}`,
          sysName: `existing-switch-${index}`,
        });
      },
    );
    const devices: Array<NetworkDevice> = hosts.map(
      (host: DiscoveredNetworkDevice): NetworkDevice => {
        return makeExistingDevice({
          id: ObjectID.generate(),
          hostname: host.ipAddress,
          name: host.sysName,
        });
      },
    );

    ruleFindOneByMock.mockResolvedValue(
      makeRule({
        ipMatchTarget: "10.0.0.0/8",
        monitorTemplateId: TEMPLATE_ID,
      }),
    );
    ruleFindByMock.mockResolvedValue([]);
    deviceFindByMock.mockResolvedValue(devices);
    monitorTemplateFindByMock.mockResolvedValue([makeTemplate()]);
    mockRunNowScans([makeScan({ discoveredDevices: hosts })]);

    const result: AutoImportRuleRunResult = await runRule(true);

    expect(result).toMatchObject({
      devicesCreated: 0,
      monitorsWouldCreate: MAX_MONITORS_PER_AUTO_IMPORT_RUN,
      isTruncated: true,
      isDryRun: true,
    });
    expect(monitorCreateMock).not.toHaveBeenCalled();
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

    it("rejects a rule whose template changed after the caller authorized it", async () => {
      ruleFindOneByMock.mockResolvedValue(
        makeRule({ monitorTemplateId: TEMPLATE_ID }),
      );

      await expect(
        NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans({
          ruleId: RULE_ID,
          projectId: PROJECT_ID,
          isDryRun: true,
          expectedMonitorTemplateId: null,
        }),
      ).rejects.toThrow("changed while the run was being authorized");

      expect(scanFindByMock).not.toHaveBeenCalled();
      expect(monitorCreateMock).not.toHaveBeenCalled();
    });
  });
});

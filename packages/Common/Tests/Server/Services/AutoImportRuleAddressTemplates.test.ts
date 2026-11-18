/*
 * AUTO IMPORT RULES WITH PING, IP, PORT AND NTP TEMPLATES (OneUptime issues
 * #9510 and #9509), end to end through the engine.
 *
 * A rule's Monitor step used to list Network Device templates only, so a
 * customer's Ping template - labels, interval and criteria set up - showed
 * "No options available", and every host a rule imported had to be given its
 * monitor by hand, where duplicates crept in. A rule now takes any template a
 * device's monitor can be made from, and each host it imports gets a monitor
 * from it: the template's criteria, interval, probe agreement, labels and
 * custom field defaults, every step checking the host's own address, run by
 * the probe that found it - and never a second monitor of the same kind.
 *
 * The collaborating services are stubbed at the module level, as in the
 * engine's own suite, over an in-memory store of monitors the duplicate check
 * reads and the creates write.
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
    default: { findOneBy: jest.fn(), findBy: jest.fn() },
  };
});

jest.mock("../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn(), findBy: jest.fn(), findOneBy: jest.fn() },
  };
});

jest.mock("../../../Server/Services/MonitorTemplateService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("../../../Server/Infrastructure/Semaphore", () => {
  return { __esModule: true, default: { lock: jest.fn(), release: jest.fn() } };
});

/*
 * The template's labels are kept to the project's own (RuleRecordScope reads
 * them in the database); here every label is the project's.
 */
jest.mock("../../../Server/Utils/Rules/RuleRecordScope", () => {
  return {
    __esModule: true,
    default: {
      keepRecordsInProject: jest.fn(async (data: { records: unknown }) => {
        return data.records;
      }),
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
  AUTO_IMPORT_SWEEP_LOCK_NAMESPACE,
} from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import {
  DEVICE_MONITOR_BUSY_REASON,
  DEVICE_MONITOR_LOCK_NAMESPACE,
  deviceMonitorLockKey,
} from "../../../Server/Utils/NetworkDevice/DeviceMonitorDuplicateCheck";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import OneUptimeDate from "../../../Types/Date";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { AutoImportRuleRunResult } from "../../../Types/NetworkAutomation/RuleRunResult";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import {
  DEVICE_ADDRESS_MONITOR_TYPES,
  DEVICE_MONITOR_TEMPLATE_TYPES,
} from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

// The engine yields between scans with setImmediate, which jsdom lacks.
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
const SCAN_PROBE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_PROBE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111112",
);
const SCAN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777778",
);
const KIOSK_PING_TEMPLATE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888881",
);
const OTHER_PING_TEMPLATE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888882",
);
const ALERT_PACK_TEMPLATE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888883",
);
const STATUS_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const HARDWARE_LABEL_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
);
const KIOSK_LABEL_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
);

// The address the template was designed against: never a device's.
const TEMPLATE_ADDRESS: string = "192.0.2.10";

const createDeviceMock: jest.Mock =
  NetworkDeviceService.create as unknown as jest.Mock;
const deviceFindByMock: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const devicesByHostnamesMock: jest.Mock =
  NetworkDeviceService.getDevicesByHostnames as unknown as jest.Mock;
const deviceFindOneByMock: jest.Mock =
  NetworkDeviceService.findOneBy as unknown as jest.Mock;
const monitorCreateMock: jest.Mock =
  MonitorService.create as unknown as jest.Mock;
const monitorFindByMock: jest.Mock =
  MonitorService.findBy as unknown as jest.Mock;
const monitorFindOneByMock: jest.Mock =
  MonitorService.findOneBy as unknown as jest.Mock;
const templateFindByMock: jest.Mock =
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
const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const releaseMock: jest.Mock = Semaphore.release as unknown as jest.Mock;

// ---- What the database holds.

let inventory: Array<NetworkDevice>;
let monitors: Array<Monitor>;

function addressSteps(
  monitorType: MonitorType,
  ports: Array<number | undefined> = [undefined],
): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: ports.map(
      (port: number | undefined, index: number): MonitorStep => {
        const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
          monitorName: "Kiosk",
          monitorType: monitorType,
          onlineMonitorStatusId: STATUS_ID,
          offlineMonitorStatusId: STATUS_ID,
          defaultIncidentSeverityId: STATUS_ID,
          defaultAlertSeverityId: STATUS_ID,
        });
        step.data!.id = `step-${index + 1}`;
        step.data!.requestTimeoutInMs = 4000;
        step.data!.retryCount = 2;
        step.setMonitorDestination(IP.fromString(TEMPLATE_ADDRESS));
        step.setPort(port ? new Port(port) : undefined);
        return step;
      },
    ),
    defaultMonitorStatusId: STATUS_ID,
  };
  return monitorSteps;
}

function networkDeviceSteps(): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    networkDeviceId: "99999999-9999-4999-8999-999999999999",
    monitorInterfaces: true,
    oids: [],
  };
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: STATUS_ID,
  };
  return monitorSteps;
}

function label(id: ObjectID, name: string): Label {
  const item: Label = new Label();
  item.id = id;
  item.name = name;
  return item;
}

// The customer's own template: Ping, with labels, an interval and criteria.
function addressTemplate(
  monitorType: MonitorType,
  options: {
    id?: ObjectID;
    ports?: Array<number | undefined>;
    monitorName?: string;
  } = {},
): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = options.id || KIOSK_PING_TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.templateName = "Kiosk Ping";
  template.monitorType = monitorType;
  template.monitorSteps = addressSteps(monitorType, options.ports);
  template.monitoringInterval = "*/2 * * * *";
  template.minimumProbeAgreement = 2;
  template.monitorDescription = "Kiosk connectivity";
  template.customFields = {
    BusinessSystem: "Kiosk-Unit Level",
    Thresholds: { lossPercent: 20 },
  };
  template.labels = [
    label(HARDWARE_LABEL_ID, "1.Category=Hardware"),
    label(KIOSK_LABEL_ID, "2.SubCategory=Kiosk"),
  ];

  if (options.monitorName !== undefined) {
    template.monitorName = options.monitorName;
  }

  return template;
}

function networkDeviceTemplate(): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = ALERT_PACK_TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.templateName = "Network device alert pack";
  template.monitorType = MonitorType.NetworkDevice;
  template.monitorSteps = networkDeviceSteps();
  template.labels = [];
  return template;
}

function makeScan(
  hosts: Array<DiscoveredNetworkDevice>,
): NetworkDeviceDiscoveryScan {
  return {
    id: SCAN_ID,
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    status: "Completed",
    completedAt: OneUptimeDate.getCurrentDate(),
    autoImportProcessedAt: undefined,
    discoveredDevices: hosts,
    probeId: SCAN_PROBE_ID,
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function makeRule(
  overrides: Record<string, unknown> = {},
): NetworkDeviceAutoImportRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: "Import the kiosks",
    isEnabled: true,
    isExclusion: false,
    includePingOnlyHosts: true,
    ipMatchTarget: "10.40.0.0/16",
    monitorTemplateId: KIOSK_PING_TEMPLATE_ID,
    ...overrides,
  } as unknown as NetworkDeviceAutoImportRule;
}

// A kiosk an ICMP scan found: it answers ping, and has no SNMP.
function kiosk(ipAddress: string, sysName: string): DiscoveredNetworkDevice {
  return { ipAddress: ipAddress, snmpReachable: false, sysName: sysName };
}

const WB1567KSK02: DiscoveredNetworkDevice = kiosk("10.40.12.7", "WB1567KSK02");

function deviceInInventory(fields: Partial<NetworkDevice> = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID("44444444-4444-4444-8444-444444444444");
  device.projectId = PROJECT_ID;
  device.name = "WB1567KSK02";
  device.hostname = WB1567KSK02.ipAddress;
  device.monitoringMethod = NetworkDeviceMonitoringMethod.Probe;
  device.probeId = DEVICE_PROBE_ID;
  Object.assign(device, fields);
  inventory.push(device);
  return device;
}

function monitorOf(data: {
  device: NetworkDevice;
  monitorType: MonitorType;
  templateId?: ObjectID | undefined;
  ports?: Array<number | undefined>;
  isMadeForDevice?: boolean;
}): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.name = data.device.name || "";
  monitor.monitorType = data.monitorType;
  monitor.monitorSteps =
    data.monitorType === MonitorType.NetworkDevice
      ? networkDeviceSteps()
      : addressSteps(data.monitorType, data.ports);

  if (data.templateId) {
    monitor.monitorTemplateId = data.templateId;
  }

  if (data.isMadeForDevice !== false) {
    monitor.autoProvisionedNetworkDeviceId = data.device.id!;
  }

  monitors.push(monitor);
  return monitor;
}

function created(): Array<{
  data: Monitor;
  miscDataProps?: JSONObject;
  props: Record<string, unknown>;
}> {
  return monitorCreateMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as {
      data: Monitor;
      miscDataProps?: JSONObject;
      props: Record<string, unknown>;
    };
  });
}

function destinations(monitor: Monitor): Array<string> {
  return (monitor.monitorSteps?.data?.monitorStepsInstanceArray || []).map(
    (step: MonitorStep): string => {
      return step.data?.monitorDestination?.toString() || "";
    },
  );
}

function ports(monitor: Monitor): Array<number | undefined> {
  return (monitor.monitorSteps?.data?.monitorStepsInstanceArray || []).map(
    (step: MonitorStep): number | undefined => {
      return step.data?.monitorDestinationPort?.toNumber();
    },
  );
}

function deviceLocks(): Array<{ key: string; namespace: string }> {
  return lockMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { key: string; namespace: string };
    })
    .filter((lock: { namespace: string }): boolean => {
      return lock.namespace === DEVICE_MONITOR_LOCK_NAMESPACE;
    });
}

function processScan(
  hosts: Array<DiscoveredNetworkDevice>,
): Promise<AutoImportRuleRunResult | null> {
  scanFindOneByMock.mockResolvedValue(makeScan(hosts));

  return NetworkDeviceAutoImportRuleEngineService.processCompletedScan({
    scanId: SCAN_ID,
    existingHostnamesByProjectId: new Map(),
  });
}

function runRule(
  hosts: Array<DiscoveredNetworkDevice>,
  isDryRun: boolean,
): Promise<AutoImportRuleRunResult> {
  scanFindByMock.mockResolvedValue([
    { id: SCAN_ID } as unknown as NetworkDeviceDiscoveryScan,
  ]);
  scanFindOneByMock.mockResolvedValue(makeScan(hosts));

  return NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans({
    ruleId: RULE_ID,
    projectId: PROJECT_ID,
    isDryRun: isDryRun,
  });
}

function sameId(value: unknown, other: unknown): boolean {
  return (
    String(value || "").toLowerCase() === String(other || "").toLowerCase()
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  inventory = [];
  monitors = [];

  deviceFindByMock.mockResolvedValue([]);
  deviceFindOneByMock.mockResolvedValue(null);
  devicesByHostnamesMock.mockImplementation(
    async (data: { hostnames: Array<string> }) => {
      const found: Map<string, NetworkDevice> = new Map();

      for (const device of inventory) {
        if (device.hostname && data.hostnames.includes(device.hostname)) {
          found.set(device.hostname, device);
        }
      }

      return found;
    },
  );
  createDeviceMock.mockImplementation(async (data: { data: NetworkDevice }) => {
    const device: NetworkDevice = data.data;
    device.id = device.id || ObjectID.generate();
    inventory.push(device);
    return device;
  });

  // The device's monitors as the duplicate check and the snapshot read them.
  monitorFindByMock.mockImplementation(
    async (data: { query: Record<string, unknown> }) => {
      const deviceId: unknown = data.query["autoProvisionedNetworkDeviceId"];

      if (deviceId) {
        return monitors.filter((monitor: Monitor): boolean => {
          return sameId(monitor.autoProvisionedNetworkDeviceId, deviceId);
        });
      }

      if (data.query["monitorType"] === MonitorType.NetworkDevice) {
        return monitors.filter((monitor: Monitor): boolean => {
          return monitor.monitorType === MonitorType.NetworkDevice;
        });
      }

      return [];
    },
  );
  monitorFindOneByMock.mockImplementation(
    async (data: { query: Record<string, unknown> }) => {
      if (data.query["_id"]) {
        return (
          monitors.find((monitor: Monitor): boolean => {
            return sameId(monitor.id, data.query["_id"]);
          }) || null
        );
      }

      return (
        monitors.find((monitor: Monitor): boolean => {
          return (
            sameId(
              monitor.autoProvisionedNetworkDeviceId,
              data.query["autoProvisionedNetworkDeviceId"],
            ) &&
            sameId(monitor.monitorTemplateId, data.query["monitorTemplateId"])
          );
        }) || null
      );
    },
  );
  monitorCreateMock.mockImplementation(async (data: { data: Monitor }) => {
    const monitor: Monitor = data.data;
    monitor.id = monitor.id || ObjectID.generate();
    monitors.push(monitor);
    return monitor;
  });

  templateFindByMock.mockResolvedValue([addressTemplate(MonitorType.Ping)]);
  scanUpdateMock.mockResolvedValue(undefined);
  ruleFindByMock.mockResolvedValue([makeRule()]);
  ruleFindOneByMock.mockResolvedValue(makeRule());
  lockMock.mockImplementation(async (data: { key: string }) => {
    return { key: data.key };
  });
  releaseMock.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("a rule's template may be any kind a device's monitor can be made from (issue #9510)", () => {
  it("reads the rule's template among Network Device, Ping, IP, Port and NTP templates alike", async () => {
    await processScan([WB1567KSK02]);

    const query: Record<string, unknown> =
      templateFindByMock.mock.calls[0]![0].query;
    const kinds: Array<string> = Object.values(
      (
        query["monitorType"] as {
          _objectLiteralParameters?: Record<string, Array<string>>;
        }
      )._objectLiteralParameters!,
    )[0]!;

    expect([...kinds].sort()).toEqual(
      [...DEVICE_MONITOR_TEMPLATE_TYPES].sort(),
    );
    expect(kinds).not.toContain(MonitorType.Manual);
    expect(kinds).not.toContain(MonitorType.IncomingRequest);
    expect(kinds).not.toContain(MonitorType.Website);
  });

  it.each([
    [MonitorType.Ping, [undefined]],
    [MonitorType.IP, [undefined]],
    [MonitorType.Port, [9100]],
    [MonitorType.NTP, [1123]],
  ] as Array<[MonitorType, Array<number | undefined>]>)(
    "gives each host a rule imports a %s monitor on its own address, the template's in all else",
    async (
      monitorType: MonitorType,
      templatePorts: Array<number | undefined>,
    ) => {
      const template: MonitorTemplate = addressTemplate(monitorType, {
        ports: templatePorts,
      });
      templateFindByMock.mockResolvedValue([template]);

      const result: AutoImportRuleRunResult | null = await processScan([
        WB1567KSK02,
        kiosk("10.40.12.8", "WB1567KSK03"),
      ]);

      expect(result).toMatchObject({
        devicesCreated: 2,
        monitorsCreated: 2,
        monitorsFailed: 0,
        monitorsSkippedAlreadyExisting: 0,
      });

      const [first, second] = created();

      for (const [create, address, name] of [
        [first!, "10.40.12.7", "WB1567KSK02"],
        [second!, "10.40.12.8", "WB1567KSK03"],
      ] as Array<
        [
          {
            data: Monitor;
            miscDataProps?: JSONObject;
            props: Record<string, unknown>;
          },
          string,
          string,
        ]
      >) {
        const monitor: Monitor = create.data;
        const device: NetworkDevice = inventory.find(
          (item: NetworkDevice): boolean => {
            return item.hostname === address;
          },
        )!;

        expect(monitor.monitorType).toBe(monitorType);
        // The device's own address in every step, never the template's.
        expect(destinations(monitor)).toEqual([address]);
        expect(destinations(monitor)).not.toContain(TEMPLATE_ADDRESS);
        // The port a Port or NTP template asks on is kept.
        expect(ports(monitor)).toEqual(templatePorts);
        // Named after the device, as a Network Device template's monitor is.
        expect(monitor.name).toBe(name);
        expect(monitor.description).toBe("Kiosk connectivity");
        expect(monitor.monitoringInterval).toBe("*/2 * * * *");
        expect(monitor.minimumProbeAgreement).toBe(2);
        expect(
          (monitor.labels || []).map((item: Label): string => {
            return item.id!.toString();
          }),
        ).toEqual([HARDWARE_LABEL_ID.toString(), KIOSK_LABEL_ID.toString()]);
        expect(monitor.customFields).toEqual({
          BusinessSystem: "Kiosk-Unit Level",
          Thresholds: { lossPercent: 20 },
        });
        // Its criteria are the template's, step for step, as stored.
        expect(
          monitor.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data?.monitorCriteria?.toJSON(),
        ).toEqual(
          MonitorSteps.clone(
            template.monitorSteps!,
          ).data?.monitorStepsInstanceArray[0]?.data?.monitorCriteria?.toJSON(),
        );
        expect(
          monitor.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
            ?.monitorCriteria?.data?.monitorCriteriaInstanceArray.length,
        ).toBe(
          template.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
            ?.monitorCriteria?.data?.monitorCriteriaInstanceArray.length,
        );
        expect(
          monitor.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
            ?.requestTimeoutInMs,
        ).toBe(4000);
        // Linked to the template and to the device it was made for.
        expect(monitor.monitorTemplateId?.toString()).toBe(
          KIOSK_PING_TEMPLATE_ID.toString(),
        );
        expect(monitor.autoProvisionedNetworkDeviceId?.toString()).toBe(
          device.id!.toString(),
        );
        // Run by the probe that found the host, in the device's project.
        expect(create.miscDataProps).toEqual({
          probes: [SCAN_PROBE_ID.toString()],
        });
        expect(create.props).toEqual({ isRoot: true, tenantId: PROJECT_ID });
      }

      // Every monitor its own copy: one template serves the whole estate.
      expect(first!.data.customFields).not.toBe(second!.data.customFields);
      expect(first!.data.customFields?.["Thresholds"]).not.toBe(
        template.customFields?.["Thresholds"],
      );
      expect(first!.data.monitorSteps).not.toBe(template.monitorSteps);
      expect(destinations(template as unknown as Monitor)).toEqual([
        TEMPLATE_ADDRESS,
      ]);
    },
  );

  it("adds a template's Default Monitor Name after the device's, as it does for a Network Device template", async () => {
    templateFindByMock.mockResolvedValue([
      addressTemplate(MonitorType.Ping, { monitorName: "Ping" }),
    ]);

    await processScan([WB1567KSK02]);

    expect(created()[0]!.data.name).toBe("WB1567KSK02 - Ping");
  });

  it("gives a host already in the inventory its monitor too, run by the probe that polls it", async () => {
    const device: NetworkDevice = deviceInInventory();

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({
      hostsSkippedAlreadyRegistered: 1,
      devicesCreated: 0,
      monitorsCreated: 1,
    });
    expect(createDeviceMock).not.toHaveBeenCalled();
    expect(created()[0]!.data.autoProvisionedNetworkDeviceId?.toString()).toBe(
      device.id!.toString(),
    );
    expect(created()[0]!.miscDataProps).toEqual({
      probes: [DEVICE_PROBE_ID.toString()],
    });
    // The engine reads what an address monitor needs of an existing device.
    expect(devicesByHostnamesMock.mock.calls[0]![0].select).toMatchObject({
      probeId: true,
      monitorId: true,
    });
  });

  /*
   * A Network Device monitor has nothing to read on a device nothing polls,
   * so a monitor-backed device gets none. A Ping monitor checks its address
   * all the same.
   */
  it("gives a monitor-backed device with no monitor bound a Ping monitor", async () => {
    deviceInInventory({
      monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
    });

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({
      monitorsCreated: 1,
      monitorsSkippedUnsupportedHost: 0,
    });
  });

  it("gives a host both monitors when one rule picks a Ping template and another a Network Device one", async () => {
    templateFindByMock.mockResolvedValue([
      addressTemplate(MonitorType.Ping),
      networkDeviceTemplate(),
    ]);
    ruleFindByMock.mockResolvedValue([
      makeRule(),
      makeRule({
        id: OTHER_RULE_ID,
        _id: OTHER_RULE_ID.toString(),
        monitorTemplateId: ALERT_PACK_TEMPLATE_ID,
      }),
    ]);

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({ devicesCreated: 1, monitorsCreated: 2 });
    expect(
      created()
        .map((create: { data: Monitor }): string => {
          return String(create.data.monitorType);
        })
        .sort(),
    ).toEqual([MonitorType.NetworkDevice, MonitorType.Ping].sort());
  });

  it("makes a template of a kind that cannot check a device - left on a rule since - load nothing, and says why", async () => {
    // The template find narrows to the kinds above, so a Website one is not found.
    templateFindByMock.mockResolvedValue([]);

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({
      devicesCreated: 1,
      monitorsCreated: 0,
      monitorsFailed: 1,
    });
    expect(result!.monitorFailureReasons[0]).toContain(
      "Edit the rule and pick a Network Device, Ping, IP, Port or NTP template.",
    );
    expect(monitorCreateMock).not.toHaveBeenCalled();
  });

  it("fails an IP monitor for a device whose address is a name, and keeps the device", async () => {
    templateFindByMock.mockResolvedValue([addressTemplate(MonitorType.IP)]);
    deviceInInventory({ hostname: WB1567KSK02.ipAddress, name: "WB1567KSK02" });
    inventory[0]!.hostname = "wb1567ksk02.stores.example.com";
    devicesByHostnamesMock.mockImplementation(async () => {
      return new Map([[WB1567KSK02.ipAddress, inventory[0]!]]);
    });

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({ monitorsCreated: 0, monitorsFailed: 1 });
    expect(result!.monitorFailureReasons[0]).toContain(
      "An IP monitor checks an IP address",
    );
  });
});

describe("never a second monitor of the same kind for a device (issue #9509)", () => {
  it("skips a device that already has a Ping monitor from another template", async () => {
    const device: NetworkDevice = deviceInInventory();
    monitorOf({
      device: device,
      monitorType: MonitorType.Ping,
      templateId: OTHER_PING_TEMPLATE_ID,
    });

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({
      monitorsCreated: 0,
      monitorsSkippedAlreadyExisting: 1,
      monitorsFailed: 0,
    });
    expect(monitorCreateMock).not.toHaveBeenCalled();
  });

  it("skips a device whose Ping monitor lost its template, when the template is picked again", async () => {
    const device: NetworkDevice = deviceInInventory();
    monitorOf({ device: device, monitorType: MonitorType.Ping });

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({
      monitorsCreated: 0,
      monitorsSkippedAlreadyExisting: 1,
    });
  });

  it("skips a monitor-backed device whose bound monitor is a Ping monitor", async () => {
    const bound: Monitor = new Monitor();
    bound.id = ObjectID.generate();
    bound.monitorType = MonitorType.Ping;
    bound.monitorSteps = addressSteps(MonitorType.Ping);
    monitors.push(bound);
    deviceInInventory({
      monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      monitorId: bound.id,
    });

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({
      monitorsCreated: 0,
      monitorsSkippedAlreadyExisting: 1,
    });
    expect(monitorCreateMock).not.toHaveBeenCalled();
  });

  it("still gives a device with a Network Device monitor its Ping monitor: two kinds of check", async () => {
    const device: NetworkDevice = deviceInInventory();
    monitorOf({
      device: device,
      monitorType: MonitorType.NetworkDevice,
      templateId: ALERT_PACK_TEMPLATE_ID,
    });

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({ monitorsCreated: 1 });
    expect(created()[0]!.data.monitorType).toBe(MonitorType.Ping);
  });

  it("still gives a device with a Port monitor on 443 a Port monitor on 22, and none on 443", async () => {
    const device: NetworkDevice = deviceInInventory();
    monitorOf({
      device: device,
      monitorType: MonitorType.Port,
      templateId: OTHER_PING_TEMPLATE_ID,
      ports: [443],
    });

    templateFindByMock.mockResolvedValue([
      addressTemplate(MonitorType.Port, { ports: [22] }),
    ]);
    expect(await processScan([WB1567KSK02])).toMatchObject({
      monitorsCreated: 1,
    });

    jest.clearAllMocks();
    templateFindByMock.mockResolvedValue([
      addressTemplate(MonitorType.Port, {
        id: ALERT_PACK_TEMPLATE_ID,
        ports: [443],
      }),
    ]);
    ruleFindByMock.mockResolvedValue([
      makeRule({ monitorTemplateId: ALERT_PACK_TEMPLATE_ID }),
    ]);
    expect(await processScan([WB1567KSK02])).toMatchObject({
      monitorsCreated: 0,
      monitorsSkippedAlreadyExisting: 1,
    });
  });

  it("makes one Ping monitor for a host two rules give two Ping templates", async () => {
    templateFindByMock.mockResolvedValue([
      addressTemplate(MonitorType.Ping),
      addressTemplate(MonitorType.Ping, { id: OTHER_PING_TEMPLATE_ID }),
    ]);
    ruleFindByMock.mockResolvedValue([
      makeRule(),
      makeRule({
        id: OTHER_RULE_ID,
        _id: OTHER_RULE_ID.toString(),
        monitorTemplateId: OTHER_PING_TEMPLATE_ID,
      }),
    ]);

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({
      devicesCreated: 1,
      monitorsCreated: 1,
      monitorsSkippedAlreadyExisting: 1,
    });
    expect(monitorCreateMock).toHaveBeenCalledTimes(1);
  });

  it("running a rule again creates nothing twice", async () => {
    await processScan([WB1567KSK02, kiosk("10.40.12.8", "WB1567KSK03")]);
    expect(monitorCreateMock).toHaveBeenCalledTimes(2);

    jest.clearAllMocks();
    const again: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
      kiosk("10.40.12.8", "WB1567KSK03"),
    ]);

    expect(again).toMatchObject({
      devicesCreated: 0,
      monitorsCreated: 0,
      monitorsSkippedAlreadyExisting: 2,
    });
    expect(monitorCreateMock).not.toHaveBeenCalled();
  });

  it("checks and creates each Ping monitor under its device's lock, apart from the sweep's", async () => {
    const device: NetworkDevice = deviceInInventory();

    await runRule([WB1567KSK02], false);

    expect(deviceLocks()).toEqual([
      expect.objectContaining({
        key: deviceMonitorLockKey(device.id!),
        namespace: DEVICE_MONITOR_LOCK_NAMESPACE,
      }),
    ]);
    expect(releaseMock).toHaveBeenCalledWith({
      key: deviceMonitorLockKey(device.id!),
    });
    // The sweep's own lock is held too, as for every real run.
    expect(
      lockMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          (call[0] as { namespace: string }).namespace ===
          AUTO_IMPORT_SWEEP_LOCK_NAMESPACE
        );
      }),
    ).toBe(true);
  });

  /*
   * An import from Review Results gives the same device a Ping monitor
   * while the rule waits for the device's lock: inside it, the rule asks
   * again and finds that one.
   */
  it("finds a monitor an import made while the rule waited for the device, and makes none", async () => {
    const device: NetworkDevice = deviceInInventory();
    lockMock.mockImplementation(
      async (data: { key: string; namespace: string }) => {
        if (data.namespace === DEVICE_MONITOR_LOCK_NAMESPACE) {
          monitorOf({
            device: device,
            monitorType: MonitorType.Ping,
            templateId: OTHER_PING_TEMPLATE_ID,
          });
        }

        return { key: data.key };
      },
    );

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({
      monitorsCreated: 0,
      monitorsSkippedAlreadyExisting: 1,
      monitorsFailed: 0,
    });
    expect(monitorCreateMock).not.toHaveBeenCalled();
  });

  it("leaves a device another path holds the whole while to the next run, saying why", async () => {
    deviceInInventory();
    lockMock.mockImplementation(
      async (data: { key: string; namespace: string }) => {
        if (data.namespace === DEVICE_MONITOR_LOCK_NAMESPACE) {
          throw new Error("acquire timeout");
        }

        return { key: data.key };
      },
    );

    const result: AutoImportRuleRunResult | null = await processScan([
      WB1567KSK02,
    ]);

    expect(result).toMatchObject({ monitorsCreated: 0, monitorsFailed: 1 });
    expect(result!.monitorFailureReasons).toEqual([DEVICE_MONITOR_BUSY_REASON]);
    expect(monitorCreateMock).not.toHaveBeenCalled();
  });
});

describe("a dry run of a rule with a Ping template", () => {
  it("predicts the monitors and the duplicates its real run would make, and writes nothing", async () => {
    const monitored: NetworkDevice = deviceInInventory();
    monitorOf({
      device: monitored,
      monitorType: MonitorType.Ping,
      templateId: OTHER_PING_TEMPLATE_ID,
    });

    const result: AutoImportRuleRunResult = await runRule(
      [WB1567KSK02, kiosk("10.40.12.8", "WB1567KSK03")],
      true,
    );

    expect(result).toMatchObject({
      isDryRun: true,
      devicesCreated: 0,
      monitorsCreated: 0,
      monitorsWouldCreate: 1,
      monitorsSkippedAlreadyExisting: 1,
    });
    expect(createDeviceMock).not.toHaveBeenCalled();
    expect(monitorCreateMock).not.toHaveBeenCalled();
    expect(lockMock).not.toHaveBeenCalled();
  });

  it("predicts one monitor for a host two rules give two Ping templates", async () => {
    templateFindByMock.mockResolvedValue([
      addressTemplate(MonitorType.Ping),
      addressTemplate(MonitorType.Ping, { id: OTHER_PING_TEMPLATE_ID }),
    ]);
    ruleFindOneByMock.mockResolvedValue(makeRule());
    ruleFindByMock.mockResolvedValue([
      makeRule({
        id: OTHER_RULE_ID,
        _id: OTHER_RULE_ID.toString(),
        monitorTemplateId: OTHER_PING_TEMPLATE_ID,
      }),
    ]);

    const result: AutoImportRuleRunResult = await runRule(
      [WB1567KSK02, WB1567KSK02],
      true,
    );

    // Run Now applies one rule: its template alone, once per host.
    expect(result).toMatchObject({ monitorsWouldCreate: 1 });
    expect(monitorCreateMock).not.toHaveBeenCalled();
  });
});

describe("the kinds a rule takes", () => {
  it("are the kinds a discovery import takes", () => {
    expect([...DEVICE_MONITOR_TEMPLATE_TYPES]).toEqual([
      MonitorType.NetworkDevice,
      ...DEVICE_ADDRESS_MONITOR_TYPES,
    ]);
  });
});

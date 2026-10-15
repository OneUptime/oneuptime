import DiscoveryImportRunner, {
  DISCOVERY_IMPORT_FLUSH_INTERVAL_MS,
  DISCOVERY_IMPORT_JOB,
  DISCOVERY_IMPORT_STALE_RUNNING_MS,
  DISCOVERY_IMPORT_VIEW_SELECT,
  MAX_CONSECUTIVE_IDENTICAL_MONITOR_FAILURES,
  MAX_DISCOVERY_IMPORT_RESUMES,
  MONITOR_SKIPPED_DEVICE_NOT_IMPORTED,
  MONITOR_SKIPPED_MONITOR_BACKED,
} from "../../../../Server/Utils/NetworkDiscovery/DiscoveryImportRunner";
import Queue from "../../../../Server/Infrastructure/Queue";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../../Server/Services/MonitorTemplateService";
import NetworkDeviceDiscoveryImportService from "../../../../Server/Services/NetworkDeviceDiscoveryImportService";
import NetworkDeviceDiscoveryScanService from "../../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import ActiveMonitorLimit from "../../../../Server/Utils/Billing/ActiveMonitorLimit";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryImport from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportStatus,
  DiscoveryImportView,
  MAX_HOSTS_PER_DISCOVERY_IMPORT,
  readDiscoveryImportHostResults,
} from "../../../../Types/NetworkDevice/DiscoveryImport";
import NetworkDeviceMonitoringMethod from "../../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import NetworkAlertPolicyBootstrapUtil from "../../../../Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import { DiscoveryScanStatus } from "../../../../Utils/NetworkDiscovery/DiscoveryScanStatus";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE IMPORT OF DISCOVERED HOSTS, ON THE SERVER (issues #4811-#4815).
 *
 * The runner is driven here against in-memory stand-ins for every service it
 * writes through - the import's own rows, the scan, devices, monitors and
 * templates - so each test can say exactly what the database holds, and read
 * back exactly what the import did to it: which devices it created and as
 * whom, which monitors and with what provenance, what it wrote about every
 * host, and when it wrote it. The permission checks are the real ones, run
 * on props built the way a request's are.
 */

jest.mock(
  "../../../../Server/Services/NetworkDeviceDiscoveryImportService",
  () => {
    return {
      __esModule: true,
      default: {
        create: jest.fn(),
        findOneById: jest.fn(),
        findOneBy: jest.fn(),
        findBy: jest.fn(),
        updateOneById: jest.fn(),
      },
    };
  },
);

jest.mock(
  "../../../../Server/Services/NetworkDeviceDiscoveryScanService",
  () => {
    return { __esModule: true, default: { findOneBy: jest.fn() } };
  },
);

jest.mock("../../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findOneBy: jest.fn(),
      getDevicesByHostnames: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn(), findOneBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Services/MonitorTemplateService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("../../../../Server/Infrastructure/Queue", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/Infrastructure/Queue",
  );
  return {
    ...actual,
    __esModule: true,
    default: { addJob: jest.fn() },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
  };
});

jest.mock("../../../../Server/Utils/Billing/ActiveMonitorLimit", () => {
  return { __esModule: true, default: { assertRoomFor: jest.fn() } };
});

jest.mock("../../../../Server/Utils/Rules/RuleRecordScope", () => {
  return {
    __esModule: true,
    default: {
      keepRecordsInProject: jest.fn(async (data: { records: unknown }) => {
        return data.records;
      }),
    },
  };
});

jest.mock("../../../../Server/Utils/Billing/CallerPlan", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../../Server/Utils/Billing/CallerPlan",
  );

  /*
   * The props a test builds carry their plan already: withPlan hands them
   * back as they are, and every other rule is the real one.
   */
  const CallerPlanWithTestProps: Record<string, unknown> = Object.create(
    actual.default,
  );
  CallerPlanWithTestProps["withPlan"] = jest.fn(async (props: unknown) => {
    return props;
  });

  return { __esModule: true, default: CallerPlanWithTestProps };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000002",
);
const PERSON_ID: ObjectID = new ObjectID(
  "bb000000-0000-4000-8000-000000000001",
);
const SCAN_ID: ObjectID = new ObjectID("cc000000-0000-4000-8000-000000000001");
const PROBE_ID: ObjectID = new ObjectID("dd000000-0000-4000-8000-000000000001");
const TEMPLATE_ID: ObjectID = new ObjectID(
  "ee000000-0000-4000-8000-000000000001",
);

const DEVICE_IMPORTER: Array<Permission> = [
  Permission.CreateNetworkDevice,
  Permission.ReadNetworkDeviceDiscoveryScan,
];
const FULL_IMPORTER: Array<Permission> = [
  ...DEVICE_IMPORTER,
  Permission.CreateProjectMonitor,
  Permission.ReadMonitorTemplate,
];

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };

  return {
    tenantId: PROJECT_ID,
    userId: PERSON_ID,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

// ---- The hosts a scan reports.

const SWITCH: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.1",
  snmpReachable: true,
  sysName: "core-sw-01",
  sysObjectId: "1.3.6.1.4.1.9.1.2494",
  sysDescr: "Cisco IOS XE Software",
};
const PRINTER: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.2",
  snmpReachable: false,
  dnsHostname: "printer-02.corp.example.com",
};
const PHONE: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.3",
  snmpReachable: false,
};

function hostsOfSize(count: number): Array<DiscoveredNetworkDevice> {
  const hosts: Array<DiscoveredNetworkDevice> = [];

  for (let index: number = 0; index < count; index++) {
    hosts.push({
      ipAddress: `10.1.${Math.floor(index / 250)}.${(index % 250) + 1}`,
      snmpReachable: false,
      dnsHostname: `register-${index}.stores.example.com`,
    });
  }

  return hosts;
}

// ---- What the database holds.

interface FakeDatabase {
  scan: NetworkDeviceDiscoveryScan | null;
  imports: Map<string, NetworkDeviceDiscoveryImport>;
  devicesByHostname: Map<string, NetworkDevice>;
  createdDevices: Array<{ device: NetworkDevice; props: unknown }>;
  monitors: Map<string, Monitor>;
  createdMonitors: Array<{ monitor: Monitor; props: unknown }>;
  template: MonitorTemplate | null;
  writes: Array<{ id: string; data: JSONObject }>;
  // A device create of this name (or at this address) is refused, with this.
  refuseDeviceNamed: Map<string, Error>;
  refuseDeviceAt: Map<string, Error>;
  // Every monitor create is refused with this, while set.
  refuseMonitors: Error | null;
  // Devices that appear at an address as soon as a create there fails.
  appearsOnFailure: Map<string, NetworkDevice>;
}

let db: FakeDatabase;
let personProps: DatabaseCommonInteractionProps;
let clock: number;

function scanWith(
  hosts: Array<DiscoveredNetworkDevice>,
  fields: Partial<NetworkDeviceDiscoveryScan> = {},
): NetworkDeviceDiscoveryScan {
  const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  scan.id = SCAN_ID;
  scan.projectId = PROJECT_ID;
  scan.name = "Campus";
  scan.cidr = "10.0.0.0/24";
  scan.status = DiscoveryScanStatus.Completed;
  scan.statusMessage = "Swept 254 hosts.";
  scan.probeId = PROBE_ID;
  scan.discoveredDevices = hosts;
  scan.snmpVersion = "V2c";
  scan.snmpCommunityString = "public";
  Object.assign(scan, fields);
  return scan;
}

function networkDeviceTemplate(): MonitorTemplate {
  const template: MonitorTemplate =
    NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate({
      projectId: PROJECT_ID,
      incidentSeverityId: ObjectID.generate(),
      alertSeverityId: ObjectID.generate(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
    });
  template.id = TEMPLATE_ID;
  template.labels = [];
  return template;
}

function monitorKey(deviceId: unknown, templateId: unknown): string {
  return `${String(deviceId)}:${String(templateId)}`;
}

function installFakes(): void {
  (NetworkDeviceDiscoveryImportService.create as jest.Mock).mockImplementation(
    async (data: { data: NetworkDeviceDiscoveryImport }) => {
      const row: NetworkDeviceDiscoveryImport = data.data;
      row.id = ObjectID.generate();
      row.createdAt = new Date(clock);
      row.updatedAt = new Date(clock);
      db.imports.set(row.id.toString(), row);
      return row;
    },
  );

  const findImport: (id: unknown) => NetworkDeviceDiscoveryImport | null = (
    id: unknown,
  ): NetworkDeviceDiscoveryImport | null => {
    const row: NetworkDeviceDiscoveryImport | undefined = db.imports.get(
      String(id),
    );

    if (!row) {
      return null;
    }

    // A copy, as a read is: later writes must not change what was read.
    return Object.assign(new NetworkDeviceDiscoveryImport(), {
      ...row,
      results: JSON.parse(JSON.stringify(row.results || [])),
    });
  };

  (
    NetworkDeviceDiscoveryImportService.findOneById as jest.Mock
  ).mockImplementation(async (data: { id: unknown }) => {
    return findImport(data.id);
  });

  (
    NetworkDeviceDiscoveryImportService.findOneBy as jest.Mock
  ).mockImplementation(async (data: { query: Record<string, unknown> }) => {
    if (data.query["_id"]) {
      const row: NetworkDeviceDiscoveryImport | null = findImport(
        data.query["_id"],
      );
      return row &&
        row.projectId?.toString() === String(data.query["projectId"])
        ? row
        : null;
    }

    const matches: Array<NetworkDeviceDiscoveryImport> = Array.from(
      db.imports.values(),
    ).filter((row: NetworkDeviceDiscoveryImport): boolean => {
      return (
        row.projectId?.toString() === String(data.query["projectId"]) &&
        row.status === data.query["status"]
      );
    });

    return matches[0] ? findImport(matches[0].id) : null;
  });

  (NetworkDeviceDiscoveryImportService.findBy as jest.Mock).mockImplementation(
    async () => {
      return Array.from(db.imports.values()).map(
        (row: NetworkDeviceDiscoveryImport) => {
          return findImport(row.id)!;
        },
      );
    },
  );

  (
    NetworkDeviceDiscoveryImportService.updateOneById as jest.Mock
  ).mockImplementation(async (data: { id: unknown; data: JSONObject }) => {
    const row: NetworkDeviceDiscoveryImport | undefined = db.imports.get(
      String(data.id),
    );
    db.writes.push({ id: String(data.id), data: data.data });

    if (row) {
      Object.assign(row, JSON.parse(JSON.stringify(data.data)));
      if (data.data["completedAt"]) {
        row.completedAt = new Date(clock);
      }
      if (data.data["stopRequestedAt"]) {
        row.stopRequestedAt = new Date(clock);
      }
      row.updatedAt = new Date(clock);
    }
  });

  (NetworkDeviceDiscoveryScanService.findOneBy as jest.Mock).mockImplementation(
    async () => {
      return db.scan;
    },
  );

  (NetworkDeviceService.getDevicesByHostnames as jest.Mock).mockImplementation(
    async (data: { hostnames: Array<string> }) => {
      const found: Map<string, NetworkDevice> = new Map();
      for (const hostname of data.hostnames) {
        const device: NetworkDevice | undefined =
          db.devicesByHostname.get(hostname);
        if (device) {
          found.set(hostname, device);
        }
      }
      return found;
    },
  );

  (NetworkDeviceService.findOneBy as jest.Mock).mockImplementation(
    async (data: { query: Record<string, unknown> }) => {
      return (
        Array.from(db.devicesByHostname.values()).find(
          (device: NetworkDevice): boolean => {
            return device.id?.toString() === String(data.query["_id"]);
          },
        ) || null
      );
    },
  );

  (NetworkDeviceService.create as jest.Mock).mockImplementation(
    async (data: { data: NetworkDevice; props: unknown }) => {
      const device: NetworkDevice = data.data;
      const byName: Error | undefined = db.refuseDeviceNamed.get(
        device.name || "",
      );
      const byAddress: Error | undefined = db.refuseDeviceAt.get(
        device.hostname || "",
      );

      if (byName || byAddress) {
        const appears: NetworkDevice | undefined = db.appearsOnFailure.get(
          device.hostname || "",
        );
        if (appears) {
          db.devicesByHostname.set(device.hostname!, appears);
        }
        throw (byName || byAddress)!;
      }

      const created: NetworkDevice = Object.assign(new NetworkDevice(), device);
      created.id = ObjectID.generate();
      db.devicesByHostname.set(created.hostname!, created);
      db.createdDevices.push({ device: created, props: data.props });
      return created;
    },
  );

  (MonitorService.findOneBy as jest.Mock).mockImplementation(
    async (data: { query: Record<string, unknown> }) => {
      return (
        db.monitors.get(
          monitorKey(
            data.query["autoProvisionedNetworkDeviceId"],
            data.query["monitorTemplateId"],
          ),
        ) || null
      );
    },
  );

  (MonitorService.create as jest.Mock).mockImplementation(
    async (data: { data: Monitor; props: unknown }) => {
      if (db.refuseMonitors) {
        throw db.refuseMonitors;
      }

      const monitor: Monitor = data.data;
      monitor.id = ObjectID.generate();
      db.monitors.set(
        monitorKey(
          monitor.autoProvisionedNetworkDeviceId,
          monitor.monitorTemplateId,
        ),
        monitor,
      );
      db.createdMonitors.push({ monitor: monitor, props: data.props });
      return monitor;
    },
  );

  (MonitorTemplateService.findOneBy as jest.Mock).mockImplementation(
    async () => {
      return db.template;
    },
  );

  (Semaphore.lock as jest.Mock).mockImplementation(async () => {
    return { key: "lock" };
  });
  (Semaphore.release as jest.Mock).mockImplementation(async () => {});
  (Queue.addJob as jest.Mock).mockImplementation(async () => {
    return {};
  });
  (ActiveMonitorLimit.assertRoomFor as jest.Mock).mockImplementation(
    async () => {},
  );

  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation(async () => {
      return personProps;
    });
}

beforeEach(() => {
  clock = Date.parse("2026-10-15T09:00:00Z");
  DiscoveryImportRunner.now = (): number => {
    return clock;
  };

  db = {
    scan: scanWith([SWITCH, PRINTER, PHONE]),
    imports: new Map(),
    devicesByHostname: new Map(),
    createdDevices: [],
    monitors: new Map(),
    createdMonitors: [],
    template: networkDeviceTemplate(),
    writes: [],
    refuseDeviceNamed: new Map(),
    refuseDeviceAt: new Map(),
    refuseMonitors: null,
    appearsOnFailure: new Map(),
  };

  personProps = propsWith(FULL_IMPORTER);
  installFakes();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  DiscoveryImportRunner.now = (): number => {
    return Date.now();
  };
});

// ---- Helpers that drive the runner.

async function start(
  overrides: {
    ipAddresses?: unknown;
    settings?: unknown;
    props?: DatabaseCommonInteractionProps;
    scanId?: unknown;
  } = {},
): Promise<NetworkDeviceDiscoveryImport> {
  return await DiscoveryImportRunner.start({
    projectId: PROJECT_ID,
    props: overrides.props || personProps,
    scanId: overrides.scanId ?? SCAN_ID.toString(),
    ipAddresses: overrides.ipAddresses ?? ["10.0.0.1", "10.0.0.2", "10.0.0.3"],
    settings: overrides.settings ?? {
      pollingIntervalInMinutes: 5,
      applyVendorTemplates: true,
      alerting: DiscoveryImportAlerting.None,
    },
  });
}

const WITH_TEMPLATE: JSONObject = {
  pollingIntervalInMinutes: 1,
  applyVendorTemplates: true,
  alerting: DiscoveryImportAlerting.MonitorTemplate,
  monitorTemplateId: TEMPLATE_ID.toString(),
};

async function runAll(): Promise<void> {
  await DiscoveryImportRunner.runProjectImports(PROJECT_ID);
}

function stored(
  row: NetworkDeviceDiscoveryImport,
): NetworkDeviceDiscoveryImport {
  return db.imports.get(row.id!.toString())!;
}

function resultsOf(
  row: NetworkDeviceDiscoveryImport,
): Array<DiscoveryImportHostResult> {
  return readDiscoveryImportHostResults(stored(row).results);
}

function resultAt(
  row: NetworkDeviceDiscoveryImport,
  address: string,
): DiscoveryImportHostResult {
  return resultsOf(row).find((result: DiscoveryImportHostResult): boolean => {
    return result.ipAddress === address;
  })!;
}

// ---- Asking for an import.

describe("asking for an import", () => {
  test("records the hosts as the scan describes them, every one pending, and queues the project's job", async () => {
    const row: NetworkDeviceDiscoveryImport = await start();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Queued);
    expect(stored(row).createdByUserId?.toString()).toBe(PERSON_ID.toString());
    expect(stored(row).networkDeviceDiscoveryScanId?.toString()).toBe(
      SCAN_ID.toString(),
    );
    expect(
      (stored(row).hosts || []).map((host: DiscoveredNetworkDevice) => {
        return host.ipAddress;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    expect(resultsOf(row)).toEqual([
      {
        ipAddress: "10.0.0.1",
        name: "core-sw-01",
        isPingOnly: false,
        device: DiscoveryImportDeviceOutcome.Pending,
        monitor: DiscoveryImportMonitorOutcome.NotRequested,
      },
      {
        ipAddress: "10.0.0.2",
        name: "printer-02.corp.example.com",
        isPingOnly: true,
        device: DiscoveryImportDeviceOutcome.Pending,
        monitor: DiscoveryImportMonitorOutcome.NotRequested,
      },
      {
        ipAddress: "10.0.0.3",
        name: "10.0.0.3",
        isPingOnly: true,
        device: DiscoveryImportDeviceOutcome.Pending,
        monitor: DiscoveryImportMonitorOutcome.NotRequested,
      },
    ]);

    /*
     * One job per project at a time: the queue folds a second ask into the
     * waiting job, so two imports of a project never run side by side.
     */
    expect(Queue.addJob).toHaveBeenCalledTimes(1);
    const [, jobId, jobName, jobData, options] = (Queue.addJob as jest.Mock)
      .mock.calls[0] as [unknown, string, string, JSONObject, JSONObject];
    expect(jobName).toBe(DISCOVERY_IMPORT_JOB);
    expect(jobData).toEqual({ projectId: PROJECT_ID.toString() });
    expect(jobId).toContain(PROJECT_ID.toString());
    expect(options["deduplication"]).toEqual({
      id: `discovery-import-${PROJECT_ID.toString()}`,
      keepLastIfActive: true,
    });
  });

  test("the scan is read as the person, with the credentials the devices are created with", async () => {
    await start();

    const read: { select: JSONObject; props: unknown } = (
      NetworkDeviceDiscoveryScanService.findOneBy as jest.Mock
    ).mock.calls[0]![0] as { select: JSONObject; props: unknown };

    expect(read.props).toBe(personProps);
    for (const column of [
      "discoveredDevices",
      "probeId",
      "snmpConfigs",
      "snmpCommunityString",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
      "useShortDeviceNames",
      "status",
    ]) {
      expect(read.select[column]).toBe(true);
    }
  });

  test("hosts come in the scan's order, once each, whatever order and repetition they were sent in", async () => {
    db.scan = scanWith([
      SWITCH,
      PRINTER,
      PHONE,
      { ...PRINTER, sysName: "dup" },
    ]);

    const row: NetworkDeviceDiscoveryImport = await start({
      ipAddresses: ["10.0.0.3", " 10.0.0.1 ", "10.0.0.3", "10.0.0.9", 42],
    });

    expect(
      resultsOf(row).map((result: DiscoveryImportHostResult) => {
        return result.ipAddress;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.3"]);
  });

  test("a monitor for every host is pending when a template is picked, and the template's name is kept", async () => {
    db.template!.templateName = "POS ping availability";

    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
    });

    expect(
      resultsOf(row).every((result: DiscoveryImportHostResult) => {
        return result.monitor === DiscoveryImportMonitorOutcome.Pending;
      }),
    ).toBe(true);
    expect(stored(row).monitorTemplateName).toBe("POS ping availability");
    // The template is read as the person too.
    expect(
      (
        (MonitorTemplateService.findOneBy as jest.Mock).mock.calls[0]![0] as {
          props: unknown;
        }
      ).props,
    ).toBe(personProps);
  });

  test.each([
    [{ scanId: "not-a-uuid" }, "Pick the discovery scan"],
    [{ ipAddresses: "10.0.0.1" }, "Select the hosts"],
    [{ ipAddresses: [] }, "Select the hosts"],
    [{ ipAddresses: ["", "   "] }, "Select the hosts"],
    [
      { settings: { pollingIntervalInMinutes: 3 } },
      "Pick how often devices are checked",
    ],
    [{ settings: { alerting: "Pager" } }, "Choose whether"],
    [
      { settings: { alerting: DiscoveryImportAlerting.MonitorTemplate } },
      "Pick the monitor template",
    ],
  ])(
    "refuses %j with a sentence and records nothing",
    async (overrides: Record<string, unknown>, message: string) => {
      await expect(start(overrides as never)).rejects.toThrow(message);
      expect(db.imports.size).toBe(0);
      expect(Queue.addJob).not.toHaveBeenCalled();
    },
  );

  test(`refuses more than ${MAX_HOSTS_PER_DISCOVERY_IMPORT} hosts in one import, and says how to split it`, async () => {
    const addresses: Array<string> = hostsOfSize(
      MAX_HOSTS_PER_DISCOVERY_IMPORT + 1,
    ).map((host: DiscoveredNetworkDevice) => {
      return host.ipAddress;
    });

    await expect(start({ ipAddresses: addresses })).rejects.toThrow(
      "Import them in parts",
    );
  });

  test("refuses someone who may not create network devices, before the scan is read", async () => {
    await expect(
      start({ props: propsWith([Permission.ReadNetworkDeviceDiscoveryScan]) }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(NetworkDeviceDiscoveryScanService.findOneBy).not.toHaveBeenCalled();
  });

  test("monitors need the right to create monitors: devices alone do not", async () => {
    const deviceOnly: DatabaseCommonInteractionProps =
      propsWith(DEVICE_IMPORTER);

    await expect(
      start({ props: deviceOnly, settings: WITH_TEMPLATE }),
    ).rejects.toThrow("You may not create monitors");

    // The same person may import the devices without monitors.
    await expect(start({ props: deviceOnly })).resolves.toBeTruthy();
  });

  test("a person who may not read the scan's credentials is told so", async () => {
    (
      NetworkDeviceDiscoveryScanService.findOneBy as jest.Mock
    ).mockRejectedValue(
      new NotAuthorizedException("You may not read snmpV3AuthKey."),
    );

    await expect(start()).rejects.toThrow(
      "You may not read this scan's results and SNMP credentials",
    );
  });

  test("a scan that is gone, or has nothing to import yet, is refused", async () => {
    db.scan = null;
    await expect(start()).rejects.toThrow("not found");

    db.scan = scanWith([SWITCH], { status: DiscoveryScanStatus.Pending });
    await expect(start()).rejects.toThrow("no results to import yet");

    db.scan = scanWith([SWITCH], {
      status: DiscoveryScanStatus.InProgress,
      statusMessage: "Scan started. Waiting for the first progress update.",
    });
    await expect(start()).rejects.toThrow("no results to import yet");
  });

  test("a running scan's hosts and a failed scan's partial results can be imported", async () => {
    db.scan = scanWith([SWITCH], {
      status: DiscoveryScanStatus.InProgress,
      statusMessage: "Scan in progress: 1 of 254 swept.",
    });
    await expect(start({ ipAddresses: ["10.0.0.1"] })).resolves.toBeTruthy();

    db.scan = scanWith([SWITCH], { status: DiscoveryScanStatus.Failed });
    await expect(start({ ipAddresses: ["10.0.0.1"] })).resolves.toBeTruthy();
  });

  test("hosts the scan no longer lists are refused when none is left", async () => {
    await expect(start({ ipAddresses: ["10.9.9.9"] })).rejects.toThrow(
      "None of the selected hosts",
    );
  });

  test("the template must be the project's, and a Network Device one", async () => {
    db.template = null;
    await expect(start({ settings: WITH_TEMPLATE })).rejects.toThrow(
      "was not found",
    );

    db.template = networkDeviceTemplate();
    db.template.monitorType = MonitorType.Ping;
    await expect(start({ settings: WITH_TEMPLATE })).rejects.toThrow(
      "Pick a Network Device monitor template",
    );
  });

  test("a plan with no room for another monitor refuses the monitors up front, in the limit's words", async () => {
    (ActiveMonitorLimit.assertRoomFor as jest.Mock).mockRejectedValue(
      new BadDataException("Your plan includes 100 active monitors."),
    );

    await expect(start({ settings: WITH_TEMPLATE })).rejects.toThrow(
      "Your plan includes 100 active monitors.",
    );
    // The plan is not asked about an import that makes no monitor.
    (ActiveMonitorLimit.assertRoomFor as jest.Mock).mockClear();
    await expect(start()).resolves.toBeTruthy();
    expect(ActiveMonitorLimit.assertRoomFor).not.toHaveBeenCalled();
  });

  test("an import needs a person: a request with no user is refused", async () => {
    await expect(
      start({ props: { ...propsWith(FULL_IMPORTER), userId: undefined } }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });
});

// ---- Importing.

describe("importing the hosts", () => {
  test("creates each device as the person, polled at the chosen interval, vendor templates as chosen", async () => {
    const row: NetworkDeviceDiscoveryImport = await start({
      settings: {
        pollingIntervalInMinutes: 15,
        applyVendorTemplates: false,
        alerting: DiscoveryImportAlerting.None,
      },
    });

    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Completed);
    expect(
      db.createdDevices.map((created: { device: NetworkDevice }) => {
        return created.device.hostname;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);

    for (const created of db.createdDevices) {
      // As the person, never as OneUptime itself.
      expect(created.props).toBe(personProps);
      expect(created.device.pollingIntervalInMinutes).toBe(15);
      expect(created.device.probeId?.toString()).toBe(PROBE_ID.toString());
      expect(created.device.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(created.device.autoApplyVendorHealthTemplate).not.toBe(true);
    }

    // The SNMP host carries the scan's credentials; ping-only hosts none.
    expect(db.createdDevices[0]!.device.snmpCommunityString).toBe("public");
    expect(db.createdDevices[1]!.device.snmpCommunityString).toBeUndefined();

    expect(
      resultsOf(row).map((result: DiscoveryImportHostResult) => {
        return result.device;
      }),
    ).toEqual([
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportDeviceOutcome.Created,
    ]);
    expect(resultAt(row, "10.0.0.1").deviceId).toBe(
      db.createdDevices[0]!.device.id!.toString(),
    );
    expect(stored(row).completedAt).toBeTruthy();
  });

  test("vendor templates go to the SNMP devices only, when asked for", async () => {
    await start();
    await runAll();

    expect(db.createdDevices[0]!.device.autoApplyVendorHealthTemplate).toBe(
      true,
    );
    expect(db.createdDevices[1]!.device.autoApplyVendorHealthTemplate).not.toBe(
      true,
    );
  });

  test("a host whose address is already a device is not created again", async () => {
    const existing: NetworkDevice = new NetworkDevice();
    existing.id = ObjectID.generate();
    existing.name = "printer (added by hand)";
    existing.hostname = "10.0.0.2";
    db.devicesByHostname.set("10.0.0.2", existing);

    const row: NetworkDeviceDiscoveryImport = await start();
    await runAll();

    expect(resultAt(row, "10.0.0.2")).toEqual(
      expect.objectContaining({
        device: DiscoveryImportDeviceOutcome.AlreadyAdded,
        deviceId: existing.id.toString(),
        name: "printer (added by hand)",
      }),
    );
    expect(
      db.createdDevices.some((created: { device: NetworkDevice }) => {
        return created.device.hostname === "10.0.0.2";
      }),
    ).toBe(false);
  });

  test("a name another device has is retried once with the address added", async () => {
    db.refuseDeviceNamed.set(
      "core-sw-01",
      new BadDataException("Network Device with the same name already exists."),
    );

    const row: NetworkDeviceDiscoveryImport = await start();
    await runAll();

    expect(resultAt(row, "10.0.0.1")).toEqual(
      expect.objectContaining({
        device: DiscoveryImportDeviceOutcome.Created,
        name: "core-sw-01 (10.0.0.1)",
      }),
    );
  });

  test("a create refused for another reason is failed with the first refusal's words", async () => {
    db.refuseDeviceAt.set(
      "10.0.0.3",
      new BadDataException("The probe cannot be attached to this project."),
    );

    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
    });
    await runAll();

    expect(resultAt(row, "10.0.0.3")).toEqual(
      expect.objectContaining({
        device: DiscoveryImportDeviceOutcome.Failed,
        deviceError: "The probe cannot be attached to this project.",
        monitor: DiscoveryImportMonitorOutcome.Skipped,
        monitorError: MONITOR_SKIPPED_DEVICE_NOT_IMPORTED,
      }),
    );
    // The others carried on.
    expect(resultAt(row, "10.0.0.1").device).toBe(
      DiscoveryImportDeviceOutcome.Created,
    );
    expect(stored(row).status).toBe(DiscoveryImportStatus.Completed);
  });

  test("a refusal of the person is not retried under another name", async () => {
    db.refuseDeviceAt.set(
      "10.0.0.1",
      new NotAuthorizedException("You may not create on column snmpPort."),
    );

    const row: NetworkDeviceDiscoveryImport = await start();
    await runAll();

    expect(resultAt(row, "10.0.0.1")).toEqual(
      expect.objectContaining({
        device: DiscoveryImportDeviceOutcome.Failed,
        deviceError: "You may not create on column snmpPort.",
      }),
    );
    expect(
      (NetworkDeviceService.create as jest.Mock).mock.calls.filter(
        (call: Array<unknown>) => {
          return (
            (call[0] as { data: NetworkDevice }).data.hostname === "10.0.0.1"
          );
        },
      ),
    ).toHaveLength(1);
  });

  test("a device someone else created at the address meanwhile is found, not duplicated", async () => {
    const meanwhile: NetworkDevice = new NetworkDevice();
    meanwhile.id = ObjectID.generate();
    meanwhile.name = "core-sw-01";
    meanwhile.hostname = "10.0.0.1";
    db.refuseDeviceAt.set("10.0.0.1", new BadDataException("Race."));
    db.appearsOnFailure.set("10.0.0.1", meanwhile);

    const row: NetworkDeviceDiscoveryImport = await start();
    await runAll();

    expect(resultAt(row, "10.0.0.1")).toEqual(
      expect.objectContaining({
        device: DiscoveryImportDeviceOutcome.AlreadyAdded,
        deviceId: meanwhile.id.toString(),
      }),
    );
  });

  test("each device gets its template monitor, made as OneUptime with the provenance, attributed to the person", async () => {
    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
    });
    await runAll();

    expect(db.createdMonitors).toHaveLength(3);
    for (const created of db.createdMonitors) {
      expect(created.props).toEqual({ isRoot: true, tenantId: PROJECT_ID });
      expect(created.monitor.monitorType).toBe(MonitorType.NetworkDevice);
      expect(created.monitor.monitorTemplateId?.toString()).toBe(
        TEMPLATE_ID.toString(),
      );
      expect(created.monitor.createdByUserId?.toString()).toBe(
        PERSON_ID.toString(),
      );
    }

    const monitorFor: (address: string) => Monitor = (
      address: string,
    ): Monitor => {
      const deviceId: string = resultAt(row, address).deviceId!;
      return db.monitors.get(monitorKey(deviceId, TEMPLATE_ID))!;
    };

    // Each monitor watches its own device.
    expect(
      monitorFor("10.0.0.2").autoProvisionedNetworkDeviceId?.toString(),
    ).toBe(resultAt(row, "10.0.0.2").deviceId);
    expect(resultAt(row, "10.0.0.2")).toEqual(
      expect.objectContaining({
        monitor: DiscoveryImportMonitorOutcome.Created,
        monitorId: monitorFor("10.0.0.2").id!.toString(),
      }),
    );
  });

  test("a device that already has this template's monitor - an alert policy's, say - is not given a second", async () => {
    const existing: NetworkDevice = new NetworkDevice();
    existing.id = ObjectID.generate();
    existing.name = "core-sw-01";
    existing.hostname = "10.0.0.1";
    db.devicesByHostname.set("10.0.0.1", existing);
    const policyMonitor: Monitor = new Monitor();
    policyMonitor.id = ObjectID.generate();
    db.monitors.set(monitorKey(existing.id, TEMPLATE_ID), policyMonitor);

    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
    });
    await runAll();

    expect(resultAt(row, "10.0.0.1")).toEqual(
      expect.objectContaining({
        device: DiscoveryImportDeviceOutcome.AlreadyAdded,
        monitor: DiscoveryImportMonitorOutcome.AlreadyThere,
        monitorId: policyMonitor.id.toString(),
      }),
    );
    expect(db.createdMonitors).toHaveLength(2);
  });

  test("a device that takes its status from a bound monitor gets no Network Device monitor, and says why", async () => {
    const existing: NetworkDevice = new NetworkDevice();
    existing.id = ObjectID.generate();
    existing.name = "lobby-camera";
    existing.hostname = "10.0.0.3";
    existing.monitoringMethod = NetworkDeviceMonitoringMethod.Monitor;
    db.devicesByHostname.set("10.0.0.3", existing);

    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
    });
    await runAll();

    expect(resultAt(row, "10.0.0.3")).toEqual(
      expect.objectContaining({
        monitor: DiscoveryImportMonitorOutcome.Skipped,
        monitorError: MONITOR_SKIPPED_MONITOR_BACKED,
      }),
    );
  });

  test("a refused monitor leaves its device imported, with the refusal's words", async () => {
    db.refuseMonitors = new BadDataException(
      "Your plan includes 100 active monitors, and this project has 100.",
    );

    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
      ipAddresses: ["10.0.0.1"],
    });
    await runAll();

    expect(resultAt(row, "10.0.0.1")).toEqual(
      expect.objectContaining({
        device: DiscoveryImportDeviceOutcome.Created,
        monitor: DiscoveryImportMonitorOutcome.Failed,
        monitorError:
          "Your plan includes 100 active monitors, and this project has 100.",
      }),
    );
  });

  test(`after ${MAX_CONSECUTIVE_IDENTICAL_MONITOR_FAILURES} identical refusals the import stops asking, and fails the rest with that reason`, async () => {
    db.scan = scanWith(hostsOfSize(30));
    db.refuseMonitors = new BadDataException(
      "The template names a status that is gone.",
    );

    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
      ipAddresses: hostsOfSize(30).map((host: DiscoveredNetworkDevice) => {
        return host.ipAddress;
      }),
    });
    await runAll();

    expect(MonitorService.create).toHaveBeenCalledTimes(
      MAX_CONSECUTIVE_IDENTICAL_MONITOR_FAILURES,
    );
    const results: Array<DiscoveryImportHostResult> = resultsOf(row);
    expect(
      results.every((result: DiscoveryImportHostResult) => {
        return (
          result.device === DiscoveryImportDeviceOutcome.Created &&
          result.monitor === DiscoveryImportMonitorOutcome.Failed &&
          result.monitorError === "The template names a status that is gone."
        );
      }),
    ).toBe(true);
  });

  test("a person who may no longer create monitors stops the import before it creates anything, and is told why", async () => {
    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
    });
    // Their right to create monitors is taken away before the job runs.
    personProps = propsWith(DEVICE_IMPORTER);

    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Failed);
    expect(stored(row).error).toContain("You may not create monitors");
    expect(db.createdDevices).toHaveLength(0);
    expect(
      resultsOf(row).every((result: DiscoveryImportHostResult) => {
        return result.device === DiscoveryImportDeviceOutcome.NotReached;
      }),
    ).toBe(true);
  });

  test("a person who left the project stops the import, and is named as the reason", async () => {
    const row: NetworkDeviceDiscoveryImport = await start();
    (
      WorkspaceActionAuthorization.getProjectMemberProps as unknown as jest.Mock
    ).mockRejectedValue(
      new NotAuthorizedException(
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      ),
    );

    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Failed);
    expect(stored(row).error).toContain("no longer a member of the project");
  });

  test("a permission taken away part-way is held from the next refresh: what was created stays", async () => {
    db.scan = scanWith(hostsOfSize(40));
    const row: NetworkDeviceDiscoveryImport = await start({
      ipAddresses: hostsOfSize(40).map((host: DiscoveredNetworkDevice) => {
        return host.ipAddress;
      }),
    });

    let creates: number = 0;
    (NetworkDeviceService.create as jest.Mock).mockImplementation(
      async (data: { data: NetworkDevice }) => {
        creates++;
        clock += 2000;
        if (creates === 20) {
          personProps = propsWith([Permission.ReadNetworkDeviceDiscoveryScan]);
        }
        const created: NetworkDevice = Object.assign(
          new NetworkDevice(),
          data.data,
        );
        created.id = ObjectID.generate();
        return created;
      },
    );

    await runAll();

    const results: Array<DiscoveryImportHostResult> = resultsOf(row);
    const created: number = results.filter(
      (result: DiscoveryImportHostResult) => {
        return result.device === DiscoveryImportDeviceOutcome.Created;
      },
    ).length;

    expect(stored(row).status).toBe(DiscoveryImportStatus.Failed);
    expect(created).toBeGreaterThanOrEqual(20);
    expect(created).toBeLessThan(40);
    expect(
      results.filter((result: DiscoveryImportHostResult) => {
        return result.device === DiscoveryImportDeviceOutcome.NotReached;
      }).length,
    ).toBe(40 - created);
  });
});

describe("hundreds of hosts", () => {
  test("514 hosts are imported in order, and progress is written in batches, not once per host", async () => {
    const hosts: Array<DiscoveredNetworkDevice> = hostsOfSize(514);
    db.scan = scanWith(hosts);

    (NetworkDeviceService.create as jest.Mock).mockImplementation(
      async (data: { data: NetworkDevice }) => {
        // Each create takes 100 ms of the clock.
        clock += 100;
        const created: NetworkDevice = Object.assign(
          new NetworkDevice(),
          data.data,
        );
        created.id = ObjectID.generate();
        return created;
      },
    );

    const row: NetworkDeviceDiscoveryImport = await start({
      ipAddresses: hosts.map((host: DiscoveredNetworkDevice) => {
        return host.ipAddress;
      }),
    });
    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Completed);
    expect(NetworkDeviceService.create).toHaveBeenCalledTimes(514);

    const progressWrites: number = db.writes.filter(
      (write: { data: JSONObject }) => {
        return Boolean(write.data["results"]);
      },
    ).length;

    // 51.4 s of creates, written at most every 1.5 s, plus the last write.
    const expectedMaximum: number =
      Math.ceil((514 * 100) / DISCOVERY_IMPORT_FLUSH_INTERVAL_MS) + 2;
    expect(progressWrites).toBeLessThanOrEqual(expectedMaximum);
    expect(progressWrites).toBeGreaterThan(5);

    // Every write carries counts that agree with the results it carries.
    const finalProgress: JSONObject = stored(row).progress as JSONObject;
    expect(finalProgress["devicesCreated"]).toBe(514);
    expect(finalProgress["hostsDone"]).toBe(514);
  });

  test("a job past its time budget hands over to a fresh job, and the next one carries on from where it stopped", async () => {
    const hosts: Array<DiscoveredNetworkDevice> = hostsOfSize(10);
    db.scan = scanWith(hosts);

    let creates: number = 0;
    (NetworkDeviceService.create as jest.Mock).mockImplementation(
      async (data: { data: NetworkDevice }) => {
        creates++;
        // The fifth host takes the job past its 45 minutes.
        clock += creates === 5 ? 50 * 60 * 1000 : 100;
        const created: NetworkDevice = Object.assign(
          new NetworkDevice(),
          data.data,
        );
        created.id = ObjectID.generate();
        db.devicesByHostname.set(created.hostname!, created);
        return created;
      },
    );

    const row: NetworkDeviceDiscoveryImport = await start({
      ipAddresses: hosts.map((host: DiscoveredNetworkDevice) => {
        return host.ipAddress;
      }),
    });
    (Queue.addJob as jest.Mock).mockClear();

    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Running);
    expect(Queue.addJob).toHaveBeenCalledTimes(1);
    expect(creates).toBe(5);

    // The fresh job picks up the rest, and touches nothing settled.
    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Completed);
    expect(creates).toBe(10);
  });
});

describe("one import of a project at a time", () => {
  test("a second import waits as Queued and runs after the first, oldest first", async () => {
    const first: NetworkDeviceDiscoveryImport = await start({
      ipAddresses: ["10.0.0.1"],
    });
    clock += 1000;
    const second: NetworkDeviceDiscoveryImport = await start({
      ipAddresses: ["10.0.0.2"],
    });

    const order: Array<string> = [];
    (NetworkDeviceService.create as jest.Mock).mockImplementation(
      async (data: { data: NetworkDevice }) => {
        order.push(data.data.hostname!);
        const created: NetworkDevice = Object.assign(
          new NetworkDevice(),
          data.data,
        );
        created.id = ObjectID.generate();
        return created;
      },
    );

    await runAll();

    expect(order).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(stored(first).status).toBe(DiscoveryImportStatus.Completed);
    expect(stored(second).status).toBe(DiscoveryImportStatus.Completed);
  });

  test("a job that cannot take the project's lock leaves the work to the job that holds it", async () => {
    const row: NetworkDeviceDiscoveryImport = await start();
    (Semaphore.lock as jest.Mock).mockRejectedValue(new Error("held"));

    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Queued);
    expect(NetworkDeviceService.create).not.toHaveBeenCalled();
  });
});

// ---- Stopping and retrying.

describe("stopping an import", () => {
  test("a queued import stops at once: nothing is created, every host is listed as not reached", async () => {
    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
    });

    await DiscoveryImportRunner.stop({
      projectId: PROJECT_ID,
      props: personProps,
      importId: row.id!,
    });
    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Stopped);
    expect(db.createdDevices).toHaveLength(0);
    expect(
      resultsOf(row).map((result: DiscoveryImportHostResult) => {
        return [result.device, result.monitor];
      }),
    ).toEqual([
      [
        DiscoveryImportDeviceOutcome.NotReached,
        DiscoveryImportMonitorOutcome.Skipped,
      ],
      [
        DiscoveryImportDeviceOutcome.NotReached,
        DiscoveryImportMonitorOutcome.Skipped,
      ],
      [
        DiscoveryImportDeviceOutcome.NotReached,
        DiscoveryImportMonitorOutcome.Skipped,
      ],
    ]);
  });

  test("a running import stops before its next host, and keeps what it created", async () => {
    const hosts: Array<DiscoveredNetworkDevice> = hostsOfSize(6);
    db.scan = scanWith(hosts);
    const row: NetworkDeviceDiscoveryImport = await start({
      ipAddresses: hosts.map((host: DiscoveredNetworkDevice) => {
        return host.ipAddress;
      }),
    });

    let creates: number = 0;
    (NetworkDeviceService.create as jest.Mock).mockImplementation(
      async (data: { data: NetworkDevice }) => {
        creates++;
        if (creates === 2) {
          await DiscoveryImportRunner.stop({
            projectId: PROJECT_ID,
            props: personProps,
            importId: row.id!,
          });
        }
        const created: NetworkDevice = Object.assign(
          new NetworkDevice(),
          data.data,
        );
        created.id = ObjectID.generate();
        return created;
      },
    );

    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Stopped);
    expect(creates).toBe(2);
    expect(
      resultsOf(row).map((result: DiscoveryImportHostResult) => {
        return result.device;
      }),
    ).toEqual([
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportDeviceOutcome.NotReached,
      DiscoveryImportDeviceOutcome.NotReached,
      DiscoveryImportDeviceOutcome.NotReached,
      DiscoveryImportDeviceOutcome.NotReached,
    ]);
  });

  test("stopping needs the right to create devices", async () => {
    const row: NetworkDeviceDiscoveryImport = await start();

    await expect(
      DiscoveryImportRunner.stop({
        projectId: PROJECT_ID,
        props: propsWith([Permission.ReadNetworkDeviceDiscoveryScan]),
        importId: row.id!,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });
});

describe("trying again", () => {
  async function importedWithFailures(): Promise<NetworkDeviceDiscoveryImport> {
    db.refuseDeviceAt.set(
      "10.0.0.3",
      new BadDataException("The probe cannot be attached to this project."),
    );
    const row: NetworkDeviceDiscoveryImport = await start({
      settings: WITH_TEMPLATE,
    });
    // The printer's monitor is refused; its device is in.
    (MonitorService.create as jest.Mock).mockImplementation(
      async (data: { data: Monitor }) => {
        const monitor: Monitor = data.data;
        if (
          monitor.autoProvisionedNetworkDeviceId?.toString() ===
          db.devicesByHostname.get("10.0.0.2")?.id?.toString()
        ) {
          throw new BadDataException("Monitor limit reached.");
        }
        monitor.id = ObjectID.generate();
        db.monitors.set(
          monitorKey(
            monitor.autoProvisionedNetworkDeviceId,
            monitor.monitorTemplateId,
          ),
          monitor,
        );
        db.createdMonitors.push({ monitor: monitor, props: {} });
        return monitor;
      },
    );
    await runAll();
    return row;
  }

  test("only the hosts that failed are tried again, and nothing is created twice", async () => {
    const first: NetworkDeviceDiscoveryImport = await importedWithFailures();
    expect(resultAt(first, "10.0.0.3").device).toBe(
      DiscoveryImportDeviceOutcome.Failed,
    );
    expect(resultAt(first, "10.0.0.2").monitor).toBe(
      DiscoveryImportMonitorOutcome.Failed,
    );

    // The causes are fixed.
    db.refuseDeviceAt.clear();
    installFakes();

    const retry: NetworkDeviceDiscoveryImport =
      await DiscoveryImportRunner.retry({
        projectId: PROJECT_ID,
        props: personProps,
        importId: first.id!,
      });

    expect(stored(retry).retryOfImportId?.toString()).toBe(
      first.id!.toString(),
    );
    expect(
      resultsOf(retry).map((result: DiscoveryImportHostResult) => {
        return result.ipAddress;
      }),
    ).toEqual(["10.0.0.2", "10.0.0.3"]);

    const devicesBefore: number = db.devicesByHostname.size;
    await runAll();

    // The printer is found, and only its monitor is made.
    expect(resultAt(retry, "10.0.0.2")).toEqual(
      expect.objectContaining({
        device: DiscoveryImportDeviceOutcome.AlreadyAdded,
        monitor: DiscoveryImportMonitorOutcome.Created,
      }),
    );
    expect(resultAt(retry, "10.0.0.3")).toEqual(
      expect.objectContaining({
        device: DiscoveryImportDeviceOutcome.Created,
        monitor: DiscoveryImportMonitorOutcome.Created,
      }),
    );
    expect(db.devicesByHostname.size).toBe(devicesBefore + 1);
    // The switch was imported with its monitor the first time: not touched.
    expect(
      db.createdMonitors.filter((created: { monitor: Monitor }) => {
        return (
          created.monitor.autoProvisionedNetworkDeviceId?.toString() ===
          db.devicesByHostname.get("10.0.0.1")?.id?.toString()
        );
      }),
    ).toHaveLength(1);
  });

  test("an import still running, or one with nothing left to try, is not retried", async () => {
    const running: NetworkDeviceDiscoveryImport = await start();
    await expect(
      DiscoveryImportRunner.retry({
        projectId: PROJECT_ID,
        props: personProps,
        importId: running.id!,
      }),
    ).rejects.toThrow("still running");

    await runAll();
    await expect(
      DiscoveryImportRunner.retry({
        projectId: PROJECT_ID,
        props: personProps,
        importId: running.id!,
      }),
    ).rejects.toThrow("nothing to try again");
  });

  test("a retry acts as whoever asks for it, with their own rights", async () => {
    const first: NetworkDeviceDiscoveryImport = await importedWithFailures();

    await expect(
      DiscoveryImportRunner.retry({
        projectId: PROJECT_ID,
        props: propsWith(DEVICE_IMPORTER),
        importId: first.id!,
      }),
    ).rejects.toThrow("You may not create monitors");
  });

  test("an import of another project is not found", async () => {
    const row: NetworkDeviceDiscoveryImport = await start();
    await runAll();

    await expect(
      DiscoveryImportRunner.retry({
        projectId: OTHER_PROJECT_ID,
        props: personProps,
        importId: row.id!,
      }),
    ).rejects.toThrow("This import was not found.");
  });
});

// ---- The sweep.

describe("picking up imports a worker left behind", () => {
  test("a running import that has gone quiet is picked up again, and its resume counted", async () => {
    const row: NetworkDeviceDiscoveryImport = await start();
    stored(row).status = DiscoveryImportStatus.Running;
    stored(row).updatedAt = new Date(clock);
    (Queue.addJob as jest.Mock).mockClear();

    await DiscoveryImportRunner.sweep(
      new Date(clock + DISCOVERY_IMPORT_STALE_RUNNING_MS + 1000),
    );

    expect(stored(row).resumeCount).toBe(1);
    expect(Queue.addJob).toHaveBeenCalledTimes(1);
  });

  test("a running import that is still writing is left alone", async () => {
    const row: NetworkDeviceDiscoveryImport = await start();
    stored(row).status = DiscoveryImportStatus.Running;
    stored(row).updatedAt = new Date(clock);
    (Queue.addJob as jest.Mock).mockClear();

    await DiscoveryImportRunner.sweep(new Date(clock + 3 * 60 * 1000));

    expect(stored(row).resumeCount).toBe(0);
    expect(Queue.addJob).not.toHaveBeenCalled();
  });

  test(`an import picked up ${MAX_DISCOVERY_IMPORT_RESUMES} times is failed, its unreached hosts listed for a retry`, async () => {
    const row: NetworkDeviceDiscoveryImport = await start();
    stored(row).status = DiscoveryImportStatus.Running;
    stored(row).resumeCount = MAX_DISCOVERY_IMPORT_RESUMES;
    stored(row).updatedAt = new Date(clock);

    await DiscoveryImportRunner.sweep(
      new Date(clock + DISCOVERY_IMPORT_STALE_RUNNING_MS + 1000),
    );

    expect(stored(row).status).toBe(DiscoveryImportStatus.Failed);
    expect(stored(row).error).toContain("try the hosts it did not reach again");
    expect(
      resultsOf(row).every((result: DiscoveryImportHostResult) => {
        return result.device === DiscoveryImportDeviceOutcome.NotReached;
      }),
    ).toBe(true);
  });

  test("a queued import whose job never ran is queued again; one waiting for hours is failed", async () => {
    const waiting: NetworkDeviceDiscoveryImport = await start();
    (Queue.addJob as jest.Mock).mockClear();

    await DiscoveryImportRunner.sweep(new Date(clock + 3 * 60 * 1000));
    expect(Queue.addJob).toHaveBeenCalledTimes(1);
    expect(stored(waiting).status).toBe(DiscoveryImportStatus.Queued);

    await DiscoveryImportRunner.sweep(new Date(clock + 7 * 60 * 60 * 1000));
    expect(stored(waiting).status).toBe(DiscoveryImportStatus.Failed);
    expect(stored(waiting).error).toContain("waited too long");
  });
});

// ---- The view.

describe("an import as the Dashboard reads it", () => {
  test("lists the hosts worth a line by default, every host when asked", async () => {
    db.refuseDeviceAt.set("10.0.0.3", new BadDataException("Refused."));
    const row: NetworkDeviceDiscoveryImport = await start();
    await runAll();

    const view: DiscoveryImportView = DiscoveryImportRunner.toView({
      row: stored(row),
      userId: PERSON_ID,
    });

    expect(view.status).toBe(DiscoveryImportStatus.Completed);
    expect(view.isMine).toBe(true);
    expect(view.progress).toEqual(
      expect.objectContaining({
        hosts: 3,
        hostsDone: 3,
        devicesCreated: 2,
        devicesFailed: 1,
      }),
    );
    expect(
      view.results!.map((result: DiscoveryImportHostResult) => {
        return result.ipAddress;
      }),
    ).toEqual(["10.0.0.3"]);
    expect(view.hasMoreResults).toBeUndefined();

    const all: DiscoveryImportView = DiscoveryImportRunner.toView({
      row: stored(row),
      userId: ObjectID.generate(),
      allResults: true,
    });

    expect(all.results).toHaveLength(3);
    expect(all.isMine).toBe(false);
  });

  test("a stop asked for shows only while the import is still active", async () => {
    const row: NetworkDeviceDiscoveryImport = await start();
    stored(row).status = DiscoveryImportStatus.Running;
    stored(row).stopRequestedAt = new Date(clock);

    expect(
      DiscoveryImportRunner.toView({ row: stored(row) }).isStopRequested,
    ).toBe(true);

    stored(row).status = DiscoveryImportStatus.Stopped;
    expect(
      DiscoveryImportRunner.toView({ row: stored(row) }).isStopRequested,
    ).toBeUndefined();
  });

  test("the API reads imports without their hosts", () => {
    expect(DISCOVERY_IMPORT_VIEW_SELECT["hosts"]).toBeUndefined();
    expect(DISCOVERY_IMPORT_VIEW_SELECT["results"]).toBe(true);
  });
});

// ---- Names: the device a row becomes is called what the row said.

/*
 * The import dialog names every row with the shared naming rules, from the
 * scan as it is now (DiscoveredHostTable, DiscoveryReviewHostname.test.ts).
 * The server builds each device from the same scan, read with the same
 * naming choice, through the same builder - so the name on the row is the
 * name the device gets, the DNS name and the name's source ride along, and
 * a collision is retried the way the row's naming would have it (issues
 * #3529, #3677, #3678, #4518).
 */
describe("names: the device a row becomes is called what the row said", () => {
  const FQDN: string = "core-gw.corp.example.com";

  function createdAt(address: string): NetworkDevice {
    const created: { device: NetworkDevice } | undefined =
      db.createdDevices.find((entry: { device: NetworkDevice }): boolean => {
        return entry.device.hostname === address;
      });

    if (!created) {
      throw new Error(`No device was created at ${address}.`);
    }

    return created.device;
  }

  test("a scan set to short names creates the short name, and keeps the full name as the DNS name", async () => {
    db.scan = scanWith(
      [{ ipAddress: "10.0.0.1", snmpReachable: false, dnsHostname: FQDN }],
      { useShortDeviceNames: true },
    );

    const row: NetworkDeviceDiscoveryImport = await start({
      ipAddresses: ["10.0.0.1"],
    });
    await runAll();

    expect(createdAt("10.0.0.1").name).toBe("core-gw");
    expect(createdAt("10.0.0.1").dnsName).toBe(FQDN);
    expect(resultAt(row, "10.0.0.1").name).toBe("core-gw");
  });

  test("a scan that did not ask creates the full name", async () => {
    db.scan = scanWith([
      { ipAddress: "10.0.0.1", snmpReachable: false, dnsHostname: FQDN },
    ]);

    await start({ ipAddresses: ["10.0.0.1"] });
    await runAll();

    expect(createdAt("10.0.0.1").name).toBe(FQDN);
    expect(createdAt("10.0.0.1").dnsName).toBe(FQDN);
  });

  test("a short name already taken is retried as the short name with the address, never the full name", async () => {
    db.scan = scanWith(
      [{ ipAddress: "10.0.0.1", snmpReachable: false, dnsHostname: FQDN }],
      { useShortDeviceNames: true },
    );
    db.refuseDeviceNamed.set(
      "core-gw",
      new BadDataException("Network Device with the same name already exists."),
    );

    await start({ ipAddresses: ["10.0.0.1"] });
    await runAll();

    expect(createdAt("10.0.0.1").name).toBe("core-gw (10.0.0.1)");
    expect(createdAt("10.0.0.1").dnsName).toBe(FQDN);
  });

  test("two hosts whose short names collide both import", async () => {
    db.scan = scanWith(
      [
        {
          ipAddress: "10.0.0.1",
          snmpReachable: false,
          dnsHostname: "web.corp.example.com",
        },
        {
          ipAddress: "10.0.0.2",
          snmpReachable: false,
          dnsHostname: "web.lab.example.com",
        },
      ],
      { useShortDeviceNames: true },
    );

    // The first create takes "web"; the second is refused for it.
    (NetworkDeviceService.create as jest.Mock).mockImplementationOnce(
      async (data: { data: NetworkDevice; props: unknown }) => {
        const created: NetworkDevice = Object.assign(
          new NetworkDevice(),
          data.data,
        );
        created.id = ObjectID.generate();
        db.devicesByHostname.set(created.hostname!, created);
        db.createdDevices.push({ device: created, props: data.props });
        db.refuseDeviceNamed.set(
          "web",
          new BadDataException(
            "Network Device with the same name already exists.",
          ),
        );
        return created;
      },
    );

    await start({ ipAddresses: ["10.0.0.1", "10.0.0.2"] });
    await runAll();

    expect(createdAt("10.0.0.1").name).toBe("web");
    expect(createdAt("10.0.0.2").name).toBe("web (10.0.0.2)");
  });

  test("a host named by its NetBIOS answer is created under it, with no DNS name", async () => {
    db.scan = scanWith([
      {
        ipAddress: "10.0.0.1",
        snmpReachable: false,
        netbiosName: "accounts-pc01",
      },
    ]);

    await start({ ipAddresses: ["10.0.0.1"] });
    await runAll();

    expect(createdAt("10.0.0.1").name).toBe("accounts-pc01");
    expect(createdAt("10.0.0.1").dnsName).toBeUndefined();
  });

  test("the reported displays: each by its own hostname, its DNS name kept, its name's source recorded", async () => {
    db.scan = scanWith(
      [
        { ipAddress: "10.16.42.52", snmpReachable: false },
        {
          ipAddress: "10.16.42.53",
          snmpReachable: true,
          sysName: "WB0024KDS03",
          dnsHostname: "wb-0024-kds03.wbhq.com",
        },
        {
          ipAddress: "10.16.42.54",
          snmpReachable: false,
          dnsHostname: "wb-0024-kds04.wbhq.com",
          netbiosName: "WB0024KDS04",
        },
      ],
      { useShortDeviceNames: true, isNetbiosLookupEnabled: true },
    );

    await start({
      ipAddresses: ["10.16.42.52", "10.16.42.53", "10.16.42.54"],
    });
    await runAll();

    expect(
      ["10.16.42.52", "10.16.42.53", "10.16.42.54"].map((address: string) => {
        const device: NetworkDevice = createdAt(address);

        return {
          name: device.name,
          dnsName: device.dnsName,
          discoveredName: device.discoveredName,
          discoveredNameSource: device.discoveredNameSource,
        };
      }),
    ).toEqual([
      {
        name: "10.16.42.52",
        dnsName: undefined,
        discoveredName: "10.16.42.52",
        discoveredNameSource: "address",
      },
      {
        name: "WB0024KDS03",
        dnsName: "wb-0024-kds03.wbhq.com",
        discoveredName: "WB0024KDS03",
        discoveredNameSource: "system-name",
      },
      {
        name: "WB0024KDS04",
        dnsName: "wb-0024-kds04.wbhq.com",
        discoveredName: "WB0024KDS04",
        discoveredNameSource: "netbios-name",
      },
    ]);
  });

  test("a NetBIOS answer the naming rules reject leaves the device on its address", async () => {
    db.scan = scanWith([
      {
        ipAddress: "10.0.0.1",
        snmpReachable: false,
        netbiosName: "<img src=x onerror=alert(1)>",
      },
    ]);

    await start({ ipAddresses: ["10.0.0.1"] });
    await runAll();

    expect(createdAt("10.0.0.1").name).toBe("10.0.0.1");
  });
});

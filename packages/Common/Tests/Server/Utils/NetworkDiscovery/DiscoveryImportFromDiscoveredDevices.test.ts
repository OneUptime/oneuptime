import DiscoveryImportRunner from "../../../../Server/Utils/NetworkDiscovery/DiscoveryImportRunner";
import DiscoveredDevices, {
  ClassifiedDiscoveredDevice,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDevices";
import Queue from "../../../../Server/Infrastructure/Queue";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import NetworkDeviceDiscoveryImportService from "../../../../Server/Services/NetworkDeviceDiscoveryImportService";
import NetworkDeviceDiscoveryScanService from "../../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceRoleService from "../../../../Server/Services/NetworkDeviceRoleService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkSnmpCredentialProfileService from "../../../../Server/Services/NetworkSnmpCredentialProfileService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryImport from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";
import NetworkDeviceRole from "../../../../Models/DatabaseModels/NetworkDeviceRole";
import NetworkSnmpCredentialProfile from "../../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import {
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportSource,
  DiscoveryImportStatus,
  DiscoveryImportView,
  readDiscoveryImportHostResults,
} from "../../../../Types/NetworkDevice/DiscoveryImport";
import { DeviceNameSource } from "../../../../Types/NetworkDevice/DeviceNameSource";
import NetworkDeviceMonitoringMethod from "../../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ADDING DISCOVERED DEVICES TO MONITORING (OneUptime issue #5775).
 *
 * The devices switches, routers and network controllers saw - rows of the
 * Discovered Devices list - imported by the same runner, job and worker as a
 * scan's hosts, with no scan behind them. Driven against in-memory stand-ins
 * for the import's rows, the devices, the list's classification, and the
 * project's roles and credential profiles, with the real permission checks
 * on props built the way a request's are.
 *
 * What it must get right: each device keeps the MAC it was seen with (a
 * network controller's traffic finds a device by it), is polled by the probe
 * that polls the switch that saw it, lands in the site it was seen in, and
 * is never made twice - not when a monitored device has its MAC, not when
 * one is polled at its address in its site - while the same address in
 * another site is another device.
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
      findBy: jest.fn(),
      getDevicesByHostnames: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/NetworkDeviceRoleService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock(
  "../../../../Server/Services/NetworkSnmpCredentialProfileService",
  () => {
    return { __esModule: true, default: { findOneBy: jest.fn() } };
  },
);

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

jest.mock("../../../../Server/Utils/Billing/CallerPlan", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../../Server/Utils/Billing/CallerPlan",
  );
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
const PERSON_ID: ObjectID = new ObjectID(
  "bb000000-0000-4000-8000-000000000001",
);
const SWITCH_ID: string = "cc000000-0000-4000-8000-000000000001";
const CONTROLLER_DEVICE_ID: string = "cc000000-0000-4000-8000-000000000002";
const SWITCH_PROBE_ID: string = "dd000000-0000-4000-8000-000000000001";
const STORE_A: string = "ee000000-0000-4000-8000-00000000000a";
const STORE_B: string = "ee000000-0000-4000-8000-00000000000b";
const ROLE_ID: string = "ff000000-0000-4000-8000-000000000001";
const PROFILE_ID: string = "ff000000-0000-4000-8000-000000000002";

const PRINTER_ID: string = "10000000-0000-4000-8000-000000000001";
const CAMERA_ID: string = "10000000-0000-4000-8000-000000000002";
const REGISTER_A_ID: string = "10000000-0000-4000-8000-000000000003";
const REGISTER_B_ID: string = "10000000-0000-4000-8000-000000000004";
const NO_ADDRESS_ID: string = "10000000-0000-4000-8000-000000000005";

const IMPORTER: Array<Permission> = [
  Permission.CreateNetworkDevice,
  Permission.ReadNetworkEndpoint,
  Permission.ReadNetworkDeviceRole,
  Permission.ReadNetworkSnmpCredentialProfile,
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

function discovered(
  fields: Partial<ClassifiedDiscoveredDevice> & { id: string },
): ClassifiedDiscoveredDevice {
  return {
    name: fields.ipAddress || fields.macAddress || fields.id,
    macAddress: "00:00:00:00:00:00",
    isSeenRecently: true,
    isFromController: false,
    isHidden: false,
    ...fields,
  };
}

const PRINTER: ClassifiedDiscoveredDevice = discovered({
  id: PRINTER_ID,
  name: "Back office printer",
  classification: "Back office printer",
  ipAddress: "10.0.0.20",
  macAddress: "00:11:22:33:44:20",
  vendor: "Zebra",
  siteId: STORE_A,
  site: { id: STORE_A },
  seenOnDeviceId: SWITCH_ID,
  seenOn: { id: SWITCH_ID },
});
const CAMERA: ClassifiedDiscoveredDevice = discovered({
  id: CAMERA_ID,
  name: "10.0.0.30",
  ipAddress: "10.0.0.30",
  macAddress: "00:11:22:33:44:30",
  siteId: STORE_A,
  site: { id: STORE_A },
  // Seen on a device no probe polls (a controller's): the site's is used.
  seenOnDeviceId: CONTROLLER_DEVICE_ID,
  seenOn: { id: CONTROLLER_DEVICE_ID },
});
const REGISTER_A: ClassifiedDiscoveredDevice = discovered({
  id: REGISTER_A_ID,
  name: "10.0.0.5",
  ipAddress: "10.0.0.5",
  macAddress: "00:11:22:33:44:0a",
  siteId: STORE_A,
  site: { id: STORE_A },
  seenOnDeviceId: SWITCH_ID,
});
const REGISTER_B: ClassifiedDiscoveredDevice = discovered({
  id: REGISTER_B_ID,
  name: "10.0.0.5",
  ipAddress: "10.0.0.5",
  macAddress: "00:11:22:33:44:0b",
  siteId: STORE_B,
  site: { id: STORE_B },
  seenOnDeviceId: SWITCH_ID,
});
const NO_ADDRESS: ClassifiedDiscoveredDevice = discovered({
  id: NO_ADDRESS_ID,
  name: "00:11:22:33:44:99",
  macAddress: "00:11:22:33:44:99",
  seenOnDeviceId: SWITCH_ID,
});

interface FakeDatabase {
  imports: Map<string, NetworkDeviceDiscoveryImport>;
  listed: Array<ClassifiedDiscoveredDevice>;
  devices: Array<NetworkDevice>;
  created: Array<{ device: NetworkDevice; props: unknown }>;
  refuseDeviceNamed: Map<string, Error>;
  roleExists: boolean;
  profileExists: boolean;
  refuseRoleRead: boolean;
}

let db: FakeDatabase;
let personProps: DatabaseCommonInteractionProps;

// What a QueryHelper.any() condition (a Raw IN with its values as parameters) holds.
function valuesOf(condition: unknown): Array<string> {
  if (condition && typeof condition === "object") {
    const parameters: Record<string, unknown> =
      (condition as { objectLiteralParameters?: Record<string, unknown> })
        .objectLiteralParameters || {};
    const values: unknown = Object.values(parameters)[0];

    return Array.isArray(values)
      ? values.map((item: unknown): string => {
          return String(item);
        })
      : [];
  }

  return condition === undefined || condition === null
    ? []
    : [String(condition)];
}

function installFakes(): void {
  (NetworkDeviceDiscoveryImportService.create as jest.Mock).mockImplementation(
    async (data: { data: NetworkDeviceDiscoveryImport }) => {
      const row: NetworkDeviceDiscoveryImport = data.data;
      row.id = ObjectID.generate();
      row.createdAt = new Date();
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

    return row
      ? Object.assign(new NetworkDeviceDiscoveryImport(), {
          ...row,
          hosts: JSON.parse(JSON.stringify(row.hosts || [])),
          results: JSON.parse(JSON.stringify(row.results || [])),
        })
      : null;
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
      return findImport(data.query["_id"]);
    }

    const waiting: NetworkDeviceDiscoveryImport | undefined = Array.from(
      db.imports.values(),
    ).find((row: NetworkDeviceDiscoveryImport): boolean => {
      return row.status === data.query["status"];
    });

    return waiting ? findImport(waiting.id) : null;
  });

  (
    NetworkDeviceDiscoveryImportService.updateOneById as jest.Mock
  ).mockImplementation(async (data: { id: unknown; data: JSONObject }) => {
    const row: NetworkDeviceDiscoveryImport | undefined = db.imports.get(
      String(data.id),
    );

    if (row) {
      Object.assign(row, JSON.parse(JSON.stringify(data.data)));
    }
  });

  jest
    .spyOn(DiscoveredDevices, "classify")
    .mockImplementation(async (data: { endpointIds: Array<string> }) => {
      const wanted: Set<string> = new Set<string>(data.endpointIds);

      return db.listed.filter((row: ClassifiedDiscoveredDevice): boolean => {
        return wanted.has(row.id);
      });
    });

  (NetworkDeviceService.findOneBy as jest.Mock).mockImplementation(
    async (data: { query: Record<string, unknown> }) => {
      if (data.query["_id"]) {
        return (
          db.devices.find((device: NetworkDevice): boolean => {
            return device.id?.toString() === String(data.query["_id"]);
          }) || null
        );
      }

      const macs: Array<string> = valuesOf(data.query["macAddress"]);

      return (
        db.devices.find((device: NetworkDevice): boolean => {
          return macs.includes(device.macAddress || "");
        }) || null
      );
    },
  );

  (NetworkDeviceService.findBy as jest.Mock).mockImplementation(
    async (data: { query: Record<string, unknown> }) => {
      if (data.query["_id"]) {
        // The switches' probes: the switch has one, the controller's device none.
        return valuesOf(data.query["_id"]).map((id: string): NetworkDevice => {
          const device: NetworkDevice = new NetworkDevice();
          device.id = new ObjectID(id);

          if (id === SWITCH_ID) {
            device.probeId = new ObjectID(SWITCH_PROBE_ID);
          }

          return device;
        });
      }

      return db.devices.filter((device: NetworkDevice): boolean => {
        return device.hostname === data.query["hostname"];
      });
    },
  );

  (NetworkDeviceService.create as jest.Mock).mockImplementation(
    async (data: { data: NetworkDevice; props: unknown }) => {
      const refusal: Error | undefined = db.refuseDeviceNamed.get(
        data.data.name || "",
      );

      if (refusal) {
        throw refusal;
      }

      const created: NetworkDevice = Object.assign(
        new NetworkDevice(),
        data.data,
      );
      created.id = ObjectID.generate();
      db.devices.push(created);
      db.created.push({ device: created, props: data.props });
      return created;
    },
  );

  (NetworkDeviceRoleService.findOneBy as jest.Mock).mockImplementation(
    async () => {
      if (db.refuseRoleRead) {
        throw new NotAuthorizedException("no");
      }

      return db.roleExists ? new NetworkDeviceRole() : null;
    },
  );

  (
    NetworkSnmpCredentialProfileService.findOneBy as jest.Mock
  ).mockImplementation(async () => {
    return db.profileExists ? new NetworkSnmpCredentialProfile() : null;
  });

  (Semaphore.lock as jest.Mock).mockImplementation(async () => {
    return { key: "lock" };
  });
  (Semaphore.release as jest.Mock).mockImplementation(async () => {});
  (Queue.addJob as jest.Mock).mockImplementation(async () => {
    return {};
  });

  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation(async () => {
      return personProps;
    });
}

beforeEach(() => {
  db = {
    imports: new Map(),
    listed: [PRINTER, CAMERA, REGISTER_A, REGISTER_B, NO_ADDRESS],
    devices: [],
    created: [],
    refuseDeviceNamed: new Map(),
    roleExists: true,
    profileExists: true,
    refuseRoleRead: false,
  };
  personProps = propsWith(IMPORTER);
  installFakes();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const SETTINGS: JSONObject = {
  pollingIntervalInMinutes: 10,
  applyVendorTemplates: true,
  alerting: DiscoveryImportAlerting.None,
  networkDeviceRoleId: ROLE_ID,
  snmpCredentialProfileId: PROFILE_ID,
};

async function start(
  endpointIds: Array<string>,
  overrides: {
    settings?: JSONObject;
    props?: DatabaseCommonInteractionProps;
  } = {},
): Promise<NetworkDeviceDiscoveryImport> {
  return await DiscoveryImportRunner.startFromDiscoveredDevices({
    projectId: PROJECT_ID,
    props: overrides.props || personProps,
    endpointIds: endpointIds,
    settings: overrides.settings || SETTINGS,
  });
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

function resultFor(
  row: NetworkDeviceDiscoveryImport,
  endpointId: string,
): DiscoveryImportHostResult {
  return resultsOf(row).find((result: DiscoveryImportHostResult): boolean => {
    return result.endpointId === endpointId;
  })!;
}

function createdFor(address: string, siteId: string): NetworkDevice {
  return db.created.find((entry: { device: NetworkDevice }): boolean => {
    return (
      entry.device.hostname === address &&
      entry.device.siteId?.toString() === siteId
    );
  })!.device;
}

async function runAll(): Promise<void> {
  await DiscoveryImportRunner.runProjectImports(PROJECT_ID);
}

describe("asking to add discovered devices to monitoring", () => {
  test("records each device, in the order picked, with what it will be created from, and queues the project's job", async () => {
    const row: NetworkDeviceDiscoveryImport = await start([
      CAMERA_ID,
      PRINTER_ID,
    ]);

    expect(stored(row).status).toBe(DiscoveryImportStatus.Queued);
    expect(stored(row).networkDeviceDiscoveryScanId).toBeUndefined();
    expect(stored(row).createdByUserId?.toString()).toBe(PERSON_ID.toString());
    expect(stored(row).hosts).toEqual([
      {
        ipAddress: "10.0.0.30",
        discoveredDevice: {
          endpointId: CAMERA_ID,
          name: "10.0.0.30",
          macAddress: "00:11:22:33:44:30",
          siteId: STORE_A,
        },
      },
      {
        ipAddress: "10.0.0.20",
        discoveredDevice: {
          endpointId: PRINTER_ID,
          name: "Back office printer",
          macAddress: "00:11:22:33:44:20",
          siteId: STORE_A,
          probeId: SWITCH_PROBE_ID,
          // What a naming rule's Vendor condition and {vendor} read (#6619).
          vendor: "Zebra",
        },
      },
    ]);
    expect(resultsOf(row)).toEqual([
      {
        ipAddress: "10.0.0.30",
        endpointId: CAMERA_ID,
        name: "10.0.0.30",
        isPingOnly: false,
        device: DiscoveryImportDeviceOutcome.Pending,
        monitor: DiscoveryImportMonitorOutcome.NotRequested,
      },
      {
        ipAddress: "10.0.0.20",
        endpointId: PRINTER_ID,
        name: "Back office printer",
        isPingOnly: false,
        device: DiscoveryImportDeviceOutcome.Pending,
        monitor: DiscoveryImportMonitorOutcome.NotRequested,
      },
    ]);
    expect(Queue.addJob).toHaveBeenCalledTimes(1);
    expect(NetworkDeviceDiscoveryScanService.findOneBy).not.toHaveBeenCalled();
  });

  test("without SNMP credentials picked, each device is said to be checked by ping", async () => {
    const row: NetworkDeviceDiscoveryImport = await start([PRINTER_ID], {
      settings: { pollingIntervalInMinutes: 5 },
    });

    expect(resultsOf(row)[0]!.isPingOnly).toBe(true);
  });

  test("a device with no address cannot be polled and is left out", async () => {
    const row: NetworkDeviceDiscoveryImport = await start([
      NO_ADDRESS_ID,
      PRINTER_ID,
    ]);

    expect(
      resultsOf(row).map((result: DiscoveryImportHostResult): string => {
        return result.endpointId!;
      }),
    ).toEqual([PRINTER_ID]);
  });

  test("is refused, in a sentence, when none of the devices has an address", async () => {
    await expect(start([NO_ADDRESS_ID])).rejects.toThrow(
      new BadDataException(
        "None of the selected devices has an IP address, so OneUptime cannot check them. A device is listed with its address once a router's ARP table or a network controller reports one.",
      ),
    );
    expect(db.imports.size).toBe(0);
  });

  test("is refused when none of the devices is on the list any more", async () => {
    await expect(start([ObjectID.generate().toString()])).rejects.toThrow(
      new BadDataException(
        "None of the selected devices are in the Discovered Devices list any more. Refresh the list and select them again.",
      ),
    );
  });

  test("needs a person, who may read the list and create devices", async () => {
    await expect(
      start([PRINTER_ID], { props: { ...personProps, userId: undefined } }),
    ).rejects.toThrow(NotAuthorizedException);

    await expect(
      start([PRINTER_ID], {
        props: propsWith([Permission.CreateNetworkDevice]),
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "You may not see this project's discovered devices.",
      ),
    );

    await expect(
      start([PRINTER_ID], {
        props: propsWith([Permission.ReadNetworkEndpoint]),
      }),
    ).rejects.toThrow(NotAuthorizedException);

    expect(db.imports.size).toBe(0);
  });

  test("the role and the credentials are read as the person, and must still be there", async () => {
    db.roleExists = false;
    await expect(start([PRINTER_ID])).rejects.toThrow(
      new BadDataException(
        "This device role was not found. It may have been deleted: pick another one.",
      ),
    );

    db.roleExists = true;
    db.profileExists = false;
    await expect(start([PRINTER_ID])).rejects.toThrow(
      new BadDataException(
        "These SNMP credentials were not found. They may have been deleted: pick others.",
      ),
    );

    db.profileExists = true;
    db.refuseRoleRead = true;
    await expect(start([PRINTER_ID])).rejects.toThrow(
      new NotAuthorizedException(
        "You may not read this project's device roles, so you cannot say what the devices are.",
      ),
    );

    expect(NetworkDeviceRoleService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: ROLE_ID, projectId: PROJECT_ID },
        props: personProps,
      }),
    );
    expect(db.imports.size).toBe(0);
  });

  test("a selection is ids: anything else is refused before anything is read", async () => {
    await expect(start([])).rejects.toThrow(
      new BadDataException("Select the devices first."),
    );
    await expect(start(["not-an-id"])).rejects.toThrow(BadDataException);
    expect(DiscoveredDevices.classify).not.toHaveBeenCalled();
  });
});

describe("the import, on the worker", () => {
  test("creates each device at its address, in its site, keeping its MAC, polled by its switch's probe", async () => {
    const row: NetworkDeviceDiscoveryImport = await start([
      PRINTER_ID,
      CAMERA_ID,
    ]);

    await runAll();

    expect(stored(row).status).toBe(DiscoveryImportStatus.Completed);

    const printer: NetworkDevice = createdFor("10.0.0.20", STORE_A);

    expect(printer.name).toBe("Back office printer");
    expect(printer.macAddress).toBe("00:11:22:33:44:20");
    expect(printer.isMacAddressLearned).toBe(true);
    expect(printer.probeId?.toString()).toBe(SWITCH_PROBE_ID);
    expect(printer.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
    expect(printer.pollingIntervalInMinutes).toBe(10);
    expect(printer.networkDeviceRoleId?.toString()).toBe(ROLE_ID);
    expect(printer.snmpCredentialProfileId?.toString()).toBe(PROFILE_ID);
    expect(printer.autoApplyVendorHealthTemplate).toBe(true);
    // A person named it: no later poll renames it.
    expect(printer.discoveredNameSource).toBeUndefined();

    // Seen on a device no probe polls: no probe set, so its site's is taken.
    const camera: NetworkDevice = createdFor("10.0.0.30", STORE_A);

    expect(camera.probeId).toBeUndefined();
    expect(camera.discoveredNameSource).toBe(DeviceNameSource.Address);
    expect(camera.discoveredName).toBe("10.0.0.30");

    // Created as the person who asked.
    for (const entry of db.created) {
      expect(entry.props).toBe(personProps);
    }

    expect(resultFor(row, PRINTER_ID).device).toBe(
      DiscoveryImportDeviceOutcome.Created,
    );
    expect(resultFor(row, PRINTER_ID).deviceId).toBe(printer.id!.toString());
  });

  test("a device already monitored with its MAC is found, not made twice", async () => {
    const existing: NetworkDevice = new NetworkDevice();
    existing.id = ObjectID.generate();
    existing.name = "Printer (typed by hand)";
    existing.hostname = "printer.corp.example.com";
    existing.macAddress = "00:11:22:33:44:20";
    db.devices.push(existing);

    const row: NetworkDeviceDiscoveryImport = await start([PRINTER_ID]);
    await runAll();

    expect(db.created).toHaveLength(0);
    expect(resultFor(row, PRINTER_ID)).toMatchObject({
      device: DiscoveryImportDeviceOutcome.AlreadyAdded,
      deviceId: existing.id.toString(),
      name: "Printer (typed by hand)",
    });
  });

  test("a device polled at its address in its site is found; the same address in another site is another device", async () => {
    const storeA: NetworkDevice = new NetworkDevice();
    storeA.id = ObjectID.generate();
    storeA.name = "Register, store A";
    storeA.hostname = "10.0.0.5";
    storeA.siteId = new ObjectID(STORE_A);
    db.devices.push(storeA);

    const row: NetworkDeviceDiscoveryImport = await start([
      REGISTER_A_ID,
      REGISTER_B_ID,
    ]);
    await runAll();

    expect(resultFor(row, REGISTER_A_ID)).toMatchObject({
      device: DiscoveryImportDeviceOutcome.AlreadyAdded,
      deviceId: storeA.id.toString(),
    });
    expect(resultFor(row, REGISTER_B_ID).device).toBe(
      DiscoveryImportDeviceOutcome.Created,
    );
    expect(createdFor("10.0.0.5", STORE_B).macAddress).toBe(
      "00:11:22:33:44:0b",
    );
  });

  test("two devices at one address in two sites are two results, told apart by the device", async () => {
    const row: NetworkDeviceDiscoveryImport = await start([
      REGISTER_A_ID,
      REGISTER_B_ID,
    ]);
    await runAll();

    expect(resultsOf(row)).toHaveLength(2);
    expect(resultFor(row, REGISTER_A_ID).device).toBe(
      DiscoveryImportDeviceOutcome.Created,
    );
    expect(resultFor(row, REGISTER_B_ID).device).toBe(
      DiscoveryImportDeviceOutcome.Created,
    );
    expect(db.created).toHaveLength(2);
  });

  test("a name another device has is tried again with the address", async () => {
    db.refuseDeviceNamed.set(
      "Back office printer",
      new BadDataException("A device with this name already exists."),
    );

    const row: NetworkDeviceDiscoveryImport = await start([PRINTER_ID]);
    await runAll();

    expect(createdFor("10.0.0.20", STORE_A).name).toBe(
      "Back office printer (10.0.0.20)",
    );
    expect(resultFor(row, PRINTER_ID).device).toBe(
      DiscoveryImportDeviceOutcome.Created,
    );
  });

  test("the view says the hosts came from the list, with no scan", async () => {
    const row: NetworkDeviceDiscoveryImport = await start([PRINTER_ID]);
    const view: DiscoveryImportView = DiscoveryImportRunner.toView({
      row: stored(row),
      userId: PERSON_ID,
    });

    expect(view.scanId).toBe("");
    expect(view.source).toBe(DiscoveryImportSource.DiscoveredDevices);
    expect(view.isMine).toBe(true);
  });

  test("a failed device is tried again by a retry, with no scan read", async () => {
    db.refuseDeviceNamed.set(
      "10.0.0.30",
      new NotAuthorizedException("You may not create devices in this site."),
    );

    const first: NetworkDeviceDiscoveryImport = await start([
      PRINTER_ID,
      CAMERA_ID,
    ]);
    await runAll();

    expect(resultFor(first, CAMERA_ID)).toMatchObject({
      device: DiscoveryImportDeviceOutcome.Failed,
      deviceError: "You may not create devices in this site.",
    });

    db.refuseDeviceNamed.clear();

    const retry: NetworkDeviceDiscoveryImport =
      await DiscoveryImportRunner.retry({
        projectId: PROJECT_ID,
        props: personProps,
        importId: first.id!,
      });

    expect(stored(retry).retryOfImportId?.toString()).toBe(
      first.id!.toString(),
    );
    expect(stored(retry).networkDeviceDiscoveryScanId).toBeUndefined();
    expect(
      resultsOf(retry).map((result: DiscoveryImportHostResult): string => {
        return result.endpointId!;
      }),
    ).toEqual([CAMERA_ID]);

    await runAll();

    expect(resultFor(retry, CAMERA_ID).device).toBe(
      DiscoveryImportDeviceOutcome.Created,
    );
    expect(NetworkDeviceDiscoveryScanService.findOneBy).not.toHaveBeenCalled();
  });

  test("a retry needs the right to read the list", async () => {
    db.refuseDeviceNamed.set(
      "10.0.0.30",
      new NotAuthorizedException("You may not create devices in this site."),
    );
    const first: NetworkDeviceDiscoveryImport = await start([CAMERA_ID]);
    await runAll();

    await expect(
      DiscoveryImportRunner.retry({
        projectId: PROJECT_ID,
        props: propsWith([Permission.CreateNetworkDevice]),
        importId: first.id!,
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "You may not see this project's discovered devices.",
      ),
    );
  });

  test("an address monitor of a device from the list runs on the device's probe", () => {
    const device: NetworkDevice = new NetworkDevice();
    device.probeId = new ObjectID(SWITCH_PROBE_ID);

    expect(
      DiscoveryImportRunner.getAddressMonitorProbes({
        device: device,
        scan: null,
      }),
    ).toEqual({ probes: [SWITCH_PROBE_ID] });
    expect(
      DiscoveryImportRunner.getAddressMonitorProbes({
        device: new NetworkDevice(),
        scan: null,
      }),
    ).toEqual({});
  });
});

import NetworkControllerConnection from "../../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import AuditLogService from "../../../../Server/Services/AuditLogService";
import NetworkDeviceNamingRuleService from "../../../../Server/Services/NetworkDeviceNamingRuleService";
import NetworkDeviceRoleService from "../../../../Server/Services/NetworkDeviceRoleService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkSiteAssignmentRuleService from "../../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkSiteLinkService from "../../../../Server/Services/NetworkSiteLinkService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import ProbeService from "../../../../Server/Services/ProbeService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ColumnWriteRefusedException from "../../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import logger from "../../../../Server/Utils/Logger";
import { ControllerIdentityHolder } from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceAdd";
import NetworkControllerDeviceAddRunner, {
  DEVICE_ADD_MAY_NOT_CREATE_DEVICES,
  DEVICE_ADD_MAY_NOT_CREATE_SITES,
  NetworkControllerDeviceAddDependencies,
  NetworkControllerDeviceAddOutcome,
} from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceAddRunner";
import {
  ControllerInventoryCandidate,
  ControllerInventoryLookup,
} from "../../../../Server/Utils/NetworkController/NetworkControllerInventory";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
  MAX_DEVICE_ADD_FAILURE_NAMES_KEPT,
  NetworkControllerDeviceAddRequest,
  NetworkControllerDeviceAddState,
  NetworkControllerDeviceAddStatus,
  buildQueuedNetworkControllerDeviceAddState,
  readNetworkControllerDeviceAddState,
  toNetworkControllerDeviceAddStateJson,
} from "../../../../Types/NetworkController/NetworkControllerDeviceAdd";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import { readNetworkDeviceDiscoveredDetails } from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryHookFreeWrites,
  useInMemoryTable,
} from "../../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  FAKE_API_KEY,
  FakeMerakiApi,
  FakeMerakiAppliance,
  FakeMerakiDevice,
  FakeMerakiNetwork,
  FakeMerakiOrganization,
  TestClock,
  createFakeMerakiApi,
  createTestClock,
} from "./FakeMerakiApi";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ADD DEVICES OF A MERAKI ORGANIZATION THE SIZE OF #10188'S - 700 networks,
 * 7,700 devices - THROUGH THE REAL SERVICES.
 *
 * The runner's own suite plays the database with arrays and replaces the
 * create of each device; that is how 16.0.0 shipped a job that could add
 * nothing: every device it built named its serial number, and the column
 * takes none from a person, so NetworkDeviceService refused every one -
 * after the job had added a site for every Meraki network.
 *
 * Here only Meraki (the fake dashboard API), who asked (their props) and
 * the two identity lookups the database answers in SQL are played. Every
 * site and device goes through NetworkSiteService and NetworkDeviceService
 * - their hooks, the column permissions, ColumnsOnlyOneUptimeWrites - into
 * tables in memory, as the person who asked:
 *
 *   - for a Project Owner, a Project Admin, a server admin acting in the
 *     project, and a custom role that may create devices and sites: every
 *     device is added with its serial number, MAC, address, role, site and
 *     Meraki's reading, its creator the person, and the audit log says so;
 *   - a role that may not create devices adds nothing, and no site;
 *   - asked again, nothing is added twice: every device is found by its
 *     serial number; past the 5,000 one ask adds, the next adds the rest;
 *   - a site is added only for a network whose devices are added: a
 *     network whose devices are all refused leaves no site behind;
 *   - the report says what was added, what was left out and why, and why
 *     the rest could not be added - one line a reason.
 */

jest.setTimeout(240_000);

const PROJECT: ObjectID = new ObjectID("10188000-0000-4000-8000-000000000001");
const CONNECTION: ObjectID = new ObjectID(
  "10188000-0000-4000-8000-000000000002",
);
const PERSON: ObjectID = new ObjectID("10188000-0000-4000-8000-000000000003");
const START: Date = new Date("2026-11-20T09:00:00.000Z");

const ROLE_IDS: Record<string, string> = {
  switch: "10188000-0000-4000-8000-0000000000a1",
  wirelessAccessPoint: "10188000-0000-4000-8000-0000000000a2",
  firewall: "10188000-0000-4000-8000-0000000000a3",
  camera: "10188000-0000-4000-8000-0000000000a4",
};

// The customer's organization: 700 stores.
const NETWORK_COUNT: number = 700;
const SWITCHES_PER_NETWORK: number = 2;
const ACCESS_POINTS_PER_NETWORK: number = 7;
// Switches and access points: what Add devices offers, with the MX.
const ADDABLE_PER_NETWORK: number =
  SWITCHES_PER_NETWORK + ACCESS_POINTS_PER_NETWORK;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function storeName(index: number): string {
  return `Store ${pad(index, 4)}`;
}

function networkId(index: number): string {
  return `L_${pad(index, 6)}`;
}

/*
 * One Meraki network a store: an MX (which Meraki lists no LAN address
 * for), two switches, seven access points named the same in every store
 * ("AP-1" in all of them, as Meraki's names repeat), and a camera. Every
 * serial number, MAC and address is the organization's own.
 */
function buildOrganization(networkCount: number): FakeMerakiOrganization {
  const networks: Array<FakeMerakiNetwork> = [];
  const appliances: Array<FakeMerakiAppliance> = [];
  const devices: Array<FakeMerakiDevice> = [];

  for (let index: number = 1; index <= networkCount; index++) {
    const id: string = networkId(index);
    const octet2: number = Math.floor(index / 250);
    const octet3: number = index % 250;
    // A MAC of the store's own: its index in the two middle octets.
    const hex: (value: number) => string = (value: number): string => {
      return (value & 0xff).toString(16).padStart(2, "0");
    };
    const mac: (kind: number, n: number) => string = (
      kind: number,
      n: number,
    ): string => {
      return `88:15:${hex(kind)}:${hex(index >> 8)}:${hex(index)}:${hex(n)}`;
    };

    networks.push({
      id,
      name: storeName(index),
      applications: [],
      clients: [],
    });

    appliances.push({
      serial: `Q2MX-${pad(index, 4)}-0000`,
      name: `${storeName(index)} MX`,
      model: "MX68",
      mac: mac(0x0a, 0),
      networkId: id,
      uplinks: [],
    });

    for (let n: number = 1; n <= SWITCHES_PER_NETWORK; n++) {
      devices.push({
        serial: `Q2HP-${pad(index, 4)}-SW${pad(n, 2)}`,
        name: `SW-${n}`,
        model: "MS225-48LP",
        mac: mac(11, n),
        networkId: id,
        productType: "switch",
        lanIp: `10.${octet2}.${octet3}.${n + 1}`,
        address: `${index} Main Street, Springfield`,
      });
    }

    for (let n: number = 1; n <= ACCESS_POINTS_PER_NETWORK; n++) {
      devices.push({
        serial: `Q2KD-${pad(index, 4)}-AP${pad(n, 2)}`,
        name: `AP-${n}`,
        model: "MR46",
        mac: mac(22, n),
        networkId: id,
        productType: "wireless",
        lanIp: `10.${octet2}.${octet3}.${20 + n}`,
        address: `${index} Main Street, Springfield`,
      });
    }

    devices.push({
      serial: `Q2GV-${pad(index, 4)}-CAM1`,
      name: "Till camera",
      model: "MV12W",
      mac: mac(33, 1),
      networkId: id,
      productType: "camera",
      lanIp: `10.${octet2}.${octet3}.40`,
      address: `${index} Main Street, Springfield`,
    });
  }

  return {
    id: "549236",
    name: "Acme Retail",
    networks,
    appliances,
    devices,
  };
}

function propsWith(
  permissions: Array<Permission>,
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    tenantId: PROJECT,
    userId: PERSON,
    userTenantAccessPermission: { [PROJECT.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
    ...extra,
  };
}

/*
 * Who asks, as the worker reads them (WorkspaceActionAuthorization
 * .getProjectMemberProps): their membership's permissions. A server admin
 * is read the same way - as the member of the project they are - and, for
 * good measure, with their own server-admin props too.
 */
const ASKERS: Array<[string, () => DatabaseCommonInteractionProps]> = [
  [
    "a Project Owner",
    () => {
      return propsWith([Permission.ProjectOwner]);
    },
  ],
  [
    "a Project Admin",
    () => {
      return propsWith([Permission.ProjectAdmin]);
    },
  ],
  [
    "a server admin, as the Project Owner they are in the project",
    () => {
      return propsWith([Permission.ProjectOwner]);
    },
  ],
  [
    "a server admin, with their own server-admin props",
    () => {
      return propsWith([], { isMasterAdmin: true });
    },
  ],
  [
    "a custom role that may create network devices and sites",
    () => {
      return propsWith([
        Permission.CreateNetworkDevice,
        Permission.CreateNetworkSite,
      ]);
    },
  ],
];

interface World {
  clock: TestClock;
  api: FakeMerakiApi;
  organization: FakeMerakiOrganization;
  connection: NetworkControllerConnection;
  devices: InMemoryTable;
  sites: InMemoryTable;
  states: Array<NetworkControllerDeviceAddState>;
  readsQueued: Array<string>;
  audited: Array<{ table: string; userId: string | undefined }>;
}

let world: World;

function ask(
  request: NetworkControllerDeviceAddRequest = {
    productTypes: ["switch", "wireless", "appliance"],
    groupBySite: true,
  },
): void {
  world.connection.lastDeviceAdd = toNetworkControllerDeviceAddStateJson(
    buildQueuedNetworkControllerDeviceAddState({
      request,
      requestedByUserId: PERSON.toString(),
      now: world.clock.now(),
    }),
  );
}

function rowsOf(table: InMemoryTable): Array<StoredRow> {
  return table.rows;
}

function toSerialKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/*
 * The two lookups the database answers in SQL
 * (NetworkDeviceService.findControllerMatchCandidates and
 * findControllerIdentityHolders), answered from the device table the way
 * the SQL reads it: by serial number without case, MAC, address, name.
 */
function findCandidates(query: {
  lookup: ControllerInventoryLookup;
}): Array<ControllerInventoryCandidate> {
  const serials: Set<string> = new Set(query.lookup.serials);
  const macs: Set<string> = new Set(query.lookup.macs);
  const addresses: Set<string> = new Set(query.lookup.addresses);
  const names: Set<string> = new Set(query.lookup.names);

  return rowsOf(world.devices)
    .filter((row: StoredRow): boolean => {
      return (
        row["isArchived"] !== true &&
        (serials.has(toSerialKey(row["serialNumber"])) ||
          macs.has(String(row["macAddress"] || "").toLowerCase()) ||
          addresses.has(String(row["hostname"] || "")) ||
          names.has(
            String(row["name"] || "")
              .trim()
              .toLowerCase(),
          ))
      );
    })
    .map((row: StoredRow): ControllerInventoryCandidate => {
      return {
        id: String(row["_id"]),
        name: (row["name"] as string) || null,
        hostname: (row["hostname"] as string) || null,
        serialNumber: (row["serialNumber"] as string) || null,
        macAddress: (row["macAddress"] as string) || null,
        isArchived: Boolean(row["isArchived"]),
        discoveredDetails: row["discoveredDetails"],
        siteId: row["siteId"] ? String(row["siteId"]) : null,
      };
    });
}

function findHolders(query: {
  lookup: {
    serials: Array<string>;
    macs: Array<string>;
    addresses: Array<string>;
  };
}): Array<ControllerIdentityHolder> {
  const serials: Set<string> = new Set(query.lookup.serials);
  const macs: Set<string> = new Set(query.lookup.macs);
  const addresses: Set<string> = new Set(query.lookup.addresses);

  return rowsOf(world.devices)
    .filter((row: StoredRow): boolean => {
      return (
        serials.has(toSerialKey(row["serialNumber"])) ||
        macs.has(String(row["macAddress"] || "").toLowerCase()) ||
        addresses.has(String(row["hostname"] || ""))
      );
    })
    .map((row: StoredRow): ControllerIdentityHolder => {
      return {
        serialNumber: (row["serialNumber"] as string) || null,
        macAddress: (row["macAddress"] as string) || null,
        hostname: (row["hostname"] as string) || null,
        isArchived: Boolean(row["isArchived"]),
      };
    });
}

function dependencies(
  readPersonProps: () => DatabaseCommonInteractionProps,
  overrides: Partial<NetworkControllerDeviceAddDependencies> = {},
): NetworkControllerDeviceAddDependencies {
  return {
    skipLock: true,
    now: world.clock.now,
    sleep: world.clock.sleep,
    transport: world.api.transport,
    readConnection: async () => {
      return world.connection;
    },
    writeState: async (data: { state: NetworkControllerDeviceAddState }) => {
      const stored: NetworkControllerDeviceAddState =
        readNetworkControllerDeviceAddState(
          JSON.parse(
            JSON.stringify(toNetworkControllerDeviceAddStateJson(data.state)),
          ),
        )!;
      world.states.push(stored);
      world.connection.lastDeviceAdd =
        toNetworkControllerDeviceAddStateJson(stored);
    },
    readPersonProps: async () => {
      return readPersonProps();
    },
    findCandidates: async (query: { lookup: ControllerInventoryLookup }) => {
      return findCandidates(query);
    },
    findHolders: async (query: {
      lookup: {
        serials: Array<string>;
        macs: Array<string>;
        addresses: Array<string>;
      };
    }) => {
      return findHolders(query);
    },
    enqueueRead: async (id: ObjectID) => {
      world.readsQueued.push(id.toString());
    },
    ...overrides,
  };
}

async function run(
  readPersonProps: () => DatabaseCommonInteractionProps,
  overrides: Partial<NetworkControllerDeviceAddDependencies> = {},
): Promise<NetworkControllerDeviceAddOutcome> {
  return await NetworkControllerDeviceAddRunner.run(
    CONNECTION,
    dependencies(readPersonProps, overrides),
  );
}

function lastState(): NetworkControllerDeviceAddState {
  expect(world.states.length).toBeGreaterThan(0);
  return world.states[world.states.length - 1]!;
}

function setUpWorld(networkCount: number): void {
  const clock: TestClock = createTestClock(START);
  const organization: FakeMerakiOrganization = buildOrganization(networkCount);

  stubProjectDirectory({});
  // The site hierarchy's lock, as Valkey holds it.
  new InMemoryLocks().install();

  const devices: InMemoryTable = useInMemoryTable(NetworkDeviceService, []);
  const sites: InMemoryTable = useInMemoryTable(NetworkSiteService, []);
  useInMemoryHookFreeWrites(NetworkSiteService, sites);
  useInMemoryTable(
    NetworkDeviceRoleService,
    Object.entries(ROLE_IDS).map(([key, id]: [string, string]): StoredRow => {
      return { _id: id, projectId: PROJECT.toString(), key, name: key };
    }),
  );

  // What else could name a site: none of it here.
  for (const service of [
    NetworkEndpointService,
    NetworkSiteLinkService,
    NetworkSiteAssignmentRuleService,
    NetworkDeviceNamingRuleService,
    ScheduledMaintenanceService,
  ]) {
    useInMemoryTable(service as never, []);
  }

  jest
    .spyOn(ProbeService, "isProbeAttachableToProject")
    .mockResolvedValue(true);

  // The rules a new device starts, which reach other tables, run apart.
  jest
    .spyOn(
      NetworkDeviceService as unknown as {
        onCreateSuccess: (onCreate: unknown, created: unknown) => unknown;
      },
      "onCreateSuccess",
    )
    .mockImplementation(async (_onCreate: unknown, created: unknown) => {
      return created;
    });

  const audited: Array<{ table: string; userId: string | undefined }> = [];

  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockImplementation(
      async (data: {
        model: { tableName?: string | undefined };
        props: DatabaseCommonInteractionProps;
      }): Promise<void> => {
        audited.push({
          table: data.model.tableName || "",
          userId: data.props.userId?.toString(),
        });
      },
    );

  for (const silenced of ["debug", "info", "warn"] as const) {
    jest.spyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  const connection: NetworkControllerConnection =
    new NetworkControllerConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.name = "Acme Retail";
  connection.provider = NetworkControllerProvider.Meraki;
  connection.config = {
    region: "global",
    organizationId: "549236",
    organizationName: "Acme Retail",
    readIntervalInMinutes: 5,
  };
  connection.secrets = JSON.stringify({ apiKey: FAKE_API_KEY });
  connection.isEnabled = true;

  world = {
    clock,
    organization,
    api: createFakeMerakiApi({ organizations: [organization], now: clock.now }),
    connection,
    devices,
    sites,
    states: [],
    readsQueued: [],
    audited,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

function deviceBySerial(serial: string): StoredRow | undefined {
  return rowsOf(world.devices).find((row: StoredRow): boolean => {
    return row["serialNumber"] === serial;
  });
}

function siteNamed(name: string): StoredRow | undefined {
  return rowsOf(world.sites).find((row: StoredRow): boolean => {
    return row["name"] === name;
  });
}

// The stores of the suites that ask who may add, and what is left out.
const SMALL_NETWORK_COUNT: number = 60;

describe("who asks, through the real services", () => {
  beforeEach(() => {
    setUpWorld(SMALL_NETWORK_COUNT);
  });

  test.each(ASKERS)(
    "%s: devices are added with their serial numbers, as the person who asked, in a site for each network",
    async (
      _asker: string,
      readPersonProps: () => DatabaseCommonInteractionProps,
    ) => {
      ask();

      const outcome: NetworkControllerDeviceAddOutcome =
        await run(readPersonProps);

      const addable: number = SMALL_NETWORK_COUNT * ADDABLE_PER_NETWORK;
      const added: number = Math.min(
        addable,
        MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
      );

      expect(outcome.status).toBe(NetworkControllerDeviceAddStatus.Done);
      expect(lastState()).toMatchObject({
        status: NetworkControllerDeviceAddStatus.Done,
        toAddCount: added,
        addedCount: added,
        failedCount: 0,
        failureReasons: [],
        // Every MX: Meraki lists no LAN address for it.
        withoutAddressCount: SMALL_NETWORK_COUNT,
        takenCount: 0,
        archivedCount: 0,
        remainingCount: addable - added,
      });
      expect(world.devices.rows).toHaveLength(added);

      // Every device holds what Meraki says it is, the serial number first.
      for (const row of world.devices.rows) {
        expect(row["serialNumber"]).toMatch(/^Q2(HP|KD)-\d{4}-(SW|AP)\d{2}$/);
        expect(row["createdByUserId"]?.toString()).toBe(PERSON.toString());
      }

      const meraki: FakeMerakiDevice = world.organization.devices!.find(
        (device: FakeMerakiDevice): boolean => {
          return device.serial === "Q2HP-0001-SW01";
        },
      )!;
      const core: StoredRow = deviceBySerial("Q2HP-0001-SW01")!;

      expect(core).toBeDefined();
      expect(core["hostname"]).toBe(meraki.lanIp);
      expect(core["macAddress"]).toBe(meraki.mac);
      expect(String(core["networkDeviceRoleId"])).toBe(ROLE_IDS["switch"]);
      expect(core["manufacturer"]).toBe("Cisco Meraki");
      expect(
        readNetworkDeviceDiscoveredDetails(core["discoveredDetails"]).controller
          ?.values.serialNumber,
      ).toBe("Q2HP-0001-SW01");

      // In the site named after its network, at Meraki's street address.
      const store: StoredRow = siteNamed(storeName(1))!;
      expect(store).toBeDefined();
      expect(store["address"]).toBe("1 Main Street, Springfield");
      expect(String(core["siteId"])).toBe(String(store["_id"]));

      // An access point named as in every store, made unique by its store.
      expect(deviceBySerial("Q2KD-0002-AP01")?.["name"]).toBe(
        "AP-1 (Store 0002)",
      );
      expect(
        String(deviceBySerial("Q2KD-0002-AP01")?.["networkDeviceRoleId"]),
      ).toBe(ROLE_IDS["wirelessAccessPoint"]);

      // A site for every network a device went into, and no other.
      const siteIdsInUse: Set<string> = new Set<string>(
        world.devices.rows.map((row: StoredRow): string => {
          return String(row["siteId"]);
        }),
      );
      expect(world.sites.rows).toHaveLength(siteIdsInUse.size);
      expect(lastState().createdSiteCount).toBe(siteIdsInUse.size);
      for (const site of world.sites.rows) {
        expect(siteIdsInUse.has(String(site["_id"]))).toBe(true);
      }

      // The audit log says who asked, for every device and site.
      const devicesAudited: Array<{ userId: string | undefined }> =
        world.audited.filter((entry: { table: string }) => {
          return entry.table === "NetworkDevice";
        });
      expect(devicesAudited).toHaveLength(added);
      expect(
        world.audited.every((entry: { userId: string | undefined }) => {
          return entry.userId === PERSON.toString();
        }),
      ).toBe(true);

      expect(world.readsQueued).toEqual([CONNECTION.toString()]);
    },
  );
});

describe("#10188's organization - 700 networks, 7,700 devices - through the real services", () => {
  beforeEach(() => {
    setUpWorld(NETWORK_COUNT);
  });

  test("asked again and again: 5,000, then the rest past the limit, then nothing twice - every device found by its serial number, and no site empty", async () => {
    const owner: () => DatabaseCommonInteractionProps = () => {
      return propsWith([Permission.ProjectOwner]);
    };
    const addable: number = NETWORK_COUNT * ADDABLE_PER_NETWORK;

    ask();
    await run(owner);

    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      toAddCount: MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
      addedCount: MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
      failedCount: 0,
      failureReasons: [],
      withoutAddressCount: NETWORK_COUNT,
      remainingCount: addable - MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
    });
    expect(world.devices.rows).toHaveLength(
      MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
    );
    expect(
      world.devices.rows.every((row: StoredRow): boolean => {
        return (
          typeof row["serialNumber"] === "string" &&
          String(row["createdByUserId"]) === PERSON.toString()
        );
      }),
    ).toBe(true);

    // A site for each store a device went into, and none empty.
    const sitesAfterFirst: number = world.sites.rows.length;
    const usedAfterFirst: Set<string> = new Set<string>(
      world.devices.rows.map((row: StoredRow): string => {
        return String(row["siteId"]);
      }),
    );
    expect(sitesAfterFirst).toBe(usedAfterFirst.size);
    expect(lastState().createdSiteCount).toBe(sitesAfterFirst);

    // The rest.
    world.clock.advance(60 * 60 * 1000);
    ask();
    await run(owner);

    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      toAddCount: addable - MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
      addedCount: addable - MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
      failedCount: 0,
      remainingCount: 0,
    });
    expect(world.devices.rows).toHaveLength(addable);
    // A store split across the two asks keeps the one site it got first.
    expect(world.sites.rows).toHaveLength(NETWORK_COUNT);
    expect(world.sites.rows.length).toBeGreaterThanOrEqual(sitesAfterFirst);

    // Every serial number once.
    const serials: Set<string> = new Set<string>(
      world.devices.rows.map((row: StoredRow): string => {
        return String(row["serialNumber"]);
      }),
    );
    expect(serials.size).toBe(addable);

    // Nothing left: nothing added, no site, and the row says so.
    world.clock.advance(60 * 60 * 1000);
    ask();
    await run(owner);

    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      toAddCount: 0,
      addedCount: 0,
      failedCount: 0,
      createdSiteCount: 0,
      remainingCount: 0,
      withoutAddressCount: NETWORK_COUNT,
    });
    expect(world.devices.rows).toHaveLength(addable);
    expect(world.sites.rows).toHaveLength(NETWORK_COUNT);
  });
});

describe("an ask that cannot add, through the real services", () => {
  beforeEach(() => {
    setUpWorld(SMALL_NETWORK_COUNT);
  });

  test("a role that may not create network devices: nothing is read from Meraki, no device, no site, and the row says why", async () => {
    ask();

    const outcome: NetworkControllerDeviceAddOutcome = await run(() => {
      return propsWith([Permission.ReadNetworkDevice, Permission.Viewer]);
    });

    expect(outcome.status).toBe(NetworkControllerDeviceAddStatus.Failed);
    expect(lastState().message).toBe(DEVICE_ADD_MAY_NOT_CREATE_DEVICES);
    expect(world.api.requests).toEqual([]);
    expect(world.devices.rows).toEqual([]);
    expect(world.sites.rows).toEqual([]);
  });

  test("a role that may create devices but not sites, into sites: refused up front, with no site added", async () => {
    ask();

    await run(() => {
      return propsWith([Permission.CreateNetworkDevice]);
    });

    expect(lastState().status).toBe(NetworkControllerDeviceAddStatus.Failed);
    expect(lastState().message).toBe(DEVICE_ADD_MAY_NOT_CREATE_SITES);
    expect(world.devices.rows).toEqual([]);
    expect(world.sites.rows).toEqual([]);
  });

  test("the same role without sites: every device is added, with its serial number, and no site", async () => {
    ask({ productTypes: ["switch", "wireless"], groupBySite: false });

    await run(() => {
      return propsWith([Permission.CreateNetworkDevice]);
    });

    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      addedCount: SMALL_NETWORK_COUNT * ADDABLE_PER_NETWORK,
      createdSiteCount: 0,
    });
    expect(world.sites.rows).toEqual([]);
    expect(
      world.devices.rows.every((row: StoredRow): boolean => {
        return Boolean(row["serialNumber"]) && !row["siteId"];
      }),
    ).toBe(true);
  });

  test("16.0.0's refusal, every device refused for its serial number: no site is left behind, and the row says it once, with the count", async () => {
    ask();

    // Every create refused the way 16.0.0's was.
    const refusal: ColumnWriteRefusedException =
      new ColumnWriteRefusedException({
        requestType: DatabaseRequestType.Create,
        columnName: "serialNumber",
        modelName: "Network Device",
        permissions: [],
      });

    await run(
      () => {
        return propsWith([Permission.ProjectOwner]);
      },
      {
        createDevice: async () => {
          throw refusal;
        },
      },
    );

    const addable: number = SMALL_NETWORK_COUNT * ADDABLE_PER_NETWORK;

    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      addedCount: 0,
      failedCount: addable,
      createdSiteCount: 0,
    });
    expect(lastState().failureReasons).toEqual([
      {
        reason:
          "User is not allowed to create on serialNumber column of Network Device. No permission allows it: the column is set by the server, not by a request.",
        count: addable,
        // By network, then name: Store 0001's access points first.
        names: ["AP-1", "AP-2", "AP-3"].slice(
          0,
          MAX_DEVICE_ADD_FAILURE_NAMES_KEPT,
        ),
      },
    ]);
    // Each site the ask added for them was taken away again.
    expect(world.sites.rows).toEqual([]);
    expect(world.sites.deletes.length).toBeGreaterThan(0);
    expect(world.devices.rows).toEqual([]);
    // Nothing was added: no read is queued for it.
    expect(world.readsQueued).toEqual([]);
  });

  test("a network whose devices are all refused leaves no site; the others keep theirs", async () => {
    ask({ productTypes: ["switch", "wireless"], groupBySite: true });

    const refusedStores: Set<string> = new Set<string>([
      storeName(3),
      storeName(17),
      storeName(42),
    ]);

    await run(
      () => {
        return propsWith([Permission.ProjectAdmin]);
      },
      {
        createDevice: async (data: {
          device: NetworkDevice;
          props: DatabaseCommonInteractionProps;
        }) => {
          const site: StoredRow | undefined = world.sites.rows.find(
            (row: StoredRow): boolean => {
              return String(row["_id"]) === data.device.siteId?.toString();
            },
          );

          if (site && refusedStores.has(String(site["name"]))) {
            throw new BadDataException(
              "Probe not found or it does not belong to this project.",
            );
          }

          await NetworkDeviceService.create({
            data: data.device,
            props: data.props,
          });
        },
      },
    );

    const refused: number = refusedStores.size * ADDABLE_PER_NETWORK;

    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      addedCount: SMALL_NETWORK_COUNT * ADDABLE_PER_NETWORK - refused,
      failedCount: refused,
      createdSiteCount: SMALL_NETWORK_COUNT - refusedStores.size,
      failureReasons: [
        {
          reason: "Probe not found or it does not belong to this project.",
          count: refused,
        },
      ],
    });

    for (const store of refusedStores) {
      expect(siteNamed(store)).toBeUndefined();
    }

    expect(world.sites.rows).toHaveLength(
      SMALL_NETWORK_COUNT - refusedStores.size,
    );
    expect(siteNamed(storeName(4))).toBeDefined();
  });

  test("a site something went into meanwhile is kept, though the ask's own devices could not be added", async () => {
    ask({ productTypes: ["switch"], groupBySite: true });

    await run(
      () => {
        return propsWith([Permission.ProjectOwner]);
      },
      {
        createDevice: async (data: {
          device: NetworkDevice;
          props: DatabaseCommonInteractionProps;
        }) => {
          // Someone else puts a device of their own in the new site first.
          if (
            !world.devices.rows.some((row: StoredRow): boolean => {
              return String(row["siteId"]) === data.device.siteId?.toString();
            })
          ) {
            const own: NetworkDevice = new NetworkDevice();
            own.projectId = PROJECT;
            own.name = `Hand-added ${data.device.siteId?.toString()}`;
            own.hostname = `192.0.2.${world.devices.rows.length + 1}`;
            own.siteId = data.device.siteId!;
            await NetworkDeviceService.create({
              data: own,
              props: { isRoot: true, tenantId: PROJECT },
            });
          }

          throw new BadDataException("Something about this switch.");
        },
      },
    );

    expect(lastState()).toMatchObject({
      addedCount: 0,
      failedCount: SMALL_NETWORK_COUNT * SWITCHES_PER_NETWORK,
      // Kept: each holds a device now.
      createdSiteCount: SMALL_NETWORK_COUNT,
    });
    expect(world.sites.rows).toHaveLength(SMALL_NETWORK_COUNT);
    expect(world.sites.deletes).toEqual([]);
  });

  test("the report: what was added, what was left out and why - no address, taken, archived - and why the rest failed", async () => {
    // Already here, under other names: a switch by its serial, an AP by its MAC.
    const taken: StoredRow = {
      _id: "10188000-0000-4000-8000-0000000000f1",
      projectId: PROJECT.toString(),
      name: "Old core",
      hostname: "10.0.5.2",
      macAddress: "aa:bb:cc:dd:ee:01",
      // Another box: its serial says so, at an address Meraki gives a switch.
      serialNumber: "FOC1932X0K1",
    };
    const archived: StoredRow = {
      _id: "10188000-0000-4000-8000-0000000000f2",
      projectId: PROJECT.toString(),
      name: "Retired AP",
      hostname: "192.0.2.200",
      serialNumber: "Q2KD-0006-AP01",
      isArchived: true,
    };
    world.devices.rows.push(taken, archived);

    ask({
      productTypes: ["switch", "wireless", "appliance"],
      groupBySite: true,
    });

    await run(
      () => {
        return propsWith([Permission.ProjectOwner]);
      },
      {
        createDevice: async (data: {
          device: NetworkDevice;
          props: DatabaseCommonInteractionProps;
        }) => {
          if (data.device.serialNumber === "Q2HP-0007-SW01") {
            throw new BadDataException("A reason of its own.");
          }

          await NetworkDeviceService.create({
            data: data.device,
            props: data.props,
          });
        },
      },
    );

    const state: NetworkControllerDeviceAddState = lastState();

    expect(state).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      withoutAddressCount: SMALL_NETWORK_COUNT,
      // Store 0005's first switch: its address is the old core's.
      takenCount: 1,
      archivedCount: 1,
      failedCount: 1,
      failureReasons: [
        {
          reason: "A reason of its own.",
          count: 1,
          names: ["SW-1 (Store 0007)"],
        },
      ],
    });
    expect(state.addedCount).toBe(
      SMALL_NETWORK_COUNT * ADDABLE_PER_NETWORK - 3,
    );
    expect(state.toAddCount).toBe(state.addedCount + state.failedCount);
  });
});

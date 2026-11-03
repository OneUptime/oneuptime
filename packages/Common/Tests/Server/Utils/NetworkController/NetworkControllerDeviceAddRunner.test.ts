import NetworkControllerDeviceAddRunner, {
  DEVICE_ADD_CONNECTION_GONE,
  DEVICE_ADD_CONNECTION_OFF,
  DEVICE_ADD_FLUSH_INTERVAL_MS,
  DEVICE_ADD_MAY_NOT_CREATE_DEVICES,
  DEVICE_ADD_MAY_NOT_CREATE_SITES,
  DEVICE_ADD_NAME_TAKEN_REASON,
  DEVICE_ADD_PERMISSION_REFRESH_MS,
  DEVICE_ADD_UNDER_WAY,
  NETWORK_CONTROLLER_DEVICE_ADD_JOB,
  NetworkControllerDeviceAddDependencies,
  NetworkControllerDeviceAddOutcome,
} from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceAddRunner";
import { ControllerIdentityHolder } from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceAdd";
import { ControllerInventoryCandidate } from "../../../../Server/Utils/NetworkController/NetworkControllerInventory";
import Queue from "../../../../Server/Infrastructure/Queue";
import NetworkControllerConnectionService from "../../../../Server/Services/NetworkControllerConnectionService";
import NetworkControllerConnection from "../../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import {
  NetworkControllerDeviceAddRequest,
  NetworkControllerDeviceAddState,
  NetworkControllerDeviceAddStatus,
  NETWORK_CONTROLLER_DEVICE_ADD_STALE_MS,
  buildQueuedNetworkControllerDeviceAddState,
  readNetworkControllerDeviceAddState,
  toNetworkControllerDeviceAddStateJson,
} from "../../../../Types/NetworkController/NetworkControllerDeviceAdd";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceControllerReading,
  readNetworkDeviceDiscoveredDetails,
} from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  FAKE_API_KEY,
  FakeMerakiApi,
  FakeMerakiDevice,
  FakeMerakiOrganization,
  TestClock,
  createFakeMerakiApi,
  createTestClock,
  merakiError,
} from "./FakeMerakiApi";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Add devices on the server (NetworkControllerDeviceAddRunner), against the
 * fake Meraki dashboard API, with the database played by arrays: the ask is
 * recorded and queued once, refused while another runs; the worker lists
 * the organization again, adds the devices that are no device here - as
 * the person who asked, in their sites, under names nobody has, with their
 * role, probe and Meraki's reading - writes how far it got as it goes, and
 * says what it could not do and why; a refusal of the person, a turned-off
 * connection or a key Meraki refuses fails the ask as a whole.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PERSON: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PROBE: string = "44444444-4444-4444-8444-444444444444";
const EXISTING_SITE: string = "55555555-5555-4555-8555-555555555555";
const SWITCH_ROLE: string = "66666666-6666-4666-8666-666666666661";
const AP_ROLE: string = "66666666-6666-4666-8666-666666666662";
const START: Date = new Date("2026-11-03T10:00:00.000Z");

const ADDER: Array<Permission> = [
  Permission.CreateNetworkDevice,
  Permission.CreateNetworkSite,
];

function propsWith(
  permissions: Array<Permission>,
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
  };
}

function device(
  overrides: Partial<FakeMerakiDevice> & { serial: string },
): FakeMerakiDevice {
  return {
    name: `Device ${overrides.serial}`,
    model: "MS225-48LP",
    mac: "88:15:44:aa:00:01",
    networkId: "L_0660",
    productType: "switch",
    lanIp: "10.66.0.2",
    address: "1 Main Street, Springfield",
    ...overrides,
  };
}

const SWITCH: FakeMerakiDevice = device({
  serial: "Q2HP-SWCH-0001",
  name: "Core",
});
const ACCESS_POINT: FakeMerakiDevice = device({
  serial: "Q2KD-WLAN-0001",
  name: "Lobby",
  model: "MR46",
  mac: "e0:55:3d:aa:00:01",
  lanIp: "10.66.0.20",
  productType: "wireless",
});
const CAMERA: FakeMerakiDevice = device({
  serial: "Q2GV-CAMR-0001",
  name: "Till camera",
  model: "MV12W",
  mac: "34:56:fe:00:00:01",
  lanIp: "10.66.0.40",
  productType: "camera",
});
const OTHER_STORE_AP: FakeMerakiDevice = device({
  serial: "Q2KD-WLAN-0101",
  name: "Lobby",
  model: "MR46",
  mac: "e0:55:3d:aa:01:01",
  lanIp: "10.101.0.20",
  productType: "wireless",
  networkId: "L_0101",
  address: "101 High Street",
});

function organization(
  devices: Array<FakeMerakiDevice>,
): FakeMerakiOrganization {
  return {
    id: "549236",
    name: "Acme Retail",
    networks: [
      { id: "L_0660", name: "Store 0660", applications: [], clients: [] },
      { id: "L_0101", name: "Store 0101", applications: [], clients: [] },
    ],
    appliances: [
      {
        serial: "Q2XX-AAAA-0000",
        name: "Store 0660 MX",
        model: "MX68",
        mac: "00:18:0a:00:00:01",
        networkId: "L_0660",
        uplinks: [],
      },
    ],
    devices,
  };
}

let clock: TestClock;
let api: FakeMerakiApi;
let connection: NetworkControllerConnection;
let states: Array<NetworkControllerDeviceAddState>;
let created: Array<NetworkDevice>;
let createdBy: Array<DatabaseCommonInteractionProps>;
let sitesCreated: Array<{ name: string; address: string }>;
let readsQueued: Array<string>;
let candidates: Array<ControllerInventoryCandidate>;
let holders: Array<ControllerIdentityHolder>;
let takenNames: Set<string>;
let existingSites: Array<{ id: string; name: string }>;
let personProps: Array<() => DatabaseCommonInteractionProps>;

function ask(
  request: NetworkControllerDeviceAddRequest = {
    productTypes: ["switch", "wireless"],
    groupBySite: true,
    probeId: PROBE,
  },
  at: Date = START,
): void {
  connection.lastDeviceAdd = toNetworkControllerDeviceAddStateJson(
    buildQueuedNetworkControllerDeviceAddState({
      request,
      requestedByUserId: PERSON.toString(),
      now: at,
    }),
  );
}

function dependencies(
  overrides: Partial<NetworkControllerDeviceAddDependencies> = {},
): NetworkControllerDeviceAddDependencies {
  return {
    skipLock: true,
    now: clock.now,
    sleep: clock.sleep,
    transport: api.transport,
    readConnection: async () => {
      return connection;
    },
    writeState: async (data: {
      connectionId: ObjectID;
      state: NetworkControllerDeviceAddState;
    }) => {
      // Stored as JSON, as Postgres would.
      states.push(
        readNetworkControllerDeviceAddState(
          JSON.parse(
            JSON.stringify(toNetworkControllerDeviceAddStateJson(data.state)),
          ),
        )!,
      );
    },
    readPersonProps: async () => {
      const next: (() => DatabaseCommonInteractionProps) | undefined =
        personProps.length > 1 ? personProps.shift() : personProps[0];

      return next!();
    },
    findCandidates: async () => {
      return candidates;
    },
    findHolders: async () => {
      return holders;
    },
    findTakenNames: async () => {
      return takenNames;
    },
    findSites: async (data: { names: Array<string> }) => {
      return existingSites.filter((site: { id: string; name: string }) => {
        return data.names.some((name: string): boolean => {
          return name.toLowerCase() === site.name.toLowerCase();
        });
      });
    },
    createSite: async (data: { name: string; address: string }) => {
      sitesCreated.push({ name: data.name, address: data.address });
      return `77777777-7777-4777-8777-${String(sitesCreated.length).padStart(12, "0")}`;
    },
    findRoleIds: async () => {
      return new Map<string, string>([
        ["switch", SWITCH_ROLE],
        ["wirelessAccessPoint", AP_ROLE],
      ]);
    },
    createDevice: async (data: {
      device: NetworkDevice;
      props: DatabaseCommonInteractionProps;
    }) => {
      created.push(data.device);
      createdBy.push(data.props);
    },
    enqueueRead: async (id: ObjectID) => {
      readsQueued.push(id.toString());
    },
    ...overrides,
  };
}

async function run(
  overrides: Partial<NetworkControllerDeviceAddDependencies> = {},
): Promise<NetworkControllerDeviceAddOutcome> {
  return await NetworkControllerDeviceAddRunner.run(
    CONNECTION,
    dependencies(overrides),
  );
}

function lastState(): NetworkControllerDeviceAddState {
  expect(states.length).toBeGreaterThan(0);
  return states[states.length - 1]!;
}

function createdNames(): Array<string> {
  return created.map((model: NetworkDevice): string => {
    return model.name || "";
  });
}

beforeEach(() => {
  clock = createTestClock(START);
  api = createFakeMerakiApi({
    organizations: [
      organization([SWITCH, ACCESS_POINT, CAMERA, OTHER_STORE_AP]),
    ],
    now: clock.now,
  });
  states = [];
  created = [];
  createdBy = [];
  sitesCreated = [];
  readsQueued = [];
  candidates = [];
  holders = [];
  takenNames = new Set<string>();
  existingSites = [{ id: EXISTING_SITE, name: "store 0660" }];
  personProps = [
    () => {
      return propsWith(ADDER);
    },
  ];

  connection = new NetworkControllerConnection();
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
  ask();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the worker does not answer", () => {
  test("a connection nobody asked, one whose ask is answered, and one that is gone are skipped without a trace", async () => {
    connection.lastDeviceAdd = undefined as unknown as JSONObject;
    expect((await run()).status).toBe("skipped");

    ask();
    connection.lastDeviceAdd = {
      ...connection.lastDeviceAdd!,
      status: NetworkControllerDeviceAddStatus.Done,
    };
    expect((await run()).status).toBe("skipped");

    expect(
      (
        await run({
          readConnection: async () => {
            return null;
          },
        })
      ).status,
    ).toBe("skipped");

    expect(states).toEqual([]);
    expect(api.requests).toEqual([]);
  });
});

describe("an ask that works", () => {
  test("adds every device of the kinds asked for that is no device here, as the person who asked", async () => {
    const outcome: NetworkControllerDeviceAddOutcome = await run();

    expect(outcome.status).toBe(NetworkControllerDeviceAddStatus.Done);
    // By network, then name: Store 0101's lobby first. The camera was not asked for.
    expect(createdNames()).toEqual(["Lobby", "Core", "Lobby (Store 0660)"]);
    expect(
      createdBy.every((props: DatabaseCommonInteractionProps): boolean => {
        return props.userId?.toString() === PERSON.toString();
      }),
    ).toBe(true);

    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      toAddCount: 3,
      addedCount: 3,
      failedCount: 0,
      createdSiteCount: 1,
      remainingCount: 0,
      failures: [],
    });
    // Finished when the clock says - the client paced its calls in between.
    expect(lastState().finishedAt).toBe(clock.now().toISOString());
    expect(lastState().updatedAt).toBe(lastState().finishedAt);
  });

  test("each device is what Meraki says it is: its address, serial number, MAC, role, site, probe and reading", async () => {
    await run();

    const core: NetworkDevice | undefined = created.find(
      (model: NetworkDevice): boolean => {
        return model.serialNumber === SWITCH.serial;
      },
    );

    expect(core?.projectId?.toString()).toBe(PROJECT.toString());
    expect(core?.hostname).toBe("10.66.0.2");
    expect(core?.macAddress).toBe("88:15:44:aa:00:01");
    expect(core?.networkDeviceRoleId?.toString()).toBe(SWITCH_ROLE);
    // The project's own "store 0660" site, found without case.
    expect(core?.siteId?.toString()).toBe(EXISTING_SITE);
    expect(core?.probeId?.toString()).toBe(PROBE);

    const reading: NetworkDeviceControllerReading | undefined =
      readNetworkDeviceDiscoveredDetails(core?.discoveredDetails).controller;

    expect(reading?.readBy.id).toBe(CONNECTION.toString());
    expect(reading?.readBy.name).toBe("Acme Retail");
    expect(reading?.values.networkName).toBe("Store 0660");
    expect(reading?.values.serialNumber).toBe(SWITCH.serial);
  });

  test("a network the project has no site for gets one, named after it, at Meraki's street address", async () => {
    await run();

    expect(sitesCreated).toEqual([
      { name: "Store 0101", address: "101 High Street" },
    ]);

    const otherStore: NetworkDevice | undefined = created.find(
      (model: NetworkDevice): boolean => {
        return model.serialNumber === OTHER_STORE_AP.serial;
      },
    );

    expect(otherStore?.siteId?.toString()).toBe(
      "77777777-7777-4777-8777-000000000001",
    );
    expect(otherStore?.networkDeviceRoleId?.toString()).toBe(AP_ROLE);
  });

  test("without sites: no site is looked up or added, and no device is put in one", async () => {
    ask({ productTypes: ["switch", "wireless"], groupBySite: false });

    await run({
      findSites: async () => {
        throw new Error("Sites were looked up.");
      },
    });

    expect(sitesCreated).toEqual([]);
    expect(
      created.every((model: NetworkDevice): boolean => {
        return model.siteId === undefined && model.probeId === undefined;
      }),
    ).toBe(true);
  });

  test("devices that are here already, archived or at a taken address are not added, and are counted", async () => {
    candidates = [
      {
        id: "40000000-0000-4000-8000-000000000001",
        serialNumber: SWITCH.serial,
      },
    ];
    holders = [
      { serialNumber: SWITCH.serial },
      { macAddress: ACCESS_POINT.mac, isArchived: true },
      { hostname: OTHER_STORE_AP.lanIp as string },
    ];

    await run();

    expect(created).toEqual([]);
    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      toAddCount: 0,
      addedCount: 0,
      archivedCount: 1,
      takenCount: 1,
      // The MX: Meraki lists no LAN address for it. Asked for here: appliances.
      withoutAddressCount: 0,
    });
    // Nothing was added, so no read is queued for it.
    expect(readsQueued).toEqual([]);
  });

  test("security appliances asked for are counted as having no address", async () => {
    ask({ productTypes: ["appliance"], groupBySite: true });

    await run();

    expect(created).toEqual([]);
    expect(lastState().withoutAddressCount).toBe(1);
  });

  test("a read of the connection is queued once devices were added: their clients and links go on the map", async () => {
    await run();

    expect(readsQueued).toEqual([CONNECTION.toString()]);
  });

  test("it lists the organization through the same calls as a read, and nothing else", async () => {
    await run();

    expect(
      api.requests.map((request: { url: URL }): string => {
        return request.url.pathname;
      }),
    ).toEqual([
      "/api/v1/organizations/549236",
      "/api/v1/organizations/549236/networks",
      "/api/v1/organizations/549236/devices",
    ]);
  });
});

describe("how far it got, as it goes", () => {
  test("adding at once, then what it found, then every couple of seconds, then done", async () => {
    await run({
      createDevice: async (data: { device: NetworkDevice }) => {
        created.push(data.device);
        clock.advance(DEVICE_ADD_FLUSH_INTERVAL_MS);
      },
    });

    expect(
      states.map((state: NetworkControllerDeviceAddState): string => {
        return `${state.status}:${state.toAddCount}:${state.addedCount}`;
      }),
    ).toEqual([
      "adding:0:0",
      "adding:3:0",
      "adding:3:1",
      "adding:3:2",
      "adding:3:3",
      "done:3:3",
    ]);
    expect(states[0]!.startedAt).toBe(START.toISOString());
  });
});

describe("what it cannot add, it says", () => {
  test("a device whose create is refused is listed with why, and the rest are still added", async () => {
    await run({
      createDevice: async (data: { device: NetworkDevice }) => {
        if (data.device.serialNumber === SWITCH.serial) {
          throw new BadDataException(
            "Probe not found or it does not belong to this project.",
          );
        }

        created.push(data.device);
      },
    });

    expect(createdNames()).toEqual(["Lobby", "Lobby (Store 0660)"]);
    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Done,
      addedCount: 2,
      failedCount: 1,
      failures: [
        {
          name: "Core",
          reason: "Probe not found or it does not belong to this project.",
        },
      ],
    });
  });

  test("a name another device took meanwhile is tried once more under the device's serial number", async () => {
    await run({
      createDevice: async (data: { device: NetworkDevice }) => {
        if (data.device.name === "Core") {
          throw new BadDataException(
            "Network Device with the same name already exists.",
          );
        }

        created.push(data.device);
      },
    });

    expect(createdNames()).toContain("Core (Q2HP-SWCH-0001)");
    expect(lastState().addedCount).toBe(3);
  });

  test("a name still taken under its serial number is a failure, said plainly", async () => {
    await run({
      createDevice: async (data: { device: NetworkDevice }) => {
        if (data.device.serialNumber === SWITCH.serial) {
          throw new BadDataException(
            "Network Device with the same name already exists.",
          );
        }

        created.push(data.device);
      },
    });

    expect(lastState().failures).toEqual([
      { name: "Core", reason: DEVICE_ADD_NAME_TAKEN_REASON },
    ]);
  });

  test("names other devices have are not used: the network, then the serial number, goes after them", async () => {
    takenNames = new Set<string>(["core", "lobby", "lobby (store 0660)"]);

    await run();

    expect(createdNames()).toEqual([
      "Lobby (Store 0101)",
      "Core (Store 0660)",
      "Lobby (Q2KD-WLAN-0001)",
    ]);
  });

  test("a site that cannot be added is looked up again; its devices are added without one when it is still not there", async () => {
    await run({
      createSite: async () => {
        throw new BadDataException(
          "Network Site with the same name already exists.",
        );
      },
    });

    const otherStore: NetworkDevice | undefined = created.find(
      (model: NetworkDevice): boolean => {
        return model.serialNumber === OTHER_STORE_AP.serial;
      },
    );

    expect(otherStore).toBeDefined();
    expect(otherStore?.siteId).toBeUndefined();
    expect(lastState().createdSiteCount).toBe(0);
    expect(lastState().status).toBe(NetworkControllerDeviceAddStatus.Done);
  });
});

describe("an ask that fails as a whole", () => {
  test("a person who may not create network devices: nothing is read from Meraki, and the ask says why", async () => {
    personProps = [
      () => {
        return propsWith([Permission.CreateNetworkSite]);
      },
    ];

    const outcome: NetworkControllerDeviceAddOutcome = await run();

    expect(outcome.status).toBe(NetworkControllerDeviceAddStatus.Failed);
    expect(lastState().message).toBe(DEVICE_ADD_MAY_NOT_CREATE_DEVICES);
    expect(api.requests).toEqual([]);
    expect(created).toEqual([]);
  });

  test("into sites, a person who may not create sites is refused too", async () => {
    personProps = [
      () => {
        return propsWith([Permission.CreateNetworkDevice]);
      },
    ];

    await run();

    expect(lastState().message).toBe(DEVICE_ADD_MAY_NOT_CREATE_SITES);
  });

  test("a person no longer in the project", async () => {
    personProps = [
      () => {
        throw new NotAuthorizedException(
          "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.",
        );
      },
    ];

    await run();

    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Failed,
      message:
        "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.",
    });
  });

  test("a right lost half way stops the adds half way, and what was added is kept", async () => {
    personProps = [
      () => {
        return propsWith(ADDER);
      },
      () => {
        return propsWith([]);
      },
    ];

    await run({
      createDevice: async (data: { device: NetworkDevice }) => {
        created.push(data.device);
        clock.advance(DEVICE_ADD_PERMISSION_REFRESH_MS);
      },
    });

    expect(created).toHaveLength(1);
    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Failed,
      addedCount: 1,
      message: DEVICE_ADD_MAY_NOT_CREATE_DEVICES,
    });
    // One was added: the read that places it is queued all the same.
    expect(readsQueued).toEqual([CONNECTION.toString()]);
  });

  test("a connection turned off since the ask", async () => {
    connection.isEnabled = false;

    await run();

    expect(lastState()).toMatchObject({
      status: NetworkControllerDeviceAddStatus.Failed,
      message: DEVICE_ADD_CONNECTION_OFF,
    });
    expect(api.requests).toEqual([]);
  });

  test("a key Meraki refuses: why, without the key", async () => {
    api = createFakeMerakiApi({
      organizations: [organization([SWITCH])],
      now: clock.now,
      scripted: {
        "/api/v1/organizations/549236": [
          merakiError(401, `Invalid API key ${FAKE_API_KEY}`),
        ],
      },
    });

    await run({ transport: api.transport });

    expect(lastState().status).toBe(NetworkControllerDeviceAddStatus.Failed);
    expect(lastState().message).toBeTruthy();
    expect(lastState().message).not.toContain(FAKE_API_KEY);
    expect(created).toEqual([]);
  });

  test("a recording that fails never escapes: the ask still runs", async () => {
    const outcome: NetworkControllerDeviceAddOutcome = await run({
      writeState: async () => {
        throw new Error("Postgres is not answering");
      },
    });

    expect(outcome.status).toBe(NetworkControllerDeviceAddStatus.Done);
    expect(created).toHaveLength(3);
  });
});

describe("ask: recorded and queued once", () => {
  let updates: Array<JSONObject>;
  let queued: Array<string>;

  beforeEach(() => {
    updates = [];
    queued = [];
    connection.lastDeviceAdd = undefined as unknown as JSONObject;

    jest
      .spyOn(NetworkControllerConnectionService, "findOneBy")
      .mockImplementation((async () => {
        return connection;
      }) as never);
    jest
      .spyOn(NetworkControllerConnectionService, "updateOneById")
      .mockImplementation((async (data: { data: JSONObject }) => {
        updates.push(data.data);
      }) as never);
  });

  async function askNow(
    at: Date = START,
  ): Promise<NetworkControllerDeviceAddState> {
    return await NetworkControllerDeviceAddRunner.ask({
      connectionId: CONNECTION,
      projectId: PROJECT,
      userId: PERSON,
      request: { productTypes: ["switch"], groupBySite: true },
      now: at,
      enqueue: async (id: ObjectID) => {
        queued.push(id.toString());
      },
    });
  }

  test("the ask is recorded on the connection, queued, and the job queued", async () => {
    const state: NetworkControllerDeviceAddState = await askNow();

    expect(state.status).toBe(NetworkControllerDeviceAddStatus.Queued);
    expect(state.requestedByUserId).toBe(PERSON.toString());
    expect(updates).toEqual([
      { lastDeviceAdd: toNetworkControllerDeviceAddStateJson(state) },
    ]);
    expect(queued).toEqual([CONNECTION.toString()]);
  });

  test("a second ask while one is under way is refused", async () => {
    ask(undefined, START);

    await expect(askNow(new Date(START.getTime() + 1000))).rejects.toThrow(
      DEVICE_ADD_UNDER_WAY,
    );
    expect(queued).toEqual([]);
  });

  test("an ask whose worker was lost is replaced", async () => {
    ask(undefined, START);
    connection.lastDeviceAdd = {
      ...connection.lastDeviceAdd!,
      status: NetworkControllerDeviceAddStatus.Adding,
    };

    await askNow(
      new Date(START.getTime() + NETWORK_CONTROLLER_DEVICE_ADD_STALE_MS + 1),
    );

    expect(queued).toEqual([CONNECTION.toString()]);
  });

  test("a connection that is off, or gone, is refused", async () => {
    connection.isEnabled = false;
    await expect(askNow()).rejects.toThrow(DEVICE_ADD_CONNECTION_OFF);

    jest
      .spyOn(NetworkControllerConnectionService, "findOneBy")
      .mockResolvedValue(null);
    await expect(askNow()).rejects.toThrow(DEVICE_ADD_CONNECTION_GONE);

    expect(updates).toEqual([]);
  });

  test("the job is queued with the connection's id only, one at a time", async () => {
    const addJob: jest.SpyInstance = jest
      .spyOn(Queue, "addJob")
      .mockResolvedValue(undefined as never);

    await NetworkControllerDeviceAddRunner.enqueue(CONNECTION);

    expect(addJob).toHaveBeenCalledTimes(1);
    const call: Array<unknown> = addJob.mock.calls[0]!;
    expect(call[2]).toBe(NETWORK_CONTROLLER_DEVICE_ADD_JOB);
    expect(call[3]).toEqual({ connectionId: CONNECTION.toString() });
    expect(call[4]).toMatchObject({
      attempts: 1,
      deduplication: {
        id: `network-controller-device-add-${CONNECTION.toString()}`,
      },
    });
  });
});

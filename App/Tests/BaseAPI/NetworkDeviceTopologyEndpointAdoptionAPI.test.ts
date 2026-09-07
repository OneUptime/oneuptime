import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkInterfaceService from "Common/Server/Services/NetworkInterfaceService";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import NetworkDeviceLinkService from "Common/Server/Services/NetworkDeviceLinkService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import NetworkDeviceLinkRuleService from "Common/Server/Services/NetworkDeviceLinkRuleService";
import NetworkTopologySuppressionService from "Common/Server/Services/NetworkTopologySuppressionService";
import NetworkDeviceRoleService from "Common/Server/Services/NetworkDeviceRoleService";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import NetworkTopologyUtil, {
  TopologyDeviceInput,
  TopologyEndpointInput,
} from "Common/Utils/Monitor/NetworkTopologyUtil";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkInterfaceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkEndpointService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkDeviceLinkService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkDeviceLinkRuleService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkTopologySuppressionService", () => {
  return {
    __esModule: true,
    default: { getSuppressedNodeKeys: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceRoleService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

/*
 * Importing the API module registers its route on the mocked router so the
 * handler can be invoked directly, with every service call observable.
 */
import NetworkDeviceTopologyAPI from "../../FeatureSet/BaseAPI/API/NetworkDeviceTopology";

new NetworkDeviceTopologyAPI().getRouter();

const projectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const deviceService: { findBy: jest.Mock } =
  NetworkDeviceService as unknown as { findBy: jest.Mock };
const interfaceService: { findBy: jest.Mock } =
  NetworkInterfaceService as unknown as { findBy: jest.Mock };
const endpointService: { findBy: jest.Mock } =
  NetworkEndpointService as unknown as { findBy: jest.Mock };
const deviceLinkService: { findBy: jest.Mock } =
  NetworkDeviceLinkService as unknown as { findBy: jest.Mock };
const monitorStatusService: { findBy: jest.Mock } =
  MonitorStatusService as unknown as { findBy: jest.Mock };
const linkRuleService: { findBy: jest.Mock } =
  NetworkDeviceLinkRuleService as unknown as { findBy: jest.Mock };
const suppressionService: { getSuppressedNodeKeys: jest.Mock } =
  NetworkTopologySuppressionService as unknown as {
    getSuppressedNodeKeys: jest.Mock;
  };
const deviceRoleService: { findBy: jest.Mock } =
  NetworkDeviceRoleService as unknown as { findBy: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const mockResponse: ExpressResponse = {} as ExpressResponse;

type CallTopologyFunction = (body: JSONObject) => Promise<NextFunction>;

const callTopology: CallTopologyFunction = async (
  body: JSONObject,
): Promise<NextFunction> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body: body } as unknown as ExpressRequest;
  await mockRouter
    .match("post", "/network-device/topology")
    .handlerFunction(req, mockResponse, next);
  return next;
};

function makeDevice(name: string): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(ObjectID.generate());
  device.name = name;
  return device;
}

function lastResponseBody(): JSONObject {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

/*
 * QueryHelper.any() compiles to a TypeORM Raw operator whose object-literal
 * parameters carry the id list; this digs the list back out so a test can
 * pin exactly which device ids the query was scoped to.
 */
function idsInAnyOperator(operator: unknown): Array<string> {
  const parameters: JSONObject = (operator as JSONObject)[
    "objectLiteralParameters"
  ] as JSONObject;
  return Object.values(parameters)[0] as Array<string>;
}

/*
 * --- Issue #3489: endpoints that ARE managed devices ---
 *
 * A ping-only register, handset or kiosk has no LLDP, so until now its cable
 * had to be drawn by hand — while the switch it hangs off had ALREADY
 * reported the port in its forwarding table, and the server had stored that
 * as a NetworkEndpoint row drawn as a second, anonymous node. The builder
 * now recognises such a row as the device itself. These tests exercise the
 * whole endpoint rather than the builder, because the parts that can break
 * without failing to compile live at this seam: the columns the two queries
 * ask for, the .toString() on the site ids the builder keys a Map on, and
 * the second endpoint lookup that only runs past the page cap.
 */

/*
 * Mirrors the handler's private MAX_TOPOLOGY_ENDPOINTS. Deliberately a
 * literal rather than an export: the value is the contract under test, and
 * the test should fail if the cap moves without this file being told.
 */
const ENDPOINT_PAGE_SIZE: number = 2000;

interface DeviceOverrides {
  hostname?: string | undefined;
  macAddress?: string | undefined;
  siteId?: ObjectID | undefined;
}

/*
 * A device row as the handler's select returns it. Guarded assignments,
 * because exactOptionalPropertyTypes forbids writing `undefined` into an
 * optional column and an absent column is the state under test for a device
 * nobody has filed in a site or given a MAC.
 */
function makeDeviceAt(name: string, overrides: DeviceOverrides): NetworkDevice {
  const device: NetworkDevice = makeDevice(name);
  if (overrides.hostname !== undefined) {
    device.hostname = overrides.hostname;
  }
  if (overrides.macAddress !== undefined) {
    device.macAddress = overrides.macAddress;
  }
  if (overrides.siteId !== undefined) {
    device.siteId = overrides.siteId;
  }
  return device;
}

interface EndpointOverrides {
  ipAddress?: string | undefined;
  siteId?: ObjectID | undefined;
  attachedInterfaceIndex?: number | undefined;
  attachedPortName?: string | undefined;
  vlanId?: number | undefined;
  lastSeenAt?: Date | undefined;
}

/*
 * One learned MAC on one switch port, as the walk stores it: the port it was
 * seen on, the VLAN, the address ARP bound it to (when a router's table had
 * one) and the site of the switch that learned it.
 */
function makeEndpoint(
  deviceId: ObjectID,
  macAddress: string,
  overrides: EndpointOverrides = {},
): NetworkEndpoint {
  const row: NetworkEndpoint = new NetworkEndpoint(ObjectID.generate());
  row.macAddress = macAddress;
  row.attachedNetworkDeviceId = deviceId;
  row.attachedInterfaceIndex =
    overrides.attachedInterfaceIndex !== undefined
      ? overrides.attachedInterfaceIndex
      : 12;
  row.attachedPortName =
    overrides.attachedPortName !== undefined
      ? overrides.attachedPortName
      : "Gi0/12";
  row.vlanId = overrides.vlanId !== undefined ? overrides.vlanId : 20;
  row.lastSeenAt =
    overrides.lastSeenAt !== undefined ? overrides.lastSeenAt : new Date();
  if (overrides.ipAddress !== undefined) {
    row.ipAddress = overrides.ipAddress;
  }
  if (overrides.siteId !== undefined) {
    row.siteId = overrides.siteId;
  }
  return row;
}

/*
 * A locally administered MAC per index (02:...), so a page of strangers can
 * never collide with the aa:bb:cc:dd:ee:01 the tests declare on a device.
 */
function strangerMac(index: number): string {
  const hex: (value: number) => string = (value: number): string => {
    return value.toString(16).padStart(2, "0");
  };
  return `02:00:00:${hex((index >> 16) & 0xff)}:${hex((index >> 8) & 0xff)}:${hex(index & 0xff)}`;
}

/** `count` MACs nobody manages, all learned on the one switch. */
function strangers(switchId: ObjectID, count: number): Array<NetworkEndpoint> {
  const rows: Array<NetworkEndpoint> = [];
  for (let index: number = 0; index < count; index++) {
    rows.push(makeEndpoint(switchId, strangerMac(index)));
  }
  return rows;
}

function endpointNodes(body: JSONObject): Array<JSONObject> {
  return (body["nodes"] as Array<JSONObject>).filter((node: JSONObject) => {
    return (node["id"] as string).startsWith("endpoint:");
  });
}

function nodeById(body: JSONObject, id: ObjectID): JSONObject | undefined {
  return (body["nodes"] as Array<JSONObject>).find((node: JSONObject) => {
    return node["id"] === id.toString();
  });
}

function edgesTouching(body: JSONObject, id: ObjectID): Array<JSONObject> {
  const nodeId: string = id.toString();
  return (body["edges"] as Array<JSONObject>).filter((edge: JSONObject) => {
    return edge["fromNodeId"] === nodeId || edge["toNodeId"] === nodeId;
  });
}

function endpointQueryAt(callIndex: number): JSONObject {
  return (endpointService.findBy.mock.calls[callIndex]![0] as JSONObject)[
    "query"
  ] as JSONObject;
}

function resetTopologyMocks(): void {
  jest.clearAllMocks();
  commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
    tenantId: projectId,
  } as never);
  deviceService.findBy.mockResolvedValue([] as never);
  interfaceService.findBy.mockResolvedValue([] as never);
  endpointService.findBy.mockResolvedValue([] as never);
  deviceLinkService.findBy.mockResolvedValue([] as never);
  monitorStatusService.findBy.mockResolvedValue([] as never);
  linkRuleService.findBy.mockResolvedValue([] as never);
  suppressionService.getSuppressedNodeKeys.mockResolvedValue(
    new Set<string>() as never,
  );
  deviceRoleService.findBy.mockResolvedValue([] as never);
}

describe("POST /network-device/topology — endpoints that are managed devices", () => {
  beforeEach(() => {
    resetTopologyMocks();
  });

  /*
   * Adoption is only as good as the columns it reads. An unselected
   * macAddress leaves every device without its strongest match key; an
   * unselected siteId on either side normalises to "no site", which turns
   * the by-address match project-wide — and every branch has a 10.0.0.5.
   * Neither omission fails to compile.
   */
  test("asks the device query for macAddress and siteId, and the endpoint query for siteId", async () => {
    deviceService.findBy.mockResolvedValue([makeDevice("store-sw1")] as never);

    await callTopology({});

    const deviceSelect: JSONObject = (
      deviceService.findBy.mock.calls[0]![0] as JSONObject
    )["select"] as JSONObject;
    expect(deviceSelect["macAddress"]).toBe(true);
    expect(deviceSelect["siteId"]).toBe(true);
    // The address the by-address match compares against.
    expect(deviceSelect["hostname"]).toBe(true);

    expect(endpointService.findBy).toHaveBeenCalledTimes(1);
    const endpointSelect: JSONObject = (
      endpointService.findBy.mock.calls[0]![0] as JSONObject
    )["select"] as JSONObject;
    expect(endpointSelect["siteId"]).toBe(true);
    expect(endpointSelect["macAddress"]).toBe(true);
    expect(endpointSelect["ipAddress"]).toBe(true);
    expect(endpointSelect["attachedNetworkDeviceId"]).toBe(true);
    expect(endpointSelect["attachedPortName"]).toBe(true);
  });

  /*
   * THE REPORTED SHAPE. A register with no SNMP, reachable at 10.0.0.5, and
   * the store switch whose forwarding table learned its MAC on Gi0/12 —
   * with the router's ARP table having bound that MAC to 10.0.0.5. Before
   * #3489 this drew an anonymous "endpoint" node on the switch and left the
   * register floating; now it draws the register's cable.
   */
  test("a ping-only device found by address in a switch's tables gets its cable, not a stranger node", async () => {
    const siteId: ObjectID = ObjectID.generate();
    const accessSwitch: NetworkDevice = makeDeviceAt("store-sw1", {
      siteId: siteId,
    });
    const register: NetworkDevice = makeDeviceAt("pos-register-1", {
      hostname: "10.0.0.5",
      siteId: siteId,
    });
    deviceService.findBy.mockResolvedValue([accessSwitch, register] as never);
    endpointService.findBy.mockResolvedValue([
      makeEndpoint(accessSwitch.id!, "d4:3d:7e:12:34:56", {
        ipAddress: "10.0.0.5",
        siteId: siteId,
        attachedInterfaceIndex: 12,
        attachedPortName: "Gi0/12",
        vlanId: 20,
      }),
    ] as never);

    const next: NextFunction = await callTopology({
      siteId: siteId.toString(),
    });
    expect(next).not.toHaveBeenCalled();

    const body: JSONObject = lastResponseBody();

    // The row became the register's cable...
    const edges: Array<JSONObject> = edgesTouching(body, register.id!);
    expect(edges.length).toBe(1);
    expect(edges[0]!["fromNodeId"]).toBe(accessSwitch.id!.toString());
    expect(edges[0]!["toNodeId"]).toBe(register.id!.toString());
    expect(edges[0]!["protocols"]).toEqual(["fdb"]);
    expect(edges[0]!["fromPort"]).toBe("Gi0/12");
    /*
     * ...with the switch declared as the parent: a MAC learned on an access
     * port is a statement that the device hangs off it.
     */
    expect(edges[0]!["parentNodeId"]).toBe(accessSwitch.id!.toString());

    // ...and not a second, anonymous node beside it.
    expect(endpointNodes(body)).toEqual([]);
    expect(body["adoptedEndpointCount"]).toBe(1);
    expect(body["droppedEndpointCount"]).toBe(0);

    /*
     * What the tables knew rides onto the device's own node, so the drawer
     * can show the MAC and VLAN of a device nothing walks.
     */
    const registerNode: JSONObject | undefined = nodeById(body, register.id!);
    expect(registerNode).toBeDefined();
    expect(registerNode!["macAddress"]).toBe("d4:3d:7e:12:34:56");
    expect(registerNode!["ipAddress"]).toBe("10.0.0.5");
    expect(registerNode!["vlanId"]).toBe(20);
  });

  /*
   * A MAC is unique per project among endpoints, so it needs no site to be
   * a safe key — and the declared one is read raw off the row: the operator
   * typed dashes and capitals, the walk stored colons, and the builder is
   * where they meet.
   */
  test("a device found by its declared MAC is adopted across sites, whatever notation each side used", async () => {
    const accessSwitch: NetworkDevice = makeDeviceAt("store-sw1", {
      siteId: ObjectID.generate(),
    });
    const handset: NetworkDevice = makeDeviceAt("front-desk-phone", {
      macAddress: "AA-BB-CC-DD-EE-01",
      siteId: ObjectID.generate(),
    });
    deviceService.findBy.mockResolvedValue([accessSwitch, handset] as never);
    endpointService.findBy.mockResolvedValue([
      makeEndpoint(accessSwitch.id!, "aa:bb:cc:dd:ee:01", {
        siteId: ObjectID.generate(),
        attachedPortName: "Gi0/7",
      }),
    ] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();
    const edges: Array<JSONObject> = edgesTouching(body, handset.id!);
    expect(edges.length).toBe(1);
    expect(edges[0]!["fromNodeId"]).toBe(accessSwitch.id!.toString());
    expect(edges[0]!["protocols"]).toEqual(["fdb"]);
    expect(edges[0]!["fromPort"]).toBe("Gi0/7");
    expect(endpointNodes(body)).toEqual([]);
    expect(body["adoptedEndpointCount"]).toBe(1);

    // A short page is the whole set; nothing to look up past it.
    expect(endpointService.findBy).toHaveBeenCalledTimes(1);
  });

  /*
   * The by-address match is scoped to the site on purpose. 10.0.0.5 in one
   * store is not 10.0.0.5 in the next, and a match across them would cable
   * a register to a switch in another building — a wrong cable, which is
   * worse than none. The row stays what it was: a stranger on the switch.
   */
  test("an address seen in another site stays a stranger and leaves the device unlinked", async () => {
    const storeA: ObjectID = ObjectID.generate();
    const storeB: ObjectID = ObjectID.generate();
    const accessSwitch: NetworkDevice = makeDeviceAt("store-b-sw1", {
      siteId: storeB,
    });
    const register: NetworkDevice = makeDeviceAt("store-a-register", {
      hostname: "10.0.0.5",
      siteId: storeA,
    });
    deviceService.findBy.mockResolvedValue([accessSwitch, register] as never);
    endpointService.findBy.mockResolvedValue([
      makeEndpoint(accessSwitch.id!, "d4:3d:7e:12:34:56", {
        ipAddress: "10.0.0.5",
        siteId: storeB,
      }),
    ] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();
    expect(endpointNodes(body).length).toBe(1);
    expect(edgesTouching(body, register.id!)).toEqual([]);
    expect(body["adoptedEndpointCount"]).toBe(0);
    expect(body["droppedEndpointCount"]).toBe(0);
  });
});

/*
 * The endpoint page is capped and ordered by MAC, so on a map with more
 * learned MACs than the cap the one row that puts a register on its port can
 * sit past the cut — and the register floats exactly as it did before it
 * had a MAC. Devices with a MAC are therefore looked up by it directly, but
 * ONLY when the page came back full: a short page is the whole set, and a
 * second query on every map load would be a real cost for a difference that
 * cannot exist below the cap.
 */
describe("POST /network-device/topology — the device-MAC lookup past the endpoint page cap", () => {
  beforeEach(() => {
    resetTopologyMocks();
  });

  test("a full page and a device with a MAC issue a second query, scoped to the map and to the declared MACs", async () => {
    const accessSwitch: NetworkDevice = makeDevice("store-sw1");
    const handset: NetworkDevice = makeDeviceAt("front-desk-phone", {
      macAddress: "AA-BB-CC-DD-EE-01",
    });
    deviceService.findBy.mockResolvedValue([accessSwitch, handset] as never);

    // The handset's row sits past the cut: the page is full of strangers.
    const pastTheCut: NetworkEndpoint = makeEndpoint(
      accessSwitch.id!,
      "aa:bb:cc:dd:ee:01",
      { attachedPortName: "Gi0/3" },
    );
    endpointService.findBy
      .mockResolvedValueOnce(
        strangers(accessSwitch.id!, ENDPOINT_PAGE_SIZE) as never,
      )
      .mockResolvedValueOnce([pastTheCut] as never);

    await callTopology({});

    expect(endpointService.findBy).toHaveBeenCalledTimes(2);

    const lookup: JSONObject = endpointQueryAt(1);
    expect((lookup["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    // Normalised, so the index on the stored (colon, lowercase) form serves.
    expect(idsInAnyOperator(lookup["macAddress"])).toEqual([
      "aa:bb:cc:dd:ee:01",
    ]);
    /*
     * Still scoped to the devices on THIS map: a switch in another site
     * that learned the same MAC as transit traffic is not this map's
     * evidence.
     */
    expect(idsInAnyOperator(lookup["attachedNetworkDeviceId"])).toEqual([
      accessSwitch.id!.toString(),
      handset.id!.toString(),
    ]);
    // The same columns as the page, so the merged rows are the same shape.
    const lookupSelect: JSONObject = (
      endpointService.findBy.mock.calls[1]![0] as JSONObject
    )["select"] as JSONObject;
    expect(lookupSelect["siteId"]).toBe(true);

    // And the row it found is merged in and draws the cable.
    const body: JSONObject = lastResponseBody();
    const edges: Array<JSONObject> = edgesTouching(body, handset.id!);
    expect(edges.length).toBe(1);
    expect(edges[0]!["fromNodeId"]).toBe(accessSwitch.id!.toString());
    expect(edges[0]!["protocols"]).toEqual(["fdb"]);
    expect(edges[0]!["fromPort"]).toBe("Gi0/3");
    expect(body["adoptedEndpointCount"]).toBe(1);
  });

  test("a short page is the whole set, so one query is enough", async () => {
    const accessSwitch: NetworkDevice = makeDevice("store-sw1");
    const handset: NetworkDevice = makeDeviceAt("front-desk-phone", {
      macAddress: "AA-BB-CC-DD-EE-01",
    });
    deviceService.findBy.mockResolvedValue([accessSwitch, handset] as never);
    endpointService.findBy.mockResolvedValue(
      strangers(accessSwitch.id!, 3) as never,
    );

    await callTopology({});

    expect(endpointService.findBy).toHaveBeenCalledTimes(1);
  });

  test("a full page and a device registered at an address issue a by-address query", async () => {
    /*
     * The builder adopts by address as well as by MAC, and a register
     * imported from a discovery scan has an address and no MAC yet. Past
     * the cap its row is as likely to be missing as any other, so the
     * addresses of the devices on the map are looked up too - every row
     * at those addresses, the site rule being the builder's to apply.
     */
    const accessSwitch: NetworkDevice = makeDevice("store-sw1");
    const register: NetworkDevice = makeDeviceAt("pos-register-1", {
      hostname: "10.0.0.5",
    });
    deviceService.findBy.mockResolvedValue([accessSwitch, register] as never);
    const registerRow: NetworkEndpoint = makeEndpoint(
      accessSwitch.id!,
      "ff:ff:00:00:00:01",
      { ipAddress: "10.0.0.5" },
    );
    endpointService.findBy
      .mockResolvedValueOnce(
        strangers(accessSwitch.id!, ENDPOINT_PAGE_SIZE) as never,
      )
      .mockResolvedValueOnce([registerRow] as never);

    await callTopology({});

    expect(endpointService.findBy).toHaveBeenCalledTimes(2);
    const secondQuery: JSONObject = (
      endpointService.findBy.mock.calls[1]![0] as JSONObject
    )["query"] as JSONObject;
    expect(idsInAnyOperator(secondQuery["ipAddress"])).toEqual(["10.0.0.5"]);
    expect(secondQuery["macAddress"]).toBeUndefined();
    expect(idsInAnyOperator(secondQuery["attachedNetworkDeviceId"])).toEqual([
      accessSwitch.id!.toString(),
      register.id!.toString(),
    ]);
    expect(lastResponseBody()["adoptedEndpointCount"]).toBe(1);
  });

  test("a full page with nothing to look up by - no MACs, no address hostnames - runs one query", async () => {
    const accessSwitch: NetworkDevice = makeDevice("store-sw1");
    const register: NetworkDevice = makeDeviceAt("pos-register-1", {
      hostname: "pos-register-1.store.example",
    });
    deviceService.findBy.mockResolvedValue([accessSwitch, register] as never);
    endpointService.findBy.mockResolvedValue(
      strangers(accessSwitch.id!, ENDPOINT_PAGE_SIZE) as never,
    );

    await callTopology({});

    expect(endpointService.findBy).toHaveBeenCalledTimes(1);
  });

  /*
   * The lookup is a superset of the page whenever the device's row DID make
   * the cut. Counted twice, that one row would report two adoptions and
   * hand the builder two candidates for one cable.
   */
  test("a row returned by both queries is merged once, by _id", async () => {
    const accessSwitch: NetworkDevice = makeDevice("store-sw1");
    const handset: NetworkDevice = makeDeviceAt("front-desk-phone", {
      macAddress: "AA-BB-CC-DD-EE-01",
    });
    deviceService.findBy.mockResolvedValue([accessSwitch, handset] as never);

    const page: Array<NetworkEndpoint> = strangers(
      accessSwitch.id!,
      ENDPOINT_PAGE_SIZE - 1,
    );
    const onThePage: NetworkEndpoint = makeEndpoint(
      accessSwitch.id!,
      "aa:bb:cc:dd:ee:01",
    );
    page.unshift(onThePage);
    expect(page.length).toBe(ENDPOINT_PAGE_SIZE);

    // The very same row instance, back from both queries.
    endpointService.findBy
      .mockResolvedValueOnce(page as never)
      .mockResolvedValueOnce([onThePage] as never);

    await callTopology({});

    expect(endpointService.findBy).toHaveBeenCalledTimes(2);

    const body: JSONObject = lastResponseBody();
    expect(body["adoptedEndpointCount"]).toBe(1);
    expect(edgesTouching(body, handset.id!).length).toBe(1);
  });
});

/*
 * The builder keys a Map on the site id, and an ObjectID instance is not a
 * Map key — two instances holding the same id are two keys. The .toString()
 * on both sides of the copy into the builder's input is therefore
 * load-bearing, and it is the kind of thing a refactor drops without a
 * compile error, since TopologyDeviceInput.siteId is typed as a string that
 * an ObjectID happens to satisfy through `as`.
 */
describe("POST /network-device/topology — site ids reach the builder as strings", () => {
  /*
   * Structurally typed rather than as jest.SpiedFunction: @jest/globals and
   * @types/jest disagree on the spy's shape, and the cast is the repo's
   * idiom for reading a spy's calls (see NetworkDeviceMonitorBindingUpdateGuard).
   */
  type BuildTopologySpy = {
    mock: {
      calls: Array<Parameters<typeof NetworkTopologyUtil.buildTopology>>;
    };
    mockRestore: () => void;
  };

  let buildSpy: BuildTopologySpy;

  beforeEach(() => {
    resetTopologyMocks();
    // Records the call and lets the real builder run, so the map still draws.
    buildSpy = jest.spyOn(
      NetworkTopologyUtil,
      "buildTopology",
    ) as unknown as BuildTopologySpy;
  });

  afterEach(() => {
    buildSpy.mockRestore();
  });

  function builderDevices(): Array<TopologyDeviceInput> {
    expect(buildSpy).toHaveBeenCalledTimes(1);
    const call: Parameters<typeof NetworkTopologyUtil.buildTopology> =
      buildSpy.mock.calls[0]!;
    return call[0];
  }

  function builderEndpoints(): Array<TopologyEndpointInput> {
    expect(buildSpy).toHaveBeenCalledTimes(1);
    const call: Parameters<typeof NetworkTopologyUtil.buildTopology> =
      buildSpy.mock.calls[0]!;
    // The endpoints argument is optional on the builder; the API always passes it.
    return call[3] || [];
  }

  test("a site-scoped request hands the builder the string form of every site id", async () => {
    const siteId: ObjectID = ObjectID.generate();
    const accessSwitch: NetworkDevice = makeDeviceAt("store-sw1", {
      siteId: siteId,
    });
    const register: NetworkDevice = makeDeviceAt("pos-register-1", {
      hostname: "10.0.0.5",
      siteId: siteId,
    });
    deviceService.findBy.mockResolvedValue([accessSwitch, register] as never);
    endpointService.findBy.mockResolvedValue([
      makeEndpoint(accessSwitch.id!, "d4:3d:7e:12:34:56", {
        ipAddress: "10.0.0.5",
        siteId: siteId,
      }),
    ] as never);

    await callTopology({ siteId: siteId.toString() });

    for (const device of builderDevices()) {
      expect(typeof device.siteId).toBe("string");
      expect(device.siteId).toBe(siteId.toString());
    }

    const endpoints: Array<TopologyEndpointInput> = builderEndpoints();
    expect(endpoints.length).toBe(1);
    expect(typeof endpoints[0]!.siteId).toBe("string");
    expect(endpoints[0]!.siteId).toBe(siteId.toString());

    // And with matching keys on both sides, the register gets its cable.
    expect(lastResponseBody()["adoptedEndpointCount"]).toBe(1);
  });

  test("a project-wide request does the same, and leaves an unfiled device's site genuinely absent", async () => {
    const siteId: ObjectID = ObjectID.generate();
    const accessSwitch: NetworkDevice = makeDeviceAt("store-sw1", {
      siteId: siteId,
    });
    // The state of a device nobody has filed yet: no column, not an empty one.
    const unfiled: NetworkDevice = makeDeviceAt("spare-register", {
      hostname: "10.0.0.9",
    });
    expect(unfiled.siteId).toBeUndefined();
    deviceService.findBy.mockResolvedValue([accessSwitch, unfiled] as never);
    endpointService.findBy.mockResolvedValue([
      makeEndpoint(accessSwitch.id!, "d4:3d:7e:12:34:56", {
        ipAddress: "10.0.0.5",
        siteId: siteId,
      }),
    ] as never);

    await callTopology({});

    const devices: Array<TopologyDeviceInput> = builderDevices();
    expect(devices.length).toBe(2);
    expect(devices[0]!.siteId).toBe(siteId.toString());
    /*
     * Not "" and not null: the builder folds all three to "no site", but
     * the handler must not invent one of them — that is the builder's call.
     */
    expect(devices[1]!.siteId).toBeUndefined();

    const endpoints: Array<TopologyEndpointInput> = builderEndpoints();
    expect(endpoints.length).toBe(1);
    expect(endpoints[0]!.siteId).toBe(siteId.toString());
  });
});

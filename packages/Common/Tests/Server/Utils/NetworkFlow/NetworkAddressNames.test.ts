import NetworkAddressNamesUtil, {
  MAX_ADDRESS_HOLDERS_READ,
  MAX_ADDRESSES_PER_FOUND_RECORD,
  MAX_NAMED_SUBNETS_READ,
  MAX_RECORDS_FOUND_BY_NAME,
  RECORD_SIGHTING_SLACK_MS,
} from "../../../../Server/Utils/NetworkFlow/NetworkAddressNames";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import NetworkAddressNameService from "../../../../Server/Services/NetworkAddressNameService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import logger from "../../../../Server/Utils/Logger";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesResource from "../../../../Models/DatabaseModels/KubernetesResource";
import NetworkAddressName from "../../../../Models/DatabaseModels/NetworkAddressName";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import {
  MAX_NAMED_ADDRESSES_PER_PAGE,
  NetworkAddressNameSource,
  NetworkTrafficAddressNames,
} from "../../../../Types/NetFlow/NetworkAddressName";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * WHAT A TRAFFIC PAGE'S ADDRESSES ARE CALLED (issue #5340), one page at a
 * time: one read per source whatever the number of addresses, every read
 * the caller's own, the first source that names an address winning, a
 * subnet's name beside it, and a record naming only the traffic of a time
 * it was there. A source that fails leaves the page with fewer names,
 * never none.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("80000000-0000-4000-8000-000000000001"),
};

const WINDOW_START: Date = new Date("2026-10-28T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-10-28T11:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

const HOST_ID: string = "60000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "40000000-0000-4000-8000-000000000001";
const CLOUD_ID: string = "70000000-0000-4000-8000-000000000001";
const NODE_ID: string = "71000000-0000-4000-8000-000000000001";
const POD_ID: string = "72000000-0000-4000-8000-000000000001";
const NAME_ROW_ID: string = "90000000-0000-4000-8000-000000000001";

interface Estate {
  exactNames: Array<NetworkAddressName>;
  subnetNames: Array<NetworkAddressName>;
  polledDevices: Array<NetworkDevice>;
  otherAddressDevices: Array<NetworkDevice>;
  hosts: Array<Host>;
  cloudIds: Array<ObjectID>;
  cloudResources: Array<CloudResource>;
  kubernetesIds: Array<ObjectID>;
  kubernetes: Array<KubernetesResource>;
}

function emptyEstate(): Estate {
  return {
    exactNames: [],
    subnetNames: [],
    polledDevices: [],
    otherAddressDevices: [],
    hosts: [],
    cloudIds: [],
    cloudResources: [],
    kubernetesIds: [],
    kubernetes: [],
  };
}

function addressName(address: string, name: string, id?: string): NetworkAddressName {
  const row: NetworkAddressName = new NetworkAddressName();
  row._id = id || ObjectID.generate().toString();
  row.address = address;
  row.name = name;
  return row;
}

function device(data: {
  id?: string;
  name: string;
  hostname?: string;
  otherAddresses?: string;
}): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row._id = data.id || ObjectID.generate().toString();
  row.name = data.name;
  row.hostname = data.hostname || "";
  row.otherAddresses = data.otherAddresses || "";
  return row;
}

function host(data: {
  id?: string;
  name?: string;
  hostIdentifier?: string;
  addresses: string;
  createdAt?: Date;
  lastSeenAt?: Date;
}): Host {
  const row: Host = new Host();
  row._id = data.id || ObjectID.generate().toString();
  row.name = data.name || "";
  row.hostIdentifier = data.hostIdentifier || "";
  row.hostIpAddresses = data.addresses;
  row.createdAt = data.createdAt || new Date(WINDOW_START.getTime() - 30 * 24 * HOUR_MS);
  if (data.lastSeenAt) {
    row.lastSeenAt = data.lastSeenAt;
  }
  return row;
}

function cloudResource(data: {
  id?: string;
  name: string;
  endpoints: Array<string>;
  createdAt?: Date;
  lastSeenAt?: Date;
  inventoriedAt?: Date;
}): CloudResource {
  const row: CloudResource = new CloudResource();
  row._id = data.id || ObjectID.generate().toString();
  row.name = data.name;
  (row as unknown as JSONObject)["cloudEndpoints"] = data.endpoints;
  row.createdAt = data.createdAt || new Date(WINDOW_START.getTime() - 24 * HOUR_MS);
  if (data.lastSeenAt) {
    row.lastSeenAt = data.lastSeenAt;
  }
  if (data.inventoriedAt) {
    row.inventoriedAt = data.inventoriedAt;
  }
  return row;
}

function kubernetes(data: {
  id?: string;
  kind: "Pod" | "Node" | "Service";
  name: string;
  status: JSONObject;
  created?: Date;
  lastSeenAt?: Date;
}): KubernetesResource {
  const row: KubernetesResource = new KubernetesResource();
  row._id = data.id || ObjectID.generate().toString();
  row.kind = data.kind;
  row.name = data.name;
  (row as unknown as JSONObject)["status"] = data.status;
  if (data.created) {
    row.resourceCreationTimestamp = data.created;
  }
  if (data.lastSeenAt) {
    row.lastSeenAt = data.lastSeenAt;
  }
  return row;
}

interface FindArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  skip: number;
  props: DatabaseCommonInteractionProps;
}

let estate: Estate;
let nameReads: Array<FindArgs>;
let deviceReads: Array<FindArgs>;
let hostReads: Array<FindArgs>;
let cloudReads: Array<FindArgs>;
let kubernetesReads: Array<FindArgs>;
let cloudIdReads: Array<{ endpoints: Array<string>; limit: number }>;
let kubernetesIdReads: Array<{ addresses: Array<string>; limit: number }>;

function sqlOf(operator: unknown): string {
  return (operator as FindOperator<unknown>).getSql!("x");
}

function parametersOf(operator: unknown): Array<unknown> {
  return Object.values(
    (operator as FindOperator<unknown>).objectLiteralParameters || {},
  );
}

beforeEach(() => {
  estate = emptyEstate();
  nameReads = [];
  deviceReads = [];
  hostReads = [];
  cloudReads = [];
  kubernetesReads = [];
  cloudIdReads = [];
  kubernetesIdReads = [];

  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });

  jest
    .spyOn(NetworkAddressNameService, "findBy")
    .mockImplementation((async (args: FindArgs) => {
      nameReads.push(args);
      return args.limit === MAX_NAMED_SUBNETS_READ
        ? estate.subnetNames
        : estate.exactNames;
    }) as never);

  jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation((async (args: FindArgs) => {
      deviceReads.push(args);

      if (args.query["hostname"]) {
        return estate.polledDevices;
      }

      if (args.query["otherAddresses"]) {
        return estate.otherAddressDevices;
      }

      // Found by name: every device the estate has.
      return [...estate.polledDevices, ...estate.otherAddressDevices];
    }) as never);

  jest.spyOn(HostService, "findBy").mockImplementation((async (
    args: FindArgs,
  ) => {
    hostReads.push(args);
    return estate.hosts;
  }) as never);

  jest
    .spyOn(CloudResourceService, "findIdsByEndpoints")
    .mockImplementation((async (args: {
      endpoints: Array<string>;
      limit: number;
    }) => {
      cloudIdReads.push(args);
      return estate.cloudIds;
    }) as never);

  jest
    .spyOn(CloudResourceService, "findBy")
    .mockImplementation((async (args: FindArgs) => {
      cloudReads.push(args);
      return estate.cloudResources;
    }) as never);

  jest
    .spyOn(KubernetesResourceService, "findIdsHoldingAddresses")
    .mockImplementation((async (args: {
      addresses: Array<string>;
      limit: number;
    }) => {
      kubernetesIdReads.push(args);
      return estate.kubernetesIds;
    }) as never);

  jest
    .spyOn(KubernetesResourceService, "findBy")
    .mockImplementation((async (args: FindArgs) => {
      kubernetesReads.push(args);
      return estate.kubernetes;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function resolve(
  addresses: Array<string>,
  dnsNames?: Map<string, string>,
): Promise<NetworkTrafficAddressNames> {
  return NetworkAddressNamesUtil.resolve({
    projectId: PROJECT,
    addresses: addresses,
    startTime: WINDOW_START,
    endTime: WINDOW_END,
    dnsNames: dnsNames,
    props: PROPS,
  });
}

describe("NetworkAddressNamesUtil.resolve: where a name comes from", () => {
  test("an address nothing names is not in the answer at all", async () => {
    expect(await resolve(["10.0.0.5", "198.51.100.7"])).toEqual({});
  });

  test("a name someone gave the address wins over the inventory and DNS, and carries its row", async () => {
    estate.exactNames = [addressName("10.18.167.35", "File server", NAME_ROW_ID)];
    estate.hosts = [
      host({ id: HOST_ID, name: "mumbai-fs01", addresses: "10.18.167.35" }),
    ];

    const names: NetworkTrafficAddressNames = await resolve(
      ["10.18.167.35"],
      new Map([["10.18.167.35", "fs01.corp.example"]]),
    );

    expect(names["10.18.167.35"]).toEqual({
      name: "File server",
      source: NetworkAddressNameSource.AddressName,
      resourceId: NAME_ROW_ID,
    });
  });

  test("a network device polled at the address, or listing it among its Other Addresses", async () => {
    estate.polledDevices = [
      device({ id: DEVICE_ID, name: "core-sw-01", hostname: "10.200.221.245" }),
    ];
    estate.otherAddressDevices = [
      device({
        name: "edge-fw-01",
        hostname: "edge-fw-01.corp.example",
        otherAddresses: "10.255.0.1, 10.255.0.2",
      }),
    ];

    const names: NetworkTrafficAddressNames = await resolve([
      "10.200.221.245",
      "10.255.0.2",
    ]);

    expect(names["10.200.221.245"]).toEqual({
      name: "core-sw-01",
      source: NetworkAddressNameSource.NetworkDevice,
      resourceId: DEVICE_ID,
    });
    expect(names["10.255.0.2"]?.name).toBe("edge-fw-01");
    expect(names["10.255.0.2"]?.source).toBe(
      NetworkAddressNameSource.NetworkDevice,
    );
  });

  test("a device outranks a host that reports the same address", async () => {
    estate.polledDevices = [device({ name: "core-sw-01", hostname: "10.0.0.1" })];
    estate.hosts = [host({ name: "jump-box", addresses: "10.0.0.1" })];

    expect((await resolve(["10.0.0.1"]))["10.0.0.1"]?.name).toBe("core-sw-01");
  });

  test("a host, by the addresses its agent reports; its identifier when it has no name", async () => {
    estate.hosts = [
      host({
        id: HOST_ID,
        name: "mumbai-fs01",
        addresses: "192.168.1.42, 10.18.167.35",
      }),
      host({ hostIdentifier: "ip-10-0-0-9", addresses: "10.0.0.9" }),
    ];

    const names: NetworkTrafficAddressNames = await resolve([
      "10.18.167.35",
      "10.0.0.9",
    ]);

    expect(names["10.18.167.35"]).toEqual({
      name: "mumbai-fs01",
      source: NetworkAddressNameSource.Host,
      resourceId: HOST_ID,
    });
    expect(names["10.0.0.9"]?.name).toBe("ip-10-0-0-9");
  });

  test("a cloud resource whose cloud lists the address", async () => {
    estate.cloudIds = [new ObjectID(CLOUD_ID)];
    estate.cloudResources = [
      cloudResource({
        id: CLOUD_ID,
        name: "orders-db-primary",
        endpoints: ["orders.abc123.eu-west-1.rds.amazonaws.com", "10.114.167.16"],
        lastSeenAt: WINDOW_END,
      }),
    ];

    expect((await resolve(["10.114.167.16"]))["10.114.167.16"]).toEqual({
      name: "orders-db-primary",
      source: NetworkAddressNameSource.CloudResource,
      resourceId: CLOUD_ID,
    });
  });

  test("a Kubernetes node by its InternalIP or ExternalIP, a pod by its own podIP", async () => {
    estate.kubernetesIds = [new ObjectID(NODE_ID), new ObjectID(POD_ID)];
    estate.kubernetes = [
      kubernetes({
        id: NODE_ID,
        kind: "Node",
        name: "ip-10-34-167-20.ec2.internal",
        status: {
          addresses: [
            { type: "InternalIP", address: "10.34.167.20" },
            { type: "ExternalIP", address: "203.0.113.20" },
            { type: "Hostname", address: "10.34.167.21" },
          ],
        },
      }),
      kubernetes({
        id: POD_ID,
        kind: "Pod",
        name: "checkout-api-7f9c6d-xkz2p",
        status: { podIP: "10.242.167.220", hostIP: "10.34.167.20" },
      }),
    ];

    const names: NetworkTrafficAddressNames = await resolve([
      "10.34.167.20",
      "203.0.113.20",
      "10.34.167.21",
      "10.242.167.220",
    ]);

    expect(names["10.34.167.20"]).toEqual({
      name: "ip-10-34-167-20.ec2.internal",
      source: NetworkAddressNameSource.KubernetesNode,
    });
    expect(names["203.0.113.20"]?.source).toBe(
      NetworkAddressNameSource.KubernetesNode,
    );
    // A Hostname entry is a name, not an address the node holds.
    expect(names["10.34.167.21"]).toBeUndefined();
    expect(names["10.242.167.220"]).toEqual({
      name: "checkout-api-7f9c6d-xkz2p",
      source: NetworkAddressNameSource.KubernetesPod,
    });
  });

  test("a node outranks a pod on the node's own network (and such a pod names nothing)", async () => {
    estate.kubernetesIds = [new ObjectID(NODE_ID), new ObjectID(POD_ID)];
    estate.kubernetes = [
      kubernetes({
        id: POD_ID,
        kind: "Pod",
        name: "kube-proxy-x2",
        status: { podIP: "10.34.167.20", hostIP: "10.34.167.20" },
      }),
      kubernetes({
        id: NODE_ID,
        kind: "Node",
        name: "node-a",
        status: { addresses: [{ type: "InternalIP", address: "10.34.167.20" }] },
      }),
    ];

    expect((await resolve(["10.34.167.20"]))["10.34.167.20"]?.name).toBe(
      "node-a",
    );
  });

  test("DNS last: the name the page's own flows carried, for an address nothing else names", async () => {
    estate.hosts = [host({ name: "mumbai-fs01", addresses: "10.18.167.35" })];

    const names: NetworkTrafficAddressNames = await resolve(
      ["10.18.167.35", "10.18.167.31"],
      new Map([
        ["10.18.167.35", "fs01.corp.example"],
        ["10.18.167.31", "mum-print-02.corp.example"],
        // Not on the page: never in the answer.
        ["10.99.0.1", "elsewhere.corp.example"],
      ]),
    );

    expect(names["10.18.167.35"]?.name).toBe("mumbai-fs01");
    expect(names["10.18.167.31"]).toEqual({
      name: "mum-print-02.corp.example",
      source: NetworkAddressNameSource.Dns,
    });
    expect(names["10.99.0.1"]).toBeUndefined();
  });

  test("a DNS name with nothing left once cleaned names nothing", async () => {
    const names: NetworkTrafficAddressNames = await resolve(
      ["10.0.0.5"],
      new Map([["10.0.0.5", "  \n "]]),
    );

    expect(names).toEqual({});
  });

  test("a record without a name, archived or not, names nothing", async () => {
    estate.hosts = [host({ name: "", hostIdentifier: "", addresses: "10.0.0.7" })];
    estate.polledDevices = [device({ name: "   ", hostname: "10.0.0.8" })];

    expect(await resolve(["10.0.0.7", "10.0.0.8"])).toEqual({});
  });

  test("only the addresses asked about: a record's other addresses are not named", async () => {
    estate.hosts = [
      host({ name: "mumbai-fs01", addresses: "10.18.167.35, 10.18.167.36" }),
    ];

    const names: NetworkTrafficAddressNames = await resolve(["10.18.167.35"]);

    expect(Object.keys(names)).toEqual(["10.18.167.35"]);
  });

  test("a value listed whole, never a substring: 10.0.0.1 is not 10.0.0.10", async () => {
    estate.hosts = [host({ name: "db-10", addresses: "10.0.0.10, 10.0.0.11" })];

    expect(await resolve(["10.0.0.1"])).toEqual({});
  });
});

describe("NetworkAddressNamesUtil.resolve: subnets", () => {
  test("a named subnet is shown beside the address, never in place of its name", async () => {
    estate.subnetNames = [addressName("10.18.167.0/24", "Mumbai office")];
    estate.hosts = [
      host({ id: HOST_ID, name: "mumbai-fs01", addresses: "10.18.167.35" }),
    ];

    const names: NetworkTrafficAddressNames = await resolve([
      "10.18.167.35",
      "10.18.167.36",
      "10.18.168.1",
    ]);

    expect(names["10.18.167.35"]).toEqual({
      name: "mumbai-fs01",
      source: NetworkAddressNameSource.Host,
      resourceId: HOST_ID,
      subnetName: "Mumbai office",
      subnet: "10.18.167.0/24",
    });
    // Only the subnet says anything about this one: no name, the subnet beside it.
    expect(names["10.18.167.36"]).toEqual({
      subnetName: "Mumbai office",
      subnet: "10.18.167.0/24",
    });
    expect(names["10.18.168.1"]).toBeUndefined();
  });

  test("the narrowest of overlapping subnets is the one shown", async () => {
    estate.subnetNames = [
      addressName("10.0.0.0/8", "Corporate"),
      addressName("10.18.167.0/24", "Mumbai office"),
      addressName("10.18.0.0/16", "Mumbai campus"),
    ];

    const names: NetworkTrafficAddressNames = await resolve([
      "10.18.167.35",
      "10.18.5.5",
      "10.200.0.1",
    ]);

    expect(names["10.18.167.35"]?.subnetName).toBe("Mumbai office");
    expect(names["10.18.5.5"]?.subnetName).toBe("Mumbai campus");
    expect(names["10.200.0.1"]?.subnetName).toBe("Corporate");
  });

  test("IPv6 subnets name IPv6 addresses", async () => {
    estate.subnetNames = [addressName("2001:db8:1::/48", "Lab")];

    const names: NetworkTrafficAddressNames = await resolve(["2001:db8:1::5"]);

    expect(names["2001:db8:1::5"]).toEqual({
      subnetName: "Lab",
      subnet: "2001:db8:1::/48",
    });
  });

  test("a stored row that is not an address or a subnet, or has no name, is skipped", async () => {
    estate.exactNames = [addressName("not-an-address", "Broken")];
    estate.subnetNames = [
      addressName("10.0.0.0/8", ""),
      addressName("10.0.0.0/99", "Broken"),
    ];

    expect(await resolve(["10.0.0.5"])).toEqual({});
  });
});

describe("NetworkAddressNamesUtil.resolve: the page's spellings", () => {
  test("an address the page writes two ways is named under both", async () => {
    estate.hosts = [host({ name: "v6-host", addresses: "2001:db8::5" })];

    const names: NetworkTrafficAddressNames = await resolve([
      "2001:DB8:0:0:0:0:0:5",
      "2001:db8::5",
    ]);

    expect(names["2001:DB8:0:0:0:0:0:5"]?.name).toBe("v6-host");
    expect(names["2001:db8::5"]?.name).toBe("v6-host");
    // Read once, written one way.
    expect(hostReads).toHaveLength(1);
  });

  test("a text that is no address is skipped, and nothing is read for none", async () => {
    expect(await resolve(["router-1", "", "10.0.0.256"])).toEqual({});
    expect(nameReads).toHaveLength(0);
    expect(deviceReads).toHaveLength(0);
    expect(hostReads).toHaveLength(0);
    expect(cloudIdReads).toHaveLength(0);
    expect(kubernetesIdReads).toHaveLength(0);
  });
});

describe("NetworkAddressNamesUtil.resolve: what it reads", () => {
  test("one read per source, however many addresses: a page of 200 is no slower than one", async () => {
    const addresses: Array<string> = [];

    for (let index: number = 0; index < 400; index++) {
      addresses.push(`10.${Math.floor(index / 250)}.${index % 250}.1`);
    }

    await resolve(addresses);

    // Address Names: the exact addresses, and the project's subnets.
    expect(nameReads).toHaveLength(2);
    // Devices: polled at an address, and listing one among Other Addresses.
    expect(deviceReads).toHaveLength(2);
    expect(hostReads).toHaveLength(1);
    expect(cloudIdReads).toHaveLength(1);
    expect(kubernetesIdReads).toHaveLength(1);
    // No ids found: the records are never read.
    expect(cloudReads).toHaveLength(0);
    expect(kubernetesReads).toHaveLength(0);

    // At most a page's worth of addresses is asked about.
    expect(cloudIdReads[0]!.endpoints).toHaveLength(
      MAX_NAMED_ADDRESSES_PER_PAGE,
    );
    expect(kubernetesIdReads[0]!.addresses).toHaveLength(
      MAX_NAMED_ADDRESSES_PER_PAGE,
    );
    expect(cloudIdReads[0]!.limit).toBe(MAX_ADDRESS_HOLDERS_READ);
    expect(kubernetesIdReads[0]!.limit).toBe(MAX_ADDRESS_HOLDERS_READ);
  });

  test("every read is the caller's own, pinned to the project", async () => {
    estate.cloudIds = [new ObjectID(CLOUD_ID)];
    estate.kubernetesIds = [new ObjectID(POD_ID)];

    await resolve(["10.0.0.5"]);

    for (const read of [
      ...nameReads,
      ...deviceReads,
      ...hostReads,
      ...cloudReads,
      ...kubernetesReads,
    ]) {
      expect(read.props).toBe(PROPS);
      expect(String(read.query["projectId"])).toBe(PROJECT.toString());
    }

    expect(cloudReads).toHaveLength(1);
    expect(kubernetesReads).toHaveLength(1);
  });

  test("archived devices and hosts name nothing", async () => {
    await resolve(["10.0.0.5"]);

    for (const read of [...deviceReads, ...hostReads]) {
      expect(read.query["isArchived"]).toBe(false);
    }
  });

  test("the reads ask for addresses as bound parameters, written one way", async () => {
    await resolve(["2001:DB8::5", "10.0.0.5"]);

    const exact: FindArgs = nameReads.find((read: FindArgs) => {
      return read.limit !== MAX_NAMED_SUBNETS_READ;
    })!;
    expect(exact.limit).toBe(2);
    expect(JSON.stringify(parametersOf(exact.query["address"]))).toContain(
      "2001:db8::5",
    );

    const subnets: FindArgs = nameReads.find((read: FindArgs) => {
      return read.limit === MAX_NAMED_SUBNETS_READ;
    })!;
    // Every row with a slash: the project's subnets, matched here.
    expect(parametersOf(subnets.query["address"])).toEqual(["%/%"]);

    const polled: FindArgs = deviceReads.find((read: FindArgs) => {
      return Boolean(read.query["hostname"]);
    })!;
    expect(sqlOf(polled.query["hostname"])).toContain("LOWER(x) IN");
    expect(parametersOf(polled.query["hostname"])).toEqual([
      ["2001:db8::5", "10.0.0.5"],
    ]);

    const listed: FindArgs = deviceReads.find((read: FindArgs) => {
      return Boolean(read.query["otherAddresses"]);
    })!;
    expect(sqlOf(listed.query["otherAddresses"])).toContain("string_to_array");
    expect(parametersOf(listed.query["otherAddresses"])).toEqual([
      ["2001:db8::5", "10.0.0.5"],
    ]);
    expect(sqlOf(hostReads[0]!.query["hostIpAddresses"])).toContain(
      "string_to_array",
    );
  });

  test("a source that fails is left out, says so in the log, and the others still name", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockRejectedValue(new Error("connection reset") as never);
    estate.polledDevices = [device({ name: "core-sw-01", hostname: "10.0.0.1" })];
    estate.exactNames = [addressName("10.0.0.2", "Printer")];

    const names: NetworkTrafficAddressNames = await resolve([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);

    expect(names["10.0.0.1"]?.name).toBe("core-sw-01");
    expect(names["10.0.0.2"]?.name).toBe("Printer");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not read hosts"),
    );
  });

  test("a caller who may not read a source gets no names from it, and no error", async () => {
    jest
      .spyOn(CloudResourceService, "findIdsByEndpoints")
      .mockResolvedValue([new ObjectID(CLOUD_ID)] as never);
    jest
      .spyOn(CloudResourceService, "findBy")
      .mockRejectedValue(
        new Error("You do not have permissions to read Cloud Resource") as never,
      );

    await expect(resolve(["10.114.167.16"])).resolves.toEqual({});
  });
});

describe("NetworkAddressNamesUtil.resolve: a record names traffic of a time it was there", () => {
  test("a host first seen after the window names none of it", async () => {
    estate.hosts = [
      host({
        name: "late-host",
        addresses: "10.0.0.5",
        createdAt: new Date(WINDOW_END.getTime() + RECORD_SIGHTING_SLACK_MS + 1),
      }),
    ];

    expect(await resolve(["10.0.0.5"])).toEqual({});
  });

  test("a host not seen since well before the window names none of it", async () => {
    estate.hosts = [
      host({
        name: "gone-host",
        addresses: "10.0.0.5",
        lastSeenAt: new Date(
          WINDOW_START.getTime() - RECORD_SIGHTING_SLACK_MS - 1,
        ),
      }),
    ];

    expect(await resolve(["10.0.0.5"])).toEqual({});
  });

  test("within the slack, or with no sighting recorded, a host names the window", async () => {
    estate.hosts = [
      host({
        name: "edge-host",
        addresses: "10.0.0.5",
        createdAt: new Date(WINDOW_END.getTime() + RECORD_SIGHTING_SLACK_MS - 1),
      }),
      host({
        name: "quiet-host",
        addresses: "10.0.0.6",
        lastSeenAt: new Date(
          WINDOW_START.getTime() - RECORD_SIGHTING_SLACK_MS + 1,
        ),
      }),
    ];

    const names: NetworkTrafficAddressNames = await resolve([
      "10.0.0.5",
      "10.0.0.6",
    ]);

    expect(names["10.0.0.5"]?.name).toBe("edge-host");
    expect(names["10.0.0.6"]?.name).toBe("quiet-host");
  });

  test("a pod that was gone before the window does not name the address its successor holds", async () => {
    estate.kubernetesIds = [new ObjectID(POD_ID)];
    estate.kubernetes = [
      kubernetes({
        id: POD_ID,
        kind: "Pod",
        name: "checkout-api-old",
        status: { podIP: "10.242.167.220", hostIP: "10.34.167.20" },
        lastSeenAt: new Date(WINDOW_START.getTime() - 2 * HOUR_MS),
      }),
    ];

    expect(await resolve(["10.242.167.220"])).toEqual({});
  });

  test("a cloud resource counts as seen when its read last listed it", async () => {
    estate.cloudIds = [new ObjectID(CLOUD_ID)];
    estate.cloudResources = [
      cloudResource({
        id: CLOUD_ID,
        name: "orders-db",
        endpoints: ["10.114.167.16"],
        lastSeenAt: new Date(WINDOW_START.getTime() - 48 * HOUR_MS),
        inventoriedAt: new Date(WINDOW_START.getTime() + HOUR_MS / 2),
      }),
    ];

    expect((await resolve(["10.114.167.16"]))["10.114.167.16"]?.name).toBe(
      "orders-db",
    );
  });

  test("Address Names and devices name any window: they are configuration", async () => {
    estate.exactNames = [addressName("10.0.0.2", "Printer")];
    estate.polledDevices = [device({ name: "core-sw-01", hostname: "10.0.0.1" })];

    const names: NetworkTrafficAddressNames =
      await NetworkAddressNamesUtil.resolve({
        projectId: PROJECT,
        addresses: ["10.0.0.1", "10.0.0.2"],
        startTime: new Date("2020-01-01T00:00:00.000Z"),
        endTime: new Date("2020-01-01T01:00:00.000Z"),
        props: PROPS,
      });

    expect(names["10.0.0.1"]?.name).toBe("core-sw-01");
    expect(names["10.0.0.2"]?.name).toBe("Printer");
  });
});

describe("NetworkAddressNamesUtil.wasThereDuring", () => {
  const window: { startTime: Date; endTime: Date } = {
    startTime: WINDOW_START,
    endTime: WINDOW_END,
  };

  test("a record seen across the window was there", () => {
    expect(
      NetworkAddressNamesUtil.wasThereDuring(
        {
          firstSeenAt: new Date(WINDOW_START.getTime() - HOUR_MS),
          lastSeenAt: new Date(WINDOW_END.getTime() + HOUR_MS),
        },
        window,
      ),
    ).toBe(true);
  });

  test("a sighting that is missing, or not a date, says nothing against", () => {
    expect(NetworkAddressNamesUtil.wasThereDuring({}, window)).toBe(true);
    expect(
      NetworkAddressNamesUtil.wasThereDuring(
        {
          firstSeenAt: null,
          lastSeenAt: new Date("not a date"),
        },
        window,
      ),
    ).toBe(true);
  });

  test("first seen too late, or last seen too early, was not there", () => {
    expect(
      NetworkAddressNamesUtil.wasThereDuring(
        { firstSeenAt: new Date(WINDOW_END.getTime() + 2 * HOUR_MS) },
        window,
      ),
    ).toBe(false);
    expect(
      NetworkAddressNamesUtil.wasThereDuring(
        { lastSeenAt: new Date(WINDOW_START.getTime() - 2 * HOUR_MS) },
        window,
      ),
    ).toBe(false);
  });
});

describe("NetworkAddressNamesUtil.kubernetesAddresses", () => {
  test("a pod holds its podIP unless it shares its node's", () => {
    expect(
      NetworkAddressNamesUtil.kubernetesAddresses(
        kubernetes({
          kind: "Pod",
          name: "a",
          status: { podIP: "10.1.0.5", hostIP: "10.0.0.1" },
        }),
      ),
    ).toEqual(["10.1.0.5"]);
    expect(
      NetworkAddressNamesUtil.kubernetesAddresses(
        kubernetes({
          kind: "Pod",
          name: "a",
          status: { podIP: "10.0.0.1", hostIP: "10.0.0.1" },
        }),
      ),
    ).toEqual([]);
  });

  test("a node holds its InternalIP and ExternalIP addresses", () => {
    expect(
      NetworkAddressNamesUtil.kubernetesAddresses(
        kubernetes({
          kind: "Node",
          name: "n",
          status: {
            addresses: [
              { type: "InternalIP", address: "10.0.0.1" },
              { type: "ExternalIP", address: "203.0.113.1" },
              { type: "InternalDNS", address: "n.internal" },
              "garbage",
              { type: "InternalIP", address: 5 },
            ],
          },
        }),
      ),
    ).toEqual(["10.0.0.1", "203.0.113.1"]);
  });

  test("any other kind, or a status that is not an object, holds nothing", () => {
    expect(
      NetworkAddressNamesUtil.kubernetesAddresses(
        kubernetes({
          kind: "Service",
          name: "s",
          status: { loadBalancer: {} },
        }),
      ),
    ).toEqual([]);

    const broken: KubernetesResource = kubernetes({
      kind: "Pod",
      name: "p",
      status: {},
    });
    (broken as unknown as JSONObject)["status"] = ["10.0.0.1"];

    expect(NetworkAddressNamesUtil.kubernetesAddresses(broken)).toEqual([]);
  });
});

describe("NetworkAddressNamesUtil.findAddressesByName", () => {
  async function find(text: string): Promise<Array<string>> {
    return NetworkAddressNamesUtil.findAddressesByName({
      projectId: PROJECT,
      text: text,
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      props: PROPS,
    });
  }

  test("nothing typed finds nothing, and reads nothing", async () => {
    expect(await find("   ")).toEqual([]);
    expect(nameReads).toHaveLength(0);
    expect(hostReads).toHaveLength(0);
  });

  test("every word typed must be in the name, matched literally, in every source", async () => {
    await find("mumbai  fs%");

    for (const read of [
      ...nameReads,
      ...deviceReads,
      ...hostReads,
      ...cloudReads,
      ...kubernetesReads,
    ]) {
      expect(read.props).toBe(PROPS);
      expect(read.limit).toBe(MAX_RECORDS_FOUND_BY_NAME);
      // LIKE's own characters are escaped: a "%" typed is a "%".
      expect(parametersOf(read.query["name"]).sort()).toEqual(
        ["%mumbai%", "%fs\\%%"].sort(),
      );
    }

    expect(nameReads).toHaveLength(1);
    expect(deviceReads).toHaveLength(1);
    expect(hostReads).toHaveLength(1);
    expect(cloudReads).toHaveLength(1);
    expect(kubernetesReads).toHaveLength(1);
  });

  test("answers each found record's addresses, written one way, each once", async () => {
    estate.exactNames = [
      addressName("158.115.141.143", "Payroll SaaS"),
      // A subnet is where addresses are, not one of them.
      addressName("10.18.167.0/24", "Payroll office"),
    ];
    estate.polledDevices = [
      device({
        name: "payroll-fw",
        hostname: "10.255.0.1",
        otherAddresses: "10.255.0.2, 158.115.141.143",
      }),
    ];
    estate.hosts = [
      host({ name: "payroll-db", addresses: "2001:DB8::5, 10.0.0.5" }),
    ];
    estate.cloudResources = [
      cloudResource({
        name: "payroll-api",
        endpoints: ["payroll.example.com", "10.114.167.40"],
      }),
    ];
    estate.kubernetes = [
      kubernetes({
        kind: "Pod",
        name: "payroll-worker",
        status: { podIP: "10.242.0.9", hostIP: "10.34.0.1" },
      }),
    ];

    expect(await find("payroll")).toEqual([
      "158.115.141.143",
      "10.255.0.1",
      "10.255.0.2",
      "2001:db8::5",
      "10.0.0.5",
      "10.114.167.40",
      "10.242.0.9",
    ]);
  });

  test("a host or pod that was not there during the window is not found", async () => {
    estate.hosts = [
      host({
        name: "payroll-old",
        addresses: "10.0.0.5",
        lastSeenAt: new Date(WINDOW_START.getTime() - 24 * HOUR_MS),
      }),
    ];
    estate.kubernetes = [
      kubernetes({
        kind: "Pod",
        name: "payroll-old-pod",
        status: { podIP: "10.242.0.9", hostIP: "10.34.0.1" },
        created: new Date(WINDOW_END.getTime() + 24 * HOUR_MS),
      }),
    ];

    expect(await find("payroll")).toEqual([]);
  });

  test("at most a few addresses from one record (a host can list dozens)", async () => {
    const many: Array<string> = [];

    for (let index: number = 1; index <= 30; index++) {
      many.push(`10.9.0.${index}`);
    }

    estate.hosts = [host({ name: "busy", addresses: many.join(", ") })];

    expect(await find("busy")).toHaveLength(MAX_ADDRESSES_PER_FOUND_RECORD);
  });

  test("a source that fails is left out; the others still answer", async () => {
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockRejectedValue(new Error("boom") as never);
    estate.exactNames = [addressName("158.115.141.143", "Payroll SaaS")];

    expect(await find("payroll")).toEqual(["158.115.141.143"]);
  });
});

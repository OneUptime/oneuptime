import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesResource from "../../../../Models/DatabaseModels/KubernetesResource";
import NetworkAddressName from "../../../../Models/DatabaseModels/NetworkAddressName";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "../../../../Models/DatabaseModels/NetworkEndpoint";
import Probe from "../../../../Models/DatabaseModels/Probe";
import SecurityProtectedEntity from "../../../../Models/DatabaseModels/SecurityProtectedEntity";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import NetworkAddressNameService from "../../../../Server/Services/NetworkAddressNameService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import ProbeService from "../../../../Server/Services/ProbeService";
import SecurityProtectedEntityService from "../../../../Server/Services/SecurityProtectedEntityService";
import logger from "../../../../Server/Utils/Logger";
import DnsResolutionCache from "../../../../Server/Utils/Monitor/DnsResolutionCache";
import SecurityEdgeRanges, {
  CLOUDFLARE_EDGE,
  SecurityEdge,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityProtectedAddresses, {
  DNS_FAILURE_RETRY_IN_MS,
  LOAD_BALANCERS_RESOLVED_PER_CHECK,
  LOAD_BALANCER_TYPES,
  PROTECTED_ADDRESSES_LISTED_PER_SOURCE,
  PROTECTED_ADDRESS_ROWS_PER_SOURCE,
  SecurityProtectedAddressGroup,
  SecurityProtectionCheck,
  getProtectedAddressPrefilter,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_LOCAL_ADDRESS_RANGES,
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
  describeSecurityAddressProtection,
} from "../../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator, ObjectLiteral } from "typeorm";

// A source that cannot be read is logged; the tests read what the check answers.
jest.mock("../../../../Server/Utils/Logger");

/*
 * Whether a block would touch one of the project's own addresses (#10338).
 * Each source is read as OneUptime - an address is protected whoever asks -
 * narrowed by the text the block's addresses start with, and held to the
 * block exactly: the project's Protected Entities list, its probes and
 * OneUptime's, its Address Names, hosts, Kubernetes nodes, cloud resources
 * and load balancers, network devices and endpoints, and the edge in front
 * of its app. A source that cannot be read in full leaves the answer open,
 * and the block is not made. The services are spied, each answering as the
 * database would: a row found by its column's text, without case, at most
 * the query's limit.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

type Spy = ReturnType<typeof getJestSpyOn>;
type Query = Record<string, unknown>;

// What a source was asked for, as its spy saw it.
interface FindInput {
  query: Query;
  limit: number;
  props: DatabaseCommonInteractionProps;
}

function inputsOf(spy: Spy): Array<FindInput> {
  return spy.mock.calls.map((call: Array<unknown>): FindInput => {
    return call[0] as FindInput;
  });
}

/*
 * The probe reads, each by its query: the project's probes by the address
 * each checks in from and by the addresses on its own interfaces, and
 * OneUptime's own probes.
 */
function probeReadsOf(spy: Spy): {
  byCheckIn: FindInput | undefined;
  byInterface: FindInput | undefined;
  oneUptimes: FindInput | undefined;
} {
  const inputs: Array<FindInput> = inputsOf(spy);

  return {
    byCheckIn: inputs.find((input: FindInput): boolean => {
      return (
        input.query["isGlobalProbe"] === undefined &&
        input.query["egressIpAddress"] !== undefined
      );
    }),
    byInterface: inputs.find((input: FindInput): boolean => {
      return input.query["interfaceIpAddresses"] !== undefined;
    }),
    oneUptimes: inputs.find((input: FindInput): boolean => {
      return input.query["isGlobalProbe"] === true;
    }),
  };
}

/*
 * The text a query holds a column to (QueryHelper.search), or null for a
 * column held to any value at all (QueryHelper.notNull).
 */
function searchedText(filter: unknown): string | null {
  const parameters: ObjectLiteral | undefined =
    filter instanceof FindOperator ? filter.objectLiteralParameters : undefined;
  const value: unknown = parameters ? Object.values(parameters)[0] : undefined;

  return typeof value === "string" ? value.slice(1, -1) : null;
}

// Whether the database finds a column's value by the filter: by its text, without case.
function finds(filter: unknown, value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  const text: string | null = searchedText(filter);

  if (text === null) {
    return true;
  }

  const written: string =
    typeof value === "string" ? value : JSON.stringify(value);

  return written.toLowerCase().includes(text.toLowerCase());
}

// The project's records, as the database holds them.
interface Records {
  protectedEntities?: Array<SecurityProtectedEntity>;
  probes?: Array<Probe>;
  addressNames?: Array<NetworkAddressName>;
  hosts?: Array<Host>;
  nodes?: Array<KubernetesResource>;
  cloudResources?: Array<CloudResource>;
  devices?: Array<NetworkDevice>;
  endpoints?: Array<NetworkEndpoint>;
  edges?: Array<SecurityEdge>;
}

// The spied reads of each source.
interface Reads {
  protectedEntities: Spy;
  probes: Spy;
  addressNames: Spy;
  hosts: Spy;
  nodes: Spy;
  cloudResources: Spy;
  devices: Spy;
  endpoints: Spy;
  edges: Spy;
}

// A findBy that answers as the database would: the rows its query finds, at most its limit.
function answer<T>(
  rows: Array<T> | undefined,
  isFound: (row: T, query: Query) => boolean,
): (input: unknown) => Promise<Array<T>> {
  return async (input: unknown): Promise<Array<T>> => {
    const find: FindInput = input as FindInput;

    return (rows || [])
      .filter((row: T): boolean => {
        return isFound(row, find.query);
      })
      .slice(0, find.limit);
  };
}

function install(records: Records = {}): Reads {
  return {
    protectedEntities: getJestSpyOn(
      SecurityProtectedEntityService,
      "findBy",
    ).mockImplementation(
      answer(records.protectedEntities, (): boolean => {
        return true;
      }),
    ),
    probes: getJestSpyOn(ProbeService, "findBy").mockImplementation(
      answer(records.probes, (row: Probe, query: Query): boolean => {
        return (
          Boolean(row.isGlobalProbe) === (query["isGlobalProbe"] === true) &&
          (query["interfaceIpAddresses"] !== undefined
            ? finds(query["interfaceIpAddresses"], row.interfaceIpAddresses)
            : finds(query["egressIpAddress"], row.egressIpAddress))
        );
      }),
    ),
    addressNames: getJestSpyOn(
      NetworkAddressNameService,
      "findBy",
    ).mockImplementation(
      answer(
        records.addressNames,
        (row: NetworkAddressName, query: Query): boolean => {
          return finds(query["address"], row.address);
        },
      ),
    ),
    hosts: getJestSpyOn(HostService, "findBy").mockImplementation(
      answer(records.hosts, (row: Host, query: Query): boolean => {
        return finds(query["hostIpAddresses"], row.hostIpAddresses);
      }),
    ),
    nodes: getJestSpyOn(KubernetesResourceService, "findBy").mockImplementation(
      answer(
        records.nodes,
        (row: KubernetesResource, query: Query): boolean => {
          return (
            row.kind === query["kind"] && finds(query["status"], row.status)
          );
        },
      ),
    ),
    cloudResources: getJestSpyOn(
      CloudResourceService,
      "findBy",
    ).mockImplementation(
      answer(
        records.cloudResources,
        (row: CloudResource, query: Query): boolean => {
          if (query["cloudResourceType"] !== undefined) {
            return LOAD_BALANCER_TYPES.includes(row.cloudResourceType || "");
          }

          if (query["cloudProperties"] !== undefined) {
            return finds(query["cloudProperties"], row.cloudProperties);
          }

          return finds(query["cloudEndpoints"], row.cloudEndpoints);
        },
      ),
    ),
    devices: getJestSpyOn(NetworkDeviceService, "findBy").mockImplementation(
      answer(records.devices, (row: NetworkDevice, query: Query): boolean => {
        return query["otherAddresses"] !== undefined
          ? finds(query["otherAddresses"], row.otherAddresses)
          : finds(query["hostname"], row.hostname);
      }),
    ),
    endpoints: getJestSpyOn(
      NetworkEndpointService,
      "findBy",
    ).mockImplementation(
      answer(
        records.endpoints,
        (row: NetworkEndpoint, query: Query): boolean => {
          return finds(query["ipAddress"], row.ipAddress);
        },
      ),
    ),
    edges: getJestSpyOn(
      SecurityEdgeRanges,
      "findConnectedEdges",
    ).mockResolvedValue((records.edges || []) as never),
  };
}

function expectNothingRead(reads: Reads): void {
  for (const spy of Object.values(reads)) {
    expect(spy).not.toHaveBeenCalled();
  }
}

// The setting read as the server reads it - the real one, captured before any spy.
const readCloudSetting: (setting: string) => Array<SecurityAddressProtection> =
  SecurityProtectedAddresses.getOneUptimeCloudProtections.bind(
    SecurityProtectedAddresses,
  );

// OneUptime Cloud's probe addresses for a test, whatever IP_WHITELIST this machine has.
function setCloudSetting(setting: string): void {
  getJestSpyOn(
    SecurityProtectedAddresses,
    "getOneUptimeCloudProtections",
  ).mockImplementation((given?: unknown): Array<SecurityAddressProtection> => {
    return readCloudSetting(typeof given === "string" ? given : setting);
  });
}

function block(text: string): NetworkAddressBlock {
  const parsed: NetworkAddressBlock | null =
    NetworkAddressBlockUtil.parse(text);

  if (!parsed) {
    throw new Error(`${text} did not parse`);
  }

  return parsed;
}

function find(text: string): Promise<SecurityProtectionCheck> {
  return SecurityProtectedAddresses.findProtection({
    projectId: PROJECT_ID,
    block: block(text),
  });
}

function list(
  props: DatabaseCommonInteractionProps,
): Promise<Array<SecurityProtectedAddressGroup>> {
  return SecurityProtectedAddresses.listAutomaticProtections({
    projectId: PROJECT_ID,
    props,
  });
}

function groupOf(
  groups: Array<SecurityProtectedAddressGroup>,
  source: SecurityProtectedAddressSource,
): SecurityProtectedAddressGroup | undefined {
  return groups.find((group: SecurityProtectedAddressGroup): boolean => {
    return group.source === source;
  });
}

// A member of the project holding these permissions in it.
function reader(
  permissions: Array<Permission>,
  projectId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission,
              labelIds: [],
              isBlockPermission: false,
              scope: PermissionScope.All,
            };
          },
        ),
      },
    },
  };
}

// ---------- The project's records ----------

function withId<T extends BaseModel>(model: T): T {
  model._id = ObjectID.generate().toString();
  return model;
}

function idOf(model: BaseModel): string {
  return model.id?.toString() || "";
}

function protectedEntry(
  value: string,
  description?: string,
): SecurityProtectedEntity {
  const model: SecurityProtectedEntity = withId(new SecurityProtectedEntity());
  model.projectId = PROJECT_ID;
  model.entityType = SecurityEntityType.IpAddress;
  model.value = value;

  if (description !== undefined) {
    model.description = description;
  }

  return model;
}

function probe(data: {
  name: string;
  address: string;
  isGlobal?: boolean;
  // What its heartbeat listed of its own interfaces, as the column holds it.
  interfaceAddresses?: string;
}): Probe {
  const model: Probe = withId(new Probe());
  model.name = data.name;
  model.egressIpAddress = data.address;
  model.isGlobalProbe = Boolean(data.isGlobal);

  if (data.interfaceAddresses !== undefined) {
    model.interfaceIpAddresses = data.interfaceAddresses;
  }

  return model;
}

function addressName(name: string, address: string): NetworkAddressName {
  const model: NetworkAddressName = withId(new NetworkAddressName());
  model.name = name;
  model.address = address;
  return model;
}

function host(data: {
  name?: string;
  identifier?: string;
  addresses: string;
}): Host {
  const model: Host = withId(new Host());
  model.hostIpAddresses = data.addresses;

  if (data.name !== undefined) {
    model.name = data.name;
  }

  if (data.identifier !== undefined) {
    model.hostIdentifier = data.identifier;
  }

  return model;
}

function node(
  name: string,
  addresses: Array<{ type: string; address: string }>,
): KubernetesResource {
  const model: KubernetesResource = withId(new KubernetesResource());
  model.name = name;
  model.kind = "Node";
  model.status = { addresses } as JSONObject;
  return model;
}

function cloudResource(data: {
  name: string;
  type: string;
  endpoints?: Array<string>;
  properties?: JSONObject;
  account?: string;
}): CloudResource {
  const model: CloudResource = withId(new CloudResource());
  model.name = data.name;
  model.cloudProvider = CloudProvider.AWS;
  model.cloudResourceType = data.type;

  if (data.endpoints) {
    model.cloudEndpoints = data.endpoints;
  }

  if (data.properties) {
    model.cloudProperties = data.properties;
  }

  if (data.account) {
    const connection: CloudConnection = new CloudConnection();
    connection.name = data.account;
    model.cloudConnection = connection;
  }

  return model;
}

function device(data: {
  name?: string;
  hostname: string;
  otherAddresses?: string;
}): NetworkDevice {
  const model: NetworkDevice = withId(new NetworkDevice());
  model.hostname = data.hostname;

  if (data.name !== undefined) {
    model.name = data.name;
  }

  if (data.otherAddresses !== undefined) {
    model.otherAddresses = data.otherAddresses;
  }

  return model;
}

function endpoint(data: {
  hostname?: string;
  ipAddress: string;
}): NetworkEndpoint {
  const model: NetworkEndpoint = withId(new NetworkEndpoint());
  model.ipAddress = data.ipAddress;

  if (data.hostname !== undefined) {
    model.hostname = data.hostname;
  }

  return model;
}

beforeEach(() => {
  // The logger's calls, from the test before.
  jest.clearAllMocks();
  // No test reads the database, the network or this machine's settings.
  install({});
  setCloudSetting("");
  SecurityProtectedAddresses.setDnsCacheForTests(
    new DnsResolutionCache({
      resolver: async (): Promise<Array<string>> => {
        return [];
      },
    }),
  );
  getJestSpyOn(SecurityEdgeRanges, "getRanges").mockImplementation(
    async (edge: unknown): Promise<Array<string>> => {
      return [...(edge as SecurityEdge).knownRanges];
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getProtectedAddressPrefilter", () => {
  function prefilterOf(text: string): string | null {
    return getProtectedAddressPrefilter(block(text));
  }

  test("an IPv4 block is narrowed by its whole octets", () => {
    expect(prefilterOf("35.205.11.131")).toBe("35.205.11.131");
    expect(prefilterOf("35.205.11.0/24")).toBe("35.205.11.");
    expect(prefilterOf("35.205.11.128/25")).toBe("35.205.11.");
    expect(prefilterOf("35.205.16.0/20")).toBe("35.205.");
    expect(prefilterOf("35.205.0.0/16")).toBe("35.205.");
    expect(prefilterOf("35.0.0.0/8")).toBe("35.");
  });

  test("an IPv4 block wider than a /8 is narrowed by nothing", () => {
    expect(prefilterOf("34.0.0.0/7")).toBeNull();
    expect(prefilterOf("0.0.0.0/0")).toBeNull();
  });

  test("an IPv4 address an IPv6 one maps is narrowed as that IPv4 address", () => {
    expect(prefilterOf("::ffff:35.205.11.131")).toBe("35.205.11.131");
  });

  test("an IPv6 block is narrowed by its first group, however it was typed", () => {
    expect(prefilterOf("2001:db8::7")).toBe("2001:");
    expect(prefilterOf("2001:DB8:0:0:0:0:0:7")).toBe("2001:");
    expect(prefilterOf("2606:4700::/32")).toBe("2606:");
    expect(prefilterOf("db8::/16")).toBe("db8:");
  });

  test("an IPv6 block wider than a /16, or in ::/16, is narrowed to any IPv6 text", () => {
    expect(prefilterOf("2000::/3")).toBe(":");
    expect(prefilterOf("::/0")).toBe(":");
    expect(prefilterOf("::5")).toBe(":");
  });
});

describe("SecurityProtectedAddresses.getOneUptimeCloudProtections", () => {
  test("is the IP_WHITELIST setting: an address or a range each, comma- or space-separated, each once", () => {
    expect(
      readCloudSetting(
        "198.51.100.20, 198.51.100.0/28  2001:DB8::/48,, not-an-address 198.51.100.20/32",
      ),
    ).toEqual([
      {
        source: SecurityProtectedAddressSource.OneUptimeCloud,
        protectedValue: "198.51.100.20",
        name: "OneUptime Cloud",
      },
      {
        source: SecurityProtectedAddressSource.OneUptimeCloud,
        protectedValue: "198.51.100.0/28",
        name: "OneUptime Cloud",
      },
      {
        source: SecurityProtectedAddressSource.OneUptimeCloud,
        protectedValue: "2001:db8::/48",
        name: "OneUptime Cloud",
      },
    ]);
    expect(readCloudSetting("")).toEqual([]);
  });
});

describe("SecurityProtectedAddresses.findProtection", () => {
  test("a range that is not on the internet is protected, and nothing is read", async () => {
    const reads: Reads = install({
      hosts: [host({ name: "db-1", addresses: "10.0.4.12" })],
    });

    await expect(find("10.0.4.12")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.LocalRange,
        protectedValue: "10.0.0.0/8",
      },
      unreadSources: [],
    });
    expectNothingRead(reads);
  });

  test("OneUptime Cloud's probe addresses are protected, and nothing is read", async () => {
    setCloudSetting("198.51.100.20, 35.205.11.0/28");
    const reads: Reads = install({});

    await expect(find("35.205.11.9")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.OneUptimeCloud,
        protectedValue: "35.205.11.0/28",
        name: "OneUptime Cloud",
      },
      unreadSources: [],
    });
    expectNothingRead(reads);
  });

  test("an entry of the project's Protected Entities list, named by its description", async () => {
    const office: SecurityProtectedEntity = protectedEntry(
      "35.205.11.128/26",
      " Office ",
    );
    const reads: Reads = install({ protectedEntities: [office] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        protectedValue: "35.205.11.128/26",
        name: "Office",
        recordId: idOf(office),
      },
      unreadSources: [],
    });

    // A range shares no text with the addresses inside it: the list is read whole.
    expect(inputsOf(reads.protectedEntities)).toEqual([
      expect.objectContaining({
        query: {
          projectId: PROJECT_ID,
          entityType: SecurityEntityType.IpAddress,
        },
        limit: LIMIT_PER_PROJECT,
        props: ROOT,
      }),
    ]);
  });

  test("an entry with no description is named by its value, and a range that holds it is refused", async () => {
    const gateway: SecurityProtectedEntity = protectedEntry("35.205.11.131");
    install({ protectedEntities: [gateway] });

    await expect(find("35.205.11.0/24")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        protectedValue: "35.205.11.131",
        name: "35.205.11.131",
        recordId: idOf(gateway),
      },
      unreadSources: [],
    });
  });

  test("a probe of the project's, by the address it checks in from", async () => {
    const office: Probe = probe({
      name: "Office probe",
      address: "35.205.11.131",
    });
    const reads: Reads = install({ probes: [office] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.Probe,
        protectedValue: "35.205.11.131",
        name: "Office probe",
        recordId: idOf(office),
      },
      unreadSources: [],
    });

    const { byCheckIn, byInterface, oneUptimes } = probeReadsOf(reads.probes);

    expect(byCheckIn?.query["projectId"]).toEqual(PROJECT_ID);
    expect(searchedText(byCheckIn?.query["egressIpAddress"])).toBe(
      "35.205.11.131",
    );
    // Its interfaces' addresses are read by the same text.
    expect(byInterface?.query["projectId"]).toEqual(PROJECT_ID);
    expect(searchedText(byInterface?.query["interfaceIpAddresses"])).toBe(
      "35.205.11.131",
    );
    expect(oneUptimes?.query["projectId"]).toBeUndefined();
    expect(oneUptimes?.query["isGlobalProbe"]).toBe(true);
    expect(oneUptimes?.props).toEqual(ROOT);
  });

  /*
   * A probe polls its LAN from the addresses on its own interfaces
   * (#10429), which the flows show and the blocklist never blocks: the one
   * list of OneUptime's own probe addresses, which Security Events reads.
   */
  test("a probe of the project's, by an address on its own network interfaces", async () => {
    const office: Probe = probe({
      name: "Office probe",
      address: "35.205.11.131",
      interfaceAddresses: "198.51.100.40, 2001:db8::40",
    });
    install({ probes: [office] });

    await expect(find("198.51.100.40")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.Probe,
        protectedValue: "198.51.100.40",
        name: "Office probe",
        recordId: idOf(office),
      },
      unreadSources: [],
    });

    await expect(find("2001:db8::/48")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.Probe,
        protectedValue: "2001:db8::40",
        name: "Office probe",
        recordId: idOf(office),
      },
      unreadSources: [],
    });
  });

  test("a probe read by both of its addresses is one probe, each address once", async () => {
    install({
      probes: [
        probe({
          name: "Office probe",
          address: "35.205.11.131",
          interfaceAddresses: "35.205.11.131, 35.205.11.140",
        }),
      ],
    });

    const groups: Array<SecurityProtectedAddressGroup> = await list(
      reader([Permission.ProjectOwner]),
    );

    expect(
      groupOf(groups, SecurityProtectedAddressSource.Probe)?.protections.map(
        (protection: SecurityAddressProtection): string => {
          return protection.protectedValue;
        },
      ),
    ).toEqual(["35.205.11.131", "35.205.11.140"]);
  });

  test("an address that only looks like a probe's is not one", async () => {
    install({
      probes: [
        probe({
          name: "Office probe",
          address: "35.205.11.131",
          interfaceAddresses: "198.51.100.40",
        }),
      ],
    });

    await expect(find("198.51.100.4")).resolves.toEqual({
      protection: null,
      unreadSources: [],
    });
  });

  test("one of OneUptime's probes, which belongs to no project", async () => {
    const usEast: Probe = probe({
      name: "US East",
      address: "35.205.11.131",
      isGlobal: true,
    });
    install({ probes: [usEast] });

    await expect(find("35.205.11.0/24")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.GlobalProbe,
        protectedValue: "35.205.11.131",
        name: "US East",
        recordId: idOf(usEast),
      },
      unreadSources: [],
    });
  });

  test("an Address Name's range holds the address, though it shares no text with it", async () => {
    const nat: NetworkAddressName = addressName(
      "Office NAT",
      "35.205.11.128/27",
    );
    const reads: Reads = install({ addressNames: [nat] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.AddressName,
        protectedValue: "35.205.11.128/27",
        name: "Office NAT",
        recordId: idOf(nat),
      },
      unreadSources: [],
    });

    const [byText, ranges]: Array<FindInput | undefined> = inputsOf(
      reads.addressNames,
    );

    expect(searchedText(byText?.query["address"])).toBe("35.205.11.131");
    expect(searchedText(ranges?.query["address"])).toBe("/");
    expect(ranges?.limit).toBe(LIMIT_PER_PROJECT + 1);
  });

  test("an Address Name of the address itself is found by its text", async () => {
    const api: NetworkAddressName = addressName(" ", "35.205.11.131");
    install({ addressNames: [api] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.AddressName,
        protectedValue: "35.205.11.131",
        name: "35.205.11.131",
        recordId: idOf(api),
      },
      unreadSources: [],
    });
  });

  test("a host's address, among the addresses its agent reports", async () => {
    const web: Host = host({
      name: "web-3",
      addresses: "10.0.4.12,35.205.11.131 fe80::1",
    });
    const reads: Reads = install({ hosts: [web] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.Host,
        protectedValue: "35.205.11.131",
        name: "web-3",
        recordId: idOf(web),
      },
      unreadSources: [],
    });

    const [input]: Array<FindInput | undefined> = inputsOf(reads.hosts);

    // Archived hosts protect nothing.
    expect(input?.query["isArchived"]).toBe(false);
    expect(searchedText(input?.query["hostIpAddresses"])).toBe("35.205.11.131");
    expect(input?.limit).toBe(PROTECTED_ADDRESS_ROWS_PER_SOURCE + 1);
  });

  test("a host with no name is named by its identifier", async () => {
    const unnamed: Host = host({
      identifier: "ip-10-0-4-12.internal",
      addresses: "35.205.11.131",
    });
    install({ hosts: [unnamed] });

    expect((await find("35.205.11.131")).protection?.name).toBe(
      "ip-10-0-4-12.internal",
    );
  });

  test("text that only looks alike is read, and dropped", async () => {
    const reads: Reads = install({
      hosts: [host({ name: "web-9", addresses: "135.205.11.131" })],
    });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: null,
      unreadSources: [],
    });
    expect(reads.hosts).toHaveBeenCalled();
  });

  test("a Kubernetes node, by its InternalIP and ExternalIP", async () => {
    const nodeA: KubernetesResource = node("node-a", [
      { type: "InternalIP", address: "10.1.0.5" },
      { type: "ExternalIP", address: "35.205.11.131" },
    ]);
    const reads: Reads = install({ nodes: [nodeA] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.KubernetesNode,
        protectedValue: "35.205.11.131",
        name: "node-a",
        recordId: idOf(nodeA),
      },
      unreadSources: [],
    });
    expect(inputsOf(reads.nodes)[0]?.query["kind"]).toBe("Node");
  });

  test("a cloud resource's endpoint, named by its kind and its account", async () => {
    const instance: CloudResource = cloudResource({
      name: "i-0abc",
      type: "AWS::EC2::Instance",
      endpoints: ["ec2-35-205-11-131.compute-1.amazonaws.com", "35.205.11.131"],
      account: "Production",
    });
    install({ cloudResources: [instance] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.CloudResource,
        protectedValue: "35.205.11.131",
        name: "i-0abc",
        recordId: idOf(instance),
        kind: "EC2 Instance",
        where: "Production",
      },
      unreadSources: [],
    });
  });

  test("an Elastic IP of the account's, named by its kind and its account (#10504)", async () => {
    const elasticIp: CloudResource = cloudResource({
      name: "eipalloc-0web",
      type: "AWS::EC2::EIP",
      endpoints: ["52.18.1.9"],
      properties: { PublicIp: "52.18.1.9", AllocationId: "eipalloc-0web" },
      account: "Production",
    });
    install({ cloudResources: [elasticIp] });

    const check: SecurityProtectionCheck = await find("52.18.1.9");

    expect(check).toEqual({
      protection: {
        source: SecurityProtectedAddressSource.CloudResource,
        protectedValue: "52.18.1.9",
        name: "eipalloc-0web",
        recordId: idOf(elasticIp),
        kind: "Elastic IP",
        where: "Production",
      },
      unreadSources: [],
    });
    expect(
      describeSecurityAddressProtection({
        value: "52.18.1.9",
        protection: check.protection!,
      }),
    ).toBe(
      "52.18.1.9 is the address of Elastic IP eipalloc-0web in Production.",
    );
  });

  test("a NAT gateway's public address - every private subnet's traffic leaves from it - and a range that holds it (#10504)", async () => {
    const nat: CloudResource = cloudResource({
      name: "nat-0aaa",
      type: "AWS::EC2::NatGateway",
      endpoints: ["34.240.10.20", "34.240.10.21"],
      properties: {
        ConnectivityType: "public",
        AllocationId: "eipalloc-0nat",
        PublicIps: ["34.240.10.20", "34.240.10.21"],
      },
      account: "Production",
    });
    install({ cloudResources: [nat] });

    const secondary: SecurityProtectionCheck = await find("34.240.10.21");

    expect(secondary.protection).toEqual({
      source: SecurityProtectedAddressSource.CloudResource,
      protectedValue: "34.240.10.21",
      name: "nat-0aaa",
      recordId: idOf(nat),
      kind: "NAT Gateway",
      where: "Production",
    });
    expect(
      describeSecurityAddressProtection({
        value: "34.240.10.21",
        protection: secondary.protection!,
      }),
    ).toBe(
      "34.240.10.21 is the address of NAT Gateway nat-0aaa in Production.",
    );

    // A range that holds it is refused too, saying which address it holds.
    const range: SecurityProtectionCheck = await find("34.240.10.0/24");

    expect(range.protection?.protectedValue).toBe("34.240.10.20");
    expect(
      describeSecurityAddressProtection({
        value: "34.240.10.0/24",
        protection: range.protection!,
      }),
    ).toBe(
      "34.240.10.0/24 holds 34.240.10.20. 34.240.10.20 is the address of NAT Gateway nat-0aaa in Production.",
    );
  });

  test("a cloud resource's property, where a cloud lists an address", async () => {
    const instance: CloudResource = cloudResource({
      name: "i-0def",
      type: "AWS::EC2::Instance",
      endpoints: ["ec2-35-205-11-131.compute-1.amazonaws.com"],
      properties: {
        networkInterface: { association: { publicIp: "35.205.11.131" } },
      },
    });
    const reads: Reads = install({ cloudResources: [instance] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.CloudResource,
        protectedValue: "35.205.11.131",
        name: "i-0def",
        recordId: idOf(instance),
        kind: "EC2 Instance",
      },
      unreadSources: [],
    });

    const byProperty: FindInput | undefined = inputsOf(
      reads.cloudResources,
    ).find((input: FindInput): boolean => {
      return input.query["cloudProperties"] !== undefined;
    });

    expect(searchedText(byProperty?.query["cloudProperties"])).toBe(
      "35.205.11.131",
    );
    expect(byProperty?.query["isArchived"]).toBe(false);
  });

  test("a load balancer, by the addresses its DNS name resolves to now", async () => {
    const asked: Array<string> = [];

    SecurityProtectedAddresses.setDnsCacheForTests(
      new DnsResolutionCache({
        resolver: async (name: string): Promise<Array<string>> => {
          asked.push(name);
          return name === "prod-alb-123.us-east-1.elb.amazonaws.com"
            ? ["35.205.11.130", "35.205.11.131"]
            : [];
        },
      }),
    );

    const balancer: CloudResource = cloudResource({
      name: "prod-alb",
      type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
      endpoints: ["prod-alb-123.us-east-1.elb.amazonaws.com", "35.205.11.9"],
      account: "Production",
    });
    const reads: Reads = install({ cloudResources: [balancer] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.CloudResource,
        protectedValue: "35.205.11.131",
        name: "prod-alb",
        recordId: idOf(balancer),
        kind: "Elastic Load Balancer (ALB, NLB, GWLB)",
        where: "Production",
      },
      unreadSources: [],
    });

    // An endpoint that is an address is not looked up.
    expect(asked).toEqual(["prod-alb-123.us-east-1.elb.amazonaws.com"]);

    const balancers: FindInput | undefined = inputsOf(
      reads.cloudResources,
    ).find((input: FindInput): boolean => {
      return input.query["cloudResourceType"] !== undefined;
    });

    expect(balancers?.query["isArchived"]).toBe(false);
    expect(balancers?.limit).toBe(LOAD_BALANCERS_RESOLVED_PER_CHECK + 1);
    expect(balancers?.props).toEqual(ROOT);

    // Resolved at most every five minutes, not on every check.
    await find("35.205.11.131");
    expect(asked).toEqual(["prod-alb-123.us-east-1.elb.amazonaws.com"]);
  });

  test("a load balancer whose name could not be looked up leaves the answer open, and is asked again soon", async () => {
    let failing: boolean = true;
    const asked: Array<string> = [];
    let now: number = 0;

    SecurityProtectedAddresses.setDnsCacheForTests(
      new DnsResolutionCache({
        failureTtlInMs: DNS_FAILURE_RETRY_IN_MS,
        now: () => {
          return now;
        },
        resolver: async (name: string): Promise<Array<string>> => {
          asked.push(name);

          if (failing) {
            throw new Error(`DNS lookup for ${name} timed out`);
          }

          return ["35.205.11.131"];
        },
      }),
    );

    install({
      cloudResources: [
        cloudResource({
          name: "prod-alb",
          type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
          endpoints: ["prod-alb-123.us-east-1.elb.amazonaws.com"],
          account: "Production",
        }),
      ],
    });

    // Its addresses may be any: no block is made until the name answers.
    await expect(find("198.51.100.7")).resolves.toEqual({
      protection: null,
      unreadSources: [SecurityProtectedAddressSource.CloudResource],
    });

    // Asked again once the failure's half a minute is up, not five minutes later.
    failing = false;
    now = DNS_FAILURE_RETRY_IN_MS - 1;
    await find("198.51.100.7");
    expect(asked).toHaveLength(1);

    now = DNS_FAILURE_RETRY_IN_MS;
    await expect(find("198.51.100.7")).resolves.toEqual({
      protection: null,
      unreadSources: [],
    });
    expect(asked).toHaveLength(2);
  });

  test("a load balancer whose name exists nowhere protects nothing, and leaves the answer whole", async () => {
    SecurityProtectedAddresses.setDnsCacheForTests(
      new DnsResolutionCache({
        resolver: async (name: string): Promise<Array<string>> => {
          throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), {
            code: "ENOTFOUND",
          });
        },
      }),
    );

    install({
      cloudResources: [
        cloudResource({
          name: "deleted-alb",
          type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
          endpoints: ["deleted-alb-9.us-east-1.elb.amazonaws.com"],
          account: "Production",
        }),
      ],
    });

    await expect(find("198.51.100.7")).resolves.toEqual({
      protection: null,
      unreadSources: [],
    });
  });

  test("a network device, by the address it is polled at or one of its Other Addresses", async () => {
    const core: NetworkDevice = device({
      name: "core-sw-1",
      hostname: "35.205.11.131",
    });
    install({ devices: [core] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.NetworkDevice,
        protectedValue: "35.205.11.131",
        name: "core-sw-1",
        recordId: idOf(core),
      },
      unreadSources: [],
    });

    const firewall: NetworkDevice = device({
      name: "edge-fw",
      hostname: "fw.example.com",
      otherAddresses: "10.0.0.1, 35.205.11.131",
    });
    install({ devices: [firewall] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.NetworkDevice,
        protectedValue: "35.205.11.131",
        name: "edge-fw",
        recordId: idOf(firewall),
      },
      unreadSources: [],
    });
  });

  test("a network endpoint, by its address, named by its host name or else its address", async () => {
    const printer: NetworkEndpoint = endpoint({
      hostname: "printer-2",
      ipAddress: "35.205.11.131",
    });
    install({ endpoints: [printer] });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.NetworkEndpoint,
        protectedValue: "35.205.11.131",
        name: "printer-2",
        recordId: idOf(printer),
      },
      unreadSources: [],
    });

    install({ endpoints: [endpoint({ ipAddress: "35.205.11.131" })] });

    expect((await find("35.205.11.131")).protection?.name).toBe(
      "35.205.11.131",
    );
  });

  test("the edge in front of the app, while the project has connected one", async () => {
    const reads: Reads = install({ edges: [CLOUDFLARE_EDGE] });

    await expect(find("104.16.0.1")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.Edge,
        protectedValue: "104.16.0.0/13",
        name: "Cloudflare",
      },
      unreadSources: [],
    });
    expect(reads.edges).toHaveBeenCalledWith(PROJECT_ID);

    install({});

    await expect(find("104.16.0.1")).resolves.toEqual({
      protection: null,
      unreadSources: [],
    });
  });

  test("the project's own list answers first, and no source after it is read", async () => {
    const office: SecurityProtectedEntity = protectedEntry(
      "35.205.11.131",
      "Office",
    );
    const reads: Reads = install({
      protectedEntities: [office],
      hosts: [host({ name: "web-3", addresses: "35.205.11.131" })],
    });

    expect((await find("35.205.11.131")).protection?.source).toBe(
      SecurityProtectedAddressSource.ProtectedEntity,
    );
    expect(reads.probes).not.toHaveBeenCalled();
    expect(reads.hosts).not.toHaveBeenCalled();
  });

  test("every source is read as OneUptime, whoever asks", async () => {
    const reads: Reads = install({});

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: null,
      unreadSources: [],
    });

    for (const spy of [
      reads.protectedEntities,
      reads.probes,
      reads.addressNames,
      reads.hosts,
      reads.nodes,
      reads.cloudResources,
      reads.devices,
      reads.endpoints,
    ]) {
      expect(spy).toHaveBeenCalled();

      for (const input of inputsOf(spy)) {
        expect(input.props).toEqual(ROOT);
      }
    }

    expect(reads.edges).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("a source that cannot be read leaves the answer open, and the rest are still read", async () => {
    const reads: Reads = install({});
    reads.hosts.mockRejectedValue(new Error("connection refused"));

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: null,
      unreadSources: [SecurityProtectedAddressSource.Host],
    });
    expect(reads.endpoints).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not read the project's Host addresses for 35.205.11.131",
      ),
    );
  });

  test("a protection found after a source that could not be read still answers", async () => {
    const printer: NetworkEndpoint = endpoint({
      hostname: "printer-2",
      ipAddress: "35.205.11.131",
    });
    const reads: Reads = install({ endpoints: [printer] });
    reads.hosts.mockRejectedValue(new Error("connection refused"));

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: {
        source: SecurityProtectedAddressSource.NetworkEndpoint,
        protectedValue: "35.205.11.131",
        name: "printer-2",
        recordId: idOf(printer),
      },
      unreadSources: [],
    });
  });

  test("a source read twice that fails both times is named once", async () => {
    const reads: Reads = install({});
    reads.cloudResources.mockRejectedValue(new Error("timed out"));

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: null,
      unreadSources: [SecurityProtectedAddressSource.CloudResource],
    });
  });

  test("a source with more matches than one read takes leaves the answer open", async () => {
    const lookalikes: Array<Host> = Array.from(
      { length: PROTECTED_ADDRESS_ROWS_PER_SOURCE + 1 },
      (_: unknown, index: number): Host => {
        return host({ name: `web-${index}`, addresses: "135.205.11.131" });
      },
    );

    install({ hosts: lookalikes });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: null,
      unreadSources: [SecurityProtectedAddressSource.Host],
    });

    // As many as one read takes is all of them.
    install({ hosts: lookalikes.slice(0, PROTECTED_ADDRESS_ROWS_PER_SOURCE) });

    await expect(find("35.205.11.131")).resolves.toEqual({
      protection: null,
      unreadSources: [],
    });
  });
});

describe("SecurityProtectedAddresses.listAutomaticProtections", () => {
  test("lists what each source protects, in the order the page shows them", async () => {
    setCloudSetting("198.51.100.20");

    const own: Probe = probe({
      name: "Office probe",
      address: "35.205.11.180",
    });
    const usEast: Probe = probe({
      name: "US East",
      address: "34.1.2.3",
      isGlobal: true,
    });
    const nat: NetworkAddressName = addressName(
      "Office NAT",
      "35.205.11.128/27",
    );
    const web: Host = host({
      name: "web-3",
      addresses: "10.0.4.12, 35.205.11.131",
    });
    const nodeA: KubernetesResource = node("node-a", [
      { type: "InternalIP", address: "10.1.0.5" },
      { type: "Hostname", address: "node-a" },
    ]);
    const instance: CloudResource = cloudResource({
      name: "i-0abc",
      type: "AWS::EC2::Instance",
      endpoints: ["35.205.11.140"],
      account: "Production",
    });
    const core: NetworkDevice = device({
      name: "core-sw-1",
      hostname: "10.0.0.1",
      otherAddresses: "10.0.0.2 10.0.0.3",
    });
    const printer: NetworkEndpoint = endpoint({
      hostname: "printer-2",
      ipAddress: "10.0.9.20",
    });

    install({
      probes: [own, usEast],
      addressNames: [nat],
      hosts: [web],
      nodes: [nodeA],
      cloudResources: [instance],
      devices: [core],
      endpoints: [printer],
    });

    const groups: Array<SecurityProtectedAddressGroup> = await list(
      reader([Permission.ProjectOwner]),
    );

    expect(
      groups.map(
        (
          group: SecurityProtectedAddressGroup,
        ): SecurityProtectedAddressSource => {
          return group.source;
        },
      ),
    ).toEqual([
      SecurityProtectedAddressSource.LocalRange,
      SecurityProtectedAddressSource.OneUptimeCloud,
      SecurityProtectedAddressSource.Probe,
      SecurityProtectedAddressSource.GlobalProbe,
      SecurityProtectedAddressSource.AddressName,
      SecurityProtectedAddressSource.Host,
      SecurityProtectedAddressSource.KubernetesNode,
      SecurityProtectedAddressSource.CloudResource,
      SecurityProtectedAddressSource.NetworkDevice,
      SecurityProtectedAddressSource.NetworkEndpoint,
      SecurityProtectedAddressSource.Edge,
    ]);

    for (const group of groups) {
      expect(group.isRead).toBe(true);
      expect(group.hasMore).toBe(false);
    }

    expect(
      groupOf(groups, SecurityProtectedAddressSource.LocalRange)?.protections,
    ).toEqual(
      SECURITY_LOCAL_ADDRESS_RANGES.map(
        (range: string): SecurityAddressProtection => {
          return {
            source: SecurityProtectedAddressSource.LocalRange,
            protectedValue: block(range).text,
          };
        },
      ),
    );
    expect(
      groupOf(groups, SecurityProtectedAddressSource.OneUptimeCloud)
        ?.protections,
    ).toEqual([
      {
        source: SecurityProtectedAddressSource.OneUptimeCloud,
        protectedValue: "198.51.100.20",
        name: "OneUptime Cloud",
      },
    ]);
    // The probes are read together, and listed apart: the project's, and OneUptime's.
    expect(
      groupOf(groups, SecurityProtectedAddressSource.Probe)?.protections,
    ).toEqual([
      {
        source: SecurityProtectedAddressSource.Probe,
        protectedValue: "35.205.11.180",
        name: "Office probe",
        recordId: idOf(own),
      },
    ]);
    expect(
      groupOf(groups, SecurityProtectedAddressSource.GlobalProbe)?.protections,
    ).toEqual([
      {
        source: SecurityProtectedAddressSource.GlobalProbe,
        protectedValue: "34.1.2.3",
        name: "US East",
        recordId: idOf(usEast),
      },
    ]);
    expect(
      groupOf(groups, SecurityProtectedAddressSource.AddressName)?.protections,
    ).toEqual([
      {
        source: SecurityProtectedAddressSource.AddressName,
        protectedValue: "35.205.11.128/27",
        name: "Office NAT",
        recordId: idOf(nat),
      },
    ]);
    expect(
      groupOf(groups, SecurityProtectedAddressSource.Host)?.protections,
    ).toEqual([
      {
        source: SecurityProtectedAddressSource.Host,
        protectedValue: "10.0.4.12",
        name: "web-3",
        recordId: idOf(web),
      },
      {
        source: SecurityProtectedAddressSource.Host,
        protectedValue: "35.205.11.131",
        name: "web-3",
        recordId: idOf(web),
      },
    ]);
    // A node's Hostname is no address.
    expect(
      groupOf(groups, SecurityProtectedAddressSource.KubernetesNode)
        ?.protections,
    ).toEqual([
      {
        source: SecurityProtectedAddressSource.KubernetesNode,
        protectedValue: "10.1.0.5",
        name: "node-a",
        recordId: idOf(nodeA),
      },
    ]);
    expect(
      groupOf(groups, SecurityProtectedAddressSource.CloudResource)
        ?.protections,
    ).toEqual([
      {
        source: SecurityProtectedAddressSource.CloudResource,
        protectedValue: "35.205.11.140",
        name: "i-0abc",
        recordId: idOf(instance),
        kind: "EC2 Instance",
        where: "Production",
      },
    ]);
    expect(
      groupOf(
        groups,
        SecurityProtectedAddressSource.NetworkDevice,
      )?.protections.map((protection: SecurityAddressProtection): string => {
        return protection.protectedValue;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    expect(
      groupOf(groups, SecurityProtectedAddressSource.NetworkEndpoint)
        ?.protections,
    ).toEqual([
      {
        source: SecurityProtectedAddressSource.NetworkEndpoint,
        protectedValue: "10.0.9.20",
        name: "printer-2",
        recordId: idOf(printer),
      },
    ]);
    // No edge is connected: its group is listed, empty.
    expect(
      groupOf(groups, SecurityProtectedAddressSource.Edge)?.protections,
    ).toEqual([]);
  });

  test("the project's probes and OneUptime's are each listed and counted apart", async () => {
    install({
      probes: [
        ...Array.from(
          { length: PROTECTED_ADDRESSES_LISTED_PER_SOURCE + 1 },
          (_: unknown, index: number): Probe => {
            return probe({
              name: `Office probe ${index}`,
              address: `35.205.11.${index}`,
            });
          },
        ),
        probe({ name: "US East", address: "34.1.2.3", isGlobal: true }),
      ],
    });

    const groups: Array<SecurityProtectedAddressGroup> = await list(
      reader([Permission.ProjectOwner]),
    );

    const own: SecurityProtectedAddressGroup | undefined = groupOf(
      groups,
      SecurityProtectedAddressSource.Probe,
    );
    const oneUptimes: SecurityProtectedAddressGroup | undefined = groupOf(
      groups,
      SecurityProtectedAddressSource.GlobalProbe,
    );

    expect(own?.protections).toHaveLength(
      PROTECTED_ADDRESSES_LISTED_PER_SOURCE,
    );
    expect(own?.hasMore).toBe(true);

    // However many the project has, OneUptime's own are listed too.
    expect(oneUptimes?.protections).toEqual([
      expect.objectContaining({
        source: SecurityProtectedAddressSource.GlobalProbe,
        protectedValue: "34.1.2.3",
        name: "US East",
      }),
    ]);
    expect(oneUptimes?.hasMore).toBe(false);
  });

  test("OneUptime's probes that cannot be read are listed as not read, the project's as read", async () => {
    const reads: Reads = install({
      probes: [probe({ name: "Office probe", address: "35.205.11.180" })],
    });
    const realRead: (input: unknown) => Promise<unknown> =
      reads.probes.getMockImplementation() as never;

    reads.probes.mockImplementation((async (input: unknown) => {
      if ((input as FindInput).query["isGlobalProbe"] === true) {
        throw new Error("The database is down.");
      }

      return realRead(input);
    }) as never);

    const groups: Array<SecurityProtectedAddressGroup> = await list(
      reader([Permission.ProjectOwner]),
    );

    expect(groupOf(groups, SecurityProtectedAddressSource.Probe)).toMatchObject(
      { isRead: true },
    );
    expect(
      groupOf(groups, SecurityProtectedAddressSource.Probe)?.protections,
    ).toHaveLength(1);
    expect(groupOf(groups, SecurityProtectedAddressSource.GlobalProbe)).toEqual(
      {
        source: SecurityProtectedAddressSource.GlobalProbe,
        protections: [],
        hasMore: false,
        isRead: false,
      },
    );
  });

  test("a source with more than the page lists says there is more", async () => {
    install({
      hosts: Array.from(
        { length: PROTECTED_ADDRESSES_LISTED_PER_SOURCE + 1 },
        (_: unknown, index: number): Host => {
          return host({
            name: `web-${index}`,
            addresses: `35.205.11.${index}`,
          });
        },
      ),
    });

    const more: SecurityProtectedAddressGroup | undefined = groupOf(
      await list(reader([Permission.ProjectOwner])),
      SecurityProtectedAddressSource.Host,
    );

    expect(more?.protections).toHaveLength(
      PROTECTED_ADDRESSES_LISTED_PER_SOURCE,
    );
    expect(more?.hasMore).toBe(true);
    expect(more?.isRead).toBe(true);

    // As many records as the page lists, with more addresses than it lists.
    install({
      hosts: Array.from(
        { length: PROTECTED_ADDRESSES_LISTED_PER_SOURCE },
        (_: unknown, index: number): Host => {
          return host({
            name: `web-${index}`,
            addresses: `35.205.11.${index}, 35.205.12.${index}`,
          });
        },
      ),
    });

    const addresses: SecurityProtectedAddressGroup | undefined = groupOf(
      await list(reader([Permission.ProjectOwner])),
      SecurityProtectedAddressSource.Host,
    );

    expect(addresses?.protections).toHaveLength(
      PROTECTED_ADDRESSES_LISTED_PER_SOURCE,
    );
    expect(addresses?.hasMore).toBe(true);

    // As many as the page lists is all of them.
    install({
      hosts: Array.from(
        { length: PROTECTED_ADDRESSES_LISTED_PER_SOURCE },
        (_: unknown, index: number): Host => {
          return host({
            name: `web-${index}`,
            addresses: `35.205.11.${index}`,
          });
        },
      ),
    });

    expect(
      groupOf(
        await list(reader([Permission.ProjectOwner])),
        SecurityProtectedAddressSource.Host,
      )?.hasMore,
    ).toBe(false);
  });

  test("a source the reader may not read is listed as not read, the rest as read", async () => {
    const reads: Reads = install({
      endpoints: [endpoint({ hostname: "printer-2", ipAddress: "10.0.9.20" })],
    });
    reads.hosts.mockRejectedValue(
      new Error("You do not have permissions to read Host."),
    );

    const groups: Array<SecurityProtectedAddressGroup> = await list(
      reader([Permission.SecurityViewer]),
    );

    expect(groupOf(groups, SecurityProtectedAddressSource.Host)).toEqual({
      source: SecurityProtectedAddressSource.Host,
      protections: [],
      hasMore: false,
      isRead: false,
    });
    expect(
      groupOf(groups, SecurityProtectedAddressSource.NetworkEndpoint),
    ).toMatchObject({ isRead: true, hasMore: false });
    expect(
      groupOf(groups, SecurityProtectedAddressSource.NetworkEndpoint)
        ?.protections,
    ).toHaveLength(1);
  });

  test("is read as the reader, every address and not by text - but OneUptime's probes as OneUptime", async () => {
    const props: DatabaseCommonInteractionProps = reader([
      Permission.SecurityViewer,
    ]);
    const reads: Reads = install({});

    await list(props);

    const { byCheckIn, byInterface, oneUptimes } = probeReadsOf(reads.probes);

    for (const own of [byCheckIn, byInterface]) {
      expect(own?.props).toBe(props);
      expect(own?.query["projectId"]).toEqual(PROJECT_ID);
    }

    expect(oneUptimes?.props).toEqual(ROOT);
    expect(oneUptimes?.query["isGlobalProbe"]).toBe(true);

    for (const spy of [
      reads.addressNames,
      reads.hosts,
      reads.nodes,
      reads.cloudResources,
      reads.devices,
      reads.endpoints,
    ]) {
      expect(spy).toHaveBeenCalled();

      for (const input of inputsOf(spy)) {
        expect(input.props).toBe(props);
        expect(input.limit).toBe(PROTECTED_ADDRESSES_LISTED_PER_SOURCE + 1);
      }
    }

    expect(
      searchedText(inputsOf(reads.hosts)[0]?.query["hostIpAddresses"]),
    ).toBeNull();
    expect(
      searchedText(inputsOf(reads.endpoints)[0]?.query["ipAddress"]),
    ).toBeNull();
    // Every address is read, so no range is read apart.
    expect(reads.addressNames).toHaveBeenCalledTimes(1);
    // The page lists the project's own entries itself.
    expect(reads.protectedEntities).not.toHaveBeenCalled();
  });
});

describe("SecurityProtectedAddresses.asSeenBy", () => {
  const onHost: SecurityAddressProtection = {
    source: SecurityProtectedAddressSource.Host,
    protectedValue: "35.205.11.131",
    name: "web-3",
    recordId: "77777777-7777-4777-8777-777777777777",
  };

  function seen(
    protection: SecurityAddressProtection,
    props: DatabaseCommonInteractionProps,
  ): SecurityAddressProtection {
    return SecurityProtectedAddresses.asSeenBy({
      protection,
      props,
      projectId: PROJECT_ID,
    });
  }

  test("a reader who may read the record is told which it is", () => {
    expect(seen(onHost, reader([Permission.ReadHost]))).toEqual(onHost);
    expect(seen(onHost, reader([Permission.ProjectMember]))).toEqual(onHost);
  });

  test("a reader who may not is told only that the address is the project's own", () => {
    const withheld: SecurityAddressProtection = seen(
      onHost,
      reader([Permission.SecurityViewer]),
    );

    expect(withheld).toEqual({
      source: SecurityProtectedAddressSource.Host,
      protectedValue: "35.205.11.131",
    });
    expect(
      describeSecurityAddressProtection({
        value: "35.205.11.0/24",
        protection: withheld,
      }),
    ).toBe(
      "35.205.11.0/24 holds 35.205.11.131. 35.205.11.131 is one of your project's own addresses.",
    );
  });

  test("the reader is held to the project the block is in", () => {
    expect(
      seen(onHost, reader([Permission.ReadHost], OTHER_PROJECT_ID)),
    ).toEqual({
      source: SecurityProtectedAddressSource.Host,
      protectedValue: "35.205.11.131",
    });
  });

  test("each kind of record is held to its own readers", () => {
    const office: SecurityAddressProtection = {
      source: SecurityProtectedAddressSource.ProtectedEntity,
      protectedValue: "35.205.11.128/26",
      name: "Office",
      recordId: "88888888-8888-4888-8888-888888888888",
    };

    // Every Security tier reads the Protected Entities list; not every one reads hosts.
    expect(seen(office, reader([Permission.SecurityViewer]))).toEqual(office);
    expect(seen(onHost, reader([Permission.SecurityViewer]))).not.toEqual(
      onHost,
    );
  });

  test("OneUptime and a server admin are told all", () => {
    expect(seen(onHost, ROOT)).toEqual(onHost);
    expect(seen(onHost, { isMasterAdmin: true, userId: USER_ID })).toEqual(
      onHost,
    );
  });

  test("a protection that names none of the project's records is told whole, to anyone", () => {
    for (const protection of [
      {
        source: SecurityProtectedAddressSource.LocalRange,
        protectedValue: "10.0.0.0/8",
      },
      {
        source: SecurityProtectedAddressSource.OneUptimeCloud,
        protectedValue: "198.51.100.20",
        name: "OneUptime Cloud",
      },
      {
        source: SecurityProtectedAddressSource.Edge,
        protectedValue: "104.16.0.0/13",
        name: "Cloudflare",
      },
      {
        source: SecurityProtectedAddressSource.GlobalProbe,
        protectedValue: "34.1.2.3",
        name: "US East",
        recordId: "99999999-9999-4999-8999-999999999999",
      },
    ]) {
      expect(seen(protection, reader([]))).toEqual(protection);
    }
  });
});

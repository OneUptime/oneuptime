import Entities from "../../../../Models/DatabaseModels/Index";
import Host from "../../../../Models/DatabaseModels/Host";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import HostService from "../../../../Server/Services/HostService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import NetworkAddressNamesUtil from "../../../../Server/Utils/NetworkFlow/NetworkAddressNames";
import logger from "../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  NetworkAddressNameSource,
  NetworkTrafficAddressNames,
} from "../../../../Types/NetFlow/NetworkAddressName";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * WHAT A TRAFFIC PAGE'S ADDRESSES ARE CALLED, against Postgres (issue
 * #5340). The unit suite (NetworkAddressNames) pins the reads each source
 * makes; only a real database shows what their SQL does to real rows:
 *
 *   - an Address Name for one address, and every subnet of the project (the
 *     rows with a slash), read in one go;
 *   - a device by the address it is polled at, compared without case, and
 *     by an address it lists among its Other Addresses - a value listed
 *     WHOLE ("10.0.0.1" is not in "10.0.0.10, 10.0.0.2");
 *   - a host by the addresses its agent reports, the same way;
 *   - a cloud resource by the endpoints its cloud lists (jsonb ?|);
 *   - a Kubernetes node by an InternalIP or ExternalIP entry of
 *     status.addresses, a pod by its own podIP - never one on its node's
 *     network (raw SQL over jsonb);
 *   - archived and deleted records, and another project's, name nothing;
 *   - the inventory before DNS, and DNS where the inventory has nothing;
 *   - "find an address" by every word of a name, "%" and "_" literally.
 *
 * Opt in with RUN_POSTGRES_NETWORK_ADDRESS_NAMES_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The STRUCTURE of every
 * table the names are read from is cloned into a unique schema (the
 * search_path holds only that schema, so a read of any other table fails),
 * with the NOT NULL columns a fixture does not fill relaxed, and dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from NETWORK_ADDRESS_NAMES_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from NETWORK_ADDRESS_NAMES_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_NETWORK_ADDRESS_NAMES_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "NetworkAddressName",
  "NetworkDevice",
  "Host",
  "CloudResource",
  "KubernetesResource",
];

// Columns a fixture row fills; every other NOT NULL is relaxed.
const KEPT_NOT_NULL: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "version",
  "projectId",
];

const PROJECT: ObjectID = ObjectID.generate();
const OTHER_PROJECT: ObjectID = ObjectID.generate();

const WINDOW_START: Date = new Date("2026-10-28T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-10-28T11:00:00.000Z");
const LONG_AGO: Date = new Date("2026-09-01T00:00:00.000Z");

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

describePostgres("Traffic page names against Postgres", () => {
  const schema: string = `network_address_names_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  // Each fixture row's id, by a short key.
  const ids: Record<string, string> = {};

  async function insert(
    table: string,
    key: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    const id: string = ObjectID.generate().toString();
    ids[key] = id;
    const row: Record<string, unknown> = {
      _id: id,
      version: 1,
      projectId: PROJECT.toString(),
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
      ...values,
    };
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        const value: unknown = row[column];
        // A jsonb value goes as its JSON text.
        return value !== null &&
          typeof value === "object" &&
          !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    );
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["NETWORK_ADDRESS_NAMES_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["NETWORK_ADDRESS_NAMES_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["NETWORK_ADDRESS_NAMES_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'`,
        [schema, table],
      );
      for (const column of columns) {
        if (!KEPT_NOT_NULL.includes(column.column_name)) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }
    }

    // Every unqualified read lands in the clone.
    expect(
      (await database.query("SELECT current_schema() AS name"))[0].name,
    ).toBe(schema);

    // The migration's index for the exact-address read came with the clone.
    const addressIndexes: Array<{ count: number }> = await database.query(
      `SELECT COUNT(*)::int AS "count" FROM pg_indexes
        WHERE schemaname = $1 AND tablename = 'NetworkAddressName'
          AND indexdef ILIKE '%"projectId", address%'`,
      [schema],
    );
    expect(addressIndexes[0]!.count).toBe(1);

    // Address Names: two addresses, two subnets, one of another project.
    await insert("NetworkAddressName", "payroll", {
      name: "Payroll SaaS",
      address: "158.115.141.143",
    });
    await insert("NetworkAddressName", "v6", {
      name: "Lab v6 box",
      address: "2001:db8::5",
    });
    await insert("NetworkAddressName", "mumbai", {
      name: "Mumbai office",
      address: "10.18.167.0/24",
    });
    await insert("NetworkAddressName", "corporate", {
      name: "Corporate",
      address: "10.0.0.0/8",
    });
    await insert("NetworkAddressName", "otherProject", {
      name: "Another project's name",
      address: "10.18.167.31",
      projectId: OTHER_PROJECT.toString(),
    });

    /*
     * Network devices: one polled at its address (written in capitals),
     * one sending from its Other Addresses, one listing an address that
     * only starts like another, one archived, one deleted.
     */
    await insert("NetworkDevice", "core", {
      name: "core-sw-01",
      hostname: "2001:DB8::1",
      isArchived: false,
    });
    await insert("NetworkDevice", "edge", {
      name: "edge-fw-01",
      hostname: "edge-fw-01.corp.example",
      otherAddresses: "10.255.0.1, 10.255.0.10",
      isArchived: false,
    });
    await insert("NetworkDevice", "lab", {
      name: "lab-sw-01",
      hostname: "lab-sw-01.corp.example",
      otherAddresses: "10.255.0.100",
      isArchived: false,
    });
    await insert("NetworkDevice", "archived", {
      name: "old-router",
      hostname: "10.255.0.2",
      isArchived: true,
    });
    await insert("NetworkDevice", "deleted", {
      name: "deleted-router",
      hostname: "10.255.0.3",
      isArchived: false,
      deletedAt: LONG_AGO,
    });

    /*
     * Hosts: the file server (its list with a double space), one gone
     * before the window, one listing an address that only starts like
     * another, one with an IPv6 address in capitals.
     */
    await insert("Host", "fs", {
      name: "mumbai-fs01",
      hostIdentifier: "mumbai-fs01",
      hostIpAddresses: "192.168.1.42,  10.18.167.35",
      isArchived: false,
      lastSeenAt: WINDOW_END,
    });
    await insert("Host", "gone", {
      name: "gone-host",
      hostIdentifier: "gone-host",
      hostIpAddresses: "10.18.167.50",
      isArchived: false,
      lastSeenAt: LONG_AGO,
    });
    await insert("Host", "db10", {
      name: "db-10",
      hostIdentifier: "db-10",
      hostIpAddresses: "10.9.0.10, 10.9.0.11",
      isArchived: false,
      lastSeenAt: WINDOW_END,
    });
    await insert("Host", "v6host", {
      name: "v6-host",
      hostIdentifier: "v6-host",
      hostIpAddresses: "10.7.0.5, 2001:DB8::A1",
      isArchived: false,
      lastSeenAt: WINDOW_END,
    });

    // A cloud resource, by an endpoint its cloud lists.
    await insert("CloudResource", "orders", {
      name: "orders-db-primary",
      cloudEndpoints: [
        "orders.abc123.eu-west-1.rds.amazonaws.com",
        "10.114.167.16",
      ],
      isArchived: false,
      lastSeenAt: WINDOW_END,
    });
    // One archived, one deleted: the endpoint read leaves both out.
    await insert("CloudResource", "archivedOrders", {
      name: "old-orders-db",
      cloudEndpoints: ["10.114.167.17"],
      isArchived: true,
      lastSeenAt: WINDOW_END,
    });
    await insert("CloudResource", "deletedOrders", {
      name: "deleted-orders-db",
      cloudEndpoints: ["10.114.167.18"],
      isArchived: false,
      lastSeenAt: WINDOW_END,
      deletedAt: LONG_AGO,
    });

    // Kubernetes: a node, a pod, a pod on its node's network.
    await insert("KubernetesResource", "node", {
      kind: "Node",
      name: "node-a",
      status: {
        addresses: [
          { type: "InternalIP", address: "10.34.167.20" },
          { type: "Hostname", address: "10.34.167.21" },
        ],
      },
      lastSeenAt: WINDOW_END,
    });
    await insert("KubernetesResource", "pod", {
      kind: "Pod",
      name: "checkout-api-7f9c6d-xkz2p",
      status: { podIP: "10.242.167.220", hostIP: "10.34.167.20" },
      lastSeenAt: WINDOW_END,
    });
    await insert("KubernetesResource", "hostNetworkPod", {
      kind: "Pod",
      name: "kube-proxy-x2",
      status: { podIP: "10.34.167.22", hostIP: "10.34.167.22" },
      lastSeenAt: WINDOW_END,
    });
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    // A source that fails is left out quietly in production; here it fails.
    jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
      throw new Error(`A source could not be read: ${String(message)}`);
    });
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
      props: ROOT,
    });
  }

  async function find(text: string): Promise<Array<string>> {
    return NetworkAddressNamesUtil.findAddressesByName({
      projectId: PROJECT,
      text: text,
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      props: ROOT,
    });
  }

  function idsOf(rows: Array<Host | NetworkDevice>): Array<string> {
    return rows
      .map((row: Host | NetworkDevice): string => {
        return row.id!.toString();
      })
      .sort();
  }

  test("an Address Name, and the narrowest named subnet beside it", async () => {
    const names: NetworkTrafficAddressNames = await resolve([
      "158.115.141.143",
      "2001:db8::5",
      "10.18.167.36",
      "10.99.0.1",
    ]);

    expect(names).toEqual({
      "158.115.141.143": {
        name: "Payroll SaaS",
        source: NetworkAddressNameSource.AddressName,
        resourceId: ids["payroll"],
      },
      "2001:db8::5": {
        name: "Lab v6 box",
        source: NetworkAddressNameSource.AddressName,
        resourceId: ids["v6"],
      },
      "10.18.167.36": {
        subnetName: "Mumbai office",
        subnet: "10.18.167.0/24",
      },
      "10.99.0.1": {
        subnetName: "Corporate",
        subnet: "10.0.0.0/8",
      },
    });
  });

  test("another project's Address Name names nothing here", async () => {
    const names: NetworkTrafficAddressNames = await resolve(["10.18.167.31"]);

    // Only this project's subnet says where it is.
    expect(names["10.18.167.31"]).toEqual({
      subnetName: "Mumbai office",
      subnet: "10.18.167.0/24",
    });
  });

  test("a device polled at the address, whatever its case, and one listing it whole among its Other Addresses", async () => {
    const names: NetworkTrafficAddressNames = await resolve([
      "2001:db8::1",
      "10.255.0.1",
      "10.255.0.10",
    ]);

    expect(names["2001:db8::1"]).toEqual({
      name: "core-sw-01",
      source: NetworkAddressNameSource.NetworkDevice,
      resourceId: ids["core"],
    });
    expect(names["10.255.0.1"]).toEqual({
      name: "edge-fw-01",
      source: NetworkAddressNameSource.NetworkDevice,
      resourceId: ids["edge"],
      subnetName: "Corporate",
      subnet: "10.0.0.0/8",
    });
    // Not lab-sw-01, whose "10.255.0.100" only starts like it.
    expect(names["10.255.0.10"]?.name).toBe("edge-fw-01");
  });

  test("a device's Other Addresses are read whole in the SQL itself", async () => {
    const listing: (address: string) => Promise<Array<string>> = async (
      address: string,
    ): Promise<Array<string>> => {
      return idsOf(
        await NetworkDeviceService.findBy({
          query: {
            projectId: PROJECT,
            otherAddresses: QueryHelper.listsAnyOf([address]),
          },
          select: { _id: true },
          limit: 10,
          skip: 0,
          props: ROOT,
        }),
      );
    };

    expect(await listing("10.255.0.10")).toEqual([ids["edge"]]);
    expect(await listing("10.255.0.100")).toEqual([ids["lab"]]);
    expect(await listing("10.255.0.1")).toEqual([ids["edge"]]);
    expect(await listing("10.255.0")).toEqual([]);
  });

  test("archived and deleted devices name nothing", async () => {
    const names: NetworkTrafficAddressNames = await resolve([
      "10.255.0.2",
      "10.255.0.3",
    ]);

    expect(names["10.255.0.2"]?.name).toBeUndefined();
    expect(names["10.255.0.3"]?.name).toBeUndefined();
  });

  test("a host by an address its agent reports - whole, never by its start", async () => {
    const names: NetworkTrafficAddressNames = await resolve([
      "10.18.167.35",
      "10.9.0.1",
      "10.9.0.11",
      "2001:db8::a1",
    ]);

    expect(names["10.18.167.35"]).toEqual({
      name: "mumbai-fs01",
      source: NetworkAddressNameSource.Host,
      resourceId: ids["fs"],
      subnetName: "Mumbai office",
      subnet: "10.18.167.0/24",
    });
    // 10.9.0.1 is not in "10.9.0.10, 10.9.0.11".
    expect(names["10.9.0.1"]?.name).toBeUndefined();
    expect(names["10.9.0.11"]?.name).toBe("db-10");
    expect(names["2001:db8::a1"]?.name).toBe("v6-host");
  });

  test("a host's addresses are read whole, without case or spaces, in the SQL itself", async () => {
    const listing: (address: string) => Promise<Array<string>> = async (
      address: string,
    ): Promise<Array<string>> => {
      return idsOf(
        await HostService.findBy({
          query: {
            projectId: PROJECT,
            hostIpAddresses: QueryHelper.listsAnyOf([address]),
          },
          select: { _id: true },
          limit: 10,
          skip: 0,
          props: ROOT,
        }),
      );
    };

    expect(await listing("10.9.0.1")).toEqual([]);
    expect(await listing("10.9.0.11")).toEqual([ids["db10"]]);
    expect(await listing("10.18.167.35")).toEqual([ids["fs"]]);
    expect(await listing("192.168.1.42")).toEqual([ids["fs"]]);
    expect(await listing("2001:db8::a1")).toEqual([ids["v6host"]]);
  });

  test("a host not seen since well before the window names none of it", async () => {
    const names: NetworkTrafficAddressNames = await resolve(["10.18.167.50"]);

    expect(names["10.18.167.50"]?.name).toBeUndefined();
  });

  test("a cloud resource by an endpoint its cloud lists", async () => {
    const names: NetworkTrafficAddressNames = await resolve(["10.114.167.16"]);

    expect(names["10.114.167.16"]).toEqual({
      name: "orders-db-primary",
      source: NetworkAddressNameSource.CloudResource,
      resourceId: ids["orders"],
      subnetName: "Corporate",
      subnet: "10.0.0.0/8",
    });
  });

  test("archived and deleted cloud resources name nothing", async () => {
    const names: NetworkTrafficAddressNames = await resolve([
      "10.114.167.17",
      "10.114.167.18",
    ]);

    expect(names["10.114.167.17"]?.name).toBeUndefined();
    expect(names["10.114.167.18"]?.name).toBeUndefined();
  });

  test("a node by an InternalIP, a pod by its own address - never one on its node's network", async () => {
    const names: NetworkTrafficAddressNames = await resolve([
      "10.34.167.20",
      "10.34.167.21",
      "10.242.167.220",
      "10.34.167.22",
    ]);

    expect(names["10.34.167.20"]).toMatchObject({
      name: "node-a",
      source: NetworkAddressNameSource.KubernetesNode,
    });
    // A Hostname entry is no address of the node's.
    expect(names["10.34.167.21"]?.name).toBeUndefined();
    expect(names["10.242.167.220"]).toMatchObject({
      name: "checkout-api-7f9c6d-xkz2p",
      source: NetworkAddressNameSource.KubernetesPod,
    });
    expect(names["10.34.167.22"]?.name).toBeUndefined();
  });

  test("the inventory before DNS, and DNS where the inventory has nothing", async () => {
    const names: NetworkTrafficAddressNames = await resolve(
      ["10.18.167.35", "10.18.167.60"],
      new Map([
        ["10.18.167.35", "fs01.corp.example"],
        ["10.18.167.60", "printer.corp.example"],
      ]),
    );

    expect(names["10.18.167.35"]?.name).toBe("mumbai-fs01");
    expect(names["10.18.167.60"]).toEqual({
      name: "printer.corp.example",
      source: NetworkAddressNameSource.Dns,
      subnetName: "Mumbai office",
      subnet: "10.18.167.0/24",
    });
  });

  test("find an address by every word of a name, from every source", async () => {
    expect(await find("payroll")).toEqual(["158.115.141.143"]);
    expect(await find("FS01 mumbai")).toEqual(["192.168.1.42", "10.18.167.35"]);
    expect(await find("orders primary")).toEqual(["10.114.167.16"]);
    expect(await find("checkout")).toEqual(["10.242.167.220"]);
    expect(await find("core-sw")).toEqual(["2001:db8::1"]);
    expect(await find("node-a")).toEqual(["10.34.167.20"]);
  });

  test("find: a subnet's name finds no address, '%' and '_' are themselves, and what was gone is not found", async () => {
    expect(await find("Mumbai office")).toEqual([]);
    expect(await find("%")).toEqual([]);
    expect(await find("db_10")).toEqual([]);
    expect(await find("gone-host")).toEqual([]);
    expect(await find("old-router")).toEqual([]);
    expect(await find("another project")).toEqual([]);
  });
});

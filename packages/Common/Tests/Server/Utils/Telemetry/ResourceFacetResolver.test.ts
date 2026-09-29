import ResourceFacetResolver, {
  RESOURCE_FACET_KEYS,
  ResolvedFacetValue,
  ResourceFacetEntity,
} from "../../../../Server/Utils/Telemetry/ResourceFacetResolver";
import ServiceService from "../../../../Server/Services/ServiceService";
import HostService from "../../../../Server/Services/HostService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import ServerlessFunctionService from "../../../../Server/Services/ServerlessFunctionService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import RumApplicationService from "../../../../Server/Services/RumApplicationService";
import DockerSwarmClusterService from "../../../../Server/Services/DockerSwarmClusterService";
import ProxmoxClusterService from "../../../../Server/Services/ProxmoxClusterService";
import VMwareVCenterService from "../../../../Server/Services/VMwareVCenterService";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import IoTFleetService from "../../../../Server/Services/IoTFleetService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import { RESOURCE_FACET_CATALOG_KEYS } from "../../../../Types/Telemetry/ResourceFacetCatalog";
import { SERVICE_FACET_KEYS } from "../../../../Types/Telemetry/ResourceEntityFacet";
import ObjectID from "../../../../Types/ObjectID";
import Search from "../../../../Types/BaseDatabase/Search";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { JSONObject } from "../../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The resolver answers the telemetry filter sidebar's resource facets from
 * Postgres instead of the sampled ClickHouse window. These tests pin the
 * facet-key routing, the per-type display-name fallbacks and search fields,
 * the count merge and ordering, and the per-facet failure isolation. Every
 * service is mocked — nothing touches a database.
 */

type Row = JSONObject;

interface FindByArgs {
  query: Record<string, unknown>;
  select: Record<string, boolean>;
  limit: PositiveNumber;
  skip: PositiveNumber;
  props: { isRoot: boolean };
}

type FindBySpy = ReturnType<typeof jest.spyOn>;

const PROJECT_ID: ObjectID = ObjectID.generate();

const SERVICES: Array<{
  name: string;
  service: { findBy: (...args: Array<any>) => Promise<any> };
  facetKeys: Array<string>;
  identifierField: string | null;
}> = [
  {
    name: "Service",
    service: ServiceService as any,
    facetKeys: ["primaryEntityId", "serviceId"],
    identifierField: null,
  },
  {
    name: "Host",
    service: HostService as any,
    facetKeys: ["hostId"],
    identifierField: "hostIdentifier",
  },
  {
    name: "DockerHost",
    service: DockerHostService as any,
    facetKeys: ["dockerHostId"],
    identifierField: "hostIdentifier",
  },
  {
    name: "PodmanHost",
    service: PodmanHostService as any,
    facetKeys: ["podmanHostId"],
    identifierField: "hostIdentifier",
  },
  {
    name: "KubernetesCluster",
    service: KubernetesClusterService as any,
    facetKeys: ["kubernetesClusterId"],
    identifierField: "clusterIdentifier",
  },
  {
    name: "ServerlessFunction",
    service: ServerlessFunctionService as any,
    facetKeys: ["serverlessFunctionId"],
    identifierField: "functionIdentifier",
  },
  {
    name: "CloudResource",
    service: CloudResourceService as any,
    facetKeys: ["cloudResourceId"],
    identifierField: "resourceIdentifier",
  },
  {
    name: "RumApplication",
    service: RumApplicationService as any,
    facetKeys: ["rumApplicationId"],
    identifierField: "appIdentifier",
  },
  /*
   * Docker Swarm and Ceph join on `name` at ingest but carry a stable
   * descriptive id (`swarmId` / `fsid`) that is searched too.
   */
  {
    name: "DockerSwarmCluster",
    service: DockerSwarmClusterService as any,
    facetKeys: ["dockerSwarmClusterId"],
    identifierField: "swarmId",
  },
  {
    name: "CephCluster",
    service: CephClusterService as any,
    facetKeys: ["cephClusterId"],
    identifierField: "fsid",
  },
  // `name` IS the ingest join key — no second column to search.
  {
    name: "ProxmoxCluster",
    service: ProxmoxClusterService as any,
    facetKeys: ["proxmoxClusterId"],
    identifierField: null,
  },
  {
    name: "VMwareVCenter",
    service: VMwareVCenterService as any,
    facetKeys: ["vmwareVCenterId"],
    identifierField: null,
  },
  {
    name: "IoTFleet",
    service: IoTFleetService as any,
    facetKeys: ["iotFleetId"],
    identifierField: null,
  },
  /*
   * A database's name is a display name ("PostgreSQL db.prod:5432"); its
   * stable identifier is searched too.
   */
  {
    name: "DatabaseServer",
    service: DatabaseServerService as any,
    facetKeys: ["databaseServerId"],
    identifierField: "databaseIdentifier",
  },
];

const spies: Map<string, FindBySpy> = new Map<string, FindBySpy>();
const rowsByService: Map<string, Array<Row>> = new Map<string, Array<Row>>();

function spyFor(name: string): FindBySpy {
  return spies.get(name)!;
}

function lastArgs(name: string): FindByArgs {
  const calls: Array<Array<unknown>> = spyFor(name).mock.calls as Array<
    Array<unknown>
  >;
  return calls[calls.length - 1]![0] as FindByArgs;
}

beforeEach(() => {
  spies.clear();
  rowsByService.clear();

  for (const entry of SERVICES) {
    rowsByService.set(entry.name, []);
    const spy: FindBySpy = jest
      .spyOn(entry.service, "findBy")
      .mockImplementation(async (): Promise<any> => {
        return rowsByService.get(entry.name);
      });
    spies.set(entry.name, spy);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ResourceFacetResolver.isResourceFacet", () => {
  test.each([
    "primaryEntityId",
    "serviceId",
    "hostId",
    "dockerHostId",
    "podmanHostId",
    "kubernetesClusterId",
    "serverlessFunctionId",
    "cloudResourceId",
    "rumApplicationId",
    "dockerSwarmClusterId",
    "proxmoxClusterId",
    "vmwareVCenterId",
    "cephClusterId",
    "iotFleetId",
    "databaseServerId",
  ])("%s is a resource facet", (facetKey: string) => {
    expect(ResourceFacetResolver.isResourceFacet(facetKey)).toBe(true);
  });

  test.each([
    "",
    "traceId",
    "severityText",
    "HostId",
    "hostid",
    " hostId",
    "resource.host.name",
    "constructor",
    "__proto__",
    "iotDeviceId",
    "statusCode",
    "databaseId",
    "databaseServerIdentifier",
  ])("%j is not a resource facet", (facetKey: string) => {
    expect(ResourceFacetResolver.isResourceFacet(facetKey)).toBe(false);
  });

  test("the exported key set is the Services facet plus every catalog resource type", () => {
    expect([...RESOURCE_FACET_KEYS]).toEqual([
      ...SERVICE_FACET_KEYS,
      ...RESOURCE_FACET_CATALOG_KEYS,
    ]);
  });

  test.each([...RESOURCE_FACET_CATALOG_KEYS])(
    "catalog key %s is a resource facet",
    (facetKey: string) => {
      expect(ResourceFacetResolver.isResourceFacet(facetKey)).toBe(true);
    },
  );

  test("the exported key set has exactly the fifteen supported keys, each routed to a service", () => {
    expect(RESOURCE_FACET_KEYS.size).toBe(15);
    const routed: Array<string> = SERVICES.flatMap(
      (entry: { facetKeys: Array<string> }) => {
        return entry.facetKeys;
      },
    );
    expect([...RESOURCE_FACET_KEYS].sort()).toEqual([...routed].sort());
  });
});

describe("ResourceFacetResolver.resolve routing", () => {
  for (const entry of SERVICES) {
    for (const facetKey of entry.facetKeys) {
      test(`${facetKey} queries only the ${entry.name} service`, async () => {
        const id: string = ObjectID.generate().toString();
        rowsByService.set(entry.name, [{ _id: id, name: "row" }]);

        const result: Record<
          string,
          Array<ResolvedFacetValue>
        > = await ResourceFacetResolver.resolve(PROJECT_ID, [
          { facetKey, counts: new Map<string, number>([[id, 4]]) },
        ]);

        expect(result).toEqual({
          [facetKey]: [{ value: id, count: 4, displayName: "row" }],
        });

        for (const other of SERVICES) {
          if (other.name === entry.name) {
            expect(spyFor(other.name)).toHaveBeenCalledTimes(1);
          } else {
            expect(spyFor(other.name)).not.toHaveBeenCalled();
          }
        }
      });
    }
  }

  test("an unknown facet key resolves to an empty list without any query", async () => {
    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "severityText", counts: new Map<string, number>() },
    ]);

    expect(result).toEqual({ severityText: [] });
    for (const entry of SERVICES) {
      expect(spyFor(entry.name)).not.toHaveBeenCalled();
    }
  });

  test("no specs resolves to an empty object", async () => {
    await expect(
      ResourceFacetResolver.resolve(PROJECT_ID, []),
    ).resolves.toEqual({});
  });

  test("resolves several facets in one call, keyed by facet", async () => {
    const serviceId: string = ObjectID.generate().toString();
    const hostId: string = ObjectID.generate().toString();
    rowsByService.set("Service", [{ _id: serviceId, name: "api" }]);
    rowsByService.set("Host", [{ _id: hostId, name: "web-1" }]);

    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "primaryEntityId", counts: new Map<string, number>() },
      { facetKey: "hostId", counts: new Map<string, number>([[hostId, 2]]) },
    ]);

    expect(Object.keys(result).sort()).toEqual(["hostId", "primaryEntityId"]);
    expect(result["primaryEntityId"]).toEqual([
      { value: serviceId, count: 0, displayName: "api" },
    ]);
    expect(result["hostId"]).toEqual([
      { value: hostId, count: 2, displayName: "web-1" },
    ]);
  });

  test("a failing facet resolves to [] without failing its siblings", async () => {
    const hostId: string = ObjectID.generate().toString();
    rowsByService.set("Host", [{ _id: hostId, name: "web-1" }]);
    spyFor("Service").mockImplementation(async (): Promise<any> => {
      throw new Error("postgres down");
    });

    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "serviceId", counts: new Map<string, number>() },
      { facetKey: "hostId", counts: new Map<string, number>() },
    ]);

    expect(result["serviceId"]).toEqual([]);
    expect(result["hostId"]).toEqual([
      { value: hostId, count: 0, displayName: "web-1" },
    ]);
  });
});

describe("ResourceFacetResolver.resolve query shape", () => {
  test("scopes to the project, selects id + name, uses root props and skip 0", async () => {
    await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "serviceId", counts: new Map<string, number>() },
    ]);

    const args: FindByArgs = lastArgs("Service");
    expect(args.query).toEqual({ projectId: PROJECT_ID });
    expect(args.select).toEqual({ _id: true, name: true });
    expect(args.props).toEqual({ isRoot: true });
    expect(args.skip.toNumber()).toBe(0);
  });

  test("defaults the limit to 500", async () => {
    await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "hostId", counts: new Map<string, number>() },
    ]);

    expect(lastArgs("Host").limit.toNumber()).toBe(500);
  });

  test("honours an explicit limit", async () => {
    await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "hostId", counts: new Map<string, number>(), limit: 25 },
    ]);

    expect(lastArgs("Host").limit.toNumber()).toBe(25);
  });

  test("services search by name with a trimmed plain Search", async () => {
    await ResourceFacetResolver.resolve(PROJECT_ID, [
      {
        facetKey: "primaryEntityId",
        counts: new Map<string, number>(),
        searchText: "  checkout  ",
      },
    ]);

    const name: unknown = lastArgs("Service").query["name"];
    expect(name).toBeInstanceOf(Search);
    expect((name as Search<string>).value).toBe("checkout");
  });

  for (const entry of SERVICES) {
    if (!entry.identifierField) {
      continue;
    }

    const identifierField: string = entry.identifierField;

    test(`${entry.name} searches name and ${identifierField}, and selects both`, async () => {
      await ResourceFacetResolver.resolve(PROJECT_ID, [
        {
          facetKey: entry.facetKeys[0]!,
          counts: new Map<string, number>(),
          searchText: " prod ",
        },
      ]);

      const args: FindByArgs = lastArgs(entry.name);
      const name: unknown = args.query["name"];
      expect(name).toBeInstanceOf(MultiSearch);
      expect((name as MultiSearch).fields).toEqual(["name", identifierField]);
      expect((name as MultiSearch).value).toBe("prod");
      expect(args.query["projectId"]).toBe(PROJECT_ID);
      expect(args.select).toEqual({
        _id: true,
        name: true,
        [identifierField]: true,
      });
    });
  }

  test.each([undefined, "", "   ", "\t\n"])(
    "search text %j adds no name filter",
    async (searchText: string | undefined) => {
      await ResourceFacetResolver.resolve(PROJECT_ID, [
        {
          facetKey: "kubernetesClusterId",
          counts: new Map<string, number>(),
          searchText,
        },
      ]);

      expect(lastArgs("KubernetesCluster").query).toEqual({
        projectId: PROJECT_ID,
      });
    },
  );
});

describe("ResourceFacetResolver.resolve display names", () => {
  test("a service without a name is shown as Unknown", async () => {
    const id: string = ObjectID.generate().toString();
    rowsByService.set("Service", [{ _id: id }]);

    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "serviceId", counts: new Map<string, number>() },
    ]);

    expect(result["serviceId"]![0]!.displayName).toBe("Unknown");
  });

  for (const entry of SERVICES) {
    if (!entry.identifierField) {
      continue;
    }

    const identifierField: string = entry.identifierField;
    const facetKey: string = entry.facetKeys[0]!;

    test(`${entry.name} prefers name, then ${identifierField}, then Unknown`, async () => {
      const named: string = ObjectID.generate().toString();
      const identified: string = ObjectID.generate().toString();
      const anonymous: string = ObjectID.generate().toString();

      rowsByService.set(entry.name, [
        { _id: named, name: "B-named", [identifierField]: "ignored" },
        { _id: identified, name: "", [identifierField]: "A-identifier" },
        { _id: anonymous },
      ]);

      const result: Record<
        string,
        Array<ResolvedFacetValue>
      > = await ResourceFacetResolver.resolve(PROJECT_ID, [
        { facetKey, counts: new Map<string, number>() },
      ]);

      const byId: Map<string, string> = new Map<string, string>(
        result[facetKey]!.map((v: ResolvedFacetValue): [string, string] => {
          return [v.value, v.displayName];
        }),
      );

      expect(byId.get(named)).toBe("B-named");
      expect(byId.get(identified)).toBe("A-identifier");
      expect(byId.get(anonymous)).toBe("Unknown");
    });
  }
});

describe("ResourceFacetResolver name-only resource types", () => {
  const NAME_ONLY: Array<{ name: string; facetKey: string }> = SERVICES.filter(
    (entry: { name: string; identifierField: string | null }): boolean => {
      return entry.identifierField === null && entry.name !== "Service";
    },
  ).map(
    (entry: {
      name: string;
      facetKeys: Array<string>;
    }): { name: string; facetKey: string } => {
      return { name: entry.name, facetKey: entry.facetKeys[0]! };
    },
  );

  test("covers Proxmox, vCenter and IoT fleet", () => {
    expect(
      NAME_ONLY.map((entry: { name: string }): string => {
        return entry.name;
      }).sort(),
    ).toEqual(["IoTFleet", "ProxmoxCluster", "VMwareVCenter"]);
  });

  for (const entry of NAME_ONLY) {
    test(`${entry.name} searches name alone with a trimmed plain Search and selects id + name`, async () => {
      await ResourceFacetResolver.resolve(PROJECT_ID, [
        {
          facetKey: entry.facetKey,
          counts: new Map<string, number>(),
          searchText: "  prod-eu ",
        },
      ]);

      const args: FindByArgs = lastArgs(entry.name);
      const name: unknown = args.query["name"];
      expect(name).toBeInstanceOf(Search);
      expect(name).not.toBeInstanceOf(MultiSearch);
      expect((name as Search<string>).value).toBe("prod-eu");
      expect(args.query["projectId"]).toBe(PROJECT_ID);
      expect(args.select).toEqual({ _id: true, name: true });
      expect(args.props).toEqual({ isRoot: true });
      expect(args.skip.toNumber()).toBe(0);
      expect(args.limit.toNumber()).toBe(500);
    });

    test(`${entry.name} without search text is scoped to the project only`, async () => {
      await ResourceFacetResolver.resolve(PROJECT_ID, [
        { facetKey: entry.facetKey, counts: new Map<string, number>() },
      ]);

      expect(lastArgs(entry.name).query).toEqual({ projectId: PROJECT_ID });
    });

    test(`${entry.name} shows its name, or Unknown when it has none`, async () => {
      const named: string = ObjectID.generate().toString();
      const anonymous: string = ObjectID.generate().toString();

      rowsByService.set(entry.name, [
        { _id: named, name: "prod-eu" },
        { _id: anonymous, name: "" },
      ]);

      const result: Record<
        string,
        Array<ResolvedFacetValue>
      > = await ResourceFacetResolver.resolve(PROJECT_ID, [
        {
          facetKey: entry.facetKey,
          counts: new Map<string, number>([[named, 3]]),
        },
      ]);

      expect(result[entry.facetKey]).toEqual([
        { value: named, count: 3, displayName: "prod-eu" },
        { value: anonymous, count: 0, displayName: "Unknown" },
      ]);
    });
  }
});

describe("ResourceFacetResolver.listEntities", () => {
  test("lists each facet's rows without counts, keyed by facet", async () => {
    const hostId: string = ObjectID.generate().toString();
    const fleetId: string = ObjectID.generate().toString();
    rowsByService.set("Host", [{ _id: hostId, name: "web-1" }]);
    rowsByService.set("IoTFleet", [{ _id: fleetId, name: "sensors" }]);

    const listed: Record<
      string,
      Array<ResourceFacetEntity>
    > = await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "hostId" },
      { facetKey: "iotFleetId" },
      { facetKey: "cephClusterId" },
    ]);

    expect(listed).toEqual({
      hostId: [{ id: hostId, displayName: "web-1" }],
      iotFleetId: [{ id: fleetId, displayName: "sensors" }],
      cephClusterId: [],
    });
  });

  test("keeps Postgres order — listing does not sort", async () => {
    rowsByService.set("KubernetesCluster", [
      { _id: "b", name: "zeta" },
      { _id: "a", name: "alpha" },
    ]);

    const listed: Record<
      string,
      Array<ResourceFacetEntity>
    > = await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "kubernetesClusterId" },
    ]);

    expect(listed["kubernetesClusterId"]).toEqual([
      { id: "b", displayName: "zeta" },
      { id: "a", displayName: "alpha" },
    ]);
  });

  test("drops rows without an id, so an empty list means nothing to count", async () => {
    rowsByService.set("DockerSwarmCluster", [
      { name: "no-id" },
      { _id: "", name: "empty-id" },
      { _id: null, name: "null-id" },
    ]);

    const listed: Record<
      string,
      Array<ResourceFacetEntity>
    > = await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "dockerSwarmClusterId" },
    ]);

    expect(listed["dockerSwarmClusterId"]).toEqual([]);
  });

  test("passes search text and limit through to the lookup", async () => {
    await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "cephClusterId", searchText: " 9b2c ", limit: 42 },
    ]);

    const args: FindByArgs = lastArgs("CephCluster");
    expect((args.query["name"] as MultiSearch).fields).toEqual([
      "name",
      "fsid",
    ]);
    expect((args.query["name"] as MultiSearch).value).toBe("9b2c");
    expect(args.limit.toNumber()).toBe(42);
  });

  test("a failing lookup lists [] for that facet only", async () => {
    const fleetId: string = ObjectID.generate().toString();
    rowsByService.set("IoTFleet", [{ _id: fleetId, name: "sensors" }]);
    spyFor("ProxmoxCluster").mockImplementation(async (): Promise<any> => {
      throw new Error("postgres down");
    });

    const listed: Record<
      string,
      Array<ResourceFacetEntity>
    > = await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "proxmoxClusterId" },
      { facetKey: "iotFleetId" },
    ]);

    expect(listed["proxmoxClusterId"]).toEqual([]);
    expect(listed["iotFleetId"]).toEqual([
      { id: fleetId, displayName: "sensors" },
    ]);
  });

  test("an unknown key lists [] without touching any service", async () => {
    const listed: Record<
      string,
      Array<ResourceFacetEntity>
    > = await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "severityText" },
      { facetKey: "constructor" },
    ]);

    expect(listed).toEqual({ severityText: [], constructor: [] });
    for (const entry of SERVICES) {
      expect(spyFor(entry.name)).not.toHaveBeenCalled();
    }
  });

  test("no specs lists nothing and queries nothing", async () => {
    await expect(
      ResourceFacetResolver.listEntities(PROJECT_ID, []),
    ).resolves.toEqual({});
    for (const entry of SERVICES) {
      expect(spyFor(entry.name)).not.toHaveBeenCalled();
    }
  });

  test("resolve is listEntities followed by mergeCounts", async () => {
    rowsByService.set("VMwareVCenter", [
      { _id: "1", name: "vc-b" },
      { _id: "2", name: "vc-a" },
    ]);
    const counts: Map<string, number> = new Map<string, number>([["1", 9]]);

    const listed: Record<
      string,
      Array<ResourceFacetEntity>
    > = await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "vmwareVCenterId" },
    ]);
    const resolved: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "vmwareVCenterId", counts },
    ]);

    expect(resolved["vmwareVCenterId"]).toEqual(
      ResourceFacetResolver.mergeCounts(listed["vmwareVCenterId"]!, counts),
    );
  });
});

describe("ResourceFacetResolver.mergeCounts", () => {
  test("attaches counts, defaults missing ones to 0 and sorts busiest first", () => {
    expect(
      ResourceFacetResolver.mergeCounts(
        [
          { id: "a", displayName: "quiet" },
          { id: "b", displayName: "busy" },
          { id: "c", displayName: "also-quiet" },
        ],
        new Map<string, number>([
          ["b", 12],
          ["ghost", 99],
        ]),
      ),
    ).toEqual([
      { value: "b", count: 12, displayName: "busy" },
      { value: "c", count: 0, displayName: "also-quiet" },
      { value: "a", count: 0, displayName: "quiet" },
    ]);
  });

  test("never invents a value for a counted id that was not listed", () => {
    expect(
      ResourceFacetResolver.mergeCounts(
        [],
        new Map<string, number>([["ghost", 5]]),
      ),
    ).toEqual([]);
  });

  test("drops entities with an empty id", () => {
    expect(
      ResourceFacetResolver.mergeCounts(
        [
          { id: "", displayName: "blank" },
          { id: "x", displayName: "kept" },
        ],
        new Map<string, number>(),
      ),
    ).toEqual([{ value: "x", count: 0, displayName: "kept" }]);
  });

  test("does not mutate the entity list it was given", () => {
    const entities: Array<ResourceFacetEntity> = [
      { id: "a", displayName: "zeta" },
      { id: "b", displayName: "alpha" },
    ];

    ResourceFacetResolver.mergeCounts(entities, new Map<string, number>());

    expect(entities).toEqual([
      { id: "a", displayName: "zeta" },
      { id: "b", displayName: "alpha" },
    ]);
  });
});

describe("ResourceFacetResolver.resolve count merge and ordering", () => {
  test("rows without an id are dropped", async () => {
    const id: string = ObjectID.generate().toString();
    rowsByService.set("Host", [
      { name: "no-id" },
      { _id: "", name: "empty-id" },
      { _id: id, name: "kept" },
    ]);

    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "hostId", counts: new Map<string, number>() },
    ]);

    expect(result["hostId"]).toEqual([
      { value: id, count: 0, displayName: "kept" },
    ]);
  });

  test("entities absent from the telemetry sample get count 0", async () => {
    rowsByService.set("Host", [{ _id: "a", name: "quiet" }]);

    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      {
        facetKey: "hostId",
        counts: new Map<string, number>([["someone-else", 99]]),
      },
    ]);

    expect(result["hostId"]).toEqual([
      { value: "a", count: 0, displayName: "quiet" },
    ]);
  });

  test("counts for ids that are not project resources are not invented", async () => {
    rowsByService.set("Host", []);

    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      { facetKey: "hostId", counts: new Map<string, number>([["ghost", 7]]) },
    ]);

    expect(result["hostId"]).toEqual([]);
  });

  test("sorts by count descending, then display name ascending", async () => {
    rowsByService.set("Host", [
      { _id: "1", name: "zeta" },
      { _id: "2", name: "alpha" },
      { _id: "3", name: "mid" },
      { _id: "4", name: "beta" },
      { _id: "5", name: "gamma" },
    ]);

    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      {
        facetKey: "hostId",
        counts: new Map<string, number>([
          ["1", 10],
          ["3", 50],
          ["5", 10],
        ]),
      },
    ]);

    expect(
      result["hostId"]!.map((v: ResolvedFacetValue): string => {
        return v.displayName;
      }),
    ).toEqual(["mid", "gamma", "zeta", "alpha", "beta"]);
    expect(
      result["hostId"]!.map((v: ResolvedFacetValue): number => {
        return v.count;
      }),
    ).toEqual([50, 10, 10, 0, 0]);
  });

  test("ObjectID-typed _id values are stringified", async () => {
    const id: ObjectID = ObjectID.generate();
    rowsByService.set("Service", [
      { _id: id as unknown as string, name: "api" },
    ]);

    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      {
        facetKey: "serviceId",
        counts: new Map<string, number>([[id.toString(), 3]]),
      },
    ]);

    expect(result["serviceId"]).toEqual([
      { value: id.toString(), count: 3, displayName: "api" },
    ]);
  });
});

describe("ResourceFacetResolver databases", () => {
  test("lists every project database by its display name, busiest first", async () => {
    const busy: string = ObjectID.generate().toString();
    const quiet: string = ObjectID.generate().toString();
    const unnamed: string = ObjectID.generate().toString();

    rowsByService.set("DatabaseServer", [
      {
        _id: quiet,
        name: "Redis cache.prod:6379",
        databaseIdentifier: "redis:cache.prod:6379",
      },
      {
        _id: busy,
        name: "PostgreSQL db.prod:5432",
        databaseIdentifier: "postgresql:db.prod:5432",
      },
      { _id: unnamed, name: "", databaseIdentifier: "mysql:orders:3306" },
    ]);

    const result: Record<
      string,
      Array<ResolvedFacetValue>
    > = await ResourceFacetResolver.resolve(PROJECT_ID, [
      {
        facetKey: "databaseServerId",
        counts: new Map<string, number>([[busy, 12]]),
      },
    ]);

    expect(result["databaseServerId"]).toEqual([
      { value: busy, count: 12, displayName: "PostgreSQL db.prod:5432" },
      { value: unnamed, count: 0, displayName: "mysql:orders:3306" },
      { value: quiet, count: 0, displayName: "Redis cache.prod:6379" },
    ]);
  });

  test("a search for an endpoint fragment matches the name or the identifier, project-scoped and as root", async () => {
    await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "databaseServerId", searchText: " db.prod " },
    ]);

    const args: FindByArgs = lastArgs("DatabaseServer");
    expect(args.query["projectId"]).toBe(PROJECT_ID);
    expect(args.query["name"]).toBeInstanceOf(MultiSearch);
    expect((args.query["name"] as MultiSearch).fields).toEqual([
      "name",
      "databaseIdentifier",
    ]);
    expect((args.query["name"] as MultiSearch).value).toBe("db.prod");
    expect(args.select).toEqual({
      _id: true,
      name: true,
      databaseIdentifier: true,
    });
    expect(args.props).toEqual({ isRoot: true });
    expect(args.limit.toNumber()).toBe(500);
  });

  test("a failing database lookup does not take the host facet down with it", async () => {
    const hostId: string = ObjectID.generate().toString();
    rowsByService.set("Host", [{ _id: hostId, name: "web-1" }]);
    spyFor("DatabaseServer").mockImplementation(async (): Promise<any> => {
      throw new Error("postgres down");
    });

    const listed: Record<
      string,
      Array<ResourceFacetEntity>
    > = await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "databaseServerId" },
      { facetKey: "hostId" },
    ]);

    expect(listed).toEqual({
      databaseServerId: [],
      hostId: [{ id: hostId, displayName: "web-1" }],
    });
  });
});

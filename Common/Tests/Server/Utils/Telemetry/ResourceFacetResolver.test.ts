import ResourceFacetResolver, {
  RESOURCE_FACET_KEYS,
  ResolvedFacetValue,
} from "../../../../Server/Utils/Telemetry/ResourceFacetResolver";
import ServiceService from "../../../../Server/Services/ServiceService";
import HostService from "../../../../Server/Services/HostService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import ServerlessFunctionService from "../../../../Server/Services/ServerlessFunctionService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import RumApplicationService from "../../../../Server/Services/RumApplicationService";
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
  ])("%j is not a resource facet", (facetKey: string) => {
    expect(ResourceFacetResolver.isResourceFacet(facetKey)).toBe(false);
  });

  test("the exported key set has exactly the nine supported keys", () => {
    expect(RESOURCE_FACET_KEYS.size).toBe(9);
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

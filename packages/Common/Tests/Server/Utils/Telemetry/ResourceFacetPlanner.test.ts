import ResourceFacetPlanner, {
  ListedResourceFacets,
  PlannedFacetValue,
} from "../../../../Server/Utils/Telemetry/ResourceFacetPlanner";
import ResourceFacetResolver, {
  ResolvedFacetValue,
  ResourceFacetEntity,
  ResourceFacetListSpec,
} from "../../../../Server/Utils/Telemetry/ResourceFacetResolver";
import ObjectID from "../../../../Types/ObjectID";
import { RESOURCE_FACET_CATALOG_KEYS } from "../../../../Types/Telemetry/ResourceFacetCatalog";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The planner decides which ClickHouse count queries a facets request
 * actually runs. The contract that matters: a resource facet whose Postgres
 * listing is empty answers [] WITHOUT a count query (the explorers request
 * every catalog resource type, and most projects have few of them), while
 * everything else keeps the response it had before — plain facets counted
 * as-is, resource facets as the listed rows with counts merged in, and every
 * failure contained to its own facet.
 *
 * The Postgres listing is stubbed at ResourceFacetResolver.listEntities; the
 * merge is the real one.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

interface ListEntitiesSpy {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (
    implementation: (
      projectId: ObjectID,
      specs: Array<ResourceFacetListSpec>,
    ) => Promise<ListedResourceFacets>,
  ) => unknown;
}

let listEntitiesSpy: ListEntitiesSpy;
let listedRows: ListedResourceFacets;

function entity(id: string, displayName: string): ResourceFacetEntity {
  return { id, displayName };
}

function specsListed(): Array<ResourceFacetListSpec> {
  const call: Array<unknown> | undefined = listEntitiesSpy.mock.calls[0];
  return (call ? call[1] : []) as Array<ResourceFacetListSpec>;
}

/*
 * A counter that records which facets were counted and answers from a
 * fixture table (or throws for keys listed in `failing`).
 */
function makeCounter(data: {
  values?: Record<string, Array<PlannedFacetValue>>;
  failing?: Array<string>;
}): {
  counted: Array<string>;
  countFacet: (facetKey: string) => Promise<Array<PlannedFacetValue>>;
} {
  const counted: Array<string> = [];

  return {
    counted,
    countFacet: async (facetKey: string): Promise<Array<PlannedFacetValue>> => {
      counted.push(facetKey);

      if ((data.failing || []).includes(facetKey)) {
        throw new Error(`clickhouse timeout for ${facetKey}`);
      }

      return (data.values || {})[facetKey] || [];
    },
  };
}

beforeEach(() => {
  listedRows = {};

  listEntitiesSpy = jest
    .spyOn(ResourceFacetResolver, "listEntities")
    .mockImplementation(
      async (
        _projectId: ObjectID,
        specs: Array<ResourceFacetListSpec>,
      ): Promise<ListedResourceFacets> => {
        return Object.fromEntries(
          specs.map(
            (
              spec: ResourceFacetListSpec,
            ): [string, Array<ResourceFacetEntity>] => {
              return [spec.facetKey, listedRows[spec.facetKey] || []];
            },
          ),
        );
      },
    ) as unknown as ListEntitiesSpy;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ResourceFacetPlanner.getResourceFacetKeys", () => {
  test("keeps only resolver keys, de-duplicated, in request order", () => {
    expect(
      ResourceFacetPlanner.getResourceFacetKeys([
        "severityText",
        "kubernetesClusterId",
        "primaryEntityId",
        "kubernetesClusterId",
        "resource.host.name",
        "iotFleetId",
      ]),
    ).toEqual(["kubernetesClusterId", "primaryEntityId", "iotFleetId"]);
  });

  test("every catalog key is a resource facet key", () => {
    expect(
      ResourceFacetPlanner.getResourceFacetKeys([
        ...RESOURCE_FACET_CATALOG_KEYS,
      ]),
    ).toEqual([...RESOURCE_FACET_CATALOG_KEYS]);
  });

  test("uniqueFacetKeys keeps the first occurrence of each key", () => {
    expect(
      ResourceFacetPlanner.uniqueFacetKeys(["b", "a", "b", "c", "a"]),
    ).toEqual(["b", "a", "c"]);
  });
});

describe("ResourceFacetPlanner.listResourceFacets", () => {
  test("lists only the requested resource facets, with their search text and the limit", async () => {
    listedRows = { hostId: [entity("h1", "web-1")] };

    const listed: ListedResourceFacets =
      await ResourceFacetPlanner.listResourceFacets({
        projectId: PROJECT_ID,
        facetKeys: ["severityText", "hostId", "cephClusterId", "hostId"],
        facetSearchText: { hostId: "web", severityText: "err" },
        limit: 200,
      });

    expect(listed).toEqual({
      hostId: [entity("h1", "web-1")],
      cephClusterId: [],
    });
    expect(listEntitiesSpy.mock.calls).toHaveLength(1);
    expect(listEntitiesSpy.mock.calls[0]![0]).toBe(PROJECT_ID);
    expect(specsListed()).toEqual([
      { facetKey: "hostId", searchText: "web", limit: 200 },
      { facetKey: "cephClusterId", searchText: undefined, limit: 200 },
    ]);
  });

  test("no resource facet requested means no Postgres round trip", async () => {
    const listed: ListedResourceFacets =
      await ResourceFacetPlanner.listResourceFacets({
        projectId: PROJECT_ID,
        facetKeys: ["severityText", "statusCode"],
        limit: 500,
      });

    expect(listed).toEqual({});
    expect(listEntitiesSpy.mock.calls).toHaveLength(0);
  });

  test("never rejects: an unexpected listing failure lists nothing", async () => {
    listEntitiesSpy.mockImplementation(
      async (): Promise<ListedResourceFacets> => {
        throw new Error("unexpected");
      },
    );

    await expect(
      ResourceFacetPlanner.listResourceFacets({
        projectId: PROJECT_ID,
        facetKeys: ["hostId"],
        limit: 500,
      }),
    ).resolves.toEqual({});
  });

  test("never rejects on a malformed key list either", async () => {
    await expect(
      ResourceFacetPlanner.listResourceFacets({
        projectId: PROJECT_ID,
        facetKeys: 42 as unknown as Array<string>,
        limit: 500,
      }),
    ).resolves.toEqual({});
  });
});

describe("ResourceFacetPlanner.countPerFacet", () => {
  test("a resource facet with no listed rows answers [] and skips its count query", async () => {
    listedRows = { hostId: [entity("h1", "web-1")] };
    const counter: ReturnType<typeof makeCounter> = makeCounter({
      values: { hostId: [{ value: "h1", count: 7 }] },
    });

    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["hostId", "proxmoxClusterId", "iotFleetId"],
      limit: 500,
      countFacet: counter.countFacet,
    });

    expect(facets).toEqual({
      hostId: [{ value: "h1", count: 7, displayName: "web-1" }],
      proxmoxClusterId: [],
      iotFleetId: [],
    });
    expect(counter.counted).toEqual(["hostId"]);
  });

  test("requesting every catalog type in a project with none of them runs no resource count at all", async () => {
    const counter: ReturnType<typeof makeCounter> = makeCounter({
      values: { severityText: [{ value: "Error", count: 3 }] },
    });

    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["severityText", ...RESOURCE_FACET_CATALOG_KEYS],
      limit: 500,
      countFacet: counter.countFacet,
    });

    expect(counter.counted).toEqual(["severityText"]);
    expect(facets["severityText"]).toEqual([{ value: "Error", count: 3 }]);
    for (const facetKey of RESOURCE_FACET_CATALOG_KEYS) {
      expect(facets[facetKey]).toEqual([]);
    }
  });

  test("non-resource facets are always counted and returned as the counter gave them", async () => {
    const counter: ReturnType<typeof makeCounter> = makeCounter({
      values: {
        severityText: [
          { value: "Error", count: 3 },
          { value: "Info", count: 9 },
        ],
        "resource.host.name": [{ value: "web-1", count: 2 }],
      },
    });

    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["severityText", "resource.host.name"],
      limit: 500,
      countFacet: counter.countFacet,
    });

    // Order and shape untouched: only resource facets are re-sorted.
    expect(facets).toEqual({
      severityText: [
        { value: "Error", count: 3 },
        { value: "Info", count: 9 },
      ],
      "resource.host.name": [{ value: "web-1", count: 2 }],
    });
    expect(counter.counted.sort()).toEqual([
      "resource.host.name",
      "severityText",
    ]);
    expect(listEntitiesSpy.mock.calls).toHaveLength(0);
  });

  test("merges counts into the listed rows: count 0 for quiet rows, busiest first, unlisted ids ignored", async () => {
    listedRows = {
      kubernetesClusterId: [
        entity("c1", "alpha"),
        entity("c2", "beta"),
        entity("c3", "gamma"),
      ],
    };
    const counter: ReturnType<typeof makeCounter> = makeCounter({
      values: {
        kubernetesClusterId: [
          { value: "c3", count: 40 },
          { value: "c1", count: 5 },
          { value: "not-a-project-cluster", count: 99 },
        ],
      },
    });

    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["kubernetesClusterId"],
      limit: 500,
      countFacet: counter.countFacet,
    });

    expect(facets["kubernetesClusterId"]).toEqual([
      { value: "c3", count: 40, displayName: "gamma" },
      { value: "c1", count: 5, displayName: "alpha" },
      { value: "c2", count: 0, displayName: "beta" },
    ]);
  });

  test("a failing count degrades a plain facet to []", async () => {
    const counter: ReturnType<typeof makeCounter> = makeCounter({
      values: { environment: [{ value: "prod", count: 1 }] },
      failing: ["exceptionType"],
    });

    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["exceptionType", "environment"],
      limit: 500,
      countFacet: counter.countFacet,
    });

    expect(facets).toEqual({
      exceptionType: [],
      environment: [{ value: "prod", count: 1 }],
    });
  });

  test("a failing count keeps a resource facet's listed rows, at count 0", async () => {
    listedRows = {
      primaryEntityId: [entity("s2", "checkout"), entity("s1", "api")],
    };
    const counter: ReturnType<typeof makeCounter> = makeCounter({
      failing: ["primaryEntityId"],
    });

    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["primaryEntityId"],
      limit: 500,
      countFacet: counter.countFacet,
    });

    expect(counter.counted).toEqual(["primaryEntityId"]);
    expect(facets["primaryEntityId"]).toEqual([
      { value: "s1", count: 0, displayName: "api" },
      { value: "s2", count: 0, displayName: "checkout" },
    ]);
  });

  test("a synchronously throwing counter is contained too", async () => {
    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["severityText"],
      limit: 500,
      countFacet: (): Promise<Array<PlannedFacetValue>> => {
        throw new Error("invalid facetKey");
      },
    });

    expect(facets).toEqual({ severityText: [] });
  });

  test("a failed listing answers [] for every resource facet and counts none of them", async () => {
    listEntitiesSpy.mockImplementation(
      async (): Promise<ListedResourceFacets> => {
        throw new Error("postgres down");
      },
    );
    const counter: ReturnType<typeof makeCounter> = makeCounter({
      values: {
        hostId: [{ value: "h1", count: 7 }],
        severityText: [{ value: "Error", count: 1 }],
      },
    });

    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["hostId", "severityText"],
      limit: 500,
      countFacet: counter.countFacet,
    });

    expect(facets).toEqual({
      hostId: [],
      severityText: [{ value: "Error", count: 1 }],
    });
    expect(counter.counted).toEqual(["severityText"]);
  });

  test("facet search text reaches the listing, and a search that matched nothing skips the count", async () => {
    listedRows = {};
    const counter: ReturnType<typeof makeCounter> = makeCounter({
      values: { vmwareVCenterId: [{ value: "v1", count: 3 }] },
    });

    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["vmwareVCenterId"],
      facetSearchText: { vmwareVCenterId: "no-such-vcenter" },
      limit: 25,
      countFacet: counter.countFacet,
    });

    expect(specsListed()).toEqual([
      {
        facetKey: "vmwareVCenterId",
        searchText: "no-such-vcenter",
        limit: 25,
      },
    ]);
    expect(facets).toEqual({ vmwareVCenterId: [] });
    expect(counter.counted).toEqual([]);
  });

  test("lists all resource facets in ONE batched listing call", async () => {
    const counter: ReturnType<typeof makeCounter> = makeCounter({});

    await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["primaryEntityId", "hostId", "severityText", "iotFleetId"],
      limit: 500,
      countFacet: counter.countFacet,
    });

    expect(listEntitiesSpy.mock.calls).toHaveLength(1);
    expect(
      specsListed().map((spec: ResourceFacetListSpec): string => {
        return spec.facetKey;
      }),
    ).toEqual(["primaryEntityId", "hostId", "iotFleetId"]);
  });

  test("a repeated key is counted once and appears once", async () => {
    listedRows = { hostId: [entity("h1", "web-1")] };
    const counter: ReturnType<typeof makeCounter> = makeCounter({
      values: {
        hostId: [{ value: "h1", count: 1 }],
        severityText: [{ value: "Error", count: 1 }],
      },
    });

    const facets: Record<
      string,
      Array<PlannedFacetValue>
    > = await ResourceFacetPlanner.countPerFacet({
      projectId: PROJECT_ID,
      facetKeys: ["hostId", "severityText", "hostId", "severityText"],
      limit: 500,
      countFacet: counter.countFacet,
    });

    expect(Object.keys(facets).sort()).toEqual(["hostId", "severityText"]);
    expect(counter.counted.sort()).toEqual(["hostId", "severityText"]);
  });

  test("an empty request answers {} and runs nothing", async () => {
    const counter: ReturnType<typeof makeCounter> = makeCounter({});

    await expect(
      ResourceFacetPlanner.countPerFacet({
        projectId: PROJECT_ID,
        facetKeys: [],
        limit: 500,
        countFacet: counter.countFacet,
      }),
    ).resolves.toEqual({});
    expect(counter.counted).toEqual([]);
    expect(listEntitiesSpy.mock.calls).toHaveLength(0);
  });

  test("plain facets are counted without waiting for the Postgres listing", async () => {
    const listing: { release: () => void } = {
      release: (): void => {
        // replaced below
      },
    };

    listEntitiesSpy.mockImplementation(
      (
        _projectId: ObjectID,
        specs: Array<ResourceFacetListSpec>,
      ): Promise<ListedResourceFacets> => {
        return new Promise<ListedResourceFacets>(
          (resolve: (value: ListedResourceFacets) => void): void => {
            listing.release = (): void => {
              resolve(
                Object.fromEntries(
                  specs.map(
                    (
                      spec: ResourceFacetListSpec,
                    ): [string, Array<ResourceFacetEntity>] => {
                      return [spec.facetKey, [entity("h1", "web-1")]];
                    },
                  ),
                ),
              );
            };
          },
        );
      },
    );

    const counter: ReturnType<typeof makeCounter> = makeCounter({});

    const pending: Promise<Record<string, Array<PlannedFacetValue>>> =
      ResourceFacetPlanner.countPerFacet({
        projectId: PROJECT_ID,
        facetKeys: ["hostId", "severityText"],
        limit: 500,
        countFacet: counter.countFacet,
      });

    // Let every already-runnable continuation run.
    for (let tick: number = 0; tick < 10; tick++) {
      await Promise.resolve();
    }

    // The plain facet is already counting; the resource facet is not.
    expect(counter.counted).toEqual(["severityText"]);

    listing.release();

    await expect(pending).resolves.toEqual({
      hostId: [{ value: "h1", count: 0, displayName: "web-1" }],
      severityText: [],
    });
    expect(counter.counted).toEqual(["severityText", "hostId"]);
  });
});

describe("ResourceFacetPlanner.needsTraceResourceFacetCounts", () => {
  test("statusCode always needs the shared count query", () => {
    expect(
      ResourceFacetPlanner.needsTraceResourceFacetCounts({
        facetKeys: ["statusCode", "hostId"],
        listed: { hostId: [] },
      }),
    ).toBe(true);
    expect(
      ResourceFacetPlanner.needsTraceResourceFacetCounts({
        facetKeys: ["statusCode"],
        listed: {},
      }),
    ).toBe(true);
  });

  test("skipped when every requested resource facet listed nothing", () => {
    expect(
      ResourceFacetPlanner.needsTraceResourceFacetCounts({
        facetKeys: ["hostId", "iotFleetId", "kind", "name"],
        listed: { hostId: [], iotFleetId: [] },
      }),
    ).toBe(false);
  });

  test("needed as soon as one requested resource facet listed a row", () => {
    expect(
      ResourceFacetPlanner.needsTraceResourceFacetCounts({
        facetKeys: ["hostId", "iotFleetId"],
        listed: { hostId: [], iotFleetId: [entity("f1", "sensors")] },
      }),
    ).toBe(true);
  });

  test("a listed row for a facet that was NOT requested does not count", () => {
    expect(
      ResourceFacetPlanner.needsTraceResourceFacetCounts({
        facetKeys: ["hostId"],
        listed: { hostId: [], primaryEntityId: [entity("s1", "api")] },
      }),
    ).toBe(false);
  });

  test("not needed when neither statusCode nor any resource facet is requested", () => {
    expect(
      ResourceFacetPlanner.needsTraceResourceFacetCounts({
        facetKeys: ["kind", "isRootSpan", "hasException"],
        listed: {},
      }),
    ).toBe(false);
  });
});

describe("ResourceFacetPlanner.mergeResourceFacetCounts", () => {
  test("one entry per requested resource facet; plain facets are not touched", () => {
    const shared: Map<string, number> = new Map<string, number>([
      ["s1", 10],
      ["h1", 4],
    ]);
    const askedFor: Array<string> = [];
    const countsFor: (facetKey: string) => Map<string, number> = (
      facetKey: string,
    ): Map<string, number> => {
      askedFor.push(facetKey);
      return shared;
    };

    const merged: Record<
      string,
      Array<ResolvedFacetValue>
    > = ResourceFacetPlanner.mergeResourceFacetCounts({
      facetKeys: ["primaryEntityId", "hostId", "cephClusterId", "kind"],
      listed: {
        primaryEntityId: [entity("s2", "cart"), entity("s1", "api")],
        hostId: [entity("h1", "web-1")],
        cephClusterId: [],
      },
      countsFor,
    });

    expect(merged).toEqual({
      primaryEntityId: [
        { value: "s1", count: 10, displayName: "api" },
        { value: "s2", count: 0, displayName: "cart" },
      ],
      hostId: [{ value: "h1", count: 4, displayName: "web-1" }],
      cephClusterId: [],
    });
    // Counts are never consulted for a facet that listed nothing.
    expect(askedFor).toEqual(["primaryEntityId", "hostId"]);
  });

  test("a requested resource facet missing from the listing answers []", () => {
    expect(
      ResourceFacetPlanner.mergeResourceFacetCounts({
        facetKeys: ["hostId"],
        listed: {},
        countsFor: (): Map<string, number> => {
          return new Map<string, number>();
        },
      }),
    ).toEqual({ hostId: [] });
  });
});

describe("ResourceFacetPlanner.toCountMap", () => {
  test("maps each value to its count", () => {
    expect(
      Array.from(
        ResourceFacetPlanner.toCountMap([
          { value: "a", count: 1 },
          { value: "b", count: 2, displayName: "B" },
        ]).entries(),
      ),
    ).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });
});

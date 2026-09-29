import StatusPageResourceSearchUtil, {
  StatusPageResourceSearchResult,
} from "../../../Utils/StatusPage/ResourceSearch";
import StatusPageGroupTreeUtil from "../../../Utils/StatusPage/GroupTree";
import ObjectID from "../../../Types/ObjectID";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - finding one service on a status page.
 *
 * A page with a few hundred resources under a nested hierarchy previously had
 * no way to answer "is the thing I use up?" other than opening every group in
 * turn. The filter has to do three things without exception:
 *
 *   - never hide a match. A match nested four levels down keeps every group
 *     above it, or it renders nowhere at all.
 *   - treat a group name as a thing you can search for. Typing a region is
 *     asking about the region, not about a service whose name contains it.
 *   - survive the data. Parent pointers live in a nullable column and can
 *     point at a missing group or around a cycle; a filter that hangs on one
 *     takes the whole status page down with it.
 */

const EUROPE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const GERMANY: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const BERLIN: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const ASIA: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const EMPTY_GROUP: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

type MakeGroupData = {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
  description?: string | undefined;
};

function makeGroup(data: MakeGroupData): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id.toString();
  group.name = data.name;

  if (data.parentId) {
    group.parentStatusPageGroupId = data.parentId;
  }

  if (data.description) {
    group.description = data.description;
  }

  return group;
}

type MakeResourceData = {
  id: string;
  displayName?: string | undefined;
  displayDescription?: string | undefined;
  monitorName?: string | undefined;
  groupId?: ObjectID | undefined;
};

function makeResource(data: MakeResourceData): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = data.id;

  if (data.displayName) {
    resource.displayName = data.displayName;
  }

  if (data.displayDescription) {
    resource.displayDescription = data.displayDescription;
  }

  if (data.monitorName) {
    const monitor: Monitor = new Monitor();
    monitor.name = data.monitorName;
    resource.monitor = monitor;
  }

  if (data.groupId) {
    resource.statusPageGroupId = data.groupId;
  }

  return resource;
}

/*
 * Europe
 *   Germany
 *     Berlin        -> "Checkout API", "Search"
 * Asia               -> "Payments Gateway"
 * Legacy (empty)
 * (ungrouped)        -> "Marketing Site"
 */
function makeGroups(): Array<StatusPageGroup> {
  return [
    makeGroup({ id: EUROPE, name: "Europe" }),
    makeGroup({ id: GERMANY, name: "Germany", parentId: EUROPE }),
    makeGroup({ id: BERLIN, name: "Berlin", parentId: GERMANY }),
    makeGroup({
      id: ASIA,
      name: "Asia",
      description: "Everything served out of Singapore",
    }),
    makeGroup({ id: EMPTY_GROUP, name: "Legacy" }),
  ];
}

function makeResources(): Array<StatusPageResource> {
  return [
    makeResource({
      id: "resource-checkout",
      displayName: "Checkout API",
      groupId: BERLIN,
    }),
    makeResource({
      id: "resource-search",
      displayName: "Search",
      displayDescription: "Full text search over the catalogue",
      groupId: BERLIN,
    }),
    makeResource({
      id: "resource-payments",
      monitorName: "Payments Gateway",
      groupId: ASIA,
    }),
    makeResource({ id: "resource-marketing", displayName: "Marketing Site" }),
  ];
}

function search(query: string): StatusPageResourceSearchResult {
  return StatusPageResourceSearchUtil.search({
    query: query,
    statusPageResources: makeResources(),
    statusPageGroups: makeGroups(),
  });
}

describe("StatusPageResourceSearchUtil.shouldShowSearch", () => {
  /*
   * A search field over three rows reads as a mistake. It appears when the
   * page is big enough that scanning it is work.
   */
  test("a small flat page does not get a search box", () => {
    expect(
      StatusPageResourceSearchUtil.shouldShowSearch({
        resourceCount: 3,
        groupCount: 0,
      }),
    ).toBe(false);
  });

  test("enough resources brings the box out", () => {
    expect(
      StatusPageResourceSearchUtil.shouldShowSearch({
        resourceCount: StatusPageResourceSearchUtil.MinimumResourcesForSearch,
        groupCount: 0,
      }),
    ).toBe(true);

    expect(
      StatusPageResourceSearchUtil.shouldShowSearch({
        resourceCount:
          StatusPageResourceSearchUtil.MinimumResourcesForSearch - 1,
        groupCount: 0,
      }),
    ).toBe(false);
  });

  /*
   * A few resources hidden behind several collapsed groups are harder to find
   * than many resources in one list, so groups count on their own.
   */
  test("enough groups brings the box out even with few resources", () => {
    expect(
      StatusPageResourceSearchUtil.shouldShowSearch({
        resourceCount: 2,
        groupCount: StatusPageResourceSearchUtil.MinimumGroupsForSearch,
      }),
    ).toBe(true);
  });

  test("an empty page does not get a search box", () => {
    expect(
      StatusPageResourceSearchUtil.shouldShowSearch({
        resourceCount: 0,
        groupCount: 0,
      }),
    ).toBe(false);
  });
});

describe("StatusPageResourceSearchUtil.search - no query", () => {
  test("an empty query leaves the page exactly as it was", () => {
    const result: StatusPageResourceSearchResult = search("");

    expect(result.isActive).toBe(false);
    expect(result.matchedResourceCount).toBe(4);
    expect(result.totalResourceCount).toBe(4);
    expect(result.hasUngroupedMatches).toBe(true);
  });

  test("whitespace is not a query", () => {
    for (const query of ["   ", "\t", "\n", ""]) {
      expect(search(query).isActive).toBe(false);
    }
  });

  test("null and undefined are not a query", () => {
    for (const query of [null, undefined]) {
      const result: StatusPageResourceSearchResult =
        StatusPageResourceSearchUtil.search({
          query: query,
          statusPageResources: makeResources(),
          statusPageGroups: makeGroups(),
        });

      expect(result.isActive).toBe(false);
    }
  });

  test("with no query every resource and group is visible", () => {
    const result: StatusPageResourceSearchResult = search("");

    for (const resource of makeResources()) {
      expect(
        StatusPageResourceSearchUtil.isResourceVisible({
          resource: resource,
          result: result,
        }),
      ).toBe(true);
    }

    for (const group of makeGroups()) {
      expect(
        StatusPageResourceSearchUtil.isGroupVisible({
          statusPageGroup: group,
          result: result,
        }),
      ).toBe(true);
    }
  });
});

describe("StatusPageResourceSearchUtil.search - matching a resource", () => {
  test("matches a resource by its display name", () => {
    const result: StatusPageResourceSearchResult = search("checkout");

    expect(result.isActive).toBe(true);
    expect(Array.from(result.matchedResourceIds)).toEqual([
      "resource-checkout",
    ]);
    expect(result.matchedResourceCount).toBe(1);
    expect(result.totalResourceCount).toBe(4);
  });

  test("matching is case insensitive and ignores surrounding space", () => {
    for (const query of ["CHECKOUT", "  Checkout  ", "cHeCkOuT"]) {
      expect(search(query).matchedResourceIds.has("resource-checkout")).toBe(
        true,
      );
    }
  });

  test("matches a substring anywhere in the name", () => {
    expect(search("out API").matchedResourceIds.has("resource-checkout")).toBe(
      true,
    );
  });

  /*
   * A resource can be shown under a display name while the monitor behind it
   * is called something else; both are things a visitor may know it by.
   */
  test("matches a resource by the name of the monitor behind it", () => {
    const result: StatusPageResourceSearchResult = search("gateway");

    expect(Array.from(result.matchedResourceIds)).toEqual([
      "resource-payments",
    ]);
  });

  test("matches a resource by its description", () => {
    const result: StatusPageResourceSearchResult = search("catalogue");

    expect(Array.from(result.matchedResourceIds)).toEqual(["resource-search"]);
  });

  test("a query nothing matches produces an empty, still active result", () => {
    const result: StatusPageResourceSearchResult = search("kubernetes");

    expect(result.isActive).toBe(true);
    expect(result.matchedResourceCount).toBe(0);
    expect(result.visibleGroupIds.size).toBe(0);
    expect(result.hasUngroupedMatches).toBe(false);
  });

  test("an ungrouped match is reported as one", () => {
    const result: StatusPageResourceSearchResult = search("marketing");

    expect(result.hasUngroupedMatches).toBe(true);
    expect(result.visibleGroupIds.size).toBe(0);
  });

  test("a grouped match does not claim an ungrouped one", () => {
    expect(search("checkout").hasUngroupedMatches).toBe(false);
  });
});

describe("StatusPageResourceSearchUtil.search - keeping the hierarchy", () => {
  /*
   * The match is three levels down. Dropping any group above it would leave
   * it with nowhere to render, which reads as "no results".
   */
  test("every group above a match is kept", () => {
    const result: StatusPageResourceSearchResult = search("checkout");

    expect(result.visibleGroupIds.has(BERLIN.toString())).toBe(true);
    expect(result.visibleGroupIds.has(GERMANY.toString())).toBe(true);
    expect(result.visibleGroupIds.has(EUROPE.toString())).toBe(true);
  });

  test("groups holding nothing that matched are dropped", () => {
    const result: StatusPageResourceSearchResult = search("checkout");

    expect(result.visibleGroupIds.has(ASIA.toString())).toBe(false);
    expect(result.visibleGroupIds.has(EMPTY_GROUP.toString())).toBe(false);
  });

  /*
   * Typing a region is asking about the region. Every service under it is an
   * answer, whatever it happens to be called.
   */
  test("a group name keeps everything nested under it", () => {
    const result: StatusPageResourceSearchResult = search("europe");

    expect(result.matchedResourceIds.has("resource-checkout")).toBe(true);
    expect(result.matchedResourceIds.has("resource-search")).toBe(true);
    expect(result.matchedResourceIds.has("resource-payments")).toBe(false);
    expect(result.matchedResourceCount).toBe(2);
  });

  test("an intermediate group name keeps only its own subtree", () => {
    const result: StatusPageResourceSearchResult = search("berlin");

    expect(result.matchedResourceCount).toBe(2);
    expect(result.visibleGroupIds.has(EUROPE.toString())).toBe(true);
    expect(result.visibleGroupIds.has(ASIA.toString())).toBe(false);
  });

  test("a group description is searchable too", () => {
    const result: StatusPageResourceSearchResult = search("singapore");

    expect(result.matchedResourceIds.has("resource-payments")).toBe(true);
  });

  /*
   * "There is a group called Legacy and it is empty" is a real answer to
   * typing "legacy". Hiding it would read as "no such group".
   */
  test("a group that matched by name is kept even when it holds nothing", () => {
    const result: StatusPageResourceSearchResult = search("legacy");

    expect(result.matchedResourceCount).toBe(0);
    expect(result.visibleGroupIds.has(EMPTY_GROUP.toString())).toBe(true);
  });

  test("a query matching a group and a resource keeps both", () => {
    const resources: Array<StatusPageResource> = [
      ...makeResources(),
      makeResource({ id: "resource-asia-cdn", displayName: "Asia CDN" }),
    ];

    const result: StatusPageResourceSearchResult =
      StatusPageResourceSearchUtil.search({
        query: "asia",
        statusPageResources: resources,
        statusPageGroups: makeGroups(),
      });

    expect(result.matchedResourceIds.has("resource-payments")).toBe(true);
    expect(result.matchedResourceIds.has("resource-asia-cdn")).toBe(true);
    expect(result.hasUngroupedMatches).toBe(true);
  });
});

describe("StatusPageResourceSearchUtil.search - bad data", () => {
  /*
   * A parent pointer written straight to the database can form a loop. The
   * page it belongs to must still render.
   */
  test("a cycle in the group hierarchy does not hang the walk", () => {
    const groups: Array<StatusPageGroup> = [
      makeGroup({ id: EUROPE, name: "Europe", parentId: GERMANY }),
      makeGroup({ id: GERMANY, name: "Germany", parentId: EUROPE }),
    ];

    const resources: Array<StatusPageResource> = [
      makeResource({
        id: "resource-in-cycle",
        displayName: "Checkout API",
        groupId: GERMANY,
      }),
    ];

    const result: StatusPageResourceSearchResult =
      StatusPageResourceSearchUtil.search({
        query: "checkout",
        statusPageResources: resources,
        statusPageGroups: groups,
      });

    expect(result.matchedResourceIds.has("resource-in-cycle")).toBe(true);
    expect(result.visibleGroupIds.has(GERMANY.toString())).toBe(true);
    expect(result.visibleGroupIds.has(EUROPE.toString())).toBe(true);
  });

  test("a cycle above a group that matched by name still resolves", () => {
    const groups: Array<StatusPageGroup> = [
      makeGroup({ id: EUROPE, name: "Europe", parentId: GERMANY }),
      makeGroup({ id: GERMANY, name: "Germany", parentId: EUROPE }),
    ];

    const resources: Array<StatusPageResource> = [
      makeResource({
        id: "resource-in-cycle",
        displayName: "Anything",
        groupId: GERMANY,
      }),
    ];

    const result: StatusPageResourceSearchResult =
      StatusPageResourceSearchUtil.search({
        query: "germany",
        statusPageResources: resources,
        statusPageGroups: groups,
      });

    expect(result.matchedResourceIds.has("resource-in-cycle")).toBe(true);
  });

  test("a resource pointing at a group that was not fetched is still matchable", () => {
    const resources: Array<StatusPageResource> = [
      makeResource({
        id: "resource-orphan",
        displayName: "Checkout API",
        groupId: new ObjectID("99999999-9999-4999-8999-999999999999"),
      }),
    ];

    const result: StatusPageResourceSearchResult =
      StatusPageResourceSearchUtil.search({
        query: "checkout",
        statusPageResources: resources,
        statusPageGroups: [],
      });

    expect(result.matchedResourceIds.has("resource-orphan")).toBe(true);
  });

  test("a group with no id of its own is skipped rather than crashing", () => {
    const groups: Array<StatusPageGroup> = [
      makeGroup({ id: EUROPE, name: "Europe" }),
    ];
    const idless: StatusPageGroup = new StatusPageGroup();
    idless.name = "Europe";
    groups.push(idless);

    const result: StatusPageResourceSearchResult =
      StatusPageResourceSearchUtil.search({
        query: "europe",
        statusPageResources: [],
        statusPageGroups: groups,
      });

    expect(result.isActive).toBe(true);
    expect(result.visibleGroupIds.has(EUROPE.toString())).toBe(true);
  });

  test("a group whose parent is itself is treated as a root", () => {
    const selfParented: StatusPageGroup = makeGroup({
      id: EUROPE,
      name: "Europe",
      parentId: EUROPE,
    });

    const result: StatusPageResourceSearchResult =
      StatusPageResourceSearchUtil.search({
        query: "europe",
        statusPageResources: [
          makeResource({
            id: "resource-a",
            displayName: "Anything",
            groupId: EUROPE,
          }),
        ],
        statusPageGroups: [selfParented],
      });

    expect(result.matchedResourceIds.has("resource-a")).toBe(true);
  });

  test("a resource with no name at all simply does not match", () => {
    const nameless: StatusPageResource = new StatusPageResource();
    nameless._id = "resource-nameless";

    const result: StatusPageResourceSearchResult =
      StatusPageResourceSearchUtil.search({
        query: "anything",
        statusPageResources: [nameless],
        statusPageGroups: [],
      });

    expect(result.matchedResourceCount).toBe(0);
  });
});

describe("StatusPageResourceSearchUtil.isResourceVisible", () => {
  test("only matched resources survive an active result", () => {
    const result: StatusPageResourceSearchResult = search("checkout");

    const resources: Array<StatusPageResource> = makeResources();

    expect(
      StatusPageResourceSearchUtil.isResourceVisible({
        resource: resources[0] as StatusPageResource,
        result: result,
      }),
    ).toBe(true);

    expect(
      StatusPageResourceSearchUtil.isResourceVisible({
        resource: resources[1] as StatusPageResource,
        result: result,
      }),
    ).toBe(false);
  });

  /*
   * A row with no id cannot be in the matched set, so under a running search
   * it is not an answer to what was typed.
   */
  test("a resource with no id is dropped from a filtered view", () => {
    const nameless: StatusPageResource = new StatusPageResource();
    nameless.displayName = "Checkout API";

    expect(
      StatusPageResourceSearchUtil.isResourceVisible({
        resource: nameless,
        result: search("checkout"),
      }),
    ).toBe(false);

    expect(
      StatusPageResourceSearchUtil.isResourceVisible({
        resource: nameless,
        result: search(""),
      }),
    ).toBe(true);
  });
});

describe("StatusPageResourceSearchUtil.isGroupVisible", () => {
  test("only kept groups survive an active result", () => {
    const result: StatusPageResourceSearchResult = search("checkout");
    const groups: Array<StatusPageGroup> = makeGroups();

    expect(
      StatusPageResourceSearchUtil.isGroupVisible({
        statusPageGroup: groups[0] as StatusPageGroup,
        result: result,
      }),
    ).toBe(true);

    expect(
      StatusPageResourceSearchUtil.isGroupVisible({
        statusPageGroup: groups[3] as StatusPageGroup,
        result: result,
      }),
    ).toBe(false);
  });
});

describe("StatusPageResourceSearchUtil.search - shared index", () => {
  /*
   * The overview builds one index per payload and hands it to every caller.
   * Passing it must not change a single answer.
   */
  test("results are identical whether or not an index is handed in", () => {
    for (const query of ["checkout", "europe", "legacy", "nothing"]) {
      const withoutIndex: StatusPageResourceSearchResult =
        StatusPageResourceSearchUtil.search({
          query: query,
          statusPageResources: makeResources(),
          statusPageGroups: makeGroups(),
        });

      const withIndex: StatusPageResourceSearchResult =
        StatusPageResourceSearchUtil.search({
          query: query,
          statusPageResources: makeResources(),
          statusPageGroups: makeGroups(),
          statusPageGroupTreeIndex: StatusPageGroupTreeUtil.buildIndex({
            statusPageGroups: makeGroups(),
          }),
        });

      expect(Array.from(withIndex.matchedResourceIds).sort()).toEqual(
        Array.from(withoutIndex.matchedResourceIds).sort(),
      );
      expect(Array.from(withIndex.visibleGroupIds).sort()).toEqual(
        Array.from(withoutIndex.visibleGroupIds).sort(),
      );
    }
  });
});

describe("StatusPageResourceSearchUtil.normalizeQuery", () => {
  test("trims and lowercases", () => {
    expect(StatusPageResourceSearchUtil.normalizeQuery("  API  ")).toBe("api");
  });

  test("null and undefined become an empty query", () => {
    expect(StatusPageResourceSearchUtil.normalizeQuery(null)).toBe("");
    expect(StatusPageResourceSearchUtil.normalizeQuery(undefined)).toBe("");
  });
});

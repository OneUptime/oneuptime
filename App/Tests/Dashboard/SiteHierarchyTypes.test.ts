import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  SiteChildrenResponse,
  SiteMapResponse,
  SiteSearchResponse,
  SiteSearchResultView,
  parseSiteChildrenResponse,
  parseSiteMapResponse,
  parseSiteSearchResponse,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTypes";

/*
 * Pins the defensive parsers over the /network-site/children and
 * /network-site/map payloads: well-formed rows narrow faithfully,
 * malformed rows drop instead of throwing, and missing scalars fall back
 * to safe defaults — the map page must render whatever a partially
 * broken (or future) server sends.
 *
 * isUnitLevel gets its own attention below: it is the flag NetworkMap
 * branches on to open a device topology instead of a child-site graph, so
 * it must be strictly boolean and default to false. A truthy-but-not-true
 * value drilling a container into an empty topology would be a real bug.
 */

describe("parseSiteChildrenResponse", () => {
  test("undefined/empty payloads narrow to an empty response", () => {
    const expected: SiteChildrenResponse = {
      breadcrumb: [],
      children: [],
      links: [],
      childrenTruncated: false,
      descendantCountsTruncated: false,
    };
    expect(parseSiteChildrenResponse(undefined)).toEqual(expected);
    expect(parseSiteChildrenResponse({})).toEqual(expected);
    expect(
      parseSiteChildrenResponse({
        breadcrumb: "nope",
        children: 42,
        links: null,
      } as unknown as JSONObject),
    ).toEqual(expected);
  });

  test("a full well-formed payload narrows faithfully", () => {
    const parsed: SiteChildrenResponse = parseSiteChildrenResponse({
      breadcrumb: [
        { id: "root", name: "East", siteType: "Region", isUnitLevel: false },
        {
          id: "f1",
          name: "Acme Franchising",
          siteType: "Franchisee",
          isUnitLevel: false,
        },
      ],
      children: [
        {
          id: "m1",
          name: "Kansas City Market",
          siteType: "Market",
          isUnitLevel: false,
          currentMonitorStatus: {
            id: "s1",
            name: "Operational",
            color: "#10b981",
            priority: 1,
            isOperationalState: true,
          },
          childSiteCount: 12,
          deviceCount: 48,
          unitStats: { totalUnits: 12, operationalUnits: 11 },
          uptimePercent: 99.95,
        },
      ],
      links: [
        {
          id: "l1",
          name: "KC ↔ STL",
          fromSiteId: "m1",
          toSiteId: "m2",
          monitorStatus: { name: "Degraded", color: "#f59e0b", priority: 3 },
        },
      ],
      childrenTruncated: true,
      descendantCountsTruncated: false,
    } as unknown as JSONObject);

    expect(parsed.breadcrumb).toEqual([
      { id: "root", name: "East", siteType: "Region", isUnitLevel: false },
      {
        id: "f1",
        name: "Acme Franchising",
        siteType: "Franchisee",
        isUnitLevel: false,
      },
    ]);
    expect(parsed.children).toHaveLength(1);
    expect(parsed.children[0]).toEqual({
      id: "m1",
      name: "Kansas City Market",
      siteType: "Market",
      isUnitLevel: false,
      currentMonitorStatus: {
        id: "s1",
        name: "Operational",
        color: "#10b981",
        priority: 1,
        isOperationalState: true,
      },
      childSiteCount: 12,
      deviceCount: 48,
      unitStats: { totalUnits: 12, operationalUnits: 11 },
      uptimePercent: 99.95,
    });
    expect(parsed.links[0]).toEqual({
      id: "l1",
      name: "KC ↔ STL",
      fromSiteId: "m1",
      toSiteId: "m2",
      monitorStatus: { name: "Degraded", color: "#f59e0b", priority: 3 },
    });
    expect(parsed.childrenTruncated).toBe(true);
    expect(parsed.descendantCountsTruncated).toBe(false);
  });

  test("rows without an id are dropped, in every collection", () => {
    const parsed: SiteChildrenResponse = parseSiteChildrenResponse({
      breadcrumb: [{ name: "No id" }, null, { id: "ok", name: "Ok" }],
      children: [{ name: "No id" }, 7, { id: "c1" }],
      links: [{}, { id: "l1" }],
    } as unknown as JSONObject);
    expect(parsed.breadcrumb).toHaveLength(1);
    expect(parsed.breadcrumb[0]!.id).toBe("ok");
    expect(parsed.children).toHaveLength(1);
    expect(parsed.children[0]!.id).toBe("c1");
    expect(parsed.links).toHaveLength(1);
    expect(parsed.links[0]!.id).toBe("l1");
  });

  test("missing child fields fall back to safe defaults", () => {
    const parsed: SiteChildrenResponse = parseSiteChildrenResponse({
      children: [{ id: "c1" }],
    } as unknown as JSONObject);
    expect(parsed.children[0]).toEqual({
      id: "c1",
      name: "Unnamed site",
      siteType: "Other",
      isUnitLevel: false,
      currentMonitorStatus: undefined,
      childSiteCount: 0,
      deviceCount: 0,
      unitStats: { totalUnits: 0, operationalUnits: 0 },
      uptimePercent: null,
    });
  });

  test("malformed status objects and non-numeric uptime are neutralized", () => {
    const parsed: SiteChildrenResponse = parseSiteChildrenResponse({
      children: [
        {
          id: "c1",
          currentMonitorStatus: { name: "Missing id" },
          childSiteCount: "12",
          uptimePercent: "99.9",
          unitStats: { totalUnits: "3" },
        },
        {
          id: "c2",
          currentMonitorStatus: { id: "s1" },
          uptimePercent: Number.NaN,
        },
      ],
      links: [{ id: "l1", monitorStatus: "broken" }],
    } as unknown as JSONObject);

    // Status without an id is no status at all.
    expect(parsed.children[0]!.currentMonitorStatus).toBeUndefined();
    expect(parsed.children[0]!.childSiteCount).toBe(0);
    expect(parsed.children[0]!.uptimePercent).toBeNull();
    expect(parsed.children[0]!.unitStats).toEqual({
      totalUnits: 0,
      operationalUnits: 0,
    });
    // Status with an id gets defaults for the rest.
    expect(parsed.children[1]!.currentMonitorStatus).toEqual({
      id: "s1",
      name: "Unknown",
      color: undefined,
      priority: 0,
      isOperationalState: false,
    });
    expect(parsed.children[1]!.uptimePercent).toBeNull();
    // A non-object link status is dropped, not crashed on.
    expect(parsed.links[0]!.monitorStatus).toBeUndefined();
  });

  test("uptimePercent of exactly 0 survives (falsy but real)", () => {
    const parsed: SiteChildrenResponse = parseSiteChildrenResponse({
      children: [{ id: "c1", uptimePercent: 0 }],
    } as unknown as JSONObject);
    expect(parsed.children[0]!.uptimePercent).toBe(0);
  });

  test("isUnitLevel is strictly boolean on breadcrumbs and children", () => {
    const parsed: SiteChildrenResponse = parseSiteChildrenResponse({
      breadcrumb: [
        { id: "b1", isUnitLevel: true },
        { id: "b2", isUnitLevel: "true" },
      ],
      children: [
        { id: "c1", isUnitLevel: true },
        { id: "c2", isUnitLevel: 1 },
        { id: "c3" },
      ],
    } as unknown as JSONObject);
    expect(
      parsed.breadcrumb.map((entry: { isUnitLevel: boolean }) => {
        return entry.isUnitLevel;
      }),
    ).toEqual([true, false]);
    expect(
      parsed.children.map((child: { isUnitLevel: boolean }) => {
        return child.isUnitLevel;
      }),
    ).toEqual([true, false, false]);
  });
});

/*
 * The map payload grew a hierarchy: /network-site/map answers with one row
 * per CHILD of the level in view, each carrying where it sits, what is
 * under it and how that is doing. The parser has to narrow all of it
 * defensively, and — because the rollups drive both the size and the color
 * of a marker — it has to refuse to pass through numbers that would draw a
 * marker claiming something untrue.
 */
describe("parseSiteMapResponse", () => {
  test("undefined/empty payloads narrow to an empty grouped response", () => {
    const expected: SiteMapResponse = {
      mode: "grouped",
      sites: [],
      links: [],
      unplacedSites: [],
      isTruncated: false,
    };
    expect(parseSiteMapResponse(undefined)).toEqual(expected);
    expect(parseSiteMapResponse({})).toEqual(expected);
    expect(
      parseSiteMapResponse({
        sites: "nope",
        links: "nope",
        unplacedSites: 42,
      } as unknown as JSONObject),
    ).toEqual(expected);
  });

  test("a well-formed container marker narrows faithfully", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      mode: "grouped",
      sites: [
        {
          id: "r1",
          name: "Region 1000",
          siteType: "Region",
          isUnitLevel: false,
          latitude: 39.1,
          longitude: -94.58,
          statusPriority: 3,
          isOperational: false,
          parentBreadcrumb: "",
          isContainer: true,
          isDerivedLocation: true,
          locatedDescendantCount: 69,
          unlocatedDescendantCount: 2,
          totalUnits: 69,
          operationalUnits: 0,
          childSiteCount: 4,
        },
      ],
      isTruncated: true,
    } as unknown as JSONObject);
    expect(parsed.isTruncated).toBe(true);
    expect(parsed.sites).toEqual([
      {
        id: "r1",
        name: "Region 1000",
        siteType: "Region",
        isUnitLevel: false,
        latitude: 39.1,
        longitude: -94.58,
        statusPriority: 3,
        isOperational: false,
        parentBreadcrumb: "",
        isContainer: true,
        isDerivedLocation: true,
        locatedDescendantCount: 69,
        unlocatedDescendantCount: 2,
        totalUnits: 69,
        operationalUnits: 0,
        childSiteCount: 4,
      },
    ]);
  });

  test("a flat pin from a server that predates grouping is not a container", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [
        {
          id: "u1",
          name: "Store #42",
          siteType: "Unit",
          isUnitLevel: true,
          latitude: 39.1,
          longitude: -94.58,
          statusPriority: 3,
          isOperational: false,
          parentBreadcrumb: "East / Acme / KC",
        },
      ],
    } as unknown as JSONObject);
    expect(parsed.sites[0]).toEqual({
      id: "u1",
      name: "Store #42",
      siteType: "Unit",
      isUnitLevel: true,
      latitude: 39.1,
      longitude: -94.58,
      statusPriority: 3,
      isOperational: false,
      parentBreadcrumb: "East / Acme / KC",
      isContainer: false,
      isDerivedLocation: false,
      locatedDescendantCount: 0,
      unlocatedDescendantCount: 0,
      totalUnits: 0,
      operationalUnits: 0,
      childSiteCount: 0,
    });
  });

  test("markers without an id or with non-finite coordinates are dropped", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [
        { name: "No id", latitude: 1, longitude: 2 },
        { id: "no-coords" },
        { id: "string-coords", latitude: "39.1", longitude: "-94.58" },
        { id: "nan-lat", latitude: Number.NaN, longitude: 0 },
        { id: "ok", latitude: 0, longitude: 0 },
      ],
    } as unknown as JSONObject);
    expect(parsed.sites).toHaveLength(1);
    expect(parsed.sites[0]!.id).toBe("ok");
  });

  /*
   * A CSV import that shifts a column by one lands a longitude in the
   * latitude field. Projected, that drags the marker — and the frame the
   * map fits around it — somewhere no site is, taking every other marker
   * off screen with it. Out of range is not a coordinate.
   */
  test("coordinates outside the real latitude/longitude ranges are dropped", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [
        { id: "lat-too-high", latitude: 1246.7, longitude: 0 },
        { id: "lat-too-low", latitude: -90.5, longitude: 0 },
        { id: "lon-too-high", latitude: 0, longitude: 180.001 },
        { id: "lon-too-low", latitude: 0, longitude: -181 },
        { id: "north-pole", latitude: 90, longitude: 180 },
        { id: "south-pole", latitude: -90, longitude: -180 },
      ],
    } as unknown as JSONObject);
    expect(
      parsed.sites.map((site: { id: string }) => {
        return site.id;
      }),
    ).toEqual(["north-pole", "south-pole"]);
  });

  test("missing optional fields fall back to safe defaults", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [{ id: "u1", latitude: 10, longitude: 20 }],
    } as unknown as JSONObject);
    expect(parsed.sites[0]).toEqual({
      id: "u1",
      name: "Unnamed site",
      siteType: "Other",
      isUnitLevel: false,
      latitude: 10,
      longitude: 20,
      statusPriority: 0,
      isOperational: null,
      parentBreadcrumb: "",
      isContainer: false,
      isDerivedLocation: false,
      locatedDescendantCount: 0,
      unlocatedDescendantCount: 0,
      totalUnits: 0,
      operationalUnits: 0,
      childSiteCount: 0,
    });
  });

  test("isOperational keeps strict booleans and nulls everything else", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [
        { id: "a", latitude: 0, longitude: 0, isOperational: true },
        { id: "b", latitude: 0, longitude: 0, isOperational: false },
        { id: "c", latitude: 0, longitude: 0, isOperational: "true" },
        { id: "d", latitude: 0, longitude: 0, isOperational: null },
      ],
    } as unknown as JSONObject);
    expect(
      parsed.sites.map((site: { isOperational: boolean | null }) => {
        return site.isOperational;
      }),
    ).toEqual([true, false, null, null]);
  });

  test("isContainer and isDerivedLocation are strictly boolean", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [
        {
          id: "a",
          latitude: 0,
          longitude: 0,
          isContainer: "yes",
          isDerivedLocation: 1,
        },
      ],
    } as unknown as JSONObject);
    expect(parsed.sites[0]!.isContainer).toBe(false);
    expect(parsed.sites[0]!.isDerivedLocation).toBe(false);
  });

  /*
   * A marker whose rollup says more units are healthy than exist would
   * color itself "all operational" over a level that is half dark. The
   * clamp is what makes the marker's color trustworthy.
   */
  test("operationalUnits can never exceed totalUnits", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [
        {
          id: "a",
          latitude: 0,
          longitude: 0,
          totalUnits: 4,
          operationalUnits: 99,
        },
      ],
    } as unknown as JSONObject);
    expect(parsed.sites[0]!.totalUnits).toBe(4);
    expect(parsed.sites[0]!.operationalUnits).toBe(4);
  });

  test("negative and non-finite rollup counts fall back to zero", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [
        {
          id: "a",
          latitude: 0,
          longitude: 0,
          totalUnits: -3,
          operationalUnits: -9,
          childSiteCount: Number.NaN,
          locatedDescendantCount: "12",
          unlocatedDescendantCount: -1,
        },
      ],
    } as unknown as JSONObject);
    expect(parsed.sites[0]).toMatchObject({
      totalUnits: 0,
      operationalUnits: 0,
      childSiteCount: 0,
      locatedDescendantCount: 0,
      unlocatedDescendantCount: 0,
    });
  });

  /*
   * An unrecognised mode has to read as the hierarchy view. Degrading to
   * "all" would put the flat every-store map — the thing this endpoint was
   * changed to stop being — back in front of the customer.
   */
  test("only the exact string all selects the flat mode", () => {
    expect(parseSiteMapResponse({ mode: "all" }).mode).toBe("all");
    expect(parseSiteMapResponse({ mode: "grouped" }).mode).toBe("grouped");
    expect(parseSiteMapResponse({ mode: "ALL" }).mode).toBe("grouped");
    expect(parseSiteMapResponse({ mode: "flat" }).mode).toBe("grouped");
    expect(
      parseSiteMapResponse({ mode: 1 } as unknown as JSONObject).mode,
    ).toBe("grouped");
  });

  /*
   * The map draws the links between its markers as lines. The parser is
   * what decides which rows can become one, and the load-bearing promise
   * is the negative: a link with NO monitor on it survives parsing intact,
   * because the monitor only decides what color the line is.
   */
  test("a well-formed link row narrows faithfully, monitor status and all", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      links: [
        {
          id: "l1",
          name: "DC1 to Midwest WAN",
          fromSiteId: "r1",
          toSiteId: "r2",
          monitorStatus: { name: "Degraded", color: "#f59e0b", priority: 2 },
        },
      ],
    } as unknown as JSONObject);
    expect(parsed.links).toEqual([
      {
        id: "l1",
        name: "DC1 to Midwest WAN",
        fromSiteId: "r1",
        toSiteId: "r2",
        monitorStatus: { name: "Degraded", color: "#f59e0b", priority: 2 },
      },
    ]);
  });

  test("a link with no monitor attached is kept, with no status on it", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      links: [
        { id: "l1", name: "Dark fibre", fromSiteId: "r1", toSiteId: "r2" },
        {
          id: "l2",
          name: "Null status",
          fromSiteId: "r1",
          toSiteId: "r3",
          monitorStatus: null,
        },
        /*
         * An array is an object to typeof, so the status parser has to
         * exclude it explicitly or a row like this narrows to a status
         * object of defaults — a line colored by nothing at all.
         */
        {
          id: "l3",
          name: "Array status",
          fromSiteId: "r1",
          toSiteId: "r4",
          monitorStatus: [],
        },
      ],
    } as unknown as JSONObject);
    expect(parsed.links.length).toBe(3);
    for (const link of parsed.links) {
      expect(link.monitorStatus).toBeUndefined();
    }
  });

  test("link rows missing an id or either end are dropped", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      links: [
        { name: "no id", fromSiteId: "r1", toSiteId: "r2" },
        { id: "l2", name: "no from", toSiteId: "r2" },
        { id: "l3", name: "no to", fromSiteId: "r1" },
        { id: "l4", name: "blank ends", fromSiteId: "", toSiteId: "" },
        {
          id: "l5",
          name: "non-string ends",
          fromSiteId: 7,
          toSiteId: { id: "r2" },
        },
        { id: "l6", name: "keeper", fromSiteId: "r1", toSiteId: "r2" },
      ],
    } as unknown as JSONObject);
    expect(
      parsed.links.map((link: { id: string }): string => {
        return link.id;
      }),
    ).toEqual(["l6"]);
  });

  test("a link row's missing scalars fall back rather than blanking the line", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      links: [
        {
          id: "l1",
          fromSiteId: "r1",
          toSiteId: "r2",
          monitorStatus: { color: 42, priority: "high" },
        },
      ],
    } as unknown as JSONObject);
    expect(parsed.links[0]).toEqual({
      id: "l1",
      name: "Unnamed link",
      fromSiteId: "r1",
      toSiteId: "r2",
      monitorStatus: { name: "Unknown", color: undefined, priority: 0 },
    });
  });

  /*
   * A server that predates link lines sends no links key at all. That has
   * to narrow to "no lines", never to a hole the map then iterates.
   */
  test("a payload with no links key narrows to no lines", () => {
    expect(parseSiteMapResponse({ mode: "all", sites: [] }).links).toEqual([]);
  });

  test("unplaced sites narrow, and rows without an id are dropped", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      unplacedSites: [
        { id: "r7", name: "Region 2100", siteType: "Region" },
        { name: "no id", siteType: "Region" },
        { id: "u9", isUnitLevel: true },
      ],
    } as unknown as JSONObject);
    expect(parsed.unplacedSites).toEqual([
      { id: "r7", name: "Region 2100", siteType: "Region", isUnitLevel: false },
      { id: "u9", name: "Unnamed site", siteType: "Other", isUnitLevel: true },
    ]);
  });
});

/*
 * The search payload gets the same defensive treatment as the other two: a
 * partially broken (or older) server must cost the reader a label, never the
 * whole search box.
 *
 * `path` earns its own attention. It is the only thing that tells two stores
 * called "Michigan Ave" apart before the click, and a root site legitimately
 * has none — so an absent path is the NORMAL case here and has to narrow to
 * "" rather than to a hole in the row.
 */
describe("parseSiteSearchResponse", () => {
  test("undefined/empty/malformed payloads narrow to an empty response", () => {
    const expected: SiteSearchResponse = { results: [], isTruncated: false };
    expect(parseSiteSearchResponse(undefined)).toEqual(expected);
    expect(parseSiteSearchResponse({})).toEqual(expected);
    expect(
      parseSiteSearchResponse({
        results: "nope",
        isTruncated: "yes",
      } as unknown as JSONObject),
    ).toEqual(expected);
  });

  test("a well-formed payload narrows faithfully", () => {
    const parsed: SiteSearchResponse = parseSiteSearchResponse({
      results: [
        {
          id: "u1",
          name: "Unit 104822 — Michigan Ave",
          siteType: "Store",
          isUnitLevel: true,
          path: "East / Acme Franchising / Chicago North",
          currentMonitorStatus: {
            id: "s1",
            name: "Operational",
            color: "#4ade80",
            priority: 1,
            isOperationalState: true,
          },
        },
      ],
      isTruncated: true,
    } as unknown as JSONObject);

    expect(parsed.isTruncated).toBe(true);
    expect(parsed.results).toEqual([
      {
        id: "u1",
        name: "Unit 104822 — Michigan Ave",
        siteType: "Store",
        isUnitLevel: true,
        path: "East / Acme Franchising / Chicago North",
        currentMonitorStatus: {
          id: "s1",
          name: "Operational",
          color: "#4ade80",
          priority: 1,
          isOperationalState: true,
        },
      },
    ]);
  });

  test("rows without an id are dropped; the rest fall back safely", () => {
    const parsed: SiteSearchResponse = parseSiteSearchResponse({
      results: [{ name: "no id at all", siteType: "Region" }, { id: "r1" }],
    } as unknown as JSONObject);

    expect(parsed.results).toEqual([
      {
        id: "r1",
        name: "Unnamed site",
        siteType: "Other",
        // Never inferred from a name — an unflagged row is a container.
        isUnitLevel: false,
        path: "",
        currentMonitorStatus: undefined,
      },
    ]);
  });

  /*
   * A root site has no ancestors. Its path is legitimately absent, and a
   * non-string one is corrupt — both narrow to "" so the row simply prints no
   * path line instead of "undefined" under the site's name.
   */
  test("a missing or non-string path narrows to no path", () => {
    expect(
      parseSiteSearchResponse({ results: [{ id: "r1", name: "East" }] })
        .results[0]!.path,
    ).toBe("");
    expect(
      parseSiteSearchResponse({
        results: [{ id: "r1", name: "East", path: 42 }],
      } as unknown as JSONObject).results[0]!.path,
    ).toBe("");
  });

  // isUnitLevel decides whether drilling opens a device topology or a level.
  test("isUnitLevel is strictly boolean", () => {
    const parsed: SiteSearchResponse = parseSiteSearchResponse({
      results: [
        { id: "a", isUnitLevel: true },
        { id: "b", isUnitLevel: "true" },
        { id: "c", isUnitLevel: 1 },
      ],
    } as unknown as JSONObject);
    expect(
      parsed.results.map((row: SiteSearchResultView): boolean => {
        return row.isUnitLevel;
      }),
    ).toEqual([true, false, false]);
  });
});

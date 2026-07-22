import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  SiteChildrenResponse,
  SiteMapResponse,
  parseSiteChildrenResponse,
  parseSiteMapResponse,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTypes";

/*
 * Pins the defensive parsers over the /network-site/children and
 * /network-site/map payloads: well-formed rows narrow faithfully,
 * malformed rows drop instead of throwing, and missing scalars fall back
 * to safe defaults — the map page must render whatever a partially
 * broken (or future) server sends.
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
        { id: "root", name: "East", siteType: "Region" },
        { id: "f1", name: "Acme Franchising", siteType: "Franchisee" },
      ],
      children: [
        {
          id: "m1",
          name: "Kansas City Market",
          siteType: "Market",
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
      { id: "root", name: "East", siteType: "Region" },
      { id: "f1", name: "Acme Franchising", siteType: "Franchisee" },
    ]);
    expect(parsed.children).toHaveLength(1);
    expect(parsed.children[0]).toEqual({
      id: "m1",
      name: "Kansas City Market",
      siteType: "Market",
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
});

describe("parseSiteMapResponse", () => {
  test("undefined/empty payloads narrow to an empty response", () => {
    const expected: SiteMapResponse = { sites: [], isTruncated: false };
    expect(parseSiteMapResponse(undefined)).toEqual(expected);
    expect(parseSiteMapResponse({})).toEqual(expected);
  });

  test("a well-formed pin narrows faithfully", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [
        {
          id: "u1",
          name: "Store #42",
          siteType: "Unit",
          latitude: 39.1,
          longitude: -94.58,
          statusPriority: 3,
          isOperational: false,
          parentBreadcrumb: "East / Acme / KC",
        },
      ],
      isTruncated: true,
    } as unknown as JSONObject);
    expect(parsed.isTruncated).toBe(true);
    expect(parsed.sites).toEqual([
      {
        id: "u1",
        name: "Store #42",
        siteType: "Unit",
        latitude: 39.1,
        longitude: -94.58,
        statusPriority: 3,
        isOperational: false,
        parentBreadcrumb: "East / Acme / KC",
      },
    ]);
  });

  test("pins without an id or with non-finite coordinates are dropped", () => {
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

  test("missing optional fields fall back to safe defaults", () => {
    const parsed: SiteMapResponse = parseSiteMapResponse({
      sites: [{ id: "u1", latitude: 10, longitude: 20 }],
    } as unknown as JSONObject);
    expect(parsed.sites[0]).toEqual({
      id: "u1",
      name: "Unnamed site",
      siteType: "Other",
      latitude: 10,
      longitude: 20,
      statusPriority: 0,
      isOperational: null,
      parentBreadcrumb: "",
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
});

import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiLimits,
  TopologyConnectionRowJSON,
  TopologyConnectionSectionJSON,
  TopologyEntityConnectionsResponseJSON,
  TopologyEntityResponseJSON,
} from "Common/Types/Topology/TopologyApi";
import type {
  AppendedConnectionsPage,
  EntityConnection,
  EntityConnectionSection,
  EntityConnectionsPage,
  EntityDetailData,
} from "../../FeatureSet/Dashboard/src/Components/Topology/EntityDetailApi";

/*
 * The topology drawer's transport: the request bodies it posts for an
 * entity and for "Show more", and the decoders that turn the server's
 * epoch-millisecond, null-heavy JSON into the drawer's shapes — Dates, full
 * attribute bags, exact totals, and a hard stop when the server speaks a
 * different format than this bundle.
 *
 * API and ModelAPI are mocked before the module loads; the module also
 * pulls in Common/UI/Config, which reads `window` on load, so the browser
 * stub is installed first and the import is deferred — the same pattern as
 * ReplayUserSessions.test.ts.
 */

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

type EntityDetailApiModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Topology/EntityDetailApi");
type TopologyApiModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Topology/TopologyApi");

let api: EntityDetailApiModule;
/* The drawer shares the maps' "reload the page" error. */
let TopologyOutdatedError: TopologyApiModule["TopologyOutdatedError"];
/* ...and the maps' "busy, try again" copy for a 429. */
let TOPOLOGY_BUSY_MESSAGE: string;
let postMock: jest.Mock;

const RANGE_START: Date = new Date("2026-09-26T10:00:00.000Z");
const FIRST_SEEN_MS: number = Date.parse("2026-08-01T00:00:00.000Z");
const LAST_SEEN_MS: number = Date.parse("2026-09-26T10:14:00.000Z");

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
  headers: Record<string, string>;
  options: { signal?: AbortSignal };
}

function row(
  overrides: Partial<TopologyConnectionRowJSON> = {},
): TopologyConnectionRowJSON {
  return {
    relationshipType: "depends-on",
    direction: "out",
    otherKey: "db-key",
    otherKnown: true,
    otherName: "orders",
    otherType: "database",
    callCount: 120,
    errorCount: 3,
    avgDurationMs: 4.5,
    lastSeenAt: LAST_SEEN_MS,
    ...overrides,
  };
}

function section(
  rows: Array<TopologyConnectionRowJSON>,
  overrides: Partial<TopologyConnectionSectionJSON> = {},
): TopologyConnectionSectionJSON {
  return {
    total: rows.length,
    unknownTotal: 0,
    rows: rows,
    nextOffset: null,
    ...overrides,
  };
}

function emptySectionJSON(): TopologyConnectionSectionJSON {
  return section([]);
}

function entityResponse(
  overrides: Partial<TopologyEntityResponseJSON> = {},
): TopologyEntityResponseJSON {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: "2026-09-26T10:00:00.000Z",
    generatedAt: "2026-09-26T10:15:00.000Z",
    entity: {
      id: "5b2f5b1c-0000-4000-8000-000000000001",
      key: "svc-key",
      type: "service",
      name: "checkout",
      source: "telemetry",
      lastSeenAt: LAST_SEEN_MS,
      firstSeenAt: FIRST_SEEN_MS,
      resourceType: "Service",
      resourceId: "5b2f5b1c-0000-4000-8000-0000000000aa",
      identifyingAttributes: { "service.name": "checkout" },
      descriptiveAttributes: {
        "telemetry.sdk.language": "nodejs",
        "process.pid": 42,
        "deployment.tags": ["a", "b"],
      },
    },
    sections: {
      calls: section([row()], { total: 7, nextOffset: 1 }),
      calledBy: section([
        row({ direction: "in", otherKey: "web", otherName: "web" }),
      ]),
      runsOn: section(
        [
          row({
            relationshipType: "runs-on",
            otherKey: "pod-1",
            otherName: "checkout-7d9f",
            otherType: "k8s.pod",
            callCount: null,
            errorCount: null,
            avgDurationMs: null,
          }),
        ],
        { total: 40, unknownTotal: 3, nextOffset: 1 },
      ),
      related: emptySectionJSON(),
    },
    isScanLimited: false,
    ...overrides,
  };
}

function connectionsResponse(
  overrides: Partial<TopologyEntityConnectionsResponseJSON> = {},
): TopologyEntityConnectionsResponseJSON {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: "2026-09-26T10:00:00.000Z",
    generatedAt: "2026-09-26T10:15:00.000Z",
    section: "runsOn",
    connections: section(
      [
        row({
          relationshipType: "runs-on",
          otherKey: "pod-2",
          otherName: "checkout-8a1b",
          otherType: "k8s.pod",
        }),
      ],
      { total: 40, unknownTotal: 3, nextOffset: 26 },
    ),
    isScanLimited: false,
    ...overrides,
  };
}

function asJSON(value: unknown): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function lastRequest(): PostRequest {
  const calls: Array<Array<unknown>> = postMock.mock.calls;
  return calls[calls.length - 1]![0] as PostRequest;
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        /* never asserted on */
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          /* no-op */
        },
        removeItem: (): void => {
          /* no-op */
        },
      },
      configurable: true,
      writable: true,
    });
  }

  const apiModule: { default: { post: jest.Mock } } = (await import(
    "Common/UI/Utils/API/API"
  )) as unknown as { default: { post: jest.Mock } };
  postMock = apiModule.default.post;

  api = await import(
    "../../FeatureSet/Dashboard/src/Components/Topology/EntityDetailApi"
  );
  const topologyApi: TopologyApiModule = await import(
    "../../FeatureSet/Dashboard/src/Components/Topology/TopologyApi"
  );
  TopologyOutdatedError = topologyApi.TopologyOutdatedError;
  TOPOLOGY_BUSY_MESSAGE = topologyApi.TOPOLOGY_BUSY_MESSAGE;
});

beforeEach(() => {
  postMock.mockReset();
});

describe("entity drawer requests", () => {
  test("an entity request carries the range start and the key, and the type only when known", () => {
    expect(
      api.buildEntityDetailRequest(
        { entityKey: "svc-key", entityType: "service", displayName: "x" },
        RANGE_START,
      ),
    ).toEqual({
      rangeStart: "2026-09-26T10:00:00.000Z",
      entityKey: "svc-key",
      entityType: "service",
    });

    const keyOnly: JSONObject = asJSON(
      api.buildEntityDetailRequest({ entityKey: "pod-key" }, RANGE_START),
    );
    expect(keyOnly).toEqual({
      rangeStart: "2026-09-26T10:00:00.000Z",
      entityKey: "pod-key",
    });
    expect("entityType" in keyOnly).toBe(false);
    /* The display name is the caller's preview, never a lookup key. */
    expect(
      "displayName" in
        asJSON(
          api.buildEntityDetailRequest(
            { entityKey: "k", displayName: "shown" },
            RANGE_START,
          ),
        ),
    ).toBe(false);
  });

  test("a connections request names the section and pages within the server's limits", () => {
    expect(
      api.buildEntityConnectionsRequest(
        { entityKey: "svc-key", entityType: "service" },
        RANGE_START,
        "calls",
        100,
        100,
      ),
    ).toEqual({
      rangeStart: "2026-09-26T10:00:00.000Z",
      entityKey: "svc-key",
      entityType: "service",
      section: "calls",
      offset: 100,
      limit: 100,
    });

    const clamped: JSONObject = asJSON(
      api.buildEntityConnectionsRequest(
        { entityKey: "k" },
        RANGE_START,
        "related",
        -5,
        10_000,
      ),
    );
    expect(clamped["offset"]).toBe(0);
    expect(clamped["limit"]).toBe(
      TopologyApiLimits.EntityConnectionsPageSizeMax,
    );

    const fractional: JSONObject = asJSON(
      api.buildEntityConnectionsRequest(
        { entityKey: "k" },
        RANGE_START,
        "related",
        25.7,
        0,
      ),
    );
    expect(fractional["offset"]).toBe(25);
    expect(fractional["limit"]).toBe(1);
  });

  test("'Show more' asks for as many rows as each section first shows", () => {
    expect(api.pageSizeForSection("calls")).toBe(
      TopologyApiLimits.EntityDependencyRows,
    );
    expect(api.pageSizeForSection("calledBy")).toBe(
      TopologyApiLimits.EntityDependencyRows,
    );
    expect(api.pageSizeForSection("runsOn")).toBe(
      TopologyApiLimits.EntityOtherRows,
    );
    expect(api.pageSizeForSection("related")).toBe(
      TopologyApiLimits.EntityOtherRows,
    );
  });

  test("'Reload list' asks for what the section showed plus a page, within the page cap", () => {
    expect(api.sectionReloadLimit("runsOn", 39)).toBe(
      39 + TopologyApiLimits.EntityOtherRows,
    );
    expect(api.sectionReloadLimit("related", 0)).toBe(
      TopologyApiLimits.EntityOtherRows,
    );
    expect(api.sectionReloadLimit("calls", 50)).toBe(
      50 + TopologyApiLimits.EntityDependencyRows,
    );
    expect(api.sectionReloadLimit("calledBy", 150)).toBe(
      TopologyApiLimits.EntityConnectionsPageSizeMax,
    );
    expect(api.sectionReloadLimit("runsOn", 10_000)).toBe(
      TopologyApiLimits.EntityConnectionsPageSizeMax,
    );
  });
});

describe("decodeEntityDetailResponse", () => {
  test("decodes the full row: dates, the resource pointer and every attribute", () => {
    const decoded: EntityDetailData = api.decodeEntityDetailResponse(
      asJSON(entityResponse()),
    );

    expect(decoded.rangeStart).toEqual(RANGE_START);
    expect(decoded.isScanLimited).toBe(false);
    expect(decoded.entity).toEqual({
      id: "5b2f5b1c-0000-4000-8000-000000000001",
      entityKey: "svc-key",
      entityType: "service",
      displayName: "checkout",
      source: "telemetry",
      lastSeenAt: new Date(LAST_SEEN_MS),
      firstSeenAt: new Date(FIRST_SEEN_MS),
      resourceType: "Service",
      resourceId: "5b2f5b1c-0000-4000-8000-0000000000aa",
      identifyingAttributes: { "service.name": "checkout" },
      /* Full bags: non-string values survive for the Inventory-style reader. */
      descriptiveAttributes: {
        "telemetry.sdk.language": "nodejs",
        "process.pid": 42,
        "deployment.tags": ["a", "b"],
      },
    });
    expect(decoded.entity!.lastSeenAt).toBeInstanceOf(Date);
  });

  test("decodes every section with exact totals, unknown counts and paging offsets", () => {
    const decoded: EntityDetailData = api.decodeEntityDetailResponse(
      asJSON(entityResponse()),
    );

    expect(decoded.sections.calls.total).toBe(7);
    expect(decoded.sections.calls.nextOffset).toBe(1);
    expect(decoded.sections.calls.rows).toEqual([
      {
        relationshipType: "depends-on",
        direction: "out",
        otherKey: "db-key",
        otherKnown: true,
        otherName: "orders",
        otherType: "database",
        callCount: 120,
        errorCount: 3,
        avgDurationMs: 4.5,
        lastSeenAt: new Date(LAST_SEEN_MS),
      },
    ]);
    expect(decoded.sections.calledBy.rows[0]!.direction).toBe("in");
    expect(decoded.sections.calledBy.nextOffset).toBeNull();

    const runsOn: EntityConnectionSection = decoded.sections.runsOn;
    expect(runsOn.total).toBe(40);
    expect(runsOn.unknownTotal).toBe(3);
    /* Relationships without metrics carry none, rather than zeros. */
    expect(runsOn.rows[0]!.callCount).toBeUndefined();
    expect(runsOn.rows[0]!.errorCount).toBeUndefined();
    expect(runsOn.rows[0]!.avgDurationMs).toBeUndefined();

    expect(decoded.sections.related).toEqual({
      total: 0,
      unknownTotal: 0,
      rows: [],
      nextOffset: null,
    });
  });

  test("the other end of a relationship nothing reported stays a row, marked unknown", () => {
    const decoded: EntityDetailData = api.decodeEntityDetailResponse(
      asJSON(
        entityResponse({
          sections: {
            calls: section([
              row({
                otherKey: "never-seen",
                otherKnown: false,
                otherName: null,
                otherType: null,
              }),
            ]),
            calledBy: emptySectionJSON(),
            runsOn: emptySectionJSON(),
            related: emptySectionJSON(),
          },
        }),
      ),
    );

    const unknown: EntityConnection = decoded.sections.calls.rows[0]!;
    expect(unknown.otherKey).toBe("never-seen");
    expect(unknown.otherKnown).toBe(false);
    expect(unknown.otherName).toBeUndefined();
    expect(unknown.otherType).toBeUndefined();
  });

  test("a scan-limited response says its totals are lower bounds", () => {
    expect(
      api.decodeEntityDetailResponse(
        asJSON(entityResponse({ isScanLimited: true })),
      ).isScanLimited,
    ).toBe(true);
  });

  test("a key no item has any more decodes to a missing entity with nothing to list", () => {
    const decoded: EntityDetailData = api.decodeEntityDetailResponse(
      asJSON(
        entityResponse({
          entity: null,
          /* Whatever else came back is not shown for a missing entity. */
          sections: entityResponse().sections,
        }),
      ),
    );

    expect(decoded.entity).toBeNull();
    for (const decodedSection of Object.values(decoded.sections)) {
      expect(decodedSection).toEqual({
        total: 0,
        unknownTotal: 0,
        rows: [],
        nextOffset: null,
      });
    }
  });

  test("blank names, null timestamps and null bags decode to absent values", () => {
    const decoded: EntityDetailData = api.decodeEntityDetailResponse(
      asJSON(
        entityResponse({
          entity: {
            id: "id-1",
            key: "k",
            type: "host",
            name: "",
            source: "discovered",
            lastSeenAt: null,
            firstSeenAt: null,
            resourceType: null,
            resourceId: null,
            identifyingAttributes: null,
            descriptiveAttributes: null,
          },
        }),
      ),
    );

    expect(decoded.entity).toEqual({
      id: "id-1",
      entityKey: "k",
      entityType: "host",
      displayName: undefined,
      source: "discovered",
      lastSeenAt: undefined,
      firstSeenAt: undefined,
      resourceType: undefined,
      resourceId: undefined,
      identifyingAttributes: undefined,
      descriptiveAttributes: undefined,
    });
  });

  test("malformed parts degrade instead of throwing: bad rows are dropped, counts stay sane", () => {
    const payload: JSONObject = asJSON(entityResponse());
    const sections: JSONObject = payload["sections"] as JSONObject;
    sections["calls"] = {
      /* Fewer than the rows it sent: the rows are the lower bound. */
      total: 0,
      unknownTotal: 99,
      rows: [
        null,
        "not a row",
        { relationshipType: "depends-on" },
        {
          otherKey: "kept",
          direction: "sideways",
          otherKnown: "yes",
          callCount: "12",
          lastSeenAt: "yesterday",
        },
      ],
      nextOffset: -1,
    };
    delete sections["related"];
    sections["runsOn"] = "nonsense";

    const decoded: EntityDetailData = api.decodeEntityDetailResponse(payload);

    expect(decoded.sections.calls.rows).toEqual([
      {
        relationshipType: "",
        direction: "out",
        otherKey: "kept",
        otherKnown: false,
        otherName: undefined,
        otherType: undefined,
        callCount: undefined,
        errorCount: undefined,
        avgDurationMs: undefined,
        lastSeenAt: undefined,
      },
    ]);
    expect(decoded.sections.calls.total).toBe(1);
    expect(decoded.sections.calls.unknownTotal).toBe(1);
    expect(decoded.sections.calls.nextOffset).toBeNull();
    expect(decoded.sections.runsOn.rows).toEqual([]);
    expect(decoded.sections.related.total).toBe(0);
  });

  test("an unreadable range start is null, not an Invalid Date", () => {
    expect(
      api.decodeEntityDetailResponse(
        asJSON(entityResponse({ rangeStart: "not a date" })),
      ).rangeStart,
    ).toBeNull();
  });

  test("an entity without a key is treated as missing", () => {
    const payload: JSONObject = asJSON(entityResponse());
    (payload["entity"] as JSONObject)["key"] = "";

    expect(api.decodeEntityDetailResponse(payload).entity).toBeNull();
  });

  test.each([
    ["an older format", { formatVersion: TOPOLOGY_API_FORMAT_VERSION - 1 }],
    ["a newer format", { formatVersion: TOPOLOGY_API_FORMAT_VERSION + 1 }],
    ["no format at all", { formatVersion: undefined }],
  ])(
    "%s is reported as an outdated bundle, never misread",
    (_label: string, overrides: JSONObject) => {
      const payload: JSONObject = { ...asJSON(entityResponse()), ...overrides };
      if (overrides["formatVersion"] === undefined) {
        delete payload["formatVersion"];
      }

      expect(() => {
        return api.decodeEntityDetailResponse(payload);
      }).toThrow(TopologyOutdatedError);
    },
  );

  test("the outdated error records which format the server spoke", () => {
    let thrown: unknown = null;
    try {
      api.decodeEntityDetailResponse(
        asJSON(
          entityResponse({ formatVersion: TOPOLOGY_API_FORMAT_VERSION + 1 }),
        ),
      );
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TopologyOutdatedError);
    expect(
      (thrown as InstanceType<typeof TopologyOutdatedError>)
        .serverFormatVersion,
    ).toBe(TOPOLOGY_API_FORMAT_VERSION + 1);
    expect((thrown as Error).message).toBe(
      "Topology was updated. Reload the page.",
    );
  });

  test.each([[null], ["text"], [[1, 2, 3]], [42]])(
    "a body that is not an object (%j) is not a Topology response",
    (body: unknown) => {
      expect(() => {
        return api.decodeEntityDetailResponse(body);
      }).toThrow(TopologyOutdatedError);
    },
  );
});

describe("decodeEntityConnectionsResponse", () => {
  test("decodes one section's next page", () => {
    const page: EntityConnectionsPage = api.decodeEntityConnectionsResponse(
      asJSON(connectionsResponse({ isScanLimited: true })),
      "runsOn",
    );

    expect(page.section).toBe("runsOn");
    expect(page.isScanLimited).toBe(true);
    expect(page.rangeStart).toEqual(RANGE_START);
    expect(page.connections.total).toBe(40);
    expect(page.connections.unknownTotal).toBe(3);
    expect(page.connections.nextOffset).toBe(26);
    expect(
      page.connections.rows.map((r: EntityConnection) => {
        return r.otherKey;
      }),
    ).toEqual(["pod-2"]);
  });

  test("a page of another section is refused rather than appended to the wrong list", () => {
    expect(() => {
      return api.decodeEntityConnectionsResponse(
        asJSON(connectionsResponse({ section: "related" })),
        "runsOn",
      );
    }).toThrow(/runsOn/);
  });

  test("a format mismatch is an outdated bundle here too", () => {
    expect(() => {
      return api.decodeEntityConnectionsResponse(
        asJSON(connectionsResponse({ formatVersion: 99 })),
        "runsOn",
      );
    }).toThrow(TopologyOutdatedError);
  });
});

describe("appendConnectionsPage", () => {
  function decodedRow(
    otherKey: string,
    direction: "out" | "in" = "out",
  ): EntityConnection {
    return {
      relationshipType: "runs-on",
      direction: direction,
      otherKey: otherKey,
      otherKnown: true,
    };
  }

  test("appends new rows, takes the latest counts and names the first new row", () => {
    const current: EntityConnectionSection = {
      total: 40,
      unknownTotal: 3,
      rows: [decodedRow("a"), decodedRow("b")],
      nextOffset: 2,
    };
    const result: AppendedConnectionsPage = api.appendConnectionsPage(
      "runsOn",
      current,
      {
        total: 41,
        unknownTotal: 4,
        rows: [decodedRow("c"), decodedRow("d")],
        nextOffset: 4,
      },
    );

    expect(
      result.merged.rows.map((r: EntityConnection) => {
        return r.otherKey;
      }),
    ).toEqual(["a", "b", "c", "d"]);
    expect(result.merged.total).toBe(41);
    expect(result.merged.unknownTotal).toBe(4);
    expect(result.merged.nextOffset).toBe(4);
    expect(result.firstNewRowId).toBe(
      api.connectionId("runsOn", decodedRow("c")),
    );
    /* Pages that line up with what is shown: nothing was skipped. */
    expect(result.listChanged).toBe(false);
    /* The current section is not mutated. */
    expect(current.rows).toHaveLength(2);
  });

  test("rows the drawer already shows are skipped when offsets shift between requests", () => {
    const result: AppendedConnectionsPage = api.appendConnectionsPage(
      "runsOn",
      {
        total: 3,
        unknownTotal: 0,
        rows: [decodedRow("a"), decodedRow("b")],
        nextOffset: 2,
      },
      {
        total: 3,
        unknownTotal: 0,
        rows: [decodedRow("b"), decodedRow("c")],
        nextOffset: null,
      },
    );

    expect(
      result.merged.rows.map((r: EntityConnection) => {
        return r.otherKey;
      }),
    ).toEqual(["a", "b", "c"]);
    expect(result.firstNewRowId).toBe(
      api.connectionId("runsOn", decodedRow("c")),
    );
    expect(result.merged.nextOffset).toBeNull();
    /*
     * A repeated row means the ranking moved under the user: whatever took
     * its place may never be returned, so the drawer offers a reload.
     */
    expect(result.listChanged).toBe(true);
  });

  test("a page with nothing new names no row to focus, and the total never trails the rows", () => {
    const result: AppendedConnectionsPage = api.appendConnectionsPage(
      "related",
      {
        total: 2,
        unknownTotal: 0,
        rows: [decodedRow("a"), decodedRow("b")],
        nextOffset: 2,
      },
      { total: 1, unknownTotal: 5, rows: [decodedRow("a")], nextOffset: null },
    );

    expect(result.firstNewRowId).toBeNull();
    expect(result.merged.total).toBe(2);
    expect(result.merged.unknownTotal).toBe(2);
    expect(result.listChanged).toBe(true);
  });

  test("a last page that leaves the list short of its total is a changed list", () => {
    const result: AppendedConnectionsPage = api.appendConnectionsPage(
      "runsOn",
      {
        total: 4,
        unknownTotal: 0,
        rows: [decodedRow("a"), decodedRow("b")],
        nextOffset: 2,
      },
      { total: 4, unknownTotal: 0, rows: [decodedRow("d")], nextOffset: null },
    );

    expect(result.merged.rows).toHaveLength(3);
    expect(result.merged.nextOffset).toBeNull();
    expect(result.listChanged).toBe(true);
  });

  test("a short page with more to come, or a complete last page, is not", () => {
    const current: EntityConnectionSection = {
      total: 4,
      unknownTotal: 0,
      rows: [decodedRow("a"), decodedRow("b")],
      nextOffset: 2,
    };
    expect(
      api.appendConnectionsPage("runsOn", current, {
        total: 4,
        unknownTotal: 0,
        rows: [decodedRow("c")],
        nextOffset: 3,
      }).listChanged,
    ).toBe(false);
    expect(
      api.appendConnectionsPage("runsOn", current, {
        total: 4,
        unknownTotal: 0,
        rows: [decodedRow("c"), decodedRow("d")],
        nextOffset: null,
      }).listChanged,
    ).toBe(false);
  });

  /*
   * A relationship deleted above the offset moves every later row up one
   * rank: the row at the old offset is never returned and nothing repeats,
   * and the stale row still on screen keeps the count looking complete.
   */
  test("a deletion above the offset is a changed list, though nothing repeats", () => {
    // a..f shown a, b, c; then b is deleted, so ranks 4.. hold e, f.
    const result: AppendedConnectionsPage = api.appendConnectionsPage(
      "runsOn",
      {
        total: 6,
        unknownTotal: 0,
        rows: [decodedRow("a"), decodedRow("b"), decodedRow("c")],
        nextOffset: 3,
      },
      {
        total: 5,
        unknownTotal: 0,
        rows: [decodedRow("e"), decodedRow("f")],
        nextOffset: null,
      },
    );

    expect(
      result.merged.rows.map((r: EntityConnection) => {
        return r.otherKey;
      }),
    ).toEqual(["a", "b", "c", "e", "f"]);
    expect(result.listChanged).toBe(true);
  });

  test("a last page that leaves more rows on screen than the server counts is a changed list", () => {
    const result: AppendedConnectionsPage = api.appendConnectionsPage(
      "runsOn",
      {
        total: 4,
        unknownTotal: 0,
        rows: [decodedRow("a"), decodedRow("b"), decodedRow("c")],
        nextOffset: 3,
      },
      { total: 3, unknownTotal: 0, rows: [decodedRow("d")], nextOffset: null },
    );

    expect(result.merged.rows).toHaveLength(4);
    expect(result.listChanged).toBe(true);
  });

  test("growth below the offset hides nothing and is not flagged", () => {
    const result: AppendedConnectionsPage = api.appendConnectionsPage(
      "runsOn",
      {
        total: 4,
        unknownTotal: 0,
        rows: [decodedRow("a"), decodedRow("b")],
        nextOffset: 2,
      },
      {
        total: 5,
        unknownTotal: 0,
        rows: [decodedRow("c"), decodedRow("d")],
        nextOffset: 4,
      },
    );

    expect(result.listChanged).toBe(false);
  });

  test("one resource related in both directions is two rows", () => {
    expect(api.connectionId("related", decodedRow("a", "out"))).not.toBe(
      api.connectionId("related", decodedRow("a", "in")),
    );
    expect(api.connectionId("related", decodedRow("a"))).not.toBe(
      api.connectionId("runsOn", decodedRow("a")),
    );
  });
});

describe("fetchEntityDetail / fetchEntityConnections", () => {
  test("posts the entity request with the project headers and the caller's abort signal", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, asJSON(entityResponse()), {}),
    );
    const controller: AbortController = new AbortController();

    const decoded: EntityDetailData = await api.fetchEntityDetail(
      { entityKey: "svc-key", entityType: "service", displayName: "checkout" },
      RANGE_START,
      { signal: controller.signal },
    );

    expect(postMock).toHaveBeenCalledTimes(1);
    const request: PostRequest = lastRequest();
    expect(request.url.toString()).toMatch(/\/telemetry\/topology\/entity$/);
    expect(request.data).toEqual({
      rangeStart: "2026-09-26T10:00:00.000Z",
      entityKey: "svc-key",
      entityType: "service",
    });
    expect(request.headers).toEqual({ tenantid: "project-1" });
    expect(request.options.signal).toBe(controller.signal);
    expect(decoded.entity?.displayName).toBe("checkout");
  });

  test("posts a 'Show more' request to the connections endpoint", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, asJSON(connectionsResponse()), {}),
    );

    const page: EntityConnectionsPage = await api.fetchEntityConnections(
      { entityKey: "svc-key", entityType: "service" },
      RANGE_START,
      "runsOn",
      25,
      25,
    );

    const request: PostRequest = lastRequest();
    expect(request.url.toString()).toMatch(
      /\/telemetry\/topology\/entity\/connections$/,
    );
    expect(request.data).toEqual({
      rangeStart: "2026-09-26T10:00:00.000Z",
      entityKey: "svc-key",
      entityType: "service",
      section: "runsOn",
      offset: 25,
      limit: 25,
    });
    expect(page.connections.rows[0]!.otherKey).toBe("pod-2");
  });

  test("a 404 means the server has no such endpoint: the bundle is outdated", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "Not found" }, {}),
    );

    await expect(
      api.fetchEntityDetail({ entityKey: "k" }, RANGE_START),
    ).rejects.toBeInstanceOf(TopologyOutdatedError);
  });

  test("any other failure is thrown as the server's error response", async () => {
    const failure: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "You do not have permission to read inventory." },
      {},
    );
    postMock.mockResolvedValue(failure);

    await expect(
      api.fetchEntityConnections(
        { entityKey: "k" },
        RANGE_START,
        "related",
        25,
        25,
      ),
    ).rejects.toBe(failure);
  });

  test("a response in another format is refused", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        asJSON(entityResponse({ formatVersion: 2 })),
        {},
      ),
    );

    await expect(
      api.fetchEntityDetail({ entityKey: "k" }, RANGE_START),
    ).rejects.toBeInstanceOf(TopologyOutdatedError);
  });
});

describe("describeEntityDetailError", () => {
  test("an outdated bundle has fixed copy the drawer translates", () => {
    expect(api.describeEntityDetailError(new TopologyOutdatedError())).toEqual({
      isOutdated: true,
      isBusy: false,
      detail: "Topology was updated. Reload the page.",
    });
  });

  test("a busy server (429) has the maps' fixed copy, and is worth retrying", () => {
    expect(
      api.describeEntityDetailError(
        new HTTPErrorResponse(
          429,
          { message: "Too many topology requests are running." },
          {},
        ),
      ),
    ).toEqual({
      isOutdated: false,
      isBusy: true,
      detail: TOPOLOGY_BUSY_MESSAGE,
    });
    expect(TOPOLOGY_BUSY_MESSAGE).toBe(
      "The topology service is busy. Try again in a moment.",
    );
  });

  test("a server error carries the server's explanation", () => {
    expect(
      api.describeEntityDetailError(
        new HTTPErrorResponse(403, { message: "Forbidden here" }, {}),
      ),
    ).toEqual({ isOutdated: false, isBusy: false, detail: "Forbidden here" });
    expect(
      api.describeEntityDetailError(new HTTPErrorResponse(502, {}, {})).detail,
    ).toMatch(/Error connecting to server/);
  });

  test("anything else says what it can, or nothing", () => {
    expect(api.describeEntityDetailError(new Error("socket hang up"))).toEqual({
      isOutdated: false,
      isBusy: false,
      detail: "socket hang up",
    });
    expect(api.describeEntityDetailError("weird")).toEqual({
      isOutdated: false,
      isBusy: false,
      detail: "",
    });
  });
});

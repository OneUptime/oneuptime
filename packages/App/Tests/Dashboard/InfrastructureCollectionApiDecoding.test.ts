import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiLimits,
  TopologyApiPath,
  TopologyCollectionResponseJSON,
  TopologyCollectionSearchResponseJSON,
  TopologyEntityJSON,
} from "Common/Types/Topology/TopologyApi";
import type {
  CollectionPage,
  CollectionSearchType,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi";
import type { TopologyEntity } from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * The Infrastructure view's collection transport: the request bodies it
 * posts for a page of a collection and for search counts, and the decoders
 * that turn the server's epoch-millisecond JSON into the browser's shapes —
 * Dates, a keyset cursor, exact totals, and a hard stop when the server
 * speaks a different format than this bundle.
 *
 * API and ModelAPI are mocked before the module loads; the module also
 * pulls in Common/UI/Config, which reads `window` on load, so the browser
 * stub is installed first and the import is deferred — the same pattern as
 * EntityDetailApiDecoding.test.ts.
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

type CollectionApiModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi");
type TopologyApiModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Topology/TopologyApi");

let api: CollectionApiModule;
let TopologyOutdatedError: TopologyApiModule["TopologyOutdatedError"];
let postMock: jest.Mock;

const RANGE_START: Date = new Date("2026-09-26T10:00:00.000Z");
const LAST_SEEN_MS: number = Date.parse("2026-09-26T10:14:00.000Z");

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
  headers: Record<string, string>;
  options: { signal?: AbortSignal };
}

function item(overrides: Partial<TopologyEntityJSON> = {}): TopologyEntityJSON {
  return {
    key: "iot-1",
    type: "iot.device",
    name: "sensor-1",
    source: "inventory",
    lastSeenAt: LAST_SEEN_MS,
    ...overrides,
  };
}

function pageResponse(
  overrides: Partial<TopologyCollectionResponseJSON> = {},
): TopologyCollectionResponseJSON {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: "2026-09-26T10:00:00.000Z",
    generatedAt: "2026-09-26T10:15:00.000Z",
    entityType: "iot.device",
    total: 1234,
    items: [
      item(),
      item({ key: "iot-2", name: null, lastSeenAt: null, source: "" }),
    ],
    nextCursor: { name: "", key: "iot-2" },
    ...overrides,
  };
}

function searchResponse(
  matches: TopologyCollectionSearchResponseJSON["matches"],
): TopologyCollectionSearchResponseJSON {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: "2026-09-26T10:00:00.000Z",
    generatedAt: "2026-09-26T10:15:00.000Z",
    matches,
  };
}

function asJSON(value: unknown): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function ok(value: unknown): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, asJSON(value), {});
}

function request(call: number = 0): PostRequest {
  const found: PostRequest | undefined = postMock.mock.calls[call]?.[0] as
    | PostRequest
    | undefined;
  if (!found) {
    throw new Error(`API.post call ${call} was not made`);
  }
  return found;
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
    "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi"
  );
  TopologyOutdatedError = (
    await import(
      "../../FeatureSet/Dashboard/src/Components/Topology/TopologyApi"
    )
  ).TopologyOutdatedError;
});

beforeEach(() => {
  postMock.mockReset();
});

describe("collection page requests", () => {
  test("the first page carries the range, the type, the activity filter and the page size", () => {
    expect(
      asJSON(
        api.buildCollectionPageRequest(RANGE_START, {
          entityType: "iot.device",
          includeInactive: false,
        }),
      ),
    ).toEqual({
      rangeStart: "2026-09-26T10:00:00.000Z",
      entityType: "iot.device",
      includeInactive: false,
      limit: TopologyApiLimits.CollectionPageSizeDefault,
    });
  });

  test("a later page carries its cursor, and name terms are trimmed, lowercased and never blank", () => {
    expect(
      asJSON(
        api.buildCollectionPageRequest(RANGE_START, {
          entityType: "iot.device",
          includeInactive: true,
          nameTerms: ["  Sensor ", "", "  ", "B-7"],
          cursor: { name: "sensor-9", key: "iot-9" },
          limit: 25,
        }),
      ),
    ).toEqual({
      rangeStart: "2026-09-26T10:00:00.000Z",
      entityType: "iot.device",
      includeInactive: true,
      nameTerms: ["sensor", "b-7"],
      cursor: { name: "sensor-9", key: "iot-9" },
      limit: 25,
    });
  });

  test("the page size stays inside what the server accepts", () => {
    const limitFor: (limit: number) => unknown = (limit: number): unknown => {
      return api.buildCollectionPageRequest(RANGE_START, {
        entityType: "iot.device",
        includeInactive: false,
        limit,
      }).limit;
    };
    expect(limitFor(100000)).toBe(TopologyApiLimits.CollectionPageSizeMax);
    expect(limitFor(-3)).toBe(1);
    expect(limitFor(12.7)).toBe(12);
  });

  test("fetchCollectionPage posts to the collection route with the project headers and the abort signal", async () => {
    postMock.mockResolvedValue(ok(pageResponse()));
    const controller: AbortController = new AbortController();
    const page: CollectionPage = await api.fetchCollectionPage(
      RANGE_START,
      {
        entityType: "iot.device",
        includeInactive: false,
        nameTerms: ["sensor"],
        cursor: null,
        limit: 50,
      },
      { signal: controller.signal },
    );
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(request().url.toString()).toContain(
      TopologyApiPath.InfrastructureCollection,
    );
    expect(request().url.toString()).not.toContain("collection-search");
    expect(request().headers).toEqual({ tenantid: "project-1" });
    expect(request().options.signal).toBe(controller.signal);
    expect(request().data).toEqual({
      rangeStart: "2026-09-26T10:00:00.000Z",
      entityType: "iot.device",
      includeInactive: false,
      nameTerms: ["sensor"],
      limit: 50,
    });
    expect(page.total).toBe(1234);
    expect(page.items).toHaveLength(2);
  });
});

describe("decoding a collection page", () => {
  test("items become lean entities with Dates; blanks become absent", () => {
    const page: CollectionPage = api.decodeCollectionPageResponse(
      asJSON(pageResponse()),
      "iot.device",
    );
    expect(page.rangeStart).toEqual(RANGE_START);
    expect(page.entityType).toBe("iot.device");
    expect(page.total).toBe(1234);
    expect(page.items[0]).toEqual({
      entityKey: "iot-1",
      entityType: "iot.device",
      displayName: "sensor-1",
      source: "inventory",
      lastSeenAt: new Date(LAST_SEEN_MS),
    });
    const second: TopologyEntity = page.items[1]!;
    expect(second.entityKey).toBe("iot-2");
    expect(second.displayName).toBeUndefined();
    expect(second.source).toBeUndefined();
    expect(second.lastSeenAt).toBeUndefined();
    expect(page.nextCursor).toEqual({ name: "", key: "iot-2" });
  });

  test("the last page has no cursor", () => {
    expect(
      api.decodeCollectionPageResponse(
        asJSON(pageResponse({ nextCursor: null })),
        "iot.device",
      ).nextCursor,
    ).toBeNull();
  });

  test("malformed rows are skipped and the total never undercounts what came back", () => {
    const page: CollectionPage = api.decodeCollectionPageResponse(
      {
        ...asJSON(pageResponse()),
        total: -4,
        items: [
          { key: 7 },
          "nonsense",
          null,
          { type: "iot.device" },
          asJSON(item({ key: "ok" })),
        ],
        nextCursor: { name: 3 } as unknown as JSONObject,
      },
      "iot.device",
    );
    expect(
      page.items.map((entity: TopologyEntity): string | undefined => {
        return entity.entityKey;
      }),
    ).toEqual(["ok"]);
    expect(page.total).toBe(1);
    expect(page.nextCursor).toBeNull();
  });

  test("a page of another collection is refused rather than shown as this one", () => {
    expect(() => {
      api.decodeCollectionPageResponse(
        asJSON(pageResponse({ entityType: "network.device" })),
        "iot.device",
      );
    }).toThrow(/iot\.device/);
  });

  test("another format version means the page must reload", () => {
    const decode: (body: unknown) => CollectionPage = (
      body: unknown,
    ): CollectionPage => {
      return api.decodeCollectionPageResponse(body, "iot.device");
    };
    for (const body of [
      asJSON(pageResponse({ formatVersion: TOPOLOGY_API_FORMAT_VERSION + 1 })),
      {},
      null,
      "text",
    ]) {
      expect(() => {
        decode(body);
      }).toThrow(TopologyOutdatedError);
    }
  });
});

describe("collection search", () => {
  test("a search is sent only when the server would accept it", () => {
    expect(api.isCollectionSearchable(["sensor", "b7"])).toBe(true);
    expect(api.isCollectionSearchable([])).toBe(true);
    expect(
      api.isCollectionSearchable(
        Array.from(
          { length: TopologyApiLimits.MaxSearchTerms + 1 },
          (_value: unknown, index: number): string => {
            return `t${index}`;
          },
        ),
      ),
    ).toBe(false);
    expect(
      api.isCollectionSearchable([
        "x".repeat(TopologyApiLimits.MaxSearchTermLength + 1),
      ]),
    ).toBe(false);
  });

  test("the request names each collection with its own name terms", () => {
    expect(
      asJSON(
        api.buildCollectionSearchRequest(RANGE_START, {
          includeInactive: true,
          types: [
            { entityType: "iot.device", nameTerms: ["Sensor"] },
            { entityType: "network.device", nameTerms: ["iot", " core "] },
          ],
        }),
      ),
    ).toEqual({
      rangeStart: "2026-09-26T10:00:00.000Z",
      includeInactive: true,
      types: [
        { entityType: "iot.device", nameTerms: ["sensor"] },
        { entityType: "network.device", nameTerms: ["iot", "core"] },
      ],
    });
  });

  test("counts decode into a map of the types that matched", () => {
    const counts: Map<string, number> = api.decodeCollectionSearchResponse(
      asJSON(
        searchResponse([
          { entityType: "iot.device", count: 1234 },
          { entityType: "network.device", count: 0 },
          { entityType: "", count: 3 },
        ]),
      ),
    );
    expect(Array.from(counts.entries())).toEqual([["iot.device", 1234]]);
  });

  test("fetchCollectionSearchCounts posts once to the search route", async () => {
    postMock.mockResolvedValue(
      ok(searchResponse([{ entityType: "iot.device", count: 12 }])),
    );
    const counts: Map<string, number> = await api.fetchCollectionSearchCounts(
      RANGE_START,
      {
        includeInactive: false,
        types: [{ entityType: "iot.device", nameTerms: ["sensor"] }],
      },
    );
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(request().url.toString()).toContain(
      TopologyApiPath.InfrastructureCollectionSearch,
    );
    expect(counts.get("iot.device")).toBe(12);
  });

  test("more collections than one request may name are asked in batches", async () => {
    postMock.mockImplementation(async (...args: Array<unknown>) => {
      const body: JSONObject = (args[0] as PostRequest).data;
      const types: Array<CollectionSearchType> = body[
        "types"
      ] as unknown as Array<CollectionSearchType>;
      return ok(
        searchResponse(
          types.map((type: CollectionSearchType) => {
            return { entityType: type.entityType, count: 1 };
          }),
        ),
      );
    });
    const types: Array<CollectionSearchType> = Array.from(
      { length: TopologyApiLimits.MaxCollectionSearchTypes + 5 },
      (_value: unknown, index: number): CollectionSearchType => {
        return { entityType: `custom.type.${index}`, nameTerms: ["x"] };
      },
    );
    const counts: Map<string, number> = await api.fetchCollectionSearchCounts(
      RANGE_START,
      { includeInactive: false, types },
    );
    expect(postMock).toHaveBeenCalledTimes(2);
    expect((request(0).data["types"] as unknown as Array<unknown>).length).toBe(
      TopologyApiLimits.MaxCollectionSearchTypes,
    );
    expect((request(1).data["types"] as unknown as Array<unknown>).length).toBe(
      5,
    );
    expect(counts.size).toBe(types.length);
  });

  test("nothing to count asks nothing", async () => {
    const counts: Map<string, number> = await api.fetchCollectionSearchCounts(
      RANGE_START,
      { includeInactive: false, types: [] },
    );
    expect(counts.size).toBe(0);
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  test("a missing route means this bundle is newer than the server", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "Not found" }, {}),
    );
    await expect(
      api.fetchCollectionPage(RANGE_START, {
        entityType: "iot.device",
        includeInactive: false,
      }),
    ).rejects.toBeInstanceOf(TopologyOutdatedError);
  });

  test("any other error response is thrown as it came", async () => {
    const failure: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "entityType must be a flat infrastructure type" },
      {},
    );
    postMock.mockResolvedValue(failure);
    await expect(
      api.fetchCollectionSearchCounts(RANGE_START, {
        includeInactive: false,
        types: [{ entityType: "k8s.pod", nameTerms: ["x"] }],
      }),
    ).rejects.toBe(failure);
    expect(api.describeCollectionError(failure)).toEqual({
      isOutdated: false,
      isBusy: false,
      detail: "entityType must be a flat infrastructure type",
    });
  });

  test("a busy server (429) is thrown as it came and reads as busy, not outdated", async () => {
    const failure: HTTPErrorResponse = new HTTPErrorResponse(
      429,
      { message: "Too many topology requests. Try again shortly." },
      {},
    );
    postMock.mockResolvedValue(failure);
    await expect(
      api.fetchCollectionPage(RANGE_START, {
        entityType: "iot.device",
        includeInactive: false,
      }),
    ).rejects.toBe(failure);
    expect(api.describeCollectionError(failure)).toEqual({
      isOutdated: false,
      isBusy: true,
      detail: "Too many topology requests. Try again shortly.",
    });
    /* Without an explanation from the server, the busy copy stands in. */
    expect(
      api.describeCollectionError(new HTTPErrorResponse(429, {}, {})),
    ).toEqual({
      isOutdated: false,
      isBusy: true,
      detail: api.TOPOLOGY_BUSY_MESSAGE,
    });
    expect(api.TOPOLOGY_BUSY_MESSAGE).toBe(
      "The topology service is busy. Try again in a moment.",
    );
  });

  test("errors describe themselves for the page", () => {
    expect(api.describeCollectionError(new TopologyOutdatedError())).toEqual({
      isOutdated: true,
      isBusy: false,
      detail: "Topology was updated. Reload the page.",
    });
    expect(
      api.describeCollectionError(new HTTPErrorResponse(504, {}, {})),
    ).toEqual({
      isOutdated: false,
      isBusy: false,
      detail: expect.stringMatching(/connecting to server/),
    });
    expect(
      api.describeCollectionError(new HTTPErrorResponse(503, {}, {})).isBusy,
    ).toBe(false);
    expect(api.describeCollectionError(new Error("boom"))).toEqual({
      isOutdated: false,
      isBusy: false,
      detail: "boom",
    });
    expect(api.describeCollectionError("?")).toEqual({
      isOutdated: false,
      isBusy: false,
      detail: "",
    });
  });
});

import { beforeEach, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";

/*
 * InventoryOverviewApi is where the Overview endpoint's body becomes the
 * numbers and rows the page renders. Like NetworkSummaryApi.test.ts, the
 * three browser-bound modules it imports are mocked: Common/UI/Config reads
 * `window` at import time, and the mocked API.post is where each response
 * shape is injected.
 */
jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  InventoryOverview,
  fetchInventoryOverview,
  parseInventoryOverview,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryOverviewApi";
import { EMPTY_INVENTORY_SUMMARY_COUNTS } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventorySummaryTiles";

const postMock: jest.Mock = API.post as unknown as jest.Mock;
const getCommonHeadersMock: jest.Mock =
  ModelAPI.getCommonHeaders as unknown as jest.Mock;

// Without the tenant header the project-scoped route answers with a permissions error.
const TENANT_HEADERS: Dictionary<string> = {
  tenantid: "3f1b6b0e-0000-4000-8000-0000000000aa",
};

interface PostOptions {
  url: URL;
  data: JSONObject;
  headers: Dictionary<string>;
}

function lastPostOptions(): PostOptions {
  const calls: Array<Array<unknown>> = postMock.mock.calls as Array<
    Array<unknown>
  >;
  return calls[calls.length - 1]![0] as PostOptions;
}

// Through the real HTTPResponse constructor, so the body is deserialized as in the browser.
function respondWith(body: JSONObject): void {
  postMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, body, {}));
}

const WELL_FORMED: JSONObject = {
  counts: {
    total: 48213,
    discovered: 47000,
    mirrored: 1100,
    manual: 113,
    stale: 3210,
  },
  countsByType: [
    { entityType: EntityType.KubernetesPod, count: 40000 },
    { entityType: EntityType.Service, count: 8000 },
    { entityType: EntityType.ExternalService, count: 213 },
  ],
  recentlyAdded: [
    {
      _id: "7a1b6b0e-0000-4000-8000-000000000001",
      displayName: "checkout",
      entityType: EntityType.Service,
      source: EntitySource.Discovered,
      firstSeenAt: "2026-09-26T10:00:00.000Z",
      lastSeenAt: "2026-09-26T10:05:00.000Z",
    },
    {
      _id: "7a1b6b0e-0000-4000-8000-000000000002",
      displayName: "Stripe",
      entityType: EntityType.ExternalService,
      source: EntitySource.Manual,
      firstSeenAt: "2026-09-20T08:00:00.000Z",
      lastSeenAt: null,
    },
  ],
};

beforeEach(() => {
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue(TENANT_HEADERS);
});

describe("fetchInventoryOverview", () => {
  test("posts once to /inventory-item/overview with the tenant header", async () => {
    respondWith(WELL_FORMED);

    await fetchInventoryOverview();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(lastPostOptions().url.toString()).toBe(
      "http://localhost/api/inventory-item/overview",
    );
    expect(lastPostOptions().data).toEqual({});
    expect(lastPostOptions().headers).toEqual(TENANT_HEADERS);
  });

  test("returns the tiles, the breakdown and the recent rows", async () => {
    respondWith(WELL_FORMED);

    const overview: InventoryOverview = await fetchInventoryOverview();

    expect(overview).toEqual({
      counts: {
        total: 48213,
        discovered: 47000,
        mirrored: 1100,
        manual: 113,
        stale: 3210,
      },
      countsByType: {
        [EntityType.KubernetesPod]: 40000,
        [EntityType.Service]: 8000,
        [EntityType.ExternalService]: 213,
      },
      recentlyAdded: [
        {
          id: "7a1b6b0e-0000-4000-8000-000000000001",
          displayName: "checkout",
          entityType: EntityType.Service,
          source: EntitySource.Discovered,
          lastSeenAt: "2026-09-26T10:05:00.000Z",
        },
        {
          id: "7a1b6b0e-0000-4000-8000-000000000002",
          displayName: "Stripe",
          entityType: EntityType.ExternalService,
          source: EntitySource.Manual,
          lastSeenAt: null,
        },
      ],
    });
  });

  test("an error response is thrown for the page to show, not read as an empty estate", async () => {
    /*
     * An empty estate replaces the page with the setup guide, which is the
     * wrong thing to show someone whose request merely failed.
     */
    const error: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "Project not found in request" },
      {},
    );
    postMock.mockResolvedValue(error);

    await expect(fetchInventoryOverview()).rejects.toBe(error);
  });

  test("a 200 with no body reads as an empty estate", async () => {
    const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
      200,
      {},
      {},
    );
    response.data = undefined as unknown as JSONObject;
    postMock.mockResolvedValue(response);

    expect(await fetchInventoryOverview()).toEqual({
      counts: EMPTY_INVENTORY_SUMMARY_COUNTS,
      countsByType: {},
      recentlyAdded: [],
    });
  });
});

describe("parseInventoryOverview", () => {
  test("counts that arrive as Postgres bigint strings leave as numbers", () => {
    const overview: InventoryOverview = parseInventoryOverview({
      counts: {
        total: "10",
        discovered: "9",
        mirrored: "1",
        manual: "0",
        stale: "2",
      },
      countsByType: [{ entityType: EntityType.Service, count: "10" }],
    });

    expect(overview.counts).toEqual({
      total: 10,
      discovered: 9,
      mirrored: 1,
      manual: 0,
      stale: 2,
    });
    expect(overview.countsByType).toEqual({ [EntityType.Service]: 10 });
  });

  test("garbage in the counts reads as zero, never NaN", () => {
    const overview: InventoryOverview = parseInventoryOverview({
      counts: {
        total: "lots",
        discovered: null,
        mirrored: Number.NaN,
        stale: { value: 3 },
      },
    });

    expect(overview.counts).toEqual(EMPTY_INVENTORY_SUMMARY_COUNTS);
  });

  test("counts that are not an object read as zeroes", () => {
    expect(parseInventoryOverview({ counts: [1, 2, 3] }).counts).toEqual(
      EMPTY_INVENTORY_SUMMARY_COUNTS,
    );
    expect(parseInventoryOverview({ counts: "48213" }).counts).toEqual(
      EMPTY_INVENTORY_SUMMARY_COUNTS,
    );
  });

  test("breakdown entries with no type or no items are dropped", () => {
    const overview: InventoryOverview = parseInventoryOverview({
      countsByType: [
        { entityType: EntityType.Service, count: 3 },
        { entityType: "", count: 5 },
        { count: 7 },
        { entityType: EntityType.Host, count: 0 },
        { entityType: EntityType.KubernetesPod, count: -1 },
        "not an entry",
        null,
      ],
    });

    expect(overview.countsByType).toEqual({ [EntityType.Service]: 3 });
  });

  test("a type listed twice is summed, not overwritten", () => {
    const overview: InventoryOverview = parseInventoryOverview({
      countsByType: [
        { entityType: EntityType.Service, count: 3 },
        { entityType: EntityType.Service, count: 4 },
      ],
    });

    expect(overview.countsByType).toEqual({ [EntityType.Service]: 7 });
  });

  test("a breakdown that is not a list reads as empty", () => {
    expect(
      parseInventoryOverview({
        countsByType: { [EntityType.Service]: 3 },
      }).countsByType,
    ).toEqual({});
  });

  test("recent rows with no id are dropped rather than rendered as links to nowhere", () => {
    const overview: InventoryOverview = parseInventoryOverview({
      recentlyAdded: [
        { _id: "", displayName: "blank id" },
        { displayName: "no id" },
        { _id: "7a1b6b0e-0000-4000-8000-000000000003", displayName: "kept" },
        "not a row",
      ],
    });

    expect(overview.recentlyAdded).toEqual([
      {
        id: "7a1b6b0e-0000-4000-8000-000000000003",
        displayName: "kept",
        entityType: "",
        source: "",
        lastSeenAt: null,
      },
    ]);
  });

  test("recent rows keep the order the server sent, newest first", () => {
    const overview: InventoryOverview = parseInventoryOverview(WELL_FORMED);

    expect(
      overview.recentlyAdded.map((item: { displayName: string }): string => {
        return item.displayName;
      }),
    ).toEqual(["checkout", "Stripe"]);
  });
});

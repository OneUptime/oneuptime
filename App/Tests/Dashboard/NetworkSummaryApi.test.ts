import { beforeEach, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * NetworkSummaryApi is the seam where an HTTP body becomes the typed numbers
 * the Network strips and the Overview page render. It reaches the network
 * through Common/UI/Utils/API/API and Common/UI/Utils/ModelAPI/ModelAPI, and
 * both of those transitively load Common/UI/Config, which reads `window` at
 * import time and throws in this node test environment. Mocking all three
 * keeps the import graph browser-free and doubles as the seam these tests
 * drive: the mocked API.post is where a malformed response is injected.
 *
 * Same pattern as ReferenceDataCache.test.ts and DeviceMonitorLookupUtil.test.ts.
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
  DeviceSummaryCounts,
  NetworkOverviewSummary,
  OverviewAttentionDevice,
  OverviewAttentionSite,
  OverviewVendor,
  SiteSummaryCounts,
  fetchDeviceSummary,
  fetchNetworkOverview,
  fetchSiteSummary,
} from "../../FeatureSet/Dashboard/src/Components/Network/NetworkSummaryApi";

const postMock: jest.Mock = API.post as unknown as jest.Mock;
const getCommonHeadersMock: jest.Mock =
  ModelAPI.getCommonHeaders as unknown as jest.Mock;

/*
 * The header ModelAPI stamps on every request. Without it
 * ProjectMiddleware.getProjectId returns null server-side and these
 * project-scoped routes fail with a permissions error naming permissions the
 * caller actually holds, so it is asserted rather than assumed.
 */
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

function lastPostedRoute(): string {
  return lastPostOptions().url.toString();
}

/*
 * A well-formed 200. The body goes through the real HTTPResponse constructor
 * (which runs JSONFunctions.deserialize over it) so these tests see exactly
 * the object shape the module sees in the browser, not a hand-made stand-in.
 */
function respondWith(body: JSONObject): void {
  postMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, body, {}));
}

function respondWithNoBody(): void {
  const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
    200,
    {},
    {},
  );
  // A 200 that carried nothing at all — postSummary's `response.data || {}`.
  response.data = undefined as unknown as JSONObject;
  postMock.mockResolvedValue(response);
}

function respondWithError(): HTTPErrorResponse {
  const error: HTTPErrorResponse = new HTTPErrorResponse(
    400,
    { message: "Project not found in request" },
    {},
  );
  postMock.mockResolvedValue(error);
  return error;
}

/*
 * The whole point of this module: a COUNT or SUM that arrived from Postgres as
 * a string must not leave here as one. A string renders fine and then sorts
 * and adds wrongly, which is the worst way for a number to be broken. NaN is
 * checked alongside it because NaN is also `typeof "number"` and renders as
 * the literal text "NaN" in a tile.
 */
function expectRealNumbers(values: Array<number>): void {
  for (const value of values) {
    expect(typeof value).toBe("number");
    expect(Number.isNaN(value)).toBe(false);
    expect(Number.isFinite(value)).toBe(true);
  }
}

function deviceNumbers(counts: DeviceSummaryCounts): Array<number> {
  return [
    counts.devicesUp,
    counts.devicesDown,
    counts.devicesPending,
    counts.interfacesDown,
    counts.totalDevices,
    counts.devicesWithoutSite,
  ];
}

function siteNumbers(counts: SiteSummaryCounts): Array<number> {
  return [
    counts.totalSites,
    counts.unhealthySites,
    counts.sitesWithNoData,
    counts.devicesWithoutSite,
  ];
}

beforeEach(() => {
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue(TENANT_HEADERS);
});

describe("NetworkSummaryApi transport", () => {
  test("fetchDeviceSummary posts to /network-device/summary", async () => {
    respondWith({});

    await fetchDeviceSummary();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(lastPostedRoute()).toBe(
      "http://localhost/api/network-device/summary",
    );
  });

  test("fetchSiteSummary posts to /network-site/summary", async () => {
    respondWith({});

    await fetchSiteSummary();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(lastPostedRoute()).toBe("http://localhost/api/network-site/summary");
  });

  test("fetchNetworkOverview posts to /network-device/overview", async () => {
    respondWith({});

    await fetchNetworkOverview();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(lastPostedRoute()).toBe(
      "http://localhost/api/network-device/overview",
    );
  });

  test("carries the tenant header and an empty body", async () => {
    respondWith({});

    await fetchDeviceSummary();

    expect(lastPostOptions().headers).toEqual(TENANT_HEADERS);
    expect(lastPostOptions().data).toEqual({});
  });

  /*
   * Two calls must not accumulate route segments. APP_API_URL is a shared
   * module-level object and URL.addRoute mutates the instance it is called on,
   * so a client that added the route to APP_API_URL itself would ask for
   * /api/network-device/summary/network-device/summary the second time.
   */
  test("repeated calls keep asking for the same route", async () => {
    respondWith({});

    await fetchDeviceSummary();
    await fetchDeviceSummary();

    const calls: Array<Array<unknown>> = postMock.mock.calls as Array<
      Array<unknown>
    >;
    const routes: Array<string> = calls.map((call: Array<unknown>): string => {
      return (call[0] as PostOptions).url.toString();
    });

    expect(routes).toEqual([
      "http://localhost/api/network-device/summary",
      "http://localhost/api/network-device/summary",
    ]);
  });

  /*
   * The three components catch this and hide the strip, so the error has to
   * arrive as a rejection carrying the HTTPErrorResponse itself — the Overview
   * page runs it through API.getFriendlyMessage to render the reason.
   */
  test("fetchDeviceSummary rejects with the HTTPErrorResponse", async () => {
    const error: HTTPErrorResponse = respondWithError();

    await expect(fetchDeviceSummary()).rejects.toBe(error);
  });

  test("fetchSiteSummary rejects with the HTTPErrorResponse", async () => {
    const error: HTTPErrorResponse = respondWithError();

    await expect(fetchSiteSummary()).rejects.toBe(error);
  });

  test("fetchNetworkOverview rejects with the HTTPErrorResponse", async () => {
    const error: HTTPErrorResponse = respondWithError();

    await expect(fetchNetworkOverview()).rejects.toBe(error);
  });

  test("a 200 with no body at all reads as zeros rather than throwing", async () => {
    respondWithNoBody();

    const counts: DeviceSummaryCounts = await fetchDeviceSummary();

    expect(counts).toEqual({
      devicesUp: 0,
      devicesDown: 0,
      devicesPending: 0,
      interfacesDown: 0,
      totalDevices: 0,
      devicesWithoutSite: 0,
    });
  });
});

describe("fetchDeviceSummary", () => {
  test("reads all six fields from a well-formed response", async () => {
    respondWith({
      devicesUp: 79210,
      devicesDown: 612,
      devicesPending: 178,
      interfacesDown: 1544,
      totalDevices: 80000,
      devicesWithoutSite: 43,
    });

    const counts: DeviceSummaryCounts = await fetchDeviceSummary();

    expect(counts).toEqual({
      devicesUp: 79210,
      devicesDown: 612,
      devicesPending: 178,
      interfacesDown: 1544,
      totalDevices: 80000,
      devicesWithoutSite: 43,
    });
    expectRealNumbers(deviceNumbers(counts));
  });

  /*
   * node-postgres hands COUNT and SUM back as strings because they are bigint
   * and numeric. The server parses them; this asserts the client survives one
   * that ever slipped through unparsed.
   */
  test("parses string counts into numbers", async () => {
    respondWith({
      devicesUp: "79210",
      devicesDown: "612",
      devicesPending: "178",
      interfacesDown: "1544",
      totalDevices: "80000",
      devicesWithoutSite: "43",
    });

    const counts: DeviceSummaryCounts = await fetchDeviceSummary();

    expect(counts).toEqual({
      devicesUp: 79210,
      devicesDown: 612,
      devicesPending: 178,
      interfacesDown: 1544,
      totalDevices: 80000,
      devicesWithoutSite: 43,
    });
    expectRealNumbers(deviceNumbers(counts));
  });

  test("an empty response reads as zeros, not undefined", async () => {
    respondWith({});

    const counts: DeviceSummaryCounts = await fetchDeviceSummary();

    expect(counts).toEqual({
      devicesUp: 0,
      devicesDown: 0,
      devicesPending: 0,
      interfacesDown: 0,
      totalDevices: 0,
      devicesWithoutSite: 0,
    });
    expectRealNumbers(deviceNumbers(counts));
  });

  test("nulls read as zeros", async () => {
    respondWith({
      devicesUp: null,
      devicesDown: null,
      devicesPending: null,
      interfacesDown: null,
      totalDevices: null,
      devicesWithoutSite: null,
    });

    const counts: DeviceSummaryCounts = await fetchDeviceSummary();

    expect(deviceNumbers(counts)).toEqual([0, 0, 0, 0, 0, 0]);
    expectRealNumbers(deviceNumbers(counts));
  });

  test("a partial response fills only what arrived", async () => {
    respondWith({ devicesUp: 5, totalDevices: "9" });

    const counts: DeviceSummaryCounts = await fetchDeviceSummary();

    expect(counts).toEqual({
      devicesUp: 5,
      devicesDown: 0,
      devicesPending: 0,
      interfacesDown: 0,
      totalDevices: 9,
      devicesWithoutSite: 0,
    });
  });

  /*
   * Garbage must land on 0, never on NaN. A NaN count renders as the text
   * "NaN" in the tile and poisons any arithmetic the page does with it.
   */
  test("garbage values read as zero, never NaN", async () => {
    respondWith({
      devicesUp: "not-a-number",
      devicesDown: "",
      devicesPending: {},
      interfacesDown: [],
      totalDevices: true,
      devicesWithoutSite: "12 devices",
    });

    const counts: DeviceSummaryCounts = await fetchDeviceSummary();

    expect(deviceNumbers(counts)).toEqual([0, 0, 0, 0, 0, 0]);
    expectRealNumbers(deviceNumbers(counts));
  });

  test("a non-finite number reads as zero", async () => {
    respondWith({
      devicesUp: Number.NaN,
      devicesDown: Number.POSITIVE_INFINITY,
      // "1e999" overflows to Infinity when parsed.
      devicesPending: "1e999",
    });

    const counts: DeviceSummaryCounts = await fetchDeviceSummary();

    expect(counts.devicesUp).toBe(0);
    expect(counts.devicesDown).toBe(0);
    expect(counts.devicesPending).toBe(0);
    expectRealNumbers(deviceNumbers(counts));
  });

  /*
   * The tiles map over a fixed list of fields, so an unknown field is not a
   * crash — but it must not survive into the returned object either, or a
   * later `Object.keys` over the counts would render a tile nobody designed.
   */
  test("unexpected extra fields are dropped", async () => {
    respondWith({
      devicesUp: 1,
      devicesDown: 2,
      devicesPending: 3,
      interfacesDown: 4,
      totalDevices: 5,
      devicesWithoutSite: 6,
      devicesArchived: 99,
      _id: "not-a-count",
      nested: { devicesUp: 1000 },
    });

    const counts: DeviceSummaryCounts = await fetchDeviceSummary();

    expect(Object.keys(counts).sort()).toEqual([
      "devicesDown",
      "devicesPending",
      "devicesUp",
      "devicesWithoutSite",
      "interfacesDown",
      "totalDevices",
    ]);
    expect(deviceNumbers(counts)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("fetchSiteSummary", () => {
  test("reads every field from a well-formed response", async () => {
    respondWith({
      totalSites: 1200,
      unhealthySites: 37,
      sitesWithNoData: 8,
      devicesWithoutSite: 43,
      unhealthyStatusIds: ["status-degraded", "status-offline"],
    });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(counts).toEqual({
      totalSites: 1200,
      unhealthySites: 37,
      sitesWithNoData: 8,
      devicesWithoutSite: 43,
      unhealthyStatusIds: ["status-degraded", "status-offline"],
    });
    expectRealNumbers(siteNumbers(counts));
  });

  test("parses string counts into numbers", async () => {
    respondWith({
      totalSites: "1200",
      unhealthySites: "37",
      sitesWithNoData: "8",
      devicesWithoutSite: "43",
    });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(siteNumbers(counts)).toEqual([1200, 37, 8, 43]);
    expectRealNumbers(siteNumbers(counts));
  });

  test("an empty response reads as zeros and no status ids", async () => {
    respondWith({});

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(counts).toEqual({
      totalSites: 0,
      unhealthySites: 0,
      sitesWithNoData: 0,
      devicesWithoutSite: 0,
      unhealthyStatusIds: [],
    });
  });

  test("nulls read as zeros and no status ids", async () => {
    respondWith({
      totalSites: null,
      unhealthySites: null,
      sitesWithNoData: null,
      devicesWithoutSite: null,
      unhealthyStatusIds: null,
    });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(siteNumbers(counts)).toEqual([0, 0, 0, 0]);
    expect(counts.unhealthyStatusIds).toEqual([]);
  });

  test("garbage counts read as zero, never NaN", async () => {
    respondWith({
      totalSites: "twelve",
      unhealthySites: {},
      sitesWithNoData: [],
      devicesWithoutSite: false,
    });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(siteNumbers(counts)).toEqual([0, 0, 0, 0]);
    expectRealNumbers(siteNumbers(counts));
  });

  test("unexpected extra fields are dropped", async () => {
    respondWith({
      totalSites: 1,
      unhealthySites: 2,
      sitesWithNoData: 3,
      devicesWithoutSite: 4,
      unhealthyStatusIds: ["a"],
      operationalStatusIds: ["b"],
      totalRegions: 9,
    });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(Object.keys(counts).sort()).toEqual([
      "devicesWithoutSite",
      "sitesWithNoData",
      "totalSites",
      "unhealthySites",
      "unhealthyStatusIds",
    ]);
    expect(counts.unhealthyStatusIds).toEqual(["a"]);
  });

  /*
   * Why a bad id matters more than a bad number here.
   *
   * The Sites page turns unhealthyStatusIds into the filter chip its
   * "Unhealthy" tile sets, so the rows a click produces are meant to be
   * exactly the sites behind the number on the tile. A junk entry — a null
   * left by a status row that did not hydrate, an empty string from an id
   * that stringified to nothing — would go into that chip and match no site
   * at all, producing an empty list under a lit tile reading "37 unhealthy".
   * That reads as "the sites are fine now", which is the opposite of true.
   */
  test("non-string status ids are dropped from the chip's id list", async () => {
    respondWith({
      unhealthySites: 3,
      unhealthyStatusIds: [
        "status-degraded",
        null,
        42,
        { _id: "status-offline" },
        ["status-nested"],
        true,
        "status-offline",
      ],
    });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(counts.unhealthyStatusIds).toEqual([
      "status-degraded",
      "status-offline",
    ]);
  });

  test("empty-string status ids are dropped from the chip's id list", async () => {
    respondWith({
      unhealthyStatusIds: ["", "status-degraded", ""],
    });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(counts.unhealthyStatusIds).toEqual(["status-degraded"]);
  });

  test("every entry being junk leaves an empty id list rather than holes", async () => {
    respondWith({ unhealthyStatusIds: [null, "", undefined, 0] });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(counts.unhealthyStatusIds).toEqual([]);
  });

  test("a non-array unhealthyStatusIds reads as an empty list", async () => {
    respondWith({ unhealthyStatusIds: "status-degraded" });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(counts.unhealthyStatusIds).toEqual([]);
  });

  test("an object unhealthyStatusIds reads as an empty list", async () => {
    respondWith({ unhealthyStatusIds: { "0": "status-degraded" } });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(counts.unhealthyStatusIds).toEqual([]);
  });

  test("an absent unhealthyStatusIds reads as an empty list", async () => {
    respondWith({ totalSites: 4, unhealthySites: 1 });

    const counts: SiteSummaryCounts = await fetchSiteSummary();

    expect(counts.unhealthyStatusIds).toEqual([]);
    expect(Array.isArray(counts.unhealthyStatusIds)).toBe(true);
  });
});

describe("fetchNetworkOverview", () => {
  function wellFormedOverview(): JSONObject {
    return {
      fleet: {
        total: 80000,
        up: 79210,
        down: 612,
        pending: 178,
        interfacesDown: 1544,
      },
      siteCount: 1200,
      unhealthySiteCount: 37,
      endpointCount: 260,
      vendors: [
        { vendor: "Cisco", count: 41000 },
        { vendor: "Unknown", count: 900 },
      ],
      attentionDevices: [
        {
          _id: "device-1",
          name: "core-sw-01",
          lastSeenAt: "2026-08-20T10:00:00.000Z",
          interfacesDown: 0,
          isDown: true,
        },
      ],
      attentionSites: [
        {
          _id: "site-1",
          name: "Warehouse 12",
          siteType: "Warehouse",
          statusName: "Offline",
          statusColor: "#ef4444",
        },
      ],
    };
  }

  /*
   * The Overview words a down row for what judged it: "Monitor reports
   * offline" for a monitor-backed device, "Last seen …" / "Never answered"
   * for a polled one. Anything but a literal `true` reads as polled, so an
   * older server that never sent the flag keeps the SNMP wording it always
   * had.
   */
  test.each([
    [true, true],
    ["true", false],
    [1, false],
    [undefined, false],
  ])(
    "reads isMonitorBacked %p on an attention row as %p",
    async (raw: unknown, expected: boolean) => {
      const overview: JSONObject = wellFormedOverview();
      const rows: Array<JSONObject> = overview[
        "attentionDevices"
      ] as Array<JSONObject>;
      (rows[0] as JSONObject)["isMonitorBacked"] = raw as JSONValue;
      respondWith(overview);

      const parsed: NetworkOverviewSummary = await fetchNetworkOverview();

      expect(parsed.attentionDevices[0]!.isMonitorBacked).toBe(expected);
    },
  );

  test("reads a well-formed overview", async () => {
    respondWith(wellFormedOverview());

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.fleet).toEqual({
      total: 80000,
      up: 79210,
      down: 612,
      pending: 178,
      interfacesDown: 1544,
    });
    expect(overview.siteCount).toBe(1200);
    expect(overview.unhealthySiteCount).toBe(37);
    expect(overview.endpointCount).toBe(260);
    expect(overview.vendors).toEqual([
      { vendor: "Cisco", count: 41000 },
      { vendor: "Unknown", count: 900 },
    ]);
    expect(overview.attentionDevices).toEqual([
      {
        id: "device-1",
        name: "core-sw-01",
        lastSeenAt: "2026-08-20T10:00:00.000Z",
        interfacesDown: 0,
        isDown: true,
        // Absent from an older server's row reads as "judged by a poll".
        isMonitorBacked: false,
      },
    ]);
    expect(overview.attentionSites).toEqual([
      {
        id: "site-1",
        name: "Warehouse 12",
        siteType: "Warehouse",
        statusName: "Offline",
        statusColor: "#ef4444",
      },
    ]);
  });

  test("string counts everywhere parse into numbers", async () => {
    respondWith({
      fleet: {
        total: "80000",
        up: "79210",
        down: "612",
        pending: "178",
        interfacesDown: "1544",
      },
      siteCount: "1200",
      unhealthySiteCount: "37",
      endpointCount: "260",
      vendors: [{ vendor: "Cisco", count: "41000" }],
      attentionDevices: [{ _id: "d", name: "d", interfacesDown: "3" }],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.fleet).toEqual({
      total: 80000,
      up: 79210,
      down: 612,
      pending: 178,
      interfacesDown: 1544,
    });
    expectRealNumbers([
      overview.fleet.total,
      overview.fleet.up,
      overview.fleet.down,
      overview.fleet.pending,
      overview.fleet.interfacesDown,
      overview.siteCount,
      overview.unhealthySiteCount,
      overview.endpointCount,
      overview.vendors[0]!.count,
      overview.attentionDevices[0]!.interfacesDown,
    ]);
  });

  test("an empty response reads as an empty overview", async () => {
    respondWith({});

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview).toEqual({
      fleet: { total: 0, up: 0, down: 0, pending: 0, interfacesDown: 0 },
      siteCount: 0,
      unhealthySiteCount: 0,
      endpointCount: 0,
      vendors: [],
      attentionDevices: [],
      attentionSites: [],
    });
  });

  test("an absent fleet reads as a zeroed fleet, not undefined", async () => {
    respondWith({ siteCount: 4 });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.fleet).toEqual({
      total: 0,
      up: 0,
      down: 0,
      pending: 0,
      interfacesDown: 0,
    });
    expectRealNumbers([overview.fleet.total, overview.fleet.up]);
  });

  test("a null fleet reads as a zeroed fleet", async () => {
    respondWith({ fleet: null });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.fleet).toEqual({
      total: 0,
      up: 0,
      down: 0,
      pending: 0,
      interfacesDown: 0,
    });
  });

  test("a string fleet reads as a zeroed fleet", async () => {
    respondWith({ fleet: "80000 devices" });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.fleet).toEqual({
      total: 0,
      up: 0,
      down: 0,
      pending: 0,
      interfacesDown: 0,
    });
  });

  test("a numeric fleet reads as a zeroed fleet", async () => {
    respondWith({ fleet: 80000 });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.fleet).toEqual({
      total: 0,
      up: 0,
      down: 0,
      pending: 0,
      interfacesDown: 0,
    });
  });

  test("an array fleet reads as a zeroed fleet", async () => {
    respondWith({ fleet: [80000, 79210] });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.fleet).toEqual({
      total: 0,
      up: 0,
      down: 0,
      pending: 0,
      interfacesDown: 0,
    });
  });

  test("a partial fleet fills only the members that arrived", async () => {
    respondWith({ fleet: { total: 10, up: "7" } });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.fleet).toEqual({
      total: 10,
      up: 7,
      down: 0,
      pending: 0,
      interfacesDown: 0,
    });
  });

  test("absent list fields read as empty arrays", async () => {
    respondWith({ fleet: { total: 1 } });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.vendors).toEqual([]);
    expect(overview.attentionDevices).toEqual([]);
    expect(overview.attentionSites).toEqual([]);
  });

  test("non-array list fields read as empty arrays", async () => {
    respondWith({
      vendors: "Cisco",
      attentionDevices: { _id: "device-1" },
      attentionSites: 7,
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.vendors).toEqual([]);
    expect(overview.attentionDevices).toEqual([]);
    expect(overview.attentionSites).toEqual([]);
  });

  test("null list fields read as empty arrays", async () => {
    respondWith({
      vendors: null,
      attentionDevices: null,
      attentionSites: null,
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.vendors).toEqual([]);
    expect(overview.attentionDevices).toEqual([]);
    expect(overview.attentionSites).toEqual([]);
  });

  /*
   * A non-object entry has to be DROPPED, not mapped. Mapping it would push an
   * `undefined`-shaped row into the array, and both teasers render one <div>
   * per entry with `key={device.id}` — an entry with no id at all produces a
   * row with no name, no link target and a duplicate React key.
   */
  test("non-object vendor entries are dropped rather than mapped", async () => {
    respondWith({
      vendors: [
        { vendor: "Cisco", count: 41000 },
        null,
        "Juniper",
        42,
        ["Arista", 3],
        undefined,
        { vendor: "Aruba", count: "900" },
      ],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.vendors).toEqual([
      { vendor: "Cisco", count: 41000 },
      { vendor: "Aruba", count: 900 },
    ]);
    for (const vendor of overview.vendors) {
      expect(vendor).toBeDefined();
      expect(typeof vendor.vendor).toBe("string");
    }
  });

  test("non-object attention-device entries are dropped rather than mapped", async () => {
    respondWith({
      attentionDevices: [
        null,
        "device-1",
        7,
        [],
        { _id: "device-2", name: "edge-rtr-02", isDown: true },
      ],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.attentionDevices).toHaveLength(1);
    expect(overview.attentionDevices[0]!.id).toBe("device-2");
    for (const device of overview.attentionDevices) {
      expect(device).toBeDefined();
    }
  });

  test("non-object attention-site entries are dropped rather than mapped", async () => {
    respondWith({
      attentionSites: [
        null,
        "site-1",
        0,
        [{ _id: "nested" }],
        { _id: "site-2", name: "Depot 4" },
      ],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.attentionSites).toHaveLength(1);
    expect(overview.attentionSites[0]!.id).toBe("site-2");
  });

  test("a vendor with no fields reads as an empty label and a zero count", async () => {
    respondWith({ vendors: [{}] });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    const vendor: OverviewVendor = overview.vendors[0]!;
    expect(vendor.vendor).toBe("");
    expect(vendor.count).toBe(0);
  });

  /*
   * isDown decides which of two mutually exclusive lines the row renders:
   * "Last seen X" / "Never answered" for a down device, "N interfaces down"
   * for a degraded one. Anything that is not the boolean true has to read as
   * false — the string "false" is truthy in JavaScript, so a loose check would
   * report a healthy device as hard-down.
   */
  test("isDown is true only for the boolean true", async () => {
    respondWith({
      attentionDevices: [
        { _id: "a", isDown: true },
        { _id: "b", isDown: "true" },
        { _id: "c", isDown: "false" },
        { _id: "d", isDown: 1 },
        { _id: "e", isDown: 0 },
        { _id: "f", isDown: null },
        { _id: "g" },
      ],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    const flags: Array<boolean> = overview.attentionDevices.map(
      (device: OverviewAttentionDevice): boolean => {
        return device.isDown;
      },
    );

    expect(flags).toEqual([true, false, false, false, false, false, false]);
    for (const flag of flags) {
      expect(typeof flag).toBe("boolean");
    }
  });

  /*
   * The page branches on lastSeenAt being null to choose between "Last seen X"
   * and "Never answered", and feeds a non-null value straight to
   * OneUptimeDate.fromString. An empty string is not a date, so it has to
   * arrive as null rather than as "" — otherwise the row claims a device was
   * last seen at an unparseable instant instead of saying it never answered.
   */
  test("an empty lastSeenAt becomes null", async () => {
    respondWith({ attentionDevices: [{ _id: "a", lastSeenAt: "" }] });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.attentionDevices[0]!.lastSeenAt).toBeNull();
  });

  test("an absent lastSeenAt becomes null", async () => {
    respondWith({ attentionDevices: [{ _id: "a" }] });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.attentionDevices[0]!.lastSeenAt).toBeNull();
  });

  test("a null lastSeenAt stays null", async () => {
    respondWith({ attentionDevices: [{ _id: "a", lastSeenAt: null }] });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.attentionDevices[0]!.lastSeenAt).toBeNull();
  });

  test("a non-string lastSeenAt becomes null rather than a number", async () => {
    respondWith({
      attentionDevices: [{ _id: "a", lastSeenAt: 1755684000000 }],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.attentionDevices[0]!.lastSeenAt).toBeNull();
  });

  test("a real lastSeenAt is passed through untouched", async () => {
    respondWith({
      attentionDevices: [{ _id: "a", lastSeenAt: "2026-08-20T10:00:00.000Z" }],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.attentionDevices[0]!.lastSeenAt).toBe(
      "2026-08-20T10:00:00.000Z",
    );
  });

  /*
   * An entry with no `_id` is DROPPED, not rendered as a blank row.
   *
   * The non-object filter guards the shape of an entry; this guards the one
   * field the JSX depends on. The page keys its rows on this value and builds
   * `getDeviceRoute(id)` out of it, and `new ObjectID("")` does not throw — so
   * two such entries would quietly share the React key `""` and both link to a
   * device view with an empty modelId. The endpoint always sends an id; this is
   * the boundary refusing to render one that is missing as if it were real.
   */
  test("an attention device with no id is dropped rather than blanked", async () => {
    respondWith({
      attentionDevices: [
        {},
        { _id: "", name: "Blank" },
        { _id: "device-1", name: "Core SW", interfacesDown: 3, isDown: false },
      ],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(overview.attentionDevices).toEqual([
      {
        id: "device-1",
        name: "Core SW",
        lastSeenAt: null,
        interfacesDown: 3,
        isDown: false,
        isMonitorBacked: false,
      },
    ]);
  });

  test("an attention site with no id is dropped too", async () => {
    respondWith({
      attentionSites: [
        { name: "Nameless" },
        { _id: "site-1", name: "Depot 4" },
      ],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(
      overview.attentionSites.map((site: OverviewAttentionSite): string => {
        return site.id;
      }),
    ).toEqual(["site-1"]);
  });

  /*
   * The site teaser renders the type and the status pill only when they are
   * non-null, so an empty string has to collapse to null — otherwise the row
   * renders an empty pill with a background colour of "".
   */
  test("empty site descriptors collapse to null", async () => {
    respondWith({
      attentionSites: [
        {
          _id: "site-1",
          name: "Depot 4",
          siteType: "",
          statusName: "",
          statusColor: "",
        },
      ],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    const site: OverviewAttentionSite = overview.attentionSites[0]!;
    expect(site.siteType).toBeNull();
    expect(site.statusName).toBeNull();
    expect(site.statusColor).toBeNull();
    expect(site.name).toBe("Depot 4");
  });

  test("non-string site descriptors collapse to null", async () => {
    respondWith({
      attentionSites: [
        {
          _id: "site-1",
          name: 42,
          siteType: { value: "Warehouse" },
          statusName: 7,
          statusColor: ["#ef4444"],
        },
      ],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    const site: OverviewAttentionSite = overview.attentionSites[0]!;
    expect(site.name).toBe("");
    expect(site.siteType).toBeNull();
    expect(site.statusName).toBeNull();
    expect(site.statusColor).toBeNull();
  });

  test("unexpected extra fields are dropped from every level", async () => {
    respondWith({
      fleet: { total: 1, unknownState: 9 },
      siteCount: 2,
      unhealthySiteCount: 3,
      endpointCount: 4,
      archivedDeviceCount: 5,
      vendors: [{ vendor: "Cisco", count: 1, model: "C9300" }],
      attentionDevices: [{ _id: "a", name: "n", ipAddress: "10.0.0.1" }],
      attentionSites: [{ _id: "s", name: "n", latitude: 51.5 }],
    });

    const overview: NetworkOverviewSummary = await fetchNetworkOverview();

    expect(Object.keys(overview).sort()).toEqual([
      "attentionDevices",
      "attentionSites",
      "endpointCount",
      "fleet",
      "siteCount",
      "unhealthySiteCount",
      "vendors",
    ]);
    expect(Object.keys(overview.fleet).sort()).toEqual([
      "down",
      "interfacesDown",
      "pending",
      "total",
      "up",
    ]);
    expect(Object.keys(overview.vendors[0]!).sort()).toEqual([
      "count",
      "vendor",
    ]);
    expect(Object.keys(overview.attentionDevices[0]!).sort()).toEqual([
      "id",
      "interfacesDown",
      "isDown",
      "isMonitorBacked",
      "lastSeenAt",
      "name",
    ]);
    expect(Object.keys(overview.attentionSites[0]!).sort()).toEqual([
      "id",
      "name",
      "siteType",
      "statusColor",
      "statusName",
    ]);
  });
});

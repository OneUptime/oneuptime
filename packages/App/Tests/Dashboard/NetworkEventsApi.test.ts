/*
 * The requests are built from the dashboard's APP_API_URL, which reads the
 * browser's window; the node environment has none, so it is given here.
 * The network itself is never reached: the list and the POST are mocks.
 */
jest.mock("Common/UI/Config", () => {
  const { default: URLType } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (url: string) => unknown };
  };

  return {
    __esModule: true,
    APP_API_URL: URLType.fromString("https://oneuptime.example.com/api"),
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

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "Common/Types/ObjectID",
        ) as { default: new (id: string) => unknown };

        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  NETWORK_EVENTS_FACETS_PATH,
  NETWORK_EVENTS_LOOKBACK_IN_DAYS,
  NetworkEventsBackground,
  NetworkEventsPage,
  fetchNetworkEventSources,
  fetchNetworkEvents,
  fetchNetworkEventsBackground,
} from "../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsApi";
import {
  NETWORK_EVENTS_PAGE_LIMIT,
  NETWORK_EVENT_SOURCES_LOG_LIMIT,
  NetworkEventSource,
  NetworkEventsScope,
} from "../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsModel";
import Log from "Common/Models/AnalyticsModels/Log";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { NetworkEventKind } from "Common/Types/NetworkEvent/NetworkEventType";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";

/*
 * Events are logs, so the Events pages read them through the logs' own
 * list and facets endpoints: no endpoint of their own, and the same access
 * rules as every other log. These pin what the pages ask for - the scope,
 * the filters, the window, how many - and how the answers are read.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "84858d6c-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-10-12T12:00:00.000Z"),
  NOW,
);
const NETWORK: NetworkEventsScope = { kind: "network" };
const DEVICE: NetworkEventsScope = {
  kind: "device",
  networkDeviceId: DEVICE_ID,
};

const postMock: jest.Mock = API.post as unknown as jest.Mock;
const getListMock: jest.Mock =
  AnalyticsModelAPI.getList as unknown as jest.Mock;

interface ListRequest {
  modelType: unknown;
  query: {
    projectId: string;
    time: InBetween<Date>;
    attributes: Record<string, string>;
  };
  limit: number;
  skip: number;
  select: Record<string, boolean>;
  sort: Record<string, SortOrder>;
}

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
  headers: Record<string, string>;
}

function listRequests(): Array<ListRequest> {
  return getListMock.mock.calls.map((call: Array<unknown>): ListRequest => {
    return call[0] as ListRequest;
  });
}

function postRequests(): Array<PostRequest> {
  return postMock.mock.calls.map((call: Array<unknown>): PostRequest => {
    return call[0] as PostRequest;
  });
}

function eventLog(index: number, attributes: JSONObject = {}): JSONObject {
  return {
    _id: `log-${index}`,
    time: new Date(NOW.getTime() - index * 1000),
    body: `body ${index}`,
    attributes: {
      "event.domain": "network",
      "event.name": "interface.down",
      "event.kind": "problem",
      "event.device": "Core Switch",
      ...attributes,
    },
  };
}

function answerList(logs: Array<JSONObject>, hasMore?: boolean): void {
  getListMock.mockResolvedValue({
    data: logs,
    count: logs.length,
    skip: 0,
    limit: 500,
    ...(hasMore === undefined ? {} : { hasMore: hasMore }),
  });
}

function answerFacets(facets: JSONObject): void {
  postMock.mockResolvedValue({ data: { facets: facets } });
}

beforeEach(() => {
  postMock.mockReset();
  getListMock.mockReset();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("fetchNetworkEvents", () => {
  test("lists the newest events of the window, and counts the window in the same breath", async () => {
    answerList([eventLog(0), eventLog(1)]);
    answerFacets({
      "event.kind": [{ value: "problem", count: 2 }],
      "event.name": [{ value: "interface.down", count: 2 }],
      "event.device": [{ value: "Core Switch", count: 2 }],
    });

    const page: NetworkEventsPage = await fetchNetworkEvents({
      scope: NETWORK,
      filters: {},
      window: WINDOW,
    });

    expect(getListMock).toHaveBeenCalledTimes(1);
    const list: ListRequest = listRequests()[0]!;

    expect(list.modelType).toBe(Log);
    expect(list.query.projectId).toBe(PROJECT_ID);
    expect(list.query.time).toBe(WINDOW);
    expect(list.query.attributes).toEqual({ "event.domain": "network" });
    expect(list.limit).toBe(NETWORK_EVENTS_PAGE_LIMIT);
    expect(list.limit).toBe(500);
    expect(list.skip).toBe(0);
    expect(list.sort).toEqual({ time: SortOrder.Descending });
    // Only what a row is made of: the body is there for an event with no words of its own.
    expect(list.select).toEqual({
      time: true,
      body: true,
      severityText: true,
      attributes: true,
    });

    expect(NETWORK_EVENTS_FACETS_PATH).toBe("/telemetry/logs/facets");
    expect(postMock).toHaveBeenCalledTimes(1);
    const facets: PostRequest = postRequests()[0]!;

    expect(facets.url.toString()).toBe(
      "https://oneuptime.example.com/api/telemetry/logs/facets",
    );
    expect(facets.headers).toEqual({ tenantid: PROJECT_ID });
    expect(facets.data).toEqual({
      startTime: "2026-10-12T12:00:00.000Z",
      endTime: "2026-10-13T12:00:00.000Z",
      facetKeys: ["event.kind", "event.name", "event.device"],
      attributes: { "event.domain": "network" },
      limit: 200,
    });

    expect(
      page.rows.map((row: { id: string; name: string }): string => {
        return `${row.id} ${row.name}`;
      }),
    ).toEqual(["log-0-0 interface.down", "log-1-1 interface.down"]);
    expect(page.hasMore).toBe(false);
    expect(page.counts.total).toBe(2);
    expect(page.counts.byKind).toEqual({ problem: 2, recovery: 0, info: 0 });
    expect(page.counts.devices).toEqual([{ value: "Core Switch", count: 2 }]);
  });

  test("one device's page asks for that device's events, by the id a rename does not change", async () => {
    answerList([]);
    answerFacets({});

    await fetchNetworkEvents({ scope: DEVICE, filters: {}, window: WINDOW });

    const expected: Record<string, string> = {
      "event.domain": "network",
      "networkDevice.id": DEVICE_ID,
    };

    expect(listRequests()[0]!.query.attributes).toEqual(expected);
    expect(postRequests()[0]!.data["attributes"]).toEqual(expected);
  });

  test("the list is narrowed by every filter; the counts leave the kind out, so the other kinds' buttons still count", async () => {
    answerList([]);
    answerFacets({});

    await fetchNetworkEvents({
      scope: NETWORK,
      filters: {
        kind: NetworkEventKind.Problem,
        event: "vpn.tunnel_down",
        device: "Branch Firewall",
      },
      window: WINDOW,
    });

    expect(listRequests()[0]!.query.attributes).toEqual({
      "event.domain": "network",
      "event.kind": "problem",
      "event.name": "vpn.tunnel_down",
      "event.device": "Branch Firewall",
    });
    expect(postRequests()[0]!.data["attributes"]).toEqual({
      "event.domain": "network",
      "event.name": "vpn.tunnel_down",
      "event.device": "Branch Firewall",
    });
  });

  test("says there are more when the list says so - and only then", async () => {
    answerFacets({});

    answerList([eventLog(0)], true);
    expect(
      (
        await fetchNetworkEvents({
          scope: NETWORK,
          filters: {},
          window: WINDOW,
        })
      ).hasMore,
    ).toBe(true);

    answerList([eventLog(0)], false);
    expect(
      (
        await fetchNetworkEvents({
          scope: NETWORK,
          filters: {},
          window: WINDOW,
        })
      ).hasMore,
    ).toBe(false);

    // A server that does not say is not asked twice.
    answerList([eventLog(0)]);
    expect(
      (
        await fetchNetworkEvents({
          scope: NETWORK,
          filters: {},
          window: WINDOW,
        })
      ).hasMore,
    ).toBe(false);
  });

  test("never shows more rows than a page holds, whatever comes back", async () => {
    const logs: Array<JSONObject> = [];

    for (
      let index: number = 0;
      index < NETWORK_EVENTS_PAGE_LIMIT + 7;
      index++
    ) {
      logs.push(eventLog(index));
    }

    answerList(logs, true);
    answerFacets({});

    const page: NetworkEventsPage = await fetchNetworkEvents({
      scope: NETWORK,
      filters: {},
      window: WINDOW,
    });

    expect(page.rows).toHaveLength(NETWORK_EVENTS_PAGE_LIMIT);
    expect(page.rows[0]!.id).toBe("log-0-0");
  });

  test("a log that is no network event is left out of the rows", async () => {
    answerList([
      eventLog(0),
      { _id: "x", time: NOW, body: "not an event", attributes: {} },
    ]);
    answerFacets({});

    expect(
      (
        await fetchNetworkEvents({
          scope: NETWORK,
          filters: {},
          window: WINDOW,
        })
      ).rows,
    ).toHaveLength(1);
  });

  test("counts that could not be read are no counts; the rows still come", async () => {
    answerList([eventLog(0)]);
    postMock.mockResolvedValue({ data: {} });

    const page: NetworkEventsPage = await fetchNetworkEvents({
      scope: NETWORK,
      filters: {},
      window: WINDOW,
    });

    expect(page.rows).toHaveLength(1);
    expect(page.counts.total).toBe(0);
  });

  test("an error answer from the counts is thrown, for the page to say", async () => {
    answerList([]);
    const error: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "You do not have permission to read logs." },
      {},
    );
    postMock.mockResolvedValue(error);

    await expect(
      fetchNetworkEvents({ scope: NETWORK, filters: {}, window: WINDOW }),
    ).rejects.toBe(error);
  });

  test("a list that fails is thrown too", async () => {
    const error: Error = new Error("The time range is too long.");
    getListMock.mockRejectedValue(error);
    answerFacets({});

    await expect(
      fetchNetworkEvents({ scope: NETWORK, filters: {}, window: WINDOW }),
    ).rejects.toBe(error);
  });
});

describe("fetchNetworkEventsBackground: why a range has nothing in it", () => {
  test("looks back a week from now", async () => {
    answerList([eventLog(0)]);

    await fetchNetworkEventsBackground(NETWORK);

    const window: InBetween<Date> = listRequests()[0]!.query.time;

    expect(NETWORK_EVENTS_LOOKBACK_IN_DAYS).toBe(7);
    expect(window.endValue).toEqual(NOW);
    expect(window.startValue).toEqual(new Date("2026-10-06T12:00:00.000Z"));
  });

  test("there was an event: when the last one was, in one request", async () => {
    const last: Date = new Date("2026-10-10T08:30:00.000Z");
    answerList([{ ...eventLog(0), time: last }]);

    const background: NetworkEventsBackground =
      await fetchNetworkEventsBackground(NETWORK);

    expect(background).toEqual({ lastEventAt: last, isReceivingLogs: true });
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(postMock).not.toHaveBeenCalled();
    expect(listRequests()[0]!.limit).toBe(1);
    expect(listRequests()[0]!.sort).toEqual({ time: SortOrder.Descending });
    expect(listRequests()[0]!.query.attributes).toEqual({
      "event.domain": "network",
    });
  });

  test("a device with no event: whether anything of its syslog or traps arrived at all", async () => {
    getListMock
      .mockResolvedValueOnce({ data: [], count: 0, skip: 0, limit: 1 })
      .mockResolvedValueOnce({
        data: [{ _id: "any", time: NOW, body: "DHCPACK", attributes: {} }],
        count: 1,
        skip: 0,
        limit: 1,
      });

    expect(await fetchNetworkEventsBackground(DEVICE)).toEqual({
      lastEventAt: null,
      isReceivingLogs: true,
    });

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(listRequests()[0]!.query.attributes).toEqual({
      "event.domain": "network",
      "networkDevice.id": DEVICE_ID,
    });
    // Any log of the device, event or not.
    expect(listRequests()[1]!.query.attributes).toEqual({
      "networkDevice.id": DEVICE_ID,
    });
    expect(listRequests()[1]!.limit).toBe(1);
    expect(postMock).not.toHaveBeenCalled();
  });

  test("a device nothing has arrived from", async () => {
    answerList([]);

    expect(await fetchNetworkEventsBackground(DEVICE)).toEqual({
      lastEventAt: null,
      isReceivingLogs: false,
    });
  });

  test("the network with no event: whether any probe heard syslog at all", async () => {
    answerList([]);
    answerFacets({ "syslog.sourceIp": [{ value: "10.0.0.2", count: 14 }] });

    expect(await fetchNetworkEventsBackground(NETWORK)).toEqual({
      lastEventAt: null,
      isReceivingLogs: true,
    });

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postRequests()[0]!.url.toString()).toBe(
      "https://oneuptime.example.com/api/telemetry/logs/facets",
    );
    // The logs that HAVE a sender's address, whatever it is: one is enough.
    expect(postRequests()[0]!.data).toEqual({
      startTime: "2026-10-06T12:00:00.000Z",
      endTime: "2026-10-13T12:00:00.000Z",
      facetKeys: ["syslog.sourceIp"],
      attributes: {},
      limit: 1,
    });
  });

  test.each([
    ["no senders", { "syslog.sourceIp": [] }],
    ["no such facet", {}],
    ["a facet that is not a list", { "syslog.sourceIp": "10.0.0.2" }],
  ])(
    "the network with no event and %s: nothing is arriving",
    async (_name: string, facets: JSONObject) => {
      answerList([]);
      answerFacets(facets);

      expect(await fetchNetworkEventsBackground(NETWORK)).toEqual({
        lastEventAt: null,
        isReceivingLogs: false,
      });
    },
  );

  test("an answer with no facets at all is nothing arriving, not a crash", async () => {
    answerList([]);
    postMock.mockResolvedValue({ data: {} });

    expect(await fetchNetworkEventsBackground(NETWORK)).toEqual({
      lastEventAt: null,
      isReceivingLogs: false,
    });
  });

  test("an event with no time on it still says events arrive", async () => {
    answerList([{ ...eventLog(0), time: undefined }]);

    expect(await fetchNetworkEventsBackground(NETWORK)).toEqual({
      lastEventAt: null,
      isReceivingLogs: true,
    });
  });
});

describe("fetchNetworkEventSources: who sends syslog without being a device", () => {
  test("reads the newest logs ingest marked as from no device, and lists their senders", async () => {
    answerList([
      {
        time: new Date("2026-10-13T11:59:00.000Z"),
        attributes: {
          "syslog.unmatched": "true",
          "syslog.sourceIp": "203.0.113.7",
          "syslog.hostname": "edge-sw9",
          "syslog.vendor": "Cisco",
          "probe.id": "44444444-4444-4444-8444-444444444444",
        },
      },
      {
        time: new Date("2026-10-13T11:58:00.000Z"),
        attributes: {
          "syslog.unmatched": "true",
          "syslog.sourceIp": "203.0.113.7",
        },
      },
    ]);

    const sources: Array<NetworkEventSource> =
      await fetchNetworkEventSources(WINDOW);

    const list: ListRequest = listRequests()[0]!;

    expect(list.query.time).toBe(WINDOW);
    // Stored as a switch; ClickHouse keeps, and compares, the string.
    expect(list.query.attributes).toEqual({ "syslog.unmatched": "true" });
    expect(list.limit).toBe(NETWORK_EVENT_SOURCES_LOG_LIMIT);
    expect(list.sort).toEqual({ time: SortOrder.Descending });
    expect(postMock).not.toHaveBeenCalled();

    expect(sources).toEqual([
      {
        address: "203.0.113.7",
        hostname: "edge-sw9",
        vendor: "Cisco",
        probeId: "44444444-4444-4444-8444-444444444444",
        lastSeenAt: new Date("2026-10-13T11:59:00.000Z"),
        messageCount: 2,
      },
    ]);
  });

  test("nobody", async () => {
    answerList([]);

    expect(await fetchNetworkEventSources(WINDOW)).toEqual([]);
  });
});

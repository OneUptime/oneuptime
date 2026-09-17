import { describe, expect, test } from "@jest/globals";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import {
  renderHook,
  waitFor,
  type RenderHookResult,
} from "@testing-library/react-native";
import {
  useAlertDetail,
  useAlertFeed,
  useAlertStateTimeline,
  useAlertStates,
} from "./useAlertDetail";
import * as alertsApi from "../api/alerts";
import type {
  AlertItem,
  AlertState,
  FeedItem,
  StateTimelineItem,
} from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeAlert,
  makeAlertState,
  makeFeedItem,
  makeStateTimelineItem,
} from "../__tests__/testSupport";

/*
 * The four read hooks behind the alert detail screen. Each is a handful of
 * lines wrapping useQuery, so there is barely any logic here to get wrong -
 * which is exactly why the things that CAN go wrong are the kind nobody
 * notices until a responder is looking at the wrong page in the middle of the
 * night.
 *
 * Two of those things are worth stating before the tests.
 *
 * FIRST, the query key is a contract, not an implementation detail.
 * AlertDetailScreen hand-writes ["alert", projectId, alertId] to apply the
 * optimistic state change before the request lands. Nothing links that literal
 * to this file. If the key here ever drifts, the screen's optimistic write
 * lands in a cache entry no hook is reading: the state chip keeps saying
 * "Created" after the responder acknowledged the page, and not one thing
 * throws. So these tests pin the key itself, not just the fact that data
 * arrives.
 *
 * SECOND, the project id in that key is load-bearing. It is what the api layer
 * sends as the `tenantid` header, so the same alert id read under two
 * different projects is two different requests with two different answers. A
 * key that dropped the project id would hand one project's alert to another
 * project's screen straight from cache, with no request made and therefore
 * nothing to notice. The "does not share a cache entry" tests below are the
 * only place that can fail.
 */

jest.mock("../api/alerts", () => {
  return {
    fetchAlertById: jest.fn(),
    fetchAlertStates: jest.fn(),
    fetchAlertStateTimeline: jest.fn(),
    fetchAlertFeed: jest.fn(),
  };
});

const fetchAlertByIdMock: jest.Mock =
  alertsApi.fetchAlertById as unknown as jest.Mock;
const fetchAlertStatesMock: jest.Mock =
  alertsApi.fetchAlertStates as unknown as jest.Mock;
const fetchAlertStateTimelineMock: jest.Mock =
  alertsApi.fetchAlertStateTimeline as unknown as jest.Mock;
const fetchAlertFeedMock: jest.Mock =
  alertsApi.fetchAlertFeed as unknown as jest.Mock;

type QueryHandle<TData> = RenderHookResult<
  UseQueryResult<TData, Error>,
  unknown
>;

/**
 * Render one query hook against a caller-supplied client.
 *
 * The client is a parameter rather than something this helper creates, because
 * the cache-separation tests turn on two hooks sharing ONE client - that
 * shared client is the thing being tested, and hiding it inside a helper would
 * hide the test.
 */
async function renderQuery<TData>(
  client: QueryClient,
  useHook: () => UseQueryResult<TData, Error>,
): Promise<QueryHandle<TData>> {
  return renderHook(useHook, { wrapper: createQueryWrapper(client) });
}

/**
 * Every query key currently in the cache, in insertion order.
 *
 * Asserting on this rather than on getQueryData alone is deliberate: it fails
 * loudly when a key gains, loses or reorders a segment, which is the change
 * that silently breaks the screen's hand-written key.
 */
function cachedKeys(client: QueryClient): Array<ReadonlyArray<unknown>> {
  return client
    .getQueryCache()
    .getAll()
    .map((query: { queryKey: ReadonlyArray<unknown> }) => {
      return query.queryKey;
    });
}

describe("useAlertDetail", () => {
  test("asks the api for that alert under the project that owns it", async () => {
    const alert: AlertItem = makeAlert();
    fetchAlertByIdMock.mockResolvedValue(alert);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertDetail("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchAlertByIdMock).toHaveBeenCalledTimes(1);
    expect(fetchAlertByIdMock).toHaveBeenCalledWith("project-1", "alert-1");
  });

  test("hands the alert to the caller exactly as the api returned it", async () => {
    const alert: AlertItem = makeAlert();
    fetchAlertByIdMock.mockResolvedValue(alert);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertDetail("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(alert);
  });

  test("caches the alert under the key the detail screen writes by hand", async () => {
    const alert: AlertItem = makeAlert();
    fetchAlertByIdMock.mockResolvedValue(alert);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertDetail("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(cachedKeys(client)).toEqual([["alert", "project-1", "alert-1"]]);
    expect(
      client.getQueryData<AlertItem>(["alert", "project-1", "alert-1"]),
    ).toEqual(alert);
  });

  test("two alerts in the same project do not share a cache entry", async () => {
    const diskAlert: AlertItem = makeAlert({
      _id: "alert-1",
      title: "Disk almost full",
    });
    const certificateAlert: AlertItem = makeAlert({
      _id: "alert-2",
      title: "Certificate expires in 3 days",
    });
    fetchAlertByIdMock.mockImplementation(
      (projectId: string, alertId: string) => {
        return Promise.resolve(
          alertId === "alert-1" ? diskAlert : certificateAlert,
        );
      },
    );
    const client: QueryClient = createTestQueryClient();

    const disk: QueryHandle<AlertItem | null> = await renderQuery(
      client,
      () => {
        return useAlertDetail("project-1", "alert-1");
      },
    );
    await waitFor(() => {
      return expect(disk.result.current.isSuccess).toBe(true);
    });

    const certificate: QueryHandle<AlertItem | null> = await renderQuery(
      client,
      () => {
        return useAlertDetail("project-1", "alert-2");
      },
    );
    await waitFor(() => {
      return expect(certificate.result.current.isSuccess).toBe(true);
    });

    expect(fetchAlertByIdMock).toHaveBeenCalledTimes(2);
    expect(disk.result.current.data).toEqual(diskAlert);
    expect(certificate.result.current.data).toEqual(certificateAlert);
  });

  test("the same alert id under two projects does not share a cache entry", async () => {
    /*
     * Ids are not guaranteed to differ across tenants, and even where they do
     * the request differs: the project id becomes the `tenantid` header. If it
     * fell out of the key the second project would be served the first
     * project's alert without any request being made at all.
     */
    const productionAlert: AlertItem = makeAlert({ title: "Production disk" });
    const stagingAlert: AlertItem = makeAlert({ title: "Staging disk" });
    fetchAlertByIdMock.mockImplementation((projectId: string) => {
      return Promise.resolve(
        projectId === "project-1" ? productionAlert : stagingAlert,
      );
    });
    const client: QueryClient = createTestQueryClient();

    const production: QueryHandle<AlertItem | null> = await renderQuery(
      client,
      () => {
        return useAlertDetail("project-1", "alert-1");
      },
    );
    await waitFor(() => {
      return expect(production.result.current.isSuccess).toBe(true);
    });

    const staging: QueryHandle<AlertItem | null> = await renderQuery(
      client,
      () => {
        return useAlertDetail("project-2", "alert-1");
      },
    );
    await waitFor(() => {
      return expect(staging.result.current.isSuccess).toBe(true);
    });

    expect(fetchAlertByIdMock).toHaveBeenCalledTimes(2);
    expect(fetchAlertByIdMock).toHaveBeenNthCalledWith(
      1,
      "project-1",
      "alert-1",
    );
    expect(fetchAlertByIdMock).toHaveBeenNthCalledWith(
      2,
      "project-2",
      "alert-1",
    );
    expect(production.result.current.data).toEqual(productionAlert);
    expect(staging.result.current.data).toEqual(stagingAlert);
  });

  test("asks for nothing while the project is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useAlertDetail("", "alert-1");
    });

    expect(fetchAlertByIdMock).not.toHaveBeenCalled();
  });

  test("asks for nothing while the alert is still unknown", async () => {
    /*
     * Both ids arrive from navigation params, and a deep link that is still
     * resolving can hand the screen one of them before the other. Firing with
     * an empty alert id would ask the api for a list filtered on _id: "" and
     * read row zero of whatever came back.
     */
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useAlertDetail("project-1", "");
    });

    expect(fetchAlertByIdMock).not.toHaveBeenCalled();
  });

  test("a disabled query reports isPending with nothing in flight, not isLoading", async () => {
    /*
     * This pins a react-query v5 trap for whoever reads this hook next. A
     * DISABLED query is isPending: true forever, because `pending` means only
     * "no data yet" - it says nothing about whether a request is happening.
     * `fetchStatus` is what carries that, and it stays "idle".
     *
     * So a screen that renders a spinner on isPending shows a spinner that
     * never resolves while the ids are still empty. isLoading is the flag that
     * means what such a screen wants (isPending AND fetching), and it is false
     * here. All four hooks in this module share this guard shape, so the
     * behaviour is pinned once, here.
     */
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertDetail("", "");
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  test("surfaces an api rejection as an error rather than as an alert that is simply missing", async () => {
    /*
     * An alert that failed to load and an alert that does not exist look the
     * same to a screen reading `data` alone. Only isError tells the responder
     * to retry rather than to conclude the page went away.
     */
    const failure: Error = new Error("Request failed with status code 502");
    fetchAlertByIdMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertDetail("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  test("an alert that no longer exists settles as null data, not as a failure", async () => {
    /*
     * The other half of the pair above, and the reason `fetchAlertById` ends in
     * `?? null`. react-query v5 caches `null` like any other value but REFUSES
     * `undefined`, rejecting the query with a synthetic "data is undefined"
     * error - so a deleted alert used to arrive at AlertDetailScreen through
     * isError, indistinguishable from the 502 above except by the wording of a
     * library's message. Pinning isSuccess here is what keeps that from coming
     * back.
     */
    fetchAlertByIdMock.mockResolvedValue(null);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertDetail("project-1", "deleted-alert");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});

describe("useAlertStates", () => {
  test("asks the api for the states of that project", async () => {
    const states: Array<AlertState> = [makeAlertState()];
    fetchAlertStatesMock.mockResolvedValue(states);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertStates("project-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchAlertStatesMock).toHaveBeenCalledTimes(1);
    expect(fetchAlertStatesMock).toHaveBeenCalledWith("project-1");
  });

  test("hands the states to the caller in the order the api gave them", async () => {
    /*
     * The api sorts these by `order` ascending and the screen renders the
     * state-change buttons straight down that list, so a hook that re-ordered
     * or filtered would change what the responder can press.
     */
    const states: Array<AlertState> = [
      makeAlertState({ _id: "alert-state-1", name: "Created", order: 1 }),
      makeAlertState({
        _id: "alert-state-2",
        name: "Acknowledged",
        order: 2,
        isCreatedState: false,
        isAcknowledgedState: true,
      }),
    ];
    fetchAlertStatesMock.mockResolvedValue(states);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertStates("project-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(states);
  });

  test("caches the states under a key carrying the project", async () => {
    fetchAlertStatesMock.mockResolvedValue([makeAlertState()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertStates("project-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(cachedKeys(client)).toEqual([["alert-states", "project-1"]]);
  });

  test("two projects do not share a cache entry", async () => {
    /*
     * Projects define their own alert states, so serving one project's list to
     * another would offer the responder buttons for states that do not exist
     * in the project they are looking at.
     */
    const productionStates: Array<AlertState> = [
      makeAlertState({ _id: "alert-state-1", name: "Created" }),
    ];
    const stagingStates: Array<AlertState> = [
      makeAlertState({ _id: "alert-state-9", name: "Triage" }),
    ];
    fetchAlertStatesMock.mockImplementation((projectId: string) => {
      return Promise.resolve(
        projectId === "project-1" ? productionStates : stagingStates,
      );
    });
    const client: QueryClient = createTestQueryClient();

    const production: QueryHandle<Array<AlertState>> = await renderQuery(
      client,
      () => {
        return useAlertStates("project-1");
      },
    );
    await waitFor(() => {
      return expect(production.result.current.isSuccess).toBe(true);
    });

    const staging: QueryHandle<Array<AlertState>> = await renderQuery(
      client,
      () => {
        return useAlertStates("project-2");
      },
    );
    await waitFor(() => {
      return expect(staging.result.current.isSuccess).toBe(true);
    });

    expect(fetchAlertStatesMock).toHaveBeenCalledTimes(2);
    expect(production.result.current.data).toEqual(productionStates);
    expect(staging.result.current.data).toEqual(stagingStates);
  });

  test("asks for nothing while the project is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useAlertStates("");
    });

    expect(fetchAlertStatesMock).not.toHaveBeenCalled();
  });

  test("surfaces an api rejection as an error rather than as an empty list of states", async () => {
    /*
     * Empty data here would render a detail screen with no state buttons at
     * all, which reads as "this alert cannot be acknowledged" rather than as
     * "the request failed".
     */
    const failure: Error = new Error("Request failed with status code 500");
    fetchAlertStatesMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertStates("project-1");
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useAlertStateTimeline", () => {
  test("asks the api for that alert's timeline under its project", async () => {
    fetchAlertStateTimelineMock.mockResolvedValue([makeStateTimelineItem()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertStateTimeline("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchAlertStateTimelineMock).toHaveBeenCalledTimes(1);
    expect(fetchAlertStateTimelineMock).toHaveBeenCalledWith(
      "project-1",
      "alert-1",
    );
  });

  test("hands the timeline to the caller unchanged", async () => {
    const timeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-2" }),
      makeStateTimelineItem({ _id: "timeline-1" }),
    ];
    fetchAlertStateTimelineMock.mockResolvedValue(timeline);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertStateTimeline("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(timeline);
  });

  test("caches the timeline under a key carrying both the project and the alert", async () => {
    fetchAlertStateTimelineMock.mockResolvedValue([makeStateTimelineItem()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertStateTimeline("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(cachedKeys(client)).toEqual([
      ["alert-state-timeline", "project-1", "alert-1"],
    ]);
  });

  test("two alerts in the same project do not share a cache entry", async () => {
    const firstTimeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-for-alert-1" }),
    ];
    const secondTimeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-for-alert-2" }),
    ];
    fetchAlertStateTimelineMock.mockImplementation(
      (projectId: string, alertId: string) => {
        return Promise.resolve(
          alertId === "alert-1" ? firstTimeline : secondTimeline,
        );
      },
    );
    const client: QueryClient = createTestQueryClient();

    const first: QueryHandle<Array<StateTimelineItem>> = await renderQuery(
      client,
      () => {
        return useAlertStateTimeline("project-1", "alert-1");
      },
    );
    await waitFor(() => {
      return expect(first.result.current.isSuccess).toBe(true);
    });

    const second: QueryHandle<Array<StateTimelineItem>> = await renderQuery(
      client,
      () => {
        return useAlertStateTimeline("project-1", "alert-2");
      },
    );
    await waitFor(() => {
      return expect(second.result.current.isSuccess).toBe(true);
    });

    expect(fetchAlertStateTimelineMock).toHaveBeenCalledTimes(2);
    expect(first.result.current.data).toEqual(firstTimeline);
    expect(second.result.current.data).toEqual(secondTimeline);
  });

  test("the same alert id under two projects does not share a cache entry", async () => {
    const productionTimeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-production" }),
    ];
    const stagingTimeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-staging" }),
    ];
    fetchAlertStateTimelineMock.mockImplementation((projectId: string) => {
      return Promise.resolve(
        projectId === "project-1" ? productionTimeline : stagingTimeline,
      );
    });
    const client: QueryClient = createTestQueryClient();

    const production: QueryHandle<Array<StateTimelineItem>> = await renderQuery(
      client,
      () => {
        return useAlertStateTimeline("project-1", "alert-1");
      },
    );
    await waitFor(() => {
      return expect(production.result.current.isSuccess).toBe(true);
    });

    const staging: QueryHandle<Array<StateTimelineItem>> = await renderQuery(
      client,
      () => {
        return useAlertStateTimeline("project-2", "alert-1");
      },
    );
    await waitFor(() => {
      return expect(staging.result.current.isSuccess).toBe(true);
    });

    expect(fetchAlertStateTimelineMock).toHaveBeenCalledTimes(2);
    expect(production.result.current.data).toEqual(productionTimeline);
    expect(staging.result.current.data).toEqual(stagingTimeline);
  });

  test("asks for nothing while the project is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useAlertStateTimeline("", "alert-1");
    });

    expect(fetchAlertStateTimelineMock).not.toHaveBeenCalled();
  });

  test("asks for nothing while the alert is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useAlertStateTimeline("project-1", "");
    });

    expect(fetchAlertStateTimelineMock).not.toHaveBeenCalled();
  });

  test("surfaces an api rejection as an error rather than as an empty timeline", async () => {
    const failure: Error = new Error("Request failed with status code 503");
    fetchAlertStateTimelineMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertStateTimeline("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useAlertFeed", () => {
  test("asks the api for that alert's feed under its project", async () => {
    fetchAlertFeedMock.mockResolvedValue([makeFeedItem()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertFeed("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchAlertFeedMock).toHaveBeenCalledTimes(1);
    expect(fetchAlertFeedMock).toHaveBeenCalledWith("project-1", "alert-1");
  });

  test("hands the feed to the caller unchanged", async () => {
    const feed: Array<FeedItem> = [
      makeFeedItem({
        _id: "feed-2",
        feedInfoInMarkdown: "**Acknowledged** by Ada Lovelace",
      }),
      makeFeedItem({ _id: "feed-1", feedInfoInMarkdown: "Alert created" }),
    ];
    fetchAlertFeedMock.mockResolvedValue(feed);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertFeed("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(feed);
  });

  test("caches the feed under a key carrying both the project and the alert", async () => {
    fetchAlertFeedMock.mockResolvedValue([makeFeedItem()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertFeed("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(cachedKeys(client)).toEqual([
      ["alert-feed", "project-1", "alert-1"],
    ]);
  });

  test("two alerts in the same project do not share a cache entry", async () => {
    /*
     * The feed is the narrative of what happened to one alert - who was paged,
     * who acknowledged, what the escalation did. Cross-wiring two alerts here
     * would attribute one alert's history to another.
     */
    const firstFeed: Array<FeedItem> = [
      makeFeedItem({ _id: "feed-for-alert-1" }),
    ];
    const secondFeed: Array<FeedItem> = [
      makeFeedItem({ _id: "feed-for-alert-2" }),
    ];
    fetchAlertFeedMock.mockImplementation(
      (projectId: string, alertId: string) => {
        return Promise.resolve(alertId === "alert-1" ? firstFeed : secondFeed);
      },
    );
    const client: QueryClient = createTestQueryClient();

    const first: QueryHandle<Array<FeedItem>> = await renderQuery(
      client,
      () => {
        return useAlertFeed("project-1", "alert-1");
      },
    );
    await waitFor(() => {
      return expect(first.result.current.isSuccess).toBe(true);
    });

    const second: QueryHandle<Array<FeedItem>> = await renderQuery(
      client,
      () => {
        return useAlertFeed("project-1", "alert-2");
      },
    );
    await waitFor(() => {
      return expect(second.result.current.isSuccess).toBe(true);
    });

    expect(fetchAlertFeedMock).toHaveBeenCalledTimes(2);
    expect(first.result.current.data).toEqual(firstFeed);
    expect(second.result.current.data).toEqual(secondFeed);
  });

  test("the same alert id under two projects does not share a cache entry", async () => {
    const productionFeed: Array<FeedItem> = [
      makeFeedItem({ _id: "feed-production" }),
    ];
    const stagingFeed: Array<FeedItem> = [
      makeFeedItem({ _id: "feed-staging" }),
    ];
    fetchAlertFeedMock.mockImplementation((projectId: string) => {
      return Promise.resolve(
        projectId === "project-1" ? productionFeed : stagingFeed,
      );
    });
    const client: QueryClient = createTestQueryClient();

    const production: QueryHandle<Array<FeedItem>> = await renderQuery(
      client,
      () => {
        return useAlertFeed("project-1", "alert-1");
      },
    );
    await waitFor(() => {
      return expect(production.result.current.isSuccess).toBe(true);
    });

    const staging: QueryHandle<Array<FeedItem>> = await renderQuery(
      client,
      () => {
        return useAlertFeed("project-2", "alert-1");
      },
    );
    await waitFor(() => {
      return expect(staging.result.current.isSuccess).toBe(true);
    });

    expect(fetchAlertFeedMock).toHaveBeenCalledTimes(2);
    expect(production.result.current.data).toEqual(productionFeed);
    expect(staging.result.current.data).toEqual(stagingFeed);
  });

  test("asks for nothing while the project is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useAlertFeed("", "alert-1");
    });

    expect(fetchAlertFeedMock).not.toHaveBeenCalled();
  });

  test("asks for nothing while the alert is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useAlertFeed("project-1", "");
    });

    expect(fetchAlertFeedMock).not.toHaveBeenCalled();
  });

  test("surfaces an api rejection as an error rather than as an empty feed", async () => {
    const failure: Error = new Error("Request failed with status code 401");
    fetchAlertFeedMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useAlertFeed("project-1", "alert-1");
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

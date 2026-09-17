import { describe, expect, test } from "@jest/globals";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import {
  renderHook,
  waitFor,
  type RenderHookResult,
} from "@testing-library/react-native";
import {
  useIncidentDetail,
  useIncidentFeed,
  useIncidentStateTimeline,
  useIncidentStates,
} from "./useIncidentDetail";
import * as incidentsApi from "../api/incidents";
import type {
  FeedItem,
  IncidentItem,
  IncidentState,
  StateTimelineItem,
} from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeFeedItem,
  makeIncident,
  makeIncidentState,
  makeStateTimelineItem,
} from "../__tests__/testSupport";

/*
 * The four read hooks behind the incident detail screen, and the twins of the
 * alert ones next door. They are a few lines each, so what is under test is
 * not arithmetic - it is the addressing.
 *
 * FIRST, the query key is a contract. IncidentDetailScreen hand-writes
 * ["incident", projectId, incidentId] so it can apply the responder's state
 * change optimistically, before the request lands, and roll it back if the
 * request fails. Nothing connects that literal to this file except agreement.
 * If the key here gained, lost or reordered a segment, the screen's optimistic
 * write and its rollback would both land on a cache entry no hook reads: the
 * state chip would sit on "Created" after an acknowledgement, and nothing
 * would throw. Hence the tests that pin the key itself rather than only the
 * fact that data arrives.
 *
 * SECOND, the project id in that key is not decoration. The api layer turns it
 * into the `tenantid` header, so the same incident id read under two projects
 * is genuinely two different requests with two different answers. A key
 * missing the project id would serve one project's incident to another
 * project's screen out of cache, with no request issued and so nothing
 * anywhere to notice. The "does not share a cache entry" tests are the only
 * thing that can catch it.
 */

jest.mock("../api/incidents", () => {
  return {
    fetchIncidentById: jest.fn(),
    fetchIncidentStates: jest.fn(),
    fetchIncidentStateTimeline: jest.fn(),
    fetchIncidentFeed: jest.fn(),
  };
});

const fetchIncidentByIdMock: jest.Mock =
  incidentsApi.fetchIncidentById as unknown as jest.Mock;
const fetchIncidentStatesMock: jest.Mock =
  incidentsApi.fetchIncidentStates as unknown as jest.Mock;
const fetchIncidentStateTimelineMock: jest.Mock =
  incidentsApi.fetchIncidentStateTimeline as unknown as jest.Mock;
const fetchIncidentFeedMock: jest.Mock =
  incidentsApi.fetchIncidentFeed as unknown as jest.Mock;

type QueryHandle<TData> = RenderHookResult<
  UseQueryResult<TData, Error>,
  unknown
>;

/**
 * Render one query hook against a caller-supplied client.
 *
 * The client is a parameter rather than something this helper creates, because
 * the cache-separation tests turn on two hooks sharing ONE client - that
 * shared client is the thing being tested, and hiding it inside the helper
 * would hide the test.
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
 * loudly when a key gains, loses or reorders a segment, which is precisely the
 * change that silently breaks the screen's hand-written key.
 */
function cachedKeys(client: QueryClient): Array<ReadonlyArray<unknown>> {
  return client
    .getQueryCache()
    .getAll()
    .map((query: { queryKey: ReadonlyArray<unknown> }) => {
      return query.queryKey;
    });
}

describe("useIncidentDetail", () => {
  test("asks the api for that incident under the project that owns it", async () => {
    const incident: IncidentItem = makeIncident();
    fetchIncidentByIdMock.mockResolvedValue(incident);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentDetail("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchIncidentByIdMock).toHaveBeenCalledTimes(1);
    expect(fetchIncidentByIdMock).toHaveBeenCalledWith(
      "project-1",
      "incident-1",
    );
  });

  test("hands the incident to the caller exactly as the api returned it", async () => {
    const incident: IncidentItem = makeIncident();
    fetchIncidentByIdMock.mockResolvedValue(incident);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentDetail("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(incident);
  });

  test("caches the incident under the key the detail screen writes by hand", async () => {
    const incident: IncidentItem = makeIncident();
    fetchIncidentByIdMock.mockResolvedValue(incident);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentDetail("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(cachedKeys(client)).toEqual([
      ["incident", "project-1", "incident-1"],
    ]);
    expect(
      client.getQueryData<IncidentItem>([
        "incident",
        "project-1",
        "incident-1",
      ]),
    ).toEqual(incident);
  });

  test("two incidents in the same project do not share a cache entry", async () => {
    const checkoutIncident: IncidentItem = makeIncident({
      _id: "incident-1",
      title: "Checkout is down",
    });
    const searchIncident: IncidentItem = makeIncident({
      _id: "incident-2",
      title: "Search is returning stale results",
    });
    fetchIncidentByIdMock.mockImplementation(
      (projectId: string, incidentId: string) => {
        return Promise.resolve(
          incidentId === "incident-1" ? checkoutIncident : searchIncident,
        );
      },
    );
    const client: QueryClient = createTestQueryClient();

    const checkout: QueryHandle<IncidentItem | null> = await renderQuery(
      client,
      () => {
        return useIncidentDetail("project-1", "incident-1");
      },
    );
    await waitFor(() => {
      return expect(checkout.result.current.isSuccess).toBe(true);
    });

    const search: QueryHandle<IncidentItem | null> = await renderQuery(
      client,
      () => {
        return useIncidentDetail("project-1", "incident-2");
      },
    );
    await waitFor(() => {
      return expect(search.result.current.isSuccess).toBe(true);
    });

    expect(fetchIncidentByIdMock).toHaveBeenCalledTimes(2);
    expect(checkout.result.current.data).toEqual(checkoutIncident);
    expect(search.result.current.data).toEqual(searchIncident);
  });

  test("the same incident id under two projects does not share a cache entry", async () => {
    /*
     * Ids are not guaranteed to differ across tenants, and even where they do
     * the REQUEST differs: the project id becomes the `tenantid` header. Were
     * it missing from the key, the second project would be handed the first
     * project's incident without a request being made at all.
     */
    const productionIncident: IncidentItem = makeIncident({
      title: "Production checkout is down",
    });
    const stagingIncident: IncidentItem = makeIncident({
      title: "Staging checkout is down",
    });
    fetchIncidentByIdMock.mockImplementation((projectId: string) => {
      return Promise.resolve(
        projectId === "project-1" ? productionIncident : stagingIncident,
      );
    });
    const client: QueryClient = createTestQueryClient();

    const production: QueryHandle<IncidentItem | null> = await renderQuery(
      client,
      () => {
        return useIncidentDetail("project-1", "incident-1");
      },
    );
    await waitFor(() => {
      return expect(production.result.current.isSuccess).toBe(true);
    });

    const staging: QueryHandle<IncidentItem | null> = await renderQuery(
      client,
      () => {
        return useIncidentDetail("project-2", "incident-1");
      },
    );
    await waitFor(() => {
      return expect(staging.result.current.isSuccess).toBe(true);
    });

    expect(fetchIncidentByIdMock).toHaveBeenCalledTimes(2);
    expect(fetchIncidentByIdMock).toHaveBeenNthCalledWith(
      1,
      "project-1",
      "incident-1",
    );
    expect(fetchIncidentByIdMock).toHaveBeenNthCalledWith(
      2,
      "project-2",
      "incident-1",
    );
    expect(production.result.current.data).toEqual(productionIncident);
    expect(staging.result.current.data).toEqual(stagingIncident);
  });

  test("asks for nothing while the project is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useIncidentDetail("", "incident-1");
    });

    expect(fetchIncidentByIdMock).not.toHaveBeenCalled();
  });

  test("asks for nothing while the incident is still unknown", async () => {
    /*
     * Both ids come from navigation params, and a push notification opening
     * the app cold can hand the screen one of them a render before the other.
     * Firing with an empty incident id would ask the api for a list filtered
     * on _id: "" and then read row zero of whatever came back.
     */
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useIncidentDetail("project-1", "");
    });

    expect(fetchIncidentByIdMock).not.toHaveBeenCalled();
  });

  test("a disabled query reports isPending with nothing in flight, not isLoading", async () => {
    /*
     * This pins a react-query v5 trap for whoever reads this hook next. A
     * DISABLED query stays isPending: true forever, because `pending` means
     * only "no data yet" - it says nothing about whether a request is
     * happening. `fetchStatus` is what carries that, and it stays "idle".
     *
     * So a screen that shows a spinner on isPending shows one that never
     * resolves for as long as an id is empty. isLoading is the flag that means
     * what such a screen wants (isPending AND fetching), and it is false here.
     * All four hooks in this module share the guard shape, so the behaviour is
     * pinned once, here.
     */
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentDetail("", "");
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  test("surfaces an api rejection as an error rather than as an incident that is simply missing", async () => {
    /*
     * An incident that failed to load and an incident that does not exist look
     * identical to a screen reading `data` alone. Only isError tells the
     * responder to retry rather than to conclude the incident was deleted out
     * from under them.
     */
    const failure: Error = new Error("Request failed with status code 502");
    fetchIncidentByIdMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentDetail("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  test("an incident that no longer exists settles as null data, not as a failure", async () => {
    /*
     * The other half of the pair above, and the reason `fetchIncidentById` ends
     * in `?? null`. react-query v5 caches `null` like any other value but
     * REFUSES `undefined`, rejecting the query with a synthetic "data is
     * undefined" error - so a deleted incident used to arrive at
     * IncidentDetailScreen through isError, indistinguishable from the 502
     * above except by the wording of a library's message. Pinning isSuccess
     * here is what keeps that from coming back.
     */
    fetchIncidentByIdMock.mockResolvedValue(null);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentDetail("project-1", "deleted-incident");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});

describe("useIncidentStates", () => {
  test("asks the api for the states of that project", async () => {
    fetchIncidentStatesMock.mockResolvedValue([makeIncidentState()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentStates("project-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchIncidentStatesMock).toHaveBeenCalledTimes(1);
    expect(fetchIncidentStatesMock).toHaveBeenCalledWith("project-1");
  });

  test("hands the states to the caller in the order the api gave them", async () => {
    /*
     * The api sorts these by `order` ascending and the detail screen renders
     * the state-change buttons straight down the list, so a hook that
     * re-ordered or dropped one would change what the responder can press.
     */
    const states: Array<IncidentState> = [
      makeIncidentState({ _id: "incident-state-1", name: "Created", order: 1 }),
      makeIncidentState({
        _id: "incident-state-2",
        name: "Acknowledged",
        order: 2,
        isCreatedState: false,
        isAcknowledgedState: true,
      }),
    ];
    fetchIncidentStatesMock.mockResolvedValue(states);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentStates("project-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(states);
  });

  test("caches the states under a key carrying the project", async () => {
    fetchIncidentStatesMock.mockResolvedValue([makeIncidentState()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentStates("project-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(cachedKeys(client)).toEqual([["incident-states", "project-1"]]);
  });

  test("two projects do not share a cache entry", async () => {
    /*
     * Every project defines its own incident states, so serving one project's
     * list to another offers the responder buttons for states that do not
     * exist where they are looking - and the id behind such a button belongs
     * to a different tenant entirely.
     */
    const productionStates: Array<IncidentState> = [
      makeIncidentState({ _id: "incident-state-1", name: "Created" }),
    ];
    const stagingStates: Array<IncidentState> = [
      makeIncidentState({ _id: "incident-state-9", name: "Triage" }),
    ];
    fetchIncidentStatesMock.mockImplementation((projectId: string) => {
      return Promise.resolve(
        projectId === "project-1" ? productionStates : stagingStates,
      );
    });
    const client: QueryClient = createTestQueryClient();

    const production: QueryHandle<Array<IncidentState>> = await renderQuery(
      client,
      () => {
        return useIncidentStates("project-1");
      },
    );
    await waitFor(() => {
      return expect(production.result.current.isSuccess).toBe(true);
    });

    const staging: QueryHandle<Array<IncidentState>> = await renderQuery(
      client,
      () => {
        return useIncidentStates("project-2");
      },
    );
    await waitFor(() => {
      return expect(staging.result.current.isSuccess).toBe(true);
    });

    expect(fetchIncidentStatesMock).toHaveBeenCalledTimes(2);
    expect(production.result.current.data).toEqual(productionStates);
    expect(staging.result.current.data).toEqual(stagingStates);
  });

  test("asks for nothing while the project is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useIncidentStates("");
    });

    expect(fetchIncidentStatesMock).not.toHaveBeenCalled();
  });

  test("surfaces an api rejection as an error rather than as an empty list of states", async () => {
    /*
     * Empty data here renders a detail screen with no state buttons at all,
     * which reads as "this incident cannot be acknowledged" rather than as
     * "the request failed, try again".
     */
    const failure: Error = new Error("Request failed with status code 500");
    fetchIncidentStatesMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentStates("project-1");
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useIncidentStateTimeline", () => {
  test("asks the api for that incident's timeline under its project", async () => {
    fetchIncidentStateTimelineMock.mockResolvedValue([makeStateTimelineItem()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentStateTimeline("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchIncidentStateTimelineMock).toHaveBeenCalledTimes(1);
    expect(fetchIncidentStateTimelineMock).toHaveBeenCalledWith(
      "project-1",
      "incident-1",
    );
  });

  test("hands the timeline to the caller unchanged", async () => {
    const timeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-2" }),
      makeStateTimelineItem({ _id: "timeline-1" }),
    ];
    fetchIncidentStateTimelineMock.mockResolvedValue(timeline);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentStateTimeline("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(timeline);
  });

  test("caches the timeline under a key carrying both the project and the incident", async () => {
    fetchIncidentStateTimelineMock.mockResolvedValue([makeStateTimelineItem()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentStateTimeline("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(cachedKeys(client)).toEqual([
      ["incident-state-timeline", "project-1", "incident-1"],
    ]);
  });

  test("two incidents in the same project do not share a cache entry", async () => {
    const firstTimeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-for-incident-1" }),
    ];
    const secondTimeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-for-incident-2" }),
    ];
    fetchIncidentStateTimelineMock.mockImplementation(
      (projectId: string, incidentId: string) => {
        return Promise.resolve(
          incidentId === "incident-1" ? firstTimeline : secondTimeline,
        );
      },
    );
    const client: QueryClient = createTestQueryClient();

    const first: QueryHandle<Array<StateTimelineItem>> = await renderQuery(
      client,
      () => {
        return useIncidentStateTimeline("project-1", "incident-1");
      },
    );
    await waitFor(() => {
      return expect(first.result.current.isSuccess).toBe(true);
    });

    const second: QueryHandle<Array<StateTimelineItem>> = await renderQuery(
      client,
      () => {
        return useIncidentStateTimeline("project-1", "incident-2");
      },
    );
    await waitFor(() => {
      return expect(second.result.current.isSuccess).toBe(true);
    });

    expect(fetchIncidentStateTimelineMock).toHaveBeenCalledTimes(2);
    expect(first.result.current.data).toEqual(firstTimeline);
    expect(second.result.current.data).toEqual(secondTimeline);
  });

  test("the same incident id under two projects does not share a cache entry", async () => {
    const productionTimeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-production" }),
    ];
    const stagingTimeline: Array<StateTimelineItem> = [
      makeStateTimelineItem({ _id: "timeline-staging" }),
    ];
    fetchIncidentStateTimelineMock.mockImplementation((projectId: string) => {
      return Promise.resolve(
        projectId === "project-1" ? productionTimeline : stagingTimeline,
      );
    });
    const client: QueryClient = createTestQueryClient();

    const production: QueryHandle<Array<StateTimelineItem>> = await renderQuery(
      client,
      () => {
        return useIncidentStateTimeline("project-1", "incident-1");
      },
    );
    await waitFor(() => {
      return expect(production.result.current.isSuccess).toBe(true);
    });

    const staging: QueryHandle<Array<StateTimelineItem>> = await renderQuery(
      client,
      () => {
        return useIncidentStateTimeline("project-2", "incident-1");
      },
    );
    await waitFor(() => {
      return expect(staging.result.current.isSuccess).toBe(true);
    });

    expect(fetchIncidentStateTimelineMock).toHaveBeenCalledTimes(2);
    expect(production.result.current.data).toEqual(productionTimeline);
    expect(staging.result.current.data).toEqual(stagingTimeline);
  });

  test("asks for nothing while the project is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useIncidentStateTimeline("", "incident-1");
    });

    expect(fetchIncidentStateTimelineMock).not.toHaveBeenCalled();
  });

  test("asks for nothing while the incident is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useIncidentStateTimeline("project-1", "");
    });

    expect(fetchIncidentStateTimelineMock).not.toHaveBeenCalled();
  });

  test("surfaces an api rejection as an error rather than as an empty timeline", async () => {
    const failure: Error = new Error("Request failed with status code 503");
    fetchIncidentStateTimelineMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentStateTimeline("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useIncidentFeed", () => {
  test("asks the api for that incident's feed under its project", async () => {
    fetchIncidentFeedMock.mockResolvedValue([makeFeedItem()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentFeed("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchIncidentFeedMock).toHaveBeenCalledTimes(1);
    expect(fetchIncidentFeedMock).toHaveBeenCalledWith(
      "project-1",
      "incident-1",
    );
  });

  test("hands the feed to the caller unchanged", async () => {
    const feed: Array<FeedItem> = [
      makeFeedItem({
        _id: "feed-2",
        feedInfoInMarkdown: "**Acknowledged** by Ada Lovelace",
      }),
      makeFeedItem({ _id: "feed-1", feedInfoInMarkdown: "Incident declared" }),
    ];
    fetchIncidentFeedMock.mockResolvedValue(feed);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentFeed("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(feed);
  });

  test("caches the feed under a key carrying both the project and the incident", async () => {
    fetchIncidentFeedMock.mockResolvedValue([makeFeedItem()]);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentFeed("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(cachedKeys(client)).toEqual([
      ["incident-feed", "project-1", "incident-1"],
    ]);
  });

  test("two incidents in the same project do not share a cache entry", async () => {
    /*
     * The feed is the narrative of one incident - who was paged, who
     * acknowledged, what the escalation policy did next. Cross-wiring two of
     * them would attribute one incident's history to another, on the screen a
     * responder uses to work out what has already been tried.
     */
    const firstFeed: Array<FeedItem> = [
      makeFeedItem({ _id: "feed-for-incident-1" }),
    ];
    const secondFeed: Array<FeedItem> = [
      makeFeedItem({ _id: "feed-for-incident-2" }),
    ];
    fetchIncidentFeedMock.mockImplementation(
      (projectId: string, incidentId: string) => {
        return Promise.resolve(
          incidentId === "incident-1" ? firstFeed : secondFeed,
        );
      },
    );
    const client: QueryClient = createTestQueryClient();

    const first: QueryHandle<Array<FeedItem>> = await renderQuery(
      client,
      () => {
        return useIncidentFeed("project-1", "incident-1");
      },
    );
    await waitFor(() => {
      return expect(first.result.current.isSuccess).toBe(true);
    });

    const second: QueryHandle<Array<FeedItem>> = await renderQuery(
      client,
      () => {
        return useIncidentFeed("project-1", "incident-2");
      },
    );
    await waitFor(() => {
      return expect(second.result.current.isSuccess).toBe(true);
    });

    expect(fetchIncidentFeedMock).toHaveBeenCalledTimes(2);
    expect(first.result.current.data).toEqual(firstFeed);
    expect(second.result.current.data).toEqual(secondFeed);
  });

  test("the same incident id under two projects does not share a cache entry", async () => {
    const productionFeed: Array<FeedItem> = [
      makeFeedItem({ _id: "feed-production" }),
    ];
    const stagingFeed: Array<FeedItem> = [
      makeFeedItem({ _id: "feed-staging" }),
    ];
    fetchIncidentFeedMock.mockImplementation((projectId: string) => {
      return Promise.resolve(
        projectId === "project-1" ? productionFeed : stagingFeed,
      );
    });
    const client: QueryClient = createTestQueryClient();

    const production: QueryHandle<Array<FeedItem>> = await renderQuery(
      client,
      () => {
        return useIncidentFeed("project-1", "incident-1");
      },
    );
    await waitFor(() => {
      return expect(production.result.current.isSuccess).toBe(true);
    });

    const staging: QueryHandle<Array<FeedItem>> = await renderQuery(
      client,
      () => {
        return useIncidentFeed("project-2", "incident-1");
      },
    );
    await waitFor(() => {
      return expect(staging.result.current.isSuccess).toBe(true);
    });

    expect(fetchIncidentFeedMock).toHaveBeenCalledTimes(2);
    expect(production.result.current.data).toEqual(productionFeed);
    expect(staging.result.current.data).toEqual(stagingFeed);
  });

  test("asks for nothing while the project is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useIncidentFeed("", "incident-1");
    });

    expect(fetchIncidentFeedMock).not.toHaveBeenCalled();
  });

  test("asks for nothing while the incident is still unknown", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderQuery(client, () => {
      return useIncidentFeed("project-1", "");
    });

    expect(fetchIncidentFeedMock).not.toHaveBeenCalled();
  });

  test("surfaces an api rejection as an error rather than as an empty feed", async () => {
    const failure: Error = new Error("Request failed with status code 401");
    fetchIncidentFeedMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderQuery(client, () => {
      return useIncidentFeed("project-1", "incident-1");
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

import { renderHook, waitFor } from "@testing-library/react-native";
import type { Query, QueryClient, UseQueryResult } from "@tanstack/react-query";
import {
  useMonitorDetail,
  useMonitorFeed,
  useMonitorProbes,
  useMonitorStatusTimeline,
} from "./useMonitorDetail";
import {
  fetchMonitorById,
  fetchMonitorFeed,
  fetchMonitorProbes,
  fetchMonitorStatusTimeline,
  type MonitorProbeItem,
  type MonitorStatusTimelineItem,
} from "../api/monitors";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeFeedItem,
  makeMonitor,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import type { FeedItem, MonitorItem } from "../api/types";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * src/hooks/useMonitorDetail.ts is four near-identical react-query wrappers,
 * one per panel of the monitor detail screen: the monitor itself, its status
 * timeline, its probes and its feed. MonitorDetailScreen calls all four with
 * the SAME (projectId, monitorId) pair, which is precisely the arrangement in
 * which a wrong query key does its damage.
 *
 * Nothing except these tests checks those keys. The compiler does cover which
 * fetch each hook calls - every hook declares its own return type, so a
 * copy-pasted fetchMonitorFeed inside useMonitorProbes would not compile - but
 * a query key is a bare array of strings. A copy-paste that left
 * "monitor-feed" at the head of the probes key, or that dropped projectId out
 * of it, typechecks perfectly and ships. What it produces is not a crash: it
 * is the previous monitor's probes drawn under this monitor's name, or one
 * project's rows on another project's screen. That reads as real, and it is
 * what a responder makes a decision from at 3am.
 *
 * So for each of the four hooks the same four things are pinned: the api it
 * fetches through, the key it caches under (asserted literally, and asserted
 * to stay independent across both monitors and projects), the enabled guard
 * that stops it asking the server for monitor "" while the screen's route
 * params are still empty, and that the api's answer - or its failure - reaches
 * the caller intact.
 */

jest.mock("../api/monitors", () => {
  return {
    fetchMonitorById: jest.fn(),
    fetchMonitorStatusTimeline: jest.fn(),
    fetchMonitorProbes: jest.fn(),
    fetchMonitorFeed: jest.fn(),
  };
});

const PROJECT_ID: string = "project-1";
const OTHER_PROJECT_ID: string = "project-2";
const MONITOR_ID: string = "monitor-1";
const OTHER_MONITOR_ID: string = "monitor-2";

const fetchMonitorByIdMock: jest.Mock =
  fetchMonitorById as unknown as jest.Mock;
const fetchMonitorStatusTimelineMock: jest.Mock =
  fetchMonitorStatusTimeline as unknown as jest.Mock;
const fetchMonitorProbesMock: jest.Mock =
  fetchMonitorProbes as unknown as jest.Mock;
const fetchMonitorFeedMock: jest.Mock =
  fetchMonitorFeed as unknown as jest.Mock;

const allFetchMocks: Array<jest.Mock> = [
  fetchMonitorByIdMock,
  fetchMonitorStatusTimelineMock,
  fetchMonitorProbesMock,
  fetchMonitorFeedMock,
];

/*
 * Every payload below is stamped with the project and monitor it was asked
 * for. That is what makes a cache collision visible: if two of these queries
 * shared a key, one of them would show data carrying the OTHER one's ids, and
 * a test that only checked "some rows arrived" would pass right through it.
 */

function monitorFor(projectId: string, monitorId: string): MonitorItem {
  return makeMonitor({
    _id: monitorId,
    name: `${monitorId} in ${projectId}`,
    projectId: projectId,
  });
}

function statusTimelineFor(
  projectId: string,
  monitorId: string,
): MonitorStatusTimelineItem[] {
  return [
    {
      _id: `timeline-${projectId}-${monitorId}`,
      createdAt: "2026-08-30T10:00:00.000Z",
      startsAt: "2026-08-30T10:00:00.000Z",
      endsAt: "2026-08-30T10:30:00.000Z",
      monitorStatus: makeNamedEntityWithColor({
        _id: "monitor-status-2",
        name: "Offline",
      }) as MonitorStatusTimelineItem["monitorStatus"],
      rootCause: "Probe reported a connection timeout.",
    },
  ];
}

function probesFor(projectId: string, monitorId: string): MonitorProbeItem[] {
  return [
    {
      _id: `monitor-probe-${projectId}-${monitorId}`,
      probeId: "probe-1",
      probe: { _id: "probe-1", name: "Frankfurt" },
      lastMonitoringLog: {
        "monitor-step-1": {
          isOnline: false,
          responseCode: 503,
          responseTimeInMs: 1200,
          failureCause: "Service Unavailable",
        },
      },
    },
  ];
}

function feedFor(projectId: string, monitorId: string): FeedItem[] {
  return [
    makeFeedItem({
      _id: `feed-${projectId}-${monitorId}`,
      feedInfoInMarkdown: `**${monitorId} in ${projectId} went offline**`,
    }),
  ];
}

/*
 * All four hooks have the same signature, so they fit one table. The data type
 * is widened to `unknown` here on purpose: what this suite is about is the
 * plumbing around the fetch, and each hook's own data type is already checked
 * by the compiler at its declaration.
 */
type MonitorQueryHook = (
  projectId: string,
  monitorId: string,
) => UseQueryResult<unknown, Error>;

interface MonitorQueryCase {
  hookName: string;
  apiName: string;
  keyPrefix: string;
  useHook: MonitorQueryHook;
  fetchMock: jest.Mock;
  payloadFor: (projectId: string, monitorId: string) => unknown;
}

const monitorQueryCases: Array<MonitorQueryCase> = [
  {
    hookName: "useMonitorDetail",
    apiName: "fetchMonitorById",
    keyPrefix: "monitor",
    useHook: (projectId: string, monitorId: string) => {
      return useMonitorDetail(projectId, monitorId);
    },
    fetchMock: fetchMonitorByIdMock,
    payloadFor: monitorFor,
  },
  {
    hookName: "useMonitorStatusTimeline",
    apiName: "fetchMonitorStatusTimeline",
    keyPrefix: "monitor-status-timeline",
    useHook: (projectId: string, monitorId: string) => {
      return useMonitorStatusTimeline(projectId, monitorId);
    },
    fetchMock: fetchMonitorStatusTimelineMock,
    payloadFor: statusTimelineFor,
  },
  {
    hookName: "useMonitorProbes",
    apiName: "fetchMonitorProbes",
    keyPrefix: "monitor-probes",
    useHook: (projectId: string, monitorId: string) => {
      return useMonitorProbes(projectId, monitorId);
    },
    fetchMock: fetchMonitorProbesMock,
    payloadFor: probesFor,
  },
  {
    hookName: "useMonitorFeed",
    apiName: "fetchMonitorFeed",
    keyPrefix: "monitor-feed",
    useHook: (projectId: string, monitorId: string) => {
      return useMonitorFeed(projectId, monitorId);
    },
    fetchMock: fetchMonitorFeedMock,
    payloadFor: feedFor,
  },
];

interface QueryHookResult {
  current: UseQueryResult<unknown, Error>;
}

/*
 * renderHook returns a PROMISE in @testing-library/react-native v14 - it wraps
 * the mount in act - so every render here is awaited. Without the await the
 * query's first fetch would still be in flight when the assertions ran.
 */
async function renderMonitorQuery(
  queryCase: MonitorQueryCase,
  client: QueryClient,
  projectId: string,
  monitorId: string,
): Promise<QueryHookResult> {
  const { result } = await renderHook(
    () => {
      return queryCase.useHook(projectId, monitorId);
    },
    { wrapper: createQueryWrapper(client) },
  );

  return result;
}

async function waitForSuccess(result: QueryHookResult): Promise<void> {
  await waitFor(() => {
    return expect(result.current.isSuccess).toBe(true);
  });
}

function cachedKeys(client: QueryClient): Array<readonly unknown[]> {
  return client
    .getQueryCache()
    .getAll()
    .map((query: Query): readonly unknown[] => {
      return query.queryKey;
    });
}

monitorQueryCases.forEach((queryCase: MonitorQueryCase): void => {
  describe(queryCase.hookName, () => {
    let client: QueryClient;

    beforeEach(() => {
      client = createTestQueryClient();

      queryCase.fetchMock.mockImplementation(
        async (projectId: string, monitorId: string) => {
          return queryCase.payloadFor(projectId, monitorId);
        },
      );
    });

    test(`fetches through ${queryCase.apiName}, passing on the project and the monitor it was handed`, async () => {
      const result: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        PROJECT_ID,
        MONITOR_ID,
      );

      await waitForSuccess(result);

      expect(queryCase.fetchMock).toHaveBeenCalledTimes(1);
      expect(queryCase.fetchMock).toHaveBeenCalledWith(PROJECT_ID, MONITOR_ID);
    });

    test("asks none of the other three monitor endpoints", async () => {
      /*
       * These four hooks are copies of one another, and the detail screen
       * mounts all four at once - so a hook that fetched a sibling's endpoint
       * would still fill its panel with plausible-looking rows. The compiler
       * catches most of that through the declared return types; this catches
       * the rest, including a hook that fetches twice.
       */
      const result: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        PROJECT_ID,
        MONITOR_ID,
      );

      await waitForSuccess(result);

      const otherFetchMocks: Array<jest.Mock> = allFetchMocks.filter(
        (fetchMock: jest.Mock): boolean => {
          return fetchMock !== queryCase.fetchMock;
        },
      );

      otherFetchMocks.forEach((fetchMock: jest.Mock): void => {
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    test("hands the api's answer to the caller unchanged", async () => {
      const result: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        PROJECT_ID,
        MONITOR_ID,
      );

      await waitForSuccess(result);

      expect(result.current.data).toEqual(
        queryCase.payloadFor(PROJECT_ID, MONITOR_ID),
      );
      expect(result.current.error).toBeNull();
    });

    test("caches under a key naming the query, the project and the monitor", async () => {
      /*
       * The key is pinned literally, and as the ONLY entry in the cache. Both
       * halves matter: the order of the two ids is what keeps a monitor from
       * being looked up under a project id, and a second entry would mean the
       * hook had rendered a key that changes between renders, which is a
       * refetch loop rather than a cache.
       */
      const result: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        PROJECT_ID,
        MONITOR_ID,
      );

      await waitForSuccess(result);

      expect(cachedKeys(client)).toEqual([
        [queryCase.keyPrefix, PROJECT_ID, MONITOR_ID],
      ]);
    });

    test("does not fetch at all while the project id is still empty", async () => {
      /*
       * Both ids arrive as route params. Fetching before they are there asks
       * the server for monitor "" under an empty tenantid header - a request
       * that can only fail, whose failure would then be cached against a key
       * the real ids will never read again.
       */
      const result: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        "",
        MONITOR_ID,
      );

      expect(queryCase.fetchMock).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    test("does not fetch at all while the monitor id is still empty", async () => {
      const result: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        PROJECT_ID,
        "",
      );

      expect(queryCase.fetchMock).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    test("reports a disabled query as pending with nothing in flight", async () => {
      /*
       * A trap worth pinning for whoever writes the next caller. In
       * react-query v5 `isPending` means "there is no data yet", NOT
       * "something is in flight" - so a query held back by its enabled guard
       * reports isPending true for ever, and a screen that renders its spinner
       * on isPending would spin for ever on an empty id. `fetchStatus` is what
       * says whether a request is running, and `isLoading` (isPending &&
       * isFetching) is the flag that behaves the way callers expect;
       * MonitorDetailScreen uses isLoading, which is why its skeleton
       * disappears rather than sticking.
       */
      const result: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        "",
        "",
      );

      expect(result.current.isPending).toBe(true);
      expect(result.current.fetchStatus).toBe("idle");
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.data).toBeUndefined();
    });

    test("a second monitor does not take over the first monitor's cache entry", async () => {
      /*
       * Two monitors open against one cache. If monitorId were missing from
       * the key, both observers would sit on a single entry and the first
       * monitor's panel would silently repaint with the second monitor's rows
       * - under the first monitor's name, with nothing on screen to say so.
       */
      const first: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        PROJECT_ID,
        MONITOR_ID,
      );

      await waitForSuccess(first);

      const second: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        PROJECT_ID,
        OTHER_MONITOR_ID,
      );

      await waitForSuccess(second);

      expect(queryCase.fetchMock).toHaveBeenCalledWith(
        PROJECT_ID,
        OTHER_MONITOR_ID,
      );
      expect(second.current.data).toEqual(
        queryCase.payloadFor(PROJECT_ID, OTHER_MONITOR_ID),
      );
      expect(first.current.data).toEqual(
        queryCase.payloadFor(PROJECT_ID, MONITOR_ID),
      );
      expect(client.getQueryCache().getAll()).toHaveLength(2);
    });

    test("the same monitor id under another project is a separate cache entry", async () => {
      /*
       * A responder belongs to several projects at once, and every one of
       * these requests is scoped server-side by a tenantid header carrying the
       * projectId - so the same monitor id under a different project is a
       * genuinely different question, and one the server may well answer with
       * nothing at all. Were projectId missing from the key, the second
       * project's screen would be served the first project's cached rows
       * without ever making the request that would have been refused.
       */
      const first: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        PROJECT_ID,
        MONITOR_ID,
      );

      await waitForSuccess(first);

      const second: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        OTHER_PROJECT_ID,
        MONITOR_ID,
      );

      await waitForSuccess(second);

      expect(queryCase.fetchMock).toHaveBeenCalledWith(
        OTHER_PROJECT_ID,
        MONITOR_ID,
      );
      expect(second.current.data).toEqual(
        queryCase.payloadFor(OTHER_PROJECT_ID, MONITOR_ID),
      );
      expect(first.current.data).toEqual(
        queryCase.payloadFor(PROJECT_ID, MONITOR_ID),
      );
      expect(client.getQueryCache().getAll()).toHaveLength(2);
    });

    test("surfaces a failed request as an error rather than as no rows", async () => {
      /*
       * The difference matters on screen. The detail screen renders a missing
       * monitor as "Monitor not found."; if a request that failed arrived as
       * empty data it would be indistinguishable from a monitor that was
       * really deleted, and the responder would go and look for the wrong
       * problem. The error object itself is passed through, not a rewritten
       * one, so the caller can still tell an offline handset from a 500.
       */
      const failure: Error = new Error("Request failed with status code 500");
      queryCase.fetchMock.mockRejectedValue(failure);

      const result: QueryHookResult = await renderMonitorQuery(
        queryCase,
        client,
        PROJECT_ID,
        MONITOR_ID,
      );

      await waitFor(() => {
        return expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(failure);
      expect(result.current.data).toBeUndefined();
    });
  });
});

describe("the four monitor queries mounted together", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = createTestQueryClient();

    monitorQueryCases.forEach((queryCase: MonitorQueryCase): void => {
      queryCase.fetchMock.mockImplementation(
        async (projectId: string, monitorId: string) => {
          return queryCase.payloadFor(projectId, monitorId);
        },
      );
    });
  });

  /*
   * This is how MonitorDetailScreen actually uses these hooks: all four at
   * once, with identical arguments. Four keys that differ only in their first
   * element is a shape that survives review very easily with two of them the
   * same, and the tests above - each of which mounts one hook against its own
   * client - cannot see that. Here they share a client, so a duplicated prefix
   * shows up as one panel wearing another panel's data.
   */
  test("each hook keeps its own answer for one and the same monitor", async () => {
    const { result } = await renderHook(
      () => {
        return {
          detail: useMonitorDetail(PROJECT_ID, MONITOR_ID),
          timeline: useMonitorStatusTimeline(PROJECT_ID, MONITOR_ID),
          probes: useMonitorProbes(PROJECT_ID, MONITOR_ID),
          feed: useMonitorFeed(PROJECT_ID, MONITOR_ID),
        };
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.timeline.isSuccess).toBe(true);
      expect(result.current.probes.isSuccess).toBe(true);
      expect(result.current.feed.isSuccess).toBe(true);
    });

    expect(result.current.detail.data).toEqual(
      monitorFor(PROJECT_ID, MONITOR_ID),
    );
    expect(result.current.timeline.data).toEqual(
      statusTimelineFor(PROJECT_ID, MONITOR_ID),
    );
    expect(result.current.probes.data).toEqual(
      probesFor(PROJECT_ID, MONITOR_ID),
    );
    expect(result.current.feed.data).toEqual(feedFor(PROJECT_ID, MONITOR_ID));
  });

  test("the four of them occupy four separate cache entries", async () => {
    const { result } = await renderHook(
      () => {
        return {
          detail: useMonitorDetail(PROJECT_ID, MONITOR_ID),
          timeline: useMonitorStatusTimeline(PROJECT_ID, MONITOR_ID),
          probes: useMonitorProbes(PROJECT_ID, MONITOR_ID),
          feed: useMonitorFeed(PROJECT_ID, MONITOR_ID),
        };
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.feed.isSuccess).toBe(true);
    });

    expect(cachedKeys(client)).toHaveLength(4);
    expect(cachedKeys(client)).toContainEqual([
      "monitor",
      PROJECT_ID,
      MONITOR_ID,
    ]);
    expect(cachedKeys(client)).toContainEqual([
      "monitor-status-timeline",
      PROJECT_ID,
      MONITOR_ID,
    ]);
    expect(cachedKeys(client)).toContainEqual([
      "monitor-probes",
      PROJECT_ID,
      MONITOR_ID,
    ]);
    expect(cachedKeys(client)).toContainEqual([
      "monitor-feed",
      PROJECT_ID,
      MONITOR_ID,
    ]);
  });
});

describe("useMonitorDetail on a monitor that is no longer there", () => {
  test("a null from the api settles as data rather than as a failed request", async () => {
    /*
     * `fetchMonitorById` resolves `null` - not `undefined` - for a monitor that
     * has been deleted, and this is the test that says why it has to.
     * react-query v5 caches `null` like any other value but REFUSES
     * `undefined`, rejecting the query with a synthetic "data is undefined"
     * error; that would put this hook in the error state for a monitor that is
     * merely gone, and MonitorDetailScreen would have no way to tell it from a
     * request that failed. isSuccess with null data is the contract.
     */
    fetchMonitorByIdMock.mockResolvedValue(null);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useMonitorDetail(PROJECT_ID, MONITOR_ID);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});

import { renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import {
  useAlertEpisodeDetail,
  useAlertEpisodeFeed,
  useAlertEpisodeNotes,
  useAlertEpisodeStateTimeline,
  useAlertEpisodeStates,
} from "./useAlertEpisodeDetail";
import {
  fetchAlertEpisodeById,
  fetchAlertEpisodeFeed,
  fetchAlertEpisodeNotes,
  fetchAlertEpisodeStateTimeline,
  fetchAlertEpisodeStates,
} from "../api/alertEpisodes";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeAlertEpisode,
  makeAlertState,
  makeFeedItem,
  makeNamedEntityWithColor,
  makeNote,
  makeStateTimelineItem,
} from "../__tests__/testSupport";
import type {
  AlertEpisodeItem,
  AlertState,
  FeedItem,
  NoteItem,
  StateTimelineItem,
} from "../api/types";

/*
 * These five hooks are the whole data layer behind the alert episode detail
 * screen. Each one is a thin react-query wrapper, which means almost nothing
 * in them can break loudly - the failure mode is quiet and it is always the
 * same failure: a query key that does not name everything the fetch depends
 * on. A key that forgets the episode id shows one episode's notes under
 * another episode's title; a key that forgets the project id shows one
 * customer's rows to another. Neither throws, neither logs, and both look
 * completely plausible on screen, so the key is what these tests spend most of
 * their assertions on.
 *
 * The api module is mocked wholesale. What is under test is the caching and
 * gating around the fetch, not the request bodies - those belong to the
 * alertEpisodes api suite.
 */

jest.mock("../api/alertEpisodes", () => {
  return {
    fetchAlertEpisodeById: jest.fn(),
    fetchAlertEpisodeStates: jest.fn(),
    fetchAlertEpisodeStateTimeline: jest.fn(),
    fetchAlertEpisodeNotes: jest.fn(),
    fetchAlertEpisodeFeed: jest.fn(),
  };
});

const PROJECT_A: string = "project-a";
const PROJECT_B: string = "project-b";
const EPISODE_1: string = "alert-episode-1";
const EPISODE_2: string = "alert-episode-2";

const byIdMock: jest.Mock = fetchAlertEpisodeById as unknown as jest.Mock;
const statesMock: jest.Mock = fetchAlertEpisodeStates as unknown as jest.Mock;
const timelineMock: jest.Mock =
  fetchAlertEpisodeStateTimeline as unknown as jest.Mock;
const notesMock: jest.Mock = fetchAlertEpisodeNotes as unknown as jest.Mock;
const feedMock: jest.Mock = fetchAlertEpisodeFeed as unknown as jest.Mock;

/**
 * Every fetch answers something derived from the arguments it was handed, so a
 * test can tell "the hook fetched for episode 2" apart from "the hook handed
 * back episode 1's cached rows" - which is exactly the confusion a missing key
 * segment creates.
 */
beforeEach(() => {
  byIdMock.mockImplementation((projectId: string, episodeId: string) => {
    return Promise.resolve(
      makeAlertEpisode({
        _id: episodeId,
        projectId,
        title: `Title ${episodeId}`,
      }),
    );
  });
  statesMock.mockImplementation((projectId: string) => {
    return Promise.resolve([
      makeAlertState({ _id: `${projectId}-alert-state` }),
    ]);
  });
  timelineMock.mockImplementation((projectId: string, episodeId: string) => {
    return Promise.resolve([
      makeStateTimelineItem({
        _id: `${projectId}-${episodeId}-timeline`,
        /*
         * An alert episode timeline row carries alertState, never
         * incidentState - the shared fixture defaults to the incident shape
         * because the two share one TypeScript interface.
         */
        incidentState: undefined,
        alertState: makeNamedEntityWithColor({
          _id: "alert-state-1",
          name: "Acknowledged",
        }),
      }),
    ]);
  });
  notesMock.mockImplementation((projectId: string, episodeId: string) => {
    return Promise.resolve([
      makeNote({ _id: `${projectId}-${episodeId}-note` }),
    ]);
  });
  feedMock.mockImplementation((projectId: string, episodeId: string) => {
    return Promise.resolve([
      makeFeedItem({ _id: `${projectId}-${episodeId}-feed` }),
    ]);
  });
});

/**
 * The observable state of a query that its `enabled` guard is holding back.
 *
 * react-query v5 reports a disabled query as isPending forever, because
 * "pending" only means "there is no data yet" - it says nothing about whether
 * a request is in flight. fetchStatus is the half that does, and for a
 * disabled query it stays "idle". A screen that renders a spinner on isPending
 * alone therefore spins forever on a detail screen opened before the project
 * id is known, which is why this is pinned rather than left implied: anyone
 * changing these hooks should see that isPending true is the documented
 * resting state here, not a sign that something is loading.
 */
function expectHeldBackByEnabledGuard<T>(
  query: UseQueryResult<T, Error>,
): void {
  expect(query.fetchStatus).toBe("idle");
  expect(query.isPending).toBe(true);
  expect(query.isLoading).toBe(false);
  expect(query.data).toBeUndefined();
}

describe("useAlertEpisodeDetail", () => {
  test("hands the caller the episode the api resolved, unchanged", async () => {
    /*
     * Identity rather than deep equality, because the point of the assertion
     * is that the hook is a pass-through: nothing is reshaped, defaulted or
     * merged on the way out.
     */
    const episode: AlertEpisodeItem = makeAlertEpisode({
      _id: EPISODE_1,
      projectId: PROJECT_A,
    });
    byIdMock.mockResolvedValue(episode);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeDetail(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });

    expect(byIdMock).toHaveBeenCalledWith(PROJECT_A, EPISODE_1);
    expect(result.current.data).toBe(episode);
  });

  test("caches the episode under a key naming both the project and the episode", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeDetail(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });

    /*
     * AlertEpisodeDetailScreen writes an optimistic state change straight into
     * this exact key by hand, so the literal matters beyond cache identity: if
     * the hook's key moved, the screen's optimistic update would land on a
     * cache entry nothing is reading.
     */
    const cached: AlertEpisodeItem | undefined = client.getQueryData([
      "alert-episode",
      PROJECT_A,
      EPISODE_1,
    ]);
    expect(cached?._id).toBe(EPISODE_1);
  });

  test("a second episode in the same project does not inherit the first one's cache", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result: first } = await renderHook(
      () => {
        return useAlertEpisodeDetail(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(first.current.isSuccess).toBe(true);
    });

    const { result: second } = await renderHook(
      () => {
        return useAlertEpisodeDetail(PROJECT_A, EPISODE_2);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(second.current.isSuccess).toBe(true);
    });

    expect(second.current.data?._id).toBe(EPISODE_2);
    /*
     * The assertion that actually catches a key missing its episode id is this
     * one, not the call count: two observers on one shared key read one shared
     * cache entry, so the first screen's data would have been overwritten by
     * the second episode's rows. The separate cache entries say the same thing
     * from the other side.
     */
    expect(first.current.data?._id).toBe(EPISODE_1);
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });

  test("the same episode id under a different project is fetched separately", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result: inProjectA } = await renderHook(
      () => {
        return useAlertEpisodeDetail(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(inProjectA.current.isSuccess).toBe(true);
    });

    const { result: inProjectB } = await renderHook(
      () => {
        return useAlertEpisodeDetail(PROJECT_B, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(inProjectB.current.isSuccess).toBe(true);
    });

    /*
     * Episode ids are unique in practice, so this looks redundant - it is not.
     * The project is the tenant boundary, and a key that leans on ids being
     * globally unique is one schema change away from serving one customer's
     * episode to another.
     */
    expect(inProjectB.current.data?.projectId).toBe(PROJECT_B);
    expect(inProjectA.current.data?.projectId).toBe(PROJECT_A);
    expect(byIdMock).toHaveBeenCalledTimes(2);
  });

  test("does not fetch anything before a project is known", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeDetail("", EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(byIdMock).not.toHaveBeenCalled();
    expectHeldBackByEnabledGuard(result.current);
  });

  test("does not fetch anything before an episode is known", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeDetail(PROJECT_A, "");
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(byIdMock).not.toHaveBeenCalled();
    expectHeldBackByEnabledGuard(result.current);
  });

  test("surfaces an api rejection as an error rather than as a missing episode", async () => {
    /*
     * A detail screen that reads a failed fetch as "no data" renders an empty
     * episode - the responder sees a page that looks like the episode was
     * deleted instead of a page that failed to load and can be retried.
     */
    const failure: Error = new Error("alert episode fetch failed");
    byIdMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeDetail(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  test("an episode that no longer exists settles as null data, not as a failure", async () => {
    /*
     * The other half of the pair above, and the reason `fetchAlertEpisodeById`
     * ends in `?? null`. react-query v5 caches `null` like any other value but
     * REFUSES `undefined`, rejecting the query with a synthetic "data is
     * undefined" error - so a deleted episode used to arrive at
     * AlertEpisodeDetailScreen through isError, wearing the same clothes as the
     * failure above and told apart only by the wording of a library's message.
     * Pinning isSuccess here is what keeps that from coming back.
     */
    byIdMock.mockResolvedValue(null);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeDetail(PROJECT_A, "deleted-episode");
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

describe("useAlertEpisodeStates", () => {
  /*
   * The literal key of this hook is deliberately not pinned here. It is
   * ["alert-states", projectId] today, which is byte for byte the key
   * useAlertStates in useAlertDetail.ts uses for a different api function -
   * see the concern raised alongside this suite. Freezing that literal into a
   * test would make the collision harder to fix, so what follows asserts only
   * what has to hold whichever name the key ends up with: the project is part
   * of it, the guard works, and the rows reach the caller.
   */
  test("hands the caller the states the api resolved, unchanged", async () => {
    const states: AlertState[] = [
      makeAlertState({ _id: "created", name: "Created", order: 1 }),
      makeAlertState({
        _id: "acknowledged",
        name: "Acknowledged",
        isCreatedState: false,
        isAcknowledgedState: true,
        order: 2,
      }),
    ];
    statesMock.mockResolvedValue(states);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeStates(PROJECT_A);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });

    expect(statesMock).toHaveBeenCalledWith(PROJECT_A);
    /*
     * The api already sorts by `order`, and the hook must not re-sort or
     * filter: the state picker's row order is this array's order.
     */
    expect(result.current.data).toBe(states);
  });

  test("keeps each project's states apart", async () => {
    /*
     * Alert states are per project rows, and this list is what the detail
     * screen offers as the "change state" choices. Serving project A's state
     * ids to a responder looking at project B would post a state change
     * referencing a row that project cannot see.
     */
    const client: QueryClient = createTestQueryClient();

    const { result: inProjectA } = await renderHook(
      () => {
        return useAlertEpisodeStates(PROJECT_A);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(inProjectA.current.isSuccess).toBe(true);
    });

    const { result: inProjectB } = await renderHook(
      () => {
        return useAlertEpisodeStates(PROJECT_B);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(inProjectB.current.isSuccess).toBe(true);
    });

    const statesForB: AlertState[] | undefined = inProjectB.current.data;
    const statesForA: AlertState[] | undefined = inProjectA.current.data;
    expect(statesForB?.[0]?._id).toBe(`${PROJECT_B}-alert-state`);
    expect(statesForA?.[0]?._id).toBe(`${PROJECT_A}-alert-state`);
  });

  test("does not fetch anything before a project is known", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeStates("");
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(statesMock).not.toHaveBeenCalled();
    expectHeldBackByEnabledGuard(result.current);
  });

  test("surfaces an api rejection as an error rather than as an empty list", async () => {
    /*
     * An empty array here reads as "this project has no states", which hides
     * the state picker entirely. The responder is then looking at an episode
     * they cannot acknowledge, with nothing on screen explaining why.
     */
    const failure: Error = new Error("alert states fetch failed");
    statesMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeStates(PROJECT_A);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useAlertEpisodeStateTimeline", () => {
  test("hands the caller the timeline rows under the episode's own key", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeStateTimeline(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });

    expect(timelineMock).toHaveBeenCalledWith(PROJECT_A, EPISODE_1);
    const cached: StateTimelineItem[] | undefined = client.getQueryData([
      "alert-episode-state-timeline",
      PROJECT_A,
      EPISODE_1,
    ]);
    expect(cached).toBe(result.current.data);
    expect(result.current.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_1}-timeline`,
    );
  });

  test("a second episode does not inherit the first one's timeline", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result: first } = await renderHook(
      () => {
        return useAlertEpisodeStateTimeline(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(first.current.isSuccess).toBe(true);
    });

    const { result: second } = await renderHook(
      () => {
        return useAlertEpisodeStateTimeline(PROJECT_A, EPISODE_2);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(second.current.isSuccess).toBe(true);
    });

    expect(second.current.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_2}-timeline`,
    );
    expect(first.current.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_1}-timeline`,
    );
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });

  test("does not fetch anything before a project is known", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeStateTimeline("", EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(timelineMock).not.toHaveBeenCalled();
    expectHeldBackByEnabledGuard(result.current);
  });

  test("does not fetch anything before an episode is known", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeStateTimeline(PROJECT_A, "");
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(timelineMock).not.toHaveBeenCalled();
    expectHeldBackByEnabledGuard(result.current);
  });

  test("surfaces an api rejection as an error rather than as an empty timeline", async () => {
    const failure: Error = new Error("alert episode timeline fetch failed");
    timelineMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeStateTimeline(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useAlertEpisodeNotes", () => {
  test("hands the caller the notes under the episode's own key", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeNotes(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });

    expect(notesMock).toHaveBeenCalledWith(PROJECT_A, EPISODE_1);
    const cached: NoteItem[] | undefined = client.getQueryData([
      "alert-episode-notes",
      PROJECT_A,
      EPISODE_1,
    ]);
    expect(cached).toBe(result.current.data);
    expect(result.current.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_1}-note`,
    );
  });

  test("a second episode does not inherit the first one's notes", async () => {
    /*
     * Internal notes are the handover record between responders. Showing one
     * episode's notes on another is worse than showing none: it reads as an
     * account of work that was never done on this episode.
     */
    const client: QueryClient = createTestQueryClient();

    const { result: first } = await renderHook(
      () => {
        return useAlertEpisodeNotes(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(first.current.isSuccess).toBe(true);
    });

    const { result: second } = await renderHook(
      () => {
        return useAlertEpisodeNotes(PROJECT_A, EPISODE_2);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(second.current.isSuccess).toBe(true);
    });

    expect(second.current.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_2}-note`,
    );
    expect(first.current.data?.[0]?._id).toBe(`${PROJECT_A}-${EPISODE_1}-note`);
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });

  test("does not fetch anything before a project is known", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeNotes("", EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(notesMock).not.toHaveBeenCalled();
    expectHeldBackByEnabledGuard(result.current);
  });

  test("does not fetch anything before an episode is known", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeNotes(PROJECT_A, "");
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(notesMock).not.toHaveBeenCalled();
    expectHeldBackByEnabledGuard(result.current);
  });

  test("surfaces an api rejection as an error rather than as no notes", async () => {
    const failure: Error = new Error("alert episode notes fetch failed");
    notesMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeNotes(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useAlertEpisodeFeed", () => {
  test("hands the caller the feed under the episode's own key", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeFeed(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });

    expect(feedMock).toHaveBeenCalledWith(PROJECT_A, EPISODE_1);
    const cached: FeedItem[] | undefined = client.getQueryData([
      "alert-episode-feed",
      PROJECT_A,
      EPISODE_1,
    ]);
    expect(cached).toBe(result.current.data);
    expect(result.current.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_1}-feed`,
    );
  });

  test("a second episode does not inherit the first one's feed", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result: first } = await renderHook(
      () => {
        return useAlertEpisodeFeed(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(first.current.isSuccess).toBe(true);
    });

    const { result: second } = await renderHook(
      () => {
        return useAlertEpisodeFeed(PROJECT_A, EPISODE_2);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(second.current.isSuccess).toBe(true);
    });

    expect(second.current.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_2}-feed`,
    );
    expect(first.current.data?.[0]?._id).toBe(`${PROJECT_A}-${EPISODE_1}-feed`);
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });

  test("does not fetch anything before a project is known", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeFeed("", EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(feedMock).not.toHaveBeenCalled();
    expectHeldBackByEnabledGuard(result.current);
  });

  test("does not fetch anything before an episode is known", async () => {
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeFeed(PROJECT_A, "");
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(feedMock).not.toHaveBeenCalled();
    expectHeldBackByEnabledGuard(result.current);
  });

  test("surfaces an api rejection as an error rather than as an empty feed", async () => {
    const failure: Error = new Error("alert episode feed fetch failed");
    feedMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlertEpisodeFeed(PROJECT_A, EPISODE_1);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("the alert episode hooks used together, as the detail screen uses them", () => {
  test("the four episode-scoped hooks each keep their own cache entry", async () => {
    /*
     * These four are called with identical arguments on every render of the
     * detail screen, and their keys differ only in the leading string. That
     * makes them the likeliest place in the file for a copy-paste to go
     * unnoticed: two hooks sharing a leading string would silently render the
     * feed into the notes tab, and every individual hook's own tests would
     * still pass, because each one on its own would look perfectly correct.
     */
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return {
          detail: useAlertEpisodeDetail(PROJECT_A, EPISODE_1),
          timeline: useAlertEpisodeStateTimeline(PROJECT_A, EPISODE_1),
          notes: useAlertEpisodeNotes(PROJECT_A, EPISODE_1),
          feed: useAlertEpisodeFeed(PROJECT_A, EPISODE_1),
        };
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(
        result.current.detail.isSuccess &&
          result.current.timeline.isSuccess &&
          result.current.notes.isSuccess &&
          result.current.feed.isSuccess,
      ).toBe(true);
    });

    expect(client.getQueryCache().getAll()).toHaveLength(4);
    expect(result.current.detail.data?._id).toBe(EPISODE_1);
    expect(result.current.timeline.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_1}-timeline`,
    );
    expect(result.current.notes.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_1}-note`,
    );
    expect(result.current.feed.data?.[0]?._id).toBe(
      `${PROJECT_A}-${EPISODE_1}-feed`,
    );
  });

  test("nothing at all is fetched while the project id is still empty", async () => {
    /*
     * The detail screen mounts before the stored project has been read back,
     * so this is the app's very first render of that screen, not an edge case.
     * One hook forgetting its guard would fire a request with an empty tenant
     * header on every cold open.
     */
    const client: QueryClient = createTestQueryClient();

    await renderHook(
      () => {
        return {
          detail: useAlertEpisodeDetail("", EPISODE_1),
          states: useAlertEpisodeStates(""),
          timeline: useAlertEpisodeStateTimeline("", EPISODE_1),
          notes: useAlertEpisodeNotes("", EPISODE_1),
          feed: useAlertEpisodeFeed("", EPISODE_1),
        };
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(byIdMock).not.toHaveBeenCalled();
    expect(statesMock).not.toHaveBeenCalled();
    expect(timelineMock).not.toHaveBeenCalled();
    expect(notesMock).not.toHaveBeenCalled();
    expect(feedMock).not.toHaveBeenCalled();
  });
});

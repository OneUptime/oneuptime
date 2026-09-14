import apiClient from "./client";
import {
  changeAlertEpisodeState,
  createAlertEpisodeNote,
  fetchAlertEpisodeById,
  fetchAlertEpisodeFeed,
  fetchAlertEpisodeNotes,
  fetchAlertEpisodeStateTimeline,
  fetchAlertEpisodeStates,
  fetchAlertEpisodes,
  fetchAllAlertEpisodes,
} from "./alertEpisodes";
import {
  makeAlertEpisode,
  makeAlertState,
  makeFeedItem,
  makeListResponse,
  makeNamedEntityWithColor,
  makeNote,
  makeStateTimelineItem,
} from "../__tests__/testSupport";
import type {
  AlertEpisodeItem,
  AlertState,
  FeedItem,
  ListResponse,
  NoteItem,
  StateTimelineItem,
} from "./types";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

/*
 * Every function here is a sentence spoken to the server, and none of the three
 * things that can go wrong in that sentence is visible to the compiler.
 *
 * The first is the tenant. A request that names one project carries `tenantid`;
 * the request that deliberately spans every project the responder belongs to
 * carries `is-multi-tenant-query: "true"` and NO tenantid. Swap them and either
 * another project's episodes appear in this project's list, or the home screen
 * goes blank for someone whose episodes are all somewhere else. Both are typed
 * `Record<string, string>` and both compile.
 *
 * The second is the query key. An episode groups alerts, so the episode
 * endpoints filter on `alertEpisodeId` while the alert endpoints one directory
 * over filter on `alertId`. The bodies are untyped JSON, so the wrong key is a
 * successful request that answers about the wrong thing - the notes of an
 * unrelated record, shown under this episode's heading.
 *
 * The third is the unwrapping. The list fetchers return the whole envelope
 * (`data`, `count`, `skip`, `limit`) because their callers page; the detail
 * fetchers return `response.data.data`, the rows; and the by-id fetcher returns
 * the first row. Each is `AxiosResponse` on the way in, so returning the wrong
 * depth type-checks and only fails at the screen.
 */

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

/**
 * Make the next request resolve with `payload` as the axios response body.
 */
function respondWith(payload: unknown): void {
  postSpy().mockResolvedValue({ data: payload } as never);
}

function lastCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = postSpy().mock.calls;

  return calls[calls.length - 1] as Array<unknown>;
}

function lastUrl(): string {
  return lastCall()[0] as string;
}

function lastBody(): Record<string, unknown> {
  return lastCall()[1] as Record<string, unknown>;
}

/**
 * The headers of the axios config, which is where the tenancy of the request
 * is decided.
 */
function lastHeaders(): Record<string, string | undefined> {
  const config: { headers: Record<string, string | undefined> } =
    lastCall()[2] as {
      headers: Record<string, string | undefined>;
    };

  return config.headers;
}

function lastQuery(): Record<string, unknown> {
  return lastBody()["query"] as Record<string, unknown>;
}

function lastSelect(): Record<string, unknown> {
  return lastBody()["select"] as Record<string, unknown>;
}

function lastSort(): Record<string, unknown> {
  return lastBody()["sort"] as Record<string, unknown>;
}

/**
 * The `data` of a write request - the row the server is being asked to create.
 */
function lastData(): Record<string, unknown> {
  return lastBody()["data"] as Record<string, unknown>;
}

describe("fetchAlertEpisodes", () => {
  beforeEach(() => {
    postSpy().mockReset();
    respondWith(makeListResponse<AlertEpisodeItem>([makeAlertEpisode()]));
  });

  test("sends the project id as the tenant header", async () => {
    await fetchAlertEpisodes("project-1");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("does not declare itself a multi-tenant query", async () => {
    /*
     * The two headers are mutually exclusive in intent. This list is the one a
     * responder opened for a single project, and adding the multi-tenant flag
     * would widen it to every project they belong to - which reads as a
     * cross-project leak to anyone looking at the screen.
     */
    await fetchAlertEpisodes("project-1");

    expect(lastHeaders()["is-multi-tenant-query"]).toBeUndefined();
  });

  test("reads the first page of twenty when given no paging options", async () => {
    await fetchAlertEpisodes("project-1");

    expect(lastUrl()).toBe("/api/alert-episode/get-list?skip=0&limit=20");
  });

  test("pages with the skip and limit it was handed", async () => {
    /*
     * skip and limit ride in the query string rather than the body. A fetcher
     * that dropped them onto the body instead would silently re-serve page one
     * forever, which looks like an infinite list that never advances.
     */
    await fetchAlertEpisodes("project-1", { skip: 40, limit: 10 });

    expect(lastUrl()).toBe("/api/alert-episode/get-list?skip=40&limit=10");
  });

  test("keeps the default page size when only an offset is given", async () => {
    await fetchAlertEpisodes("project-1", { skip: 20 });

    expect(lastUrl()).toBe("/api/alert-episode/get-list?skip=20&limit=20");
  });

  test("asks for every episode by default, resolved ones included", async () => {
    /*
     * An empty query is what makes the unfiltered tab show history. Sending
     * the unresolved filter unconditionally would hide every episode the team
     * already closed, and the list would simply look short rather than wrong.
     */
    await fetchAlertEpisodes("project-1");

    expect(lastQuery()).toEqual({});
  });

  test("narrows to the unresolved states when asked to", async () => {
    await fetchAlertEpisodes("project-1", { unresolvedOnly: true });

    expect(lastQuery()).toEqual({
      currentAlertState: { isResolvedState: false },
    });
  });

  test("sends no filter when unresolvedOnly is explicitly false", async () => {
    await fetchAlertEpisodes("project-1", { unresolvedOnly: false, limit: 5 });

    expect(lastQuery()).toEqual({});
  });

  test("asks for the newest episodes first", async () => {
    /*
     * The list is not re-sorted on the device, so the server's order is the
     * order the responder sees. Ascending here would bury today's episode at
     * the bottom of a page they never scroll to.
     */
    await fetchAlertEpisodes("project-1");

    expect(lastSort()).toEqual({ createdAt: "DESC" });
  });

  test("selects the state and severity as objects, because the row renders their colours", async () => {
    /*
     * `currentAlertState: true` would also be a valid request and would return
     * an id, leaving the coloured status dot with nothing to colour itself
     * with. Naming the nested fields is what fills it in.
     */
    await fetchAlertEpisodes("project-1");

    expect(lastSelect()["currentAlertState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
    expect(lastSelect()["alertSeverity"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("selects the fields an episode row shows", async () => {
    await fetchAlertEpisodes("project-1");

    const select: Record<string, unknown> = lastSelect();

    expect(select["_id"]).toBe(true);
    expect(select["title"]).toBe(true);
    expect(select["episodeNumber"]).toBe(true);
    expect(select["episodeNumberWithPrefix"]).toBe(true);
    expect(select["alertCount"]).toBe(true);
    expect(select["createdAt"]).toBe(true);
  });

  test("returns the whole envelope, so the caller knows there is more to page", async () => {
    const episode: AlertEpisodeItem = makeAlertEpisode();

    respondWith(
      makeListResponse<AlertEpisodeItem>([episode], {
        count: 137,
        skip: 40,
        limit: 20,
      }),
    );

    const result: ListResponse<AlertEpisodeItem> = await fetchAlertEpisodes(
      "project-1",
      { skip: 40 },
    );

    expect(result.data).toEqual([episode]);
    expect(result.count).toBe(137);
    expect(result.skip).toBe(40);
    expect(result.limit).toBe(20);
  });

  test("returns an empty envelope for a project with no episodes", async () => {
    /*
     * A quiet project is the normal case, not an error. The envelope has to
     * survive it intact - a caller that reads `.data.length` must not be
     * handed undefined.
     */
    respondWith(makeListResponse<AlertEpisodeItem>([], { count: 0 }));

    const result: ListResponse<AlertEpisodeItem> =
      await fetchAlertEpisodes("project-1");

    expect(result.data).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("surfaces a failed request instead of reporting an empty list", async () => {
    /*
     * "No episodes" and "we could not ask" have to stay distinguishable: the
     * first is reassuring and the second is not, and only the rejection lets
     * react-query render the difference.
     */
    postSpy().mockRejectedValue(new Error("network unreachable") as never);

    await expect(fetchAlertEpisodes("project-1")).rejects.toThrow(
      "network unreachable",
    );
  });
});

describe("fetchAllAlertEpisodes", () => {
  beforeEach(() => {
    postSpy().mockReset();
    respondWith(makeListResponse<AlertEpisodeItem>([makeAlertEpisode()]));
  });

  test("declares itself a multi-tenant query", async () => {
    /*
     * This is the request behind the cross-project home screen. Without the
     * flag the server scopes the read to nothing in particular and the
     * responder sees an empty overview while their phone is ringing.
     */
    await fetchAllAlertEpisodes();

    expect(lastHeaders()["is-multi-tenant-query"]).toBe("true");
  });

  test("carries no tenantid, which is what lets it span every project", async () => {
    /*
     * A tenantid alongside the multi-tenant flag would pin the result to one
     * project - the opposite of what this call exists for, and invisible
     * because a single project's episodes still come back.
     */
    await fetchAllAlertEpisodes();

    expect(lastHeaders()["tenantid"]).toBeUndefined();
  });

  test("asks for each row's project id, since the rows arrive mixed together", async () => {
    /*
     * useAllProjectAlertEpisodes maps every row onto a project name through
     * item.projectId. Drop the field and every episode on the overview is
     * labelled with the empty string.
     */
    await fetchAllAlertEpisodes();

    expect(lastSelect()["projectId"]).toBe(true);
  });

  test("reads a hundred episodes by default, not the twenty a single project reads", async () => {
    await fetchAllAlertEpisodes();

    expect(lastUrl()).toBe("/api/alert-episode/get-list?skip=0&limit=100");
  });

  test("pages with the skip and limit it was handed", async () => {
    await fetchAllAlertEpisodes({ skip: 100, limit: 50 });

    expect(lastUrl()).toBe("/api/alert-episode/get-list?skip=100&limit=50");
  });

  test("asks for every episode by default, resolved ones included", async () => {
    await fetchAllAlertEpisodes();

    expect(lastQuery()).toEqual({});
  });

  test("narrows to the unresolved states when asked to", async () => {
    await fetchAllAlertEpisodes({ unresolvedOnly: true });

    expect(lastQuery()).toEqual({
      currentAlertState: { isResolvedState: false },
    });
  });

  test("asks for the newest episodes first", async () => {
    await fetchAllAlertEpisodes();

    expect(lastSort()).toEqual({ createdAt: "DESC" });
  });

  test("selects the state and severity as objects, because the row renders their colours", async () => {
    await fetchAllAlertEpisodes();

    expect(lastSelect()["currentAlertState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
    expect(lastSelect()["alertSeverity"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("returns the whole envelope", async () => {
    const episode: AlertEpisodeItem = makeAlertEpisode({
      projectId: "project-2",
    });

    respondWith(
      makeListResponse<AlertEpisodeItem>([episode], { count: 1, limit: 100 }),
    );

    const result: ListResponse<AlertEpisodeItem> =
      await fetchAllAlertEpisodes();

    expect(result.data).toEqual([episode]);
    expect(result.limit).toBe(100);
  });

  test("returns an empty envelope when no project has an episode", async () => {
    respondWith(makeListResponse<AlertEpisodeItem>([], { count: 0 }));

    const result: ListResponse<AlertEpisodeItem> =
      await fetchAllAlertEpisodes();

    expect(result.data).toEqual([]);
  });

  test("surfaces a failed request instead of reporting an empty overview", async () => {
    postSpy().mockRejectedValue(new Error("offline") as never);

    await expect(fetchAllAlertEpisodes()).rejects.toThrow("offline");
  });
});

describe("fetchAlertEpisodeById", () => {
  beforeEach(() => {
    postSpy().mockReset();
    respondWith(makeListResponse<AlertEpisodeItem>([makeAlertEpisode()]));
  });

  test("looks the episode up by its id", async () => {
    await fetchAlertEpisodeById("project-1", "alert-episode-1");

    expect(lastQuery()).toEqual({ _id: "alert-episode-1" });
  });

  test("asks the list endpoint for a single row", async () => {
    /*
     * There is no get-by-id route; the detail screen borrows the list one with
     * a limit of one. A limit that drifted upwards would fetch a page of
     * episodes to display exactly one of them, on a handset, over cellular.
     */
    await fetchAlertEpisodeById("project-1", "alert-episode-1");

    expect(lastUrl()).toBe("/api/alert-episode/get-list?skip=0&limit=1");
  });

  test("sends the project id as the tenant header", async () => {
    /*
     * The id alone does not scope the read. Without the tenant header the
     * lookup is not confined to the project the responder opened.
     */
    await fetchAlertEpisodeById("project-1", "alert-episode-1");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("does not declare itself a multi-tenant query", async () => {
    await fetchAlertEpisodeById("project-1", "alert-episode-1");

    expect(lastHeaders()["is-multi-tenant-query"]).toBeUndefined();
  });

  test("selects the fields the detail screen renders, including the root cause", async () => {
    await fetchAlertEpisodeById("project-1", "alert-episode-1");

    const select: Record<string, unknown> = lastSelect();

    expect(select["title"]).toBe(true);
    expect(select["description"]).toBe(true);
    expect(select["rootCause"]).toBe(true);
    expect(select["alertCount"]).toBe(true);
    expect(select["currentAlertState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("returns the episode itself rather than the envelope around it", async () => {
    /*
     * The detail screen reads `episode.title` straight off this value. One
     * level of unwrapping too few and every field on the screen is undefined
     * while the request itself looks perfectly healthy.
     */
    const episode: AlertEpisodeItem = makeAlertEpisode({
      _id: "alert-episode-9",
      title: "Repeated disk pressure",
    });

    respondWith(makeListResponse<AlertEpisodeItem>([episode]));

    const result: AlertEpisodeItem | null = await fetchAlertEpisodeById(
      "project-1",
      "alert-episode-9",
    );

    expect(result).toEqual(episode);
  });

  test("returns the first row rather than the array of rows", async () => {
    const first: AlertEpisodeItem = makeAlertEpisode({ _id: "episode-a" });
    const second: AlertEpisodeItem = makeAlertEpisode({ _id: "episode-b" });

    respondWith(makeListResponse<AlertEpisodeItem>([first, second]));

    const result: AlertEpisodeItem | null = await fetchAlertEpisodeById(
      "project-1",
      "episode-a",
    );

    expect(result?._id).toBe("episode-a");
  });

  test("resolves to nothing, rather than throwing, when the project holds no such episode", async () => {
    /*
     * A stale push notification opens an episode that has since been deleted,
     * or that belongs to a project the responder has lost access to. The
     * screen is written to answer that with "Episode not found.", which it can
     * only do if the fetcher hands it a missing value instead of blowing up
     * inside react-query.
     */
    respondWith(makeListResponse<AlertEpisodeItem>([]));

    const result: AlertEpisodeItem | null = await fetchAlertEpisodeById(
      "project-1",
      "deleted-episode",
    );

    expect(result).toBeNull();
  });

  test("names the missing episode null, because undefined is what react-query rejects", async () => {
    /*
     * `data[0]` of an empty list is `undefined`, and `undefined` is the single
     * value react-query v5 will not put in its cache - it rejects the query
     * with a synthetic "data is undefined" error, so a deleted episode would
     * arrive at the screen as a failure rather than as an answer. The `?? null`
     * in the fetcher is what stops that, and `toBeNull` - which `undefined`
     * fails - is what stops the `?? null` from being dropped again.
     */
    respondWith(makeListResponse<AlertEpisodeItem>([]));

    const result: AlertEpisodeItem | null = await fetchAlertEpisodeById(
      "project-1",
      "deleted-episode",
    );

    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });

  test("surfaces a failed request", async () => {
    postSpy().mockRejectedValue(new Error("request failed") as never);

    await expect(
      fetchAlertEpisodeById("project-1", "alert-episode-1"),
    ).rejects.toThrow("request failed");
  });
});

describe("fetchAlertEpisodeStates", () => {
  beforeEach(() => {
    postSpy().mockReset();
    respondWith(makeListResponse<AlertState>([makeAlertState()]));
  });

  test("reads the alert states, which episodes share with alerts", async () => {
    /*
     * Episodes have no state table of their own - an episode's current state
     * is an AlertState. Pointing this at an alert-episode-state route would
     * 404 and leave the detail screen with no acknowledge or resolve button.
     */
    await fetchAlertEpisodeStates("project-1");

    expect(lastUrl()).toBe("/api/alert-state/get-list?skip=0&limit=20");
  });

  test("sends the project id as the tenant header", async () => {
    /*
     * States are defined per project and projects rename and reorder theirs,
     * so an unscoped read would offer state ids this project cannot accept.
     */
    await fetchAlertEpisodeStates("project-1");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("does not span projects", async () => {
    await fetchAlertEpisodeStates("project-1");

    expect(lastHeaders()["is-multi-tenant-query"]).toBeUndefined();
  });

  test("asks for every state, unfiltered", async () => {
    await fetchAlertEpisodeStates("project-1");

    expect(lastQuery()).toEqual({});
  });

  test("orders the states the way the workflow runs", async () => {
    /*
     * Ascending `order` is created, acknowledged, resolved. The picker renders
     * them in the order they arrive, so DESC here would present the workflow
     * backwards.
     */
    await fetchAlertEpisodeStates("project-1");

    expect(lastSort()).toEqual({ order: "ASC" });
  });

  test("asks for the flags that say what each state MEANS", async () => {
    /*
     * The screen never matches on the state's name - it finds the acknowledge
     * and resolve buttons by isAcknowledgedState and isResolvedState, because
     * a project is free to call them anything. Without these three booleans
     * every state looks alike and both buttons disappear.
     */
    await fetchAlertEpisodeStates("project-1");

    const select: Record<string, unknown> = lastSelect();

    expect(select["isResolvedState"]).toBe(true);
    expect(select["isAcknowledgedState"]).toBe(true);
    expect(select["isCreatedState"]).toBe(true);
    expect(select["color"]).toBe(true);
    expect(select["order"]).toBe(true);
  });

  test("returns the rows, not the envelope", async () => {
    const created: AlertState = makeAlertState({ _id: "state-created" });
    const resolved: AlertState = makeAlertState({
      _id: "state-resolved",
      name: "Resolved",
      isResolvedState: true,
      isCreatedState: false,
      order: 3,
    });

    respondWith(makeListResponse<AlertState>([created, resolved]));

    const result: AlertState[] = await fetchAlertEpisodeStates("project-1");

    expect(result).toEqual([created, resolved]);
  });

  test("returns an empty array when the project defines no states", async () => {
    respondWith(makeListResponse<AlertState>([]));

    const result: AlertState[] = await fetchAlertEpisodeStates("project-1");

    expect(result).toEqual([]);
  });
});

describe("fetchAlertEpisodeStateTimeline", () => {
  beforeEach(() => {
    postSpy().mockReset();
    respondWith(makeListResponse<StateTimelineItem>([makeStateTimelineItem()]));
  });

  test("keys the timeline on the episode id, not on an alert id", async () => {
    /*
     * An episode is a group of alerts, and the alert timeline one file over
     * filters on `alertId`. The bodies are untyped JSON, so a key copied from
     * there is not a compile error and not a request error either - it is
     * another record's history rendered under this episode's heading.
     */
    await fetchAlertEpisodeStateTimeline("project-1", "alert-episode-1");

    expect(lastQuery()).toEqual({ alertEpisodeId: "alert-episode-1" });
    expect(lastQuery()["alertId"]).toBeUndefined();
  });

  test("reads the episode's own state timeline route", async () => {
    await fetchAlertEpisodeStateTimeline("project-1", "alert-episode-1");

    expect(lastUrl()).toBe(
      "/api/alert-episode-state-timeline/get-list?skip=0&limit=50",
    );
  });

  test("sends the project id as the tenant header", async () => {
    await fetchAlertEpisodeStateTimeline("project-1", "alert-episode-1");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("does not span projects", async () => {
    await fetchAlertEpisodeStateTimeline("project-1", "alert-episode-1");

    expect(lastHeaders()["is-multi-tenant-query"]).toBeUndefined();
  });

  test("asks for the most recent transitions first", async () => {
    await fetchAlertEpisodeStateTimeline("project-1", "alert-episode-1");

    expect(lastSort()).toEqual({ createdAt: "DESC" });
  });

  test("selects the alert state on each entry, not the incident state", async () => {
    /*
     * StateTimelineItem carries `alertState` and `incidentState` as two
     * optional fields so one component can render both kinds of timeline.
     * Optional means the compiler is satisfied either way, and asking for the
     * incident state here returns entries with no state on them at all - a
     * timeline of blank rows with timestamps.
     */
    await fetchAlertEpisodeStateTimeline("project-1", "alert-episode-1");

    expect(lastSelect()["alertState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
    expect(lastSelect()["incidentState"]).toBeUndefined();
  });

  test("returns the rows, not the envelope", async () => {
    const entry: StateTimelineItem = makeStateTimelineItem({
      _id: "timeline-7",
      incidentState: undefined,
      alertState: makeNamedEntityWithColor({
        _id: "state-acknowledged",
        name: "Acknowledged",
      }),
    });

    respondWith(makeListResponse<StateTimelineItem>([entry]));

    const result: StateTimelineItem[] = await fetchAlertEpisodeStateTimeline(
      "project-1",
      "alert-episode-1",
    );

    expect(result).toEqual([entry]);
  });

  test("returns an empty array for an episode with no recorded transitions", async () => {
    respondWith(makeListResponse<StateTimelineItem>([]));

    const result: StateTimelineItem[] = await fetchAlertEpisodeStateTimeline(
      "project-1",
      "alert-episode-1",
    );

    expect(result).toEqual([]);
  });
});

describe("fetchAlertEpisodeFeed", () => {
  beforeEach(() => {
    postSpy().mockReset();
    respondWith(makeListResponse<FeedItem>([makeFeedItem()]));
  });

  test("keys the feed on the episode id, not on an alert id", async () => {
    /*
     * The feed is the narrative a responder reads to catch up mid-incident.
     * Filtered on the wrong key it would still render, sentence by sentence,
     * about something else entirely.
     */
    await fetchAlertEpisodeFeed("project-1", "alert-episode-1");

    expect(lastQuery()).toEqual({ alertEpisodeId: "alert-episode-1" });
    expect(lastQuery()["alertId"]).toBeUndefined();
  });

  test("reads the episode feed route", async () => {
    await fetchAlertEpisodeFeed("project-1", "alert-episode-1");

    expect(lastUrl()).toBe("/api/alert-episode-feed/get-list?skip=0&limit=50");
  });

  test("sends the project id as the tenant header", async () => {
    await fetchAlertEpisodeFeed("project-1", "alert-episode-1");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("does not span projects", async () => {
    await fetchAlertEpisodeFeed("project-1", "alert-episode-1");

    expect(lastHeaders()["is-multi-tenant-query"]).toBeUndefined();
  });

  test("orders the feed by when each entry was POSTED, not when the row was created", async () => {
    /*
     * postedAt is the moment the event happened; createdAt is when the row
     * reached the table, and a backfilled or retried entry has the two far
     * apart. Sorting on the wrong one puts an event out of sequence in the one
     * place a responder is reconstructing a sequence.
     */
    await fetchAlertEpisodeFeed("project-1", "alert-episode-1");

    expect(lastSort()).toEqual({ postedAt: "DESC" });
  });

  test("selects the markdown, the expandable detail and the colour each entry renders with", async () => {
    await fetchAlertEpisodeFeed("project-1", "alert-episode-1");

    const select: Record<string, unknown> = lastSelect();

    expect(select["feedInfoInMarkdown"]).toBe(true);
    expect(select["moreInformationInMarkdown"]).toBe(true);
    expect(select["displayColor"]).toBe(true);
    expect(select["postedAt"]).toBe(true);
  });

  test("returns the rows, not the envelope", async () => {
    const entry: FeedItem = makeFeedItem({
      _id: "feed-9",
      feedInfoInMarkdown: "**Resolved** by Ada Lovelace",
    });

    respondWith(makeListResponse<FeedItem>([entry]));

    const result: FeedItem[] = await fetchAlertEpisodeFeed(
      "project-1",
      "alert-episode-1",
    );

    expect(result).toEqual([entry]);
  });

  test("returns an empty array for an episode with no feed entries", async () => {
    respondWith(makeListResponse<FeedItem>([]));

    const result: FeedItem[] = await fetchAlertEpisodeFeed(
      "project-1",
      "alert-episode-1",
    );

    expect(result).toEqual([]);
  });
});

describe("changeAlertEpisodeState", () => {
  beforeEach(() => {
    postSpy().mockReset();
    respondWith({ _id: "timeline-new" });
  });

  test("records the change by adding to the episode's state timeline", async () => {
    /*
     * There is no "set state" route: appending a timeline entry IS the state
     * change, and the current state is derived from the latest entry. That is
     * why this posts to the timeline collection rather than patching the
     * episode.
     */
    await changeAlertEpisodeState("project-1", "alert-episode-1", "state-ack");

    expect(lastUrl()).toBe("/api/alert-episode-state-timeline");
  });

  test("names the episode, the new state and the project in the row it creates", async () => {
    await changeAlertEpisodeState("project-1", "alert-episode-1", "state-ack");

    expect(lastData()).toEqual({
      alertEpisodeId: "alert-episode-1",
      alertStateId: "state-ack",
      projectId: "project-1",
    });
  });

  test("keys the new row on the episode, not on an alert", async () => {
    /*
     * Acknowledging an episode must not be recorded against one of the alerts
     * inside it: the episode would stay unacknowledged, still paging, while
     * the responder's screen shows the acknowledgement they just made.
     */
    await changeAlertEpisodeState("project-1", "alert-episode-1", "state-ack");

    expect(lastData()["alertEpisodeId"]).toBe("alert-episode-1");
    expect(lastData()["alertId"]).toBeUndefined();
  });

  test("wraps the row in a data envelope, which is what the write API expects", async () => {
    await changeAlertEpisodeState("project-1", "alert-episode-1", "state-ack");

    expect(Object.keys(lastBody())).toEqual(["data"]);
  });

  test("sends the project id as the tenant header", async () => {
    await changeAlertEpisodeState("project-1", "alert-episode-1", "state-ack");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("resolves with nothing, since the caller refetches rather than reads a row back", async () => {
    await expect(
      changeAlertEpisodeState("project-1", "alert-episode-1", "state-ack"),
    ).resolves.toBeUndefined();
  });

  test("surfaces a rejected write so the optimistic update can be rolled back", async () => {
    /*
     * The detail screen paints the new state immediately and restores the
     * previous one in its catch. Swallow the failure here and the responder is
     * looking at an "Acknowledged" badge for an episode the server still
     * considers unacknowledged - the single most dangerous lie this app can
     * tell.
     */
    postSpy().mockRejectedValue(new Error("conflict") as never);

    await expect(
      changeAlertEpisodeState("project-1", "alert-episode-1", "state-ack"),
    ).rejects.toThrow("conflict");
  });
});

describe("fetchAlertEpisodeNotes", () => {
  beforeEach(() => {
    postSpy().mockReset();
    respondWith(makeListResponse<NoteItem>([makeNote()]));
  });

  test("keys the notes on the episode id, not on an alert id", async () => {
    /*
     * Internal notes are what one responder writes for the next one, and they
     * routinely name hosts, customers and people. The wrong key here does not
     * fail - it returns another record's notes and shows them under this
     * episode.
     */
    await fetchAlertEpisodeNotes("project-1", "alert-episode-1");

    expect(lastQuery()).toEqual({ alertEpisodeId: "alert-episode-1" });
    expect(lastQuery()["alertId"]).toBeUndefined();
  });

  test("reads the episode's internal note route", async () => {
    await fetchAlertEpisodeNotes("project-1", "alert-episode-1");

    expect(lastUrl()).toBe(
      "/api/alert-episode-internal-note/get-list?skip=0&limit=50",
    );
  });

  test("sends the project id as the tenant header", async () => {
    await fetchAlertEpisodeNotes("project-1", "alert-episode-1");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("does not span projects", async () => {
    /*
     * Of everything the app reads, internal notes are the rows that must never
     * arrive from a project the responder did not open.
     */
    await fetchAlertEpisodeNotes("project-1", "alert-episode-1");

    expect(lastHeaders()["is-multi-tenant-query"]).toBeUndefined();
  });

  test("asks for the author of each note", async () => {
    /*
     * A note without a name attached is much harder to act on: "restarted the
     * primary" means something different depending on who is still awake.
     */
    await fetchAlertEpisodeNotes("project-1", "alert-episode-1");

    expect(lastSelect()["createdByUser"]).toEqual({ _id: true, name: true });
    expect(lastSelect()["note"]).toBe(true);
  });

  test("asks for the newest notes first", async () => {
    await fetchAlertEpisodeNotes("project-1", "alert-episode-1");

    expect(lastSort()).toEqual({ createdAt: "DESC" });
  });

  test("returns the rows, not the envelope", async () => {
    const note: NoteItem = makeNote({ _id: "note-9", note: "Paged the DBAs." });

    respondWith(makeListResponse<NoteItem>([note]));

    const result: NoteItem[] = await fetchAlertEpisodeNotes(
      "project-1",
      "alert-episode-1",
    );

    expect(result).toEqual([note]);
  });

  test("returns an empty array for an episode nobody has annotated", async () => {
    respondWith(makeListResponse<NoteItem>([]));

    const result: NoteItem[] = await fetchAlertEpisodeNotes(
      "project-1",
      "alert-episode-1",
    );

    expect(result).toEqual([]);
  });
});

describe("createAlertEpisodeNote", () => {
  beforeEach(() => {
    postSpy().mockReset();
    respondWith({ _id: "note-new" });
  });

  test("posts to the episode's internal note collection", async () => {
    await createAlertEpisodeNote(
      "project-1",
      "alert-episode-1",
      "Paged the DBAs.",
    );

    expect(lastUrl()).toBe("/api/alert-episode-internal-note");
  });

  test("attaches the note to the episode, to the project, and to nothing else", async () => {
    await createAlertEpisodeNote(
      "project-1",
      "alert-episode-1",
      "Paged the DBAs.",
    );

    expect(lastData()).toEqual({
      alertEpisodeId: "alert-episode-1",
      note: "Paged the DBAs.",
      projectId: "project-1",
    });
  });

  test("keys the note on the episode, not on an alert", async () => {
    /*
     * A note filed against the wrong parent is worse than a lost one: the
     * writer sees it saved, and the next responder reading this episode never
     * finds it.
     */
    await createAlertEpisodeNote(
      "project-1",
      "alert-episode-1",
      "Paged the DBAs.",
    );

    expect(lastData()["alertEpisodeId"]).toBe("alert-episode-1");
    expect(lastData()["alertId"]).toBeUndefined();
  });

  test("sends the note text exactly as it was typed", async () => {
    /*
     * Notes are markdown and responders paste log lines into them, so the
     * newlines and backticks have to survive the trip untouched - no trimming,
     * no escaping, no collapsing.
     */
    const typed: string =
      "Restarted `pg-primary-2`.\n\nStill seeing:\n  ETIMEDOUT";

    await createAlertEpisodeNote("project-1", "alert-episode-1", typed);

    expect(lastData()["note"]).toBe(typed);
  });

  test("sends the project id as the tenant header", async () => {
    await createAlertEpisodeNote(
      "project-1",
      "alert-episode-1",
      "Paged the DBAs.",
    );

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("resolves with nothing, since the caller refetches the note list", async () => {
    await expect(
      createAlertEpisodeNote("project-1", "alert-episode-1", "Paged the DBAs."),
    ).resolves.toBeUndefined();
  });

  test("surfaces a rejected write, so the composer stays open with the text in it", async () => {
    /*
     * The screen only dismisses the modal after this resolves. Swallowing the
     * error would close it on a note that was never stored, taking the text
     * with it.
     */
    postSpy().mockRejectedValue(new Error("payload too large") as never);

    await expect(
      createAlertEpisodeNote("project-1", "alert-episode-1", "Paged the DBAs."),
    ).rejects.toThrow("payload too large");
  });
});

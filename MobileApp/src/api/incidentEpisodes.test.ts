import apiClient from "./client";
import {
  changeIncidentEpisodeState,
  createIncidentEpisodeNote,
  fetchAllIncidentEpisodes,
  fetchIncidentEpisodeById,
  fetchIncidentEpisodeFeed,
  fetchIncidentEpisodeNotes,
  fetchIncidentEpisodeStateTimeline,
  fetchIncidentEpisodeStates,
  fetchIncidentEpisodes,
} from "./incidentEpisodes";
import {
  makeFeedItem,
  makeIncidentEpisode,
  makeIncidentState,
  makeListResponse,
  makeNamedEntityWithColor,
  makeNote,
  makeStateTimelineItem,
} from "../__tests__/testSupport";
import type {
  FeedItem,
  IncidentEpisodeItem,
  IncidentState,
  ListResponse,
  NoteItem,
  StateTimelineItem,
} from "./types";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("./client", () => {
  return { __esModule: true, default: { post: jest.fn(), get: jest.fn() } };
});

/*
 * The incident-episode wrappers. Each one is four decisions - which URL, which
 * query, which sort, which headers - and the type system checks none of them,
 * because every request body is an untyped bag of `true`s and every header is
 * a plain string.
 *
 * The headers are the reason these tests exist. A responder belongs to several
 * projects at once, and the API decides what they may see from the request
 * headers alone: `tenantid` fences a request to ONE project, while
 * `is-multi-tenant-query: "true"` deliberately unfences it across every
 * project the session can reach. Send the wrong one and there is no error, no
 * type failure and no visible symptom in the common case where the responder
 * has a single project - just a screen that either leaks another tenant's
 * episodes or hides the responder's own.
 *
 * The other half is the response shape. Three different unwrappings live in
 * this one file - the paged callers want the whole envelope, the list callers
 * want `data.data`, and the by-id caller wants `data.data[0]` - and picking
 * the wrong depth yields `undefined` rather than a thrown error, which
 * surfaces as an empty screen a long way from the mistake.
 */

interface RequestBody {
  query?: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

interface RecordedRequest {
  url: string;
  body: RequestBody;
  headers: Record<string, string>;
}

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

/**
 * The last request the module actually handed to axios, unpacked.
 *
 * It throws rather than returning an empty shell when nothing was posted, so
 * that a wrapper which quietly stopped calling the API fails these tests
 * instead of satisfying every `toBeUndefined()` in the file.
 */
function lastRequest(): RecordedRequest {
  const calls: Array<Array<unknown>> = postSpy().mock.calls;

  if (calls.length === 0) {
    throw new Error("the function under test never called apiClient.post");
  }

  const call: Array<unknown> = calls[calls.length - 1];
  const config: { headers?: Record<string, string> } = (call[2] ?? {}) as {
    headers?: Record<string, string>;
  };

  return {
    url: call[0] as string,
    body: (call[1] ?? {}) as RequestBody,
    headers: config.headers ?? {},
  };
}

/**
 * Make the next request resolve with `payload` as the axios `data`, i.e. as
 * the envelope the OneUptime API returns rather than as the rows themselves.
 */
function answerWith(payload: unknown): void {
  postSpy().mockResolvedValue({ data: payload } as never);
}

beforeEach(() => {
  /*
   * jest.config sets clearMocks, which wipes recorded calls but leaves the
   * implementation in place; an explicit default here means a test that
   * forgets to stage a response still gets a well-formed empty envelope rather
   * than `undefined.data`.
   */
  answerWith(makeListResponse<unknown>([]));
});

describe("fetchIncidentEpisodes", () => {
  test("asks the incident-episode list endpoint, not the incident one", async () => {
    /*
     * An episode rolls several incidents into one page-worthy event. Pointing
     * this at /api/incident would return the individual incidents instead -
     * plausible-looking rows with the wrong ids behind them, so every tap
     * would open the wrong detail screen.
     */
    await fetchIncidentEpisodes("project-1");

    expect(lastRequest().url).toContain("/api/incident-episode/get-list");
  });

  test("defaults to the first twenty episodes when given no options", async () => {
    await fetchIncidentEpisodes("project-1");

    expect(lastRequest().url).toBe(
      "/api/incident-episode/get-list?skip=0&limit=20",
    );
  });

  test("puts the caller's paging window in the query string", async () => {
    /*
     * The list screen pages by handing the next skip down. If skip were
     * dropped the second page would repeat the first forever.
     */
    await fetchIncidentEpisodes("project-1", { skip: 40, limit: 10 });

    expect(lastRequest().url).toBe(
      "/api/incident-episode/get-list?skip=40&limit=10",
    );
  });

  test("sends the project id as the tenant header", async () => {
    await fetchIncidentEpisodes("project-9");

    expect(lastRequest().headers["tenantid"]).toBe("project-9");
  });

  test("does not ask to span projects", async () => {
    /*
     * This is the per-project list behind a project switcher. Adding the
     * multi-tenant header here would quietly mix another project's episodes
     * into a screen that names one project at the top.
     */
    await fetchIncidentEpisodes("project-1");

    expect(lastRequest().headers["is-multi-tenant-query"]).toBeUndefined();
  });

  test("asks for every episode when the caller does not narrow the list", async () => {
    await fetchIncidentEpisodes("project-1");

    expect(lastRequest().body.query).toEqual({});
  });

  test("narrows to episodes that are not yet resolved when asked", async () => {
    /*
     * The filter is expressed against the episode's CURRENT state rather than
     * a boolean on the episode, so a state renamed in the project's settings
     * still filters correctly as long as its isResolvedState flag is right.
     */
    await fetchIncidentEpisodes("project-1", { unresolvedOnly: true });

    expect(lastRequest().body.query).toEqual({
      currentIncidentState: { isResolvedState: false },
    });
  });

  test("keeps the unresolved filter out of the query when it is explicitly off", async () => {
    await fetchIncidentEpisodes("project-1", { unresolvedOnly: false });

    expect(lastRequest().body.query).toEqual({});
  });

  test("keeps the unresolved filter independent of the paging window", async () => {
    await fetchIncidentEpisodes("project-1", {
      skip: 20,
      unresolvedOnly: true,
    });

    const request: RecordedRequest = lastRequest();

    expect(request.url).toContain("skip=20");
    expect(request.body.query).toEqual({
      currentIncidentState: { isResolvedState: false },
    });
  });

  test("sorts newest first, which is the order the list renders in", async () => {
    await fetchIncidentEpisodes("project-1");

    expect(lastRequest().body.sort).toEqual({ createdAt: "DESC" });
  });

  test("selects the incident count, which is what makes a row an episode", async () => {
    await fetchIncidentEpisodes("project-1");

    expect(lastRequest().body.select).toMatchObject({
      _id: true,
      title: true,
      episodeNumberWithPrefix: true,
      incidentCount: true,
    });
  });

  test("selects the colour of the state and severity, not just their names", async () => {
    /*
     * Both are rendered as coloured chips. Selecting only the name leaves the
     * colour undefined and the severity of a row indistinguishable at a
     * glance, which is the entire point of the chip.
     */
    await fetchIncidentEpisodes("project-1");

    const select: Record<string, unknown> = lastRequest().body.select ?? {};

    expect(select["currentIncidentState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
    expect(select["incidentSeverity"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("returns the whole envelope so the caller can page on the count", async () => {
    const envelope: ListResponse<IncidentEpisodeItem> = makeListResponse(
      [makeIncidentEpisode()],
      { count: 57, skip: 20, limit: 20 },
    );
    answerWith(envelope);

    const result: ListResponse<IncidentEpisodeItem> =
      await fetchIncidentEpisodes("project-1", { skip: 20 });

    expect(result.count).toBe(57);
    expect(result.skip).toBe(20);
    expect(result.data).toHaveLength(1);
  });

  test("returns an empty envelope rather than nothing when the project has no episodes", async () => {
    answerWith(makeListResponse<IncidentEpisodeItem>([], { count: 0 }));

    const result: ListResponse<IncidentEpisodeItem> =
      await fetchIncidentEpisodes("project-1");

    expect(result.data).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("lets a failed request reach the caller instead of resolving empty", async () => {
    /*
     * An empty list and a failed request look identical on screen unless the
     * error propagates, and "no open episodes" is a dangerous thing to show a
     * responder when the truth is that the request never landed.
     */
    postSpy().mockRejectedValue(new Error("network unreachable") as never);

    await expect(fetchIncidentEpisodes("project-1")).rejects.toThrow(
      "network unreachable",
    );
  });
});

describe("fetchAllIncidentEpisodes", () => {
  test("asks to span every project the responder belongs to", async () => {
    /*
     * The home screen deliberately crosses project boundaries: an on-call
     * responder covering four projects needs one list, not four. That is what
     * this header buys, and it is the only request in the module entitled to
     * it.
     */
    await fetchAllIncidentEpisodes();

    expect(lastRequest().headers["is-multi-tenant-query"]).toBe("true");
  });

  test("names no tenant, because naming one would narrow it back to that project", async () => {
    /*
     * The two headers are not additive. A tenantid alongside the multi-tenant
     * flag is how a cross-project screen silently collapses to whichever
     * project happened to be selected.
     */
    await fetchAllIncidentEpisodes();

    expect(lastRequest().headers["tenantid"]).toBeUndefined();
  });

  test("hits the same list endpoint as the per-project fetch", async () => {
    await fetchAllIncidentEpisodes();

    expect(lastRequest().url).toContain("/api/incident-episode/get-list");
  });

  test("defaults to a hundred rows, since it is covering several projects at once", async () => {
    await fetchAllIncidentEpisodes();

    expect(lastRequest().url).toBe(
      "/api/incident-episode/get-list?skip=0&limit=100",
    );
  });

  test("honours an explicit paging window", async () => {
    await fetchAllIncidentEpisodes({ skip: 100, limit: 50 });

    expect(lastRequest().url).toBe(
      "/api/incident-episode/get-list?skip=100&limit=50",
    );
  });

  test("selects projectId, without which a row cannot be attributed", async () => {
    /*
     * The per-project fetch already knows whose episodes it asked for; this
     * one does not. The cross-project screen groups and labels each row by
     * item.projectId, so dropping this field turns every row's project name
     * into an empty string.
     */
    await fetchAllIncidentEpisodes();

    expect(lastRequest().body.select).toMatchObject({ projectId: true });
  });

  test("asks for every episode when the caller does not narrow the list", async () => {
    await fetchAllIncidentEpisodes();

    expect(lastRequest().body.query).toEqual({});
  });

  test("narrows to unresolved episodes across all projects when asked", async () => {
    await fetchAllIncidentEpisodes({ unresolvedOnly: true });

    expect(lastRequest().body.query).toEqual({
      currentIncidentState: { isResolvedState: false },
    });
  });

  test("still spans projects when the unresolved filter is applied", async () => {
    /*
     * Filtering and fencing are separate concerns; a filtered cross-project
     * list is the one the on-call home screen actually renders.
     */
    await fetchAllIncidentEpisodes({ unresolvedOnly: true });

    const request: RecordedRequest = lastRequest();

    expect(request.headers["is-multi-tenant-query"]).toBe("true");
    expect(request.headers["tenantid"]).toBeUndefined();
  });

  test("sorts newest first", async () => {
    await fetchAllIncidentEpisodes();

    expect(lastRequest().body.sort).toEqual({ createdAt: "DESC" });
  });

  test("returns the whole envelope", async () => {
    answerWith(
      makeListResponse(
        [
          makeIncidentEpisode({ _id: "episode-a", projectId: "project-1" }),
          makeIncidentEpisode({ _id: "episode-b", projectId: "project-2" }),
        ],
        { count: 2, limit: 100 },
      ),
    );

    const result: ListResponse<IncidentEpisodeItem> =
      await fetchAllIncidentEpisodes();

    expect(result.count).toBe(2);
    expect(
      result.data.map((item: IncidentEpisodeItem): string | undefined => {
        return item.projectId;
      }),
    ).toEqual(["project-1", "project-2"]);
  });

  test("lets a failed request reach the caller", async () => {
    postSpy().mockRejectedValue(new Error("session expired") as never);

    await expect(fetchAllIncidentEpisodes()).rejects.toThrow("session expired");
  });
});

describe("fetchIncidentEpisodeById", () => {
  test("asks for a single row matching the episode id", async () => {
    await fetchIncidentEpisodeById("project-1", "incident-episode-1");

    const request: RecordedRequest = lastRequest();

    expect(request.url).toBe("/api/incident-episode/get-list?skip=0&limit=1");
    expect(request.body.query).toEqual({ _id: "incident-episode-1" });
  });

  test("fences the lookup to the project rather than trusting the id alone", async () => {
    /*
     * An episode id arrives from a push notification payload, so it is not
     * something the app chose. The tenant header is what stops an id from
     * another project resolving to a row this responder should not see.
     */
    await fetchIncidentEpisodeById("project-3", "incident-episode-1");

    const request: RecordedRequest = lastRequest();

    expect(request.headers["tenantid"]).toBe("project-3");
    expect(request.headers["is-multi-tenant-query"]).toBeUndefined();
  });

  test("selects the fields the detail screen renders, including the root cause", async () => {
    await fetchIncidentEpisodeById("project-1", "incident-episode-1");

    expect(lastRequest().body.select).toMatchObject({
      _id: true,
      title: true,
      description: true,
      rootCause: true,
      declaredAt: true,
      incidentCount: true,
    });
  });

  test("returns the row itself, not the envelope around it", async () => {
    /*
     * One level of unwrapping too few here hands the detail screen an object
     * with `data`, `count` and `limit` on it - no title, no state - and every
     * field renders blank.
     */
    answerWith(
      makeListResponse([
        makeIncidentEpisode({
          _id: "incident-episode-7",
          title: "Rolling checkout outage",
        }),
      ]),
    );

    const episode: IncidentEpisodeItem | null = await fetchIncidentEpisodeById(
      "project-1",
      "incident-episode-7",
    );

    expect(episode?._id).toBe("incident-episode-7");
    expect(episode?.title).toBe("Rolling checkout outage");
  });

  test("takes the first row when the server returns more than one", async () => {
    answerWith(
      makeListResponse([
        makeIncidentEpisode({ _id: "incident-episode-7" }),
        makeIncidentEpisode({ _id: "incident-episode-8" }),
      ]),
    );

    const episode: IncidentEpisodeItem | null = await fetchIncidentEpisodeById(
      "project-1",
      "incident-episode-7",
    );

    expect(episode?._id).toBe("incident-episode-7");
  });

  test("yields nothing, rather than throwing, when the id matches no episode", async () => {
    /*
     * A deleted episode, or one belonging to a project the responder has since
     * left, comes back as an empty list. The wrapper turns that into `null` and
     * hands it on, so the caller - not this layer - decides what an unknown
     * episode looks like on screen.
     */
    answerWith(makeListResponse<IncidentEpisodeItem>([]));

    const episode: IncidentEpisodeItem | null = await fetchIncidentEpisodeById(
      "project-1",
      "missing-episode",
    );

    expect(episode).toBeNull();
  });

  test("reports the miss as null, the one empty value react-query will cache", async () => {
    /*
     * `data[0]` off an empty list is `undefined`, and react-query v5 refuses to
     * cache `undefined`: it rejects the query with a synthetic "data is
     * undefined" error, which would deliver a deleted episode to the detail
     * screen as a failed request with a Retry button that can never help. The
     * `?? null` in the fetcher is what avoids that, and `toBeNull` - failed by
     * `undefined` - is what keeps it there.
     */
    answerWith(makeListResponse<IncidentEpisodeItem>([]));

    const episode: IncidentEpisodeItem | null = await fetchIncidentEpisodeById(
      "project-1",
      "missing-episode",
    );

    expect(episode).toBeNull();
    expect(episode).not.toBeUndefined();
  });

  test("lets a failed lookup reach the caller", async () => {
    postSpy().mockRejectedValue(new Error("forbidden") as never);

    await expect(
      fetchIncidentEpisodeById("project-1", "incident-episode-1"),
    ).rejects.toThrow("forbidden");
  });
});

describe("fetchIncidentEpisodeStates", () => {
  test("reads the project's plain incident states, which episodes share", async () => {
    /*
     * There is no separate incident-episode-state table: an episode moves
     * through the same Created/Acknowledged/Resolved states an incident does.
     * Inventing an episode-scoped endpoint here would 404, and the state
     * picker on the detail screen would come up empty.
     */
    await fetchIncidentEpisodeStates("project-1");

    expect(lastRequest().url).toBe(
      "/api/incident-state/get-list?skip=0&limit=20",
    );
  });

  test("does not ask an episode-scoped endpoint", async () => {
    await fetchIncidentEpisodeStates("project-1");

    expect(lastRequest().url).not.toContain("episode");
  });

  test("sends the project id as the tenant header", async () => {
    /*
     * States are per-project configuration - two projects can define
     * differently named states in a different order - so this list is only
     * meaningful when it is fenced.
     */
    await fetchIncidentEpisodeStates("project-4");

    const request: RecordedRequest = lastRequest();

    expect(request.headers["tenantid"]).toBe("project-4");
    expect(request.headers["is-multi-tenant-query"]).toBeUndefined();
  });

  test("asks for the project's states unfiltered", async () => {
    await fetchIncidentEpisodeStates("project-1");

    expect(lastRequest().body.query).toEqual({});
  });

  test("sorts by the configured order, ascending", async () => {
    /*
     * Order is the workflow: Created before Acknowledged before Resolved. The
     * picker renders these in the order they arrive, so DESC here would offer
     * a responder "Resolved" as the first thing they can tap at 3am.
     */
    await fetchIncidentEpisodeStates("project-1");

    expect(lastRequest().body.sort).toEqual({ order: "ASC" });
  });

  test("selects the flags that tell one state from another", async () => {
    /*
     * The screen does not key on the state's name - a project may rename them.
     * It keys on these booleans to decide which action to offer, so a select
     * that omits them makes every state look alike.
     */
    await fetchIncidentEpisodeStates("project-1");

    expect(lastRequest().body.select).toMatchObject({
      _id: true,
      name: true,
      color: true,
      isResolvedState: true,
      isAcknowledgedState: true,
      isCreatedState: true,
      order: true,
    });
  });

  test("returns the rows, not the envelope", async () => {
    answerWith(
      makeListResponse([
        makeIncidentState({ _id: "state-created", name: "Created" }),
        makeIncidentState({
          _id: "state-resolved",
          name: "Resolved",
          isCreatedState: false,
          isResolvedState: true,
          order: 3,
        }),
      ]),
    );

    const states: IncidentState[] =
      await fetchIncidentEpisodeStates("project-1");

    expect(states).toHaveLength(2);
    expect(states[1].isResolvedState).toBe(true);
  });

  test("returns an empty array when the project defines no states", async () => {
    answerWith(makeListResponse<IncidentState>([]));

    const states: IncidentState[] =
      await fetchIncidentEpisodeStates("project-1");

    expect(states).toEqual([]);
  });

  test("lets a failed request reach the caller", async () => {
    postSpy().mockRejectedValue(new Error("offline") as never);

    await expect(fetchIncidentEpisodeStates("project-1")).rejects.toThrow(
      "offline",
    );
  });
});

describe("fetchIncidentEpisodeStateTimeline", () => {
  test("reads the episode's own state timeline", async () => {
    await fetchIncidentEpisodeStateTimeline("project-1", "incident-episode-1");

    expect(lastRequest().url).toBe(
      "/api/incident-episode-state-timeline/get-list?skip=0&limit=50",
    );
  });

  test("keys the timeline on the episode id, not on an incident id", async () => {
    /*
     * incidentEpisodeId and incidentId are both plausible names on this table
     * and both accept a string. Querying the wrong one returns the transitions
     * of whichever incident happens to share the id - usually none, so the
     * timeline just renders empty and nothing looks broken.
     */
    await fetchIncidentEpisodeStateTimeline("project-1", "incident-episode-5");

    expect(lastRequest().body.query).toEqual({
      incidentEpisodeId: "incident-episode-5",
    });
  });

  test("sends the project id as the tenant header", async () => {
    await fetchIncidentEpisodeStateTimeline("project-2", "incident-episode-1");

    const request: RecordedRequest = lastRequest();

    expect(request.headers["tenantid"]).toBe("project-2");
    expect(request.headers["is-multi-tenant-query"]).toBeUndefined();
  });

  test("sorts newest transition first", async () => {
    await fetchIncidentEpisodeStateTimeline("project-1", "incident-episode-1");

    expect(lastRequest().body.sort).toEqual({ createdAt: "DESC" });
  });

  test("selects the incident state on each entry, with its colour", async () => {
    /*
     * The sibling alert-episode module selects alertState here. An entry
     * without incidentState is a timestamp with no event attached to it.
     */
    await fetchIncidentEpisodeStateTimeline("project-1", "incident-episode-1");

    const select: Record<string, unknown> = lastRequest().body.select ?? {};

    expect(select["incidentState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
    expect(select["createdAt"]).toBe(true);
  });

  test("returns the rows, not the envelope", async () => {
    answerWith(
      makeListResponse([
        makeStateTimelineItem({
          _id: "timeline-2",
          incidentState: makeNamedEntityWithColor({
            _id: "state-acknowledged",
            name: "Acknowledged",
          }),
        }),
        makeStateTimelineItem({ _id: "timeline-1" }),
      ]),
    );

    const timeline: StateTimelineItem[] =
      await fetchIncidentEpisodeStateTimeline(
        "project-1",
        "incident-episode-1",
      );

    expect(timeline).toHaveLength(2);
    expect(timeline[0].incidentState?.name).toBe("Acknowledged");
  });

  test("returns an empty array for an episode with no transitions yet", async () => {
    answerWith(makeListResponse<StateTimelineItem>([]));

    const timeline: StateTimelineItem[] =
      await fetchIncidentEpisodeStateTimeline(
        "project-1",
        "incident-episode-1",
      );

    expect(timeline).toEqual([]);
  });

  test("lets a failed request reach the caller", async () => {
    postSpy().mockRejectedValue(new Error("gateway timeout") as never);

    await expect(
      fetchIncidentEpisodeStateTimeline("project-1", "incident-episode-1"),
    ).rejects.toThrow("gateway timeout");
  });
});

describe("fetchIncidentEpisodeFeed", () => {
  test("reads the episode's own feed", async () => {
    await fetchIncidentEpisodeFeed("project-1", "incident-episode-1");

    expect(lastRequest().url).toBe(
      "/api/incident-episode-feed/get-list?skip=0&limit=50",
    );
  });

  test("keys the feed on the episode id", async () => {
    await fetchIncidentEpisodeFeed("project-1", "incident-episode-5");

    expect(lastRequest().body.query).toEqual({
      incidentEpisodeId: "incident-episode-5",
    });
  });

  test("sends the project id as the tenant header", async () => {
    await fetchIncidentEpisodeFeed("project-6", "incident-episode-1");

    const request: RecordedRequest = lastRequest();

    expect(request.headers["tenantid"]).toBe("project-6");
    expect(request.headers["is-multi-tenant-query"]).toBeUndefined();
  });

  test("sorts by when the entry was posted, newest first", async () => {
    /*
     * postedAt rather than createdAt: a feed entry can be written to the
     * database well after the moment it describes - backfilled from an
     * integration, say - and ordering on the row's creation time would file
     * that entry at the top of a timeline it does not belong to.
     */
    await fetchIncidentEpisodeFeed("project-1", "incident-episode-1");

    expect(lastRequest().body.sort).toEqual({ postedAt: "DESC" });
  });

  test("selects the markdown and the colour each entry renders with", async () => {
    await fetchIncidentEpisodeFeed("project-1", "incident-episode-1");

    expect(lastRequest().body.select).toMatchObject({
      _id: true,
      feedInfoInMarkdown: true,
      moreInformationInMarkdown: true,
      displayColor: true,
      postedAt: true,
      createdAt: true,
    });
  });

  test("returns the rows, not the envelope", async () => {
    answerWith(
      makeListResponse([
        makeFeedItem({
          _id: "feed-2",
          feedInfoInMarkdown: "**Acknowledged** by Ada Lovelace",
        }),
      ]),
    );

    const feed: FeedItem[] = await fetchIncidentEpisodeFeed(
      "project-1",
      "incident-episode-1",
    );

    expect(feed).toHaveLength(1);
    expect(feed[0].feedInfoInMarkdown).toBe("**Acknowledged** by Ada Lovelace");
  });

  test("returns an empty array for an episode with an empty feed", async () => {
    answerWith(makeListResponse<FeedItem>([]));

    const feed: FeedItem[] = await fetchIncidentEpisodeFeed(
      "project-1",
      "incident-episode-1",
    );

    expect(feed).toEqual([]);
  });

  test("lets a failed request reach the caller", async () => {
    postSpy().mockRejectedValue(new Error("bad gateway") as never);

    await expect(
      fetchIncidentEpisodeFeed("project-1", "incident-episode-1"),
    ).rejects.toThrow("bad gateway");
  });
});

describe("changeIncidentEpisodeState", () => {
  test("appends to the state timeline rather than editing the episode", async () => {
    /*
     * State is not a column somebody overwrites; it is the head of an
     * append-only timeline, which is what lets the detail screen show who
     * acknowledged an episode and when.
     */
    await changeIncidentEpisodeState(
      "project-1",
      "incident-episode-1",
      "state-acknowledged",
    );

    expect(lastRequest().url).toBe("/api/incident-episode-state-timeline");
  });

  test("names the episode and the state it is moving to", async () => {
    await changeIncidentEpisodeState(
      "project-1",
      "incident-episode-5",
      "state-resolved",
    );

    expect(lastRequest().body.data).toMatchObject({
      incidentEpisodeId: "incident-episode-5",
      incidentStateId: "state-resolved",
    });
  });

  test("carries the project id in the body as well as the header", async () => {
    /*
     * A write creates a row, and the row needs an owning project of its own.
     * The header authorises the request; the body decides where the new
     * timeline entry lands.
     */
    await changeIncidentEpisodeState(
      "project-8",
      "incident-episode-1",
      "state-resolved",
    );

    const request: RecordedRequest = lastRequest();

    expect(request.body.data).toMatchObject({ projectId: "project-8" });
    expect(request.headers["tenantid"]).toBe("project-8");
  });

  test("does not ask to span projects on a write", async () => {
    await changeIncidentEpisodeState(
      "project-1",
      "incident-episode-1",
      "state-resolved",
    );

    expect(lastRequest().headers["is-multi-tenant-query"]).toBeUndefined();
  });

  test("wraps the write in a data envelope, as the API expects", async () => {
    await changeIncidentEpisodeState(
      "project-1",
      "incident-episode-1",
      "state-resolved",
    );

    const body: RequestBody = lastRequest().body;

    expect(body.data).toBeDefined();
    expect(body.query).toBeUndefined();
  });

  test("resolves with nothing, since the caller refetches rather than reading a row back", async () => {
    answerWith({ _id: "timeline-9" });

    await expect(
      changeIncidentEpisodeState(
        "project-1",
        "incident-episode-1",
        "state-resolved",
      ),
    ).resolves.toBeUndefined();
  });

  test("surfaces a rejected state change instead of swallowing it", async () => {
    /*
     * The severe case. A responder taps Acknowledge, the request fails, and if
     * this resolved quietly the screen would show the episode as acknowledged
     * while the escalation policy keeps paging - or worse, stops.
     */
    postSpy().mockRejectedValue(
      new Error("state transition rejected") as never,
    );

    await expect(
      changeIncidentEpisodeState(
        "project-1",
        "incident-episode-1",
        "state-resolved",
      ),
    ).rejects.toThrow("state transition rejected");
  });
});

describe("fetchIncidentEpisodeNotes", () => {
  test("reads the episode's internal notes", async () => {
    await fetchIncidentEpisodeNotes("project-1", "incident-episode-1");

    expect(lastRequest().url).toBe(
      "/api/incident-episode-internal-note/get-list?skip=0&limit=50",
    );
  });

  test("keys the notes on the episode id", async () => {
    await fetchIncidentEpisodeNotes("project-1", "incident-episode-5");

    expect(lastRequest().body.query).toEqual({
      incidentEpisodeId: "incident-episode-5",
    });
  });

  test("sends the project id as the tenant header", async () => {
    /*
     * Internal notes are the most sensitive thing this module reads - they are
     * the ones explicitly not published to a status page - so the fence
     * matters more here than anywhere else in the file.
     */
    await fetchIncidentEpisodeNotes("project-7", "incident-episode-1");

    const request: RecordedRequest = lastRequest();

    expect(request.headers["tenantid"]).toBe("project-7");
    expect(request.headers["is-multi-tenant-query"]).toBeUndefined();
  });

  test("sorts newest note first", async () => {
    await fetchIncidentEpisodeNotes("project-1", "incident-episode-1");

    expect(lastRequest().body.sort).toEqual({ createdAt: "DESC" });
  });

  test("selects the author, so a note is attributable", async () => {
    await fetchIncidentEpisodeNotes("project-1", "incident-episode-1");

    const select: Record<string, unknown> = lastRequest().body.select ?? {};

    expect(select["note"]).toBe(true);
    expect(select["createdByUser"]).toEqual({ _id: true, name: true });
  });

  test("returns the rows, not the envelope", async () => {
    answerWith(
      makeListResponse([
        makeNote({ _id: "note-2", note: "Paged the database team." }),
      ]),
    );

    const notes: NoteItem[] = await fetchIncidentEpisodeNotes(
      "project-1",
      "incident-episode-1",
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe("Paged the database team.");
  });

  test("returns an empty array for an episode nobody has annotated", async () => {
    answerWith(makeListResponse<NoteItem>([]));

    const notes: NoteItem[] = await fetchIncidentEpisodeNotes(
      "project-1",
      "incident-episode-1",
    );

    expect(notes).toEqual([]);
  });

  test("passes an unattributed note through rather than dropping it", async () => {
    /*
     * createdByUser is nullable - a note written by an automation, or by a
     * user since removed from the project, has none. Losing those rows would
     * quietly erase part of the record.
     */
    answerWith(
      makeListResponse([makeNote({ _id: "note-3", createdByUser: null })]),
    );

    const notes: NoteItem[] = await fetchIncidentEpisodeNotes(
      "project-1",
      "incident-episode-1",
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].createdByUser).toBeNull();
  });

  test("lets a failed request reach the caller", async () => {
    postSpy().mockRejectedValue(new Error("service unavailable") as never);

    await expect(
      fetchIncidentEpisodeNotes("project-1", "incident-episode-1"),
    ).rejects.toThrow("service unavailable");
  });
});

describe("createIncidentEpisodeNote", () => {
  test("posts to the internal-note collection, not to its list route", async () => {
    await createIncidentEpisodeNote(
      "project-1",
      "incident-episode-1",
      "Paged the database team.",
    );

    expect(lastRequest().url).toBe("/api/incident-episode-internal-note");
  });

  test("attaches the note to the episode it was written on", async () => {
    await createIncidentEpisodeNote(
      "project-1",
      "incident-episode-5",
      "Paged the database team.",
    );

    expect(lastRequest().body.data).toMatchObject({
      incidentEpisodeId: "incident-episode-5",
    });
  });

  test("sends the note text exactly as the responder typed it", async () => {
    /*
     * Notes are rendered as markdown, so newlines and formatting characters
     * are content rather than noise. Anything that trims or escapes here
     * changes what a colleague reads back during a handover.
     */
    const note: string = "Rolled back **v2.4.1**.\n\nWatching error rate.";

    await createIncidentEpisodeNote("project-1", "incident-episode-1", note);

    expect(lastRequest().body.data).toMatchObject({ note });
  });

  test("sends an empty note as an empty note rather than omitting the field", async () => {
    /*
     * The server rejects the empty string with a validation error the screen
     * can show. Dropping the field instead would produce a less specific
     * failure, or a blank note row.
     */
    await createIncidentEpisodeNote("project-1", "incident-episode-1", "");

    const data: Record<string, unknown> = lastRequest().body.data ?? {};

    expect(data).toHaveProperty("note");
    expect(data["note"]).toBe("");
  });

  test("carries the project id in the body as well as the header", async () => {
    await createIncidentEpisodeNote(
      "project-2",
      "incident-episode-1",
      "Paged the database team.",
    );

    const request: RecordedRequest = lastRequest();

    expect(request.body.data).toMatchObject({ projectId: "project-2" });
    expect(request.headers["tenantid"]).toBe("project-2");
  });

  test("does not ask to span projects on a write", async () => {
    await createIncidentEpisodeNote(
      "project-1",
      "incident-episode-1",
      "Paged the database team.",
    );

    expect(lastRequest().headers["is-multi-tenant-query"]).toBeUndefined();
  });

  test("resolves with nothing, since the caller refetches the note list", async () => {
    answerWith({ _id: "note-9" });

    await expect(
      createIncidentEpisodeNote(
        "project-1",
        "incident-episode-1",
        "Paged the database team.",
      ),
    ).resolves.toBeUndefined();
  });

  test("surfaces a rejected write instead of pretending the note was saved", async () => {
    postSpy().mockRejectedValue(new Error("note too long") as never);

    await expect(
      createIncidentEpisodeNote(
        "project-1",
        "incident-episode-1",
        "Paged the database team.",
      ),
    ).rejects.toThrow("note too long");
  });
});

interface SingleProjectCall {
  name: string;
  invoke: () => Promise<unknown>;
}

/*
 * Every export except fetchAllIncidentEpisodes speaks for exactly one project.
 * Listing them here means a function added to this module later is a
 * deliberate decision about fencing rather than an oversight - the author has
 * to either add it to this list or explain why it belongs with the
 * cross-project fetch.
 */
const singleProjectCalls: Array<SingleProjectCall> = [
  {
    name: "fetchIncidentEpisodes",
    invoke: (): Promise<unknown> => {
      return fetchIncidentEpisodes("project-1");
    },
  },
  {
    name: "fetchIncidentEpisodeById",
    invoke: (): Promise<unknown> => {
      return fetchIncidentEpisodeById("project-1", "incident-episode-1");
    },
  },
  {
    name: "fetchIncidentEpisodeStates",
    invoke: (): Promise<unknown> => {
      return fetchIncidentEpisodeStates("project-1");
    },
  },
  {
    name: "fetchIncidentEpisodeStateTimeline",
    invoke: (): Promise<unknown> => {
      return fetchIncidentEpisodeStateTimeline(
        "project-1",
        "incident-episode-1",
      );
    },
  },
  {
    name: "fetchIncidentEpisodeFeed",
    invoke: (): Promise<unknown> => {
      return fetchIncidentEpisodeFeed("project-1", "incident-episode-1");
    },
  },
  {
    name: "fetchIncidentEpisodeNotes",
    invoke: (): Promise<unknown> => {
      return fetchIncidentEpisodeNotes("project-1", "incident-episode-1");
    },
  },
  {
    name: "changeIncidentEpisodeState",
    invoke: (): Promise<unknown> => {
      return changeIncidentEpisodeState(
        "project-1",
        "incident-episode-1",
        "state-resolved",
      );
    },
  },
  {
    name: "createIncidentEpisodeNote",
    invoke: (): Promise<unknown> => {
      return createIncidentEpisodeNote(
        "project-1",
        "incident-episode-1",
        "Paged the database team.",
      );
    },
  },
];

describe("the project fence", () => {
  for (const singleProjectCall of singleProjectCalls) {
    test(`${singleProjectCall.name} names its project and never spans projects`, async () => {
      await singleProjectCall.invoke();

      const request: RecordedRequest = lastRequest();

      expect(request.headers["tenantid"]).toBe("project-1");
      expect(request.headers["is-multi-tenant-query"]).toBeUndefined();
    });
  }

  test("fetchAllIncidentEpisodes is the only request that spans projects", async () => {
    await fetchAllIncidentEpisodes();

    const request: RecordedRequest = lastRequest();

    expect(request.headers["is-multi-tenant-query"]).toBe("true");
    expect(request.headers["tenantid"]).toBeUndefined();
  });
});

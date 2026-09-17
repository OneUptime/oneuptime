import apiClient from "./client";
import {
  changeAlertState,
  fetchAlertById,
  fetchAlertFeed,
  fetchAlertStateTimeline,
  fetchAlertStates,
  fetchAlerts,
  fetchAllAlerts,
} from "./alerts";
import {
  makeAlert,
  makeAlertState,
  makeFeedItem,
  makeListResponse,
  makeNamedEntityWithColor,
  makeStateTimelineItem,
} from "../__tests__/testSupport";
import type {
  AlertItem,
  AlertState,
  FeedItem,
  ListResponse,
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
 * The seven requests behind every alert the responder sees.
 *
 * Two things about them are invisible to the type system and expensive to get
 * wrong.
 *
 * The first is tenancy. A request that names one project carries a `tenantid`
 * header; the cross-project fetch instead carries `is-multi-tenant-query` and
 * deliberately carries NO tenantid, because naming a project there would
 * scope the answer to that one project. Swap the two and you either show a
 * responder rows from a project they were reading a moment ago, or you hide
 * the alerts of every project but one behind a screen that claims to span
 * them all. Both compile.
 *
 * The second is unwrapping. `/get-list` always answers with an envelope of
 * `data`, `count`, `skip` and `limit`, and these functions disagree on purpose
 * about how much of it to hand back: the paging lists return the envelope
 * (useAllProjectCounts asks for a single row purely to read `count` for its
 * badge), the sub-lists return the rows, and the by-id fetcher returns the
 * first row. Returning one level too many or too few produces a screen that
 * renders nothing rather than an error anyone can act on.
 *
 * The `select` assertions matter for the same reason: a field the request did
 * not select comes back absent, not as an error, so a dropped `color` is a
 * severity badge that renders blank in production and nowhere else.
 */

interface RequestConfig {
  headers?: Record<string, unknown>;
}

function postMock(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function lastCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = postMock().mock.calls;

  return calls[calls.length - 1]!;
}

function lastUrl(): string {
  return lastCall()[0] as string;
}

function lastBody(): Record<string, unknown> {
  return lastCall()[1] as Record<string, unknown>;
}

function lastSelect(): Record<string, unknown> {
  return lastBody()["select"] as Record<string, unknown>;
}

function lastHeaders(): Record<string, unknown> {
  const config: RequestConfig = lastCall()[2] as RequestConfig;

  return config.headers ?? {};
}

/**
 * Make the mocked client answer with the envelope the API would send.
 */
function respondWith<T>(envelope: ListResponse<T>): void {
  postMock().mockResolvedValue({ data: envelope } as never);
}

beforeEach(() => {
  /*
   * jest.config.js sets clearMocks, which forgets calls but keeps whatever
   * implementation the previous test installed. Reinstating an empty envelope
   * here stops one test's rejection or fixture from being the thing the next
   * test unwraps.
   */
  respondWith<unknown>(makeListResponse<unknown>([]));
});

describe("fetchAlerts", () => {
  test("scopes the request to the project it was asked about", async () => {
    await fetchAlerts("project-1");

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("does not claim to span projects", async () => {
    /*
     * The multi-tenant flag alongside a tenantid is the contradiction the
     * server resolves in whichever direction it likes; keeping this list
     * single-tenant is what makes its `count` mean "in this project".
     */
    await fetchAlerts("project-1");

    expect(lastHeaders()).not.toHaveProperty("is-multi-tenant-query");
  });

  test("asks for the first twenty rows when the caller does not page", async () => {
    await fetchAlerts("project-1");

    expect(lastUrl()).toBe("/api/alert/get-list?skip=0&limit=20");
  });

  test("carries the caller's skip and limit into the query string", async () => {
    /*
     * Paging lives in the URL, not in the body, so a wrapper that only forgot
     * to forward `skip` would keep serving page one to a list the responder
     * is scrolling.
     */
    await fetchAlerts("project-1", { skip: 40, limit: 10 });

    expect(lastUrl()).toBe("/api/alert/get-list?skip=40&limit=10");
  });

  test("asks for every alert when no filter was requested", async () => {
    await fetchAlerts("project-1");

    expect(lastBody()["query"]).toEqual({});
  });

  test("filters on a current state that is not a resolved one when asked", async () => {
    /*
     * The filter is expressed against the alert's CURRENT state rather than a
     * flag on the alert, which is why it nests. A flat `isResolvedState:
     * false` would be a field the alert does not have and would filter
     * nothing.
     */
    await fetchAlerts("project-1", { unresolvedOnly: true });

    expect(lastBody()["query"]).toEqual({
      currentAlertState: { isResolvedState: false },
    });
  });

  test("does not filter when the caller explicitly wants resolved alerts too", async () => {
    await fetchAlerts("project-1", { unresolvedOnly: false });

    expect(lastBody()["query"]).toEqual({});
  });

  test("sorts newest first, which is the order the list renders in", async () => {
    await fetchAlerts("project-1");

    expect(lastBody()["sort"]).toEqual({ createdAt: "DESC" });
  });

  test("selects the fields an alert row is drawn from", async () => {
    await fetchAlerts("project-1");

    expect(lastSelect()).toMatchObject({
      _id: true,
      title: true,
      alertNumber: true,
      alertNumberWithPrefix: true,
      description: true,
      rootCause: true,
      createdAt: true,
    });
  });

  test("selects the colour of the state and severity, not just their names", async () => {
    /*
     * The state pill and the severity badge are coloured from these. Selecting
     * only `name` leaves `color` undefined and the badges render as untinted
     * text - a change nothing else in the app would complain about.
     */
    await fetchAlerts("project-1");

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

  test("selects the monitor that raised the alert", async () => {
    await fetchAlerts("project-1");

    expect(lastSelect()["monitor"]).toEqual({ _id: true, name: true });
  });

  test("answers with the whole envelope, not just the rows", async () => {
    /*
     * The list pages off `count` and `skip`; handing back only `data` would
     * leave it unable to tell "twenty rows, that is all of them" from "twenty
     * rows, page one of nine".
     */
    respondWith<AlertItem>(
      makeListResponse<AlertItem>([makeAlert()], {
        count: 57,
        skip: 20,
        limit: 20,
      }),
    );

    const response: ListResponse<AlertItem> = await fetchAlerts("project-1", {
      skip: 20,
    });

    expect(response.count).toBe(57);
    expect(response.skip).toBe(20);
    expect(response.data).toHaveLength(1);
    expect(response.data[0]!._id).toBe("alert-1");
  });

  test("propagates a failed request rather than reporting an empty project", async () => {
    /*
     * A rejection here is how the screen learns to offer "retry", or - for the
     * 406 the client turns into an SSO prompt - "authenticate". Swallowing it
     * into an empty list would tell an on-call responder that nothing is
     * firing.
     */
    postMock().mockRejectedValue(new Error("Network Error") as never);

    await expect(fetchAlerts("project-1")).rejects.toThrow("Network Error");
  });
});

describe("fetchAllAlerts", () => {
  test("declares itself a multi-tenant query", async () => {
    await fetchAllAlerts();

    expect(lastHeaders()["is-multi-tenant-query"]).toBe("true");
  });

  test("names no project at all", async () => {
    /*
     * This is the load-bearing half. A tenantid here - even the project the
     * responder happens to have open - silently narrows the "all projects"
     * screen to one project, and the screen has no way to notice.
     */
    await fetchAllAlerts();

    expect(lastHeaders()).not.toHaveProperty("tenantid");
  });

  test("asks for a hundred rows by default, unlike the per-project list", async () => {
    await fetchAllAlerts();

    expect(lastUrl()).toBe("/api/alert/get-list?skip=0&limit=100");
  });

  test("carries the caller's skip and limit into the query string", async () => {
    await fetchAllAlerts({ skip: 100, limit: 25 });

    expect(lastUrl()).toBe("/api/alert/get-list?skip=100&limit=25");
  });

  test("asks for every alert when no filter was requested", async () => {
    await fetchAllAlerts();

    expect(lastBody()["query"]).toEqual({});
  });

  test("filters on a current state that is not a resolved one when asked", async () => {
    await fetchAllAlerts({ unresolvedOnly: true });

    expect(lastBody()["query"]).toEqual({
      currentAlertState: { isResolvedState: false },
    });
  });

  test("selects the project id each row belongs to", async () => {
    /*
     * The per-project fetch can infer the project from the request it made;
     * this one cannot. Without `projectId` on the row, a cross-project list
     * has nothing to group by and no project to open the alert against when
     * the responder taps it.
     */
    await fetchAllAlerts();

    expect(lastSelect()["projectId"]).toBe(true);
  });

  test("selects the same row fields the per-project list does", async () => {
    await fetchAllAlerts();

    expect(lastSelect()).toMatchObject({
      _id: true,
      title: true,
      alertNumberWithPrefix: true,
      description: true,
      createdAt: true,
    });
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

  test("sorts newest first across every project", async () => {
    await fetchAllAlerts();

    expect(lastBody()["sort"]).toEqual({ createdAt: "DESC" });
  });

  test("answers with the whole envelope so a count can be read without the rows", async () => {
    /*
     * The unresolved badge asks for a single row and reads `count`. If this
     * returned `data` instead of the envelope, that badge would read one - or
     * nothing - no matter how many alerts were open.
     */
    respondWith<AlertItem>(
      makeListResponse<AlertItem>([makeAlert({ projectId: "project-2" })], {
        count: 12,
        limit: 1,
      }),
    );

    const response: ListResponse<AlertItem> = await fetchAllAlerts({
      limit: 1,
      unresolvedOnly: true,
    });

    expect(response.count).toBe(12);
    expect(response.data[0]!.projectId).toBe("project-2");
  });
});

describe("fetchAlertById", () => {
  test("scopes the lookup to the project the alert belongs to", async () => {
    respondWith<AlertItem>(makeListResponse<AlertItem>([makeAlert()]));

    await fetchAlertById("project-1", "alert-1");

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("asks for a single row", async () => {
    respondWith<AlertItem>(makeListResponse<AlertItem>([makeAlert()]));

    await fetchAlertById("project-1", "alert-1");

    expect(lastUrl()).toBe("/api/alert/get-list?skip=0&limit=1");
  });

  test("queries by the alert id it was given", async () => {
    respondWith<AlertItem>(makeListResponse<AlertItem>([makeAlert()]));

    await fetchAlertById("project-1", "alert-9");

    expect(lastBody()["query"]).toEqual({ _id: "alert-9" });
  });

  test("selects the detail-screen fields, root cause included", async () => {
    /*
     * The detail screen shows the root cause and the description in full,
     * which the list rows only truncate; dropping either from the select is a
     * detail screen with an empty body.
     */
    respondWith<AlertItem>(makeListResponse<AlertItem>([makeAlert()]));

    await fetchAlertById("project-1", "alert-1");

    expect(lastSelect()).toMatchObject({
      _id: true,
      title: true,
      alertNumberWithPrefix: true,
      description: true,
      rootCause: true,
      createdAt: true,
    });
    expect(lastSelect()["currentAlertState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("hands back the row itself, not the envelope around it", async () => {
    respondWith<AlertItem>(
      makeListResponse<AlertItem>([
        makeAlert({ _id: "alert-9", title: "Disk almost full" }),
      ]),
    );

    const alert: AlertItem | null = await fetchAlertById(
      "project-1",
      "alert-9",
    );

    expect(alert?.title).toBe("Disk almost full");
  });

  test("resolves instead of throwing when no such alert comes back", async () => {
    /*
     * An empty list is the ordinary answer for an alert that was deleted, or
     * that belongs to a project this responder has lost access to. Reading
     * `[0]` off an empty array yields nothing rather than raising, so the
     * caller - not this function - is what has to notice. Worth pinning: a
     * refactor that indexed into `response.data` instead would throw here and
     * take the detail screen down with it.
     */
    respondWith<AlertItem>(makeListResponse<AlertItem>([]));

    await expect(fetchAlertById("project-1", "gone")).resolves.toBeNull();
  });

  test("answers a missing alert with null rather than with undefined", async () => {
    /*
     * The distinction is the whole reason this function ends in `?? null`.
     * react-query v5 caches `null` as ordinary data but REFUSES `undefined`,
     * rejecting the query with a synthetic "data is undefined" error - so an
     * alert that was merely deleted would reach AlertDetailScreen looking like
     * a 502, and the screen would have to sniff a library's error text to tell
     * the two apart. `toBeNull` passes only for null, which is what pins it.
     */
    respondWith<AlertItem>(makeListResponse<AlertItem>([]));

    const alert: AlertItem | null = await fetchAlertById("project-1", "gone");

    expect(alert).toBeNull();
    expect(alert).not.toBeUndefined();
  });
});

describe("fetchAlertStates", () => {
  test("scopes the states to the project, whose workflow they belong to", async () => {
    /*
     * Alert states are per-project: one project's "Acknowledged" is a
     * different row from another's. Fetching them under the wrong tenant would
     * offer the responder a state the alert cannot be moved to.
     */
    respondWith<AlertState>(makeListResponse<AlertState>([makeAlertState()]));

    await fetchAlertStates("project-1");

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("asks the alert-state endpoint, not the alert one", async () => {
    respondWith<AlertState>(makeListResponse<AlertState>([makeAlertState()]));

    await fetchAlertStates("project-1");

    expect(lastUrl()).toBe("/api/alert-state/get-list?skip=0&limit=20");
  });

  test("selects the three flags the action buttons are decided by", async () => {
    /*
     * "Acknowledge" and "Resolve" are not state names - they are whichever
     * state carries isAcknowledgedState or isResolvedState. Without these the
     * detail screen cannot tell which state either button should move the
     * alert to.
     */
    respondWith<AlertState>(makeListResponse<AlertState>([makeAlertState()]));

    await fetchAlertStates("project-1");

    expect(lastSelect()).toMatchObject({
      _id: true,
      name: true,
      color: true,
      isResolvedState: true,
      isAcknowledgedState: true,
      isCreatedState: true,
      order: true,
    });
  });

  test("sorts by the workflow order, ascending", async () => {
    /*
     * Created before Acknowledged before Resolved. Sorting these newest-first
     * like the alert lists would present the workflow backwards.
     */
    respondWith<AlertState>(makeListResponse<AlertState>([makeAlertState()]));

    await fetchAlertStates("project-1");

    expect(lastBody()["sort"]).toEqual({ order: "ASC" });
  });

  test("asks for no filtering, since every state is a candidate", async () => {
    respondWith<AlertState>(makeListResponse<AlertState>([makeAlertState()]));

    await fetchAlertStates("project-1");

    expect(lastBody()["query"]).toEqual({});
  });

  test("hands back the rows rather than the envelope", async () => {
    respondWith<AlertState>(
      makeListResponse<AlertState>([
        makeAlertState({ _id: "state-created", name: "Created" }),
        makeAlertState({
          _id: "state-resolved",
          name: "Resolved",
          isResolvedState: true,
          isCreatedState: false,
          order: 3,
        }),
      ]),
    );

    const states: AlertState[] = await fetchAlertStates("project-1");

    expect(states).toHaveLength(2);
    expect(states[1]!.isResolvedState).toBe(true);
  });

  test("a project with no states yields an empty array, not undefined", async () => {
    /*
     * The state picker maps over this the moment it renders, so anything other
     * than an array here is a crash rather than an empty picker.
     */
    respondWith<AlertState>(makeListResponse<AlertState>([]));

    const states: AlertState[] = await fetchAlertStates("project-1");

    expect(states).toEqual([]);
  });
});

describe("fetchAlertStateTimeline", () => {
  test("scopes the timeline to the project", async () => {
    respondWith<StateTimelineItem>(
      makeListResponse<StateTimelineItem>([makeStateTimelineItem()]),
    );

    await fetchAlertStateTimeline("project-1", "alert-1");

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("asks the alert-state-timeline endpoint for fifty entries", async () => {
    respondWith<StateTimelineItem>(
      makeListResponse<StateTimelineItem>([makeStateTimelineItem()]),
    );

    await fetchAlertStateTimeline("project-1", "alert-1");

    expect(lastUrl()).toBe(
      "/api/alert-state-timeline/get-list?skip=0&limit=50",
    );
  });

  test("queries the timeline of the alert it was given", async () => {
    /*
     * `alertId`, not `_id`: the rows are timeline entries, so filtering by
     * `_id` would ask for one entry by its own id and return nothing.
     */
    respondWith<StateTimelineItem>(
      makeListResponse<StateTimelineItem>([makeStateTimelineItem()]),
    );

    await fetchAlertStateTimeline("project-1", "alert-7");

    expect(lastBody()["query"]).toEqual({ alertId: "alert-7" });
  });

  test("selects the alert state on each entry, coloured", async () => {
    /*
     * StateTimelineItem carries an optional `incidentState` and an optional
     * `alertState`, and the incident module's near-identical function selects
     * the other one. Selecting `incidentState` here would compile, return
     * rows, and render a timeline of blank entries.
     */
    respondWith<StateTimelineItem>(
      makeListResponse<StateTimelineItem>([makeStateTimelineItem()]),
    );

    await fetchAlertStateTimeline("project-1", "alert-1");

    expect(lastSelect()["alertState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
    expect(lastSelect()).not.toHaveProperty("incidentState");
  });

  test("selects when each entry happened", async () => {
    respondWith<StateTimelineItem>(
      makeListResponse<StateTimelineItem>([makeStateTimelineItem()]),
    );

    await fetchAlertStateTimeline("project-1", "alert-1");

    expect(lastSelect()["createdAt"]).toBe(true);
  });

  test("sorts the most recent transition first", async () => {
    respondWith<StateTimelineItem>(
      makeListResponse<StateTimelineItem>([makeStateTimelineItem()]),
    );

    await fetchAlertStateTimeline("project-1", "alert-1");

    expect(lastBody()["sort"]).toEqual({ createdAt: "DESC" });
  });

  test("hands back the rows rather than the envelope", async () => {
    respondWith<StateTimelineItem>(
      makeListResponse<StateTimelineItem>([
        makeStateTimelineItem({
          _id: "timeline-2",
          alertState: makeNamedEntityWithColor({ name: "Acknowledged" }),
        }),
      ]),
    );

    const timeline: StateTimelineItem[] = await fetchAlertStateTimeline(
      "project-1",
      "alert-1",
    );

    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.alertState?.name).toBe("Acknowledged");
  });

  test("an alert with no recorded transitions yields an empty array", async () => {
    respondWith<StateTimelineItem>(makeListResponse<StateTimelineItem>([]));

    const timeline: StateTimelineItem[] = await fetchAlertStateTimeline(
      "project-1",
      "alert-1",
    );

    expect(timeline).toEqual([]);
  });
});

describe("fetchAlertFeed", () => {
  test("scopes the feed to the project", async () => {
    respondWith<FeedItem>(makeListResponse<FeedItem>([makeFeedItem()]));

    await fetchAlertFeed("project-1", "alert-1");

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("asks the alert-feed endpoint for fifty entries", async () => {
    respondWith<FeedItem>(makeListResponse<FeedItem>([makeFeedItem()]));

    await fetchAlertFeed("project-1", "alert-1");

    expect(lastUrl()).toBe("/api/alert-feed/get-list?skip=0&limit=50");
  });

  test("queries the feed of the alert it was given", async () => {
    respondWith<FeedItem>(makeListResponse<FeedItem>([makeFeedItem()]));

    await fetchAlertFeed("project-1", "alert-7");

    expect(lastBody()["query"]).toEqual({ alertId: "alert-7" });
  });

  test("selects both the summary markdown and the expandable detail", async () => {
    /*
     * `feedInfoInMarkdown` is the line the feed shows; the "more information"
     * is what an entry expands into. Dropping the second one leaves entries
     * that look expandable and expand into nothing.
     */
    respondWith<FeedItem>(makeListResponse<FeedItem>([makeFeedItem()]));

    await fetchAlertFeed("project-1", "alert-1");

    expect(lastSelect()).toMatchObject({
      _id: true,
      feedInfoInMarkdown: true,
      moreInformationInMarkdown: true,
      displayColor: true,
      postedAt: true,
      createdAt: true,
    });
  });

  test("sorts by when an entry was posted, not when the row was written", async () => {
    /*
     * Feed entries are posted for events, and an entry written late about an
     * earlier event would jump to the top under a createdAt sort - putting the
     * story of the alert out of order at exactly the moment somebody is
     * reading it to work out what happened.
     */
    respondWith<FeedItem>(makeListResponse<FeedItem>([makeFeedItem()]));

    await fetchAlertFeed("project-1", "alert-1");

    expect(lastBody()["sort"]).toEqual({ postedAt: "DESC" });
  });

  test("hands back the rows rather than the envelope", async () => {
    respondWith<FeedItem>(
      makeListResponse<FeedItem>([
        makeFeedItem({ feedInfoInMarkdown: "**Acknowledged** by Ada" }),
      ]),
    );

    const feed: FeedItem[] = await fetchAlertFeed("project-1", "alert-1");

    expect(feed).toHaveLength(1);
    expect(feed[0]!.feedInfoInMarkdown).toBe("**Acknowledged** by Ada");
  });

  test("an alert with no feed entries yields an empty array", async () => {
    respondWith<FeedItem>(makeListResponse<FeedItem>([]));

    const feed: FeedItem[] = await fetchAlertFeed("project-1", "alert-1");

    expect(feed).toEqual([]);
  });
});

describe("changeAlertState", () => {
  beforeEach(() => {
    postMock().mockResolvedValue({ data: {} } as never);
  });

  test("scopes the change to the project the alert belongs to", async () => {
    await changeAlertState("project-1", "alert-1", "state-acknowledged");

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("moves the alert by adding a timeline entry", async () => {
    /*
     * There is no "set state" endpoint. A state change IS a new
     * alert-state-timeline row, which is also why the timeline is complete
     * without anything else writing to it.
     */
    await changeAlertState("project-1", "alert-1", "state-acknowledged");

    expect(lastUrl()).toBe("/api/alert-state-timeline");
  });

  test("names the alert, the new state and the project in the body", async () => {
    /*
     * The project is sent in the body as well as the header: the header scopes
     * the permission check, the body column is what the created row is stored
     * against.
     */
    await changeAlertState("project-1", "alert-1", "state-acknowledged");

    expect(lastBody()["data"]).toEqual({
      alertId: "alert-1",
      alertStateId: "state-acknowledged",
      projectId: "project-1",
    });
  });

  test("does not send a create as a list query", async () => {
    await changeAlertState("project-1", "alert-1", "state-acknowledged");

    expect(lastBody()).not.toHaveProperty("query");
    expect(lastBody()).not.toHaveProperty("select");
  });

  test("resolves with nothing once the server has accepted it", async () => {
    /*
     * The caller refetches the alert afterwards rather than trusting a
     * returned row, so this deliberately answers with nothing to hand back.
     */
    await expect(
      changeAlertState("project-1", "alert-1", "state-resolved"),
    ).resolves.toBeUndefined();
  });

  test("propagates a refused change instead of reporting success", async () => {
    /*
     * The acknowledge button reports success by not throwing. If a rejected
     * request were swallowed here, a responder would be told the page was
     * acknowledged while the escalation kept running.
     */
    postMock().mockRejectedValue(
      new Error("Request failed with status code 400") as never,
    );

    await expect(
      changeAlertState("project-1", "alert-1", "state-acknowledged"),
    ).rejects.toThrow("Request failed with status code 400");
  });
});

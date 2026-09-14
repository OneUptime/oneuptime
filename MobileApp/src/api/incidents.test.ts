import apiClient from "./client";
import {
  changeIncidentState,
  fetchAllIncidents,
  fetchIncidentById,
  fetchIncidentFeed,
  fetchIncidentStateTimeline,
  fetchIncidentStates,
  fetchIncidents,
} from "./incidents";
import {
  makeFeedItem,
  makeIncident,
  makeIncidentState,
  makeListResponse,
  makeStateTimelineItem,
} from "../__tests__/testSupport";
import type {
  FeedItem,
  IncidentItem,
  IncidentState,
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
 * The incident endpoints, examined at the boundary the type system cannot
 * see: the URL, the request body, and above all the headers.
 *
 * Both list functions post to the SAME /api/incident/get-list endpoint with
 * near-identical bodies. The only thing deciding whether the responder sees
 * one project's incidents or every project's is a header. `tenantid` pins the
 * query to a single project; `is-multi-tenant-query: "true"` deliberately
 * spans all of them. Swapping the two fails silently in both directions - a
 * multi-tenant header on a project screen shows another team's incidents, and
 * a tenantid on the cross-project list hides incidents the responder is on
 * call for. An empty page looks exactly like a quiet night, so nobody finds
 * out until the postmortem.
 *
 * The other half is unwrapping. These functions disagree on purpose: the two
 * list fetchers return the whole envelope because their callers page on
 * `count`, the sub-resource fetchers return just the rows, and the by-id
 * fetcher digs a single row out. One `.data` too few or too many is either an
 * immediate crash or a screen that is permanently empty, and both are easy to
 * introduce while editing the neighbouring function.
 */

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

/**
 * Arm the mocked client with one response envelope for the call under test.
 */
function resolveWith(payload: unknown): void {
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

function lastSelect(): Record<string, unknown> {
  return lastBody()["select"] as Record<string, unknown>;
}

/**
 * The headers axios was actually handed, defaulting to an empty object so an
 * assertion about an ABSENT header reads the same whether the wrapper sent no
 * headers at all or sent only the other one.
 */
function lastHeaders(): Record<string, unknown> {
  const config: { headers?: Record<string, unknown> } = lastCall()[2] as {
    headers?: Record<string, unknown>;
  };

  return config.headers ?? {};
}

beforeEach(() => {
  /*
   * A full reset, not just a clear: several tests below arm the client to
   * reject, and an implementation left in place would fail the next test for
   * a reason that has nothing to do with the code it is exercising.
   */
  postSpy().mockReset();
  resolveWith(makeListResponse([]));
});

describe("fetchIncidents", () => {
  test("names the project in a tenantid header so the page cannot carry another project's incidents", async () => {
    await fetchIncidents("project-7");

    expect(lastHeaders()["tenantid"]).toBe("project-7");
  });

  test("does not also declare a multi-tenant query, which would widen the page past the project", async () => {
    await fetchIncidents("project-7");

    expect(lastHeaders()).not.toHaveProperty("is-multi-tenant-query");
  });

  test("asks for the first twenty rows when the caller names no page", async () => {
    await fetchIncidents("project-1");

    expect(lastUrl()).toBe("/api/incident/get-list?skip=0&limit=20");
  });

  test("asks the server for the page the caller named rather than paging in the app", async () => {
    /*
     * The list screen scrolls by re-fetching with a larger skip. If these ever
     * stopped reaching the query string the screen would append the first page
     * to itself forever and never show an older incident.
     */
    await fetchIncidents("project-1", { skip: 40, limit: 10 });

    expect(lastUrl()).toBe("/api/incident/get-list?skip=40&limit=10");
  });

  test("sends an empty query when the caller wants incidents in every state", async () => {
    await fetchIncidents("project-1");

    expect(lastBody()["query"]).toEqual({});
  });

  test("narrows to unresolved incidents in the query, not after the page has been cut", async () => {
    /*
     * The unresolved badge asks for limit: 1 and reads `count`. Filtering
     * anywhere but in the query would count resolved incidents too and put a
     * number on the tab bar that no screen can explain.
     */
    await fetchIncidents("project-1", { unresolvedOnly: true });

    expect(lastBody()["query"]).toEqual({
      currentIncidentState: { isResolvedState: false },
    });
  });

  test("orders the list newest first, which is the order the screen renders", async () => {
    await fetchIncidents("project-1");

    expect(lastBody()["sort"]).toEqual({ createdAt: "DESC" });
  });

  test("selects the state and severity colours the rows are painted with", async () => {
    /*
     * The API returns only what was selected, so a missing nested `color` is
     * not a type error anywhere - it is a severity chip that renders grey on
     * grey for every incident in the list.
     */
    await fetchIncidents("project-1");

    expect(lastSelect()["currentIncidentState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
    expect(lastSelect()["incidentSeverity"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("selects the number and title a responder identifies an incident by", async () => {
    await fetchIncidents("project-1");

    expect(lastSelect()["title"]).toBe(true);
    expect(lastSelect()["incidentNumberWithPrefix"]).toBe(true);
    expect(lastSelect()["monitors"]).toEqual({ _id: true, name: true });
  });

  test("returns the whole envelope, because the caller pages on count", async () => {
    resolveWith(
      makeListResponse([makeIncident()], { count: 137, skip: 40, limit: 10 }),
    );

    const page: ListResponse<IncidentItem> = await fetchIncidents("project-1", {
      skip: 40,
      limit: 10,
    });

    expect(page.count).toBe(137);
    expect(page.skip).toBe(40);
    expect(page.data).toHaveLength(1);
  });

  test("hands back an empty page rather than inventing a row", async () => {
    resolveWith(makeListResponse([], { count: 0 }));

    const page: ListResponse<IncidentItem> = await fetchIncidents("project-1");

    expect(page.data).toEqual([]);
    expect(page.count).toBe(0);
  });

  test("lets a failed request reject instead of reporting an empty page", async () => {
    /*
     * Swallowing this would be the worst possible failure mode for an on-call
     * app: a server that is unreachable would render as a project with no open
     * incidents, which is indistinguishable from good news.
     */
    postSpy().mockRejectedValue(new Error("Network Error") as never);

    await expect(fetchIncidents("project-1")).rejects.toThrow("Network Error");
  });
});

describe("fetchAllIncidents", () => {
  test("declares a multi-tenant query so the list spans every project the responder belongs to", async () => {
    await fetchAllIncidents();

    expect(lastHeaders()["is-multi-tenant-query"]).toBe("true");
  });

  test("sends no tenantid, which would silently pin the cross-project list to one project", async () => {
    /*
     * This is the header pairing that matters. A tenantid here would not
     * error; it would quietly drop every incident belonging to the responder's
     * other projects out of the home screen.
     */
    await fetchAllIncidents();

    expect(lastHeaders()).not.toHaveProperty("tenantid");
  });

  test("reads the same incident list endpoint as the per-project fetch", async () => {
    await fetchAllIncidents();

    expect(lastUrl()).toBe("/api/incident/get-list?skip=0&limit=100");
  });

  test("asks for a hundred rows by default, since one page has to cover every project", async () => {
    await fetchAllIncidents();

    expect(lastUrl()).toContain("limit=100");
  });

  test("honours the page the caller named", async () => {
    await fetchAllIncidents({ skip: 100, limit: 50 });

    expect(lastUrl()).toBe("/api/incident/get-list?skip=100&limit=50");
  });

  test("selects projectId, without which a row cannot be attributed to a project", async () => {
    /*
     * The per-project list does not need this - the caller already knows whose
     * incidents it asked for. Here the rows arrive interleaved from several
     * projects, and projectId is the only thing that tells them apart.
     */
    await fetchAllIncidents();

    expect(lastSelect()["projectId"]).toBe(true);
  });

  test("narrows to unresolved incidents when asked", async () => {
    await fetchAllIncidents({ unresolvedOnly: true });

    expect(lastBody()["query"]).toEqual({
      currentIncidentState: { isResolvedState: false },
    });
  });

  test("sends an empty query otherwise, so resolved incidents are not excluded by accident", async () => {
    await fetchAllIncidents();

    expect(lastBody()["query"]).toEqual({});
  });

  test("returns the envelope, so a count survives being asked for with a limit of one", async () => {
    /*
     * The home screen's unresolved badge fetches a single row purely to read
     * `count`. Returning the rows here instead of the envelope would leave it
     * counting the page, and it would read "1" no matter how bad the night is.
     */
    resolveWith(makeListResponse([makeIncident()], { count: 42, limit: 1 }));

    const page: ListResponse<IncidentItem> = await fetchAllIncidents({
      limit: 1,
      unresolvedOnly: true,
    });

    expect(page.count).toBe(42);
  });

  test("hands back an empty page when the responder has no incidents in any project", async () => {
    resolveWith(makeListResponse([], { count: 0 }));

    const page: ListResponse<IncidentItem> = await fetchAllIncidents();

    expect(page.data).toEqual([]);
    expect(page.count).toBe(0);
  });
});

describe("fetchIncidentById", () => {
  test("asks for the single row matching the id", async () => {
    resolveWith(makeListResponse([makeIncident()]));

    await fetchIncidentById("project-1", "incident-9");

    expect(lastUrl()).toBe("/api/incident/get-list?skip=0&limit=1");
    expect(lastBody()["query"]).toEqual({ _id: "incident-9" });
  });

  test("names the project in the tenantid header", async () => {
    resolveWith(makeListResponse([makeIncident()]));

    await fetchIncidentById("project-7", "incident-9");

    expect(lastHeaders()["tenantid"]).toBe("project-7");
    expect(lastHeaders()).not.toHaveProperty("is-multi-tenant-query");
  });

  test("selects the fields only the detail screen shows, beyond what the list needs", async () => {
    /*
     * The detail screen renders the root cause card and the declared-at row.
     * Neither is in a list row, so both have to be asked for here or the
     * screen shows an incident with an empty explanation of itself.
     */
    resolveWith(makeListResponse([makeIncident()]));

    await fetchIncidentById("project-1", "incident-9");

    expect(lastSelect()["rootCause"]).toBe(true);
    expect(lastSelect()["declaredAt"]).toBe(true);
    expect(lastSelect()["description"]).toBe(true);
  });

  test("unwraps the one incident out of the list envelope", async () => {
    resolveWith(
      makeListResponse([
        makeIncident({ _id: "incident-9", title: "Payments" }),
      ]),
    );

    const incident: IncidentItem | null = await fetchIncidentById(
      "project-1",
      "incident-9",
    );

    expect(incident?._id).toBe("incident-9");
    expect(incident?.title).toBe("Payments");
  });

  test("resolves without an incident when nothing matches the id", async () => {
    /*
     * A deleted incident, or one in a project the responder has lost access
     * to, comes back as an empty list rather than a 404. What matters here is
     * that the lookup settles instead of throwing while reaching into the
     * empty array - the caller is a react-query fetcher, and a throw would put
     * the detail screen into an error state for a routine race.
     */
    resolveWith(makeListResponse([], { count: 0 }));

    await expect(
      fetchIncidentById("project-1", "incident-9"),
    ).resolves.toBeNull();
  });

  test("reports the missing incident as null, never as undefined", async () => {
    /*
     * `?? null` at the end of the fetcher is load-bearing. react-query v5
     * caches `null` as settled data but rejects `undefined`, manufacturing a
     * "data is undefined" error - which would deliver a deleted incident to
     * IncidentDetailScreen dressed as a failed request, retry button and all.
     * `toBeNull` is what separates the two, since `undefined` would not pass
     * it.
     */
    resolveWith(makeListResponse([], { count: 0 }));

    const incident: IncidentItem | null = await fetchIncidentById(
      "project-1",
      "incident-9",
    );

    expect(incident).toBeNull();
    expect(incident).not.toBeUndefined();
  });
});

describe("fetchIncidentStates", () => {
  test("reads the states of the project named in the tenantid header", async () => {
    await fetchIncidentStates("project-7");

    expect(lastUrl()).toBe("/api/incident-state/get-list?skip=0&limit=20");
    expect(lastHeaders()["tenantid"]).toBe("project-7");
  });

  test("asks for every state, with no filter of its own", async () => {
    await fetchIncidentStates("project-1");

    expect(lastBody()["query"]).toEqual({});
  });

  test("orders the states by the workflow order rather than by name or age", async () => {
    /*
     * These populate the "change state" picker, and a responder reads it as a
     * progression - created, acknowledged, resolved. Sorted any other way the
     * picker still works and still looks wrong at 3am.
     */
    await fetchIncidentStates("project-1");

    expect(lastBody()["sort"]).toEqual({ order: "ASC" });
  });

  test("selects the flags the UI branches on to tell the states apart", async () => {
    /*
     * The app does not match on the state's NAME - projects rename these - it
     * asks whether the state is the resolved one. Dropping these booleans
     * would leave every state looking alike to the code.
     */
    await fetchIncidentStates("project-1");

    expect(lastSelect()["isResolvedState"]).toBe(true);
    expect(lastSelect()["isAcknowledgedState"]).toBe(true);
    expect(lastSelect()["isCreatedState"]).toBe(true);
    expect(lastSelect()["order"]).toBe(true);
  });

  test("returns the rows themselves, not the envelope around them", async () => {
    resolveWith(
      makeListResponse([
        makeIncidentState({ _id: "state-created", name: "Created" }),
        makeIncidentState({ _id: "state-resolved", name: "Resolved" }),
      ]),
    );

    const states: IncidentState[] = await fetchIncidentStates("project-1");

    expect(states).toHaveLength(2);
    expect(states[0].name).toBe("Created");
  });

  test("returns an empty list for a project with no states configured", async () => {
    resolveWith(makeListResponse([], { count: 0 }));

    expect(await fetchIncidentStates("project-1")).toEqual([]);
  });
});

describe("fetchIncidentStateTimeline", () => {
  test("scopes the timeline to the one incident being viewed", async () => {
    await fetchIncidentStateTimeline("project-1", "incident-9");

    expect(lastUrl()).toBe(
      "/api/incident-state-timeline/get-list?skip=0&limit=50",
    );
    expect(lastBody()["query"]).toEqual({ incidentId: "incident-9" });
  });

  test("carries the project's tenantid", async () => {
    await fetchIncidentStateTimeline("project-7", "incident-9");

    expect(lastHeaders()["tenantid"]).toBe("project-7");
    expect(lastHeaders()).not.toHaveProperty("is-multi-tenant-query");
  });

  test("puts the most recent state change first", async () => {
    /*
     * The detail screen reads the head of this list as "where the incident
     * stands now". Sorted the other way it would present the state the
     * incident was created in as its current one.
     */
    await fetchIncidentStateTimeline("project-1", "incident-9");

    expect(lastBody()["sort"]).toEqual({ createdAt: "DESC" });
  });

  test("selects the state's name and colour, which is all the row shows", async () => {
    await fetchIncidentStateTimeline("project-1", "incident-9");

    expect(lastSelect()["incidentState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
    expect(lastSelect()["createdAt"]).toBe(true);
  });

  test("returns the entries rather than the envelope", async () => {
    resolveWith(
      makeListResponse([
        makeStateTimelineItem({ _id: "timeline-2" }),
        makeStateTimelineItem({ _id: "timeline-1" }),
      ]),
    );

    const timeline: StateTimelineItem[] = await fetchIncidentStateTimeline(
      "project-1",
      "incident-9",
    );

    expect(timeline).toHaveLength(2);
    expect(timeline[0]._id).toBe("timeline-2");
  });

  test("returns an empty timeline rather than the envelope when there are no entries", async () => {
    resolveWith(makeListResponse([], { count: 0 }));

    expect(await fetchIncidentStateTimeline("project-1", "incident-9")).toEqual(
      [],
    );
  });
});

describe("fetchIncidentFeed", () => {
  test("scopes the feed to the one incident, in its own project", async () => {
    await fetchIncidentFeed("project-7", "incident-9");

    expect(lastUrl()).toBe("/api/incident-feed/get-list?skip=0&limit=50");
    expect(lastBody()["query"]).toEqual({ incidentId: "incident-9" });
    expect(lastHeaders()["tenantid"]).toBe("project-7");
  });

  test("sorts on postedAt, which is when the entry happened rather than when it was stored", async () => {
    /*
     * Feed entries are written by workers that can lag, so createdAt is the
     * time the row reached the database. Ordering on it would interleave a
     * late-written acknowledgement ahead of the resolution that followed it.
     */
    await fetchIncidentFeed("project-1", "incident-9");

    expect(lastBody()["sort"]).toEqual({ postedAt: "DESC" });
  });

  test("selects the expandable detail and the colour the timeline paints each entry with", async () => {
    /*
     * The feed row falls back from postedAt to createdAt and hides its
     * "more information" section when that field is missing, so an entry
     * dropped from the select degrades quietly into a bare line of text.
     */
    await fetchIncidentFeed("project-1", "incident-9");

    expect(lastSelect()["feedInfoInMarkdown"]).toBe(true);
    expect(lastSelect()["moreInformationInMarkdown"]).toBe(true);
    expect(lastSelect()["displayColor"]).toBe(true);
    expect(lastSelect()["postedAt"]).toBe(true);
    expect(lastSelect()["createdAt"]).toBe(true);
  });

  test("returns the entries rather than the envelope", async () => {
    resolveWith(
      makeListResponse([
        makeFeedItem({ _id: "feed-2", feedInfoInMarkdown: "**Resolved**" }),
        makeFeedItem({ _id: "feed-1" }),
      ]),
    );

    const feed: FeedItem[] = await fetchIncidentFeed("project-1", "incident-9");

    expect(feed).toHaveLength(2);
    expect(feed[0].feedInfoInMarkdown).toBe("**Resolved**");
  });

  test("returns an empty feed for an incident nothing has happened to yet", async () => {
    resolveWith(makeListResponse([], { count: 0 }));

    expect(await fetchIncidentFeed("project-1", "incident-9")).toEqual([]);
  });
});

describe("changeIncidentState", () => {
  beforeEach(() => {
    resolveWith({});
  });

  test("records the change by appending to the incident's state timeline", async () => {
    /*
     * There is no "update the incident" call for this: the timeline entry IS
     * the state change, and the server derives currentIncidentState from it.
     */
    await changeIncidentState("project-1", "incident-9", "state-acknowledged");

    expect(lastUrl()).toBe("/api/incident-state-timeline");
  });

  test("names the incident and the state it is moving to", async () => {
    await changeIncidentState("project-1", "incident-9", "state-acknowledged");

    expect(lastBody()["data"]).toEqual({
      incidentId: "incident-9",
      incidentStateId: "state-acknowledged",
      projectId: "project-1",
    });
  });

  test("carries the project's tenantid, so the write lands in the right project", async () => {
    /*
     * This is the one write among these calls. A missing or wrong tenantid on
     * a read shows the wrong rows; here it would either be refused or record
     * an acknowledgement against somebody else's incident.
     */
    await changeIncidentState("project-7", "incident-9", "state-acknowledged");

    expect(lastHeaders()["tenantid"]).toBe("project-7");
    expect(lastHeaders()).not.toHaveProperty("is-multi-tenant-query");
  });

  test("propagates a rejected change rather than resolving as though it took", async () => {
    /*
     * The screens await this and then tell the responder the incident is
     * acknowledged. If a failure resolved quietly, the escalation would keep
     * running against somebody who has been told they stopped it.
     */
    postSpy().mockRejectedValue(new Error("Request failed") as never);

    await expect(
      changeIncidentState("project-1", "incident-9", "state-acknowledged"),
    ).rejects.toThrow("Request failed");
  });
});

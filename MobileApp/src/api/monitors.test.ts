import apiClient from "./client";
import {
  fetchDisabledMonitorCount,
  fetchInoperationalMonitorCount,
  fetchMonitorById,
  fetchMonitorCount,
  fetchMonitorFeed,
  fetchMonitorProbes,
  fetchMonitorStatusTimeline,
  fetchMonitorStatuses,
  fetchMonitors,
  type MonitorProbeItem,
  type MonitorStatusTimelineItem,
} from "./monitors";
import {
  makeColor,
  makeFeedItem,
  makeListResponse,
  makeMonitor,
  makeMonitorStatus,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import type {
  FeedItem,
  ListResponse,
  MonitorItem,
  MonitorStatusItem,
} from "./types";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("./client", () => {
  return { __esModule: true, default: { post: jest.fn() } };
});

/*
 * Every function in src/api/monitors.ts is a description of one HTTP request,
 * and nothing in the type system checks the parts that matter. The URL's
 * skip/limit pair, the tenantid header and the shape that comes back out are
 * all plain strings and `any`-typed axios data, so the compiler is equally
 * happy with a request that reads the wrong project's monitors or a return
 * value that hands the caller rows where it expected the envelope.
 *
 * Two failure modes drive most of what is asserted here.
 *
 * The first is tenancy. Monitors are project-scoped, and this app is used by
 * responders who belong to several projects at once - the monitors list is
 * assembled by fanning one request out per project (see
 * src/hooks/useAllProjectMonitors.ts). Each of those requests must name its
 * project in a `tenantid` header and must NOT set the `is-multi-tenant-query`
 * header that other endpoints use to span every project. Getting that wrong is
 * invisible in review: with the multi-tenant flag the responder sees another
 * project's monitors listed under this one, and with the wrong tenantid they
 * see none of their own.
 *
 * The second is the response envelope. Every list endpoint answers with
 * { data, count, skip, limit }, and these functions deliberately disagree
 * about how much of it to return - the list and the three counts return the
 * envelope, everything else returns `response.data.data`, and the by-id fetch
 * returns a single row out of it. The counts are the sharp edge: they ask for
 * limit=1 and read `count` off the envelope, so a "simplification" that
 * returned the rows instead would still typecheck against a caller doing
 * `data?.count ?? 0` and would quietly render 0 monitors on the Home screen
 * for a project that has hundreds.
 */

const PROJECT_ID: string = "project-1";
const MONITOR_ID: string = "monitor-1";

const postMock: jest.Mock = apiClient.post as unknown as jest.Mock;

interface RequestConfig {
  headers?: Record<string, string>;
}

/**
 * Make the shared client answer with `payload` as the axios response body.
 */
function respondWith(payload: unknown): void {
  postMock.mockResolvedValue({ data: payload });
}

/*
 * jest.config.js sets clearMocks, so each test sees only its own call and
 * reading call 0 is unambiguous.
 */
function requestUrl(): string {
  return postMock.mock.calls[0]![0] as string;
}

function requestBody(): Record<string, unknown> {
  return postMock.mock.calls[0]![1] as Record<string, unknown>;
}

function requestQuery(): Record<string, unknown> {
  return requestBody()["query"] as Record<string, unknown>;
}

function requestSelect(): Record<string, unknown> {
  return requestBody()["select"] as Record<string, unknown>;
}

function requestSort(): Record<string, unknown> {
  return requestBody()["sort"] as Record<string, unknown>;
}

function requestHeaders(): Record<string, string> {
  const config: RequestConfig | undefined = postMock.mock.calls[0]![2] as
    | RequestConfig
    | undefined;

  return config?.headers ?? {};
}

describe("fetchMonitors", () => {
  beforeEach(() => {
    respondWith(makeListResponse([makeMonitor()]));
  });

  test("asks the monitor list endpoint for the first hundred rows when the caller does not paginate", async () => {
    /*
     * The default page size is part of the contract with
     * useAllProjectMonitors, which shows the whole list without an infinite
     * scroll: shrink this and monitors silently vanish off the end of the
     * screen with nothing to tell the responder there are more.
     */
    await fetchMonitors(PROJECT_ID);

    expect(requestUrl()).toBe("/api/monitor/get-list?skip=0&limit=100");
  });

  test("puts the caller's own skip and limit in the query string", async () => {
    await fetchMonitors(PROJECT_ID, { skip: 100, limit: 25 });

    expect(requestUrl()).toBe("/api/monitor/get-list?skip=100&limit=25");
  });

  test("keeps the default limit when the caller only moves the skip", async () => {
    /*
     * skip and limit default independently. A single `options = { skip: 0,
     * limit: 100 }` default parameter would look equivalent and would reset
     * the limit to undefined for this call, so a page request would fetch
     * whatever the server's own default happens to be.
     */
    await fetchMonitors(PROJECT_ID, { skip: 300 });

    expect(requestUrl()).toBe("/api/monitor/get-list?skip=300&limit=100");
  });

  test("keeps a skip of zero when the caller only shrinks the limit", async () => {
    await fetchMonitors(PROJECT_ID, { limit: 5 });

    expect(requestUrl()).toBe("/api/monitor/get-list?skip=0&limit=5");
  });

  test("names the project in a tenantid header and nothing else", async () => {
    await fetchMonitors(PROJECT_ID);

    expect(requestHeaders()).toEqual({ tenantid: PROJECT_ID });
  });

  test("never asks the server to span every project the responder belongs to", async () => {
    /*
     * Spelled out separately from the header equality above because this is
     * the mistake worth catching by name. The monitors screen covers several
     * projects by issuing one tenanted request each and tagging the rows with
     * the project they came from; a single is-multi-tenant-query request would
     * return the same rows untagged, and every monitor would end up attributed
     * to whichever project happened to be first.
     */
    await fetchMonitors(PROJECT_ID);

    expect(requestHeaders()["is-multi-tenant-query"]).toBeUndefined();
  });

  test("sends an empty query so disabled monitors are listed too", async () => {
    /*
     * The list is meant to be everything in the project. Disabled monitors are
     * fetched and badged rather than filtered out server-side - a responder
     * needs to see that a monitor is not being checked at all.
     */
    await fetchMonitors(PROJECT_ID);

    expect(requestQuery()).toEqual({});
  });

  test("sorts the newest monitor first", async () => {
    await fetchMonitors(PROJECT_ID);

    expect(requestSort()).toEqual({ createdAt: "DESC" });
  });

  test("selects the current status together with its colour", async () => {
    /*
     * The list row paints a status pill from currentMonitorStatus.color. Ask
     * for the relation without its color and the pill falls back to a neutral
     * grey for every monitor - the list still renders, so nothing looks
     * broken, and a down monitor stops standing out.
     */
    await fetchMonitors(PROJECT_ID);

    expect(requestSelect()["currentMonitorStatus"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("selects the disabled flag and the owning project id", async () => {
    await fetchMonitors(PROJECT_ID);

    expect(requestSelect()["disableActiveMonitoring"]).toBe(true);
    expect(requestSelect()["projectId"]).toBe(true);
  });

  test("returns the whole envelope rather than just the rows", async () => {
    /*
     * count is what tells the caller whether the hundred rows it asked for are
     * the whole project or the first page of it.
     */
    const monitor: MonitorItem = makeMonitor();
    respondWith(makeListResponse([monitor], { count: 214, limit: 100 }));

    const result: ListResponse<MonitorItem> = await fetchMonitors(PROJECT_ID);

    expect(result.data).toEqual([monitor]);
    expect(result.count).toBe(214);
    expect(result.limit).toBe(100);
  });

  test("returns an empty envelope, not undefined, for a project with no monitors", async () => {
    /*
     * A brand new project is the common case here, and the caller iterates
     * result.data without guarding it.
     */
    respondWith(makeListResponse([]));

    const result: ListResponse<MonitorItem> = await fetchMonitors(PROJECT_ID);

    expect(result.data).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("lets a transport failure reach the caller", async () => {
    /*
     * The screen distinguishes "no monitors" from "we could not ask", so this
     * must reject rather than being swallowed into an empty list.
     */
    postMock.mockRejectedValue(new Error("Network request failed"));

    await expect(fetchMonitors(PROJECT_ID)).rejects.toThrow(
      "Network request failed",
    );
  });
});

describe("fetchMonitorById", () => {
  beforeEach(() => {
    respondWith(makeListResponse([makeMonitor()]));
  });

  test("asks for exactly one row", async () => {
    await fetchMonitorById(PROJECT_ID, MONITOR_ID);

    expect(requestUrl()).toBe("/api/monitor/get-list?skip=0&limit=1");
  });

  test("filters on the monitor id", async () => {
    await fetchMonitorById(PROJECT_ID, MONITOR_ID);

    expect(requestQuery()).toEqual({ _id: MONITOR_ID });
  });

  test("carries the tenantid even though the id already identifies the row", async () => {
    /*
     * The id is the only filter in the body, so the header is the only thing
     * saying which project is being read on behalf of. Drop it and the request
     * is a bare "give me this uuid" - exactly the shape that turns a monitor
     * id pasted from another project into a readable detail screen.
     */
    await fetchMonitorById(PROJECT_ID, MONITOR_ID);

    expect(requestHeaders()).toEqual({ tenantid: PROJECT_ID });
  });

  test("returns the row itself rather than the envelope around it", async () => {
    const monitor: MonitorItem = makeMonitor({ name: "checkout.example.com" });
    respondWith(makeListResponse([monitor]));

    const result: MonitorItem | null = await fetchMonitorById(
      PROJECT_ID,
      MONITOR_ID,
    );

    expect(result).toEqual(monitor);
  });

  test("resolves null when nothing matches the id", async () => {
    /*
     * A deleted monitor, or one the responder cannot see, comes back as an
     * empty list rather than a 404. MonitorDetailScreen renders "Monitor not
     * found." off exactly this, so the empty case has to resolve quietly
     * instead of throwing on data[0].
     */
    respondWith(makeListResponse([]));

    const result: MonitorItem | null = await fetchMonitorById(
      PROJECT_ID,
      MONITOR_ID,
    );

    expect(result).toBeNull();
  });

  test("says the monitor is missing with null, not with undefined", async () => {
    /*
     * `undefined` would be the natural value of `data[0]` on an empty list,
     * and it is the one value react-query v5 will not cache: it rejects the
     * query with a synthetic "data is undefined" error instead, turning a
     * monitor that was simply deleted into an apparent request failure.
     * `toBeNull` fails for `undefined`, which is what keeps the `?? null` in
     * the fetcher from being tidied away.
     */
    respondWith(makeListResponse([]));

    const result: MonitorItem | null = await fetchMonitorById(
      PROJECT_ID,
      MONITOR_ID,
    );

    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });

  test("takes the first row if the server ever answers with more than one", async () => {
    const first: MonitorItem = makeMonitor({ _id: "monitor-1" });
    const second: MonitorItem = makeMonitor({ _id: "monitor-2" });
    respondWith(makeListResponse([first, second]));

    const result: MonitorItem | null = await fetchMonitorById(
      PROJECT_ID,
      MONITOR_ID,
    );

    expect(result?._id).toBe("monitor-1");
  });
});

describe("fetchMonitorStatuses", () => {
  beforeEach(() => {
    respondWith(makeListResponse([makeMonitorStatus()]));
  });

  test("asks the monitor-status endpoint for the project's statuses", async () => {
    await fetchMonitorStatuses(PROJECT_ID);

    expect(requestUrl()).toBe("/api/monitor-status/get-list?skip=0&limit=20");
  });

  test("orders the statuses by ascending priority", async () => {
    /*
     * Priority is the project's own ordering of its states, from operational
     * down to offline. Reverse it and any list built from these comes out
     * upside down, with "Offline" presented as the first-choice status.
     */
    await fetchMonitorStatuses(PROJECT_ID);

    expect(requestSort()).toEqual({ priority: "ASC" });
  });

  test("selects the flags that say what a status means", async () => {
    /*
     * The names are project-defined - one project's healthy state is called
     * "Operational", another's "All good" - so isOperationalState and
     * isOfflineState are the only reliable way to classify a status.
     */
    await fetchMonitorStatuses(PROJECT_ID);

    expect(requestSelect()["isOperationalState"]).toBe(true);
    expect(requestSelect()["isOfflineState"]).toBe(true);
    expect(requestSelect()["color"]).toBe(true);
  });

  test("is scoped to the one project whose statuses these are", async () => {
    /*
     * Statuses are defined per project, so a response gathered across projects
     * would contain several states all called "Operational" with different
     * ids, and matching a monitor to its status would start picking whichever
     * came back first.
     */
    await fetchMonitorStatuses(PROJECT_ID);

    expect(requestHeaders()).toEqual({ tenantid: PROJECT_ID });
  });

  test("returns the rows without the surrounding envelope", async () => {
    const operational: MonitorStatusItem = makeMonitorStatus();
    const offline: MonitorStatusItem = makeMonitorStatus({
      _id: "monitor-status-2",
      name: "Offline",
      color: makeColor(),
      isOperationalState: false,
      isOfflineState: true,
      priority: 2,
    });
    respondWith(makeListResponse([operational, offline]));

    const result: MonitorStatusItem[] = await fetchMonitorStatuses(PROJECT_ID);

    expect(result).toEqual([operational, offline]);
  });

  test("returns an empty array when the project defines no statuses", async () => {
    respondWith(makeListResponse([]));

    const result: MonitorStatusItem[] = await fetchMonitorStatuses(PROJECT_ID);

    expect(result).toEqual([]);
  });
});

describe("fetchMonitorStatusTimeline", () => {
  const timelineEntry: MonitorStatusTimelineItem = {
    _id: "monitor-status-timeline-1",
    createdAt: "2026-08-30T10:00:00.000Z",
    startsAt: "2026-08-30T10:00:00.000Z",
    endsAt: "2026-08-30T10:30:00.000Z",
    monitorStatus: makeNamedEntityWithColor({
      _id: "monitor-status-2",
      name: "Offline",
    }) as MonitorStatusTimelineItem["monitorStatus"],
    rootCause: "Probe reported a connection timeout.",
  };

  beforeEach(() => {
    respondWith(makeListResponse([timelineEntry]));
  });

  test("asks the timeline endpoint for the last fifty entries", async () => {
    await fetchMonitorStatusTimeline(PROJECT_ID, MONITOR_ID);

    expect(requestUrl()).toBe(
      "/api/monitor-status-timeline/get-list?skip=0&limit=50",
    );
  });

  test("filters the timeline down to the one monitor", async () => {
    /*
     * The tenant header alone would return the status history of every
     * monitor in the project, which the detail screen would then render as
     * this monitor's own history of going up and down.
     */
    await fetchMonitorStatusTimeline(PROJECT_ID, MONITOR_ID);

    expect(requestQuery()).toEqual({ monitorId: MONITOR_ID });
  });

  test("puts the most recent status change first", async () => {
    /*
     * With fifty rows and no paging, the sort direction decides whether the
     * responder sees what the monitor is doing now or what it was doing fifty
     * transitions ago - so descending is what is asserted here.
     *
     * The FIELD is deliberately left unpinned. This request currently sorts by
     * createdAt while the row it produces is rendered as
     * `entry.startsAt ?? entry.createdAt` (MonitorDetailScreen), and the web
     * dashboard sorts the same table by startsAt; the two only agree while
     * every row was written at the moment its status began. Pinning createdAt
     * here would turn correcting that into a failing test, so the assertion
     * covers only that exactly one field orders the list, descending.
     */
    await fetchMonitorStatusTimeline(PROJECT_ID, MONITOR_ID);

    expect(Object.values(requestSort())).toEqual(["DESC"]);
  });

  test("selects the window the status was held for and why it changed", async () => {
    await fetchMonitorStatusTimeline(PROJECT_ID, MONITOR_ID);

    expect(requestSelect()["startsAt"]).toBe(true);
    expect(requestSelect()["endsAt"]).toBe(true);
    expect(requestSelect()["rootCause"]).toBe(true);
    expect(requestSelect()["monitorStatus"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("is scoped to the project the monitor belongs to", async () => {
    await fetchMonitorStatusTimeline(PROJECT_ID, MONITOR_ID);

    expect(requestHeaders()).toEqual({ tenantid: PROJECT_ID });
  });

  test("returns the rows without the surrounding envelope", async () => {
    const result: MonitorStatusTimelineItem[] =
      await fetchMonitorStatusTimeline(PROJECT_ID, MONITOR_ID);

    expect(result).toEqual([timelineEntry]);
  });

  test("returns an empty array for a monitor that has never changed status", async () => {
    respondWith(makeListResponse([]));

    const result: MonitorStatusTimelineItem[] =
      await fetchMonitorStatusTimeline(PROJECT_ID, MONITOR_ID);

    expect(result).toEqual([]);
  });
});

describe("fetchMonitorFeed", () => {
  beforeEach(() => {
    respondWith(makeListResponse([makeFeedItem()]));
  });

  test("asks the monitor-feed endpoint for the last fifty entries", async () => {
    await fetchMonitorFeed(PROJECT_ID, MONITOR_ID);

    expect(requestUrl()).toBe("/api/monitor-feed/get-list?skip=0&limit=50");
  });

  test("filters the feed down to the one monitor", async () => {
    await fetchMonitorFeed(PROJECT_ID, MONITOR_ID);

    expect(requestQuery()).toEqual({ monitorId: MONITOR_ID });
  });

  test("orders the feed by when each entry was posted, not when the row was written", async () => {
    /*
     * postedAt is the moment the event happened; createdAt is the moment the
     * server got around to storing it. Anything written after the fact - a
     * backfilled probe result, an entry created while the worker was catching
     * up - lands in the wrong place in the story if the feed is sorted by
     * createdAt, and the responder reads the outage out of order.
     */
    await fetchMonitorFeed(PROJECT_ID, MONITOR_ID);

    expect(requestSort()).toEqual({ postedAt: "DESC" });
  });

  test("selects the expandable detail and the colour each entry is drawn in", async () => {
    await fetchMonitorFeed(PROJECT_ID, MONITOR_ID);

    expect(requestSelect()["feedInfoInMarkdown"]).toBe(true);
    expect(requestSelect()["moreInformationInMarkdown"]).toBe(true);
    expect(requestSelect()["displayColor"]).toBe(true);
    expect(requestSelect()["postedAt"]).toBe(true);
  });

  test("is scoped to the project the monitor belongs to", async () => {
    await fetchMonitorFeed(PROJECT_ID, MONITOR_ID);

    expect(requestHeaders()).toEqual({ tenantid: PROJECT_ID });
  });

  test("returns the rows without the surrounding envelope", async () => {
    const entry: FeedItem = makeFeedItem({
      feedInfoInMarkdown: "**Monitor went offline**",
    });
    respondWith(makeListResponse([entry]));

    const result: FeedItem[] = await fetchMonitorFeed(PROJECT_ID, MONITOR_ID);

    expect(result).toEqual([entry]);
  });

  test("returns an empty array for a monitor with no feed yet", async () => {
    respondWith(makeListResponse([]));

    const result: FeedItem[] = await fetchMonitorFeed(PROJECT_ID, MONITOR_ID);

    expect(result).toEqual([]);
  });
});

describe("fetchMonitorProbes", () => {
  const probe: MonitorProbeItem = {
    _id: "monitor-probe-1",
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
  };

  beforeEach(() => {
    respondWith(makeListResponse([probe]));
  });

  test("asks the monitor-probe endpoint for up to ten probes", async () => {
    /*
     * One card is rendered per probe, so this limit is how many monitoring
     * locations the detail screen can show at once.
     */
    await fetchMonitorProbes(PROJECT_ID, MONITOR_ID);

    expect(requestUrl()).toBe("/api/monitor-probe/get-list?skip=0&limit=10");
  });

  test("filters the probes down to the one monitor", async () => {
    /*
     * A probe row exists per monitor-probe pairing, so without this filter the
     * screen would show the last result of every monitor the probe watches and
     * attribute all of it to this one.
     */
    await fetchMonitorProbes(PROJECT_ID, MONITOR_ID);

    expect(requestQuery()).toEqual({ monitorId: MONITOR_ID });
  });

  test("selects the probe's name and its whole last monitoring log", async () => {
    /*
     * lastMonitoringLog is asked for wholesale rather than field by field: it
     * is keyed by monitor step and its contents differ by monitor type -
     * response code and body for a website, CPU and disk metrics for a server
     * - so naming sub-fields here would silently blank the cards for whichever
     * monitor type was not listed.
     */
    await fetchMonitorProbes(PROJECT_ID, MONITOR_ID);

    expect(requestSelect()["lastMonitoringLog"]).toBe(true);
    expect(requestSelect()["probe"]).toEqual({ _id: true, name: true });
  });

  test("is scoped to the project the monitor belongs to", async () => {
    await fetchMonitorProbes(PROJECT_ID, MONITOR_ID);

    expect(requestHeaders()).toEqual({ tenantid: PROJECT_ID });
  });

  test("returns the rows without the surrounding envelope", async () => {
    const result: MonitorProbeItem[] = await fetchMonitorProbes(
      PROJECT_ID,
      MONITOR_ID,
    );

    expect(result).toEqual([probe]);
  });

  test("returns an empty array for a monitor no probe has reported on", async () => {
    /*
     * True for a monitor that has just been created, and for a manual or
     * incoming-request monitor that no probe ever touches.
     */
    respondWith(makeListResponse([]));

    const result: MonitorProbeItem[] = await fetchMonitorProbes(
      PROJECT_ID,
      MONITOR_ID,
    );

    expect(result).toEqual([]);
  });
});

/*
 * The three counts below feed the tiles on the Home screen, one request per
 * project, summed across projects by src/hooks/useAllProjectCounts.ts. They
 * are the same request three times over with three different queries, and each
 * one is written to be as cheap as possible: limit=1, and only the id
 * selected, because the rows are never looked at. That is exactly what makes
 * them fragile - the single row that does come back is a plausible-looking
 * return value, and a change that returned it would leave the caller's
 * `data?.count ?? 0` reading `undefined` and rendering 0 for a project full of
 * monitors.
 */

describe("fetchMonitorCount", () => {
  beforeEach(() => {
    respondWith(makeListResponse([{ _id: MONITOR_ID }], { count: 42 }));
  });

  test("asks for a single row because only the count is wanted", async () => {
    await fetchMonitorCount(PROJECT_ID);

    expect(requestUrl()).toBe("/api/monitor/get-list?skip=0&limit=1");
  });

  test("selects the id alone", async () => {
    /*
     * Asserted as an exact object rather than field by field: the point is
     * that nothing else is selected. Adding a relation here would make every
     * project's tile on the Home screen pay for joins whose rows are thrown
     * away.
     */
    await fetchMonitorCount(PROJECT_ID);

    expect(requestSelect()).toEqual({ _id: true });
  });

  test("counts every monitor in the project", async () => {
    await fetchMonitorCount(PROJECT_ID);

    expect(requestQuery()).toEqual({});
  });

  test("returns the envelope, so the count survives the one-row limit", async () => {
    const result: ListResponse<MonitorItem> =
      await fetchMonitorCount(PROJECT_ID);

    expect(result.count).toBe(42);
    expect(result.data).toHaveLength(1);
  });

  test("is scoped to the project whose tile is being drawn", async () => {
    await fetchMonitorCount(PROJECT_ID);

    expect(requestHeaders()).toEqual({ tenantid: PROJECT_ID });
  });

  test("rejects on failure rather than resolving to a zero count", async () => {
    /*
     * The caller sums `count` across projects and treats a missing one as 0,
     * so a swallowed error here would show a confident, wrong total instead of
     * letting the query report itself as failed.
     */
    postMock.mockRejectedValue(new Error("Network request failed"));

    await expect(fetchMonitorCount(PROJECT_ID)).rejects.toThrow(
      "Network request failed",
    );
  });
});

describe("fetchDisabledMonitorCount", () => {
  beforeEach(() => {
    respondWith(makeListResponse([{ _id: MONITOR_ID }], { count: 3 }));
  });

  test("counts only the monitors whose active monitoring is switched off", async () => {
    /*
     * This is the whole difference between this function and the plain count.
     * An empty query here would make the "disabled" tile report the project's
     * total monitor count - a number that looks alarming and is never zero.
     */
    await fetchDisabledMonitorCount(PROJECT_ID);

    expect(requestQuery()).toEqual({ disableActiveMonitoring: true });
  });

  test("asks for a single row and selects the id alone", async () => {
    await fetchDisabledMonitorCount(PROJECT_ID);

    expect(requestUrl()).toBe("/api/monitor/get-list?skip=0&limit=1");
    expect(requestSelect()).toEqual({ _id: true });
  });

  test("returns the envelope, so the count survives the one-row limit", async () => {
    const result: ListResponse<MonitorItem> =
      await fetchDisabledMonitorCount(PROJECT_ID);

    expect(result.count).toBe(3);
  });

  test("reports zero for a project where nothing is disabled", async () => {
    respondWith(makeListResponse([]));

    const result: ListResponse<MonitorItem> =
      await fetchDisabledMonitorCount(PROJECT_ID);

    expect(result.count).toBe(0);
    expect(result.data).toEqual([]);
  });

  test("is scoped to the project whose tile is being drawn", async () => {
    await fetchDisabledMonitorCount(PROJECT_ID);

    expect(requestHeaders()).toEqual({ tenantid: PROJECT_ID });
  });
});

describe("fetchInoperationalMonitorCount", () => {
  beforeEach(() => {
    respondWith(makeListResponse([{ _id: MONITOR_ID }], { count: 2 }));
  });

  test("counts the monitors whose current status is not an operational one", async () => {
    /*
     * Filtered on the status's isOperationalState flag rather than on a status
     * name or id, because every project names and ids its own statuses. This
     * tile is the one a responder glances at to decide whether anything is
     * broken, so a query that matched on a name would read as "nothing is
     * down" for every project that renamed its states.
     */
    await fetchInoperationalMonitorCount(PROJECT_ID);

    expect(requestQuery()).toEqual({
      currentMonitorStatus: { isOperationalState: false },
    });
  });

  test("asks for a single row and selects the id alone", async () => {
    await fetchInoperationalMonitorCount(PROJECT_ID);

    expect(requestUrl()).toBe("/api/monitor/get-list?skip=0&limit=1");
    expect(requestSelect()).toEqual({ _id: true });
  });

  test("returns the envelope, so the count survives the one-row limit", async () => {
    const result: ListResponse<MonitorItem> =
      await fetchInoperationalMonitorCount(PROJECT_ID);

    expect(result.count).toBe(2);
  });

  test("reports zero for a project where everything is operational", async () => {
    respondWith(makeListResponse([]));

    const result: ListResponse<MonitorItem> =
      await fetchInoperationalMonitorCount(PROJECT_ID);

    expect(result.count).toBe(0);
  });

  test("is scoped to the project whose tile is being drawn", async () => {
    await fetchInoperationalMonitorCount(PROJECT_ID);

    expect(requestHeaders()).toEqual({ tenantid: PROJECT_ID });
  });
});

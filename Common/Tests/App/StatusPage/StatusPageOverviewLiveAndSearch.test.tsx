import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { act } from "react";
import { SpyInstance } from "jest-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Route from "../../../Types/API/Route";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import Navigation from "../../../UI/Utils/Navigation";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageResourceUptimeUtil from "../../../Utils/StatusPage/ResourceUptime";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";

/*
 * Contract under test - the two things the status page overview gained: it
 * keeps itself current, and it can be searched.
 *
 * Both are page-level behaviours built out of pieces tested on their own
 * elsewhere (StatusPageLiveRefreshUtil, ResourceSearch, LastUpdated,
 * ResourceSearchBox, ResourceGroupSection). What this file holds is the
 * wiring, which is where these things actually go wrong:
 *
 *   - a background refresh that blanks the page it is refreshing,
 *   - a failed refresh that replaces a page saying "operational" with an
 *     error,
 *   - a refresh that re-runs the page's custom JavaScript every minute,
 *   - a search whose matches are inside collapsed groups, so a page that
 *     found something looks like a page that found nothing.
 */

const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";

const EUROPE_ID: string = "11111111-1111-4111-8111-111111111111";
const GERMANY_ID: string = "22222222-2222-4222-8222-222222222222";
const ASIA_ID: string = "44444444-4444-4444-8444-444444444444";

const OPERATIONAL_STATUS_ID: string = "55555555-5555-4555-8555-555555555555";

type PostResponse = HTTPResponse<JSONObject> | HTTPErrorResponse;

let mockRespondToPost: (url: string) => PostResponse = (): PostResponse => {
  throw new Error("mockRespondToPost was not set by the test");
};

let postCallCount: number = 0;

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isLoggedIn: () => {
        return true;
      },
      logout: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (options: { url: { toString: () => string } }) => {
        postCallCount++;
        return Promise.resolve(mockRespondToPost(options.url.toString()));
      },
      getDefaultHeaders: () => {
        return {};
      },
      getFriendlyMessage: (error: { message?: string }) => {
        return error?.message || "Something went wrong";
      },
    },
  };
});

/*
 * The real page chrome renders breadcrumbs, which need a router. None of this
 * is about the chrome.
 */
jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Page/Page",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return <div>{props.children}</div>;
      },
    };
  },
);

/*
 * react-i18next is not initialised in the test environment.
 *
 * The stub echoes the default value where the caller gave one and the key
 * where it did not, then substitutes every interpolation value it was handed -
 * appending the ones the template had no placeholder for, so that a key
 * without a default still carries its status name into the DOM and can be
 * asserted on. It deliberately references nothing outside itself: a jest.mock
 * factory that closes over module scope is a load-order trap.
 */
jest.mock("react-i18next", () => {
  /*
   * A real i18next translation function is stable between language changes.
   * Keeping the same function here makes render-cache assertions realistic.
   */
  const t: (
    key: string,
    opts?: { defaultValue?: string } & Record<string, unknown>,
  ) => string = (
    key: string,
    opts?: { defaultValue?: string } & Record<string, unknown>,
  ): string => {
    let out: string = opts?.defaultValue ?? key;

    for (const name of Object.keys(opts || {})) {
      const raw: unknown = (opts as Record<string, unknown>)[name];

      // Common's translateValue also passes i18next's boolean options.
      if (
        name === "defaultValue" ||
        (typeof raw !== "string" && typeof raw !== "number")
      ) {
        continue;
      }

      const value: string = String(raw);

      if (out.includes(`{{${name}}}`)) {
        out = out.split(`{{${name}}}`).join(value);
      } else {
        out = `${out} ${value}`;
      }
    }

    return out;
  };

  return {
    // The status page's i18n bootstrap needs this at import time.
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
    useTranslation: () => {
      return {
        t: t,
        i18n: { resolvedLanguage: "en", language: "en" },
      };
    },
  };
});

type ObjectIdJson = { _type: string; value: string };

function objectId(value: string): ObjectIdJson {
  return { _type: "ObjectID", value: value };
}

function color(value: string): { _type: string; value: string } {
  return { _type: "Color", value: value };
}

function group(data: {
  id: string;
  name: string;
  parentId?: string | undefined;
}): JSONObject {
  const json: JSONObject = {
    _id: data.id,
    name: data.name,
    isExpandedByDefault: false,
    showCurrentStatus: true,
  };

  if (data.parentId) {
    json["parentStatusPageGroupId"] = objectId(data.parentId);
  }

  return json;
}

function resource(data: {
  id: string;
  name: string;
  groupId?: string | undefined;
}): JSONObject {
  const json: JSONObject = {
    _id: data.id,
    displayName: data.name,
    showCurrentStatus: true,
    showStatusHistoryChart: false,
    showUptimePercent: false,
    monitor: {
      _id: `monitor-${data.id}`,
      name: data.name,
      currentMonitorStatusId: objectId(OPERATIONAL_STATUS_ID),
    },
  };

  if (data.groupId) {
    json["statusPageGroupId"] = objectId(data.groupId);
  }

  return json;
}

/*
 * Europe
 *   Germany   -> Checkout API, Search Service
 * Asia        -> Payments Gateway
 * (ungrouped) -> Marketing Site
 */
function overviewPayload(
  overrides: { overallStatusName?: string | undefined } = {},
): JSONObject {
  return {
    statusPage: {
      _id: STATUS_PAGE_ID,
      showUptimeHistoryInDays: 90,
      downtimeMonitorStatuses: [],
      defaultBarColor: color("#22c55e"),
    },
    resourceGroups: [
      group({ id: EUROPE_ID, name: "Europe" }),
      group({ id: GERMANY_ID, name: "Germany", parentId: EUROPE_ID }),
      group({ id: ASIA_ID, name: "Asia" }),
    ],
    statusPageResources: [
      resource({
        id: "resource-checkout",
        name: "Checkout API",
        groupId: GERMANY_ID,
      }),
      resource({
        id: "resource-search",
        name: "Search Service",
        groupId: GERMANY_ID,
      }),
      resource({
        id: "resource-payments",
        name: "Payments Gateway",
        groupId: ASIA_ID,
      }),
      resource({ id: "resource-marketing", name: "Marketing Site" }),
    ],
    monitorStatuses: [
      {
        _id: OPERATIONAL_STATUS_ID,
        name: "Operational",
        isOperationalState: true,
        color: color("#22c55e"),
      },
    ],
    monitorStatusTimelines: [],
    statusPageHistoryChartBarColorRules: [],
    incidentStateTimelines: [],
    scheduledMaintenanceStateTimelines: [],
    scheduledMaintenanceEvents: [],
    scheduledMaintenanceEventsPublicNotes: [],
    activeAnnouncements: [],
    activeIncidents: [],
    activeEpisodes: [],
    incidentPublicNotes: [],
    episodePublicNotes: [],
    episodeStateTimelines: [],
    timelineIncidents: [],
    monitorsInGroup: {},
    monitorGroupCurrentStatuses: {},
    overallStatus: {
      _id: OPERATIONAL_STATUS_ID,
      name: overrides.overallStatusName || "Operational",
      isOperationalState: true,
      color: color("#22c55e"),
    },
  };
}

const SEARCH_SNAPSHOT_TIME: Date = new Date("2026-09-09T12:00:00.000Z");
/*
 * Browser performance tests cover 90 days; seven days keeps these calculation-
 * count regressions fast while still rendering real history for 40 resources.
 */
const SEARCH_HISTORY_DAYS: number = 7;
const OFFLINE_STATUS_ID: string = "66666666-6666-4666-8666-666666666666";
const MONITOR_GROUP_ID: string = "90000000-0000-4000-8000-000000000040";
const LARGE_PAGE_GROUPS: Array<{
  id: string;
  name: string;
  parentId?: string | undefined;
}> = [
  { id: "group-platform", name: "Platform" },
  { id: "group-europe", name: "Europe", parentId: "group-platform" },
  { id: "group-core", name: "Core", parentId: "group-europe" },
  { id: "group-east", name: "Pool East", parentId: "group-core" },
  { id: "group-west", name: "Pool West", parentId: "group-core" },
];

function largeOverviewPayload(updated: boolean = false): JSONObject {
  const operationalStatus: JSONObject = {
    _id: OPERATIONAL_STATUS_ID,
    name: "Operational",
    priority: 1,
    isOperationalState: true,
    color: color("#22c55e"),
  };
  const offlineStatus: JSONObject = {
    _id: OFFLINE_STATUS_ID,
    name: "Offline",
    priority: 2,
    isOperationalState: false,
    color: color("#ef4444"),
  };
  const startDate: Date = new Date(
    SEARCH_SNAPSHOT_TIME.getTime() - SEARCH_HISTORY_DAYS * 24 * 60 * 60 * 1000,
  );
  const midpoint: Date = new Date(
    SEARCH_SNAPSHOT_TIME.getTime() -
      (SEARCH_HISTORY_DAYS / 2) * 24 * 60 * 60 * 1000,
  );
  const resources: Array<JSONObject> = [];
  const timelines: Array<JSONObject> = [];

  for (let index: number = 1; index <= 40; index++) {
    const suffix: string = index.toString().padStart(12, "0");
    const monitorId: string = `80000000-0000-4000-8000-${suffix}`;
    const resourceId: string = `70000000-0000-4000-8000-${suffix}`;
    const name: string = `Service ${index.toString().padStart(2, "0")}`;
    const isDown: boolean = updated && (index === 1 || index === 40);
    const hasRecovered: boolean = updated && index === 2;

    const resourceData: JSONObject = {
      ...resource({
        id: resourceId,
        name: name,
        groupId: index <= 20 ? "group-east" : "group-west",
      }),
      monitorId: objectId(monitorId),
      monitor: {
        _id: monitorId,
        name: name,
        currentMonitorStatusId: objectId(
          isDown ? OFFLINE_STATUS_ID : OPERATIONAL_STATUS_ID,
        ),
      },
      showStatusHistoryChart: true,
      showUptimePercent: true,
    };

    /*
     * The final resource is a monitor group so the same search and refresh
     * assertions exercise both kinds of status-page resource.
     */
    if (index === 40) {
      delete resourceData["monitor"];
      delete resourceData["monitorId"];
      resourceData["monitorGroupId"] = objectId(MONITOR_GROUP_ID);
    }
    resources.push(resourceData);

    const initialStatus: JSONObject = hasRecovered
      ? offlineStatus
      : operationalStatus;
    timelines.push({
      _id: `timeline-initial-${index}`,
      monitorId: objectId(monitorId),
      monitorStatusId: objectId(
        hasRecovered ? OFFLINE_STATUS_ID : OPERATIONAL_STATUS_ID,
      ),
      monitorStatus: initialStatus,
      startsAt: { _type: "DateTime", value: startDate.toISOString() },
      ...(isDown || hasRecovered
        ? { endsAt: { _type: "DateTime", value: midpoint.toISOString() } }
        : {}),
    });

    if (isDown || hasRecovered) {
      timelines.push({
        _id: `timeline-changed-${index}`,
        monitorId: objectId(monitorId),
        monitorStatusId: objectId(
          isDown ? OFFLINE_STATUS_ID : OPERATIONAL_STATUS_ID,
        ),
        monitorStatus: isDown ? offlineStatus : operationalStatus,
        startsAt: { _type: "DateTime", value: midpoint.toISOString() },
      });
    }
  }

  return {
    ...overviewPayload(),
    statusPage: {
      _id: STATUS_PAGE_ID,
      showUptimeHistoryInDays: SEARCH_HISTORY_DAYS,
      showOverallUptimePercentOnStatusPage: true,
      downtimeMonitorStatuses: [offlineStatus],
      defaultBarColor: color("#22c55e"),
    },
    resourceGroups: LARGE_PAGE_GROUPS.map(
      (data: (typeof LARGE_PAGE_GROUPS)[number]): JSONObject => {
        return {
          ...group(data),
          isExpandedByDefault: true,
          showUptimePercent: true,
        };
      },
    ),
    statusPageResources: resources,
    monitorStatuses: [operationalStatus, offlineStatus],
    monitorStatusTimelines: timelines,
    monitorsInGroup: {
      [MONITOR_GROUP_ID]: [objectId("80000000-0000-4000-8000-000000000040")],
    },
    monitorGroupCurrentStatuses: {
      [MONITOR_GROUP_ID]: objectId(
        updated ? OFFLINE_STATUS_ID : OPERATIONAL_STATUS_ID,
      ),
    },
    overallStatus: updated ? offlineStatus : operationalStatus,
  };
}

function successResponse(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

type RenderResult = {
  onLoadCompleteCount: () => number;
};

async function renderOverview(): Promise<RenderResult> {
  let loadCompleteCount: number = 0;

  await act(async () => {
    render(
      <Overview
        pageRoute={new Route("/")}
        onLoadComplete={() => {
          loadCompleteCount++;
        }}
      />,
    );
  });

  return {
    onLoadCompleteCount: () => {
      return loadCompleteCount;
    },
  };
}

function searchInput(): HTMLElement {
  return screen.getByTestId("status-page-resource-search-input");
}

async function typeSearch(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(searchInput(), { target: { value: value } });
  });
}

function setDocumentVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => {
      return state;
    },
  });
}

describe("Status page overview - searching for a resource", () => {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    postCallCount = 0;
    localStorage.clear();
    LocalStorage.setItem("statusPageId", new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", "/");
    Navigation.navigate = (): void => {};
    setDocumentVisibility("visible");
    mockRespondToPost = (): PostResponse => {
      return successResponse(overviewPayload());
    };
  });

  afterEach(() => {
    Navigation.navigate = navigate;
    jest.clearAllMocks();
  });

  test("a page with a hierarchy gets a search box", async () => {
    await renderOverview();

    expect(
      screen.getByTestId("status-page-resource-search"),
    ).toBeInTheDocument();
  });

  test("groups start closed, so their resources are not on the page", async () => {
    await renderOverview();

    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    expect(screen.queryByText("Checkout API")).not.toBeInTheDocument();
  });

  /*
   * The behaviour the search exists for: a match three levels down is opened
   * up to, not left folded away where it is indistinguishable from no match.
   */
  test("searching opens the groups a match is buried in", async () => {
    await renderOverview();

    await typeSearch("checkout");

    await waitFor(() => {
      expect(screen.getByText("Checkout API")).toBeInTheDocument();
    });
  });

  test("everything that did not match goes away", async () => {
    await renderOverview();

    await typeSearch("checkout");

    await waitFor(() => {
      expect(screen.getByText("Checkout API")).toBeInTheDocument();
    });

    expect(screen.queryByText("Search Service")).not.toBeInTheDocument();
    expect(screen.queryByText("Marketing Site")).not.toBeInTheDocument();
    expect(screen.queryByText("Asia")).not.toBeInTheDocument();
  });

  test("the groups above a match are kept so it has somewhere to render", async () => {
    await renderOverview();

    await typeSearch("checkout");

    await waitFor(() => {
      expect(screen.getByText("Checkout API")).toBeInTheDocument();
    });

    expect(screen.getByText("Europe")).toBeInTheDocument();
    expect(screen.getByText("Germany")).toBeInTheDocument();
  });

  /*
   * Typing a region is asking about the region, not about a service whose
   * name happens to contain it.
   */
  test("a group name brings back everything inside that group", async () => {
    await renderOverview();

    await typeSearch("germany");

    await waitFor(() => {
      expect(screen.getByText("Checkout API")).toBeInTheDocument();
    });

    expect(screen.getByText("Search Service")).toBeInTheDocument();
    expect(screen.queryByText("Payments Gateway")).not.toBeInTheDocument();
  });

  test("the count says how much of the page is left", async () => {
    await renderOverview();

    await typeSearch("checkout");

    await waitFor(() => {
      expect(
        screen.getByTestId("status-page-resource-search-count"),
      ).toHaveTextContent("1 of 4 resources");
    });
  });

  /*
   * A search that matched nothing has to say so. Without this the page simply
   * loses its resources section, which reads as broken rather than as an
   * answer.
   */
  test("a query that matches nothing says so", async () => {
    await renderOverview();

    await typeSearch("kubernetes");

    await waitFor(() => {
      expect(screen.getByText("No matching resources")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        'Nothing on this page matches "kubernetes". Try a shorter search.',
      ),
    ).toBeInTheDocument();
  });

  test("clearing the search puts the whole page back", async () => {
    await renderOverview();

    await typeSearch("checkout");

    await waitFor(() => {
      expect(screen.queryByText("Marketing Site")).not.toBeInTheDocument();
    });

    await typeSearch("");

    await waitFor(() => {
      expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    });

    // and the groups the search opened are folded away again.
    expect(screen.queryByText("Checkout API")).not.toBeInTheDocument();
  });

  test("searching does not fetch anything", async () => {
    await renderOverview();

    const callsAfterLoad: number = postCallCount;

    await typeSearch("checkout");

    expect(postCallCount).toBe(callsAfterLoad);
  });
});

describe("Status page overview - searching a large page with uptime history", () => {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  function observeHistoryWork(): {
    timelines: SpyInstance<
      typeof StatusPageResourceUptimeUtil.getMonitorStatusTimelineForResource
    >;
    groupUptime: SpyInstance<
      typeof StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup
    >;
    groupStatus: SpyInstance<
      typeof StatusPageResourceUptimeUtil.getCurrentStatusPageGroupStatus
    >;
    overallUptime: SpyInstance<
      typeof StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources
    >;
    uptime: SpyInstance<typeof UptimeUtil.calculateUptimePercentage>;
    events: SpyInstance<typeof UptimeUtil.getNonOverlappingMonitorEvents>;
  } {
    return {
      timelines: jest.spyOn(
        StatusPageResourceUptimeUtil,
        "getMonitorStatusTimelineForResource",
      ),
      groupUptime: jest.spyOn(
        StatusPageResourceUptimeUtil,
        "calculateAvgUptimePercentOfStatusPageGroup",
      ),
      groupStatus: jest.spyOn(
        StatusPageResourceUptimeUtil,
        "getCurrentStatusPageGroupStatus",
      ),
      overallUptime: jest.spyOn(
        StatusPageResourceUptimeUtil,
        "calculateAvgUptimePercentageOfAllResources",
      ),
      uptime: jest.spyOn(UptimeUtil, "calculateUptimePercentage"),
      events: jest.spyOn(UptimeUtil, "getNonOverlappingMonitorEvents"),
    };
  }

  type HistoryWork = ReturnType<typeof observeHistoryWork>;

  function payloadWorkCounts(work: HistoryWork): Record<string, number> {
    return {
      timelines: work.timelines.mock.calls.length,
      groupUptime: work.groupUptime.mock.calls.length,
      groupStatus: work.groupStatus.mock.calls.length,
      overallUptime: work.overallUptime.mock.calls.length,
    };
  }

  function monitorWorkCounts(
    work: HistoryWork,
    monitorId: string,
  ): Record<string, number> {
    const containsMonitor: (
      timelines: Array<MonitorStatusTimeline>,
    ) => boolean = (timelines: Array<MonitorStatusTimeline>): boolean => {
      return timelines.some((timeline: MonitorStatusTimeline): boolean => {
        return timeline.monitorId?.toString() === monitorId;
      });
    };

    return {
      uptime: work.uptime.mock.calls.filter(
        (
          call: Parameters<typeof UptimeUtil.calculateUptimePercentage>,
        ): boolean => {
          return containsMonitor(call[0]);
        },
      ).length,
      events: work.events.mock.calls.filter(
        (
          call: Parameters<typeof UptimeUtil.getNonOverlappingMonitorEvents>,
        ): boolean => {
          return containsMonitor(call[0]);
        },
      ).length,
    };
  }

  beforeEach(() => {
    postCallCount = 0;
    localStorage.clear();
    LocalStorage.setItem("statusPageId", new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", "/");
    Navigation.navigate = (): void => {};
    setDocumentVisibility("visible");
    jest.useFakeTimers();
    jest.setSystemTime(SEARCH_SNAPSHOT_TIME);
    mockRespondToPost = (): PostResponse => {
      return successResponse(largeOverviewPayload());
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    Navigation.navigate = navigate;
    jest.restoreAllMocks();
  });

  test("successive keystrokes reuse all unchanged history and uptime calculations", async () => {
    const work: HistoryWork = observeHistoryWork();
    await renderOverview();

    expect(screen.getAllByTestId("day-uptime-graph")).toHaveLength(40);
    expect(screen.getAllByTestId("uptime-bar").length).toBeGreaterThan(
      40 * (SEARCH_HISTORY_DAYS - 1),
    );
    expect(screen.getAllByTestId("status-page-group-header")).toHaveLength(5);
    expect(work.groupUptime).toHaveBeenCalled();
    expect(work.overallUptime).toHaveBeenCalled();
    expect(work.events).toHaveBeenCalled();

    const payloadCounts: Record<string, number> = payloadWorkCounts(work);
    const uptimeCount: number = work.uptime.mock.calls.length;
    const eventCount: number = work.events.mock.calls.length;
    const callsAfterLoad: number = postCallCount;
    const input: HTMLElement = searchInput();
    input.focus();

    /*
     * The same 40 charts survive each query. Advancing time catches Date
     * objects recreated on each input render even when their props look alike.
     */
    for (const query of ["s", "se", "ser", "serv", "servi", "service"]) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      await typeSearch(query);
      expect(input).toHaveValue(query);
      expect(input).toHaveFocus();
      expect(
        screen.getByTestId("status-page-resource-search-count"),
      ).toHaveTextContent("40 of 40 resources");
      expect(screen.getAllByTestId("day-uptime-graph")).toHaveLength(40);
      expect(payloadWorkCounts(work)).toEqual(payloadCounts);
      expect(work.uptime).toHaveBeenCalledTimes(uptimeCount);
      expect(work.events).toHaveBeenCalledTimes(eventCount);
    }

    await typeSearch("SERVICE");
    await act(async () => {
      fireEvent.click(screen.getByTestId("status-page-resource-search-clear"));
    });

    expect(searchInput()).toBe(input);
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.getAllByTestId("day-uptime-graph")).toHaveLength(40);
    expect(payloadWorkCounts(work)).toEqual(payloadCounts);
    expect(work.uptime).toHaveBeenCalledTimes(uptimeCount);
    expect(work.events).toHaveBeenCalledTimes(eventCount);
    expect(postCallCount).toBe(callsAfterLoad);
  });

  test("narrowing and clearing a query preserves the surviving chart and its calculations", async () => {
    const work: HistoryWork = observeHistoryWork();
    await renderOverview();

    const payloadCounts: Record<string, number> = payloadWorkCounts(work);
    const monitorId: string = "80000000-0000-4000-8000-000000000001";
    const monitorCounts: Record<string, number> = monitorWorkCounts(
      work,
      monitorId,
    );
    const chart: HTMLElement = screen.getAllByTestId("day-uptime-graph")[0]!;
    const input: HTMLElement = searchInput();
    input.focus();

    await typeSearch("service 0");
    expect(screen.getAllByTestId("day-uptime-graph")).toHaveLength(9);
    await typeSearch("service 01");

    expect(screen.getByText("Service 01")).toBeInTheDocument();
    expect(screen.queryByText("Service 02")).not.toBeInTheDocument();
    expect(screen.queryByText("Pool West")).not.toBeInTheDocument();
    expect(screen.getByTestId("day-uptime-graph")).toBe(chart);
    expect(
      screen.getByTestId("status-page-resource-search-count"),
    ).toHaveTextContent("1 of 40 resources");
    for (const ancestor of ["Platform", "Europe", "Core", "Pool East"]) {
      expect(screen.getByText(ancestor)).toBeInTheDocument();
    }
    expect(monitorWorkCounts(work, monitorId)).toEqual(monitorCounts);
    expect(payloadWorkCounts(work)).toEqual(payloadCounts);

    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.getAllByTestId("day-uptime-graph")).toHaveLength(40);
    expect(screen.getAllByTestId("day-uptime-graph")[0]).toBe(chart);
    expect(screen.getByText("Service 40")).toBeInTheDocument();
    /*
     * Charts that return to the DOM mount again; the continuously visible
     * chart and the data derived from the loaded payload stay reusable.
     */
    expect(monitorWorkCounts(work, monitorId)).toEqual(monitorCounts);
    expect(payloadWorkCounts(work)).toEqual(payloadCounts);
  });

  test("replacement, no results, and clearing reuse the loaded data and keep input focus", async () => {
    const work: HistoryWork = observeHistoryWork();
    await renderOverview();

    const payloadCounts: Record<string, number> = payloadWorkCounts(work);
    const callsAfterLoad: number = postCallCount;
    const input: HTMLElement = searchInput();
    input.focus();

    await typeSearch("service 01");
    await typeSearch("service 40");
    expect(screen.getByText("Service 40")).toBeInTheDocument();
    expect(screen.queryByText("Service 01")).not.toBeInTheDocument();
    expect(screen.getByText("Pool West")).toBeInTheDocument();
    expect(screen.queryByText("Pool East")).not.toBeInTheDocument();

    await typeSearch("missing resource");
    expect(screen.getByText("No matching resources")).toBeInTheDocument();
    expect(screen.queryByTestId("day-uptime-graph")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("status-page-resource-search-count"),
    ).toHaveTextContent("0 of 40 resources");
    expect(input).toHaveFocus();

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-page-resource-search-clear"));
    });

    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.queryByText("No matching resources")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("day-uptime-graph")).toHaveLength(40);
    expect(screen.getAllByTestId("status-page-group-header")).toHaveLength(5);
    expect(payloadWorkCounts(work)).toEqual(payloadCounts);
    expect(postCallCount).toBe(callsAfterLoad);
  });

  test("matching a group keeps all its descendants at four nested levels", async () => {
    await renderOverview();

    await typeSearch("pool east");

    expect(
      screen.getByTestId("status-page-resource-search-count"),
    ).toHaveTextContent("20 of 40 resources");
    expect(screen.getAllByTestId("day-uptime-graph")).toHaveLength(20);
    expect(screen.getByText("Service 01")).toBeInTheDocument();
    expect(screen.getByText("Service 20")).toBeInTheDocument();
    expect(screen.queryByText("Service 21")).not.toBeInTheDocument();
    expect(screen.queryByText("Pool West")).not.toBeInTheDocument();
    for (const ancestor of ["Platform", "Europe", "Core", "Pool East"]) {
      expect(screen.getByText(ancestor)).toBeInTheDocument();
    }

    await typeSearch("europe");
    expect(screen.getAllByTestId("day-uptime-graph")).toHaveLength(40);
    expect(
      screen.getByTestId("status-page-resource-search-count"),
    ).toHaveTextContent("40 of 40 resources");
  });

  test("refresh invalidates cached history, status, uptime, and the reporting window", async () => {
    const work: HistoryWork = observeHistoryWork();
    await renderOverview();
    await typeSearch("service");

    const payloadCounts: Record<string, number> = payloadWorkCounts(work);
    const initialWindowEnd: Date = work.uptime.mock.calls[0]![3]!.endDate;
    const input: HTMLElement = searchInput();
    input.focus();
    expect(screen.getByRole("status")).toHaveTextContent("Operational");
    expect(
      screen.queryByText("50overview.uptimeSuffix"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("status-page-group-rollup")[0],
    ).toHaveTextContent("100overview.uptimeSuffix");

    jest.setSystemTime(
      new Date(SEARCH_SNAPSHOT_TIME.getTime() + 5 * 60 * 1000),
    );
    mockRespondToPost = (): PostResponse => {
      return successResponse(largeOverviewPayload(true));
    };
    await act(async () => {
      fireEvent.click(screen.getByTestId("status-page-refresh-button"));
    });

    expect(input).toHaveValue("service");
    expect(input).toHaveFocus();
    expect(screen.getAllByTestId("day-uptime-graph")).toHaveLength(40);
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
    expect(
      screen.getAllByTestId("status-page-group-rollup")[0],
    ).toHaveTextContent("Offline");
    expect(screen.getByText("50overview.uptimeSuffix")).toBeInTheDocument();
    expect(
      screen.getByText("Service 40").parentElement?.parentElement,
    ).toHaveTextContent("Offline");
    const recoveredChart: HTMLElement =
      screen.getAllByTestId("day-uptime-graph")[1]!;
    expect(
      within(recoveredChart)
        .getAllByTestId("uptime-bar")
        .some((bar: HTMLElement): boolean => {
          return bar.style.backgroundColor === "rgb(239, 68, 68)";
        }),
    ).toBe(true);
    expect(work.timelines.mock.calls.length).toBeGreaterThan(
      payloadCounts["timelines"]!,
    );
    expect(work.groupUptime.mock.calls.length).toBeGreaterThan(
      payloadCounts["groupUptime"]!,
    );
    expect(work.groupStatus.mock.calls.length).toBeGreaterThan(
      payloadCounts["groupStatus"]!,
    );
    const refreshedWindowEnd: Date =
      work.uptime.mock.calls[work.uptime.mock.calls.length - 1]![3]!.endDate;
    expect(refreshedWindowEnd.getTime()).toBeGreaterThan(
      initialWindowEnd.getTime(),
    );

    const refreshedCounts: Record<string, number> = payloadWorkCounts(work);
    const refreshedUptimeCount: number = work.uptime.mock.calls.length;
    const refreshedEventCount: number = work.events.mock.calls.length;
    await typeSearch("SERVICE");
    expect(payloadWorkCounts(work)).toEqual(refreshedCounts);
    expect(work.uptime).toHaveBeenCalledTimes(refreshedUptimeCount);
    expect(work.events).toHaveBeenCalledTimes(refreshedEventCount);
  });
});

describe("Status page overview - keeping itself current", () => {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    postCallCount = 0;
    localStorage.clear();
    LocalStorage.setItem("statusPageId", new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", "/");
    Navigation.navigate = (): void => {};
    setDocumentVisibility("visible");
    mockRespondToPost = (): PostResponse => {
      return successResponse(overviewPayload());
    };
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    Navigation.navigate = navigate;
    jest.clearAllMocks();
  });

  test("the page says how old what you are looking at is", async () => {
    await renderOverview();

    expect(screen.getByTestId("status-page-last-updated")).toBeInTheDocument();
    expect(
      screen.getByTestId("status-page-last-updated-text"),
    ).toHaveTextContent("Updated now");
  });

  test("the refresh control fetches again", async () => {
    await renderOverview();

    const callsAfterLoad: number = postCallCount;

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-page-refresh-button"));
    });

    expect(postCallCount).toBe(callsAfterLoad + 1);
  });

  /*
   * The whole reason the refresh is "silent": a background fetch that puts the
   * page back into its loading state would make a status page flash its
   * skeleton at whoever is watching it every minute.
   */
  test("a refresh does not blank the page it is refreshing", async () => {
    await renderOverview();

    /*
     * Deliberately not awaited: this is the state the page is in while the
     * request is still open, which is the state a background refresh would
     * otherwise spend a second of every minute in.
     */
    act(() => {
      fireEvent.click(screen.getByTestId("status-page-refresh-button"));
    });

    expect(screen.getByTestId("status-page-overview")).toBeInTheDocument();
    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    expect(screen.getByTestId("status-page-refresh-button")).toBeDisabled();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
  });

  test("a background refresh happens once the interval is up", async () => {
    await renderOverview();

    const callsAfterLoad: number = postCallCount;

    await act(async () => {
      jest.advanceTimersByTime(61 * 1000);
    });

    await waitFor(() => {
      expect(postCallCount).toBeGreaterThan(callsAfterLoad);
    });
  });

  /*
   * A status page pinned in a background tab for hours must not turn into a
   * load generator.
   */
  test("a hidden tab does not refresh", async () => {
    await renderOverview();

    const callsAfterLoad: number = postCallCount;

    setDocumentVisibility("hidden");

    await act(async () => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(postCallCount).toBe(callsAfterLoad);
  });

  test("coming back to the tab refreshes it straight away", async () => {
    await renderOverview();

    setDocumentVisibility("hidden");

    await act(async () => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    const callsWhileHidden: number = postCallCount;

    setDocumentVisibility("visible");

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(postCallCount).toBeGreaterThan(callsWhileHidden);
    });
  });

  /*
   * The page's custom JavaScript runs from onLoadComplete. Re-running it every
   * minute would mean a status page owner's analytics snippet fired sixty
   * times an hour per visitor.
   */
  test("a background refresh does not re-run the page's custom JavaScript", async () => {
    const rendered: RenderResult = await renderOverview();

    expect(rendered.onLoadCompleteCount()).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(61 * 1000);
    });

    await waitFor(() => {
      expect(postCallCount).toBeGreaterThan(1);
    });

    expect(rendered.onLoadCompleteCount()).toBe(1);
  });

  /*
   * The failure mode that matters: a visitor watching an incident would much
   * rather see a minute-old status marked as stale than an error page where
   * the status used to be.
   */
  test("a refresh that fails keeps the last known status on screen", async () => {
    await renderOverview();

    expect(screen.getByText("Marketing Site")).toBeInTheDocument();

    mockRespondToPost = (): PostResponse => {
      return new HTTPErrorResponse(
        500,
        { message: "Network request failed" },
        {},
      );
    };

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-page-refresh-button"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("status-page-last-updated-text"),
      ).toHaveTextContent("Could not refresh. Showing the last known status.");
    });

    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    expect(screen.getByTestId("status-page-overview")).toBeInTheDocument();
  });

  test("a later refresh that works clears the stale notice", async () => {
    await renderOverview();

    mockRespondToPost = (): PostResponse => {
      return new HTTPErrorResponse(500, { message: "Nope" }, {});
    };

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-page-refresh-button"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("status-page-last-updated-text"),
      ).toHaveTextContent("Could not refresh");
    });

    mockRespondToPost = (): PostResponse => {
      return successResponse(overviewPayload());
    };

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-page-refresh-button"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("status-page-last-updated-text"),
      ).toHaveTextContent("Updated");
    });
  });

  /*
   * If the page now changes under a visitor without them doing anything, a
   * screen reader has to be told when the thing they came for changes.
   */
  test("the overall status sits in a polite live region", async () => {
    await renderOverview();

    const region: HTMLElement = screen.getByRole("status");

    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.textContent).toContain("Operational");
  });

  test("a status change is picked up by a background refresh", async () => {
    await renderOverview();

    mockRespondToPost = (): PostResponse => {
      return successResponse(
        overviewPayload({ overallStatusName: "Degraded" }),
      );
    };

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-page-refresh-button"));
    });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Degraded");
    });
  });

  test("the poll is torn down with the page", async () => {
    const { unmount } = render(
      <Overview pageRoute={new Route("/")} onLoadComplete={() => {}} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    const callsAfterUnmount: number = postCallCount;

    await act(async () => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(postCallCount).toBe(callsAfterUnmount);
  });
});

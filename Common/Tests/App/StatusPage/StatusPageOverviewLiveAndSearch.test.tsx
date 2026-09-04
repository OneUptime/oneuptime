import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { act } from "react";
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
  return {
    /*
     * The status page's own i18n bootstrap does i18n.use(initReactI18next) at
     * import time, so the mock has to keep that export alive or the module
     * graph fails before a single test runs.
     */
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
    useTranslation: () => {
      return {
        t: (
          key: string,
          opts?: { defaultValue?: string } & Record<string, unknown>,
        ): string => {
          let out: string = opts?.defaultValue ?? key;

          for (const name of Object.keys(opts || {})) {
            const raw: unknown = (opts as Record<string, unknown>)[name];

            /*
             * defaultValue is not an interpolation value, and neither are
             * i18next's own switches - Common's translateValue passes
             * keySeparator and nsSeparator as booleans on every call.
             */
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
        },
        i18n: { resolvedLanguage: "en", language: "en" },
      };
    },
  };
});

import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";

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

import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import React, { act } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AnnouncementDetail from "../../../../App/FeatureSet/StatusPage/src/Pages/Announcement/Detail";
import IncidentDetail from "../../../../App/FeatureSet/StatusPage/src/Pages/Incidents/Detail";
import ScheduledEventDetail from "../../../../App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/Detail";
import Route from "../../../Types/API/Route";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import Navigation from "../../../UI/Utils/Navigation";

const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";
const ITEM_ID: string = "44444444-4444-4444-8444-444444444444";

type PostResponse = HTTPResponse<JSONObject> | HTTPErrorResponse;
type RespondToPostFunction = (url: string) => PostResponse;

/*
 * Each test swaps this out to describe what the status page API returns for the
 * request the page under test makes.
 */
let mockRespondToPost: RespondToPostFunction = (): PostResponse => {
  throw new Error("mockRespondToPost was not set by the test");
};

let mockLogoutCallCount: number = 0;

// Logging out hits the network and navigates, neither of which belongs in this test.
jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isLoggedIn: () => {
        return true;
      },
      logout: () => {
        mockLogoutCallCount++;
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
 * The real page chrome renders breadcrumb links, which need a router. None of
 * these tests are about the chrome, so keep it to a plain wrapper.
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

type SuccessResponseFunction = (data: JSONObject) => HTTPResponse<JSONObject>;

const successResponse: SuccessResponseFunction = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

type ErrorResponseFunction = (
  statusCode: number,
  message: string,
) => HTTPErrorResponse;

const errorResponse: ErrorResponseFunction = (
  statusCode: number,
  message: string,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(statusCode, { message: message }, {});
};

type PageComponent = React.FunctionComponent<{
  pageRoute: Route;
  onLoadComplete: () => void;
}>;

type RenderPageFunction = (
  Component: PageComponent,
) => Promise<ReturnType<typeof render>>;

/*
 * These pages load themselves from an effect, so the render has to be flushed
 * inside act() for the resulting state updates to be settled.
 */
const renderPage: RenderPageFunction = async (
  Component: PageComponent,
): Promise<ReturnType<typeof render>> => {
  let result: ReturnType<typeof render> | null = null;

  await act(async () => {
    result = render(
      <Component
        pageRoute={new Route(`/incidents/${ITEM_ID}`)}
        onLoadComplete={() => {}}
      />,
    );
  });

  return result!;
};

describe("Status page detail pages when the item is not available", () => {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    mockLogoutCallCount = 0;
    localStorage.clear();
    LocalStorage.setItem("statusPageId", new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", `/incidents/${ITEM_ID}`);

    // jsdom cannot leave the page, and it logs a noisy error when asked to.
    Navigation.navigate = (): void => {};
  });

  afterEach(() => {
    Navigation.navigate = navigate;
    jest.clearAllMocks();
  });

  test("incident page shows the empty state when neither an incident nor an episode is found", async () => {
    /*
     * This is the production case that hung the page: the incident exists but has
     * no monitors on this status page, so the API filters it out and returns an
     * empty list with a 200.
     */
    mockRespondToPost = (url: string): PostResponse => {
      if (url.includes("/incidents/")) {
        return successResponse({
          incidents: [],
          incidentPublicNotes: [],
          incidentStateTimelines: [],
          statusPageResources: [],
          monitorsInGroup: {},
        });
      }

      // Most status pages have episodes turned off, so the fallback lookup fails.
      return errorResponse(
        400,
        "Episodes are not enabled on this status page.",
      );
    };

    const { container } = await renderPage(IncidentDetail);

    await waitFor(() => {
      expect(container.querySelector("#item-empty-state")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Incident not found on this status page."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).not.toBeInTheDocument();

    // The episode fallback's error is an implementation detail. It must not leak.
    expect(
      screen.queryByText("Episodes are not enabled on this status page."),
    ).not.toBeInTheDocument();
  });

  test("incident page surfaces the error when the incident lookup itself fails", async () => {
    mockRespondToPost = (): PostResponse => {
      return errorResponse(403, "This status page is not public.");
    };

    const { container } = await renderPage(IncidentDetail);

    await waitFor(() => {
      expect(
        screen.getByText("This status page is not public."),
      ).toBeInTheDocument();
    });

    expect(
      container.querySelector("#item-empty-state"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).not.toBeInTheDocument();
  });

  test("incident page logs the user out when the lookup comes back unauthorized", async () => {
    // An expired session has to reach the auth check rather than read as "not found".
    mockRespondToPost = (): PostResponse => {
      return errorResponse(401, "Not authorized.");
    };

    await renderPage(IncidentDetail);

    await waitFor(() => {
      expect(mockLogoutCallCount).toBeGreaterThan(0);
    });
  });

  test("incident page still renders the incident when one is found", async () => {
    mockRespondToPost = (url: string): PostResponse => {
      if (url.includes("/incidents/")) {
        return successResponse({
          incidents: [
            {
              _id: ITEM_ID,
              title: "Checkout is degraded",
            },
          ],
          incidentPublicNotes: [],
          incidentStateTimelines: [],
          statusPageResources: [],
          monitorsInGroup: {},
        });
      }

      throw new Error("The episode fallback should not be reached");
    };

    const { container } = await renderPage(IncidentDetail);

    await waitFor(() => {
      expect(screen.getByText("Checkout is degraded")).toBeInTheDocument();
    });

    expect(
      container.querySelector("#item-empty-state"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).not.toBeInTheDocument();
  });

  test("scheduled maintenance page shows the empty state when the event is not found", async () => {
    mockRespondToPost = (): PostResponse => {
      return successResponse({
        scheduledMaintenanceEvents: [],
        scheduledMaintenanceEventsPublicNotes: [],
        scheduledMaintenanceStateTimelines: [],
        statusPageResources: [],
        monitorsInGroup: {},
      });
    };

    const { container } = await renderPage(ScheduledEventDetail);

    await waitFor(() => {
      expect(
        container.querySelector("#scheduled-event-empty-state"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("No scheduled event found for this status page."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).not.toBeInTheDocument();
  });

  test("announcement page shows the empty state when the announcement is not found", async () => {
    mockRespondToPost = (): PostResponse => {
      return successResponse({
        announcements: [],
        statusPageResources: [],
        monitorsInGroup: {},
      });
    };

    const { container } = await renderPage(AnnouncementDetail);

    await waitFor(() => {
      expect(
        container.querySelector("#announcement-empty-state"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Announcement not found on this status page."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).not.toBeInTheDocument();
  });
});

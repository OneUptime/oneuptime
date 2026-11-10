import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Route from "../../../Types/API/Route";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * One person of Product Analytics > Users
 * (Pages/Rum/View/ProductAnalyticsPerson.tsx), rendered against a mocked
 * read (issue #6444): who they are, as far as the reader may see; when they
 * came and how often; each session of theirs, with a Watch link only where
 * the recording is still kept; and a plain word when the address names
 * nobody, or nobody the last 13 months hold.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import RumApplicationProductAnalyticsPerson, {
  PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE,
  buildProductAnalyticsBackRoute,
  parseProductAnalyticsPersonPath,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsPerson";

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const VISITOR_ID: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";
const SESSION_KEPT: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_GONE: string = "b1b2c3d4e5f60718293a4b5c6d7e8f91";
const USERS_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-users`;

function personPath(segment: string, search?: string): string {
  return `${USERS_PATH}/${segment}${search || ""}`;
}

function identified(label?: string | undefined): JSONObject {
  return {
    personKey: `u:${USER_KEY}`,
    identifiedUserKey: USER_KEY,
    visitorId: VISITOR_ID,
    ...(label === undefined ? {} : { identifiedUserLabel: label }),
    firstSeenAt: Date.UTC(2026, 7, 1, 9, 30),
    lastSeenAt: Date.UTC(2026, 8, 2, 18, 0),
    sessionsInRange: 3,
    totalSessions: 1250,
    deviceType: "desktop",
    countryCode: "DE",
    isNew: 0,
  };
}

function session(overrides: JSONObject): JSONObject {
  return {
    sessionId: SESSION_KEPT,
    startedAt: Date.UTC(2026, 8, 2, 18, 0),
    durationMs: 135000,
    pageCount: 4,
    entryPage: "https://app.acme.com/checkout",
    pages: ["https://app.acme.com/checkout"],
    deviceType: "desktop",
    browserName: "Chrome",
    osName: "macOS",
    countryCode: "DE",
    appVersion: "1.2.0",
    errorCount: 2,
    frustrationCount: 0,
    isFinished: 1,
    isReplayKept: 1,
    ...overrides,
  };
}

function detail(overrides?: JSONObject): JSONObject {
  return {
    person: identified("jane@acme.com"),
    sessions: [
      session({}),
      session({
        sessionId: SESSION_GONE,
        isReplayKept: 0,
        isFinished: 0,
        errorCount: 0,
        browserName: "",
        osName: "",
        deviceType: "",
        countryCode: "",
        entryPage: "",
      }),
    ],
    hasMore: false,
    includesLabels: true,
    ...overrides,
  };
}

function mockDetail(
  answer: JSONObject | HTTPErrorResponse | ((data: JSONObject) => JSONObject),
): void {
  postMock.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: { url: { toString: () => string }; data: JSONObject } =
      args[0] as { url: { toString: () => string }; data: JSONObject };

    if (!request.url.toString().endsWith("/product-analytics/person")) {
      return Promise.reject(new Error("Unexpected read"));
    }

    if (answer instanceof HTTPErrorResponse) {
      return Promise.resolve(answer);
    }

    return Promise.resolve(
      new HTTPResponse<JSONObject>(
        200,
        typeof answer === "function" ? answer(request.data) : answer,
        {},
      ),
    );
  });
}

function requests(): Array<JSONObject> {
  return postMock.mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { data: JSONObject }).data;
  });
}

function renderAt(path: string): ReturnType<typeof render> {
  window.history.replaceState(null, "", path);

  return render(
    <MemoryRouter initialEntries={[path]}>
      <RumApplicationProductAnalyticsPerson
        pageRoute={new Route(path)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

function sessionRows(): Array<HTMLElement> {
  return within(
    document.getElementById("product-analytics-person-sessions") ||
      document.body,
  )
    .getAllByRole("row")
    .filter((row: HTMLElement): boolean => {
      return within(row).queryAllByRole("cell").length > 0;
    });
}

beforeEach(() => {
  postMock.mockReset();
});

describe("parseProductAnalyticsPersonPath", () => {
  it("reads the application and the person, colon restored", () => {
    expect(
      parseProductAnalyticsPersonPath(personPath(`u-${USER_KEY}`)),
    ).toEqual({ rumApplicationId: APP_ID, personKey: `u:${USER_KEY}` });
    expect(
      parseProductAnalyticsPersonPath(`${personPath(`v-${VISITOR_ID}`)}/`),
    ).toEqual({ rumApplicationId: APP_ID, personKey: `v:${VISITOR_ID}` });
  });

  it("a segment that names nobody is no person, on the right page", () => {
    for (const segment of [
      "jane",
      `u-${USER_KEY.slice(2)}`,
      `x-${USER_KEY}`,
      encodeURIComponent(`u:${USER_KEY}`).toUpperCase(),
      "%E0%A4%A",
      `v-${VISITOR_ID}-`,
    ]) {
      expect(parseProductAnalyticsPersonPath(personPath(segment))).toEqual({
        rumApplicationId: APP_ID,
        personKey: null,
      });
    }
  });

  it("any other page is not a person page", () => {
    expect(parseProductAnalyticsPersonPath(USERS_PATH)).toBeNull();
    expect(
      parseProductAnalyticsPersonPath(
        `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_KEPT}`,
      ),
    ).toBeNull();
    expect(
      parseProductAnalyticsPersonPath(`${personPath(`u-${USER_KEY}`)}/extra`),
    ).toBeNull();
    expect(
      parseProductAnalyticsPersonPath("/product-analytics-users/u-1"),
    ).toBeNull();
  });
});

describe("buildProductAnalyticsBackRoute", () => {
  it("returns to the Users page as it was left, keeping only what that page reads", () => {
    /* The project comes from the address the reader is on. */
    window.history.replaceState(null, "", personPath(`u-${USER_KEY}`));

    expect(
      buildProductAnalyticsBackRoute({
        rumApplicationId: APP_ID,
        search: "?people=dormant&dormant=60&range=Past+1+Week&utm=mail&by=page",
      }).toString(),
    ).toBe(`${USERS_PATH}?range=Past+1+Week&people=dormant&dormant=60`);
    expect(
      buildProductAnalyticsBackRoute({
        rumApplicationId: APP_ID,
        search: "?people=nonsense",
      }).toString(),
    ).toBe(USERS_PATH);
    expect(
      buildProductAnalyticsBackRoute({
        rumApplicationId: APP_ID,
        search: "",
      }).toString(),
    ).toBe(USERS_PATH);
  });
});

describe("ProductAnalyticsPerson", () => {
  it("asks for the person in the address, colon restored, first page", async () => {
    mockDetail(detail());

    renderAt(personPath(`u-${USER_KEY}`));

    await screen.findByTestId("product-analytics-person-facts");

    expect(requests()).toEqual([
      {
        rumApplicationId: APP_ID,
        personKey: `u:${USER_KEY}`,
        limit: PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE,
        offset: 0,
      },
    ]);
  });

  it("names a signed-in user the reader may see, with their facts", async () => {
    mockDetail(detail());

    renderAt(personPath(`u-${USER_KEY}`));

    const facts: HTMLElement = await screen.findByTestId(
      "product-analytics-person-facts",
    );

    expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
    expect(screen.getByText("jane@acme.com").closest("[dir]")).toHaveAttribute(
      "dir",
      "auto",
    );
    expect(screen.getAllByText("Signed-in user").length).toBeGreaterThan(0);

    const terms: Array<string> = within(facts)
      .getAllByRole("term")
      .map((term: HTMLElement): string => {
        return term.textContent || "";
      });

    expect(terms).toEqual([
      "First seen",
      "Last seen",
      "All sessions",
      "Device",
      "Country",
    ]);
    expect(within(facts).getByText("1,250")).toBeInTheDocument();
    expect(within(facts).getByText("Desktop")).toBeInTheDocument();
    expect(within(facts).getByText("Germany")).toBeInTheDocument();
    expect(
      screen.queryByTestId("product-analytics-person-hidden-name"),
    ).toBeNull();
  });

  it("each session: length, device, errors, and Watch only while the recording is kept", async () => {
    mockDetail(detail());

    renderAt(personPath(`u-${USER_KEY}`));

    await screen.findByTestId("product-analytics-person-facts");

    await waitFor(() => {
      expect(sessionRows()).toHaveLength(2);
    });

    const [kept, gone] = sessionRows() as [HTMLElement, HTMLElement];

    expect(kept).toHaveTextContent("2m 15s");
    expect(kept).toHaveTextContent("Desktop · Chrome · macOS");
    expect(kept).toHaveTextContent("https://app.acme.com/checkout");
    expect(
      within(kept).getByTestId("product-analytics-person-watch"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_KEPT}`,
    );

    expect(gone).toHaveTextContent("Still recording");
    expect(gone).toHaveTextContent("Recording no longer kept");
    expect(gone).toHaveTextContent("Not reported");
    expect(
      within(gone).queryByTestId("product-analytics-person-watch"),
    ).toBeNull();
  });

  it("a signed-in user the reader may not see is shown without a name, and says why", async () => {
    mockDetail(detail({ person: identified(), includesLabels: false }));

    renderAt(personPath(`u-${USER_KEY}`));

    await screen.findByTestId("product-analytics-person-hidden-name");

    expect(screen.queryByText("jane@acme.com")).toBeNull();
    expect(screen.getByText("9f86d081…")).toBeInTheDocument();
    expect(
      screen.getByTestId("product-analytics-person-hidden-name"),
    ).toHaveTextContent(
      "Your role cannot see who signed-in users are, so this person is shown without a name.",
    );
  });

  it("an anonymous visitor is one, and has no name to hide", async () => {
    mockDetail(
      detail({
        person: {
          ...identified(),
          personKey: `v:${VISITOR_ID}`,
          identifiedUserKey: "",
        },
        includesLabels: false,
      }),
    );

    renderAt(personPath(`v-${VISITOR_ID}`));

    await screen.findByTestId("product-analytics-person-facts");

    expect(screen.getByText("Anonymous visitor")).toBeInTheDocument();
    expect(screen.getByText("7f3a2b1c…")).toBeInTheDocument();
    expect(
      screen.queryByTestId("product-analytics-person-hidden-name"),
    ).toBeNull();
  });

  it("nobody by this key in the kept months: said so, with the way back", async () => {
    mockDetail(detail({ person: null, sessions: [] }));

    renderAt(personPath(`u-${USER_KEY}`, "?people=new"));

    await waitFor(() => {
      expect(
        document.getElementById("product-analytics-person-not-found"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Nobody by this ID in the last 13 months"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("product-analytics-person-back")).toHaveAttribute(
      "href",
      `${USERS_PATH}?people=new`,
    );
  });

  it("an address that names nobody is said so, and nothing is asked", async () => {
    mockDetail(detail());

    renderAt(personPath("not-a-person"));

    await waitFor(() => {
      expect(
        document.getElementById("product-analytics-person-unknown"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("This link names nobody")).toBeInTheDocument();
    expect(screen.getByTestId("product-analytics-person-back")).toHaveAttribute(
      "href",
      USERS_PATH,
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  it("a malformed escape in the address names nobody too, and the page still draws", async () => {
    mockDetail(detail());

    renderAt(personPath("%E0%A4%A"));

    await waitFor(() => {
      expect(
        document.getElementById("product-analytics-person-unknown"),
      ).toBeInTheDocument();
    });

    expect(postMock).not.toHaveBeenCalled();
  });

  it("Back to users returns to the range and filter the person was opened from", async () => {
    mockDetail(detail());

    renderAt(
      personPath(
        `u-${USER_KEY}`,
        "?range=Past+1+Week&people=dormant&dormant=90",
      ),
    );

    await screen.findByTestId("product-analytics-person-facts");

    expect(screen.getByTestId("product-analytics-person-back")).toHaveAttribute(
      "href",
      `${USERS_PATH}?range=Past+1+Week&people=dormant&dormant=90`,
    );
  });

  it("a refused read shows the server's words", async () => {
    mockDetail(
      new HTTPErrorResponse(
        403,
        { message: "You do not have permission to read session replays." },
        {},
      ),
    );

    renderAt(personPath(`u-${USER_KEY}`));

    await waitFor(() => {
      expect(
        screen.getByText("You do not have permission to read session replays."),
      ).toBeInTheDocument();
    });
  });

  it("pages through the sessions by offset", async () => {
    mockDetail((data: JSONObject): JSONObject => {
      return data["offset"]
        ? detail({ sessions: [session({ sessionId: SESSION_GONE })] })
        : detail({ sessions: [session({})], hasMore: true });
    });

    renderAt(personPath(`u-${USER_KEY}`));

    await screen.findByTestId("product-analytics-person-facts");

    await waitFor(() => {
      expect(sessionRows()).toHaveLength(1);
    });

    fireEvent.click(screen.getByTestId("pagination-next-button"));

    await waitFor(() => {
      expect(requests()).toHaveLength(2);
    });

    expect(requests()[1]!["offset"]).toBe(
      PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE,
    );

    await waitFor(() => {
      expect(
        within(sessionRows()[0]!).getByTestId("product-analytics-person-watch"),
      ).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_GONE}`,
      );
    });
  });
});

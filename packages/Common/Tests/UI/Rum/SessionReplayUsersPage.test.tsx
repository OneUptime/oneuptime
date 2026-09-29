import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import Navigation from "../../../UI/Utils/Navigation";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Users page (Pages/Rum/View/SessionReplayUsers.tsx), rendered against
 * a mocked /users. It reads its application from the URL like its sibling
 * pages, mirrors the time range into the address bar with the list's own
 * keys, and answers a row's Sessions action by NAVIGATING to the list:
 * visitor= for a browser, userKey= for a person - never the reference -
 * with the label parked in sessionStorage for the list to swap in.
 */

const postMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

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

import RumApplicationSessionReplayUsers from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplayUsers";
import { SESSION_REPLAY_USERS_PAGE_SIZE } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUsersTable";
import { USER_FILTER_LABEL_STORAGE_KEY_PREFIX } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_A: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const VISITOR_A: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const NOW: number = Date.now();
const DAY_MS: number = 24 * 60 * 60 * 1000;

/* The page reads its application one segment from the end of this path. */
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay-users`;
const STORAGE_KEY: string = `${USER_FILTER_LABEL_STORAGE_KEY_PREFIX}${APP_ID}`;

interface CapturedRequest {
  url: string;
  data: JSONObject;
}

function requestsTo(route: string): Array<CapturedRequest> {
  return postMock.mock.calls
    .map((call: Array<unknown>): CapturedRequest => {
      const request: { url: { toString: () => string }; data: JSONObject } =
        call[0] as { url: { toString: () => string }; data: JSONObject };

      return { url: request.url.toString(), data: request.data };
    })
    .filter((request: CapturedRequest): boolean => {
      return request.url.includes(route);
    });
}

function wireRollup(overrides?: JSONObject): JSONObject {
  return {
    groupKey: `u:${USER_KEY}`,
    kind: "identified",
    identifiedUserKey: USER_KEY,
    visitorId: VISITOR_A,
    identifiedUserLabel: "jane@acme.com",
    identifiedUserTraits: { plan: "pro" },
    sessionCount: 3,
    liveSessionCount: 0,
    firstSeenUnixMs: NOW - DAY_MS,
    lastSeenUnixMs: NOW - 60_000,
    totalDurationMs: 30 * 60_000,
    errorCount: 2,
    frustrationCount: 1,
    errorSessionCount: 1,
    pageCount: 9,
    lastSessionId: SESSION_A,
    lastEntryUrl: "https://app.acme.com/checkout",
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
    ...overrides,
  };
}

function visitorRollup(): JSONObject {
  return wireRollup({
    groupKey: `v:${VISITOR_A}`,
    kind: "visitor",
    identifiedUserKey: "",
    identifiedUserLabel: "",
    identifiedUserTraits: undefined,
  });
}

function mockUsers(users: Array<JSONObject>): void {
  postMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(
      new HTTPResponse<JSONObject>(200, { users: users, nextCursor: null }, {}),
    );
  });
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <RumApplicationSessionReplayUsers
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

async function waitForUserRows(count: number): Promise<Array<HTMLElement>> {
  await waitFor(() => {
    expect(screen.getAllByTestId("session-user-row").length).toBe(count);
  });

  return screen.getAllByTestId("session-user-row");
}

/* The Route the page handed to Navigation.navigate on its n-th call. */
function navigatedTo(index: number = 0): string {
  return (
    navigateMock.mock.calls[index]![0] as { toString: () => string }
  ).toString();
}

beforeEach(() => {
  postMock.mockReset();
  navigateMock.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", PAGE_PATH);

  jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((...args: Array<unknown>): void => {
      navigateMock(...args);
    });
});

describe("SessionReplayUsersPage rendering", () => {
  it("renders the rollup for the application in the URL, on the default window", async () => {
    mockUsers([wireRollup(), visitorRollup()]);

    renderPage();

    await waitForUserRows(2);

    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(requestsTo("/session-replay/users").length).toBe(1);
    expect(requestsTo("/session-replay/users")[0]!.data).toEqual(
      expect.objectContaining({
        rumApplicationId: APP_ID,
        limit: SESSION_REPLAY_USERS_PAGE_SIZE,
      }),
    );
    /* The list's controls have no business here. */
    expect(screen.queryByTestId("session-search-input")).toBeNull();
    expect(screen.queryByTestId("session-sort")).toBeNull();
    expect(screen.queryByTestId("session-view-toggle")).toBeNull();
    expect(
      screen.getByTestId("telemetry-time-range-picker-button"),
    ).toBeInTheDocument();
    /* A pristine page has a clean URL. */
    expect(window.location.search).toBe("");
  });

  it("opens on the named range the URL carries and normalises its encoding", async () => {
    mockUsers([wireRollup()]);

    window.history.replaceState(null, "", `${PAGE_PATH}?range=Past%201%20Week`);

    renderPage();

    await waitForUserRows(1);

    expect(
      screen.getByTestId("telemetry-time-range-picker-button"),
    ).toHaveTextContent("Past 1 Week");
    expect(window.location.search).toBe("?range=Past+1+Week");
  });

  it("opens on an absolute window, in the list's spelling or the overview tile's, and writes the canonical pair", async () => {
    const start: string = "2026-09-01T00:00:00.000Z";
    const end: string = "2026-09-01T01:00:00.000Z";
    const customLabel: string = getTimeRangeButtonLabel({
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(new Date(start), new Date(end)),
    });

    for (const search of [
      `?startTime=${start}&endTime=${end}`,
      /* The overview's tiles link with start/end; a stale range= must lose. */
      `?start=${start}&end=${end}&range=Past%201%20Week`,
    ]) {
      postMock.mockReset();
      mockUsers([wireRollup()]);
      window.history.replaceState(null, "", `${PAGE_PATH}${search}`);

      const view: ReturnType<typeof render> = renderPage();

      await waitForUserRows(1);

      expect(
        screen.getByTestId("telemetry-time-range-picker-button"),
      ).toHaveTextContent(customLabel);
      /* The rollup is asked for exactly that window. */
      expect(requestsTo("/session-replay/users")[0]!.data).toEqual(
        expect.objectContaining({
          startTime: OneUptimeDate.toString(new Date(start)),
          endTime: OneUptimeDate.toString(new Date(end)),
        }),
      );
      /* Written back as startTime/endTime only: no alias, no range=. */
      expect(window.location.search).toBe(
        `?startTime=${encodeURIComponent(start)}&endTime=${encodeURIComponent(
          end,
        )}`,
      );

      view.unmount();
    }
  });
});

describe("SessionReplayUsersPage time range", () => {
  it("a picked range refetches and is written to the URL with the list's key", async () => {
    mockUsers([wireRollup()]);

    renderPage();

    await waitForUserRows(1);

    fireEvent.click(screen.getByTestId("telemetry-time-range-picker-button"));
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Week" }));

    await waitFor(() => {
      expect(requestsTo("/session-replay/users").length).toBe(2);
    });

    expect(window.location.search).toBe("?range=Past+1+Week");

    /* Back to the default, and the URL is clean again. */
    fireEvent.click(screen.getByTestId("telemetry-time-range-picker-button"));
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Day" }));

    await waitFor(() => {
      expect(requestsTo("/session-replay/users").length).toBe(3);
    });

    expect(window.location.search).toBe("");
  });

  it("Refresh refetches the same window", async () => {
    mockUsers([wireRollup()]);

    renderPage();

    await waitForUserRows(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh users" }));

    await waitFor(() => {
      expect(requestsTo("/session-replay/users").length).toBe(2);
    });

    expect(
      requestsTo("/session-replay/users")[1]!.data["cursor"],
    ).toBeUndefined();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("SessionReplayUsersPage hand-off to the list", () => {
  it("Sessions on a visitor row navigates to the list with visitor= and the window", async () => {
    mockUsers([visitorRollup()]);

    window.history.replaceState(null, "", `${PAGE_PATH}?range=Past%201%20Week`);

    renderPage();

    await waitForUserRows(1);

    fireEvent.click(screen.getByTestId("session-user-view-sessions"));

    expect(navigateMock).toHaveBeenCalledTimes(1);

    const target: URL = new URL(navigatedTo(), "https://dash.example.com");

    expect(target.pathname.endsWith("/session-replay")).toBe(true);
    expect(target.pathname).toContain(APP_ID);
    expect(target.searchParams.get("visitor")).toBe(VISITOR_A);
    expect(target.searchParams.get("userKey")).toBeNull();
    expect(target.searchParams.get("range")).toBe("Past 1 Week");
    /* Nothing to park: a visitor id is safe in the URL as it is. */
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("Sessions on an identified row navigates with userKey= and parks the label, never the reference", async () => {
    mockUsers([wireRollup()]);

    renderPage();

    await waitForUserRows(1);

    fireEvent.click(screen.getByTestId("session-user-view-sessions"));

    expect(navigateMock).toHaveBeenCalledTimes(1);

    const href: string = navigatedTo();
    const target: URL = new URL(href, "https://dash.example.com");

    expect(target.pathname.endsWith("/session-replay")).toBe(true);
    expect(target.searchParams.get("userKey")).toBe(USER_KEY);
    expect(href).not.toContain("jane");
    expect(href).not.toContain("acme.com");
    /* The default window is absence on the list too. */
    expect(target.searchParams.get("range")).toBeNull();

    expect(
      JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) as string),
    ).toEqual({
      identifiedUserKey: USER_KEY,
      identifiedUserLabel: "jane@acme.com",
    });
  });

  it("a hidden label hands the digest and parks nothing", async () => {
    const hidden: JSONObject = wireRollup();

    delete hidden["identifiedUserLabel"];
    delete hidden["identifiedUserTraits"];

    mockUsers([hidden]);

    renderPage();

    await waitForUserRows(1);

    fireEvent.click(screen.getByTestId("session-user-view-sessions"));

    const target: URL = new URL(navigatedTo(), "https://dash.example.com");

    expect(target.searchParams.get("userKey")).toBe(USER_KEY);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("the Sessions card button goes to the unfiltered list on the same window", async () => {
    mockUsers([wireRollup()]);

    window.history.replaceState(null, "", `${PAGE_PATH}?range=Past%201%20Week`);

    renderPage();

    await waitForUserRows(1);

    /* The card's own button, not the row's Sessions action. */
    const cardButton: HTMLElement | undefined = screen
      .getAllByTestId("card-button")
      .find((button: HTMLElement): boolean => {
        return button.textContent?.trim() === "Sessions";
      });

    expect(cardButton).toBeDefined();

    fireEvent.click(cardButton as HTMLElement);

    expect(navigateMock).toHaveBeenCalledTimes(1);

    const target: string = navigatedTo();

    expect(target.endsWith("/session-replay?range=Past+1+Week")).toBe(true);
    expect(target).toContain(APP_ID);
    /* No person, no filter: only the window crosses. */
    expect(target).not.toContain("userKey=");
    expect(target).not.toContain("visitor=");
  });

  it("the Sessions card button writes the default window as absence", async () => {
    mockUsers([wireRollup()]);

    renderPage();

    await waitForUserRows(1);

    const cardButton: HTMLElement | undefined = screen
      .getAllByTestId("card-button")
      .find((button: HTMLElement): boolean => {
        return button.textContent?.trim() === "Sessions";
      });

    fireEvent.click(cardButton as HTMLElement);

    const target: string = navigatedTo();

    expect(target.endsWith("/session-replay")).toBe(true);
    expect(target).not.toContain("?");
  });
});

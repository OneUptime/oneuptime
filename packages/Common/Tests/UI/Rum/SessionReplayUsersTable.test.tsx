import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Users view: the session window rolled up by person against a
 * mocked /users. One row per identified user, visitor and the anonymous
 * bucket, each named the way the session list names them; a withheld
 * label reads Hidden; the row and its Sessions action hand the person's
 * filter back with the key and label it was rolled up under; Watch latest
 * sits in the row's ⋯ menu beside Sessions and opens the newest recording
 * (a real link when it is the row's only action);
 * paging echoes the server's cursor; empty and error states are honest.
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

import SessionReplayUsersTable, {
  getWatchLatestMenuRoute,
  SESSION_REPLAY_USERS_PAGE_SIZE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUsersTable";
import { parseSessionReplayUserRollup } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUsersApi";
import { SessionReplayUserSessionsHandoff } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_A: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_B: string = "b2c3d4e5f60718293a4b5c6d7e8f90a1";
const VISITOR_A: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const NOW: number = Date.now();
const DAY_MS: number = 24 * 60 * 60 * 1000;
const RANGE: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_DAY };

interface CapturedRequest {
  url: string;
  data: JSONObject;
}

function requests(): Array<CapturedRequest> {
  return postMock.mock.calls.map((call: Array<unknown>): CapturedRequest => {
    const request: { url: { toString: () => string }; data: JSONObject } =
      call[0] as { url: { toString: () => string }; data: JSONObject };

    return { url: request.url.toString(), data: request.data };
  });
}

function wireRollup(overrides?: JSONObject): JSONObject {
  return {
    groupKey: `u:${USER_KEY}`,
    kind: "identified",
    identifiedUserKey: USER_KEY,
    visitorId: VISITOR_A,
    identifiedUserLabel: "jane@acme.com",
    identifiedUserTraits: { plan: "pro", tenant: "acme" },
    sessionCount: "12",
    liveSessionCount: 0,
    firstSeenUnixMs: NOW - 2 * DAY_MS,
    lastSeenUnixMs: NOW - 5 * 60_000,
    totalDurationMs: 90 * 60_000 + 12_000,
    errorCount: 4,
    frustrationCount: 2,
    errorSessionCount: 3,
    pageCount: 40,
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

/* A browser the recorder linked with a visitor id; its newest session is B. */
const VISITOR_ROLLUP: JSONObject = {
  groupKey: `v:${VISITOR_A}`,
  kind: "visitor",
  identifiedUserKey: "",
  identifiedUserLabel: "",
  lastSessionId: SESSION_B,
};

/* The "Unlinked sessions" bucket: nobody to filter by. */
const UNLINKED_ROLLUP: JSONObject = {
  groupKey: "",
  kind: "anonymous",
  identifiedUserKey: "",
  visitorId: "",
  identifiedUserLabel: "",
  identifiedUserTraits: {},
};

function usersResponse(
  users: Array<JSONObject>,
  nextCursor: JSONObject | null = null,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    { users: users, nextCursor: nextCursor },
    {},
  );
}

function mockUsers(
  answer: (
    data: JSONObject,
    index: number,
  ) => HTTPResponse<JSONObject> | HTTPErrorResponse,
): void {
  let calls: number = 0;

  postMock.mockImplementation((request: unknown): Promise<unknown> => {
    const typed: { data: JSONObject } = request as { data: JSONObject };
    const index: number = calls;

    calls += 1;

    return Promise.resolve(answer(typed.data, index));
  });
}

function renderTable(
  overrides?: Partial<{
    reloadToken: number;
    onViewUserSessions: (handoff: SessionReplayUserSessionsHandoff) => void;
    timeRange: RangeStartAndEndDateTime;
  }>,
): { view: ReturnType<typeof render>; onViewUserSessions: MockFunction } {
  const onViewUserSessions: MockFunction = getJestMockFunction();

  const view: ReturnType<typeof render> = render(
    <MemoryRouter>
      <SessionReplayUsersTable
        rumApplicationId={APP_ID}
        timeRange={overrides?.timeRange ?? RANGE}
        reloadToken={overrides?.reloadToken ?? 0}
        onViewUserSessions={overrides?.onViewUserSessions ?? onViewUserSessions}
      />
    </MemoryRouter>,
  );

  return { view, onViewUserSessions };
}

async function waitForUserRows(count: number): Promise<Array<HTMLElement>> {
  await waitFor(() => {
    expect(screen.getAllByTestId("session-user-row").length).toBe(count);
  });

  return screen.getAllByTestId("session-user-row");
}

beforeEach(() => {
  postMock.mockReset();
  navigateMock.mockReset();

  jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((...args: Array<unknown>): void => {
      navigateMock(...args);
    });
});

describe("SessionReplayUsersTable rendering", () => {
  it("names an identified user, a visitor and the anonymous bucket the way the list does", async () => {
    mockUsers(() => {
      return usersResponse([
        wireRollup(),
        wireRollup({
          groupKey: `v:${VISITOR_A}`,
          kind: "visitor",
          identifiedUserKey: "",
          identifiedUserLabel: "",
          identifiedUserTraits: {},
          sessionCount: 2,
          liveSessionCount: 1,
          errorCount: 0,
          frustrationCount: 0,
          lastSessionId: SESSION_B,
          browserName: "Mobile Safari",
          browserVersion: "17",
          osName: "iOS",
          deviceType: "mobile",
          countryCode: "GB",
        }),
        wireRollup({
          groupKey: "",
          kind: "anonymous",
          identifiedUserKey: "",
          visitorId: "",
          identifiedUserLabel: "",
          identifiedUserTraits: {},
          sessionCount: 5,
          errorCount: 0,
          frustrationCount: 0,
          lastSessionId: "",
        }),
      ]);
    });

    renderTable();

    const rows: Array<HTMLElement> = await waitForUserRows(3);
    const names: Array<HTMLElement> =
      screen.getAllByTestId("session-user-name");

    expect(names[0]).toHaveTextContent("jane@acme.com");
    expect(names[0]).toHaveAttribute("data-user-kind", "identified");
    expect(rows[0]).toHaveTextContent("Chrome 126 · macOS · DE · 2 traits");
    expect(rows[0]).toHaveTextContent("12");
    expect(rows[0]).toHaveTextContent("first seen 2 days ago");
    expect(rows[0]).toHaveTextContent("1h 30m");
    expect(rows[0]).toHaveTextContent("40 pages");
    expect(rows[0]).toHaveTextContent("4 errors");
    expect(rows[0]).toHaveTextContent("2 frustration");
    expect(rows[0]).toHaveAttribute("data-group-key", `u:${USER_KEY}`);

    expect(names[1]).toHaveTextContent("Visitor 7f3a2b");
    expect(names[1]).toHaveAttribute("data-user-kind", "visitor");
    expect(rows[1]).toHaveTextContent("Mobile Safari 17 · iOS · GB");
    expect(rows[1]).not.toHaveTextContent("traits");
    expect(rows[1]).toHaveTextContent("1 live");
    expect(rows[1]).toHaveTextContent("Clean");

    expect(names[2]).toHaveTextContent("Unlinked sessions");
    expect(rows[2]).toHaveTextContent(
      "Recorded by a recorder that sent no visitor id",
    );
    expect(rows[2]).toHaveAttribute("data-group-key", "");
    /* Nothing to filter by, so nothing to click. */
    expect(
      rows[2]!.querySelector('[data-testid="session-user-view-sessions"]'),
    ).toBeNull();
    expect(rows[2]).not.toHaveAttribute("tabindex");
  });

  it("an identified group whose label was withheld reads Hidden, not Anonymous", async () => {
    const hidden: JSONObject = wireRollup();

    delete hidden["identifiedUserLabel"];
    delete hidden["identifiedUserTraits"];

    mockUsers(() => {
      return usersResponse([hidden]);
    });

    renderTable();

    const [row] = await waitForUserRows(1);

    expect(screen.getByTestId("session-user-name")).toHaveTextContent("Hidden");
    expect(screen.getByTestId("session-user-name")).toHaveAttribute(
      "data-user-kind",
      "hidden",
    );
    expect(row).not.toHaveTextContent("Anonymous");
    expect(row).not.toHaveTextContent("traits");
  });

  it("sends the window and page size, and shows skeleton rows while loading", async () => {
    let resolveUsers: (value: HTTPResponse<JSONObject>) => void = (): void => {
      /* replaced below */
    };

    postMock.mockImplementation((): Promise<HTTPResponse<JSONObject>> => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void): void => {
          resolveUsers = resolve;
        },
      );
    });

    renderTable();

    expect(screen.getByTestId("table-skeleton-loader")).toBeInTheDocument();

    const sent: JSONObject = requests()[0]!.data;

    expect(requests()[0]!.url).toContain("/telemetry/rum/session-replay/users");
    expect(sent["rumApplicationId"]).toBe(APP_ID);
    expect(sent["limit"]).toBe(SESSION_REPLAY_USERS_PAGE_SIZE);
    expect(typeof sent["startTime"]).toBe("string");
    expect(typeof sent["endTime"]).toBe("string");
    expect(sent["cursor"]).toBeUndefined();

    resolveUsers(usersResponse([wireRollup()]));

    await waitForUserRows(1);

    expect(screen.queryByTestId("table-skeleton-loader")).toBeNull();
  });
});

describe("SessionReplayUsersTable actions", () => {
  it("the Sessions action hands back the reference for a visible label, with the key it is stored under", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup()]);
    });

    const { onViewUserSessions } = renderTable();

    await waitForUserRows(1);

    fireEvent.click(screen.getByTestId("session-user-view-sessions"));

    expect(onViewUserSessions).toHaveBeenCalledTimes(1);
    /*
     * The key rides beside the reference because the page puts the KEY in
     * the list's URL and parks the label out of it; without the key the
     * hand-off could only carry the reference, which never goes in a URL.
     */
    expect(onViewUserSessions).toHaveBeenCalledWith({
      filter: { identifiedUserRef: "jane@acme.com" },
      identifiedUserKey: USER_KEY,
      identifiedUserLabel: "jane@acme.com",
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("the Sessions action hands back the digest for a hidden label and the visitor id for a visitor", async () => {
    const hidden: JSONObject = wireRollup();

    delete hidden["identifiedUserLabel"];

    mockUsers(() => {
      return usersResponse([
        hidden,
        wireRollup({
          groupKey: `v:${VISITOR_A}`,
          kind: "visitor",
          identifiedUserKey: "",
          identifiedUserLabel: "",
        }),
      ]);
    });

    const { onViewUserSessions } = renderTable();

    await waitForUserRows(2);

    const actions: Array<HTMLElement> = screen.getAllByTestId(
      "session-user-view-sessions",
    );

    fireEvent.click(actions[0] as HTMLElement);
    fireEvent.click(actions[1] as HTMLElement);

    /* A withheld label is an empty string, never the label the server kept back. */
    expect(onViewUserSessions.mock.calls[0]![0]).toEqual({
      filter: { identifiedUserKey: USER_KEY },
      identifiedUserKey: USER_KEY,
      identifiedUserLabel: "",
    });
    expect(onViewUserSessions.mock.calls[1]![0]).toEqual({
      filter: { visitorId: VISITOR_A },
      identifiedUserKey: "",
      identifiedUserLabel: "",
    });
  });

  it("the whole row and Enter activate the same filter; a click on Watch latest does not", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup()]);
    });

    const { onViewUserSessions } = renderTable();

    const [row] = await waitForUserRows(1);

    fireEvent.click(row as HTMLElement);
    fireEvent.keyDown(row as HTMLElement, { key: "Enter" });

    expect(onViewUserSessions).toHaveBeenCalledTimes(2);

    /* Opening the row's ⋯ menu is the ⋯'s click, not the row's. */
    fireEvent.click(
      within(row as HTMLElement).getByTestId("row-actions-more-button"),
    );

    expect(onViewUserSessions).toHaveBeenCalledTimes(2);

    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Watch latest",
      }),
    );

    /* The item's own navigation, not a third filter call. */
    expect(onViewUserSessions).toHaveBeenCalledTimes(2);
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it("Watch latest opens the newest session's player route", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup()]);
    });

    renderTable();

    const [row] = await waitForUserRows(1);

    fireEvent.click(
      within(row as HTMLElement).getByTestId("row-actions-more-button"),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Watch latest",
      }),
    );

    expect(navigateMock).toHaveBeenCalledTimes(1);

    const route: string = (
      navigateMock.mock.calls[0]![0] as { toString: () => string }
    ).toString();

    expect(route).toContain(`/${SESSION_A}`);
    expect(route).toContain(APP_ID);
  });
});

/*
 * Each row shows one control and a ⋯ menu for the other. With a person to
 * filter by, Sessions is the button and Watch latest waits in the menu;
 * the unlinked bucket has nobody to filter by, so its newest recording is
 * the button itself - a real link, no menu of one. A row with nothing to
 * open has neither.
 */
/*
 * Watch latest goes in the ⋯ menu exactly when Sessions is the row's
 * button - there is a person to filter by - and there is a recording to
 * open. Everywhere else the menu has nothing to hold.
 */
describe("getWatchLatestMenuRoute", () => {
  function menuRouteFor(overrides?: JSONObject): string | null {
    const route: { toString: () => string } | null = getWatchLatestMenuRoute(
      parseSessionReplayUserRollup(wireRollup(overrides)),
      APP_ID,
    );

    return route ? route.toString() : null;
  }

  it("is the newest session's player route for an identified person", () => {
    const route: string | null = menuRouteFor();

    expect(route).toContain(APP_ID);
    expect(route).toContain(`/${SESSION_A}`);
  });

  it("is the newest session's player route for a visitor", () => {
    expect(menuRouteFor(VISITOR_ROLLUP)).toContain(`/${SESSION_B}`);
  });

  it("is the route for a withheld label that still has a key to filter by", () => {
    const hidden: JSONObject = wireRollup();

    delete hidden["identifiedUserLabel"];

    expect(
      getWatchLatestMenuRoute(
        parseSessionReplayUserRollup(hidden),
        APP_ID,
      )?.toString(),
    ).toContain(`/${SESSION_A}`);
  });

  it("is null for a withheld label with no key: nobody to filter by, so Watch latest is the row's button", () => {
    const hidden: JSONObject = wireRollup({ identifiedUserKey: "" });

    delete hidden["identifiedUserLabel"];

    expect(
      getWatchLatestMenuRoute(parseSessionReplayUserRollup(hidden), APP_ID),
    ).toBeNull();
  });

  it("is null for the unlinked bucket, even with a recording to open", () => {
    expect(menuRouteFor(UNLINKED_ROLLUP)).toBeNull();
  });

  it("is null for a person with no recording to open", () => {
    expect(menuRouteFor({ lastSessionId: "" })).toBeNull();
  });
});

describe("SessionReplayUsersTable row actions", () => {
  function moreButtonOf(row: HTMLElement): HTMLElement | null {
    return within(row).queryByTestId("row-actions-more-button");
  }

  function openMenuOf(row: HTMLElement): HTMLElement {
    fireEvent.click(moreButtonOf(row) as HTMLElement);

    return screen.getByRole("menu");
  }

  function navigatedTo(callIndex: number): string {
    return (
      navigateMock.mock.calls[callIndex]![0] as { toString: () => string }
    ).toString();
  }

  function actionsCellOf(row: HTMLElement): HTMLElement {
    const cells: Array<HTMLElement> = Array.from(row.querySelectorAll("td"));

    return cells[cells.length - 1] as HTMLElement;
  }

  it("a person's row shows Sessions as its one button and Watch latest in its ⋯ menu", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup()]);
    });

    const { onViewUserSessions } = renderTable();

    const [row] = await waitForUserRows(1);
    const cell: HTMLElement = actionsCellOf(row as HTMLElement);

    /*
     * Two buttons in the cell: Sessions and the ⋯ beside it. The old small
     * Watch latest link under Sessions is gone.
     */
    expect(within(cell).getAllByRole("button")).toEqual([
      within(cell).getByTestId("session-user-view-sessions"),
      moreButtonOf(row as HTMLElement),
    ]);
    expect(within(cell).queryAllByRole("link")).toHaveLength(0);
    expect(within(cell).queryByTestId("session-user-watch-latest")).toBeNull();
    expect(moreButtonOf(row as HTMLElement)).toHaveAttribute(
      "aria-label",
      "More actions",
    );

    /* Sessions keeps its person-specific title. */
    expect(
      within(cell).getByTestId("session-user-view-sessions"),
    ).toHaveAttribute("title", "List every session from jane@acme.com");

    const menu: HTMLElement = openMenuOf(row as HTMLElement);

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Watch latest"]);
    /* Portalled out of the row, so the table's overflow cannot clip it. */
    expect(row).not.toContainElement(menu);

    expect(onViewUserSessions).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("a person with no recording to open shows Sessions and no ⋯", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup({ lastSessionId: "" })]);
    });

    renderTable();

    const [row] = await waitForUserRows(1);

    expect(
      within(row as HTMLElement).getByTestId("session-user-view-sessions"),
    ).toBeInTheDocument();
    expect(moreButtonOf(row as HTMLElement)).toBeNull();
    expect(within(row as HTMLElement).queryByTestId("row-actions")).toBeNull();
  });

  it("the unlinked bucket's newest recording is its one button: a real link, and no ⋯", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup(UNLINKED_ROLLUP)]);
    });

    const { onViewUserSessions } = renderTable();

    const [row] = await waitForUserRows(1);
    const cell: HTMLElement = actionsCellOf(row as HTMLElement);

    expect(within(cell).queryByTestId("session-user-view-sessions")).toBeNull();
    expect(moreButtonOf(row as HTMLElement)).toBeNull();

    const link: HTMLAnchorElement = within(cell)
      .getByTestId("session-user-watch-latest")
      .closest("a") as HTMLAnchorElement;

    expect(within(cell).getAllByRole("link")).toEqual([link]);
    expect(link.getAttribute("href")).toContain(`/${SESSION_A}`);
    expect(link.getAttribute("href")).toContain(APP_ID);
    expect(link).toHaveAttribute(
      "title",
      `Watch the newest session (${SESSION_A.slice(0, 8)})`,
    );

    fireEvent.click(link);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigatedTo(0)).toContain(`/${SESSION_A}`);
    expect(onViewUserSessions).not.toHaveBeenCalled();
  });

  it("the unlinked bucket with no recording shows no action at all", async () => {
    mockUsers(() => {
      return usersResponse([
        wireRollup({ ...UNLINKED_ROLLUP, lastSessionId: "" }),
      ]);
    });

    renderTable();

    const [row] = await waitForUserRows(1);
    const cell: HTMLElement = actionsCellOf(row as HTMLElement);

    expect(within(cell).queryAllByRole("button")).toHaveLength(0);
    expect(within(cell).queryAllByRole("link")).toHaveLength(0);
  });

  it("only the rows with both a person and a recording carry a ⋯", async () => {
    mockUsers(() => {
      return usersResponse([
        wireRollup(),
        wireRollup({ ...VISITOR_ROLLUP, lastSessionId: "" }),
        wireRollup(UNLINKED_ROLLUP),
      ]);
    });

    renderTable();

    const rows: Array<HTMLElement> = await waitForUserRows(3);

    expect(
      rows.map((row: HTMLElement): boolean => {
        return Boolean(moreButtonOf(row));
      }),
    ).toEqual([true, false, false]);
  });

  it("choosing Watch latest opens THAT row's newest session, and never filters by the person", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup(), wireRollup(VISITOR_ROLLUP)]);
    });

    const { onViewUserSessions } = renderTable();

    const rows: Array<HTMLElement> = await waitForUserRows(2);

    fireEvent.click(
      within(openMenuOf(rows[1] as HTMLElement)).getByRole("menuitem", {
        name: "Watch latest",
      }),
    );

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigatedTo(0)).toContain(`/${SESSION_B}`);
    expect(navigatedTo(0)).not.toContain(SESSION_A);
    expect(onViewUserSessions).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });

    fireEvent.click(
      within(openMenuOf(rows[0] as HTMLElement)).getByRole("menuitem", {
        name: "Watch latest",
      }),
    );

    expect(navigateMock).toHaveBeenCalledTimes(2);
    expect(navigatedTo(1)).toContain(`/${SESSION_A}`);
    expect(onViewUserSessions).not.toHaveBeenCalled();
  });

  it("Enter on the focused Watch latest item opens it once, and the row does not also filter", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup()]);
    });

    const { onViewUserSessions } = renderTable();

    const [row] = await waitForUserRows(1);
    const item: HTMLElement = within(openMenuOf(row as HTMLElement)).getByRole(
      "menuitem",
      { name: "Watch latest" },
    );

    act((): void => {
      item.focus();
    });

    fireEvent.keyDown(item, { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigatedTo(0)).toContain(`/${SESSION_A}`);
    expect(onViewUserSessions).not.toHaveBeenCalled();
  });

  it("a click inside the open menu but off its items does not filter by the row's person", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup()]);
    });

    const { onViewUserSessions } = renderTable();

    const [row] = await waitForUserRows(1);
    const menu: HTMLElement = openMenuOf(row as HTMLElement);

    /*
     * The menu is portalled to document.body but React bubbles its clicks
     * to the row all the same; the menu's own padding is not the row.
     */
    fireEvent.click(menu);

    expect(onViewUserSessions).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("Sessions beside the ⋯ still hands back this row's person", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup(), wireRollup(VISITOR_ROLLUP)]);
    });

    const { onViewUserSessions } = renderTable();

    const rows: Array<HTMLElement> = await waitForUserRows(2);

    fireEvent.click(
      within(rows[1] as HTMLElement).getByTestId("session-user-view-sessions"),
    );

    expect(onViewUserSessions).toHaveBeenCalledTimes(1);
    expect(onViewUserSessions.mock.calls[0]![0]).toEqual({
      filter: { visitorId: VISITOR_A },
      identifiedUserKey: "",
      identifiedUserLabel: "",
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("SessionReplayUsersTable row actions on a phone", () => {
  let originalInnerWidth: number = 0;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 375,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
  });

  it("a card keeps Sessions and the ⋯, and the menu still opens that person's newest session", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup(), wireRollup(VISITOR_ROLLUP)]);
    });

    const { onViewUserSessions } = renderTable();

    const cards: Array<HTMLElement> = await waitForUserRows(2);

    /* Cards, not table rows. */
    expect(cards[0]!.tagName).toBe("DIV");
    expect(
      within(cards[1] as HTMLElement).getByTestId("session-user-view-sessions"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(cards[1] as HTMLElement).getByTestId("row-actions-more-button"),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Watch latest",
      }),
    );

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(
      (navigateMock.mock.calls[0]![0] as { toString: () => string }).toString(),
    ).toContain(`/${SESSION_B}`);
    expect(onViewUserSessions).not.toHaveBeenCalled();
  });
});

describe("SessionReplayUsersTable paging, reload, empty and error", () => {
  it("uses the shared ModelTable footer with the fixed users page size", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup()]);
    });

    renderTable();

    await waitForUserRows(1);

    const pagination: HTMLElement = screen.getByTestId(
      "session-users-pagination",
    );

    expect(pagination.parentElement).toHaveClass("bg-gray-50", "md:-mx-6");
    expect(
      Array.from(
        screen
          .getByTestId("pagination-items-on-page-select")
          .querySelectorAll("option"),
      ).map((option: Element): string | null => {
        return option.getAttribute("value");
      }),
    ).toEqual([String(SESSION_REPLAY_USERS_PAGE_SIZE)]);
  });

  it("Next pages with the server's cursor and Next is disabled on the last page", async () => {
    const cursor: JSONObject = {
      lastSeenUnixMs: NOW - 5 * 60_000,
      groupKey: `u:${USER_KEY}`,
    };

    mockUsers((data: JSONObject, index: number) => {
      if (index === 0) {
        return usersResponse([wireRollup()], cursor);
      }

      expect(data["cursor"]).toEqual(cursor);

      return usersResponse(
        [
          wireRollup({
            groupKey: `v:${VISITOR_A}`,
            kind: "visitor",
            identifiedUserKey: "",
            identifiedUserLabel: "",
          }),
        ],
        null,
      );
    });

    renderTable();

    await waitForUserRows(1);

    const next: HTMLElement = screen.getByTestId("pagination-next-button");

    expect(next).not.toBeDisabled();

    fireEvent.click(next);

    await waitFor(() => {
      expect(requests().length).toBe(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId("session-user-name")).toHaveTextContent(
        "Visitor 7f3a2b",
      );
    });

    expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
  });

  it("a bumped reloadToken refetches, and a changed range restarts from page one", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup()], {
        lastSeenUnixMs: 1,
        groupKey: "x",
      });
    });

    const { view } = renderTable();

    await waitForUserRows(1);

    fireEvent.click(screen.getByTestId("pagination-next-button"));

    await waitFor(() => {
      expect(requests().length).toBe(2);
    });

    expect(requests()[1]!.data["cursor"]).toEqual({
      lastSeenUnixMs: 1,
      groupKey: "x",
    });

    view.rerender(
      <MemoryRouter>
        <SessionReplayUsersTable
          rumApplicationId={APP_ID}
          timeRange={{ range: TimeRange.PAST_ONE_WEEK }}
          reloadToken={0}
          onViewUserSessions={(): void => {
            /* unused */
          }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(requests().length).toBe(3);
    });

    /* Page one of the new window: no cursor. */
    expect(requests()[2]!.data["cursor"]).toBeUndefined();

    view.rerender(
      <MemoryRouter>
        <SessionReplayUsersTable
          rumApplicationId={APP_ID}
          timeRange={{ range: TimeRange.PAST_ONE_WEEK }}
          reloadToken={1}
          onViewUserSessions={(): void => {
            /* unused */
          }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(requests().length).toBe(4);
    });
  });

  it("an empty window says nobody is here yet", async () => {
    mockUsers(() => {
      return usersResponse([]);
    });

    renderTable();

    await waitFor(() => {
      expect(screen.getByTestId("session-users-empty")).toBeInTheDocument();
    });

    expect(screen.getByTestId("session-users-empty")).toHaveTextContent(
      "No sessions in this range, so nobody to show yet.",
    );
    expect(screen.getByTestId("session-users-empty")).toHaveTextContent(
      "Widen the time range",
    );
    /*
     * Every table leaves its footer out under an empty first page: the empty
     * state already says nobody is here, and "No users" under it said it
     * twice.
     */
    expect(screen.queryByTestId("session-users-pagination")).toBeNull();
    expect(screen.queryByTestId("pagination-summary")).toBeNull();
  });

  it("a failed request reads as its kind, with a Retry that refetches", async () => {
    mockUsers((_data: JSONObject, index: number) => {
      return index === 0
        ? new HTTPErrorResponse(403, { message: "Not allowed here." }, {})
        : usersResponse([wireRollup()]);
    });

    renderTable();

    await waitFor(() => {
      expect(screen.getByTestId("session-users-error")).toHaveAttribute(
        "data-kind",
        "permission",
      );
    });

    expect(screen.getByTestId("session-users-error")).toHaveTextContent(
      "Not allowed here.",
    );
    expect(screen.queryByTestId("session-users-empty")).toBeNull();

    fireEvent.click(screen.getByTestId("session-users-error-retry"));

    await waitForUserRows(1);

    expect(screen.queryByTestId("session-users-error")).toBeNull();
  });
});

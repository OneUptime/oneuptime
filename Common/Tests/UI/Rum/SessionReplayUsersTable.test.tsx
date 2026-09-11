import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
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
 * is a real link to the newest recording;
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
  SESSION_REPLAY_USERS_PAGE_SIZE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUsersTable";
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

    fireEvent.click(screen.getByTestId("session-user-watch-latest"));

    /* The link's own navigation, not a third filter call. */
    expect(onViewUserSessions).toHaveBeenCalledTimes(2);
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it("Watch latest links to the newest session's player route", async () => {
    mockUsers(() => {
      return usersResponse([wireRollup()]);
    });

    renderTable();

    await waitForUserRows(1);

    const link: HTMLAnchorElement = screen
      .getByTestId("session-user-watch-latest")
      .closest("a") as HTMLAnchorElement;

    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain(`/${SESSION_A}`);
    expect(link.getAttribute("href")).toContain(APP_ID);
  });
});

describe("SessionReplayUsersTable paging, reload, empty and error", () => {
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
    expect(screen.queryByTestId("session-users-pagination")).toBeNull();
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

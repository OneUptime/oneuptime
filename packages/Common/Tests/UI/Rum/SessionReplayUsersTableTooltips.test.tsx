import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import TimeRange from "../../../Types/Time/TimeRange";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Session Replay Users table's (i) tooltips: Sessions, Last seen, Time
 * and Signals explain themselves in their headers; User and Actions do not.
 *
 * Each (i) is hovered and must show its own text from
 * RUM_REPLAY_USERS_METRIC_DESCRIPTIONS, it sits in the header - never in a
 * row, whose click opens the person's sessions - and the cells under each
 * header read the rollup fields the text describes.
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

import SessionReplayUsersTable from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUsersTable";
import {
  RUM_REPLAY_USERS_METRIC_DESCRIPTIONS,
  RumReplayUsersMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/RumMetricDescriptions";
import { expectReadableDescriptionRecord } from "../../App/Dashboard/MetricDescriptionRules";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const HOUR_MS: number = 60 * 60 * 1000;
// Every (i) is a button named "About <what it explains>".
const INFO_BUTTON_NAME: RegExp = /^About /;

function wireRollup(overrides?: JSONObject): JSONObject {
  const now: number = Date.now();

  return {
    groupKey: `u:${USER_KEY}`,
    kind: "identified",
    identifiedUserKey: USER_KEY,
    visitorId: "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c",
    identifiedUserLabel: "jane@acme.com",
    identifiedUserTraits: {},
    sessionCount: 3,
    liveSessionCount: 0,
    firstSeenUnixMs: now - 5 * HOUR_MS,
    lastSeenUnixMs: now - 2 * HOUR_MS,
    totalDurationMs: 45 * 60 * 1000,
    errorCount: 4,
    frustrationCount: 2,
    errorSessionCount: 1,
    pageCount: 0,
    lastSessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    lastEntryUrl: "https://app.acme.com/checkout",
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
    ...overrides,
  };
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderTable(users: Array<JSONObject>): Promise<void> {
  postMock.mockImplementation((): Promise<HTTPResponse<JSONObject>> => {
    return Promise.resolve(
      new HTTPResponse<JSONObject>(200, { users, nextCursor: null }, {}),
    );
  });

  render(
    <MemoryRouter>
      <SessionReplayUsersTable
        rumApplicationId={APP_ID}
        timeRange={{ range: TimeRange.PAST_ONE_DAY }}
        reloadToken={0}
        onViewUserSessions={onViewUserSessions}
      />
    </MemoryRouter>,
  );

  await flush();
}

let onViewUserSessions: MockFunction = getJestMockFunction();

function infoButton(title: string): HTMLElement {
  const found: Array<HTMLElement> = screen.getAllByRole("button", {
    name: `About ${title}`,
  });
  expect(found).toHaveLength(1);
  return found[0]!;
}

function allInfoLabels(): Array<string> {
  return screen
    .queryAllByRole("button", { name: INFO_BUTTON_NAME })
    .map((button: HTMLElement): string => {
      return (button.getAttribute("aria-label") || "").replace("About ", "");
    });
}

async function tooltipTextOf(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();

  const text: string =
    document.getElementById(describedBy as string)?.textContent || "";

  fireEvent.mouseLeave(button);

  return text;
}

async function expectExplained(
  title: string,
  key: RumReplayUsersMetric,
): Promise<void> {
  const button: HTMLElement = infoButton(title);

  expect(button.closest("thead")).not.toBeNull();
  expect(button.parentElement?.closest("button, a")).toBeNull();
  expect(await tooltipTextOf(button)).toBe(
    RUM_REPLAY_USERS_METRIC_DESCRIPTIONS[key],
  );
}

/* The row's cells, in column order: User, Sessions, Last seen, Time, Signals, Actions. */
function rowCells(): Array<HTMLElement> {
  const [row] = screen.getAllByTestId("session-user-row");

  return Array.from(row!.querySelectorAll("td"));
}

beforeEach(() => {
  jest.useFakeTimers();
  postMock.mockReset();
  onViewUserSessions = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the Session Replay Users descriptions", () => {
  test("read as short, finished, distinct sentences", () => {
    expectReadableDescriptionRecord(
      RUM_REPLAY_USERS_METRIC_DESCRIPTIONS,
      "RUM_REPLAY_USERS_METRIC_DESCRIPTIONS",
    );
  });
});

describe("SessionReplayUsersTable header tooltips", () => {
  test("Sessions, Last seen, Time and Signals explain themselves; User and Actions do not", async () => {
    await renderTable([wireRollup()]);

    expect(screen.getAllByTestId("session-user-row")).toHaveLength(1);
    expect(allInfoLabels()).toEqual([
      "Sessions",
      "Last seen",
      "Time",
      "Signals",
    ]);

    await expectExplained("Sessions", "sessions");
    await expectExplained("Last seen", "lastSeen");
    await expectExplained("Time", "time");
    await expectExplained("Signals", "signals");
  });

  test("the headers carry their (i) even when the range is empty", async () => {
    await renderTable([]);

    expect(screen.getByTestId("session-users-empty")).toBeInTheDocument();
    expect(allInfoLabels()).toEqual([
      "Sessions",
      "Last seen",
      "Time",
      "Signals",
    ]);
  });

  test("clicking or pressing Enter on an (i) never opens a person's sessions", async () => {
    await renderTable([wireRollup()]);

    const info: HTMLElement = infoButton("Signals");

    fireEvent.click(info);
    fireEvent.keyDown(info, { key: "Enter" });

    expect(onViewUserSessions).not.toHaveBeenCalled();

    // The row itself still does.
    fireEvent.click(screen.getByTestId("session-user-row"));

    expect(onViewUserSessions).toHaveBeenCalledTimes(1);
  });
});

describe("SessionReplayUsersTable cells read what the header texts describe", () => {
  test("Sessions shows the count, then live sessions or the earliest start in the range", async () => {
    await renderTable([
      wireRollup(),
      wireRollup({
        groupKey: "v:visitor-2",
        kind: "visitor",
        identifiedUserKey: "",
        identifiedUserLabel: "",
        visitorId: "visitor-2",
        sessionCount: 2,
        liveSessionCount: 1,
      }),
    ]);

    const rows: Array<HTMLElement> = screen.getAllByTestId("session-user-row");
    const [, firstSessions] = Array.from(rows[0]!.querySelectorAll("td"));
    const [, secondSessions] = Array.from(rows[1]!.querySelectorAll("td"));

    expect(firstSessions).toHaveTextContent("3");
    // firstSeenUnixMs is the earliest session IN THE RANGE, five hours ago.
    expect(firstSessions).toHaveTextContent("first seen 5 hours ago");
    expect(secondSessions).toHaveTextContent("2");
    expect(secondSessions).toHaveTextContent("1 live");
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.sessions).toContain(
      "not necessarily their first visit ever",
    );
  });

  test("Last seen is the newest session's start, however long that session has run", async () => {
    await renderTable([wireRollup()]);

    const lastSeen: HTMLElement = within(rowCells()[2]!).getByTestId(
      "session-user-last-seen",
    );

    expect(lastSeen).toHaveTextContent("2 hours ago");
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.lastSeen).toContain(
      "newest session in the selected range started",
    );
  });

  test("Time adds the durations up; its page line is the route-change count, which can be 0", async () => {
    await renderTable([wireRollup()]);

    const time: HTMLElement = rowCells()[3]!;

    expect(time).toHaveTextContent("45m");
    /*
     * pageCount is the recorder's route-change counter, so a person who
     * only ever loaded pages in full reads "0 pages" - which is why the
     * text says a page opened by a full load is not counted.
     */
    expect(time).toHaveTextContent("0 pages");
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.time).toContain(
      "a page opened by a full load is not counted",
    );
  });

  test("Signals shows the summed error and frustration counts, with the error sessions on hover", async () => {
    await renderTable([wireRollup()]);

    const signals: HTMLElement = rowCells()[4]!;

    expect(signals).toHaveTextContent("4 errors");
    expect(signals).toHaveTextContent("2 frustration");
    expect(
      within(signals).getByText("4 errors").closest("[title]"),
    ).toHaveAttribute("title", "in 1 session");
  });
});

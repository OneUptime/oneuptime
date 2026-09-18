import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The schedule timeline page as a reader uses it: what loads, what each row
 * says about right now, how the week / month / today controls move the
 * window the server is asked for, what every filter and toggle does to the
 * rows, and the empty, error and "answer arrived late" states.
 *
 * The API is stubbed at API.get and answers from a table keyed on the
 * requested window, so each test states exactly what the server would send.
 */

const getMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (error && typeof error === "object" && "message" in error) {
          return String((error as { message: unknown }).message);
        }

        return "Something went wrong";
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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ScheduleTimelineResponse,
  ScheduleTimelineScheduleJson,
} from "../../../Types/OnCallDutyPolicy/ScheduleTimeline";
import ScheduleTimeline, {
  GROUP_BY_TEAM_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/ScheduleTimeline";

// Thursday. The week on screen is Mon 14 - Sun 20 September 2026 (UTC).
const NOW: Date = new Date("2026-09-17T12:00:00.000Z");
const WEEK_FROM: string = "2026-09-14T00:00:00.000Z";
const WEEK_TO: string = "2026-09-21T00:00:00.000Z";

const PAYMENTS: ScheduleTimelineScheduleJson = {
  scheduleId: "s-pay",
  scheduleName: "Payments primary",
  scheduleTimezone: "Europe/Stockholm",
  ownerTeamIds: ["t-pay"],
  isCurrentUserOnRoster: false,
  truncated: false,
  shifts: [
    {
      shiftKey: "pay-1",
      userId: "u-alice",
      userName: "Alice Andersson",
      start: "2026-09-10T09:00:00.000Z",
      end: "2026-09-17T09:00:00.000Z",
      layerId: "l-1",
      layerName: "Weekly",
      override: null,
    },
    {
      shiftKey: "pay-2",
      userId: "u-bob",
      userName: "Bob Berg",
      start: "2026-09-17T09:00:00.000Z",
      end: "2026-09-24T09:00:00.000Z",
      layerId: "l-1",
      layerName: "Weekly",
      override: null,
    },
  ],
};

// Uncovered from Wednesday 00:00 to Friday 00:00, so nobody is on call now.
const SRE: ScheduleTimelineScheduleJson = {
  scheduleId: "s-sre",
  scheduleName: "SRE primary",
  scheduleTimezone: null,
  ownerTeamIds: ["t-sre", "t-pay"],
  isCurrentUserOnRoster: true,
  truncated: false,
  shifts: [
    {
      shiftKey: "sre-1",
      userId: "u-carol",
      userName: "Carol Chen",
      start: "2026-09-14T00:00:00.000Z",
      end: "2026-09-16T00:00:00.000Z",
      layerId: null,
      layerName: null,
      override: null,
    },
    {
      shiftKey: "sre-2",
      userId: "u-dan",
      userName: "Dan Diaz",
      start: "2026-09-18T00:00:00.000Z",
      end: "2026-09-21T00:00:00.000Z",
      layerId: null,
      layerName: null,
      override: {
        originalUserId: "u-carol",
        originalUserName: "Carol Chen",
        overrideStartsAt: "2026-09-18T00:00:00.000Z",
        overrideEndsAt: "2026-09-21T00:00:00.000Z",
        onCallDutyPolicyId: null,
      },
    },
  ],
};

const LEGACY: ScheduleTimelineScheduleJson = {
  scheduleId: "s-legacy",
  scheduleName: "Legacy pager",
  scheduleTimezone: null,
  ownerTeamIds: [],
  isCurrentUserOnRoster: false,
  truncated: false,
  shifts: [],
};

function timeline(
  overrides?: Partial<ScheduleTimelineResponse>,
): ScheduleTimelineResponse {
  return {
    from: WEEK_FROM,
    to: WEEK_TO,
    generatedAt: NOW.toISOString(),
    truncated: false,
    totalScheduleCount: 3,
    schedulesTruncated: false,
    schedules: [PAYMENTS, SRE, LEGACY],
    teams: [
      { teamId: "t-pay", teamName: "Payments", isCurrentUserMember: false },
      { teamId: "t-sre", teamName: "SRE", isCurrentUserMember: true },
    ],
    ...(overrides || {}),
  };
}

function ok(body: ScheduleTimelineResponse): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    JSON.parse(JSON.stringify(body)) as JSONObject,
    {},
  );
}

interface RequestedWindow {
  from: string;
  to: string;
  teamId: string | null;
}

function requested(call: number): RequestedWindow {
  const options: { url: URL } = getMock.mock.calls[call]?.[0] as { url: URL };
  const parsed: globalThis.URL = new globalThis.URL(options.url.toString());

  return {
    from: parsed.searchParams.get("from") || "",
    to: parsed.searchParams.get("to") || "",
    teamId: parsed.searchParams.get("teamId"),
  };
}

function lastRequested(): RequestedWindow {
  return requested(getMock.mock.calls.length - 1);
}

/*
 * Answers every request with `body`, but with `from` / `to` set to the
 * window that was asked for, as the server would.
 */
function answerWith(body: ScheduleTimelineResponse): void {
  getMock.mockImplementation(async (options: { url: URL }) => {
    const parsed: globalThis.URL = new globalThis.URL(options.url.toString());

    return ok({
      ...body,
      from: parsed.searchParams.get("from") || body.from,
      to: parsed.searchParams.get("to") || body.to,
    });
  });
}

function renderTimeline(
  props?: React.ComponentProps<typeof ScheduleTimeline>,
): void {
  render(
    <MemoryRouter>
      <ScheduleTimeline {...(props || {})} />
    </MemoryRouter>,
  );
}

function rowIds(): Array<string> {
  return screen
    .queryAllByTestId("timeline-schedule-row")
    .map((row: HTMLElement) => {
      return row.getAttribute("data-schedule-id") || "";
    });
}

function row(scheduleId: string, index: number = 0): HTMLElement {
  const rows: Array<HTMLElement> = screen
    .queryAllByTestId("timeline-schedule-row")
    .filter((element: HTMLElement) => {
      return element.getAttribute("data-schedule-id") === scheduleId;
    });

  const found: HTMLElement | undefined = rows[index];

  if (!found) {
    throw new Error(`No row for ${scheduleId}`);
  }

  return found;
}

async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryAllByTestId("timeline-schedule-row").length).toBe(4);
  });
}

beforeEach(() => {
  getMock.mockReset();
  window.localStorage.clear();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest
    .spyOn(OneUptimeDate, "getCurrentTimezone")
    .mockReturnValue(
      "UTC" as ReturnType<typeof OneUptimeDate.getCurrentTimezone>,
    );
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);

  answerWith(timeline());
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("first load", () => {
  test("asks for the current ISO week in the viewer's zone", async () => {
    renderTimeline();
    await loaded();

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(requested(0)).toEqual({
      from: WEEK_FROM,
      to: WEEK_TO,
      teamId: null,
    });
    expect(screen.getByTestId("timeline-range-label")).toHaveTextContent(
      "September 14 – 20, 2026",
    );
  });

  test("shows skeleton rows until the answer arrives", async () => {
    let resolve: (value: HTTPResponse<JSONObject>) => void = () => {};

    getMock.mockImplementation(() => {
      return new Promise<HTTPResponse<JSONObject>>(
        (done: (value: HTTPResponse<JSONObject>) => void) => {
          resolve = done;
        },
      );
    });

    renderTimeline();

    expect(screen.getByTestId("timeline-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-summary")).not.toBeInTheDocument();

    await act(async () => {
      resolve(ok(timeline()));
    });

    await loaded();
    expect(screen.queryByTestId("timeline-skeleton")).not.toBeInTheDocument();
  });

  test("seven day columns, today marked", async () => {
    renderTimeline();
    await loaded();

    const headers: Array<HTMLElement> = screen.getAllByTestId(
      "timeline-day-header",
    );

    expect(headers).toHaveLength(7);
    expect(
      headers.map((header: HTMLElement) => {
        return header.getAttribute("data-today");
      }),
    ).toEqual(["false", "false", "false", "true", "false", "false", "false"]);
    expect(screen.getByTestId("timeline-now-line")).toBeInTheDocument();
  });

  test("rows are grouped by owner team; a shared schedule appears under each team", async () => {
    renderTimeline();
    await loaded();

    expect(
      screen
        .getAllByTestId("timeline-group-header")
        .map((header: HTMLElement) => {
          return header.textContent;
        }),
    ).toEqual(["Payments2", "SRE1Your team", "No owner team1"]);

    expect(rowIds()).toEqual(["s-pay", "s-sre", "s-sre", "s-legacy"]);
  });

  test("schedule names link to the schedule's page", async () => {
    renderTimeline();
    await loaded();

    const link: HTMLElement = within(row("s-pay")).getByRole("link", {
      name: "Payments primary",
    });

    expect(link.getAttribute("href")).toContain(
      "/on-call-duty/schedules/s-pay",
    );
  });

  test("each row says who is on call now, or that nobody is", async () => {
    renderTimeline();
    await loaded();

    expect(
      within(row("s-pay")).getByTestId("timeline-on-call-now"),
    ).toHaveTextContent("Bob Bergon call now");
    expect(
      within(row("s-sre")).getByTestId("timeline-uncovered-now"),
    ).toHaveTextContent("No one on call now");
    expect(
      within(row("s-legacy")).getByTestId("timeline-uncovered-now"),
    ).toBeInTheDocument();
  });

  test("the caller's own schedules are tagged", async () => {
    renderTimeline();
    await loaded();

    expect(within(row("s-sre")).getByText("You")).toBeInTheDocument();
    expect(within(row("s-pay")).queryByText("You")).not.toBeInTheDocument();
  });

  test("bars for shifts, hatched gaps, and the overridden person underneath", async () => {
    renderTimeline();
    await loaded();

    const payBars: Array<HTMLElement> = within(row("s-pay")).getAllByTestId(
      "timeline-shift-bar",
    );

    expect(
      payBars.map((bar: HTMLElement) => {
        return [
          bar.getAttribute("data-user-id"),
          bar.getAttribute("data-active"),
        ];
      }),
    ).toEqual([
      ["u-alice", "false"],
      ["u-bob", "true"],
    ]);
    expect(within(row("s-pay")).queryAllByTestId("timeline-gap")).toHaveLength(
      0,
    );

    const sreRow: HTMLElement = row("s-sre");

    expect(within(sreRow).getAllByTestId("timeline-gap")).toHaveLength(1);
    expect(
      within(sreRow)
        .getAllByTestId("timeline-gap")[0]
        ?.getAttribute("aria-label"),
    ).toBe("No one on call, Wed, Sep 16, 00:00 → Fri, Sep 18, 00:00");

    const overrideBar: HTMLElement | undefined = within(sreRow)
      .getAllByTestId("timeline-shift-bar")
      .find((bar: HTMLElement) => {
        return bar.getAttribute("data-override") === "true";
      });

    expect(overrideBar).toHaveTextContent("⇄ Dan Diaz");
    expect(overrideBar?.getAttribute("aria-label")).toContain(
      "covering for Carol Chen",
    );

    const overridden: HTMLElement = within(sreRow).getByTestId(
      "timeline-overridden-segment",
    );

    expect(overridden).toHaveTextContent("Carol Chen (overridden)");

    // Nobody at all: the whole week is one gap.
    expect(within(row("s-legacy")).getAllByTestId("timeline-gap")).toHaveLength(
      1,
    );
  });

  test("the summary counts schedules, coverage now, and gaps", async () => {
    renderTimeline();
    await loaded();

    const summary: HTMLElement = screen.getByTestId("timeline-summary");

    expect(summary).toHaveTextContent("3schedules");
    expect(
      screen.getByTestId("timeline-summary-covered-now"),
    ).toHaveTextContent("1covered now");
    expect(
      screen.getByTestId("timeline-summary-uncovered-now"),
    ).toHaveTextContent("2with no one on call now");
    expect(screen.getByTestId("timeline-summary-gaps")).toHaveTextContent(
      "2with coverage gaps this week",
    );
  });

  test("the legend lists everyone on call this week, heaviest load first", async () => {
    renderTimeline();
    await loaded();

    const people: Array<string> = screen
      .getAllByTestId("timeline-person")
      .map((chip: HTMLElement) => {
        return chip.getAttribute("data-user-id") || "";
      });

    // Bob 3d15h, Alice 3d9h, Dan 3d, Carol 2d.
    expect(people).toEqual(["u-bob", "u-alice", "u-dan", "u-carol"]);
    expect(screen.getByTestId("timeline-legend")).toHaveTextContent(
      "Times in UTC.",
    );
  });
});

describe("navigation", () => {
  test("next, previous and today move the requested window a week at a time", async () => {
    renderTimeline();
    await loaded();

    fireEvent.click(screen.getByTestId("timeline-next-button"));

    await waitFor(() => {
      expect(lastRequested().from).toBe("2026-09-21T00:00:00.000Z");
    });
    expect(lastRequested().to).toBe("2026-09-28T00:00:00.000Z");
    expect(screen.getByTestId("timeline-range-label")).toHaveTextContent(
      "September 21 – 27, 2026",
    );

    // Not this week any more: no red line, no "now" statements.
    await waitFor(() => {
      expect(screen.queryByTestId("timeline-now-line")).not.toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("timeline-summary-covered-now"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("timeline-previous-button"));
    fireEvent.click(screen.getByTestId("timeline-previous-button"));

    await waitFor(() => {
      expect(lastRequested().from).toBe("2026-09-07T00:00:00.000Z");
    });

    fireEvent.click(screen.getByTestId("timeline-today-button"));

    await waitFor(() => {
      expect(lastRequested().from).toBe(WEEK_FROM);
    });
  });

  test("outside the current week the rows describe the period instead of 'now'", async () => {
    renderTimeline();
    await loaded();

    fireEvent.click(screen.getByTestId("timeline-next-button"));

    await waitFor(() => {
      expect(
        within(row("s-legacy")).getByText("No one on call this week"),
      ).toBeInTheDocument();
    });
  });

  test("the month view asks for the calendar month and is remembered", async () => {
    renderTimeline();
    await loaded();

    fireEvent.click(screen.getByTestId("timeline-mode-month"));

    await waitFor(() => {
      expect(lastRequested()).toEqual({
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
        teamId: null,
      });
    });

    expect(screen.getByTestId("timeline-range-label")).toHaveTextContent(
      "September 2026",
    );
    expect(screen.getByTestId("timeline-mode-month")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("timeline-day-header")).toHaveLength(30);
    });

    expect(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe("month");
  });

  test("a remembered month view is used on the next visit", async () => {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "month");

    renderTimeline();

    await waitFor(() => {
      expect(requested(0).from).toBe("2026-09-01T00:00:00.000Z");
    });
  });

  test("the back button stops where the server stops computing", async () => {
    renderTimeline();
    await loaded();

    fireEvent.click(screen.getByTestId("timeline-mode-month"));

    const back: HTMLElement = screen.getByTestId("timeline-previous-button");

    /*
     * 180 days before 17 Sep 2026 is 21 Mar 2026: March is reachable,
     * February is not.
     */
    for (let step: number = 0; step < 6; step++) {
      expect(back).not.toBeDisabled();
      fireEvent.click(back);
    }

    await waitFor(() => {
      expect(screen.getByTestId("timeline-range-label")).toHaveTextContent(
        "March 2026",
      );
    });
    expect(back).toBeDisabled();
    expect(screen.getByTestId("timeline-next-button")).not.toBeDisabled();
  });

  test("a slower answer for a window the reader already left is ignored", async () => {
    const pending: Array<(value: HTTPResponse<JSONObject>) => void> = [];

    getMock.mockImplementation(() => {
      return new Promise<HTTPResponse<JSONObject>>(
        (done: (value: HTTPResponse<JSONObject>) => void) => {
          pending.push(done);
        },
      );
    });

    renderTimeline();

    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });

    fireEvent.click(screen.getByTestId("timeline-next-button"));

    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });

    // The next week answers first...
    await act(async () => {
      pending[1]!(
        ok(
          timeline({
            from: "2026-09-21T00:00:00.000Z",
            to: "2026-09-28T00:00:00.000Z",
            schedules: [LEGACY],
            teams: [],
          }),
        ),
      );
    });

    // ...then the stale current week.
    await act(async () => {
      pending[0]!(ok(timeline()));
    });

    await waitFor(() => {
      expect(rowIds()).toEqual(["s-legacy"]);
    });
  });
});

describe("filters", () => {
  test("search matches schedules, teams and people", async () => {
    renderTimeline();
    await loaded();

    fireEvent.change(screen.getByTestId("timeline-search"), {
      target: { value: "dan" },
    });

    expect(rowIds()).toEqual(["s-sre", "s-sre"]);

    fireEvent.change(screen.getByTestId("timeline-search"), {
      target: { value: "legacy" },
    });

    expect(rowIds()).toEqual(["s-legacy"]);
  });

  test("the team picker offers My teams and every owner team", async () => {
    renderTimeline();
    await loaded();

    const select: HTMLSelectElement = screen.getByTestId(
      "timeline-team-filter",
    ) as HTMLSelectElement;

    expect(
      Array.from(select.options).map((option: HTMLOptionElement) => {
        return option.textContent;
      }),
    ).toEqual(["All teams", "My teams", "Payments", "SRE"]);

    fireEvent.change(select, { target: { value: "t-sre" } });

    // Only the chosen team's group, even though SRE primary is co-owned.
    expect(rowIds()).toEqual(["s-sre"]);
    expect(
      screen
        .getAllByTestId("timeline-group-header")
        .map((header: HTMLElement) => {
          return header.textContent;
        }),
    ).toEqual(["SRE1Your team"]);

    fireEvent.change(select, { target: { value: "t-pay" } });

    expect(rowIds()).toEqual(["s-pay", "s-sre"]);
  });

  test("My teams keeps the schedules a team the caller is in owns", async () => {
    renderTimeline();
    await loaded();

    fireEvent.change(screen.getByTestId("timeline-team-filter"), {
      target: { value: "__my_teams__" },
    });

    expect(rowIds()).toEqual(["s-sre"]);
    expect(
      screen
        .getAllByTestId("timeline-group-header")
        .map((header: HTMLElement) => {
          return header.textContent;
        }),
    ).toEqual(["SRE1Your team"]);
  });

  test("Schedules I'm on", async () => {
    renderTimeline();
    await loaded();

    const toggle: HTMLElement = screen.getByTestId("timeline-only-mine");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(new Set(rowIds())).toEqual(new Set(["s-sre"]));

    fireEvent.click(toggle);

    expect(rowIds()).toHaveLength(4);
  });

  test("the 'no one on call now' count filters to those schedules and back", async () => {
    renderTimeline();
    await loaded();

    const chip: HTMLElement = screen.getByTestId(
      "timeline-summary-uncovered-now",
    );

    fireEvent.click(chip);

    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(rowIds()).toEqual(["s-sre", "s-sre", "s-legacy"]);

    // The counts do not move under the reader's feet.
    expect(
      screen.getByTestId("timeline-summary-covered-now"),
    ).toHaveTextContent("1covered now");

    fireEvent.click(chip);

    expect(rowIds()).toHaveLength(4);
  });

  test("the 'coverage gaps' count filters too", async () => {
    renderTimeline();
    await loaded();

    fireEvent.click(screen.getByTestId("timeline-summary-gaps"));

    expect(new Set(rowIds())).toEqual(new Set(["s-sre", "s-legacy"]));
  });

  test("no match: a message and a way back", async () => {
    renderTimeline();
    await loaded();

    fireEvent.change(screen.getByTestId("timeline-search"), {
      target: { value: "zzz" },
    });

    expect(screen.getByTestId("timeline-no-matches")).toHaveTextContent(
      "No schedules match these filters",
    );

    fireEvent.click(
      within(screen.getByTestId("timeline-no-matches")).getByText(
        "Clear filters",
      ),
    );

    expect(rowIds()).toHaveLength(4);
    expect(screen.getByTestId("timeline-search")).toHaveValue("");
  });

  test("Clear filters resets every filter", async () => {
    renderTimeline();
    await loaded();

    expect(
      screen.queryByTestId("timeline-clear-filters"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("timeline-only-mine"));
    fireEvent.change(screen.getByTestId("timeline-search"), {
      target: { value: "sre" },
    });

    fireEvent.click(screen.getByTestId("timeline-clear-filters"));

    expect(rowIds()).toHaveLength(4);
    expect(screen.getByTestId("timeline-only-mine")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("grouping can be turned off, and that is remembered", async () => {
    renderTimeline();
    await loaded();

    fireEvent.click(screen.getByTestId("timeline-group-by-team"));

    expect(screen.queryAllByTestId("timeline-group-header")).toHaveLength(0);
    expect(rowIds()).toEqual(["s-pay", "s-sre", "s-legacy"]);
    expect(
      JSON.parse(
        window.localStorage.getItem(GROUP_BY_TEAM_STORAGE_KEY) || "null",
      ),
    ).toBe(false);
  });

  test("a group collapses and expands", async () => {
    renderTimeline();
    await loaded();

    const header: HTMLElement = screen.getAllByTestId(
      "timeline-group-header",
    )[0] as HTMLElement;
    const toggle: HTMLElement = within(header).getByRole("button");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(rowIds()).toEqual(["s-sre", "s-legacy"]);

    fireEvent.click(toggle);

    expect(rowIds()).toHaveLength(4);
  });
});

describe("highlighting a person", () => {
  test("from the legend: their bars are marked everywhere, and it toggles off", async () => {
    renderTimeline();
    await loaded();

    const chip: HTMLElement = screen
      .getAllByTestId("timeline-person")
      .find((element: HTMLElement) => {
        return element.getAttribute("data-user-id") === "u-dan";
      }) as HTMLElement;

    fireEvent.click(chip);

    expect(chip).toHaveAttribute("aria-pressed", "true");

    const pressed: Array<string> = screen
      .getAllByTestId("timeline-shift-bar")
      .filter((bar: HTMLElement) => {
        return bar.getAttribute("aria-pressed") === "true";
      })
      .map((bar: HTMLElement) => {
        return bar.getAttribute("data-user-id") || "";
      });

    // Dan's one shift, drawn under both groups SRE primary appears in.
    expect(pressed).toEqual(["u-dan", "u-dan"]);

    fireEvent.click(screen.getByTestId("timeline-clear-highlight"));

    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  test("from a bar", async () => {
    renderTimeline();
    await loaded();

    const bar: HTMLElement = within(row("s-pay"))
      .getAllByTestId("timeline-shift-bar")
      .find((element: HTMLElement) => {
        return element.getAttribute("data-user-id") === "u-bob";
      }) as HTMLElement;

    fireEvent.click(bar);

    expect(bar).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getAllByTestId("timeline-person").find((element: HTMLElement) => {
        return element.getAttribute("data-user-id") === "u-bob";
      }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(bar);

    expect(bar).toHaveAttribute("aria-pressed", "false");
  });
});

describe("locked to a team", () => {
  test("asks for that team, and hides the team picker and grouping", async () => {
    const teamId: ObjectID = ObjectID.generate();

    renderTimeline({ teamId });

    // Ungrouped: each schedule once.
    await waitFor(() => {
      expect(rowIds()).toEqual(["s-pay", "s-sre", "s-legacy"]);
    });

    expect(requested(0).teamId).toBe(teamId.toString());
    expect(
      screen.queryByTestId("timeline-team-filter"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("timeline-group-by-team"),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("timeline-group-header")).toHaveLength(0);
    expect(screen.getByText("On-Call Schedules")).toBeInTheDocument();
  });

  test("a team with no schedules is told how to add one", async () => {
    answerWith(timeline({ schedules: [], teams: [], totalScheduleCount: 0 }));

    renderTimeline({ teamId: ObjectID.generate() });

    await waitFor(() => {
      expect(
        screen.getByText("This team does not own any on-call schedules yet"),
      ).toBeInTheDocument();
    });
  });
});

describe("empty, error and partial answers", () => {
  test("a project without schedules gets an empty state with a way forward", async () => {
    answerWith(timeline({ schedules: [], teams: [], totalScheduleCount: 0 }));

    renderTimeline();

    await waitFor(() => {
      expect(screen.getByText("No on-call schedules yet")).toBeInTheDocument();
    });
    expect(screen.getByText("Go to On-Call Schedules")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-summary")).not.toBeInTheDocument();
  });

  test("an error shows the server's message, and retry asks again", async () => {
    getMock.mockResolvedValueOnce(
      new HTTPErrorResponse(
        422,
        { message: "You do not have permission to read schedules." },
        {},
      ),
    );

    renderTimeline();

    await waitFor(() => {
      expect(
        screen.getByText("You do not have permission to read schedules."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("refresh-button"));

    await loaded();
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  test("a capped schedule list says so", async () => {
    answerWith(timeline({ totalScheduleCount: 412, schedulesTruncated: true }));

    renderTimeline();
    await loaded();

    expect(
      screen.getByTestId("timeline-schedules-truncated"),
    ).toHaveTextContent("Showing the first 3 of 412 schedules");
  });

  test("an incomplete rotation says so", async () => {
    answerWith(timeline({ truncated: true }));

    renderTimeline();
    await loaded();

    expect(screen.getByTestId("timeline-engine-truncated")).toBeInTheDocument();
  });

  test("a partly served window is shaded and explained, not drawn as 'nobody on call'", async () => {
    getMock.mockResolvedValue(
      ok(timeline({ from: "2026-09-16T00:00:00.000Z", to: WEEK_TO })),
    );

    renderTimeline();
    await loaded();

    expect(screen.getByTestId("timeline-outside-range")).toBeInTheDocument();
    expect(screen.getAllByTestId("timeline-unavailable")).toHaveLength(1);

    // Legacy has no shifts: its gap starts where the served window starts.
    expect(
      within(row("s-legacy"))
        .getByTestId("timeline-gap")
        .getAttribute("aria-label"),
    ).toBe("No one on call, Wed, Sep 16, 00:00 → Mon, Sep 21, 00:00");
  });
});

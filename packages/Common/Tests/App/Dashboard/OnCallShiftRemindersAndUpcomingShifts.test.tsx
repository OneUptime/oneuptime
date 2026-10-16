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
import type { SpyInstance } from "jest-mock";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The two cards on the Calendar Feed page that are NOT about the link: the
 * reminder chips (one UserOnCallShiftReminder row per chip) and the live
 * "Upcoming shifts" list from /my-shifts.
 *
 * Reminders: every chip click is one create or one delete of exactly the row
 * it represents, the custom modal refuses what the service would refuse (with
 * a reason, before the round trip), and a duplicate lead time is caught
 * locally. Upcoming shifts: the window sent is the 30-day one; back-to-back
 * turns read as one row, with a date tile, the day in words, the times in
 * the reader's zone and how long; the "covering for", policy-variant and
 * layer facts survive to the DOM where they say something; each of your own
 * spans can reach "Get cover" - Add User Override for that span, in its
 * project - while one you are covering for someone else cannot (overrides
 * do not chain); and the empty, truncated, failed, refreshing and folded
 * states each say what they are.
 */

const getMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (error instanceof Error) {
          return error.message;
        }

        if (
          error &&
          typeof error === "object" &&
          "message" in (error as Record<string, unknown>)
        ) {
          return String((error as Record<string, unknown>)["message"]);
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
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
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

import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { MaterializedShiftJson } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import UserOnCallShiftReminder from "../../../Models/DatabaseModels/UserOnCallShiftReminder";
import ShiftRemindersCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/ShiftRemindersCard";
import UpcomingShiftsCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftsCard";
import {
  UPCOMING_SHIFT_BODY_CLASS_NAME,
  UPCOMING_SHIFT_COVER_CLASS_NAME,
  UPCOMING_SHIFT_END_CLASS_NAME,
  UPCOMING_SHIFT_SEPARATOR_CLASS_NAME,
  UPCOMING_SHIFT_TEXT_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftRow";
import {
  MY_SHIFTS_PATH,
  STANDING_ASSIGNMENTS_COPY,
  UPCOMING_SHIFTS_DAYS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

const PROJECT_ID: ObjectID = new ObjectID(
  "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
);
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const NOW: Date = new Date("2026-08-31T12:00:00.000Z");

// Intl puts a narrow no-break space before AM and PM.
const NARROW_SPACES: RegExp = /[\u202f\u00a0]/g;

type ReminderRowFunction = (
  id: string,
  minutes: number,
) => UserOnCallShiftReminder;

const reminderRow: ReminderRowFunction = (
  id: string,
  minutes: number,
): UserOnCallShiftReminder => {
  const row: UserOnCallShiftReminder = new UserOnCallShiftReminder();
  row.id = new ObjectID(id);
  row.minutesBeforeShift = minutes;
  return row;
};

type ListFunction = (rows: Array<UserOnCallShiftReminder>) => {
  data: Array<UserOnCallShiftReminder>;
  count: number;
  skip: number;
  limit: number;
};

const list: ListFunction = (
  rows: Array<UserOnCallShiftReminder>,
): {
  data: Array<UserOnCallShiftReminder>;
  count: number;
  skip: number;
  limit: number;
} => {
  return { data: rows, count: rows.length, skip: 0, limit: 10 };
};

type ShiftFunction = (
  overrides: Partial<MaterializedShiftJson> & { shiftKey: string },
) => MaterializedShiftJson;

const shift: ShiftFunction = (
  overrides: Partial<MaterializedShiftJson> & { shiftKey: string },
): MaterializedShiftJson => {
  return {
    contentHash: "hash",
    projectId: PROJECT_ID.toString(),
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    scheduleTimezone: "Europe/Stockholm",
    userId: USER_ID.toString(),
    userName: "Jane",
    start: "2026-09-01T07:00:00.000Z",
    end: "2026-09-01T15:00:00.000Z",
    coverageSeconds: 8 * 3600,
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-08-30T00:00:00.000Z",
    shiftConfigVersion: 3,
    ...overrides,
  };
};

type MyShiftsJsonFunction = (
  shifts: Array<MaterializedShiftJson>,
  truncated: boolean,
) => JSONObject;

const myShiftsJson: MyShiftsJsonFunction = (
  shifts: Array<MaterializedShiftJson>,
  truncated: boolean,
): JSONObject => {
  return {
    shifts: shifts as unknown as JSONArray,
    truncated: truncated,
    generatedAt: NOW.toISOString(),
  };
};

type OkFunction = (json: JSONObject) => HTTPResponse<JSONObject>;

const ok: OkFunction = (json: JSONObject): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, json, {});
};

function goToCalendarFeedPage(): void {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/user-settings/calendar-feed`,
  );
}

function resetMocks(): void {
  getMock.mockReset();
  getListMock.mockReset();
  createMock.mockReset();
  deleteItemMock.mockReset();
  createMock.mockResolvedValue(new UserOnCallShiftReminder());
  deleteItemMock.mockResolvedValue(undefined);
}

describe("ShiftRemindersCard", () => {
  beforeEach(() => {
    resetMocks();
    goToCalendarFeedPage();
  });

  afterEach(() => {
    cleanup();
  });

  test("lists the caller's reminder rows in this project and lights the matching chips", async () => {
    getListMock.mockResolvedValue(
      list([reminderRow("aaaaaaaa-0000-4000-8000-000000000001", 1440)]),
    );

    render(<ShiftRemindersCard projectId={PROJECT_ID} userId={USER_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("shift-reminder-chip-1440")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    expect(screen.getByTestId("shift-reminder-chip-10080")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("shift-reminder-chip-60")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("shift-reminder-chip-15")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const call: Record<string, unknown> = getListMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["modelType"]).toBe(UserOnCallShiftReminder);
    const query: Record<string, unknown> = call["query"] as Record<
      string,
      unknown
    >;
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(query["userId"])).toBe(USER_ID.toString());
    expect(call["select"]).toEqual({ _id: true, minutesBeforeShift: true });

    // The reminders card points at Notification Settings for the channels.
    const expectedRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS] as Route,
    );
    expect(
      screen.getByText("Choose how reminders reach you").closest("a"),
    ).toHaveAttribute("href", expectedRoute.toString());
  });

  test("clicking an unlit chip creates exactly that row, letting the service default userId", async () => {
    getListMock
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(
        list([reminderRow("aaaaaaaa-0000-4000-8000-000000000002", 60)]),
      );

    render(<ShiftRemindersCard projectId={PROJECT_ID} userId={USER_ID} />);

    const chip: HTMLElement = await screen.findByTestId(
      "shift-reminder-chip-60",
    );
    fireEvent.click(chip);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const call: Record<string, unknown> = createMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["modelType"]).toBe(UserOnCallShiftReminder);
    const model: UserOnCallShiftReminder = call[
      "model"
    ] as UserOnCallShiftReminder;
    expect(model.minutesBeforeShift).toBe(60);
    expect(String(model.projectId)).toBe(PROJECT_ID.toString());
    expect(model.userId).toBeUndefined();

    await waitFor(() => {
      expect(screen.getByTestId("shift-reminder-chip-60")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("clicking a lit chip deletes exactly that row", async () => {
    getListMock
      .mockResolvedValueOnce(
        list([reminderRow("aaaaaaaa-0000-4000-8000-000000000003", 15)]),
      )
      .mockResolvedValueOnce(list([]));

    render(<ShiftRemindersCard projectId={PROJECT_ID} userId={USER_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("shift-reminder-chip-15")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    fireEvent.click(screen.getByTestId("shift-reminder-chip-15"));

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });
    const call: Record<string, unknown> = deleteItemMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["modelType"]).toBe(UserOnCallShiftReminder);
    expect(String(call["id"])).toBe("aaaaaaaa-0000-4000-8000-000000000003");
    expect(createMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId("shift-reminder-chip-15")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  test("a non-preset row appears as its own lit chip with a human label", async () => {
    getListMock.mockResolvedValue(
      list([reminderRow("aaaaaaaa-0000-4000-8000-000000000004", 90)]),
    );

    render(<ShiftRemindersCard projectId={PROJECT_ID} userId={USER_ID} />);

    const chip: HTMLElement = await screen.findByTestId(
      "shift-reminder-chip-90",
    );
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveTextContent("90 minutes");
  });

  test("the custom modal validates locally before any round trip", async () => {
    getListMock.mockResolvedValue(
      list([reminderRow("aaaaaaaa-0000-4000-8000-000000000005", 1440)]),
    );

    render(<ShiftRemindersCard projectId={PROJECT_ID} userId={USER_ID} />);

    fireEvent.click(await screen.findByTestId("shift-reminder-chip-custom"));

    const modal: HTMLElement = await screen.findByTestId("modal");
    const input: HTMLElement = within(modal).getByTestId(
      "shift-reminder-custom-minutes",
    );
    const submit: HTMLElement = within(modal).getByRole("button", {
      name: "Add reminder",
    });

    fireEvent.click(submit);
    await waitFor(() => {
      expect(modal).toHaveTextContent(
        "Enter how many minutes before the shift.",
      );
    });

    fireEvent.change(input, { target: { value: "12.5" } });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(modal).toHaveTextContent("Enter a whole number of minutes.");
    });

    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(modal).toHaveTextContent(
        "Reminders can be sent between 15 minutes and 14 days before a shift.",
      );
    });

    // 1440 already exists as a row: caught locally, not by a 400.
    fireEvent.change(input, { target: { value: "1440" } });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(modal).toHaveTextContent(
        "You already have a reminder at that lead time.",
      );
    });

    expect(createMock).not.toHaveBeenCalled();
  });

  test("a valid custom lead time creates the row and closes the modal", async () => {
    getListMock
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(
        list([reminderRow("aaaaaaaa-0000-4000-8000-000000000006", 120)]),
      );

    render(<ShiftRemindersCard projectId={PROJECT_ID} userId={USER_ID} />);

    fireEvent.click(await screen.findByTestId("shift-reminder-chip-custom"));

    const modal: HTMLElement = await screen.findByTestId("modal");
    fireEvent.change(
      within(modal).getByTestId("shift-reminder-custom-minutes"),
      {
        target: { value: "120" },
      },
    );
    fireEvent.click(
      within(modal).getByRole("button", { name: "Add reminder" }),
    );

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const model: UserOnCallShiftReminder = (
      createMock.mock.calls[0]![0] as Record<string, unknown>
    )["model"] as UserOnCallShiftReminder;
    expect(model.minutesBeforeShift).toBe(120);

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("shift-reminder-chip-120")).toHaveTextContent(
        "2 hours",
      );
    });
  });

  test("a failed write surfaces the server's message on the card", async () => {
    getListMock.mockResolvedValue(list([]));
    createMock.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        {
          message: "You already have a reminder 60 minutes before your shifts.",
        },
        {},
      ),
    );

    render(<ShiftRemindersCard projectId={PROJECT_ID} userId={USER_ID} />);

    fireEvent.click(await screen.findByTestId("shift-reminder-chip-60"));

    await waitFor(() => {
      expect(
        screen.getByText(
          "You already have a reminder 60 minutes before your shifts.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("shift-reminder-chip-60")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("without a project or user the chips are inert and nothing is fetched", async () => {
    render(<ShiftRemindersCard projectId={null} userId={USER_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("shift-reminder-chip-custom")).toBeDisabled();
    });
    expect(screen.getByTestId("shift-reminder-chip-60")).toBeDisabled();
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("UpcomingShiftsCard", () => {
  /*
   * In the reader's zone - set to London here, the maintainer's - and on a
   * 24-hour clock, whatever the machine running the tests uses.
   */
  beforeEach(() => {
    resetMocks();
    goToCalendarFeedPage();
    OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    OneUptimeDate.setUserTimezone(null);
    jest.restoreAllMocks();
  });

  // 15:00 UTC on 14 October 2026: 16:00 in London.
  const OCTOBER: Date = new Date("2026-10-14T15:00:00.000Z");
  const HOUR: number = 60 * 60 * 1000;
  const DAY: number = 24 * HOUR;

  function at(offset: number): string {
    return new Date(OCTOBER.getTime() + offset).toISOString();
  }

  // The maintainer's month: one person, a 24-hour turn from 16:20 UTC daily.
  function dailyTurns(count: number): Array<MaterializedShiftJson> {
    const first: number = -(22 * HOUR + 40 * 60 * 1000);
    const result: Array<MaterializedShiftJson> = [];

    for (let index: number = 0; index < count; index++) {
      result.push(
        shift({
          shiftKey: `daily-${index}`,
          scheduleName: "Team AWeekly",
          projectName: "OneUptime Telemetry",
          layerId: "layer-1",
          layerName: "Layer 1",
          start: at(first + index * DAY),
          end: at(first + (index + 1) * DAY),
        }),
      );
    }

    return result;
  }

  function serve(
    shifts: Array<MaterializedShiftJson>,
    truncated: boolean = false,
  ): void {
    getMock.mockResolvedValue(ok(myShiftsJson(shifts, truncated)));
  }

  function rows(): Array<HTMLElement> {
    return screen.queryAllByTestId("upcoming-shift-row");
  }

  test("asks /my-shifts for exactly the next 30 days", async () => {
    serve([]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await screen.findByTestId("upcoming-shifts-empty");

    const url: URL = new URL(
      String((getMock.mock.calls[0]![0] as Record<string, unknown>)["url"]),
    );

    expect(url.pathname).toContain(MY_SHIFTS_PATH);
    expect(url.searchParams.get("from")).toBe(OCTOBER.toISOString());
    expect(url.searchParams.get("to")).toBe(
      new Date(OCTOBER.getTime() + UPCOMING_SHIFTS_DAYS * DAY).toISOString(),
    );
  });

  test("the maintainer's month of daily turns is one row: on call now, until at least the last one's end", async () => {
    serve(dailyTurns(31));

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });

    const row: HTMLElement = rows()[0]!;

    expect(row).toHaveAttribute("data-on-call-now", "true");
    expect(row).toHaveAttribute("data-may-continue", "true");
    expect(
      within(row).getByTestId("upcoming-shift-day-label"),
    ).toHaveTextContent("On call now");
    expect(within(row).getByTestId("upcoming-shift-times")).toHaveTextContent(
      "until at least Fri, Nov 13, 16:20",
    );
    expect(within(row).getByTestId("upcoming-shift-length")).toHaveTextContent(
      "At least 30 days left",
    );
    // Today's date on the tile, in green.
    expect(within(row).getByTestId("upcoming-shift-tile")).toHaveTextContent(
      "Oct14",
    );
    expect(within(row).getByTestId("upcoming-shift-tile").className).toContain(
      "bg-green-50",
    );
    // No "Layer 1" under a one-layer schedule, no project in its own project.
    expect(within(row).getByTestId("upcoming-shift-where")).toHaveTextContent(
      "Team AWeekly",
    );
    expect(within(row).queryByTestId("upcoming-shift-layer")).toBeNull();
    expect(within(row).queryByTestId("upcoming-shift-project")).toBeNull();
    expect(row).not.toHaveTextContent("OneUptime Telemetry");
    expect(row).not.toHaveTextContent("BST");
    expect(row).not.toHaveTextContent("2026");
  });

  test("an upcoming row: the date tile, the day in words, the times, and how long", async () => {
    serve([
      shift({
        shiftKey: "tomorrow",
        start: at(DAY - 6 * HOUR),
        end: at(DAY + 2 * HOUR),
      }),
      shift({
        shiftKey: "night",
        start: at(3 * DAY + 7 * HOUR),
        end: at(3 * DAY + 15 * HOUR),
      }),
    ]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const [tomorrow, night] = rows() as [HTMLElement, HTMLElement];

    expect(tomorrow).toHaveAttribute("data-on-call-now", "false");
    expect(
      within(tomorrow).getByTestId("upcoming-shift-tile"),
    ).toHaveTextContent("Oct15");
    expect(
      within(tomorrow).getByTestId("upcoming-shift-day-label"),
    ).toHaveTextContent("Tomorrow");
    expect(
      within(tomorrow).getByTestId("upcoming-shift-times"),
    ).toHaveTextContent("10:00 – 18:00");
    expect(
      within(tomorrow).getByTestId("upcoming-shift-length"),
    ).toHaveTextContent("8 hours");

    // 23:00 Saturday to 07:00 Sunday in London: the end says its day.
    expect(within(night).getByTestId("upcoming-shift-tile")).toHaveTextContent(
      "Oct17",
    );
    expect(
      within(night).getByTestId("upcoming-shift-day-label"),
    ).toHaveTextContent("Saturday");
    expect(within(night).getByTestId("upcoming-shift-times")).toHaveTextContent(
      "23:00 – Sun, Oct 18, 07:00",
    );

    // Everything about both ends is on hover, zones included.
    expect(within(night).getByTestId("upcoming-shift-when")).toHaveAttribute(
      "title",
      "Saturday, October 17, 2026 at 23:00 BST – Sunday, October 18, 2026 at 07:00 BST",
    );
  });

  test("cover for someone else and a policy-only shift say so, and a layer with its own name is named", async () => {
    serve([
      shift({
        shiftKey: "cover",
        start: at(DAY),
        end: at(DAY + 8 * HOUR),
        override: {
          originalUserId: "user-2",
          originalUserName: "Bob",
          overrideStartsAt: at(DAY),
          overrideEndsAt: at(DAY + 8 * HOUR),
        },
      }),
      shift({
        shiftKey: "variant",
        start: at(2 * DAY),
        end: at(2 * DAY + 8 * HOUR),
        layerName: "Weekdays",
        policyVariantOf: {
          policyId: "policy-1",
          policyName: "Checkout",
          globalUserId: "user-3",
        },
      }),
    ]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const [cover, variant] = rows() as [HTMLElement, HTMLElement];

    expect(
      within(cover).getByTestId("upcoming-shift-covering"),
    ).toHaveTextContent("Covering for Bob");
    expect(within(cover).queryByText("Get cover")).toBeNull();

    expect(
      within(variant).getByTestId("upcoming-shift-policy"),
    ).toHaveTextContent("Only on policy Checkout");
    expect(
      within(variant).getByTestId("upcoming-shift-layer"),
    ).toHaveTextContent("Weekdays");
  });

  test("touching shifts of two layers stay two rows, each named by its layer", async () => {
    serve([
      shift({
        shiftKey: "one",
        start: at(DAY),
        end: at(2 * DAY),
        layerId: "layer-1",
        layerName: "Layer 1",
      }),
      shift({
        shiftKey: "two",
        start: at(2 * DAY),
        end: at(3 * DAY),
        layerId: "layer-2",
        layerName: "Layer 2",
      }),
    ]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    expect(
      rows().map((row: HTMLElement): string => {
        return (
          within(row).getByTestId("upcoming-shift-layer").textContent || ""
        );
      }),
    ).toEqual(["Layer 1", "Layer 2"]);
  });

  test("the card names the window and the zone once, in its description", async () => {
    serve([]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await screen.findByTestId("upcoming-shifts-empty");

    expect(screen.getByText("Upcoming shifts")).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Your shifts over the next 30 days. Times are in Europe/London.",
    );
  });

  test("the footer says why a policy that names you directly has no rows", async () => {
    serve([shift({ shiftKey: "one", start: at(DAY), end: at(DAY + HOUR) })]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });

    expect(screen.getByTestId("upcoming-shifts-footer")).toHaveTextContent(
      STANDING_ASSIGNMENTS_COPY,
    );
    expect(STANDING_ASSIGNMENTS_COPY).toBe(
      "Only schedule shifts are listed. If an escalation policy names you or your team directly, it can page you at any time.",
    );
  });

  test("an empty answer is a calm panel that says what will appear there", async () => {
    serve([]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    const empty: HTMLElement = await screen.findByTestId(
      "upcoming-shifts-empty",
    );

    expect(empty).toHaveTextContent("No shifts in the next 30 days");
    expect(empty).toHaveTextContent(
      "When a schedule puts you on call, your shifts show up here.",
    );
    // Nothing to press: there is no action that gives a reader a shift.
    expect(within(empty).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("upcoming-shifts-empty-control")).toBeNull();
    expect(screen.queryByTestId("upcoming-shifts-truncated")).toBeNull();
  });

  /*
   * A schedule that hits the simulation cap emits NOTHING for the capped layer
   * (Layer.ts would otherwise attribute shifts to the wrong person), so
   * {shifts: [], truncated: true} is a real answer from /my-shifts - and the
   * only honest reading of it is "we could not compute this", never "you have
   * no shifts".
   */
  test("an empty BUT truncated answer keeps the warning and does not claim there are no shifts", async () => {
    serve([], true);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(screen.getByTestId("upcoming-shifts-truncated")).toHaveTextContent(
        "too complex to compute fully",
      );
    });

    expect(screen.getByTestId("upcoming-shifts-empty")).toHaveTextContent(
      "No shifts could be listed for the next 30 days.",
    );
    expect(screen.getByTestId("upcoming-shifts-empty")).not.toHaveTextContent(
      "No shifts in the next 30 days",
    );
  });

  test("a truncated answer is flagged above the list", async () => {
    serve(
      [shift({ shiftKey: "only", start: at(DAY), end: at(DAY + HOUR) })],
      true,
    );

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(screen.getByTestId("upcoming-shifts-truncated")).toHaveTextContent(
        "some shifts may be missing",
      );
    });

    const notice: HTMLElement = screen.getByTestId("upcoming-shifts-truncated");
    const list: HTMLElement = screen.getByTestId("upcoming-shifts-list");

    expect(
      notice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a failed read says what failed, and Try again reads again", async () => {
    getMock
      .mockResolvedValueOnce(
        new HTTPErrorResponse(503, { message: "Render cap reached" }, {}),
      )
      .mockResolvedValueOnce(ok(myShiftsJson([], false)));

    render(<UpcomingShiftsCard now={OCTOBER} />);

    const error: HTMLElement = await screen.findByTestId(
      "upcoming-shifts-load-error",
    );

    expect(error).toHaveTextContent("Could not load your shifts.");
    expect(error).toHaveTextContent("Render cap reached");
    expect(error).toHaveTextContent("Try again");

    fireEvent.click(within(error).getAllByRole("button")[0]!);

    await screen.findByTestId("upcoming-shifts-empty");
    expect(screen.queryByTestId("upcoming-shifts-load-error")).toBeNull();
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  test("Refresh reads again with the rows still on screen, never the loader", async () => {
    let answer: (value: HTTPResponse<JSONObject>) => void = (): void => {};

    getMock
      .mockResolvedValueOnce(
        ok(
          myShiftsJson(
            [shift({ shiftKey: "first", start: at(DAY), end: at(DAY + HOUR) })],
            false,
          ),
        ),
      )
      .mockImplementationOnce((): Promise<HTTPResponse<JSONObject>> => {
        return new Promise(
          (resolve: (value: HTTPResponse<JSONObject>) => void) => {
            answer = resolve;
          },
        );
      });

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledTimes(2);
    });

    // Still there while the second read is out, and Refresh is busy.
    expect(rows()).toHaveLength(1);
    expect(screen.queryByTestId("upcoming-shifts-loading")).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();

    await act(async () => {
      answer(
        ok(
          myShiftsJson(
            [
              shift({ shiftKey: "first", start: at(DAY), end: at(DAY + HOUR) }),
              shift({
                shiftKey: "second",
                start: at(3 * DAY),
                end: at(3 * DAY + HOUR),
              }),
            ],
            false,
          ),
        ),
      );
    });

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled();
  });

  test("the first read shows the loader", async () => {
    getMock.mockImplementation((): Promise<HTTPResponse<JSONObject>> => {
      return new Promise(() => {});
    });

    render(<UpcomingShiftsCard now={OCTOBER} />);

    expect(
      await screen.findByTestId("upcoming-shifts-loading"),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
  });

  test("a long month folds after six rows, opens on a click, and folds again", async () => {
    const weekdays: Array<MaterializedShiftJson> = [];

    for (let day: number = 1; day <= 22; day++) {
      weekdays.push(
        shift({
          shiftKey: `weekday-${day}`,
          start: at(day * DAY),
          end: at(day * DAY + 8 * HOUR),
        }),
      );
    }

    serve(weekdays);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(6);
    });

    const fold: HTMLElement = screen.getByTestId("upcoming-shifts-fold");

    expect(fold).toHaveTextContent("Show 16 more shifts");
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(fold).toHaveAttribute(
      "aria-controls",
      screen.getByTestId("upcoming-shifts-list").id,
    );

    fireEvent.click(fold);

    expect(rows()).toHaveLength(22);
    expect(fold).toHaveTextContent("Show fewer shifts");
    expect(fold).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(fold);

    expect(rows()).toHaveLength(6);
  });

  test("a list that would hide fewer than three rows does not fold", async () => {
    const eight: Array<MaterializedShiftJson> = [];

    for (let day: number = 1; day <= 8; day++) {
      eight.push(
        shift({
          shiftKey: `day-${day}`,
          start: at(day * DAY),
          end: at(day * DAY + HOUR),
        }),
      );
    }

    serve(eight);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(8);
    });
    expect(screen.queryByTestId("upcoming-shifts-fold")).toBeNull();
  });

  test("nine rows fold three away", async () => {
    const nine: Array<MaterializedShiftJson> = [];

    for (let day: number = 1; day <= 9; day++) {
      nine.push(
        shift({
          shiftKey: `day-${day}`,
          start: at(day * DAY),
          end: at(day * DAY + HOUR),
        }),
      );
    }

    serve(nine);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    expect(await screen.findByTestId("upcoming-shifts-fold")).toHaveTextContent(
      "Show 3 more shifts",
    );
  });

  test("Get cover on a row opens Add User Override for that span, on its project's page", async () => {
    serve([
      shift({
        shiftKey: "week-1",
        start: at(DAY),
        end: at(2 * DAY),
      }),
      shift({
        shiftKey: "week-2",
        start: at(2 * DAY),
        end: at(3 * DAY),
      }),
    ]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });

    expect(screen.getByText("Get cover").closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/on-call-duty/user-overrides?coverStartsAt=${encodeURIComponent(
        at(DAY),
      )}&coverEndsAt=${encodeURIComponent(at(3 * DAY))}`,
    );
  });

  test("a 12-hour reader reads 12-hour times", async () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    serve([
      shift({
        shiftKey: "afternoon",
        start: at(DAY - 2 * HOUR),
        end: at(DAY + 6 * HOUR),
      }),
    ]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });

    expect(
      (screen.getByTestId("upcoming-shift-times").textContent || "").replace(
        NARROW_SPACES,
        " ",
      ),
    ).toBe("2:00 PM – 10:00 PM");
  });

  /*
   * UI REVIEW.
   *
   * A list read link by link - a screen reader's list of links - heard
   * "Get cover" once per row and never which shift each one covers; two
   * rows on a Friday a week apart said the same "Friday". Each link now
   * says its shift after the visible words, the start's date included,
   * while the row still shows only "Get cover".
   */
  test("every Get cover says which shift it covers, to a reader who hears the links one by one", async () => {
    serve([
      shift({ shiftKey: "now", start: at(-2 * HOUR), end: at(6 * HOUR) }),
      shift({
        shiftKey: "tomorrow",
        start: at(DAY - 6 * HOUR),
        end: at(DAY + 2 * HOUR),
      }),
      shift({
        shiftKey: "friday",
        start: at(2 * DAY - 6 * HOUR),
        end: at(2 * DAY + 2 * HOUR),
      }),
      shift({
        shiftKey: "next-friday",
        start: at(9 * DAY - 6 * HOUR),
        end: at(9 * DAY + 2 * HOUR),
      }),
      shift({
        shiftKey: "cover",
        start: at(3 * DAY),
        end: at(3 * DAY + 8 * HOUR),
        override: {
          originalUserId: "user-2",
          originalUserName: "Bob",
          overrideStartsAt: at(3 * DAY),
          overrideEndsAt: at(3 * DAY + 8 * HOUR),
        },
      }),
    ]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(5);
    });

    const names: Array<string> = screen
      .getAllByRole("link")
      .map((link: HTMLElement): string => {
        return (link.textContent || "").replace(NARROW_SPACES, " ");
      });

    expect(names).toEqual([
      "Get cover (On call now, until 22:00)",
      "Get cover (Thu, Oct 15, 10:00 – 18:00)",
      "Get cover (Fri, Oct 16, 10:00 – 18:00)",
      "Get cover (Fri, Oct 23, 10:00 – 18:00)",
    ]);

    // Both Fridays read "Friday" on the row; their links tell them apart.
    const [, , friday, cover, nextFriday] = rows() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    expect(
      [friday, nextFriday].map((row: HTMLElement): string => {
        return (
          within(row).getByTestId("upcoming-shift-day-label").textContent || ""
        );
      }),
    ).toEqual(["Friday", "Friday"]);
    expect(
      screen.getByRole("link", {
        name: "Get cover (Fri, Oct 23, 10:00 – 18:00)",
      }),
    ).toBeInTheDocument();

    // The words beside a row are still just "Get cover": the rest is hidden.
    for (const link of screen.getAllByRole("link")) {
      expect(within(link).getByText("Get cover").className).not.toContain(
        "sr-only",
      );
      expect(
        within(link).getByTestId("upcoming-shift-cover-context").className,
      ).toBe("sr-only");
    }

    // Cover for someone else still has no link at all.
    expect(within(cover).getByTestId("upcoming-shift-covering")).toBeVisible();
    expect(within(cover).queryByRole("link")).toBeNull();
  });

  test("Get cover draws the card's focus ring, and the dots between facts are a grey that shows", async () => {
    serve([
      shift({
        shiftKey: "tomorrow",
        start: at(DAY - 6 * HOUR),
        end: at(DAY + 2 * HOUR),
        layerName: "Weekdays",
      }),
    ]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });

    const link: HTMLElement = screen.getByRole("link");

    expect(link.className).toContain(UPCOMING_SHIFT_COVER_CLASS_NAME);

    for (const focusClass of [
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
      "focus-visible:ring-offset-2",
    ]) {
      expect(UPCOMING_SHIFT_COVER_CLASS_NAME.split(" ")).toContain(focusClass);
    }

    const separators: Array<HTMLElement> = within(rows()[0]!).getAllByTestId(
      "upcoming-shift-separator",
    );

    // The day and the times, the schedule and the layer.
    expect(separators).toHaveLength(2);

    for (const separator of separators) {
      expect(separator).toHaveAttribute("aria-hidden", "true");
      expect(separator.className).toBe(UPCOMING_SHIFT_SEPARATOR_CLASS_NAME);
    }

    expect(UPCOMING_SHIFT_SEPARATOR_CLASS_NAME).toBe("text-gray-400");
  });

  /*
   * Left to wrap on its own, a row's end (how long, Get cover) sat beside
   * a short row's text and under a long one's - and from sm up a wrapped
   * end kept its right-aligned stack at the LEFT. Where the end goes is
   * now the screen's choice: under the text on a phone, at the right from
   * sm up, on every row. The browser suite measures it at 600, 768 and
   * 900px; this pins the classes that decide it.
   */
  test("a row's length and Get cover go under its text on a phone and beside it from sm up, on every row alike", async () => {
    serve([
      shift({
        shiftKey: "short",
        start: at(DAY - 6 * HOUR),
        end: at(DAY + 2 * HOUR),
      }),
      shift({
        shiftKey: "long",
        start: at(3 * DAY + 7 * HOUR),
        end: at(4 * DAY + 15 * HOUR),
        scheduleName:
          "Platform Infrastructure Primary Escalation Rotation for the EMEA Region",
      }),
    ]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const bodyClasses: Array<string> =
      UPCOMING_SHIFT_BODY_CLASS_NAME.split(" ");

    expect(bodyClasses).toEqual(
      expect.arrayContaining(["flex", "flex-col", "sm:flex-row"]),
    );
    // Nothing wraps on its own, at any width.
    expect(bodyClasses.join(" ")).not.toContain("wrap");
    expect(UPCOMING_SHIFT_TEXT_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["min-w-0", "sm:flex-1"]),
    );
    expect(UPCOMING_SHIFT_END_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["sm:flex-none", "sm:flex-col", "sm:items-end"]),
    );

    for (const row of rows()) {
      const body: HTMLElement = within(row).getByTestId("upcoming-shift-body");

      expect(body.className).toBe(UPCOMING_SHIFT_BODY_CLASS_NAME);
      // The text first, then the end: one order for every row.
      expect(body.children).toHaveLength(2);
      expect(body.children[0]!.className).toBe(UPCOMING_SHIFT_TEXT_CLASS_NAME);
      expect(body.children[1]!.className).toBe(UPCOMING_SHIFT_END_CLASS_NAME);
      expect(
        within(body.children[1] as HTMLElement).getByTestId(
          "upcoming-shift-length",
        ),
      ).toBeInTheDocument();
    }
  });

  /*
   * On a 320px phone a row's text column is some 150px wide. Two times of
   * one day are one piece there, so the line breaks after the day
   * ("Tomorrow ·", then "10:00 – 18:00") instead of leaving "18:00" alone
   * under "Tomorrow · 10:00 –". An end on a later day still breaks from
   * the start, or "23:00 – Sun, Oct 18, 07:00" would be wider than the
   * column.
   */
  test("two times of one day never break apart; an end on a later day may go to the next line", async () => {
    serve([
      shift({
        shiftKey: "day",
        start: at(DAY - 6 * HOUR),
        end: at(DAY + 2 * HOUR),
      }),
      shift({
        shiftKey: "night",
        start: at(3 * DAY + 7 * HOUR),
        end: at(3 * DAY + 15 * HOUR),
      }),
    ]);

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const pieces: (row: HTMLElement) => Array<string> = (
      row: HTMLElement,
    ): Array<string> => {
      return Array.from(
        within(row)
          .getByTestId("upcoming-shift-times")
          .querySelectorAll(".whitespace-nowrap"),
      ).map((piece: Element): string => {
        return piece.textContent || "";
      });
    };

    const [day, night] = rows() as [HTMLElement, HTMLElement];

    expect(pieces(day)).toEqual(["10:00 – 18:00"]);
    expect(pieces(night)).toEqual(["23:00 –", "Sun, Oct 18, 07:00"]);
  });

  /*
   * "Show fewer shifts" sits under the last of the rows. Folding them away
   * used to pull the page up by all of them, so the button went off the
   * top of the screen; now the page scrolls by what the button moved, and
   * it stays under the pointer. A browser measures where it ends up
   * (UpcomingShifts.spec.ts); jsdom lays nothing out, so the button's
   * position is given here.
   */
  test("Show fewer shifts scrolls the page by what the fold moved, so the button stays under the pointer", async () => {
    const weekdays: Array<MaterializedShiftJson> = [];

    for (let day: number = 1; day <= 22; day++) {
      weekdays.push(
        shift({
          shiftKey: `weekday-${day}`,
          start: at(day * DAY),
          end: at(day * DAY + 8 * HOUR),
        }),
      );
    }

    serve(weekdays);

    // The overload the card calls: scrollBy(x, y).
    const scrollBy: SpyInstance<(x: number, y: number) => void> = jest
      .spyOn(window, "scrollBy")
      .mockImplementation((): void => {});

    render(<UpcomingShiftsCard now={OCTOBER} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(6);
    });

    const fold: HTMLElement = screen.getByTestId("upcoming-shifts-fold");
    const topAt: (top: number) => DOMRect = (top: number): DOMRect => {
      return { top: top } as DOMRect;
    };
    const position: SpyInstance<() => DOMRect> = jest
      .spyOn(fold, "getBoundingClientRect")
      .mockReturnValueOnce(topAt(1700))
      .mockReturnValueOnce(topAt(436));

    // Opening reads no position and scrolls nothing.
    fireEvent.click(fold);

    expect(rows()).toHaveLength(22);
    expect(position).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();

    // Folding: 1,700px down the screen before, 436px after.
    fireEvent.click(fold);

    expect(rows()).toHaveLength(6);
    expect(position).toHaveBeenCalledTimes(2);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(0, 436 - 1700);
  });
});

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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
 * locally. Upcoming shifts: the window sent is the 30-day one, rows are
 * grouped by day, the "covering for" and policy-variant facts survive to the
 * DOM, and every row can reach "Get cover".
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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { MaterializedShiftJson } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import UserOnCallShiftReminder from "../../../Models/DatabaseModels/UserOnCallShiftReminder";
import ShiftRemindersCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/ShiftRemindersCard";
import UpcomingShiftsCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftsCard";
import {
  MY_SHIFTS_PATH,
  STANDING_ASSIGNMENTS_COPY,
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
  beforeEach(() => {
    resetMocks();
    goToCalendarFeedPage();
  });

  afterEach(() => {
    cleanup();
  });

  test("asks /my-shifts for the next 30 days and groups the answer by day", async () => {
    getMock.mockResolvedValue(
      ok(
        myShiftsJson(
          [
            shift({
              shiftKey: "later",
              start: "2026-09-03T07:00:00.000Z",
              end: "2026-09-03T15:00:00.000Z",
              scheduleName: "Secondary",
              layerName: "Weekdays",
            }),
            shift({ shiftKey: "first" }),
            shift({
              shiftKey: "cover",
              start: "2026-09-01T15:00:00.000Z",
              end: "2026-09-01T23:00:00.000Z",
              projectName: "Payments",
              override: {
                originalUserId: "user-2",
                originalUserName: "Bob",
                overrideStartsAt: "2026-09-01T15:00:00.000Z",
                overrideEndsAt: "2026-09-01T23:00:00.000Z",
              },
              policyVariantOf: {
                policyId: "policy-1",
                policyName: "Checkout",
                globalUserId: "user-3",
              },
            }),
          ],
          false,
        ),
      ),
    );

    render(<UpcomingShiftsCard now={NOW} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("upcoming-shift-row").length).toBe(3);
    });

    const url: string = String(
      (getMock.mock.calls[0]![0] as Record<string, unknown>)["url"],
    );
    expect(url).toContain(MY_SHIFTS_PATH);
    expect(url).toContain("from=");
    expect(url).toContain("to=");

    const days: Array<HTMLElement> =
      screen.getAllByTestId("upcoming-shift-day");
    expect(days.length).toBe(2);
    expect(within(days[0]!).getAllByTestId("upcoming-shift-row").length).toBe(
      2,
    );
    expect(within(days[1]!).getAllByTestId("upcoming-shift-row").length).toBe(
      1,
    );

    expect(screen.getByText("Covering for Bob")).toBeInTheDocument();
    expect(screen.getByText("Only on policy Checkout")).toBeInTheDocument();
    expect(screen.getByText("Weekdays")).toBeInTheDocument();
    expect(screen.getByText("Secondary")).toBeInTheDocument();
    expect(screen.getByText(/Payments/)).toBeInTheDocument();

    const expectedOverridesRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES] as Route,
    );
    const coverLinks: Array<HTMLElement> = screen.getAllByText("Get cover");
    expect(coverLinks.length).toBe(3);
    expect(coverLinks[0]!.closest("a")).toHaveAttribute(
      "href",
      expectedOverridesRoute.toString(),
    );

    expect(screen.getByText(STANDING_ASSIGNMENTS_COPY)).toBeInTheDocument();
  });

  test("an empty answer says so rather than rendering a blank card", async () => {
    getMock.mockResolvedValue(ok(myShiftsJson([], false)));

    render(<UpcomingShiftsCard now={NOW} />);

    await waitFor(() => {
      expect(screen.getByTestId("upcoming-shifts-empty")).toHaveTextContent(
        "no shifts on any schedule in the next 30 days",
      );
    });
    expect(
      screen.queryByTestId("upcoming-shifts-truncated"),
    ).not.toBeInTheDocument();
  });

  test("a truncated answer is flagged above the list", async () => {
    getMock.mockResolvedValue(
      ok(myShiftsJson([shift({ shiftKey: "only" })], true)),
    );

    render(<UpcomingShiftsCard now={NOW} />);

    await waitFor(() => {
      expect(screen.getByTestId("upcoming-shifts-truncated")).toHaveTextContent(
        "some shifts may be missing",
      );
    });
  });

  test("a failed fetch shows the reason, and Refresh asks again", async () => {
    getMock
      .mockResolvedValueOnce(
        new HTTPErrorResponse(503, { message: "Render cap reached" }, {}),
      )
      .mockResolvedValueOnce(ok(myShiftsJson([], false)));

    render(<UpcomingShiftsCard now={NOW} />);

    await waitFor(() => {
      expect(screen.getByText("Render cap reached")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByTestId("upcoming-shifts-empty")).toBeInTheDocument();
    });
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});

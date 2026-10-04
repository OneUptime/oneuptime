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
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * A status page's Email Reports card (Dashboard Components/StatusPage/
 * StatusPageReportsCard), on Advanced -> Reports.
 *
 * It was a card with an Edit dialog of three steps whose first report date
 * and interval had no default and were required - to switch reports on,
 * and to switch them off. Now it is one switch, "Send email reports", that
 * saves the switch alone the moment it is flipped; the server gives a page
 * switched on without a schedule the default one (every month, on the 1st
 * at 09:00 in the report timezone, covering the month before), which the
 * card shows in plain words while reports are on, with Edit Schedule to
 * change it on one short page. Off, there is nothing to fill in.
 *
 * The real card, switch, Detail lines, dialog, ModelForm and BasicForm are
 * rendered; only the network, the permission gate, the signed-in user, the
 * plan and the clock are stubbed. "Now" is 4 Oct 2026, 12:00 UTC.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  const granted: Array<string> = [
    PermissionEnum["ProjectOwner"]!,
    PermissionEnum["User"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: granted };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the card catches it.
 */
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import StatusPageReportsCard from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageReportsCard";
import {
  REPORT_SCHEDULE_PREVIEW_TEST_ID,
  STATUS_PAGE_REPORTS_CARD_TEST_ID,
  STATUS_PAGE_REPORTS_SWITCH_TEST_ID,
  STATUS_PAGE_REPORT_SCHEDULE_DETAILS_ID,
  STATUS_PAGE_REPORT_SCHEDULE_TEST_ID,
  StatusPageReportsCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageReportsCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import StatusPageReportPeriodType from "../../../Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "../../../Types/Timezone";
import StatusPageReportScheduleUtil, {
  StatusPageReportScheduleWrite,
} from "../../../Utils/StatusPage/ReportSchedule";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const STATUS_PAGE_ID: string = "7e7e7e7e-0000-4000-8000-0000000000aa";

const NOW: Date = OneUptimeDate.fromString("2026-10-04T12:00:00.000Z");

const SCHEDULE_COLUMNS: ReadonlyArray<string> = [
  "reportRecurringInterval",
  "reportStartDateTime",
  "reportTimezone",
  "reportPeriodType",
  "reportDataInDays",
];

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

// The next report, as the card writes it: the same formatter, the same zone.
function shownDate(iso: string, timezone: string = Timezone.UTC): string {
  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: OneUptimeDate.fromString(iso),
    timezone: timezone,
    showWeekday: true,
  });
}

// What the server holds for the page.
let stored: Record<string, unknown> = {};
let columnGate: PermissionGateResult = { isAllowed: true };
let plan: PlanType | null = null;

/*
 * The server: a switch write gets the same report columns the service
 * adds (StatusPageReportScheduleUtil), a dialog save stores what it sends.
 */
function serverStores(data: Record<string, unknown>): void {
  const write: StatusPageReportScheduleWrite =
    StatusPageReportScheduleUtil.getScheduleWrite({
      write: data,
      stored: stored,
      now: NOW,
    });

  Object.assign(stored, data);

  for (const [column, value] of Object.entries(write)) {
    if (value !== undefined) {
      stored[column] = value;
    }
  }
}

beforeEach(() => {
  stored = {
    isReportEnabled: false,
    reportTimezone: Timezone.UTC,
    reportPeriodType: StatusPageReportPeriodType.Rolling,
    reportDataInDays: 30,
  };
  columnGate = { isAllowed: true };
  plan = null;

  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation(
    (): Date => {
      return new Date(NOW.getTime());
    },
  );

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    Object.assign(page, stored);
    return page;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      serverStores((options as { data: Record<string, unknown> }).data);
      return {};
    },
  );

  createOrUpdateMock.mockReset();
  createOrUpdateMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const model: BaseModel = (options as { model: BaseModel }).model;
      serverStores(sentColumns(model));
      return { data: model };
    },
  );

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return columnGate;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID("7e7e7e7e-0000-4000-8000-0000000000ff");
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// The report columns a dialog save sent, as the server reads them.
function sentColumns(model: BaseModel): Record<string, unknown> {
  const json: JSONObject = BaseModel.toJSON(model, StatusPage);
  const sent: Record<string, unknown> = {};

  for (const column of [...SCHEDULE_COLUMNS, "isReportEnabled"]) {
    const value: unknown = (model as unknown as Record<string, unknown>)[
      column
    ];

    if (value !== undefined && value !== null && column in json) {
      sent[column] =
        column === "reportRecurringInterval"
          ? Recurring.fromJSON(value as JSONObject)
          : column === "reportStartDateTime"
            ? OneUptimeDate.fromString(value as string)
            : value;
    }
  }

  return sent;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <StatusPageReportsCard statusPageId={new ObjectID(STATUS_PAGE_ID)} />,
    );
  });

  await waitFor(() => {
    expect(
      screen.getByTestId(STATUS_PAGE_REPORTS_SWITCH_TEST_ID),
    ).toBeInTheDocument();
  });
}

function reportsSwitch(): HTMLElement {
  return screen.getByTestId(STATUS_PAGE_REPORTS_SWITCH_TEST_ID);
}

function switchRow(): HTMLElement {
  return screen.getByTestId(`${STATUS_PAGE_REPORTS_SWITCH_TEST_ID}-row`);
}

function schedule(): HTMLElement | null {
  return screen.queryByTestId(STATUS_PAGE_REPORT_SCHEDULE_TEST_ID);
}

async function press(): Promise<void> {
  await act(async () => {
    fireEvent.click(reportsSwitch());
  });
  await flush();
}

function editScheduleButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Edit Schedule" });
}

// The schedule lines, by their titles: { "Next report": "...", ... }.
function scheduleLines(): Record<string, string> {
  const details: HTMLElement = screen.getByTestId(STATUS_PAGE_REPORT_SCHEDULE_TEST_ID);
  const lines: Record<string, string> = {};

  for (const title of [
    StatusPageReportsCopy.nextReportTitle,
    StatusPageReportsCopy.howOftenTitle,
    StatusPageReportsCopy.coversTitle,
    StatusPageReportsCopy.timezoneTitle,
  ]) {
    const label: HTMLElement = within(details).getByText(title);
    const field: HTMLElement | null = label.closest(
      "[data-testid^='detail-field'], div",
    );
    lines[title] = (field?.parentElement?.textContent || "")
      .replace(title, "")
      .trim();
  }

  return lines;
}

function updates(): Array<Record<string, unknown>> {
  return updateByIdMock.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    },
  );
}

async function openScheduleDialog(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(editScheduleButton()!);
  });

  const dialog: HTMLElement = await screen.findByRole("dialog");

  await waitFor(() => {
    expect(within(dialog).getByText("First report on")).toBeInTheDocument();
  });

  return dialog;
}

describe("a page whose reports are off", () => {
  test("is one card, one switch, off, and nothing to fill in", async () => {
    await renderCard();

    expect(screen.getByText(StatusPageReportsCopy.cardTitle)).toBeInTheDocument();
    expect(
      screen.getByText(StatusPageReportsCopy.cardDescription),
    ).toBeInTheDocument();
    expect(reportsSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      within(switchRow()).getByText(StatusPageReportsCopy.switchTitle),
    ).toBeInTheDocument();

    expect(schedule()).toBeNull();
    expect(editScheduleButton()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("says what switching it on does: a report every month, on the 1st at 09:00", async () => {
    await renderCard();

    expect(switchRow()).toHaveTextContent(
      StatusPageReportsCopy.switchOffDescription,
    );
  });

  test("a page that keeps a schedule from before says that schedule is used again", async () => {
    stored = {
      ...stored,
      reportStartDateTime: OneUptimeDate.fromString("2026-01-05T08:00:00.000Z"),
      reportRecurringInterval: every(EventInterval.Week, 2),
    };

    await renderCard();

    expect(switchRow()).toHaveTextContent(
      StatusPageReportsCopy.switchOffWithScheduleDescription,
    );
  });

  test("reads the page once, for the report columns only", async () => {
    await renderCard();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(Object.keys(select).sort()).toEqual(
      [
        "isReportEnabled",
        "reportDataInDays",
        "reportPeriodType",
        "reportRecurringInterval",
        "reportStartDateTime",
        "reportTimezone",
        "sendNextReportBy",
      ].sort(),
    );
  });
});

describe("switching reports on", () => {
  test("saves the switch alone, at once: no dialog and no dates", async () => {
    await renderCard();

    await press();

    expect(updates()).toEqual([{ isReportEnabled: true }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(reportsSwitch()).toHaveAttribute("aria-checked", "true");
    });
  });

  test("shows the default schedule in plain words: the 1st of next month at 09:00, covering the month before", async () => {
    await renderCard();

    await press();

    await waitFor(() => {
      expect(schedule()).not.toBeNull();
    });

    const lines: Record<string, string> = scheduleLines();

    expect(lines[StatusPageReportsCopy.nextReportTitle]).toContain(
      shownDate("2026-11-01T09:00:00.000Z"),
    );
    expect(lines[StatusPageReportsCopy.nextReportTitle]).toContain(
      "Covering Oct 1, 2026 - Oct 31, 2026",
    );
    expect(lines[StatusPageReportsCopy.howOftenTitle]).toBe("Every month");
    expect(lines[StatusPageReportsCopy.coversTitle]).toBe(
      "The previous whole calendar period",
    );
    expect(lines[StatusPageReportsCopy.timezoneTitle]).toBe("UTC");
    expect(switchRow()).toHaveTextContent(
      StatusPageReportsCopy.switchOnDescription,
    );
  });

  test("reads the page again once the switch has saved, and shows what the server stored", async () => {
    // A server that schedules the page differently from the default.
    updateByIdMock.mockImplementation(
      async (options: unknown): Promise<unknown> => {
        Object.assign(stored, (options as { data: JSONObject }).data, {
          reportStartDateTime: OneUptimeDate.fromString(
            "2026-10-05T07:00:00.000Z",
          ),
          reportRecurringInterval: every(EventInterval.Week, 1),
          sendNextReportBy: OneUptimeDate.fromString(
            "2026-10-05T07:00:00.000Z",
          ),
        });
        return {};
      },
    );

    await renderCard();
    await press();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(scheduleLines()[StatusPageReportsCopy.howOftenTitle]).toBe(
        "Every week",
      );
    });
    expect(scheduleLines()[StatusPageReportsCopy.nextReportTitle]).toContain(
      shownDate("2026-10-05T07:00:00.000Z"),
    );
  });

  test("the default first report is 09:00 in the page's report timezone", async () => {
    stored = { ...stored, reportTimezone: Timezone.AsiaKolkata };

    await renderCard();
    await press();

    await waitFor(() => {
      expect(schedule()).not.toBeNull();
    });

    expect(scheduleLines()[StatusPageReportsCopy.nextReportTitle]).toContain(
      shownDate("2026-11-01T03:30:00.000Z", Timezone.AsiaKolkata),
    );
    expect(scheduleLines()[StatusPageReportsCopy.timezoneTitle]).toBe(
      Timezone.AsiaKolkata,
    );
  });

  test("a page that keeps a schedule from before picks it up again, from its next date", async () => {
    stored = {
      ...stored,
      reportStartDateTime: OneUptimeDate.fromString("2026-01-05T08:00:00.000Z"),
      reportRecurringInterval: every(EventInterval.Week, 2),
      reportPeriodType: StatusPageReportPeriodType.Rolling,
      reportDataInDays: 14,
    };

    await renderCard();
    await press();

    expect(updates()).toEqual([{ isReportEnabled: true }]);

    await waitFor(() => {
      expect(schedule()).not.toBeNull();
    });

    const lines: Record<string, string> = scheduleLines();

    expect(lines[StatusPageReportsCopy.nextReportTitle]).toContain(
      shownDate("2026-10-12T08:00:00.000Z"),
    );
    expect(lines[StatusPageReportsCopy.howOftenTitle]).toBe("Every 2 weeks");
    expect(lines[StatusPageReportsCopy.coversTitle]).toBe("A rolling 14 days");
  });

  test("a switch the server refuses moves back, says why, and shows no schedule", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Please upgrade your plan to Growth to access this feature",
      );
    });

    await renderCard();
    await press();

    await waitFor(() => {
      expect(within(switchRow()).getByRole("alert")).toHaveTextContent(
        "Please upgrade your plan to Growth to access this feature",
      );
    });
    expect(reportsSwitch()).toHaveAttribute("aria-checked", "false");
    expect(schedule()).toBeNull();
    expect(editScheduleButton()).toBeNull();
  });
});

describe("switching reports off", () => {
  beforeEach(() => {
    stored = {
      isReportEnabled: true,
      reportStartDateTime: OneUptimeDate.fromString("2026-11-01T09:00:00.000Z"),
      reportRecurringInterval: every(EventInterval.Month, 1),
      reportTimezone: Timezone.UTC,
      reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
      reportDataInDays: 30,
      sendNextReportBy: OneUptimeDate.fromString("2026-11-01T09:00:00.000Z"),
    };
  });

  test("a page whose reports are on shows its schedule and Edit Schedule", async () => {
    await renderCard();

    expect(reportsSwitch()).toHaveAttribute("aria-checked", "true");
    expect(schedule()).not.toBeNull();
    expect(editScheduleButton()).toBeInTheDocument();
    // The lines are a Detail, as the other switch cards' lines are.
    expect(
      document.getElementById(STATUS_PAGE_REPORT_SCHEDULE_DETAILS_ID),
    ).not.toBeNull();
  });

  test("saves the switch alone - no schedule to fill in - and the schedule and Edit Schedule go", async () => {
    await renderCard();
    await press();

    expect(updates()).toEqual([{ isReportEnabled: false }]);
    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => {
      expect(schedule()).toBeNull();
    });
    expect(editScheduleButton()).toBeNull();
    expect(switchRow()).toHaveTextContent(
      StatusPageReportsCopy.switchOffWithScheduleDescription,
    );
  });

  test("switched back on, the kept schedule shows again", async () => {
    await renderCard();
    await press();
    await waitFor(() => {
      expect(reportsSwitch()).not.toHaveAttribute("aria-disabled", "true");
    });

    await press();

    expect(updates()).toEqual([
      { isReportEnabled: false },
      { isReportEnabled: true },
    ]);
    await waitFor(() => {
      expect(schedule()).not.toBeNull();
    });
    expect(scheduleLines()[StatusPageReportsCopy.howOftenTitle]).toBe(
      "Every month",
    );
  });
});

describe("Edit Schedule", () => {
  beforeEach(() => {
    stored = {
      isReportEnabled: true,
      reportStartDateTime: OneUptimeDate.fromString("2026-11-01T09:00:00.000Z"),
      reportRecurringInterval: every(EventInterval.Month, 1),
      reportTimezone: Timezone.UTC,
      reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
      reportDataInDays: 30,
      sendNextReportBy: OneUptimeDate.fromString("2026-11-01T09:00:00.000Z"),
    };
  });

  test("sits on the card's header", async () => {
    await renderCard();

    const header: HTMLElement | null = screen
      .getByText(StatusPageReportsCopy.cardTitle)
      .closest("[data-testid='card-header']");

    expect(header).not.toBeNull();
    expect(
      within(header!).getByRole("button", { name: "Edit Schedule" }),
    ).toBeInTheDocument();
  });

  test("opens one page: how often and the first report, with the timezone and the period folded under More fields", async () => {
    await renderCard();

    const dialog: HTMLElement = await openScheduleDialog();

    expect(
      within(dialog).getByText(StatusPageReportsCopy.editScheduleTitle),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("How often")).toBeInTheDocument();
    expect(within(dialog).getByText("First report on")).toBeInTheDocument();

    // One page: no step list, no Next, and the action right there.
    expect(within(dialog).queryByRole("button", { name: "Next" })).toBeNull();
    expect(within(dialog).queryByTestId("modal-footer-next-button")).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    ).toBeInTheDocument();

    const header: HTMLElement = within(dialog).getByTestId(
      "folded-section-header",
    );

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("More fields");
    // Folded, it lists what is in it, and says what is set: UTC is the default.
    const names: Array<string> = listedNames(header);

    expect(names).toHaveLength(2);
    expect(names[0]).toBe("Report Timezone");
    expect(names[1]).toMatch(/^Reporting period: The previous whole calendar/);
    expect(setChips(header)).toEqual([names[1]]);

    // The rolling days show only for a rolling period.
    expect(
      within(dialog).queryByText(
        "How many days of data should the report cover?",
      ),
    ).toBeNull();
  });

  test("shows, under the first report date, when the next report goes out and what it covers", async () => {
    await renderCard();

    const dialog: HTMLElement = await openScheduleDialog();
    const preview: HTMLElement = within(dialog).getByTestId(
      REPORT_SCHEDULE_PREVIEW_TEST_ID,
    );

    expect(preview).toHaveTextContent(
      `Next report: ${shownDate("2026-11-01T09:00:00.000Z")}`,
    );
    expect(preview).toHaveTextContent("Covering Oct 1, 2026 - Oct 31, 2026");
    expect(preview).toHaveTextContent(
      "Times and period boundaries are resolved in UTC.",
    );
  });

  test("Save Changes sends the schedule and not the switch, and the card reads the page again", async () => {
    await renderCard();

    const dialog: HTMLElement = await openScheduleDialog();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: BaseModel = (
      createOrUpdateMock.mock.calls[0]![0] as { model: BaseModel }
    ).model;
    const values: Record<string, unknown> = model as unknown as Record<
      string,
      unknown
    >;

    expect(values["isReportEnabled"]).toBeUndefined();
    expect(Recurring.fromJSON(values["reportRecurringInterval"] as JSONObject).toString()).toBe(
      "1 Month",
    );
    expect(values["reportTimezone"]).toBe(Timezone.UTC);
    expect(values["reportPeriodType"]).toBe(
      StatusPageReportPeriodType.PreviousCalendarPeriod,
    );
    expect(
      OneUptimeDate.fromString(values["reportStartDateTime"] as string).toISOString(),
    ).toBe("2026-11-01T09:00:00.000Z");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(getItemMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    expect(updates()).toEqual([]);
  });

  test("a page on without a whole schedule says so, and the dialog starts from the default one", async () => {
    // Switched on through the API before the server filled a schedule in.
    stored = {
      isReportEnabled: true,
      reportTimezone: Timezone.UTC,
      reportPeriodType: StatusPageReportPeriodType.Rolling,
      reportDataInDays: 30,
    };

    await renderCard();

    expect(scheduleLines()[StatusPageReportsCopy.nextReportTitle]).toBe(
      StatusPageReportsCopy.notScheduled,
    );

    const dialog: HTMLElement = await openScheduleDialog();

    await waitFor(() => {
      expect(
        within(dialog).getByTestId(REPORT_SCHEDULE_PREVIEW_TEST_ID),
      ).toHaveTextContent(
        `Next report: ${shownDate("2026-11-01T09:00:00.000Z")}`,
      );
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const values: Record<string, unknown> = (
      createOrUpdateMock.mock.calls[0]![0] as { model: BaseModel }
    ).model as unknown as Record<string, unknown>;

    expect(Recurring.fromJSON(values["reportRecurringInterval"] as JSONObject).toString()).toBe(
      "1 Month",
    );
    expect(values["reportPeriodType"]).toBe(
      StatusPageReportPeriodType.PreviousCalendarPeriod,
    );
  });
});

describe("who may change it", () => {
  test("someone who may not edit the page sees the switch locked, and Edit Schedule locked, saying why", async () => {
    columnGate = {
      isAllowed: false,
      disabledReason:
        "You need one of these permissions to update Status Page: Project Owner",
    };
    stored = {
      isReportEnabled: true,
      reportStartDateTime: OneUptimeDate.fromString("2026-11-01T09:00:00.000Z"),
      reportRecurringInterval: every(EventInterval.Month, 1),
      reportTimezone: Timezone.UTC,
    };

    await renderCard();

    expect(reportsSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(editScheduleButton()).toBeDisabled();

    await press();
    expect(updates()).toEqual([]);
  });

  test("on the Free plan, the switch names the Growth plan reports need", async () => {
    plan = PlanType.Free;

    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((needed: unknown): boolean => {
      return needed === PlanType.Free;
    });

    await renderCard();

    expect(within(switchRow()).getByTestId("pill")).toHaveTextContent(
      "Growth Plan",
    );
  });

  test("with billing off (no plan), no plan is named", async () => {
    await renderCard();

    expect(within(switchRow()).queryByTestId("pill")).toBeNull();
  });
});

describe("the card", () => {
  test("is found by its test id", async () => {
    await renderCard();

    expect(
      screen.getByTestId(STATUS_PAGE_REPORTS_CARD_TEST_ID),
    ).toBeInTheDocument();
  });

  test("a page that cannot be read says why, and can be tried again", async () => {
    getItemMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The server is not answering.");
    });

    await act(async (): Promise<void> => {
      render(
        <StatusPageReportsCard statusPageId={new ObjectID(STATUS_PAGE_ID)} />,
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText("The server is not answering."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId(STATUS_PAGE_REPORTS_SWITCH_TEST_ID)).toBeNull();

    // The server is back: Refresh reads the page again, and the switch shows.
    getItemMock.mockImplementation(async (): Promise<unknown> => {
      const page: StatusPage = new StatusPage();
      page._id = STATUS_PAGE_ID;
      Object.assign(page, stored);
      return page;
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(STATUS_PAGE_REPORTS_SWITCH_TEST_ID),
      ).toBeInTheDocument();
    });
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });
});

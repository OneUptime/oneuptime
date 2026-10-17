/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import CalendarElement, {
  DefaultCalendarView,
} from "../../../../UI/Components/Calendar/Calendar";
import {
  CALENDAR_TOOLBAR_LABEL_TEST_ID,
  CALENDAR_TOOLBAR_TEST_ID,
  CALENDAR_VIEW_SWITCH_TEST_ID,
} from "../../../../UI/Components/Calendar/CalendarToolbar";
import {
  CalendarEventAppearance,
  getSoftEventStyle,
  SOFT_EVENT_CLASS_NAME,
  SOFT_EVENT_DARK_BACKGROUND_PROPERTY,
  SOFT_EVENT_DARK_SHADOW_PROPERTY,
  SOFT_EVENT_DARK_TEXT_PROPERTY,
} from "../../../../UI/Components/Calendar/CalendarEventTone";
import { VIEW_SWITCH_ACTIVE_CLASS_NAME } from "../../../../UI/Components/ViewSwitch/ViewSwitch";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";
import StartAndEndTime from "../../../../Types/Time/StartAndEndTime";

/*
 * The calendar's toolbar (CalendarToolbar), the product's own in place of
 * react-big-calendar's "Today | Back | Next" box: Today, two arrows named
 * for what they do in the view on screen, the period's name beside them,
 * and the views as the product's switch (ViewSwitch). What the calendar is
 * doing - loading a period - is said beside the period, without taking the
 * focus off the arrow a keyboard just pressed.
 *
 * And the blocks: solid in their colour by default, as the on-call
 * schedules draw people; soft (CalendarEventTone) when asked, as the
 * scheduled maintenance calendar draws states.
 */

const OCTOBER: number = 9;

function october(day: number, hour: number): Date {
  return new Date(Date.UTC(2026, OCTOBER, day, hour, 0, 0));
}

const EVENTS: Array<CalendarEvent> = [
  {
    id: 1,
    title: "Database upgrade",
    start: october(20, 22),
    end: october(20, 23),
    color: "#000000",
  },
];

const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: false,
    resources: {
      en: { translation: {} },
      de: { translation: GERMAN },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

interface RenderOptions {
  views?: Array<DefaultCalendarView> | undefined;
  onRangeChange?: ((range: StartAndEndTime) => void) | undefined;
  toolbarStatus?: ReactElement | undefined;
  eventAppearance?: CalendarEventAppearance | undefined;
}

function calendar(options: RenderOptions): ReactElement {
  return (
    <CalendarElement
      events={EVENTS}
      defaultDate={october(15, 10)}
      defaultCalendarView={DefaultCalendarView.Month}
      views={
        options.views || [
          DefaultCalendarView.Month,
          DefaultCalendarView.Week,
          DefaultCalendarView.Day,
        ]
      }
      onRangeChange={options.onRangeChange || (() => {})}
      toolbarStatus={options.toolbarStatus}
      eventAppearance={options.eventAppearance}
    />
  );
}

function renderCalendar(options: RenderOptions = {}): RenderResult {
  return render(calendar(options));
}

function toolbar(): HTMLElement {
  return screen.getByTestId(CALENDAR_TOOLBAR_TEST_ID);
}

function periodLabel(): string {
  return screen.getByTestId(CALENDAR_TOOLBAR_LABEL_TEST_ID).textContent || "";
}

describe("Calendar's toolbar", () => {
  test("Today, two arrows named for the month, the month beside them, and the views as the product's switch", () => {
    renderCalendar();

    const bar: HTMLElement = toolbar();

    expect(within(bar).getByRole("button", { name: "Today" })).toBeVisible();

    const back: HTMLElement = within(bar).getByRole("button", {
      name: "Previous month",
    });
    const forward: HTMLElement = within(bar).getByRole("button", {
      name: "Next month",
    });

    // Named on hover too, not only for a screen reader.
    expect(back).toHaveAttribute("title", "Previous month");
    expect(forward).toHaveAttribute("title", "Next month");

    expect(periodLabel()).toBe("October 2026");
    expect(screen.getByTestId(CALENDAR_TOOLBAR_LABEL_TEST_ID).tagName).toBe(
      "H3",
    );

    const views: HTMLElement = within(bar).getByRole("group", {
      name: "Calendar range",
    });

    expect(views).toHaveAttribute("data-testid", CALENDAR_VIEW_SWITCH_TEST_ID);
    expect(
      within(views)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        }),
    ).toEqual(["Month", "Week", "Day"]);
    expect(
      within(views).getByRole("button", { name: "Month" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(views).getByRole("button", { name: "Month" })).toHaveClass(
      VIEW_SWITCH_ACTIVE_CLASS_NAME.split(" ")[0]!,
    );

    // react-big-calendar's own toolbar is gone.
    expect(document.querySelector(".rbc-toolbar")).toBeNull();
  });

  test("the arrows move a month at a time and Today comes back, each move reporting the range shown", () => {
    const onRangeChange: Mock<(range: StartAndEndTime) => void> =
      jest.fn<(range: StartAndEndTime) => void>();

    renderCalendar({ onRangeChange });

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));

    expect(periodLabel()).toBe("November 2026");
    expect(onRangeChange).toHaveBeenCalledTimes(1);

    const november: StartAndEndTime = onRangeChange.mock.calls[0]![0]!;

    // The grid of November: from the Sunday before the 1st to the Saturday after the 30th.
    expect(november.startTime.getTime()).toBeLessThanOrEqual(
      Date.UTC(2026, 10, 1),
    );
    expect(november.endTime.getTime()).toBeGreaterThanOrEqual(
      Date.UTC(2026, 10, 30),
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));

    expect(periodLabel()).toBe("September 2026");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    expect(periodLabel()).toBe("October 2026");
    expect(onRangeChange).toHaveBeenCalledTimes(4);
  });

  test("in the week and the day, the arrows are named for them", () => {
    renderCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Previous week" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next week" }),
    ).toBeInTheDocument();
    expect(periodLabel()).toBe("October 11 – 17");

    fireEvent.click(screen.getByRole("button", { name: "Day" }));

    expect(
      screen.getByRole("button", { name: "Previous day" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next day" }),
    ).toBeInTheDocument();
    expect(periodLabel()).toBe("Thursday Oct 15");

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));

    expect(periodLabel()).toBe("Friday Oct 16");
  });

  test("the agenda, which moves by its own length, keeps react-big-calendar's words for its arrows", () => {
    renderCalendar({ views: [] });

    // Every view when none is asked for, the agenda among them.
    fireEvent.click(screen.getByRole("button", { name: "Agenda" }));

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  test("a calendar of one view has no switch", () => {
    renderCalendar({ views: [DefaultCalendarView.Month] });

    expect(screen.queryByTestId(CALENDAR_VIEW_SWITCH_TEST_ID)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Next month" }),
    ).toBeInTheDocument();
  });

  test("what the calendar is doing is said beside the period, and the arrow a keyboard pressed keeps its focus when that changes", () => {
    const result: RenderResult = renderCalendar();

    const forward: HTMLElement = screen.getByRole("button", {
      name: "Next month",
    });

    act(() => {
      forward.focus();
    });

    expect(forward).toHaveFocus();

    result.rerender(
      calendar({
        toolbarStatus: (
          <span data-testid="calendar-status">Loading events...</span>
        ),
      }),
    );

    // Beside the period, in the toolbar.
    expect(within(toolbar()).getByTestId("calendar-status")).toHaveTextContent(
      "Loading events...",
    );

    // The same button, still focused: the toolbar was not drawn anew.
    expect(screen.getByRole("button", { name: "Next month" })).toBe(forward);
    expect(forward).toHaveFocus();

    result.rerender(calendar({}));

    expect(screen.queryByTestId("calendar-status")).toBeNull();
    expect(forward).toHaveFocus();
  });

  test("German: Today, the arrows, the views and their group in the reader's words", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    renderCalendar();

    const bar: HTMLElement = toolbar();

    expect(
      within(bar).getByRole("button", { name: GERMAN["Today"]! }),
    ).toBeVisible();
    expect(
      within(bar).getByRole("button", { name: GERMAN["Previous month"]! }),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole("button", { name: GERMAN["Next month"]! }),
    ).toBeInTheDocument();
    expect(GERMAN["Next month"]).toBe("Nächster Monat");

    const views: HTMLElement = within(bar).getByRole("group", {
      name: GERMAN["Calendar range"]!,
    });

    expect(
      within(views)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        }),
    ).toEqual([GERMAN["Month"], GERMAN["Week"], GERMAN["Day"]]);

    // The month in German, on the Gregorian grid.
    expect(periodLabel()).toBe("Oktober 2026");

    fireEvent.click(
      within(views).getByRole("button", { name: GERMAN["Day"]! }),
    );

    expect(
      within(bar).getByRole("button", { name: GERMAN["Next day"]! }),
    ).toBeInTheDocument();
  });
});

describe("Calendar's blocks", () => {
  function block(): HTMLElement {
    return document.querySelector(".rbc-event") as HTMLElement;
  }

  test("solid by default: the event's colour fills the block, as the on-call schedules draw people", () => {
    renderCalendar();

    expect(block()).not.toHaveClass(SOFT_EVENT_CLASS_NAME);
    expect(block().style.backgroundColor).toBe("rgb(0, 0, 0)");
    expect(block().style.color).toBe("rgb(255, 255, 255)");
  });

  test("soft when asked: the pill's wash, text and stripe, with the dark theme's along as custom properties", () => {
    renderCalendar({ eventAppearance: CalendarEventAppearance.Soft });

    const expected: ReturnType<typeof getSoftEventStyle> =
      getSoftEventStyle("#000000");

    expect(block()).toHaveClass(SOFT_EVENT_CLASS_NAME);

    // A pale block, not a black one.
    expect(block().style.backgroundColor).not.toBe("rgb(0, 0, 0)");

    const probe: HTMLDivElement = document.createElement("div");

    probe.style.backgroundColor = String(expected.backgroundColor);
    probe.style.color = String(expected.color);

    expect(block().style.backgroundColor).toBe(probe.style.backgroundColor);
    expect(block().style.color).toBe(probe.style.color);
    expect(block().style.boxShadow).toContain("inset 3px 0 0");

    for (const property of [
      SOFT_EVENT_DARK_BACKGROUND_PROPERTY,
      SOFT_EVENT_DARK_TEXT_PROPERTY,
      SOFT_EVENT_DARK_SHADOW_PROPERTY,
    ]) {
      expect(block().style.getPropertyValue(property)).toBe(
        String(expected[property]),
      );
    }
  });
});

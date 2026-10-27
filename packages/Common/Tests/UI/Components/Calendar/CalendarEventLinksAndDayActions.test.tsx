/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { DateRange, Formats, Messages } from "react-big-calendar";
import CalendarElement, {
  DefaultCalendarView,
  getCalendarFormats,
  getCalendarMessages,
} from "../../../../UI/Components/Calendar/Calendar";
import { CALENDAR_VIEW_SWITCH_TEST_ID } from "../../../../UI/Components/Calendar/CalendarToolbar";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";

/*
 * What the scheduled maintenance calendar asks of the shared calendar,
 * beyond what the on-call schedules use: the views its toolbar offers, an
 * event's block that is a link a keyboard reaches (react-big-calendar draws
 * the block as a div), a click on a block, an action beside a day's number
 * (schedule maintenance on that day), and the toolbar's words in the
 * reader's language.
 */

const OCTOBER: number = 9;

function october(day: number, hour: number): Date {
  return new Date(Date.UTC(2026, OCTOBER, day, hour, 0, 0));
}

const EVENT: CalendarEvent = {
  id: 1,
  title: "Database upgrade",
  start: october(20, 22),
  end: october(20, 23),
};

afterEach(() => {
  cleanup();
});

function renderMonth(props: {
  onEventClick?: (event: CalendarEvent) => void;
  renderEventContent?: (event: CalendarEvent) => ReactElement;
  renderDayAction?: (date: Date) => ReactElement | null;
  views?: Array<DefaultCalendarView>;
}): void {
  render(
    <CalendarElement
      events={[EVENT]}
      defaultDate={october(15, 10)}
      defaultCalendarView={DefaultCalendarView.Month}
      onRangeChange={() => {}}
      {...props}
    />,
  );
}

describe("Calendar: the views the toolbar offers", () => {
  function viewSwitch(): HTMLElement {
    return screen.getByTestId(CALENDAR_VIEW_SWITCH_TEST_ID);
  }

  test("only the views asked for, in their order", () => {
    renderMonth({
      views: [
        DefaultCalendarView.Month,
        DefaultCalendarView.Week,
        DefaultCalendarView.Day,
      ],
    });

    const viewButtons: Array<string> = within(viewSwitch())
      .getAllByRole("button")
      .map((button: HTMLElement) => {
        return button.textContent || "";
      });

    expect(viewButtons).toEqual(["Month", "Week", "Day"]);
  });

  test("every view when none is asked for, as before", () => {
    renderMonth({});

    expect(within(viewSwitch()).getByText("Agenda")).toBeInTheDocument();
  });
});

describe("Calendar: an event's block", () => {
  test("shows what the caller renders - a link a keyboard reaches - instead of the bare title", () => {
    renderMonth({
      renderEventContent: (event: CalendarEvent) => {
        return (
          <a href={`/events/${event.id}`} data-testid="event-link">
            {event.title}
          </a>
        );
      },
    });

    const eventLink: HTMLElement = screen.getByTestId("event-link");

    expect(eventLink).toHaveAttribute("href", "/events/1");
    expect(eventLink).toHaveTextContent("Database upgrade");
    expect(eventLink.closest(".rbc-event")).not.toBeNull();
  });

  test("a click on the block reaches the caller with its event", () => {
    const onEventClick: Mock<(event: CalendarEvent) => void> =
      jest.fn<(event: CalendarEvent) => void>();

    renderMonth({ onEventClick });

    fireEvent.click(document.querySelector(".rbc-event") as HTMLElement);

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0]![0]!.title).toBe("Database upgrade");
  });
});

describe("Calendar: an action beside a day's number", () => {
  test("each day of the month gets the caller's action; days of the months around it do not", () => {
    const askedFor: Array<string> = [];

    renderMonth({
      renderDayAction: (date: Date) => {
        askedFor.push(date.toISOString().slice(0, 10));

        return (
          <button type="button" data-testid="day-action">
            +
          </button>
        );
      },
    });

    expect(screen.getAllByTestId("day-action")).toHaveLength(31);
    expect(askedFor[0]).toBe("2026-10-01");
    expect(askedFor[askedFor.length - 1]).toBe("2026-10-31");
  });

  test("the day's number still opens the day, beside the action", () => {
    renderMonth({
      renderDayAction: () => {
        return <span data-testid="day-action">+</span>;
      },
    });

    const header: HTMLElement = screen.getAllByTestId("day-action")[0]!
      .parentElement as HTMLElement;

    expect(header).toHaveClass("oneuptime-calendar-date-header");
    expect(within(header).getByRole("button")).toHaveTextContent("01");
  });

  test("a day the caller gives no action to has its number alone", () => {
    renderMonth({
      renderDayAction: (date: Date) => {
        return date.getUTCDate() === 15 ? (
          <span data-testid="day-action">+</span>
        ) : null;
      },
    });

    expect(screen.getAllByTestId("day-action")).toHaveLength(1);
  });
});

describe("Calendar: the toolbar's words in the reader's language", () => {
  const german: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
      ),
      "utf8",
    ),
  ) as Record<string, string>;

  const messages: Messages<CalendarEvent> = getCalendarMessages(
    createTranslator((key: string): string | undefined => {
      return german[key];
    }, "de"),
  );

  test("every word react-big-calendar would otherwise write in English", () => {
    expect(messages.today).toBe(german["Today"]);
    expect(messages.month).toBe(german["Month"]);
    expect(messages.week).toBe(german["Week"]);
    expect(messages.day).toBe(german["Day"]);
    expect(messages.allDay).toBe("Ganztägig");
    expect(messages.noEventsInRange).toBe(
      "In diesem Zeitraum gibt es keine Ereignisse.",
    );

    for (const word of [
      messages.today,
      messages.previous,
      messages.next,
      messages.month,
      messages.week,
      messages.day,
      messages.agenda,
      messages.allDay,
      messages.noEventsInRange,
    ]) {
      expect(typeof word).toBe("string");
      expect((word as string).length).toBeGreaterThan(0);
    }
  });

  test("+N more of a full day, in the form the count takes", () => {
    const showMore: (
      count: number,
      remaining: Array<CalendarEvent>,
      events: Array<CalendarEvent>,
    ) => string = messages.showMore as unknown as (
      count: number,
      remaining: Array<CalendarEvent>,
      events: Array<CalendarEvent>,
    ) => string;

    expect(showMore(3, [], [])).toBe("+3 weitere");
    expect(showMore(1, [], [])).toBe("+1 weiteres");
  });

  test("English without a translation", () => {
    const english: Messages<CalendarEvent> = getCalendarMessages(
      createTranslator(undefined),
    );

    expect(english.today).toBe("Today");
    expect(english.noEventsInRange).toBe("There are no events in this range.");
    expect((english.showMore as unknown as (count: number) => string)(2)).toBe(
      "+2 more",
    );
  });
});

describe("Calendar: the dates and times in the reader's language", () => {
  const THURSDAY: Date = new Date(2026, 9, 15, 10, 20);

  function format(formats: Formats, name: keyof Formats, date: Date): string {
    return (formats[name] as (date: Date) => string)(date);
  }

  function formatRange(
    formats: Formats,
    name: keyof Formats,
    range: DateRange,
  ): string {
    return (formats[name] as (range: DateRange) => string)(range);
  }

  test("English keeps react-big-calendar's own wording", () => {
    const english: Formats = getCalendarFormats("en");

    expect(Object.keys(english)).toEqual(["eventTimeRangeStartFormat"]);
    expect(getCalendarFormats(undefined)).toBe(english);
    expect(getCalendarFormats("en-GB")).toBe(english);
  });

  test("German: the month, the day names and the hours as a German reader writes them", () => {
    const german: Formats = getCalendarFormats("de");

    expect(format(german, "monthHeaderFormat", THURSDAY)).toBe("Oktober 2026");
    expect(format(german, "weekdayFormat", THURSDAY)).toBe("Do");
    expect(format(german, "timeGutterFormat", THURSDAY)).toBe("10:20");
    expect(
      formatRange(german, "eventTimeRangeFormat", {
        start: THURSDAY,
        end: new Date(2026, 9, 15, 13, 0),
      }),
    ).toBe("10:20 – 13:00");
    expect(
      formatRange(german, "dayRangeHeaderFormat", {
        start: new Date(2026, 9, 11),
        end: new Date(2026, 9, 17),
      }),
    ).toBe("11. Oktober – 17. Oktober");
  });

  test("a block that ends at the midnight closing its day still says so", () => {
    const german: Formats = getCalendarFormats("de");

    expect(
      formatRange(german, "eventTimeRangeStartFormat", {
        start: new Date(2026, 9, 15, 19, 26),
        end: new Date(2026, 9, 16, 0, 0),
      }),
    ).toBe("19:26 – 00:00");
    expect(
      formatRange(german, "eventTimeRangeStartFormat", {
        start: new Date(2026, 9, 15, 19, 26),
        end: new Date(2026, 9, 17, 3, 0),
      }),
    ).toBe("19:26 – ");
  });

  test("Persian names the Gregorian month the grid shows, in Persian digits as every date on the page", () => {
    const persian: Formats = getCalendarFormats("fa");
    const month: string = format(persian, "monthHeaderFormat", THURSDAY);

    // October, not the Solar Hijri month (Mehr) a Persian date names by default.
    expect(month).toContain("۲۰۲۶");
    expect(month).not.toContain("2026");
    expect(month).toContain("اکتبر");
    expect(month).not.toContain("مهر");

    // The grid's day numbers and its hours, in the same digits.
    expect(format(persian, "dateFormat", THURSDAY)).toBe("۱۵");
    expect(format(persian, "dateFormat", new Date(2026, 9, 1))).toBe("۰۱");
    expect(format(persian, "timeGutterFormat", THURSDAY)).toContain("۱۰:۲۰");
  });

  test("German writes the grid's day numbers as the English grid does, two digits", () => {
    expect(
      format(getCalendarFormats("de"), "dateFormat", new Date(2026, 9, 1)),
    ).toBe("01");
  });

  test("a language Intl does not know falls back to English words", () => {
    expect(
      format(
        getCalendarFormats("xx-not-a-language-tag-"),
        "monthHeaderFormat",
        THURSDAY,
      ),
    ).toBe("October 2026");
  });
});

/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
import { Messages } from "react-big-calendar";
import CalendarElement, {
  DefaultCalendarView,
  getCalendarMessages,
} from "../../../../UI/Components/Calendar/Calendar";
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
  test("only the views asked for, in their order", () => {
    renderMonth({
      views: [
        DefaultCalendarView.Month,
        DefaultCalendarView.Week,
        DefaultCalendarView.Day,
      ],
    });

    const toolbar: HTMLElement = document.querySelector(
      ".rbc-toolbar",
    ) as HTMLElement;
    const viewButtons: Array<string> = Array.from(
      toolbar.querySelectorAll(".rbc-btn-group:last-child button"),
    ).map((button: Element) => {
      return button.textContent || "";
    });

    expect(viewButtons).toEqual(["Month", "Week", "Day"]);
  });

  test("every view when none is asked for, as before", () => {
    renderMonth({});

    expect(
      within(document.querySelector(".rbc-toolbar") as HTMLElement).getByText(
        "Agenda",
      ),
    ).toBeInTheDocument();
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
    const onEventClick: jest.Mock<(event: CalendarEvent) => void> = jest.fn();

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

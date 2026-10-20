/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { DateLocalizer } from "react-big-calendar";
import CalendarElement, {
  CalendarDaySpan,
  CalendarEventSort,
  CalendarSortableEvent,
  DefaultCalendarView,
  calendarLocalizer,
  getCalendarLocalizer,
} from "../../../../UI/Components/Calendar/Calendar";
import { CalendarEventAppearance } from "../../../../UI/Components/Calendar/CalendarEventTone";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";

/*
 * Events from another calendar drawn beside a page's own (the Maintenance
 * Calendar's public holidays, change freezes and other projects' events,
 * issue #5084): CalendarEventAppearance.Overlay.
 *
 *   - A day's own events come before its overlays. react-big-calendar orders
 *     a day by length and start time, and a month's cell shows its first few
 *     blocks with "+N more" for the rest, so a busy calendar from outside the
 *     project took the cell and folded the page's own events away.
 *   - An overlay opens nothing, so a keyboard does not stop on it: the week's
 *     and the day's blocks are buttons react-big-calendar puts in the tab
 *     order, and an overlay's was a stop with no focus ring and no action.
 */

const OCTOBER: number = 9;

function october(day: number, hour: number, minute: number = 0): Date {
  return new Date(Date.UTC(2026, OCTOBER, day, hour, minute, 0));
}

let nextId: number = 1;

function event(
  title: string,
  start: Date,
  end: Date,
  options?: { overlay?: boolean; allDay?: boolean },
): CalendarEvent {
  return {
    id: nextId++,
    title: title,
    start: start,
    end: end,
    allDay: options?.allDay === true,
    ...(options?.overlay ? { appearance: CalendarEventAppearance.Overlay } : {}),
  };
}

// What react-big-calendar hands the sort: the event's own dates and flag.
function sortable(item: CalendarEvent): CalendarSortableEvent {
  return { start: item.start, end: item.end, allDay: item.allDay };
}

// The events in the order react-big-calendar would lay them out.
function sortWith(
  localizer: DateLocalizer,
  events: Array<CalendarEvent>,
): Array<string> {
  const sortEvents: CalendarEventSort =
    localizer.sortEvents as unknown as CalendarEventSort;

  return [...events]
    .sort((a: CalendarEvent, b: CalendarEvent) => {
      return sortEvents({ evtA: sortable(a), evtB: sortable(b) });
    })
    .map((item: CalendarEvent) => {
      return item.title;
    });
}

afterEach(() => {
  cleanup();
});

describe("getCalendarLocalizer: a day's own events before its overlays", () => {
  test("without overlays it is the calendar's one localizer, as before", () => {
    const events: Array<CalendarEvent> = [
      event("Database upgrade", october(20, 22), october(20, 23)),
    ];

    expect(getCalendarLocalizer(events)).toBe(calendarLocalizer);
    expect(getCalendarLocalizer([])).toBe(calendarLocalizer);
  });

  test("an overlay that starts earlier, or lasts longer, still comes after the day's own event", () => {
    const own: CalendarEvent = event(
      "Database upgrade",
      october(20, 22),
      october(20, 23),
    );
    const morning: CalendarEvent = event(
      "Morning stand-up",
      october(20, 8),
      october(20, 9),
      { overlay: true },
    );
    const allDay: CalendarEvent = event(
      "Founders' Day",
      october(20, 0),
      october(21, 0),
      { overlay: true, allDay: true },
    );
    const events: Array<CalendarEvent> = [morning, allDay, own];

    // The library alone: the all-day overlay, the earlier one, then ours.
    expect(sortWith(calendarLocalizer, events)).toEqual([
      "Founders' Day",
      "Morning stand-up",
      "Database upgrade",
    ]);

    // Ours first; the overlays keep the library's order among themselves.
    expect(sortWith(getCalendarLocalizer(events), events)).toEqual([
      "Database upgrade",
      "Founders' Day",
      "Morning stand-up",
    ]);
  });

  test("every event of the page's own is laid out before any overlay, each group in the library's order", () => {
    const events: Array<CalendarEvent> = [
      event("Overlay on the 21st", october(21, 7), october(21, 8), {
        overlay: true,
      }),
      event("Ours, late on the 20th", october(20, 20), october(20, 21)),
      event("Ours, early on the 20th", october(20, 6), october(20, 7)),
      event("Overlay on the 20th", october(20, 5), october(20, 6), {
        overlay: true,
      }),
      event("Ours on the 21st", october(21, 9), october(21, 10)),
      event("A freeze from the 19th", october(19, 0), october(24, 0), {
        overlay: true,
      }),
    ];

    expect(sortWith(getCalendarLocalizer(events), events)).toEqual([
      "Ours, early on the 20th",
      "Ours, late on the 20th",
      "Ours on the 21st",
      "A freeze from the 19th",
      "Overlay on the 20th",
      "Overlay on the 21st",
    ]);
  });

  test("an overlay of several days is never one of the long blocks react-big-calendar lays out first", () => {
    const freeze: CalendarEvent = event(
      "Quarter-end change freeze",
      october(29, 0),
      october(31, 18),
      { overlay: true },
    );
    const migration: CalendarEvent = event(
      "Storage migration",
      october(27, 8),
      october(29, 18),
    );
    const daySpan: CalendarDaySpan = (
      getCalendarLocalizer([freeze, migration]) as unknown as {
        daySpan: CalendarDaySpan;
      }
    ).daySpan;
    const libraryDaySpan: CalendarDaySpan = (
      calendarLocalizer as unknown as { daySpan: CalendarDaySpan }
    ).daySpan;

    // The library calls both long; the page's own stays long, the overlay not.
    expect(libraryDaySpan(freeze.start, freeze.end)).toBeGreaterThan(1);
    expect(daySpan(freeze.start, freeze.end)).toBe(1);
    expect(daySpan(migration.start, migration.end)).toBe(
      libraryDaySpan(migration.start, migration.end),
    );
    expect(daySpan(migration.start, migration.end)).toBeGreaterThan(1);
  });

  test("the copy keeps every setting of the calendar's localizer", () => {
    const events: Array<CalendarEvent> = [
      event("Overlay", october(20, 5), october(20, 6), { overlay: true }),
    ];
    const localizer: DateLocalizer = getCalendarLocalizer(events);

    expect(localizer).not.toBe(calendarLocalizer);
    // A midnight-to-midnight block is never date-only (Calendar.tsx).
    expect(
      localizer.startAndEndAreDateOnly(october(20, 0), october(21, 0)),
    ).toBe(false);
    expect(localizer.getTotalMin).toBe(calendarLocalizer.getTotalMin);
    expect(localizer.format(october(20, 9), "LT")).toBe(
      calendarLocalizer.format(october(20, 9), "LT"),
    );
  });
});

describe("the calendar draws them", () => {
  function renderCalendar(
    view: DefaultCalendarView,
    events: Array<CalendarEvent>,
  ): HTMLElement {
    return render(
      <CalendarElement
        events={events}
        defaultDate={october(20, 12)}
        defaultCalendarView={view}
        views={[
          DefaultCalendarView.Month,
          DefaultCalendarView.Week,
          DefaultCalendarView.Day,
        ]}
        onRangeChange={() => {}}
      />,
    ).container;
  }

  function block(container: HTMLElement, title: string): HTMLElement {
    const found: HTMLElement | undefined = Array.from(
      container.querySelectorAll<HTMLElement>(".rbc-event"),
    ).find((element: HTMLElement) => {
      return element.textContent?.includes(title);
    });

    expect({ title, found: Boolean(found) }).toEqual({ title, found: true });

    return found!;
  }

  test("a month's day lays its own event out above an overlay that starts earlier", () => {
    const container: HTMLElement = renderCalendar(DefaultCalendarView.Month, [
      event("Morning stand-up", october(20, 8), october(20, 9), {
        overlay: true,
      }),
      event("Database upgrade", october(20, 22), october(20, 23)),
    ]);

    const own: HTMLElement = block(container, "Database upgrade");
    const overlay: HTMLElement = block(container, "Morning stand-up");

    expect(
      own.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a month's week lays a long event of its own out above a long overlay that started a day before", () => {
    const container: HTMLElement = renderCalendar(DefaultCalendarView.Month, [
      event("Autumn break", october(26, 0), october(28, 0), {
        overlay: true,
        allDay: true,
      }),
      event("Storage migration", october(27, 8), october(29, 18)),
    ]);

    const own: HTMLElement = block(container, "Storage migration");
    const overlay: HTMLElement = block(container, "Autumn break");

    expect(
      own.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("in the week, a keyboard stops on the page's own block but not on an overlay's", () => {
    const container: HTMLElement = renderCalendar(DefaultCalendarView.Week, [
      event("Payments release window", october(20, 14), october(20, 16), {
        overlay: true,
      }),
      event("Database upgrade", october(20, 9), october(20, 11)),
    ]);

    const own: HTMLElement = block(container, "Database upgrade");
    const overlay: HTMLElement = block(container, "Payments release window");

    expect(own).toHaveAttribute("role", "button");
    expect(own).toHaveAttribute("tabindex", "0");

    expect(overlay).not.toHaveAttribute("role");
    expect(overlay).toHaveAttribute("tabindex", "-1");
    // Still on the page for a screen reader, its title read where it is.
    expect(overlay).toHaveTextContent("Payments release window");
    expect(overlay).not.toHaveAttribute("aria-hidden");
  });

  test("the day view leaves an overlay out of the tab order too", () => {
    const container: HTMLElement = renderCalendar(DefaultCalendarView.Day, [
      event("Network team on site", october(20, 9), october(20, 10, 30), {
        overlay: true,
      }),
    ]);

    expect(block(container, "Network team on site")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  test("a month's blocks are left as react-big-calendar draws them", () => {
    const container: HTMLElement = renderCalendar(DefaultCalendarView.Month, [
      event("Morning stand-up", october(20, 8), october(20, 9), {
        overlay: true,
      }),
      event("Database upgrade", october(20, 22), october(20, 23)),
    ]);

    // No tab stop to take away there: the month's blocks are not buttons.
    for (const title of ["Morning stand-up", "Database upgrade"]) {
      expect(block(container, title)).not.toHaveAttribute("tabindex");
      expect(block(container, title)).not.toHaveAttribute("role");
    }
  });
});

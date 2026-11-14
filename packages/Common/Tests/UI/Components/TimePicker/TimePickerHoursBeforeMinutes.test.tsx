/** @timezone UTC */

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
  within,
} from "@testing-library/react";
import React from "react";
import TimePicker from "../../../../UI/Components/TimePicker/TimePicker";
import OneUptimeDate from "../../../../Types/Date";

/*
 * A time picker reads hours, then minutes, in every language (#7593).
 *
 * The shared time picker - a layer's restriction hours, an on-call rule's
 * working hours, a form's Time field - draws a clock as one row: the clock
 * icon, the hours, a colon, the minutes, then AM/PM. On a page read right to
 * left (Arabic, Persian) the row ran from the right, so the minutes landed
 * left of the hours, and 01:00 read "00 : 01" - one minute past midnight. A
 * time is written hours first, left to right, on those pages too, as the
 * browser's own date and time fields beside it write it. So the hours, the
 * colon and the minutes are one group that reads left to right, in the field
 * and in the dialog that sets it; the icon and AM/PM follow the page.
 *
 * jsdom lays nothing out: these pin the direction each part is drawn in and
 * the order it is written in, which is what the browser lays out from.
 */

// 01:00 in the morning, in the zone of the docblock.
const ONE_AM: string = "2026-11-13T01:00:00.000Z";

function directionOf(element: Element): Element {
  const withDirection: Element | null = element.closest("[dir]");

  if (!withDirection) {
    throw new Error("No element above says which way it reads.");
  }

  return withDirection;
}

function renderOnAPage(
  direction: "rtl" | "ltr",
  picker: React.ReactElement,
): HTMLElement {
  const { container } = render(<div dir={direction}>{picker}</div>);
  return container.firstElementChild as HTMLElement;
}

function precedes(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

// A 24-hour clock unless a test asks for a 12-hour one.
function pickClock(hours: 12 | 24): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(hours === 12);
}

beforeEach(() => {
  pickClock(24);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the field: hours, then minutes, left to right", () => {
  test("the zone of the docblock took", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  });

  test("on a page read right to left, hours, the colon and the minutes are one left-to-right group, hours first", () => {
    const page: HTMLElement = renderOnAPage(
      "rtl",
      <TimePicker value={ONE_AM} />,
    );

    const hours: HTMLInputElement = screen.getByLabelText(
      "Hours",
    ) as HTMLInputElement;
    const minutes: HTMLInputElement = screen.getByLabelText(
      "Minutes",
    ) as HTMLInputElement;

    expect(hours).toHaveValue("01");
    expect(minutes).toHaveValue("00");

    const time: Element = directionOf(hours);

    expect(time).not.toBe(page);
    expect(time.getAttribute("dir")).toBe("ltr");
    expect(directionOf(minutes)).toBe(time);

    // Written hours, colon, minutes: the order a left-to-right line shows.
    expect(Array.from(time.querySelectorAll("input"))).toEqual([
      hours,
      minutes,
    ]);
    expect(time.textContent).toBe(":");
    expect(precedes(hours, minutes)).toBe(true);
  });

  test("the group is inside the field's box, which keeps the page's direction", () => {
    const page: HTMLElement = renderOnAPage(
      "rtl",
      <TimePicker value={ONE_AM} />,
    );

    const box: HTMLElement = screen.getByRole("group", { name: "Time input" });
    const time: Element = directionOf(screen.getByLabelText("Hours"));

    expect(box.contains(time)).toBe(true);
    expect(box.hasAttribute("dir")).toBe(false);
    expect(directionOf(box)).toBe(page);
  });

  test("the clock icon, AM/PM and the error stay with the page", () => {
    pickClock(12);

    renderOnAPage(
      "rtl",
      <TimePicker value={ONE_AM} error="Pick a time after From." />,
    );

    const box: HTMLElement = screen.getByRole("group", { name: "Time input" });
    const time: Element = directionOf(screen.getByLabelText("Hours"));
    const amOrPm: HTMLElement = screen.getByRole("group", {
      name: "AM or PM",
    });

    expect(screen.getByLabelText("Hours")).toHaveValue("01");
    expect(time.contains(amOrPm)).toBe(false);
    expect(box.contains(amOrPm)).toBe(true);

    // No icon in the group: the clock and the error icon follow the page.
    expect(box.querySelectorAll("svg").length).toBeGreaterThan(0);
    expect(time.querySelector("svg")).toBeNull();

    expect(time.contains(screen.getByText("Pick a time after From."))).toBe(
      false,
    );
  });

  test("on a page read left to right it is the same group, in the same order", () => {
    renderOnAPage("ltr", <TimePicker value={ONE_AM} />);

    const hours: HTMLElement = screen.getByLabelText("Hours");
    const minutes: HTMLElement = screen.getByLabelText("Minutes");
    const time: Element = directionOf(hours);

    expect(time.getAttribute("dir")).toBe("ltr");
    expect(directionOf(minutes)).toBe(time);
    expect(precedes(hours, minutes)).toBe(true);
  });

  test("hours and minutes keep the names a screen reader reads them by", () => {
    renderOnAPage("rtl", <TimePicker value={ONE_AM} />);

    const time: Element = directionOf(screen.getByLabelText("Hours"));

    expect(
      Array.from(time.querySelectorAll("input")).map(
        (input: HTMLInputElement) => {
          return input.getAttribute("aria-label");
        },
      ),
    ).toEqual(["Hours", "Minutes"]);
  });
});

describe("the dialog that sets it: hours, then minutes, left to right", () => {
  test("on a page read right to left, the hour and minute columns are one left-to-right group, hours first; AM/PM follows the page", () => {
    pickClock(12);

    renderOnAPage("rtl", <TimePicker value={ONE_AM} />);

    fireEvent.click(screen.getByRole("group", { name: "Time input" }));

    const dialog: HTMLElement = screen.getByRole("dialog");
    const hours: HTMLElement = within(dialog).getByLabelText("Hours");
    const minutes: HTMLElement = within(dialog).getByLabelText("Minutes");

    expect(hours).toHaveValue("01");
    expect(minutes).toHaveValue("00");

    const columns: Element = directionOf(hours);

    expect(columns.getAttribute("dir")).toBe("ltr");
    expect(directionOf(minutes)).toBe(columns);
    expect(precedes(hours, minutes)).toBe(true);

    // Each column's arrows go with it: the hours' before the minutes'.
    const moreHours: HTMLElement = within(dialog).getByRole("button", {
      name: "Increase hours",
    });
    const fewerHours: HTMLElement = within(dialog).getByRole("button", {
      name: "Decrease hours",
    });
    const moreMinutes: HTMLElement = within(dialog).getByRole("button", {
      name: "Increase minutes",
    });

    expect(directionOf(moreHours)).toBe(columns);
    expect(directionOf(fewerHours)).toBe(columns);
    expect(directionOf(moreMinutes)).toBe(columns);
    expect(precedes(fewerHours, moreMinutes)).toBe(true);

    // AM and PM sit after the time, on the page's side.
    for (const name of ["AM", "PM"]) {
      const button: HTMLElement = within(dialog).getByRole("button", {
        name,
      });

      expect(columns.contains(button)).toBe(false);
      expect(precedes(minutes, button)).toBe(true);
    }
  });

  test("a time set in the dialog reads in the field the same way", () => {
    const changes: Array<string> = [];

    renderOnAPage(
      "rtl",
      <TimePicker
        value={ONE_AM}
        onChange={(value: string) => {
          changes.push(value);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("group", { name: "Time input" }));

    const dialog: HTMLElement = screen.getByRole("dialog");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Increase hours" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "15" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(changes).toHaveLength(1);
    expect(OneUptimeDate.getLocalHours(changes[0]!)).toBe(2);
    expect(OneUptimeDate.getLocalMinutes(changes[0]!)).toBe(15);

    const time: Element = directionOf(screen.getByLabelText("Hours"));

    expect(
      Array.from(time.querySelectorAll("input")).map(
        (input: HTMLInputElement) => {
          return input.value;
        },
      ),
    ).toEqual(["02", "15"]);
  });
});

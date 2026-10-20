import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import RangeStartAndEndDateEdit from "../../../UI/Components/Date/RangeStartAndEndDateEdit";
import StartAndEndDate, {
  StartAndEndDateType,
} from "../../../UI/Components/Date/StartAndEndDate";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * How the time range picker lays out its choices (issue #5080's UI review).
 *
 *   - The quick ranges sit two to a row at every width, the way a phone
 *     always showed them, so all twelve and Custom range show at once. One to
 *     a row, the rail scrolled inside itself (md:max-h-96): it hid the
 *     longest ranges and Custom range below a fold nothing pointed at, and a
 *     dashboard's Default (...) on top pushed one more out of sight.
 *   - The rail and the preview are separated on their start and end sides,
 *     not left and right, so a right-to-left language draws the rule between
 *     them rather than at the dialog's edge.
 *   - A custom range puts From above To in the picker's column: side by
 *     side, two date and time fields ran past the dialog's edge.
 *
 * jsdom draws no CSS, so these read the classes that do it; the browser
 * suite (packages/E2E/DashboardTimeRange) measures the real dialog.
 */

afterEach(() => {
  cleanup();
});

function rail(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "Time range" });
}

describe("the quick ranges", () => {
  test("show two to a row at every width, in a rail that never scrolls inside itself", () => {
    render(
      <RangeStartAndEndDateEdit
        value={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={() => {}}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isDefaultSelected={false}
        onSelectDefault={() => {}}
      />,
    );

    expect(rail()).not.toHaveClass("md:max-h-96");
    expect(rail()).not.toHaveClass("md:overflow-y-auto");
    // Wide enough for two of the longest German ranges side by side.
    expect(rail()).toHaveClass("md:w-80");

    const grid: HTMLElement | null = within(rail())
      .getByRole("radio", { name: "Past 5 Minutes" })
      .closest(".grid");

    expect(grid).not.toBeNull();
    expect(grid).toHaveClass("grid-cols-2");
    expect(grid).not.toHaveClass("md:grid-cols-1");
    expect(within(grid as HTMLElement).getAllByRole("radio")).toHaveLength(12);
  });

  test("every choice shows a ring when the keyboard reaches it", () => {
    render(
      <RangeStartAndEndDateEdit
        value={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={() => {}}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isDefaultSelected={true}
        onSelectDefault={() => {}}
      />,
    );

    const radios: Array<HTMLElement> = within(rail()).getAllByRole("radio");

    // Default (...), the twelve presets and Custom range.
    expect(radios).toHaveLength(14);

    for (const radio of radios) {
      expect(radio).toHaveClass("focus-visible:ring-2");
      expect(radio).toHaveClass("text-start");
      expect(radio).not.toHaveClass("text-left");
    }
  });
});

describe("in a right-to-left language", () => {
  test("the rule and the gap between the rail and the preview are on their start and end sides", () => {
    render(
      <RangeStartAndEndDateEdit
        value={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={() => {}}
      />,
    );

    const panes: HTMLElement = rail().parentElement as HTMLElement;
    const preview: HTMLElement = panes.lastElementChild as HTMLElement;

    // divide-x and pr / pl put them at the dialog's edge in Persian.
    expect(panes).not.toHaveClass("md:divide-x");
    expect(rail()).toHaveClass("md:pe-4");
    expect(rail()).not.toHaveClass("md:pr-4");
    expect(preview).toHaveClass("md:border-s", "md:ps-4");
    expect(preview).not.toHaveClass("md:pl-4");
    // It may shrink below its content's width, so it never pushes the dialog wider.
    expect(preview).toHaveClass("md:min-w-0");
  });
});

describe("a custom range", () => {
  test("puts From above To in the picker's column", () => {
    render(
      <RangeStartAndEndDateEdit
        value={{
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2026-10-19T19:00:00.000Z"),
            new Date("2026-10-20T19:00:00.000Z"),
          ),
        }}
        onChange={() => {}}
      />,
    );

    const from: HTMLElement = screen.getByText("From:");
    const to: HTMLElement = screen.getByText("To:");
    const fields: HTMLElement = from.parentElement
      ?.parentElement as HTMLElement;

    expect(fields.contains(to)).toBe(true);
    expect(fields).toHaveClass("flex-col");
    expect(fields).not.toHaveClass("md:flex-row");
    expect(from.parentElement).toHaveClass("w-full");
    expect(from.parentElement).not.toHaveClass("md:w-1/2");
  });

  test("elsewhere the two fields keep sitting side by side on a wide screen", () => {
    render(
      <StartAndEndDate
        type={StartAndEndDateType.DateTime}
        value={
          new InBetween<Date>(
            new Date("2026-10-19T19:00:00.000Z"),
            new Date("2026-10-20T19:00:00.000Z"),
          )
        }
        onValueChanged={() => {}}
      />,
    );

    const from: HTMLElement = screen.getByText("From:");
    const fields: HTMLElement = from.parentElement
      ?.parentElement as HTMLElement;

    expect(fields).toHaveClass("flex-col", "md:flex-row");
    expect(from.parentElement).toHaveClass("md:w-1/2");
  });
});

import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import StartAndEndDate, {
  StartAndEndDateType,
} from "../../../UI/Components/Date/StartAndEndDate";
import InBetween from "../../../Types/BaseDatabase/InBetween";

/*
 * The quick ranges under a date picker (1 hour, 1 day, 1 week...) line up
 * with the fields above them at every width.
 *
 * Their row took back the buttons' own margin with a bare -ml-3. The
 * buttons have that margin (md:ml-3) only from the md breakpoint up, so on
 * a phone the row sat 12px left of the From and To fields - LLM Connect's
 * usage range and every other picker built on StartAndEndDate. A Button has
 * no margin of its own now (#9128): the row takes nothing back and spaces
 * its buttons with its gap, so it starts where the fields do at every width.
 * ButtonMarginTakeBackGuard holds every such box in the product to it.
 */

const RANGE: InBetween<Date> = new InBetween<Date>(
  new Date("2026-10-26T09:00:00.000Z"),
  new Date("2026-10-26T10:00:00.000Z"),
);

function classesOf(element: HTMLElement | null): Array<string> {
  return (element?.className || "").split(" ").filter((token: string) => {
    return token.length > 0;
  });
}

afterEach(() => {
  cleanup();
});

describe("the quick ranges under a date picker", () => {
  for (const type of [StartAndEndDateType.DateTime, StartAndEndDateType.Date]) {
    test(`start where the fields do, spaced by the row's gap (${type})`, () => {
      render(
        <StartAndEndDate
          type={type}
          value={RANGE}
          onValueChanged={(): void => {}}
        />,
      );

      const row: HTMLElement | null = screen.getByRole("button", {
        name: "1\u00A0day",
      }).parentElement;
      const classes: Array<string> = classesOf(row);
      const margin: RegExp = /(^|:)!?-?m[ls]-/u;

      expect(classes).toContain("gap-2");
      expect(
        classes.filter((token: string): boolean => {
          return margin.test(token);
        }),
      ).toEqual([]);

      // The buttons it holds carry no margin of their own.
      const button: HTMLElement = screen.getByRole("button", {
        name: "1\u00A0day",
      });
      expect(
        classesOf(button).filter((token: string): boolean => {
          return margin.test(token);
        }),
      ).toEqual([]);
    });
  }

  test("no quick ranges, no row to line up", () => {
    render(
      <StartAndEndDate
        type={StartAndEndDateType.DateTime}
        value={RANGE}
        hideTimeButtons={true}
        onValueChanged={(): void => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "1 day" })).toBeNull();
  });
});

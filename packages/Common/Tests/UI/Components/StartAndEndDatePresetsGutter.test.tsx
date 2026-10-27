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
 * usage range and every other picker built on StartAndEndDate. The row now
 * takes the margin back from md up only (md:-ml-3), as the buttons carry it.
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
    test(`take the buttons' margin back from md up only (${type})`, () => {
      render(
        <StartAndEndDate
          type={type}
          value={RANGE}
          onValueChanged={(): void => {}}
        />,
      );

      const row: HTMLElement | null = screen.getByRole("button", {
        name: "1 day",
      }).parentElement;
      const classes: Array<string> = classesOf(row);

      expect(classes).toContain("md:-ml-3");
      expect(classes).not.toContain("-ml-3");

      // The buttons it holds carry the margin it takes back, from md up.
      const button: HTMLElement = screen.getByRole("button", {
        name: "1 day",
      });
      expect(classesOf(button)).toContain("md:ml-3");
      expect(classesOf(button)).not.toContain("ml-3");
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

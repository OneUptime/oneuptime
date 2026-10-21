import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import HorizontalRule from "../../../UI/Components/HorizontalRule/HorizontalRule";
import { isRemappedForDarkMode } from "../../Helpers/DarkModeScan";

/*
 * The divider between a form's groups - above a rule form's "Create a
 * channel for each incident", say - and between a card's.
 *
 * It was drawn in gray-700 at 10% opacity, a colour the dark theme has no
 * rule for: on a dark surface the line all but vanished, and only the gap
 * it leaves was there. It is the colour of a form section's own divider
 * now, which the dark theme repaints. And with no class handed in it no
 * longer carried a class named "undefined".
 */

afterEach(() => {
  cleanup();
});

function divider(className?: string): HTMLElement {
  const { container } = render(
    className === undefined ? (
      <HorizontalRule />
    ) : (
      <HorizontalRule className={className} />
    ),
  );

  return container.firstElementChild as HTMLElement;
}

describe("the divider", () => {
  test("is a line in a colour the dark theme repaints", () => {
    const line: HTMLElement = divider();

    expect(line).toHaveClass("border-b", "border-gray-200");
    expect(line).not.toHaveClass("border-gray-700/10");
    expect(isRemappedForDarkMode("border-gray-200")).toBe(true);
  });

  test("keeps its gap above and below", () => {
    expect(divider()).toHaveClass("mt-8", "mb-8");
  });

  test("carries no class named undefined when none is handed in", () => {
    expect(divider().className.split(/\s+/)).not.toContain("undefined");
  });

  test("adds the classes it is handed", () => {
    expect(divider("my-4")).toHaveClass("my-4");
  });
});

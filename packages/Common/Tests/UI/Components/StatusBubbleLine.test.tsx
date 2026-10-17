import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import Statusbubble from "../../../UI/Components/StatusBubble/StatusBubble";
import Color from "../../../Types/Color";

/*
 * A monitor's status in a list - the Monitors table's "Monitor Status"
 * column - sits on the row's 24px line, level with the values beside it
 * (model-table-ui). text-sm alone set a 20px line, which drew the status 2px
 * above the name and the type in the same row.
 */

afterEach(() => {
  cleanup();
});

describe("a status bubble", () => {
  test("its words are on a value's 24px line", () => {
    render(
      <Statusbubble
        text="Operational"
        color={new Color("#10b981")}
        shouldAnimate={false}
      />,
    );

    const words: HTMLElement = screen.getByText("Operational");

    expect(words).toHaveClass("text-sm", "font-medium", "leading-6");
  });

  test("it still says what it is to a screen reader", () => {
    render(
      <Statusbubble
        text="Degraded"
        color={new Color("#f59e0b")}
        shouldAnimate={true}
      />,
    );

    expect(screen.getByRole("status")).toHaveAccessibleName("Status: Degraded");
  });
});

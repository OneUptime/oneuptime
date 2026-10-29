import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import LongTextViewer from "../../../UI/Components/LongText/LongTextViewer";

/*
 * A long text shown in a detail card: its first hundred characters, and Show
 * more for the rest. The button never said whether the text was open (issue
 * #5364's sweep of controls that show more): it does now, and it is one
 * button both ways, so a press keeps focus on it.
 */

const LONG_TEXT: string = `${"Checkout latency rose after the 14:02 deploy. ".repeat(4)}The rollback brought it back.`;

afterEach(() => {
  cleanup();
});

describe("LongTextViewer", () => {
  test("cuts a long text short behind Show more, which says it is folded", () => {
    render(<LongTextViewer text={LONG_TEXT} />);

    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Show more",
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText(/The rollback brought it back\./),
    ).not.toBeInTheDocument();
  });

  test("Show more shows it all, becomes Show less, says it is open and keeps focus", () => {
    render(<LongTextViewer text={LONG_TEXT} />);

    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Show more",
    });

    toggle.focus();
    fireEvent.click(toggle);

    expect(screen.getByText(/The rollback brought it back\./)).toBeVisible();

    const less: HTMLElement = screen.getByRole("button", { name: "Show less" });

    expect(less).toBe(toggle);
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(less).toHaveFocus();

    fireEvent.click(less);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText(/The rollback brought it back\./),
    ).not.toBeInTheDocument();
  });

  test("a short text draws no button", () => {
    render(<LongTextViewer text="Deploy rolled back." />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

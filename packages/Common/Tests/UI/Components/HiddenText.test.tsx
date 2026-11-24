import HiddenText, {
  HIDDEN_TEXT_REVEAL_TEST_ID,
  HIDDEN_TEXT_VALUE_TEST_ID,
} from "../../../UI/Components/HiddenText/HiddenText";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";

/*
 * The reveal button is found by its words, as a person finds it, and the
 * revealed secret by its test id. The parts carried made-up roles for that
 * ("hidden-text", "revealed-text"), which accessibility checkers flagged on
 * every page with a secret (#7964).
 */

function revealButton(): HTMLElement {
  return screen.getByRole("button", { name: "Click to reveal" });
}

describe("tests for HiddenText component", () => {
  test("it should click the reveal button and reveal text in document", async () => {
    render(<HiddenText text="Special" />);
    fireEvent.click(revealButton());

    await waitFor(() => {
      expect(screen.getByTestId(HIDDEN_TEXT_VALUE_TEST_ID)).toBeInTheDocument();
    });

    expect(screen.queryByTestId(HIDDEN_TEXT_REVEAL_TEST_ID)).toBeNull();
    expect(screen.getByTestId(HIDDEN_TEXT_VALUE_TEST_ID)).toHaveTextContent(
      "Special",
    );
  });

  test("it should not show copy to clipboard if isCopyable is false", async () => {
    render(<HiddenText text="text" isCopyable={false} />);
    fireEvent.click(revealButton());

    await waitFor(() => {
      expect(screen.getByTestId(HIDDEN_TEXT_VALUE_TEST_ID)).toBeInTheDocument();
    });

    expect(screen.queryByTestId(HIDDEN_TEXT_REVEAL_TEST_ID)).toBeNull();
    expect(screen.queryByTestId("copy-to-clipboard-icon")).toBeNull();
  });

  test("it should click the reveal button and show the hide icon", async () => {
    render(<HiddenText text="text" isCopyable={true} />);
    fireEvent.click(revealButton());
    await waitFor(() => {
      expect(screen.getByTestId(HIDDEN_TEXT_VALUE_TEST_ID)).toBeInTheDocument();
    });
    expect(screen.getByTestId("hide-text-icon")).toBeTruthy();
  });

  test("it should click the reveal button and copy to clipboard", async () => {
    render(<HiddenText text="text" isCopyable={true} />);
    fireEvent.click(revealButton());
    await waitFor(() => {
      expect(screen.getByTestId(HIDDEN_TEXT_VALUE_TEST_ID)).toBeInTheDocument();
    });

    expect(screen.getByTestId("copy-to-clipboard-icon")).toBeTruthy();

    const copy: HTMLElement = screen.getByTestId("copy-to-clipboard-icon");
    fireEvent.click(copy);

    // Verify the copy icon is still present after clicking
    expect(screen.getByTestId("copy-to-clipboard-icon")).toBeTruthy();
  });

  test("the reveal button carries the test id the end-to-end specs find it by", () => {
    render(<HiddenText text="text" />);

    expect(screen.getByTestId(HIDDEN_TEXT_REVEAL_TEST_ID)).toBe(revealButton());
    expect(HIDDEN_TEXT_REVEAL_TEST_ID).toBe("hidden-text-reveal");
    expect(HIDDEN_TEXT_VALUE_TEST_ID).toBe("hidden-text-value");
  });

  test("no part carries a role that is not an ARIA role, hidden or revealed (#7964)", () => {
    const { container } = render(<HiddenText text="text" isCopyable={true} />);

    const rolesOf: () => Array<string> = (): Array<string> => {
      return Array.from(container.querySelectorAll("[role]")).map(
        (element: Element): string => {
          return element.getAttribute("role") || "";
        },
      );
    };

    expect(rolesOf()).not.toContain("hidden-text");

    fireEvent.click(revealButton());

    expect(rolesOf()).not.toContain("revealed-text");
    expect(rolesOf()).not.toContain("hidden-text");
    // What is left is real: the copy's status line.
    expect(rolesOf()).toEqual(["status"]);
  });
});

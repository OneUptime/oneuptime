import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import LabelledDivider, {
  LABELLED_DIVIDER_LABEL_CLASS_NAME,
  LABELLED_DIVIDER_LINE_CLASS_NAME,
} from "../../../../UI/Components/Divider/LabelledDivider";

/*
 * A hairline with a few words in its middle - "or" between a sign-in page's
 * own button and its other ways in.
 */
describe("LabelledDivider", () => {
  afterEach(() => {
    cleanup();
  });

  test("draws its words between two hairlines", () => {
    render(<LabelledDivider label="or" dataTestId="divider" />);
    const divider: HTMLElement = screen.getByTestId("divider");
    const lines: Array<HTMLElement> = screen.getAllByTestId("divider-line");
    const words: HTMLElement = screen.getByText("or");

    expect(lines).toHaveLength(2);
    expect(Array.from(divider.children)).toEqual([lines[0], words, lines[1]]);
    for (const line of lines) {
      expect(line).toHaveClass("flex-1", "border-t", "border-gray-200");
      expect(line).toBeEmptyDOMElement();
    }
    expect(divider).toHaveClass("flex", "items-center", "gap-3");
    expect(words).toHaveClass("text-sm", "text-gray-500", "text-center");
  });

  /*
   * Long words ("O continúe con su correo electrónico") on a phone took the
   * whole row and left the lines nothing: each line keeps 1.5rem, and the
   * words wrap into balanced lines between them. SignInOptions.spec.ts
   * measures it in every language.
   */
  test("keeps each line 1.5rem wide, and wraps long words between them", () => {
    render(
      <LabelledDivider
        label="O continúe con su correo electrónico"
        dataTestId="divider"
      />,
    );

    for (const line of screen.getAllByTestId("divider-line")) {
      expect(line).toHaveClass("min-w-6");
    }
    expect(
      screen.getByText("O continúe con su correo electrónico"),
    ).toHaveClass("min-w-0", "text-balance");
  });

  test("the words are read; the lines are hidden from assistive technology", () => {
    render(<LabelledDivider label="or" dataTestId="divider" />);

    for (const line of screen.getAllByTestId("divider-line")) {
      expect(line).toHaveAttribute("aria-hidden", "true");
    }
    expect(screen.getByText("or")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByTestId("divider")).toHaveTextContent(/^or$/);
    // Not a separator role: a separator's words are not read.
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  /*
   * The single sign-on page drew its divider as one line behind words on a
   * white patch. The patch only hides the line on a white card: on a faded
   * paused form, a tinted surface or a dark theme it shows as a box.
   */
  test("draws no white patch behind its words, and positions nothing over the line", () => {
    const { container } = render(<LabelledDivider label="Or continue" />);

    expect(container.querySelector(".bg-white")).toBeNull();
    expect(container.querySelector(".absolute")).toBeNull();
    expect(container.querySelector(".relative")).toBeNull();
  });

  test("keeps 1.5rem above and below unless the page asks for other spacing", () => {
    const { rerender } = render(
      <LabelledDivider label="or" dataTestId="divider" />,
    );
    expect(screen.getByTestId("divider")).toHaveClass("my-6");

    rerender(
      <LabelledDivider label="or" dataTestId="divider" className="my-5" />,
    );
    expect(screen.getByTestId("divider")).toHaveClass("my-5");
    expect(screen.getByTestId("divider")).not.toHaveClass("my-6");
  });

  test("lays its words out by their own direction", () => {
    render(<LabelledDivider label="یا" />);

    expect(screen.getByText("یا")).toHaveAttribute("dir", "auto");
  });

  test("without a test id it adds none to itself or its lines", () => {
    const { container } = render(<LabelledDivider label="or" />);

    expect(container.querySelector("[data-testid]")).toBeNull();
  });

  /*
   * "Or continue with email" in a long language filled a 320px row and its
   * lines shrank to nothing (#4911's review). A line keeps 1.5rem and takes
   * any room the words leave; the words wrap, balanced, rather than pushing
   * the lines out.
   */
  test("its lines keep 1.5rem however long the words are, and the words wrap onto even lines", () => {
    render(
      <LabelledDivider
        label="Или продолжите с электронной почтой"
        dataTestId="divider"
      />,
    );

    for (const line of screen.getAllByTestId("divider-line")) {
      expect(line.className).toBe(LABELLED_DIVIDER_LINE_CLASS_NAME);
      expect(line).toHaveClass("min-w-6", "flex-1");
      // Nothing lets a line shrink below its minimum or stop growing.
      for (const loosening of ["min-w-0", "shrink", "grow-0"]) {
        expect(line).not.toHaveClass(loosening);
      }
    }

    const words: HTMLElement = screen.getByText(
      "Или продолжите с электронной почтой",
    );
    expect(words.className).toBe(LABELLED_DIVIDER_LABEL_CLASS_NAME);
    expect(words).toHaveClass("text-balance", "text-center");
    // The words may wrap: nothing holds them on one line.
    expect(words).not.toHaveClass("whitespace-nowrap");
    expect(words).not.toHaveClass("truncate");
    // Nor do they take a share of the row the lines need.
    expect(words).not.toHaveClass("flex-1");
    expect(words).not.toHaveClass("grow");
    expect(words).not.toHaveClass("w-full");
  });
});

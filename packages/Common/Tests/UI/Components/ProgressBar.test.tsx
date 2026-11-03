import ProgressBar, {
  formatProgressPercent,
} from "../../../UI/Components/ProgressBar/ProgressBar";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";

describe("ProgressBar Component", () => {
  function getProgressBar(): HTMLElement {
    const element: HTMLElement = screen.getByTestId("progress-bar");
    if (!element) {
      throw "Not Found";
    }
    return element;
  }

  test("should calculate and display the correct percentage", () => {
    render(<ProgressBar count={0} totalCount={100} suffix="items" />);
    const progressBar: HTMLElement = getProgressBar();
    expect(progressBar).toHaveStyle({ width: "0%" });
  });

  test("should display the correct count and total count with suffix", () => {
    render(<ProgressBar count={30} totalCount={99} suffix="items" />);
    const countText: HTMLElement = screen.getByTestId("progress-bar-count");
    expect(countText).toBeInTheDocument();

    expect(countText.innerHTML).toEqual("30 of 99 items");
  });

  /*
   * A zero total reads as an empty track, not a full one.
   *
   * JavaScript does not throw on a divide by zero, so before the component
   * guarded the total this arithmetic produced Infinity (capped to a
   * misleading 100%) or, for a zero count, NaN — which reached the DOM three
   * times over: `width: NaN%`, which the browser discards, aria-valuenow, and
   * a visible "NaN%" beside the count. Nothing to do is nothing done, so 0 is
   * the honest reading and it is what every branch below asserts.
   */
  test("shows an empty bar when the total is zero", () => {
    render(<ProgressBar count={30} totalCount={0} suffix="items" />);
    const progressBar: HTMLElement = getProgressBar();
    expect(progressBar).toHaveStyle({ width: "0%" });
  });

  test("shows an empty bar when both the count and the total are zero", () => {
    render(<ProgressBar count={0} totalCount={0} suffix="items" />);
    const progressBar: HTMLElement = getProgressBar();
    expect(progressBar).toHaveStyle({ width: "0%" });
  });

  test("never renders NaN to the user when the total is zero", () => {
    const { container } = render(
      <ProgressBar count={0} totalCount={0} suffix="items" />,
    );

    // The readout, the aria value and the width - the three NaN reached.
    expect(container.textContent).not.toContain("NaN");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(getProgressBar()).toHaveStyle({ width: "0%" });
  });

  test("a negative total is treated as nothing to do, not as progress", () => {
    render(<ProgressBar count={5} totalCount={-10} suffix="items" />);
    const progressBar: HTMLElement = getProgressBar();
    expect(progressBar).toHaveStyle({ width: "0%" });
  });

  test("should round up the percentage to the nearest integer", () => {
    render(<ProgressBar count={33} totalCount={100} suffix="items" />);
    const progressBar: HTMLElement = getProgressBar();
    expect(progressBar).toHaveStyle({ width: "33%" });
  });

  test("should cap the percentage at 100 if count exceeds total count", () => {
    render(<ProgressBar count={150} totalCount={100} suffix="items" />);
    const progressBar: HTMLElement = getProgressBar();
    expect(progressBar).toHaveStyle({ width: "100%" });
  });

  test("reads its percent beside the count, as English writes it", () => {
    render(<ProgressBar count={1} totalCount={7} suffix="Subscribers" />);
    expect(screen.getByTestId("progress-bar-percent")).toHaveTextContent("15%");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "Progress: 1 of 7 Subscribers (15%)",
    );
  });
});

/*
 * A Persian bulk dialog read "۱ از ۷ (مشترکان)" beside "15%": the count in
 * the reader's digits, the percent in English's. The percent is now
 * written the way the reader's language writes one.
 */
describe("formatProgressPercent", () => {
  test("writes a percent the reader's way", () => {
    expect(formatProgressPercent(15, "en")).toBe("15%");
    expect(formatProgressPercent(0, "en")).toBe("0%");
    expect(formatProgressPercent(100, "en")).toBe("100%");
    // German and French set the sign apart, with a space that never breaks.
    expect(formatProgressPercent(15, "de")).toBe("15\u00a0%");
    // Persian in its own digits and sign, as its count beside it.
    expect(formatProgressPercent(15, "fa")).toBe("\u06f1\u06f5\u066a");
    expect(formatProgressPercent(3, "ja")).toBe("3%");
  });

  test("never writes a fraction: the bar rounds up to a whole percent first", () => {
    expect(formatProgressPercent(33, "en")).toBe("33%");
  });

  test("falls back to the number and a sign for a language Intl does not know", () => {
    expect(formatProgressPercent(15, "not a language")).toBe("15%");
  });
});

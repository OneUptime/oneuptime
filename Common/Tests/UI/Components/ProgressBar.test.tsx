import ProgressBar from "../../../UI/Components/ProgressBar/ProgressBar";
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
});

import Skeleton, {
  getSkeletonWidthClass,
} from "../../../UI/Components/Skeleton/Skeleton";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";

describe("Skeleton", () => {
  test("renders a pulsing gray placeholder block", () => {
    render(<Skeleton />);

    const skeleton: HTMLElement = screen.getByTestId("skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveClass("animate-pulse");
    expect(skeleton).toHaveClass("rounded");
    expect(skeleton).toHaveClass("bg-gray-200");
  });

  /*
   * The block is decoration; the composing loading state (role="status")
   * owns the announcement. Without this, a page of skeletons reads to a
   * screen reader as dozens of empty groups.
   */
  test("hides itself from the accessibility tree", () => {
    render(<Skeleton />);

    expect(screen.getByTestId("skeleton")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("appends the caller's sizing classes", () => {
    render(<Skeleton className="h-4 w-24" />);

    const skeleton: HTMLElement = screen.getByTestId("skeleton");
    expect(skeleton).toHaveClass("h-4");
    expect(skeleton).toHaveClass("w-24");
  });

  /*
   * Width variants must be a pure function of the index - a Math.random
   * width re-rolls on every render, which flickers on screen and makes the
   * DOM impossible to assert on.
   */
  test("cycles width variants deterministically by index", () => {
    expect(getSkeletonWidthClass(0)).toBe("w-3/4");
    expect(getSkeletonWidthClass(1)).toBe("w-1/2");
    expect(getSkeletonWidthClass(2)).toBe("w-2/3");
    expect(getSkeletonWidthClass(3)).toBe("w-3/4");

    // Same index, same width - every time.
    expect(getSkeletonWidthClass(7)).toBe(getSkeletonWidthClass(7));
  });

  test("applies the cycled width variant when given an index", () => {
    render(<Skeleton widthVariantIndex={1} dataTestId="indexed-skeleton" />);

    expect(screen.getByTestId("indexed-skeleton")).toHaveClass("w-1/2");
  });

  test("adds no width class when no index is given", () => {
    render(<Skeleton />);

    const skeleton: HTMLElement = screen.getByTestId("skeleton");
    expect(skeleton).not.toHaveClass("w-3/4");
    expect(skeleton).not.toHaveClass("w-1/2");
    expect(skeleton).not.toHaveClass("w-2/3");
  });
});

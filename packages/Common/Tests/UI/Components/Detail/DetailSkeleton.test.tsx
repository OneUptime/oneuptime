import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import DetailSkeleton, {
  DETAIL_SKELETON_BAR_CLASS_NAME,
  DETAIL_SKELETON_TEST_ID,
  MAX_DETAIL_SKELETON_CELLS,
} from "../../../../UI/Components/Detail/DetailSkeleton";
import {
  getDetailCellClassNames,
  getDetailGridClassName,
} from "../../../../UI/Components/Detail/DetailGridLayout";

/*
 * What a detail card shows while its record loads (DetailSkeleton): its
 * rows, in the grid the fields will fill, as tall as one-line fields - so
 * the card opens at about the size it ends at, instead of a thin bar in a
 * 100px gap that the fields then replace at their own height.
 */

afterEach(() => {
  cleanup();
});

const skeletonCells: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.getAllByTestId(`${DETAIL_SKELETON_TEST_ID}-cell`);
};

describe("the skeleton", () => {
  test("says 'Loading' to a screen reader, and hides its bars from it", () => {
    render(<DetailSkeleton spans={[undefined, undefined]} columns={2} />);

    const skeleton: HTMLElement = screen.getByRole("status", {
      name: "Loading",
    });

    expect(skeleton).toHaveAttribute("data-testid", DETAIL_SKELETON_TEST_ID);
    expect(skeleton).toHaveAttribute("aria-live", "polite");
    expect(within(skeleton).getByText("Loading...")).toHaveClass("sr-only");
    expect(skeleton.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(skeleton).toHaveClass("animate-pulse");
  });

  test("lays its cells out by the fields' own rules: the same grid, the same rows", () => {
    const spans: Array<number | undefined> = [undefined, 2, undefined, 1];

    render(<DetailSkeleton spans={spans} columns={3} />);

    const skeleton: HTMLElement = screen.getByTestId(DETAIL_SKELETON_TEST_ID);

    expect((skeleton.firstElementChild as HTMLElement).className).toBe(
      getDetailGridClassName(3),
    );
    expect(
      skeletonCells().map((cell: HTMLElement): string => {
        return cell.className;
      }),
    ).toEqual(getDetailCellClassNames(spans, 3));
  });

  test("each cell is a name bar over a value bar, as tall as a one-line field", () => {
    render(<DetailSkeleton spans={[undefined]} columns={1} />);

    const cell: HTMLElement = skeletonCells()[0]!;
    const [name, value] = Array.from(cell.children) as [
      HTMLElement,
      HTMLElement,
    ];

    // The name's line (20px) and the value's (4px under it, 24px).
    expect(name).toHaveClass("h-5");
    expect(value).toHaveClass("mt-1", "h-6");
    expect(name.firstElementChild!.className).toContain(
      DETAIL_SKELETON_BAR_CLASS_NAME,
    );
    expect(value.firstElementChild!.className).toContain(
      DETAIL_SKELETON_BAR_CLASS_NAME,
    );
    expect(name.firstElementChild).toHaveClass("bg-gray-100", "rounded");
  });

  test("the bars vary in width, so the rows read as rows of text", () => {
    render(
      <DetailSkeleton spans={[undefined, undefined, undefined]} columns={1} />,
    );

    const widths: Array<string> = skeletonCells().map(
      (cell: HTMLElement): string => {
        return (
          Array.from(cell.querySelectorAll(".rounded"))
            .map((bar: Element): string => {
              return (
                bar.className.split(/\s+/).find((name: string): boolean => {
                  return name.startsWith("w-");
                }) || ""
              );
            })
            .join(" ") || ""
        );
      },
    );

    expect(new Set(widths).size).toBe(3);
  });

  test("draws one cell for a card with no fields to count", () => {
    render(<DetailSkeleton spans={[]} columns={2} />);

    expect(skeletonCells()).toHaveLength(1);
  });

  test("draws no more than a dozen cells", () => {
    render(
      <DetailSkeleton
        spans={Array.from({ length: 40 }, (): undefined => {
          return undefined;
        })}
        columns={2}
      />,
    );

    expect(MAX_DETAIL_SKELETON_CELLS).toBe(12);
    expect(skeletonCells()).toHaveLength(MAX_DETAIL_SKELETON_CELLS);
  });

  test("a compact card's skeleton has the compact rows, in one column or several", () => {
    render(
      <DetailSkeleton
        spans={[undefined, undefined, 2]}
        columns={1}
        isCompact={true}
      />,
    );

    let grid: HTMLElement = screen.getByTestId(DETAIL_SKELETON_TEST_ID)
      .firstElementChild as HTMLElement;

    expect(grid).toHaveClass(
      "grid",
      "grid-cols-1",
      "divide-y",
      "divide-gray-100",
      "sm:grid-cols-1",
    );
    for (const cell of skeletonCells()) {
      expect(cell).toHaveClass("py-3", "first:pt-0", "last:pb-0");
    }
    cleanup();

    render(
      <DetailSkeleton
        spans={[undefined, undefined, 2]}
        columns={3}
        isCompact={true}
      />,
    );

    grid = screen.getByTestId(DETAIL_SKELETON_TEST_ID)
      .firstElementChild as HTMLElement;

    expect(grid).toHaveClass("sm:grid-cols-3", "sm:gap-x-6", "sm:divide-y-0");
    expect(skeletonCells()[2]).toHaveClass("sm:col-span-2");
    for (const cell of skeletonCells()) {
      expect(cell.className).not.toContain("first:pt-0");
    }
  });

  test("is no bar loader", () => {
    render(<DetailSkeleton spans={[undefined]} columns={1} />);

    expect(screen.queryByTestId("bar-loader")).toBeNull();
  });
});

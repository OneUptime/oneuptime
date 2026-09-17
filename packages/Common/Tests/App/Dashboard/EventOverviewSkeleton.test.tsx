import EventOverviewSkeleton from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventOverviewSkeleton";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Overview pages show this on first load instead of a full-page loader, so
 * the header, stat bar and card grid appear in place and the page does not
 * jump when data lands. It must announce itself once, politely, and hide
 * the decorative blocks from assistive technology.
 */

afterEach(() => {
  cleanup();
});

type GetStatCellsFunction = () => Array<Element>;

const getStatCells: GetStatCellsFunction = (): Array<Element> => {
  const statWrapper: HTMLElement = screen.getByTestId(
    "event-overview-skeleton-stats",
  );
  const bar: Element = statWrapper.firstElementChild as Element;
  return Array.from(bar.children);
};

describe("EventOverviewSkeleton accessibility", () => {
  test("is one polite status region with a screen-reader-only label", () => {
    render(<EventOverviewSkeleton />);

    const status: HTMLElement = screen.getByRole("status");

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(within(status).getByText("Loading")).toHaveClass("sr-only");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  test("announces a caller-specific loading label", () => {
    render(<EventOverviewSkeleton loadingText="Loading incident" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading incident");
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  });

  test("hides every placeholder block from assistive technology", () => {
    render(<EventOverviewSkeleton />);

    const status: HTMLElement = screen.getByRole("status");
    const decorative: Element | null = status.querySelector(
      '[aria-hidden="true"]',
    );

    expect(decorative).not.toBeNull();
    expect(decorative).toContainElement(
      screen.getByTestId("event-overview-skeleton-hero"),
    );
    expect(decorative).toContainElement(
      screen.getByTestId("event-overview-skeleton-stats"),
    );
    // The only accessible text is the sr-only label.
    expect(status.textContent).toBe("Loading");
  });

  test("only pulses when the user has not asked for reduced motion", () => {
    const { container } = render(<EventOverviewSkeleton />);

    expect(
      container.querySelector('[class~="motion-safe:animate-pulse"]'),
    ).not.toBeNull();
    expect(container.querySelector('[class~="animate-pulse"]')).toBeNull();
  });

  test("renders no interactive controls", () => {
    render(<EventOverviewSkeleton />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("EventOverviewSkeleton layout", () => {
  test("mirrors the header card of the loaded page", () => {
    render(<EventOverviewSkeleton />);

    expect(screen.getByTestId("event-overview-skeleton-hero")).toHaveClass(
      "rounded-xl",
      "border",
      "border-gray-200",
      "bg-white",
      "shadow-sm",
    );
  });

  test("places the hero, then the stat bar, then the card grid", () => {
    render(<EventOverviewSkeleton />);

    const hero: HTMLElement = screen.getByTestId(
      "event-overview-skeleton-hero",
    );
    const stats: HTMLElement = screen.getByTestId(
      "event-overview-skeleton-stats",
    );
    const mainCard: HTMLElement = screen.getAllByTestId(
      "event-overview-skeleton-main-card",
    )[0] as HTMLElement;

    expect(
      hero.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      stats.compareDocumentPosition(mainCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("defaults to three stat cells", () => {
    render(<EventOverviewSkeleton />);

    expect(getStatCells()).toHaveLength(3);
  });

  test("matches the stat bar's cell count when asked", () => {
    render(<EventOverviewSkeleton statCount={4} />);

    expect(getStatCells()).toHaveLength(4);

    const bar: Element = screen.getByTestId("event-overview-skeleton-stats")
      .firstElementChild as Element;
    expect(bar).toHaveClass("sm:grid-cols-2", "lg:grid-cols-4");
  });

  test("uses the stat bar card so the placeholder has the same frame", () => {
    render(<EventOverviewSkeleton statCount={2} />);

    const bar: Element = screen.getByTestId("event-overview-skeleton-stats")
      .firstElementChild as Element;

    expect(bar).toHaveClass(
      "grid",
      "grid-cols-1",
      "rounded-xl",
      "border",
      "sm:grid-cols-2",
    );
    for (const cell of getStatCells()) {
      expect(cell).toHaveClass("bg-white", "px-5", "py-4");
    }
  });

  test("lays cards out two-thirds and one-third from xl, stacked below it", () => {
    render(<EventOverviewSkeleton />);

    const mainCards: Array<HTMLElement> = screen.getAllByTestId(
      "event-overview-skeleton-main-card",
    );
    const sideCards: Array<HTMLElement> = screen.getAllByTestId(
      "event-overview-skeleton-side-card",
    );

    expect(mainCards.length).toBeGreaterThan(0);
    expect(sideCards.length).toBeGreaterThan(0);

    const mainColumn: HTMLElement = mainCards[0]!.parentElement as HTMLElement;
    const sideColumn: HTMLElement = sideCards[0]!.parentElement as HTMLElement;
    const grid: HTMLElement = mainColumn.parentElement as HTMLElement;

    expect(grid).toHaveClass("grid", "grid-cols-1", "xl:grid-cols-3");
    expect(grid).toContainElement(sideColumn);
    expect(mainColumn).toHaveClass("xl:col-span-2", "min-w-0");
    expect(sideColumn).toHaveClass("min-w-0");
    expect(sideColumn).not.toHaveClass("xl:col-span-2");
  });

  test("keeps every width responsive so it fits a phone screen", () => {
    const { container } = render(<EventOverviewSkeleton />);

    const fixedWideWidths: Array<Element> = Array.from(
      container.querySelectorAll("*"),
    ).filter((element: Element) => {
      return Array.from(element.classList).some((className: string) => {
        // Anything wider than w-40 (10rem) must be fractional or capped.
        const match: RegExpMatchArray | null = className.match(/^w-(\d+)$/);
        return (
          match !== null &&
          Number(match[1]) > 40 &&
          !element.classList.contains("max-w-full")
        );
      });
    });

    expect(fixedWideWidths).toEqual([]);
    expect(container.innerHTML).not.toContain("min-w-[");
  });

  test("renders the same markup on every render (no random widths)", () => {
    const { container, rerender } = render(<EventOverviewSkeleton />);
    const firstHtml: string = container.innerHTML;

    rerender(<EventOverviewSkeleton />);

    expect(container.innerHTML).toBe(firstHtml);
  });

  test("appends a caller class name to the status wrapper", () => {
    render(<EventOverviewSkeleton className="mb-5" />);

    expect(screen.getByRole("status")).toHaveClass("mb-5", "w-full");
  });
});

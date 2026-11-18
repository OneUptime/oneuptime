import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import TableSkeleton, {
  DEFAULT_TABLE_SKELETON_ROWS,
  MAX_TABLE_SKELETON_ROWS,
  TABLE_SKELETON_TEST_ID,
} from "../../../../UI/Components/Skeleton/TableSkeleton";
import DetailListSkeleton from "../../../../UI/Components/Skeleton/DetailListSkeleton";
import ChartSkeleton, {
  CHART_SKELETON_TEST_ID,
  DEFAULT_CHART_SKELETON_HEIGHT_IN_PX,
} from "../../../../UI/Components/Skeleton/ChartSkeleton";
import StatTilesSkeleton, {
  DEFAULT_STAT_TILES_GRID_CLASS_NAME,
  STAT_TILES_SKELETON_TEST_ID,
} from "../../../../UI/Components/Skeleton/StatTilesSkeleton";
import CardListSkeleton, {
  CARD_LIST_SKELETON_TEST_ID,
} from "../../../../UI/Components/Skeleton/CardListSkeleton";
import PageSkeleton, {
  PAGE_SKELETON_TEST_ID,
} from "../../../../UI/Components/Page/PageSkeleton";
import InlineValueSkeleton, {
  INLINE_VALUE_SKELETON_TEST_ID,
} from "../../../../UI/Components/Skeleton/InlineValueSkeleton";
import AuthPageSkeleton, {
  AUTH_PAGE_SKELETON_TEST_ID,
} from "../../../../UI/Components/AuthPage/AuthPageSkeleton";
import { DETAIL_SKELETON_TEST_ID } from "../../../../UI/Components/Detail/DetailSkeleton";
import { SKELETON_MOTION_CLASS_NAME } from "../../../../UI/Components/Skeleton/SkeletonStatus";

/*
 * The shared content skeletons (#9220): a card that loads draws the shape
 * it will have, rows, names and values, a chart, a row of figures or a
 * list of cards, so it opens at about the height it ends at. Each tells a
 * screen reader once that it is loading, hides its bars, and pulses only
 * for a reader who has not asked for less motion.
 */

afterEach(() => {
  cleanup();
});

const SKELETONS: Array<{ name: string; element: ReactElement; id: string }> = [
  {
    name: "TableSkeleton",
    element: <TableSkeleton />,
    id: TABLE_SKELETON_TEST_ID,
  },
  {
    name: "DetailListSkeleton",
    element: <DetailListSkeleton />,
    id: DETAIL_SKELETON_TEST_ID,
  },
  {
    name: "ChartSkeleton",
    element: <ChartSkeleton />,
    id: CHART_SKELETON_TEST_ID,
  },
  {
    name: "StatTilesSkeleton",
    element: <StatTilesSkeleton />,
    id: STAT_TILES_SKELETON_TEST_ID,
  },
  {
    name: "CardListSkeleton",
    element: <CardListSkeleton />,
    id: CARD_LIST_SKELETON_TEST_ID,
  },
  {
    name: "AuthPageSkeleton",
    element: <AuthPageSkeleton />,
    id: AUTH_PAGE_SKELETON_TEST_ID,
  },
  {
    name: "InlineValueSkeleton",
    element: <InlineValueSkeleton />,
    id: INLINE_VALUE_SKELETON_TEST_ID,
  },
  {
    name: "PageSkeleton",
    element: <PageSkeleton />,
    id: PAGE_SKELETON_TEST_ID,
  },
  {
    name: "PageSkeleton (table)",
    element: <PageSkeleton shape="table" />,
    id: PAGE_SKELETON_TEST_ID,
  },
];

describe("every content skeleton", () => {
  test.each(SKELETONS)(
    "$name is a busy status named Loading, with its bars hidden",
    ({ element, id }: { element: ReactElement; id: string }) => {
      render(element);

      const status: HTMLElement = screen.getByRole("status", {
        name: "Loading",
      });

      expect(status).toHaveAttribute("data-testid", id);
      expect(status).toHaveAttribute("aria-busy", "true");
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(within(status).getByText("Loading...")).toHaveClass("sr-only");
      expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
    },
  );

  test.each(SKELETONS)(
    "$name pulses only without reduced motion",
    ({ element }: { element: ReactElement }) => {
      const { container } = render(element);

      expect(
        container.querySelector(`[class~="${SKELETON_MOTION_CLASS_NAME}"]`),
      ).not.toBeNull();
      expect(container.querySelector('[class~="animate-pulse"]')).toBeNull();
    },
  );

  test.each(SKELETONS)(
    "$name draws one status, never one inside another",
    ({ element }: { element: ReactElement }) => {
      render(element);

      expect(screen.getAllByRole("status")).toHaveLength(1);
    },
  );
});

describe("TableSkeleton", () => {
  test("draws a header and five rows of four columns by default", () => {
    render(<TableSkeleton />);

    expect(
      screen.getByTestId(`${TABLE_SKELETON_TEST_ID}-header`),
    ).toBeInTheDocument();
    const rows: Array<HTMLElement> = screen.getAllByTestId(
      `${TABLE_SKELETON_TEST_ID}-row`,
    );
    expect(rows).toHaveLength(DEFAULT_TABLE_SKELETON_ROWS);
    expect(rows[0]?.children).toHaveLength(4);
  });

  test("draws the rows and columns asked for, at most ten rows", () => {
    render(<TableSkeleton rows={40} columns={6} hasHeader={false} />);

    expect(
      screen.queryByTestId(`${TABLE_SKELETON_TEST_ID}-header`),
    ).not.toBeInTheDocument();
    const rows: Array<HTMLElement> = screen.getAllByTestId(
      `${TABLE_SKELETON_TEST_ID}-row`,
    );
    expect(rows).toHaveLength(MAX_TABLE_SKELETON_ROWS);
    expect(rows[0]?.children).toHaveLength(6);
  });

  test("each row is the shared table's row: a 24px line between py-3", () => {
    render(<TableSkeleton />);

    const row: HTMLElement = screen.getAllByTestId(
      `${TABLE_SKELETON_TEST_ID}-row`,
    )[0] as HTMLElement;
    expect(row).toHaveClass("py-3");
    expect(row.firstElementChild).toHaveClass("h-6");
  });

  test("leaves the third column on out on a phone", () => {
    render(<TableSkeleton columns={4} />);

    const cells: HTMLCollection = (
      screen.getAllByTestId(`${TABLE_SKELETON_TEST_ID}-row`)[0] as HTMLElement
    ).children;
    expect(cells[0]).not.toHaveClass("max-sm:hidden");
    expect(cells[1]).not.toHaveClass("max-sm:hidden");
    expect(cells[2]).toHaveClass("max-sm:hidden");
  });
});

describe("DetailListSkeleton", () => {
  test("draws one cell per field, in the detail card's grid", () => {
    render(<DetailListSkeleton fields={6} columns={2} />);

    expect(
      screen.getAllByTestId(`${DETAIL_SKELETON_TEST_ID}-cell`),
    ).toHaveLength(6);
  });

  test("draws four fields by default", () => {
    render(<DetailListSkeleton />);

    expect(
      screen.getAllByTestId(`${DETAIL_SKELETON_TEST_ID}-cell`),
    ).toHaveLength(4);
  });
});

describe("ChartSkeleton", () => {
  test("is a chart group's plot tall by default", () => {
    render(<ChartSkeleton />);

    const status: HTMLElement = screen.getByTestId(CHART_SKELETON_TEST_ID);
    expect(
      (
        status.querySelector('[aria-hidden="true"]')
          ?.firstElementChild as HTMLElement
      ).style.height,
    ).toBe(`${DEFAULT_CHART_SKELETON_HEIGHT_IN_PX}px`);
    expect(
      screen.getByTestId(`${CHART_SKELETON_TEST_ID}-plot`),
    ).toBeInTheDocument();
  });

  test("takes the height of the chart it stands in for", () => {
    render(<ChartSkeleton heightInPx={180} />);

    const status: HTMLElement = screen.getByTestId(CHART_SKELETON_TEST_ID);
    expect(
      (
        status.querySelector('[aria-hidden="true"]')
          ?.firstElementChild as HTMLElement
      ).style.height,
    ).toBe("180px");
  });
});

describe("StatTilesSkeleton", () => {
  test("draws four tiles in the usual grid by default", () => {
    render(<StatTilesSkeleton />);

    const tiles: Array<HTMLElement> = screen.getAllByTestId(
      `${STAT_TILES_SKELETON_TEST_ID}-tile`,
    );
    expect(tiles).toHaveLength(4);
    expect(tiles[0]?.parentElement?.className).toBe(
      DEFAULT_STAT_TILES_GRID_CLASS_NAME,
    );
    // An InfoCard's frame and padding.
    expect(tiles[0]).toHaveClass("rounded-xl", "border", "p-5");
  });

  test("draws the tiles in the grid the page passes", () => {
    render(
      <StatTilesSkeleton count={5} gridClassName="grid grid-cols-5 gap-4" />,
    );

    const tiles: Array<HTMLElement> = screen.getAllByTestId(
      `${STAT_TILES_SKELETON_TEST_ID}-tile`,
    );
    expect(tiles).toHaveLength(5);
    expect(tiles[0]?.parentElement?.className).toBe("grid grid-cols-5 gap-4");
  });
});

describe("CardListSkeleton", () => {
  test("draws three cards of a title and two lines by default", () => {
    render(<CardListSkeleton />);

    const cards: Array<HTMLElement> = screen.getAllByTestId(
      `${CARD_LIST_SKELETON_TEST_ID}-card`,
    );
    expect(cards).toHaveLength(3);
    // The title's line, then two.
    expect(cards[0]?.children).toHaveLength(3);
  });

  test("draws the cards and lines asked for", () => {
    render(<CardListSkeleton count={2} lines={0} />);

    const cards: Array<HTMLElement> = screen.getAllByTestId(
      `${CARD_LIST_SKELETON_TEST_ID}-card`,
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]?.children).toHaveLength(1);
  });
});

describe("PageSkeleton", () => {
  test("draws a table's rows in its card for a page that opens with a table", () => {
    render(<PageSkeleton shape="table" />);

    expect(
      screen.getByTestId(`${PAGE_SKELETON_TEST_ID}-table`),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByTestId(`${PAGE_SKELETON_TEST_ID}-field`),
    ).toHaveLength(0);
  });
});

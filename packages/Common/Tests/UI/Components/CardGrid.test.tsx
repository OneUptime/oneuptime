import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import Card, {
  CARD_FILL_HEIGHT_CLASS_NAME,
  CARD_FILL_HEIGHT_FRAME_CLASS_NAME,
  CARD_FRAME_CLASS_NAME,
} from "../../../UI/Components/Card/Card";
import CardGrid, {
  CARD_GRID_CELL_TEST_ID,
  CARD_GRID_TEST_ID,
  getCardGridCards,
} from "../../../UI/Components/Card/CardGrid";
import {
  CARD_GRID_CELL_CLASS_NAME,
  CARD_GRID_CENTERED_STATE_CLASS_NAME,
  CARD_GRID_CLASS_NAME,
  CARD_GRID_CONTAINER_CLASS_NAME,
  CARD_GRID_GAP_IN_PX,
  CARD_GRID_MIN_CARD_WIDTH_IN_REM,
  CARD_GRID_STEP_CLASS_NAMES,
  CARD_GRID_STEP_WIDTHS_IN_REM,
  CARD_GRID_TRACK_COUNT,
  CardGridLayout,
  CardGridStep,
  getCardGridCellClassName,
  getCardGridClassName,
  getCardGridColumnsAt,
  getCardGridSpan,
  getCardGridSteps,
} from "../../../UI/Components/Card/CardGridLayout";
import CardSections from "../../../UI/Components/Card/CardSections";
import {
  describeHeightFill,
  describeHeightFillChain,
} from "../../ResponsiveHeightFill";
import { resolveSpacing } from "../../ResponsiveSpacing";
import { WIDTHS_IN_PX } from "../../RenderedMarkup";

/*
 * CardGrid: cards side by side, every row ending on one line.
 *
 * "Gap between cards dont look nice. Please fix it." - the maintainer, of
 * the Security Events Overview, where every card shorter than its
 * neighbour left bare page under it. These hold the shared grid to what it
 * promises: how many cards share a row at the grid's own width, that a row
 * the cards do not fill is shared by the cards it has, and that the card of
 * a cell fills it while every other card is drawn exactly as before.
 *
 * jsdom lays nothing out, so heights are read the way the browser would
 * lay the boxes out (ResponsiveHeightFill), and the container queries are
 * read from the model the class names are made from (CardGridLayout). The
 * browser half - real boxes at 390 to 1440 pixels, beside a side menu - is
 * in E2E/DetailCards (the card rows gallery) and on the pages that use it.
 */

afterEach(() => {
  cleanup();
});

const LAYOUTS: Array<CardGridLayout> = [
  { columns: 2, cardWidth: "wide" },
  { columns: 2, cardWidth: "narrow" },
  { columns: 3, cardWidth: "wide" },
  { columns: 3, cardWidth: "narrow" },
];

function nameOf(layout: CardGridLayout): string {
  return `${layout.columns} ${layout.cardWidth}`;
}

describe("how many cards share a row, by the grid's own width", () => {
  test("each layout's steps: narrow cards two across from 34rem and three from 51rem, wide ones two from 51rem and three from 78rem", () => {
    expect(
      LAYOUTS.map((layout: CardGridLayout): [string, Array<string>] => {
        return [
          nameOf(layout),
          getCardGridSteps(layout).map((step: CardGridStep): string => {
            return `${step.columns} from ${step.minWidthInRem}rem`;
          }),
        ];
      }),
    ).toEqual([
      ["2 wide", ["2 from 51rem"]],
      ["2 narrow", ["2 from 34rem"]],
      ["3 wide", ["2 from 51rem", "3 from 78rem"]],
      ["3 narrow", ["2 from 34rem", "3 from 51rem"]],
    ]);
  });

  /*
   * What a page has for its cards beside the Security Events side menu, at
   * each window width (measured in the SecurityOperations fixture), and on a
   * phone, where the menu folds above the page.
   */
  const ROOM_BESIDE_THE_SIDE_MENU: Array<[string, number, Array<number>]> = [
    // window, the grid's width, then columns for 2 wide, 2 narrow, 3 wide, 3 narrow
    ["a 390px phone", 326, [1, 1, 1, 1]],
    ["a 768px window", 416, [1, 1, 1, 1]],
    ["a 1024px window", 620, [1, 2, 1, 2]],
    ["a 1280px window", 876, [2, 2, 2, 3]],
    ["a 1440px window", 1036, [2, 2, 2, 3]],
    ["a 1920px window", 1516, [2, 2, 3, 3]],
  ];

  test.each(ROOM_BESIDE_THE_SIDE_MENU)(
    "%s (%ipx of grid): wide cards stack until each has room, narrow ones share a row sooner",
    (_window: string, gridWidthInPx: number, columns: Array<number>) => {
      expect(
        LAYOUTS.map((layout: CardGridLayout): number => {
          return getCardGridColumnsAt(layout, gridWidthInPx);
        }),
      ).toEqual(columns);
    },
  );

  test("at every step each card is at least as wide as its kind needs, and a pixel less keeps one fewer across", () => {
    for (const layout of LAYOUTS) {
      for (const step of getCardGridSteps(layout)) {
        const gridWidthInPx: number = step.minWidthInRem * 16;
        const cardWidthInPx: number =
          (gridWidthInPx - (step.columns - 1) * CARD_GRID_GAP_IN_PX) /
          step.columns;

        expect(cardWidthInPx).toBeGreaterThanOrEqual(
          CARD_GRID_MIN_CARD_WIDTH_IN_REM[layout.cardWidth] * 16,
        );
        expect(getCardGridColumnsAt(layout, gridWidthInPx)).toBe(step.columns);
        expect(getCardGridColumnsAt(layout, gridWidthInPx - 1)).toBe(
          step.columns - 1,
        );
      }
    }
  });

  test("never more cards across than the layout allows", () => {
    for (const layout of LAYOUTS) {
      expect(getCardGridColumnsAt(layout, 100000)).toBe(layout.columns);
      expect(getCardGridColumnsAt(layout, 0)).toBe(1);
    }
  });
});

describe("a row the cards do not fill is shared by the cards it has", () => {
  // Each card's share of the six tracks, two and three across.
  const SPANS: Array<[number, Array<number>, Array<number>]> = [
    // cards, spans two across, spans three across
    [1, [6], [6]],
    [2, [3, 3], [3, 3]],
    [3, [3, 3, 6], [2, 2, 2]],
    [4, [3, 3, 3, 3], [2, 2, 2, 6]],
    [5, [3, 3, 3, 3, 6], [2, 2, 2, 3, 3]],
    [6, [3, 3, 3, 3, 3, 3], [2, 2, 2, 2, 2, 2]],
    [7, [3, 3, 3, 3, 3, 3, 6], [2, 2, 2, 2, 2, 2, 6]],
  ];

  test.each(SPANS)(
    "%i cards: two across %j, three across %j",
    (count: number, twoAcross: Array<number>, threeAcross: Array<number>) => {
      const spans: (columns: 2 | 3) => Array<number> = (
        columns: 2 | 3,
      ): Array<number> => {
        return Array.from({ length: count }, (_: unknown, index: number) => {
          return getCardGridSpan(columns, index, count);
        });
      };

      expect(spans(2)).toEqual(twoAcross);
      expect(spans(3)).toEqual(threeAcross);
    },
  );

  test("every row, the last one too, adds up to the grid's six tracks: no slot is left empty", () => {
    for (const columns of [2, 3] as Array<2 | 3>) {
      for (let count: number = 1; count <= 12; count++) {
        let row: number = 0;

        for (let index: number = 0; index < count; index++) {
          row += getCardGridSpan(columns, index, count);
          expect(row).toBeLessThanOrEqual(CARD_GRID_TRACK_COUNT);

          if (row === CARD_GRID_TRACK_COUNT) {
            row = 0;
          }
        }

        expect([columns, count, row]).toEqual([columns, count, 0]);
      }
    }
  });
});

describe("the class names the grid draws with", () => {
  test("the grid and its cells, exactly", () => {
    expect(CARD_GRID_CONTAINER_CLASS_NAME).toBe(
      "mb-5 w-full min-w-0 [container-type:inline-size]",
    );
    expect(CARD_GRID_CLASS_NAME).toBe("grid grid-cols-1 gap-5");
    expect(CARD_GRID_CELL_CLASS_NAME).toBe(
      "flex min-w-0 flex-col [&>*:last-child]:flex-1",
    );
    expect(CARD_GRID_CENTERED_STATE_CLASS_NAME).toBe(
      "flex flex-1 flex-col justify-center text-center",
    );
    expect(getCardGridClassName({ columns: 3, cardWidth: "narrow" })).toBe(
      "grid grid-cols-1 gap-5 [@container(min-width:34rem)]:grid-cols-6",
    );
    expect(getCardGridClassName({ columns: 2, cardWidth: "wide" })).toBe(
      "grid grid-cols-1 gap-5 [@container(min-width:51rem)]:grid-cols-6",
    );
    // The last of five narrow cards: half the row two across and three across.
    expect(
      getCardGridCellClassName({ columns: 3, cardWidth: "narrow" }, 4, 5),
    ).toBe(
      "flex min-w-0 flex-col [&>*:last-child]:flex-1 [@container(min-width:34rem)]:col-span-6 [@container(min-width:51rem)]:col-span-3",
    );
    // The first of two wide cards: half the row from 51rem.
    expect(
      getCardGridCellClassName({ columns: 2, cardWidth: "wide" }, 0, 2),
    ).toBe(
      "flex min-w-0 flex-col [&>*:last-child]:flex-1 [@container(min-width:51rem)]:col-span-3",
    );
  });

  test("a card's gap under it is the grid's gap, so a grid sits among a page's cards as one more card", () => {
    expect(
      resolveSpacing(CARD_GRID_CONTAINER_CLASS_NAME, 1280, "margin"),
    ).toEqual(resolveSpacing("mb-5", 1280, "margin"));
    expect(CARD_GRID_GAP_IN_PX).toBe(20);
  });

  test("every class name a grid or a cell can carry is a literal of the model's, in the runtime's form", () => {
    const CONTAINER_UTILITY: RegExp =
      /^\[@container\(min-width:(\d\d)rem\)\]:(grid-cols-6|col-span-[236])$/;
    const fixed: Set<string> = new Set<string>(
      [CARD_GRID_CLASS_NAME, CARD_GRID_CELL_CLASS_NAME].join(" ").split(" "),
    );

    for (const className of CARD_GRID_STEP_CLASS_NAMES) {
      expect([className, CONTAINER_UTILITY.test(className)]).toEqual([
        className,
        true,
      ]);
    }

    for (const layout of LAYOUTS) {
      const classNames: Array<string> = [getCardGridClassName(layout)];

      for (let count: number = 1; count <= 7; count++) {
        for (let index: number = 0; index < count; index++) {
          classNames.push(getCardGridCellClassName(layout, index, count));
        }
      }

      for (const token of classNames.join(" ").split(" ")) {
        expect([
          token,
          fixed.has(token) || CARD_GRID_STEP_CLASS_NAMES.includes(token),
        ]).toEqual([token, true]);
      }
    }
  });

  /*
   * The Tailwind runtime writes its arbitrary container variants sorted by
   * name as text, and where two apply the later one wins - "10rem" would
   * sort before "9rem" and lose to it. So the steps are whole rems of two
   * digits, which sort as text the way they do as numbers.
   */
  test("the steps sort as text in the order of their widths, so a wider step's classes win where both apply", () => {
    const asWritten: Array<string> = CARD_GRID_STEP_WIDTHS_IN_REM.map(
      (width: number): string => {
        return `[@container(min-width:${width}rem)]`;
      },
    );

    expect([...asWritten].sort()).toEqual(asWritten);
    expect(
      [...CARD_GRID_STEP_WIDTHS_IN_REM].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(CARD_GRID_STEP_WIDTHS_IN_REM);

    for (const width of CARD_GRID_STEP_WIDTHS_IN_REM) {
      expect([
        width,
        Number.isInteger(width),
        width >= 10 && width < 100,
      ]).toEqual([width, true, true]);
    }

    // Every step a layout uses is one of them.
    for (const layout of LAYOUTS) {
      for (const step of getCardGridSteps(layout)) {
        expect(CARD_GRID_STEP_WIDTHS_IN_REM).toContain(step.minWidthInRem);
      }
    }
  });
});

describe("CardGrid", () => {
  const GOLDEN: string =
    '<div data-testid="card-grid" data-columns="2" data-card-width="wide" class="mb-5 w-full min-w-0 [container-type:inline-size]"><div class="grid grid-cols-1 gap-5 [@container(min-width:51rem)]:grid-cols-6"><div data-testid="card-grid-cell" class="flex min-w-0 flex-col [&amp;>*:last-child]:flex-1 [@container(min-width:51rem)]:col-span-3"><p>one</p></div><div data-testid="card-grid-cell" class="flex min-w-0 flex-col [&amp;>*:last-child]:flex-1 [@container(min-width:51rem)]:col-span-3"><p>two</p></div></div></div>';

  test("renders this exact markup: a size container, its grid, a cell for each card", () => {
    const { container } = render(
      <CardGrid columns={2}>
        <p>one</p>
        <p>two</p>
      </CardGrid>,
    );

    expect(container.innerHTML).toBe(GOLDEN);
  });

  test.each(LAYOUTS)(
    "lays its cells out by $columns across and $cardWidth cards, and says so on its box",
    (layout: CardGridLayout) => {
      render(
        <CardGrid columns={layout.columns} cardWidth={layout.cardWidth}>
          <p>a</p>
          <p>b</p>
          <p>c</p>
          <p>d</p>
          <p>e</p>
        </CardGrid>,
      );

      const grid: HTMLElement = screen.getByTestId(CARD_GRID_TEST_ID);
      const cells: Array<HTMLElement> = screen.getAllByTestId(
        CARD_GRID_CELL_TEST_ID,
      );

      expect(grid).toHaveAttribute("data-columns", String(layout.columns));
      expect(grid).toHaveAttribute("data-card-width", layout.cardWidth);
      expect(grid.firstElementChild!.getAttribute("class")).toBe(
        getCardGridClassName(layout),
      );
      expect(
        cells.map((cell: HTMLElement): string => {
          return cell.getAttribute("class") || "";
        }),
      ).toEqual(
        [0, 1, 2, 3, 4].map((index: number): string => {
          return getCardGridCellClassName(layout, index, 5);
        }),
      );
      expect(
        cells.map((cell: HTMLElement): string => {
          return cell.textContent || "";
        }),
      ).toEqual(["a", "b", "c", "d", "e"]);
    },
  );

  test("wide cards unless it is told otherwise", () => {
    render(
      <CardGrid columns={3}>
        <p>a</p>
      </CardGrid>,
    );

    expect(screen.getByTestId(CARD_GRID_TEST_ID)).toHaveAttribute(
      "data-card-width",
      "wide",
    );
  });

  test("a card left out takes no cell: null, false, an empty fragment and stray text leave no hole, and a fragment's cards are cards of their own", () => {
    const isShown: boolean = false;
    const consoleError: SpyInstance<typeof console.error> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {});

    render(
      <CardGrid columns={3} cardWidth="narrow">
        {null}
        {isShown ? <p>hidden</p> : <></>}
        {false}
        text
        <p>first</p>
        <>
          <p>second</p>
          <p>third</p>
        </>
        <React.Fragment key="more">
          <p>fourth</p>
        </React.Fragment>
        {[<p key="x">fifth</p>, <p key="y">sixth</p>]}
      </CardGrid>,
    );

    expect(
      screen
        .getAllByTestId(CARD_GRID_CELL_TEST_ID)
        .map((cell: HTMLElement): string => {
          return cell.textContent || "";
        }),
    ).toEqual(["first", "second", "third", "fourth", "fifth", "sixth"]);
    // Every cell has a key of its own: React warns of none.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test("getCardGridCards opens fragments, drops nothing-children, and keeps keys unique across the fragments they came from", () => {
    const cards: Array<React.ReactElement> = getCardGridCards(
      <>
        <>
          <p>a</p>
        </>
        <>
          <p>b</p>
        </>
        {undefined}
      </>,
    );

    expect(
      cards.map((card: React.ReactElement): string => {
        return String((card.props as { children: string }).children);
      }),
    ).toEqual(["a", "b"]);
    expect(
      new Set(
        cards.map((card: React.ReactElement): string => {
          return String(card.key);
        }),
      ).size,
    ).toBe(2);
  });

  test("with no card it draws nothing at all", () => {
    const { container } = render(
      <CardGrid columns={2}>
        {null}
        <></>
      </CardGrid>,
    );

    expect(container.innerHTML).toBe("");
  });

  test("its box takes a class beside its own, and a test id", () => {
    render(
      <CardGrid columns={2} className="!mb-6" dataTestId="top-lists">
        <p>a</p>
      </CardGrid>,
    );

    expect(screen.getByTestId("top-lists").getAttribute("class")).toBe(
      `${CARD_GRID_CONTAINER_CLASS_NAME} !mb-6`,
    );
  });
});

/*
 * The card of a cell fills it - the fix itself. Everything else about a
 * card is as it was: its markup outside a grid, a card inside another
 * card's body, a section of a card, and a card that says it does not fill.
 */
describe("the card of a cell runs to the bottom of its row", () => {
  function renderCard(element: React.ReactElement): string {
    const { container, unmount } = render(element);
    const markup: string = container.innerHTML;
    unmount();
    return markup;
  }

  test("a card in a cell fills it, as fillHeight does, and leaves no gap of its own under it", () => {
    render(
      <CardGrid columns={2}>
        <Card title="Open Cases" description="The queue right now.">
          <div>rows</div>
        </Card>
        <Card title="Riskiest Entities">
          <div>entities</div>
        </Card>
      </CardGrid>,
    );

    for (const card of screen.getAllByTestId("card")) {
      expect(card).toHaveAttribute("data-fill-height", "true");
      expect(card.getAttribute("class")).toBe(CARD_FILL_HEIGHT_CLASS_NAME);
      expect(card.firstElementChild!.getAttribute("class")).toBe(
        `${CARD_FRAME_CLASS_NAME} ${CARD_FILL_HEIGHT_FRAME_CLASS_NAME}`,
      );
      expect(
        resolveSpacing(card.getAttribute("class"), 1280, "margin"),
      ).toEqual(resolveSpacing("", 1280, "margin"));
    }
  });

  test("its markup is fillHeight's, exactly", () => {
    const inCell: string = renderCard(
      <CardGrid columns={2}>
        <Card title="Title" description="Desc">
          <div>body</div>
        </Card>
      </CardGrid>,
    );
    const filled: string = renderCard(
      <Card title="Title" description="Desc" fillHeight={true}>
        <div>body</div>
      </Card>,
    );

    expect(inCell).toContain(filled);
  });

  test.each(WIDTHS_IN_PX)(
    "at %ipx every box from the card's body up to the grid fills the next - a card in a wrapper too",
    (width: number) => {
      render(
        <CardGrid columns={2}>
          <Card title="Short">
            <div>short</div>
          </Card>
          <div data-testid="wrapper">
            <Card title="Wrapped">
              <div>wrapped</div>
            </Card>
          </div>
        </CardGrid>,
      );

      const grid: HTMLElement = screen.getByTestId(CARD_GRID_TEST_ID)
        .firstElementChild as HTMLElement;

      for (const text of ["short", "wrapped"]) {
        expect([
          text,
          describeHeightFillChain(
            screen.getByText(text).parentElement!,
            grid,
            width,
          ),
        ]).toEqual([text, []]);
      }
    },
  );

  test("a sentence for nothing to list sits in the middle of the room the card has", () => {
    render(
      <CardGrid columns={2}>
        <Card title="Top Detections">
          <p className={`${CARD_GRID_CENTERED_STATE_CLASS_NAME} py-6`}>
            Nothing was detected in the last 14 days.
          </p>
        </Card>
      </CardGrid>,
    );

    const sentence: HTMLElement = screen.getByText(
      "Nothing was detected in the last 14 days.",
    );

    for (const width of WIDTHS_IN_PX) {
      expect(describeHeightFill(sentence, width)).toBeNull();
    }
    expect(sentence).toHaveClass("justify-center", "text-center");
  });

  test("a card outside a grid is drawn exactly as before", () => {
    const outside: string = renderCard(
      <Card title="Title" description="Desc" bodyClassName="mt-0">
        <div>body</div>
      </Card>,
    );

    expect(outside).not.toContain("data-fill-height");
    expect(outside).toContain(`class="mb-5 "`);
    expect(outside).toContain(`<div class="${CARD_FRAME_CLASS_NAME}">`);
  });

  test("a card drawn inside the cell's card is as tall as its content, as it always was", () => {
    render(
      <CardGrid columns={2}>
        <Card title="Outer">
          <Card title="Inner">
            <div>inner body</div>
          </Card>
        </Card>
      </CardGrid>,
    );

    const [outer, inner] = screen.getAllByTestId("card") as [
      HTMLElement,
      HTMLElement,
    ];

    expect(outer).toHaveAttribute("data-fill-height", "true");
    expect(inner).not.toHaveAttribute("data-fill-height");
    expect(inner.getAttribute("class")).toBe("mb-5 ");
  });

  test("a card that says fillHeight={false} keeps to its content in a cell too", () => {
    render(
      <CardGrid columns={2}>
        <Card title="Own height" fillHeight={false}>
          <div>body</div>
        </Card>
      </CardGrid>,
    );

    expect(screen.getByTestId("card")).not.toHaveAttribute("data-fill-height");
  });

  test("cards drawn as the sections of a card in a cell are sections, with the card around them as tall as the row", () => {
    render(
      <CardGrid columns={2}>
        <Card title="More settings">
          <CardSections>
            <Card title="Section">
              <div>section body</div>
            </Card>
          </CardSections>
        </Card>
      </CardGrid>,
    );

    const cards: Array<HTMLElement> = screen.getAllByTestId("card");

    expect(cards[0]).toHaveAttribute("data-fill-height", "true");
    expect(cards[1]).toHaveAttribute("data-card-surface", "section");
    expect(cards[1]).not.toHaveAttribute("data-fill-height");
  });

  test("a component that draws a card fills its cell the same way", () => {
    const ServicesCard: React.FunctionComponent<{ side: string }> = (props: {
      side: string;
    }): React.ReactElement => {
      return (
        <Card title={props.side}>
          <div>{props.side} list</div>
        </Card>
      );
    };

    render(
      <CardGrid columns={2}>
        <ServicesCard side="Producers" />
        <ServicesCard side="Consumers" />
      </CardGrid>,
    );

    for (const cell of screen.getAllByTestId(CARD_GRID_CELL_TEST_ID)) {
      expect(within(cell).getByTestId("card")).toHaveAttribute(
        "data-fill-height",
        "true",
      );
    }
  });
});

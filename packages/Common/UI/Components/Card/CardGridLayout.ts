/*
 * How CardGrid lays its cards out - the React-free half, so the tests and
 * the guards read the same rules and class names the grid draws with.
 *
 * "Gap between cards dont look nice. Please fix it." - the maintainer, of
 * the Security Events Overview: a row of cards of different heights, each
 * ending with its content, left bare page under the short ones beside a
 * tall one. A card's frame sits inside a box of its own (Card), so a grid
 * that stretches its cells still drew the frame only as tall as what was in
 * it. In a CardGrid every card fills its cell, so each row ends on one line;
 * and a row the cards do not fill - the last card alone in a row of two -
 * is shared by the cards it has, so no empty slot is left beside them
 * either.
 *
 * The columns follow the grid's own width, not the window's. Beside a side
 * menu a 1024px window leaves a grid some 640px, and a 768px one some
 * 420px, so the window's breakpoints put two or three cards side by side
 * where each had room for a word or two. Here the grid is a size container
 * (CARD_GRID_CONTAINER_CLASS_NAME), and a card has the width it needs before
 * another shares its row:
 *
 * - "narrow" cards (16rem) - short ranked lists, counts by a short name -
 *   go two across from 34rem and three across from 51rem.
 * - "wide" cards (24rem) - lists that name things (hosts, entities, devices,
 *   pools) and charts of thirty days - go two across from 51rem and three
 *   across from 78rem.
 *
 * At 1280 a page beside the side menu has some 870px: two wide cards, or
 * three narrow ones, side by side. At 1024 it has some 640px: wide cards one
 * above the other, narrow ones two across. At 768 and on a phone every card
 * takes the whole width.
 *
 * Two or three across, the grid has six tracks, so a row is shared evenly
 * by however many cards are left for it: three in a row of three take two
 * tracks each, two left over take three each, one left over takes all six.
 */

export type CardGridColumns = 2 | 3;

export type CardGridCardWidth = "narrow" | "wide";

export interface CardGridLayout {
  // The most cards side by side.
  columns: CardGridColumns;
  // How narrow a card may get before fewer share a row.
  cardWidth: CardGridCardWidth;
}

/*
 * The grid's widths, in rem, at which more cards share a row. Whole rems of
 * two digits on purpose: the Tailwind runtime writes its arbitrary
 * container variants in the order of their names as text ("10rem" before
 * "9rem"), and where two of them apply the later one wins - so a wider step
 * must also sort after a narrower one as text.
 */
export type CardGridStepWidthInRem = 34 | 51 | 78;

export const CARD_GRID_STEP_WIDTHS_IN_REM: ReadonlyArray<CardGridStepWidthInRem> =
  [34, 51, 78];

// A card's share of the six tracks.
export type CardGridSpan = 2 | 3 | 6;

export const CARD_GRID_TRACK_COUNT: number = 6;

// The gap between cards, as a card leaves under itself (Card's mb-5).
export const CARD_GRID_GAP_IN_PX: number = 20;

// The narrowest a card gets beside another, at each card width.
export const CARD_GRID_MIN_CARD_WIDTH_IN_REM: Record<
  CardGridCardWidth,
  number
> = {
  narrow: 16,
  wide: 24,
};

// Where a layout puts more cards side by side.
export interface CardGridStep {
  minWidthInRem: CardGridStepWidthInRem;
  columns: 2 | 3;
}

const STEPS: Record<
  CardGridCardWidth,
  Record<CardGridColumns, ReadonlyArray<CardGridStep>>
> = {
  narrow: {
    2: [{ minWidthInRem: 34, columns: 2 }],
    3: [
      { minWidthInRem: 34, columns: 2 },
      { minWidthInRem: 51, columns: 3 },
    ],
  },
  wide: {
    2: [{ minWidthInRem: 51, columns: 2 }],
    3: [
      { minWidthInRem: 51, columns: 2 },
      { minWidthInRem: 78, columns: 3 },
    ],
  },
};

export const getCardGridSteps: (
  layout: CardGridLayout,
) => ReadonlyArray<CardGridStep> = (
  layout: CardGridLayout,
): ReadonlyArray<CardGridStep> => {
  return STEPS[layout.cardWidth][layout.columns];
};

/*
 * The size container the grid reads its width from - a container cannot
 * lay itself out by its own width, so it is the grid's wrapper. As wide as
 * the box it is in, since a size container has no width of its own to
 * offer a row that would shrink it to fit; and with a card's gap under it,
 * so a grid of cards sits among a page's cards as one more of them would.
 */
export const CARD_GRID_CONTAINER_CLASS_NAME: string =
  "mb-5 w-full min-w-0 [container-type:inline-size]";

// One card across until the grid is wide enough for more.
export const CARD_GRID_CLASS_NAME: string = "grid grid-cols-1 gap-5";

/*
 * A cell: two of the grid's rows - one for its card's header, one for the
 * card's body - shared with the cells beside it. The cell is a subgrid of
 * those two rows and hands them to its card ([&>*]:grid-rows-subgrid), and
 * the card draws its frame, its padding, then its header and its body on
 * the same two rows (Card, CARD_IN_ROW_CLASS_NAME). So in a row of cards:
 *
 * - every body starts on one line, however long the titles and the
 *   descriptions above them - a list beside a list, a chart beside a
 *   chart, in every language ("Verdicts' description is a line longer than
 *   its neighbours', so its list starts a line lower");
 * - every frame ends on one line, at the row's bottom: the shorter card's
 *   body takes the room its content leaves, so an empty sentence can sit
 *   in the middle of it (CARD_GRID_CENTERED_STATE_CLASS_NAME).
 *
 * The grid's gap (20px) is between a row's header row and its body row
 * too; a card's body takes back 4px of it, so it starts 16px under its
 * header, as it does in a card outside a grid. Margins never sit on a
 * subgrid's box: browsers agree on a subgrid that keeps its parent's gap,
 * and not on one that sets its own (Firefox drew a gap of 0 as 20px more).
 * A card the cell holds through a wrapper of its own still fills the cell,
 * its header and body on two rows of its own (grid-rows-[auto_1fr]). The
 * cell's one column may be narrower than its card's widest content
 * (grid-cols-1: minmax(0, 1fr)), so a chart or a long word never widens a
 * cell past its share of the row.
 */
export const CARD_GRID_CELL_CLASS_NAME: string =
  "grid min-w-0 row-span-2 grid-cols-1 grid-rows-subgrid [&>*]:row-span-2 [&>*]:grid-rows-subgrid";

/*
 * A column of a hand-built row of boxes that are not Cards - a heading over
 * a list's box, as the Traces overview's Recent Errors and Slowest Requests
 * are: the column's last box takes the column's height, so it runs to the
 * row's bottom beside a taller one. A CardGrid's cells align their cards'
 * bodies as well; a column like this only fills.
 */
export const CARD_ROW_COLUMN_CLASS_NAME: string =
  "flex min-w-0 flex-col [&>*:last-child]:flex-1";

/*
 * What a card in a cell draws when it has nothing to list - a sentence, an
 * empty state: it takes the room the card has under its header and sits in
 * its middle, as Home's do. Beside a taller card the card is tall, and the
 * sentence at its top would leave the rest of it blank under it. A list
 * keeps its rows at the top. Outside a grid it is as tall as it is.
 */
export const CARD_GRID_CENTERED_STATE_CLASS_NAME: string =
  "flex flex-1 flex-col justify-center text-center";

/*
 * Literal class names - never built from pieces - so whatever reads the
 * source for Tailwind's classes finds every one of them.
 */
// Six tracks from a layout's first step: 34rem for narrow cards, 51 for wide.
type CardGridFirstStepWidthInRem = 34 | 51;

const TRACK_CLASS_NAMES: Record<CardGridFirstStepWidthInRem, string> = {
  34: "[@container(min-width:34rem)]:grid-cols-6",
  51: "[@container(min-width:51rem)]:grid-cols-6",
};

const SPAN_CLASS_NAMES: Record<
  CardGridStepWidthInRem,
  Record<CardGridSpan, string>
> = {
  34: {
    2: "[@container(min-width:34rem)]:col-span-2",
    3: "[@container(min-width:34rem)]:col-span-3",
    6: "[@container(min-width:34rem)]:col-span-6",
  },
  51: {
    2: "[@container(min-width:51rem)]:col-span-2",
    3: "[@container(min-width:51rem)]:col-span-3",
    6: "[@container(min-width:51rem)]:col-span-6",
  },
  78: {
    2: "[@container(min-width:78rem)]:col-span-2",
    3: "[@container(min-width:78rem)]:col-span-3",
    6: "[@container(min-width:78rem)]:col-span-6",
  },
};

// The grid's tracks: one, then six from its first step up.
export const getCardGridClassName: (layout: CardGridLayout) => string = (
  layout: CardGridLayout,
): string => {
  const firstStep: CardGridFirstStepWidthInRem = getCardGridSteps(layout)[0]!
    .minWidthInRem as CardGridFirstStepWidthInRem;

  return `${CARD_GRID_CLASS_NAME} ${TRACK_CLASS_NAMES[firstStep]}`;
};

/*
 * A card's share of its row with `columns` cards side by side: an even
 * share of the six tracks, and in a last row the cards do not fill, an even
 * share among the cards left for it.
 */
export const getCardGridSpan: (
  columns: 2 | 3,
  index: number,
  count: number,
) => CardGridSpan = (
  columns: 2 | 3,
  index: number,
  count: number,
): CardGridSpan => {
  const leftOver: number = count % columns;
  const isInLastRow: boolean = leftOver > 0 && index >= count - leftOver;
  const cardsInRow: number = isInLastRow ? leftOver : columns;

  return (CARD_GRID_TRACK_COUNT / cardsInRow) as CardGridSpan;
};

// The cell of the card at `index` of `count`, with its span at each step.
export const getCardGridCellClassName: (
  layout: CardGridLayout,
  index: number,
  count: number,
) => string = (
  layout: CardGridLayout,
  index: number,
  count: number,
): string => {
  return [
    CARD_GRID_CELL_CLASS_NAME,
    ...getCardGridSteps(layout).map((step: CardGridStep): string => {
      return SPAN_CLASS_NAMES[step.minWidthInRem][
        getCardGridSpan(step.columns, index, count)
      ];
    }),
  ].join(" ");
};

/*
 * How many cards share a row in a grid this wide (in px, at 16px a rem):
 * what the class names above make of it, for the tests.
 */
export const getCardGridColumnsAt: (
  layout: CardGridLayout,
  gridWidthInPx: number,
) => number = (layout: CardGridLayout, gridWidthInPx: number): number => {
  let columns: number = 1;

  for (const step of getCardGridSteps(layout)) {
    if (gridWidthInPx >= step.minWidthInRem * 16) {
      columns = step.columns;
    }
  }

  return columns;
};

// Every class name a grid's cells and tracks can carry beside the fixed ones.
export const CARD_GRID_STEP_CLASS_NAMES: ReadonlyArray<string> = [
  ...Object.values(TRACK_CLASS_NAMES),
  ...Object.values(SPAN_CLASS_NAMES).flatMap(
    (spans: Record<CardGridSpan, string>): Array<string> => {
      return Object.values(spans);
    },
  ),
];

/*
 * HOW A TABLE FITS THE BOX IT IS DRAWN IN.
 *
 * A table gives way before it scrolls (useTableScrollState): its row's
 * name takes the room the row has, its header's names wrap, its long
 * values are cut short a little more. When even that is too wide it has
 * two more ways to fit, tried in this order, each kept while the table's
 * own box is narrower than the width the roomier way needed:
 *
 *   - Rows: every column, as the page declares them.
 *   - Folded: the columns a page marks foldable (Column.hideBelowLargeScreen)
 *     are left out, their values shown in another column's cell
 *     (useAreTableColumnsFolded). A narrow box always folds them, whether
 *     the table would fit or not: below 48rem a column of prose beside them
 *     stood five lines tall (the Rule Library, a cluster's Events at
 *     1024-1100px beside a side menu, where the card is 682-758px).
 *   - Cards: each row is a card of its column names over their values, as
 *     on a phone - only in a narrow box (below 48rem), where a table that
 *     still does not fit showed a row's name and its buttons and nothing
 *     between them: at 768-900px beside a side menu, where a card is
 *     430-560px wide, 347 of 357 lists ran their rows under their sticky
 *     Actions column.
 *
 * A phone (a window below 768px) always draws cards, decided before the
 * first paint: a phone never sees a table turn into cards.
 *
 * Everything is read from the table's own box, not the window: a table in
 * a narrow card on a wide screen folds as one beside a side menu does.
 * Where the box cannot be measured yet (the first draw, a page with no
 * layout) the window stands in for it, as it always did.
 *
 * React-free on purpose: the rules are pure, and tested as such.
 */

import { TABLE_NEARLY_FITS_WITHIN_IN_PX } from "./TableLayout";

export enum TableFitStep {
  Rows = "rows",
  Folded = "folded",
  Cards = "cards",
}

// The order of the steps, from the roomiest.
export const TABLE_FIT_STEPS: ReadonlyArray<TableFitStep> = [
  TableFitStep.Rows,
  TableFitStep.Folded,
  TableFitStep.Cards,
];

/*
 * Below this width a table's own box is narrow: its foldable columns fold,
 * and rows that cannot fit it are drawn as cards. Tailwind's md, as a width
 * of the table rather than of the window: beside a side menu a card is
 * narrower than this up to a window of about 1100px.
 */
export const TABLE_NARROW_BELOW_WIDTH_IN_PX: number = 768;

/*
 * Where the box is not measured yet, the window stands in for it: below lg
 * a card beside a side menu is narrower than TABLE_NARROW_BELOW_WIDTH_IN_PX.
 */
export const TABLE_NARROW_WINDOW_BELOW_WIDTH_IN_PX: number = 1024;

export interface TableFitInput {
  // A window below 768px: rows are always cards.
  isPhone: boolean;
  // The table's own box, or null where it is not measured.
  boxWidth: number | null;
  // The window's width, for when the box is not measured.
  windowWidth: number;
  // Whether a column may be folded into another column's cell.
  hasFoldableColumns: boolean;
}

export const getTableFitStepIndex: (step: TableFitStep) => number = (
  step: TableFitStep,
): number => {
  return TABLE_FIT_STEPS.indexOf(step);
};

// Whether the table's box is narrow (below 48rem), or the window says so.
export const isTableBoxNarrow: (input: TableFitInput) => boolean = (
  input: TableFitInput,
): boolean => {
  if (input.boxWidth !== null && input.boxWidth > 0) {
    return input.boxWidth < TABLE_NARROW_BELOW_WIDTH_IN_PX;
  }

  return input.windowWidth < TABLE_NARROW_WINDOW_BELOW_WIDTH_IN_PX;
};

// Whether a table may be drawn at a step at all.
export const isTableFitStepAllowed: (
  step: TableFitStep,
  input: TableFitInput,
) => boolean = (step: TableFitStep, input: TableFitInput): boolean => {
  if (input.isPhone) {
    return step === TableFitStep.Cards;
  }

  if (step === TableFitStep.Folded) {
    return input.hasFoldableColumns;
  }

  if (step === TableFitStep.Cards) {
    return isTableBoxNarrow(input);
  }

  return true;
};

/*
 * The roomiest step a table may be drawn at: cards on a phone, folded in a
 * narrow box (when a column may fold), rows otherwise.
 */
export const getLeastTableFitStep: (input: TableFitInput) => TableFitStep = (
  input: TableFitInput,
): TableFitStep => {
  if (input.isPhone) {
    return TableFitStep.Cards;
  }

  if (input.hasFoldableColumns && isTableBoxNarrow(input)) {
    return TableFitStep.Folded;
  }

  return TableFitStep.Rows;
};

// The next way to fit, for a table that does not fit at a step; null: it scrolls.
export const getNextTableFitStep: (
  step: TableFitStep,
  input: TableFitInput,
) => TableFitStep | null = (
  step: TableFitStep,
  input: TableFitInput,
): TableFitStep | null => {
  const steps: Array<TableFitStep> = TABLE_FIT_STEPS.slice(
    getTableFitStepIndex(step) + 1,
  );

  return (
    steps.find((next: TableFitStep): boolean => {
      return isTableFitStepAllowed(next, input);
    }) || null
  );
};

// The roomier step before one, that a table may be drawn at; null: none.
export const getPreviousTableFitStep: (
  step: TableFitStep,
  input: TableFitInput,
) => TableFitStep | null = (
  step: TableFitStep,
  input: TableFitInput,
): TableFitStep | null => {
  const steps: Array<TableFitStep> = TABLE_FIT_STEPS.slice(
    0,
    getTableFitStepIndex(step),
  ).reverse();

  return (
    steps.find((previous: TableFitStep): boolean => {
      return isTableFitStepAllowed(previous, input);
    }) || null
  );
};

/*
 * Where a table is, and the least box width each roomier step it left
 * needed - the table's width with everything given way, when it did not
 * fit. Only a box that wide or wider tries a roomier step again, so a
 * table never turns back and forth as it is measured.
 */
export interface TableFitState {
  step: TableFitStep;
  neededWidths: Partial<Record<TableFitStep, number>>;
}

/*
 * Where a table goes now: a step it may not be drawn at gives way to the
 * nearest it may (a box made wider than 48rem leaves the cards; a phone
 * always draws them), and a roomier step is tried again once the box is
 * as wide as it needed - or when it was never measured, as when a box
 * that was narrow (and so folded from the start) is wide now.
 */
export const getTableFitStateFor: (
  state: TableFitState,
  input: TableFitInput,
) => TableFitState = (
  state: TableFitState,
  input: TableFitInput,
): TableFitState => {
  const least: TableFitStep = getLeastTableFitStep(input);
  let step: TableFitStep = state.step;

  // Never roomier than the least the table may be drawn at.
  if (getTableFitStepIndex(step) < getTableFitStepIndex(least)) {
    step = least;
  }

  // A step it may not be drawn at: the nearest roomier one it may.
  while (!isTableFitStepAllowed(step, input)) {
    const previous: TableFitStep | null = getPreviousTableFitStep(
      step,
      input,
    );

    if (!previous) {
      step = least;
      break;
    }

    step = previous;
  }

  // Roomier steps the box is wide enough to try again.
  let previous: TableFitStep | null = getPreviousTableFitStep(step, input);

  while (
    previous &&
    getTableFitStepIndex(previous) >= getTableFitStepIndex(least)
  ) {
    const needed: number | undefined = state.neededWidths[previous];

    if (
      needed !== undefined &&
      (input.boxWidth === null || input.boxWidth < needed)
    ) {
      break;
    }

    step = previous;
    previous = getPreviousTableFitStep(step, input);
  }

  if (step === state.step) {
    return state;
  }

  return { step: step, neededWidths: state.neededWidths };
};

/*
 * Rows turn into cards only when they need more than 2rem more room than
 * their box (TableLayout's TABLE_NEARLY_FITS_WITHIN_IN_PX): a table a few
 * pixels too wide keeps its rows, given way - the end of its last value
 * scrolls under the row's buttons - rather than every row becoming a card
 * three or four times as tall. Wider than that, a whole value - an owner,
 * a label - was out of sight.
 */
export const TABLE_CARDS_ABOVE_OVERFLOW_IN_PX: number =
  TABLE_NEARLY_FITS_WITHIN_IN_PX;

/*
 * A table that did not fit at its step - it needed tightWidth, its box is
 * boxWidth wide: the next way to fit, remembering the width it needed.
 * Unchanged when there is none - the rows scroll.
 */
export const getTableFitStateAfterCannotFit: (
  state: TableFitState,
  input: TableFitInput,
  tightWidth: number,
  boxWidth?: number | undefined,
) => TableFitState = (
  state: TableFitState,
  input: TableFitInput,
  tightWidth: number,
  boxWidth?: number | undefined,
): TableFitState => {
  const next: TableFitStep | null = getNextTableFitStep(state.step, input);

  if (!next) {
    return state;
  }

  const box: number | null = boxWidth ?? input.boxWidth;

  if (
    next === TableFitStep.Cards &&
    box !== null &&
    box > 0 &&
    tightWidth <= box + TABLE_CARDS_ABOVE_OVERFLOW_IN_PX
  ) {
    return state;
  }

  return {
    step: next,
    neededWidths: { ...state.neededWidths, [state.step]: tightWidth },
  };
};

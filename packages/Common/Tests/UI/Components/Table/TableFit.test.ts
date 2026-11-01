import { describe, expect, test } from "@jest/globals";
import {
  TABLE_CARDS_ABOVE_OVERFLOW_IN_PX,
  TABLE_FIT_STEPS,
  TABLE_NARROW_BELOW_WIDTH_IN_PX,
  TABLE_NARROW_WINDOW_BELOW_WIDTH_IN_PX,
  TableFitInput,
  TableFitState,
  TableFitStep,
  getLeastTableFitStep,
  getNextTableFitStep,
  getPreviousTableFitStep,
  getTableFitStateAfterCannotFit,
  getTableFitStateFor,
  isTableBoxNarrow,
  isTableFitStepAllowed,
} from "../../../../UI/Components/Table/TableFit";
import { TABLE_NEARLY_FITS_WITHIN_IN_PX } from "../../../../UI/Components/Table/TableLayout";

/*
 * How a table fits the box it is drawn in (TableFit): as rows, folded (its
 * foldable columns' values in other cells) or as cards - by the table's own
 * box, not the window.
 *
 * "Most tables at 768-900px still scroll" and "Fold columns by the card's
 * own width, not the window's: at 1024-1100px the Rule Library and Events
 * unfold into a cramped card" - beside a side menu a card is 430-758px
 * wide up to a window of about 1100px, and 347 of 357 lists ran their rows
 * under their sticky Actions column at 900px.
 */

const input: (data: Partial<TableFitInput>) => TableFitInput = (
  data: Partial<TableFitInput>,
): TableFitInput => {
  return {
    isPhone: false,
    boxWidth: 938,
    windowWidth: 1280,
    hasFoldableColumns: false,
    ...data,
  };
};

const state: (
  step: TableFitStep,
  neededWidths?: TableFitState["neededWidths"],
) => TableFitState = (
  step: TableFitStep,
  neededWidths?: TableFitState["neededWidths"],
): TableFitState => {
  return { step: step, neededWidths: neededWidths || {} };
};

describe("the steps and the widths they turn at", () => {
  test("rows, then folded, then cards: from the roomiest", () => {
    expect(TABLE_FIT_STEPS).toEqual([
      TableFitStep.Rows,
      TableFitStep.Folded,
      TableFitStep.Cards,
    ]);
  });

  test("a box is narrow below 48rem; the window stands in below lg where it is not measured", () => {
    expect(TABLE_NARROW_BELOW_WIDTH_IN_PX).toBe(768);
    expect(TABLE_NARROW_WINDOW_BELOW_WIDTH_IN_PX).toBe(1024);

    expect(isTableBoxNarrow(input({ boxWidth: 767 }))).toBe(true);
    expect(isTableBoxNarrow(input({ boxWidth: 768 }))).toBe(false);
    // Beside a side menu from 1024 to 1100px: narrow, wherever the window is.
    expect(isTableBoxNarrow(input({ boxWidth: 682, windowWidth: 1024 }))).toBe(
      true,
    );
    expect(isTableBoxNarrow(input({ boxWidth: 758, windowWidth: 1100 }))).toBe(
      true,
    );
    // A narrow card on a wide screen is narrow too.
    expect(isTableBoxNarrow(input({ boxWidth: 500, windowWidth: 1920 }))).toBe(
      true,
    );
    // Not measured (the first draw, or no layout): the window says.
    expect(isTableBoxNarrow(input({ boxWidth: null, windowWidth: 1023 }))).toBe(
      true,
    );
    expect(isTableBoxNarrow(input({ boxWidth: null, windowWidth: 1024 }))).toBe(
      false,
    );
    expect(isTableBoxNarrow(input({ boxWidth: 0, windowWidth: 800 }))).toBe(
      true,
    );
  });

  test("cards wait for 2rem of overflow: a few pixels too wide keeps its rows", () => {
    expect(TABLE_CARDS_ABOVE_OVERFLOW_IN_PX).toBe(32);
    expect(TABLE_CARDS_ABOVE_OVERFLOW_IN_PX).toBe(
      TABLE_NEARLY_FITS_WITHIN_IN_PX,
    );
  });
});

describe("where a table starts", () => {
  test("a phone always draws cards, from its first paint", () => {
    expect(getLeastTableFitStep(input({ isPhone: true }))).toBe(
      TableFitStep.Cards,
    );
    expect(
      getLeastTableFitStep(
        input({ isPhone: true, boxWidth: null, hasFoldableColumns: true }),
      ),
    ).toBe(TableFitStep.Cards);
  });

  test("a narrow box folds what may fold, whether the rows would fit or not", () => {
    expect(
      getLeastTableFitStep(input({ boxWidth: 700, hasFoldableColumns: true })),
    ).toBe(TableFitStep.Folded);
    // Nothing to fold: rows.
    expect(getLeastTableFitStep(input({ boxWidth: 700 }))).toBe(
      TableFitStep.Rows,
    );
  });

  test("a wide box starts as rows, foldable or not", () => {
    expect(
      getLeastTableFitStep(input({ boxWidth: 938, hasFoldableColumns: true })),
    ).toBe(TableFitStep.Rows);
  });
});

describe("which steps a table may take", () => {
  test("cards only in a narrow box, folded only with a column to fold", () => {
    expect(
      isTableFitStepAllowed(TableFitStep.Cards, input({ boxWidth: 600 })),
    ).toBe(true);
    expect(
      isTableFitStepAllowed(TableFitStep.Cards, input({ boxWidth: 938 })),
    ).toBe(false);
    expect(
      isTableFitStepAllowed(
        TableFitStep.Folded,
        input({ hasFoldableColumns: false }),
      ),
    ).toBe(false);
    expect(
      isTableFitStepAllowed(
        TableFitStep.Folded,
        input({ hasFoldableColumns: true }),
      ),
    ).toBe(true);
  });

  test("a phone may only draw cards", () => {
    for (const step of TABLE_FIT_STEPS) {
      expect(
        isTableFitStepAllowed(
          step,
          input({ isPhone: true, hasFoldableColumns: true, boxWidth: 390 }),
        ),
      ).toBe(step === TableFitStep.Cards);
    }
  });

  test("the next step skips one a table may not take", () => {
    // Nothing to fold: rows go straight to cards in a narrow box.
    expect(
      getNextTableFitStep(TableFitStep.Rows, input({ boxWidth: 600 })),
    ).toBe(TableFitStep.Cards);
    // ...and nowhere in a wide one: the rows scroll.
    expect(
      getNextTableFitStep(TableFitStep.Rows, input({ boxWidth: 938 })),
    ).toBeNull();
    expect(
      getNextTableFitStep(
        TableFitStep.Rows,
        input({ boxWidth: 938, hasFoldableColumns: true }),
      ),
    ).toBe(TableFitStep.Folded);
    expect(
      getNextTableFitStep(
        TableFitStep.Folded,
        input({ boxWidth: 938, hasFoldableColumns: true }),
      ),
    ).toBeNull();
    expect(
      getNextTableFitStep(
        TableFitStep.Folded,
        input({ boxWidth: 600, hasFoldableColumns: true }),
      ),
    ).toBe(TableFitStep.Cards);
    expect(
      getNextTableFitStep(TableFitStep.Cards, input({ boxWidth: 600 })),
    ).toBeNull();
  });

  test("the previous step skips one a table may not take", () => {
    expect(
      getPreviousTableFitStep(TableFitStep.Cards, input({ boxWidth: 600 })),
    ).toBe(TableFitStep.Rows);
    expect(
      getPreviousTableFitStep(
        TableFitStep.Cards,
        input({ boxWidth: 600, hasFoldableColumns: true }),
      ),
    ).toBe(TableFitStep.Folded);
    expect(getPreviousTableFitStep(TableFitStep.Rows, input({}))).toBeNull();
  });
});

describe("a table that does not fit moves on, remembering what it needed", () => {
  test("rows fold first, remembering the width the rows needed", () => {
    const next: TableFitState = getTableFitStateAfterCannotFit(
      state(TableFitStep.Rows),
      input({ hasFoldableColumns: true }),
      1504,
      938,
    );

    expect(next).toEqual({
      step: TableFitStep.Folded,
      neededWidths: { [TableFitStep.Rows]: 1504 },
    });
  });

  test("rows that cannot fold, in a narrow box, become cards", () => {
    const next: TableFitState = getTableFitStateAfterCannotFit(
      state(TableFitStep.Rows),
      input({ boxWidth: 610 }),
      880,
      610,
    );

    expect(next).toEqual({
      step: TableFitStep.Cards,
      neededWidths: { [TableFitStep.Rows]: 880 },
    });
  });

  test("rows only 2rem too wide stay rows: their last few pixels scroll", () => {
    const current: TableFitState = state(TableFitStep.Rows);

    expect(
      getTableFitStateAfterCannotFit(
        current,
        input({ boxWidth: 610 }),
        610 + TABLE_CARDS_ABOVE_OVERFLOW_IN_PX,
        610,
      ),
    ).toBe(current);
    expect(
      getTableFitStateAfterCannotFit(
        current,
        input({ boxWidth: 610 }),
        610 + TABLE_CARDS_ABOVE_OVERFLOW_IN_PX + 1,
        610,
      ).step,
    ).toBe(TableFitStep.Cards);
  });

  test("a wide box has no cards: rows that cannot fit or fold scroll as they are", () => {
    const current: TableFitState = state(TableFitStep.Rows);

    expect(
      getTableFitStateAfterCannotFit(
        current,
        input({ boxWidth: 938 }),
        1500,
        938,
      ),
    ).toBe(current);
  });

  test("a folded table that still does not fit a narrow box becomes cards, keeping the rows' width", () => {
    const next: TableFitState = getTableFitStateAfterCannotFit(
      state(TableFitStep.Folded, { [TableFitStep.Rows]: 1100 }),
      input({ boxWidth: 700, hasFoldableColumns: true }),
      880,
      700,
    );

    expect(next).toEqual({
      step: TableFitStep.Cards,
      neededWidths: {
        [TableFitStep.Rows]: 1100,
        [TableFitStep.Folded]: 880,
      },
    });
  });
});

describe("where a table is drawn as its box changes", () => {
  test("a box made as wide as the rows needed tries them again", () => {
    const folded: TableFitState = state(TableFitStep.Folded, {
      [TableFitStep.Rows]: 1500,
    });

    expect(
      getTableFitStateFor(
        folded,
        input({ boxWidth: 1499, hasFoldableColumns: true }),
      ),
    ).toBe(folded);
    expect(
      getTableFitStateFor(
        folded,
        input({ boxWidth: 1500, hasFoldableColumns: true }),
      ).step,
    ).toBe(TableFitStep.Rows);
  });

  test("a box made wider than 48rem leaves the cards, for the roomiest step it has not ruled out", () => {
    const cards: TableFitState = state(TableFitStep.Cards, {
      [TableFitStep.Rows]: 900,
    });

    // Still narrow, and narrower than the rows needed: cards.
    expect(getTableFitStateFor(cards, input({ boxWidth: 700 }))).toBe(cards);
    // Wide: no cards; the rows are tried again (they scroll if they must).
    expect(getTableFitStateFor(cards, input({ boxWidth: 800 })).step).toBe(
      TableFitStep.Rows,
    );
  });

  test("a folded table whose box widens past 48rem tries its rows, never measured while it was narrow", () => {
    const folded: TableFitState = state(TableFitStep.Folded);

    expect(
      getTableFitStateFor(
        folded,
        input({ boxWidth: 700, hasFoldableColumns: true }),
      ),
    ).toBe(folded);
    expect(
      getTableFitStateFor(
        folded,
        input({ boxWidth: 900, hasFoldableColumns: true }),
      ).step,
    ).toBe(TableFitStep.Rows);
  });

  test("a narrow box folds a table that was rows", () => {
    expect(
      getTableFitStateFor(
        state(TableFitStep.Rows),
        input({ boxWidth: 700, hasFoldableColumns: true }),
      ).step,
    ).toBe(TableFitStep.Folded);
  });

  test("a phone draws cards whatever was measured", () => {
    expect(
      getTableFitStateFor(
        state(TableFitStep.Rows),
        input({ isPhone: true, boxWidth: 390 }),
      ).step,
    ).toBe(TableFitStep.Cards);
  });

  test("a box not measured never brings back a step it needed room for", () => {
    const folded: TableFitState = state(TableFitStep.Folded, {
      [TableFitStep.Rows]: 1500,
    });

    expect(
      getTableFitStateFor(
        folded,
        input({ boxWidth: null, windowWidth: 1920, hasFoldableColumns: true }),
      ),
    ).toBe(folded);
  });

  test("a table never chases itself: each step back needs a wider box than the last time", () => {
    let fit: TableFitState = state(TableFitStep.Rows);
    const fitInput: TableFitInput = input({ boxWidth: 700 });

    // The rows needed 880 in a 700 box: cards.
    fit = getTableFitStateAfterCannotFit(fit, fitInput, 880, 700);
    expect(fit.step).toBe(TableFitStep.Cards);

    // The same box, read again: still cards - nothing is measured again.
    expect(getTableFitStateFor(fit, fitInput)).toBe(fit);

    // A box of 760 is still narrower than the 880 the rows needed.
    expect(getTableFitStateFor(fit, input({ boxWidth: 760 }))).toBe(fit);
  });
});

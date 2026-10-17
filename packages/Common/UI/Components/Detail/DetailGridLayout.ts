/*
 * How a detail card lays out its fields (DetailStyle.Default): a grid of
 * label-over-value cells, in rows, with a hairline rule between two rows
 * that runs the whole width of the card.
 *
 * "How can we make this card model detail UI a lot better, more modern,
 * cleaner, and simpler for people to use and understand?" - the maintainer,
 * on User Settings > Profile, whose Email sat 20px lower than the Name
 * beside it and whose rules stopped at odd widths. The old layout trimmed
 * the padding of the first and the last FIELD (first:pt-0, last:pb-0), not
 * of the first and last ROW, so in two columns the second field of the
 * first row kept its top padding; and it gave every field an inline width
 * of 100/n percent of its own grid column, so in two columns a field was
 * half its column wide - its rule half the column, its text wrapped at a
 * quarter of the card (in four columns "Acme Status" broke into "Acm e
 * Statu s").
 *
 * Here the rows are worked out from the fields themselves, the way the
 * browser's grid places them, so each cell knows whether it is in the first
 * row (no rule, no top padding), the last row (no bottom padding) and the
 * last column (no gutter):
 *
 *   - Every field in a row shares that row's top: one row, one line.
 *   - A rule is drawn as the top border of each cell after the first row.
 *     The grid has no gap - the gutter between columns is padding inside
 *     each cell - so the rules of one row's cells meet in one line. The last
 *     cell of a row that is not full stretches to the row's end, so no rule
 *     ever stops short.
 *   - Narrow screens get one column, then two, and only wide ones more:
 *     a third and a fourth column wait for lg (1024px), where there is
 *     room for them.
 *
 * React-free on purpose: App's tests import it, and the skeleton a detail
 * card shows while it loads is laid out by the same rules.
 */

// The most columns a detail grid takes (Tailwind's grid-cols-* stops at 12).
export const MAX_DETAIL_COLUMNS: number = 12;

export interface DetailGridTier {
  /*
   * The Tailwind prefix the tier's classes carry: "" for every width, then
   * "sm:" (640px) and "lg:" (1024px).
   */
  prefix: string;
  columns: number;
}

export interface DetailCellPlacement {
  // 0-based.
  row: number;
  // The column the cell starts in, 0-based.
  column: number;
  // Columns it spans, after the last cell of a short row is stretched.
  span: number;
  isFirstRow: boolean;
  isLastRow: boolean;
  // It reaches the row's last column: no gutter after it.
  endsRow: boolean;
}

/*
 * The cell classes, by what they do. A cell after the first row is ruled
 * off from the row above and padded under the rule; every cell but those
 * of the last row is padded above the next rule; and a cell with a column
 * after it keeps a gutter on its right.
 */
export const DETAIL_CELL_BASE_CLASS_NAME: string =
  "min-w-0 border-gray-100";

export const DETAIL_CELL_RULED_CLASS_NAMES: ReadonlyArray<string> = [
  "border-t",
  "pt-4",
];

export const DETAIL_CELL_FIRST_ROW_CLASS_NAMES: ReadonlyArray<string> = [
  "border-t-0",
  "pt-0",
];

export const DETAIL_CELL_SPACED_CLASS_NAMES: ReadonlyArray<string> = ["pb-4"];

export const DETAIL_CELL_LAST_ROW_CLASS_NAMES: ReadonlyArray<string> = [
  "pb-0",
];

export const DETAIL_CELL_GUTTER_CLASS_NAMES: ReadonlyArray<string> = ["pr-6"];

export const DETAIL_CELL_ROW_END_CLASS_NAMES: ReadonlyArray<string> = ["pr-0"];

// A column count as a detail grid takes it: a whole number from 1 to 12.
export const getDetailColumnCount: (columns?: number | undefined) => number = (
  columns?: number | undefined,
): number => {
  if (!columns || !Number.isFinite(columns) || columns < 1) {
    return 1;
  }

  return Math.min(Math.floor(columns), MAX_DETAIL_COLUMNS);
};

/*
 * The widths a grid of this many columns changes at: one column on a
 * phone, two from sm, and the rest from lg. A one-column grid has one tier.
 */
export const getDetailGridTiers: (
  columns?: number | undefined,
) => Array<DetailGridTier> = (
  columns?: number | undefined,
): Array<DetailGridTier> => {
  const count: number = getDetailColumnCount(columns);
  const tiers: Array<DetailGridTier> = [{ prefix: "", columns: 1 }];

  if (count >= 2) {
    tiers.push({ prefix: "sm:", columns: 2 });
  }

  if (count >= 3) {
    tiers.push({ prefix: "lg:", columns: count });
  }

  return tiers;
};

// The grid's own classes: its columns at each tier, and no gap.
export const getDetailGridClassName: (columns?: number | undefined) => string = (
  columns?: number | undefined,
): string => {
  const tierClassNames: Array<string> = getDetailGridTiers(columns).map(
    (tier: DetailGridTier): string => {
      return `${tier.prefix}grid-cols-${tier.columns}`;
    },
  );

  return ["grid", ...tierClassNames, "w-full"].join(" ");
};

// A field's span as the grid takes it: 1 to the columns there are.
export const getDetailCellSpan: (
  colSpan: number | undefined,
  columns: number,
) => number = (colSpan: number | undefined, columns: number): number => {
  if (!colSpan || !Number.isFinite(colSpan) || colSpan < 1) {
    return 1;
  }

  return Math.min(Math.floor(colSpan), Math.max(1, columns));
};

/*
 * Where each cell lands in a grid of `columns` columns, as the browser's
 * grid places them: in order, each in the row it fits in, a cell too wide
 * for what is left of a row starting the next. The last cell of each row
 * is then stretched to the row's end, so every row is full.
 */
export const placeDetailCells: (
  spans: ReadonlyArray<number | undefined>,
  columns: number,
) => Array<DetailCellPlacement> = (
  spans: ReadonlyArray<number | undefined>,
  columns: number,
): Array<DetailCellPlacement> => {
  const count: number = Math.max(1, Math.floor(columns));
  const cells: Array<{ row: number; column: number; span: number }> = [];

  let row: number = 0;
  let column: number = 0;

  for (const rawSpan of spans) {
    const span: number = getDetailCellSpan(rawSpan, count);

    if (column + span > count) {
      row += 1;
      column = 0;
    }

    cells.push({ row: row, column: column, span: span });
    column += span;
  }

  const lastRow: number = cells.length > 0 ? cells[cells.length - 1]!.row : 0;

  return cells.map(
    (
      cell: { row: number; column: number; span: number },
      index: number,
    ): DetailCellPlacement => {
      const next: { row: number } | undefined = cells[index + 1];
      const isLastInRow: boolean = !next || next.row !== cell.row;
      const span: number = isLastInRow ? count - cell.column : cell.span;

      return {
        row: cell.row,
        column: cell.column,
        span: span,
        isFirstRow: cell.row === 0,
        isLastRow: cell.row === lastRow,
        endsRow: cell.column + span >= count,
      };
    },
  );
};

interface CellState {
  span: number;
  isFirstRow: boolean;
  isLastRow: boolean;
  endsRow: boolean;
}

const withPrefix: (
  prefix: string,
  classNames: ReadonlyArray<string>,
) => Array<string> = (
  prefix: string,
  classNames: ReadonlyArray<string>,
): Array<string> => {
  return classNames.map((className: string): string => {
    return `${prefix}${className}`;
  });
};

/*
 * Each cell's classes, for a grid of `columns` columns whose cells span
 * `spans` (a field's colSpan; undefined is 1). Mobile first: a tier only
 * says what changes from the tier under it.
 */
export const getDetailCellClassNames: (
  spans: ReadonlyArray<number | undefined>,
  columns?: number | undefined,
) => Array<string> = (
  spans: ReadonlyArray<number | undefined>,
  columns?: number | undefined,
): Array<string> => {
  const tiers: Array<DetailGridTier> = getDetailGridTiers(columns);

  const placementsByTier: Array<Array<DetailCellPlacement>> = tiers.map(
    (tier: DetailGridTier): Array<DetailCellPlacement> => {
      return placeDetailCells(spans, tier.columns);
    },
  );

  return spans.map((_span: number | undefined, index: number): string => {
    const classNames: Array<string> = [DETAIL_CELL_BASE_CLASS_NAME];
    let previous: CellState | null = null;

    for (let tierIndex: number = 0; tierIndex < tiers.length; tierIndex++) {
      const tier: DetailGridTier = tiers[tierIndex]!;
      const placement: DetailCellPlacement =
        placementsByTier[tierIndex]![index]!;
      const state: CellState = {
        span: placement.span,
        isFirstRow: placement.isFirstRow,
        isLastRow: placement.isLastRow,
        endsRow: placement.endsRow,
      };

      if (previous === null) {
        // Every width: one column, so every cell is a row of its own.
        classNames.push(
          ...(state.isFirstRow ? ["pt-0"] : DETAIL_CELL_RULED_CLASS_NAMES),
          ...(state.isLastRow
            ? DETAIL_CELL_LAST_ROW_CLASS_NAMES
            : DETAIL_CELL_SPACED_CLASS_NAMES),
        );
        previous = state;
        continue;
      }

      if (state.span !== previous.span) {
        classNames.push(`${tier.prefix}col-span-${state.span}`);
      }

      if (state.isFirstRow !== previous.isFirstRow) {
        classNames.push(
          ...withPrefix(
            tier.prefix,
            state.isFirstRow
              ? DETAIL_CELL_FIRST_ROW_CLASS_NAMES
              : DETAIL_CELL_RULED_CLASS_NAMES,
          ),
        );
      }

      if (state.isLastRow !== previous.isLastRow) {
        classNames.push(
          ...withPrefix(
            tier.prefix,
            state.isLastRow
              ? DETAIL_CELL_LAST_ROW_CLASS_NAMES
              : DETAIL_CELL_SPACED_CLASS_NAMES,
          ),
        );
      }

      if (state.endsRow !== previous.endsRow) {
        classNames.push(
          ...withPrefix(
            tier.prefix,
            state.endsRow
              ? DETAIL_CELL_ROW_END_CLASS_NAMES
              : DETAIL_CELL_GUTTER_CLASS_NAMES,
          ),
        );
      }

      previous = state;
    }

    return classNames.join(" ");
  });
};

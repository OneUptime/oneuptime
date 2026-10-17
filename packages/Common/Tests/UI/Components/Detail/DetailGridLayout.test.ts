import { describe, expect, test } from "@jest/globals";
import {
  DETAIL_CELL_BASE_CLASS_NAME,
  DetailCellPlacement,
  DetailGridTier,
  getDetailCellClassNames,
  getDetailCellSpan,
  getDetailColumnCount,
  getDetailGridClassName,
  getDetailGridTiers,
  MAX_DETAIL_COLUMNS,
  placeDetailCells,
} from "../../../../UI/Components/Detail/DetailGridLayout";
import { resolvePadding } from "../../../ResponsiveSpacing";
import {
  mediaPrecedenceOf,
  splitVariants,
} from "../../../ResponsiveVisibility";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * How a detail card lays out its fields (DetailGridLayout.ts).
 *
 * The maintainer's screenshot: User Settings > Profile, two columns, Name
 * and Email side by side - and Email 20px lower, the rules under the two
 * stopping at different widths. The old layout trimmed the first and last
 * FIELD's padding, not the first and last ROW's, and gave every field an
 * inline width of 100/n percent of its own column.
 *
 * These tests hold the layout to what was asked for, at every width a
 * browser can be (jsdom draws nothing, so the classes are resolved the way
 * the cascade would - ResponsiveSpacing and ResponsiveVisibility):
 *
 *   - the cells of one row share their top: the same padding above, and a
 *     rule above all of them or none;
 *   - no rule above the first row, no padding under the last;
 *   - every row is full, so the rules of its cells meet in one line across
 *     the whole grid;
 *   - a gutter after every cell but the row's last;
 *   - the cells land where the browser's grid would put them.
 */

// The widths a detail grid is drawn at: phones, sm, md, lg and wide.
const WIDTHS_IN_PX: ReadonlyArray<number> = [
  320, 390, 639, 640, 768, 1023, 1024, 1280, 1920,
];

// How many columns the grid has at a width.
const columnsAt: (columns: number, width: number) => number = (
  columns: number,
  width: number,
): number => {
  const tiers: Array<DetailGridTier> = getDetailGridTiers(columns);
  let current: number = 1;

  for (const tier of tiers) {
    if (tier.prefix === "" || width >= breakpointOf(tier.prefix)) {
      current = tier.columns;
    }
  }

  return current;
};

const breakpointOf: (prefix: string) => number = (prefix: string): number => {
  if (prefix === "sm:") {
    return 640;
  }
  if (prefix === "lg:") {
    return 1024;
  }
  throw new Error(`Unexpected tier prefix ${prefix}`);
};

/*
 * The winning token of one utility family at a width: mobile first, a later
 * screen wins. Two tokens of the family at the same screen would be a
 * conflict the stylesheet order decides, which the layout must never write.
 */
const resolveToken: (
  className: string,
  width: number,
  isFamily: (utility: string) => boolean,
) => string | null = (
  className: string,
  width: number,
  isFamily: (utility: string) => boolean,
): string | null => {
  let winner: { utility: string; precedence: number } | null = null;

  for (const token of className.split(/\s+/).filter(Boolean)) {
    const parts: Array<string> = splitVariants(token);
    const utility: string = parts[parts.length - 1] as string;

    if (!isFamily(utility)) {
      continue;
    }

    const precedence: number | null = mediaPrecedenceOf(
      parts.slice(0, -1),
      width,
    );

    if (precedence === null) {
      continue;
    }

    if (winner && winner.precedence === precedence) {
      throw new Error(
        `"${className}" sets ${utility} and ${winner.utility} at the same width`,
      );
    }

    if (!winner || precedence > winner.precedence) {
      winner = { utility: utility, precedence: precedence };
    }
  }

  return winner ? winner.utility : null;
};

interface ResolvedCell {
  hasRule: boolean;
  paddingTop: number;
  paddingBottom: number;
  paddingRight: number;
  span: number;
}

const resolveCell: (className: string, width: number) => ResolvedCell = (
  className: string,
  width: number,
): ResolvedCell => {
  const border: string | null = resolveToken(
    className,
    width,
    (utility: string): boolean => {
      return utility === "border-t" || utility === "border-t-0";
    },
  );
  const span: string | null = resolveToken(
    className,
    width,
    (utility: string): boolean => {
      return utility.startsWith("col-span-");
    },
  );
  const padding: { top: number; bottom: number; right: number } =
    resolvePadding(className, width);

  return {
    hasRule: border === "border-t",
    paddingTop: padding.top,
    paddingBottom: padding.bottom,
    paddingRight: padding.right,
    span: span ? Number(span.replace("col-span-", "")) : 1,
  };
};

/*
 * A reference for where a browser's grid puts cells of these spans: an
 * occupancy grid filled by the sparse auto-placement algorithm - each cell
 * at the first slot from the cursor where its span fits in one row, the
 * cursor never moving back.
 */
const browserPlacement: (
  spans: ReadonlyArray<number>,
  columns: number,
) => Array<{ row: number; column: number }> = (
  spans: ReadonlyArray<number>,
  columns: number,
): Array<{ row: number; column: number }> => {
  const placed: Array<{ row: number; column: number }> = [];
  let cursorRow: number = 0;
  let cursorColumn: number = 0;

  for (const rawSpan of spans) {
    const span: number = Math.min(Math.max(1, rawSpan), columns);

    if (cursorColumn + span > columns) {
      cursorRow += 1;
      cursorColumn = 0;
    }

    placed.push({ row: cursorRow, column: cursorColumn });
    cursorColumn += span;
  }

  return placed;
};

const rowsOf: (
  placements: ReadonlyArray<DetailCellPlacement>,
) => Array<Array<number>> = (
  placements: ReadonlyArray<DetailCellPlacement>,
): Array<Array<number>> => {
  const rows: Array<Array<number>> = [];

  placements.forEach((placement: DetailCellPlacement, index: number): void => {
    rows[placement.row] = rows[placement.row] || [];
    rows[placement.row]!.push(index);
  });

  return rows;
};

/*
 * Everything the layout promises, for these spans in a grid of `columns`,
 * at every width - the same check the property sweep below runs on drawn
 * grids.
 */
const expectAlignedRows: (
  spans: ReadonlyArray<number | undefined>,
  columns: number,
) => void = (
  spans: ReadonlyArray<number | undefined>,
  columns: number,
): void => {
  const classNames: Array<string> = getDetailCellClassNames(spans, columns);

  expect(classNames).toHaveLength(spans.length);

  for (const width of WIDTHS_IN_PX) {
    const columnCount: number = columnsAt(columns, width);
    const placements: Array<DetailCellPlacement> = placeDetailCells(
      spans,
      columnCount,
    );
    const rows: Array<Array<number>> = rowsOf(placements);
    const resolved: Array<ResolvedCell> = classNames.map(
      (className: string): ResolvedCell => {
        return resolveCell(className, width);
      },
    );

    rows.forEach((row: Array<number>, rowIndex: number): void => {
      const first: ResolvedCell = resolved[row[0]!]!;
      const isFirstRow: boolean = rowIndex === 0;
      const isLastRow: boolean = rowIndex === rows.length - 1;

      // One row, one top: the same padding and the same rule (or none).
      for (const index of row) {
        const cell: ResolvedCell = resolved[index]!;
        const where: string = `cell ${index} of [${spans.join(",")}] in ${columns} columns at ${width}px`;

        expect({ where, top: cell.paddingTop }).toEqual({
          where,
          top: first.paddingTop,
        });
        expect({ where, rule: cell.hasRule }).toEqual({
          where,
          rule: !isFirstRow,
        });
        expect({ where, top: cell.paddingTop }).toEqual({
          where,
          top: isFirstRow ? 0 : 16,
        });
        expect({ where, bottom: cell.paddingBottom }).toEqual({
          where,
          bottom: isLastRow ? 0 : 16,
        });
      }

      // The row is full: its rule runs the whole width.
      const spanSum: number = row.reduce(
        (sum: number, index: number): number => {
          return sum + resolved[index]!.span;
        },
        0,
      );
      expect({ width, columns, row: rowIndex, spanSum }).toEqual({
        width,
        columns,
        row: rowIndex,
        spanSum: columnCount,
      });

      // A gutter after each cell but the row's last.
      row.forEach((index: number, position: number): void => {
        const isRowEnd: boolean = position === row.length - 1;
        expect({ width, index, gutter: resolved[index]!.paddingRight }).toEqual(
          { width, index, gutter: isRowEnd ? 0 : 24 },
        );
      });
    });
  }
};

describe("the column count", () => {
  test("is a whole number from 1 to 12", () => {
    expect(getDetailColumnCount(undefined)).toBe(1);
    expect(getDetailColumnCount(0)).toBe(1);
    expect(getDetailColumnCount(-3)).toBe(1);
    expect(getDetailColumnCount(Number.NaN)).toBe(1);
    expect(getDetailColumnCount(Number.POSITIVE_INFINITY)).toBe(1);
    expect(getDetailColumnCount(1)).toBe(1);
    expect(getDetailColumnCount(2)).toBe(2);
    expect(getDetailColumnCount(2.7)).toBe(2);
    expect(getDetailColumnCount(4)).toBe(4);
    expect(getDetailColumnCount(40)).toBe(MAX_DETAIL_COLUMNS);
  });

  test("a span is 1 up to the columns there are", () => {
    expect(getDetailCellSpan(undefined, 3)).toBe(1);
    expect(getDetailCellSpan(0, 3)).toBe(1);
    expect(getDetailCellSpan(-1, 3)).toBe(1);
    expect(getDetailCellSpan(2, 3)).toBe(2);
    expect(getDetailCellSpan(2.5, 3)).toBe(2);
    expect(getDetailCellSpan(5, 3)).toBe(3);
    expect(getDetailCellSpan(5, 1)).toBe(1);
  });
});

describe("the grid", () => {
  test("is one column on a phone, two from sm, and the rest only from lg", () => {
    expect(getDetailGridTiers(1)).toEqual([{ prefix: "", columns: 1 }]);
    expect(getDetailGridTiers(2)).toEqual([
      { prefix: "", columns: 1 },
      { prefix: "sm:", columns: 2 },
    ]);
    expect(getDetailGridTiers(3)).toEqual([
      { prefix: "", columns: 1 },
      { prefix: "sm:", columns: 2 },
      { prefix: "lg:", columns: 3 },
    ]);
    expect(getDetailGridTiers(4)).toEqual([
      { prefix: "", columns: 1 },
      { prefix: "sm:", columns: 2 },
      { prefix: "lg:", columns: 4 },
    ]);
  });

  test("draws its columns, and no gap: the gutter is inside each cell, so a row's rules meet", () => {
    expect(getDetailGridClassName(undefined)).toBe("grid grid-cols-1 w-full");
    expect(getDetailGridClassName(1)).toBe("grid grid-cols-1 w-full");
    expect(getDetailGridClassName(2)).toBe(
      "grid grid-cols-1 sm:grid-cols-2 w-full",
    );
    expect(getDetailGridClassName(3)).toBe(
      "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 w-full",
    );
    expect(getDetailGridClassName(4)).toBe(
      "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 w-full",
    );

    for (const columns of [1, 2, 3, 4, 6, 12]) {
      expect(getDetailGridClassName(columns)).not.toMatch(/\bgap-/);
    }
  });
});

describe("placing the cells", () => {
  test("the screenshot: Name and Email share the first row, Timezone fills the second", () => {
    expect(placeDetailCells([undefined, undefined, undefined], 2)).toEqual([
      {
        row: 0,
        column: 0,
        span: 1,
        isFirstRow: true,
        isLastRow: false,
        endsRow: false,
      },
      {
        row: 0,
        column: 1,
        span: 1,
        isFirstRow: true,
        isLastRow: false,
        endsRow: true,
      },
      {
        row: 1,
        column: 0,
        span: 2,
        isFirstRow: false,
        isLastRow: true,
        endsRow: true,
      },
    ]);
  });

  test("one column puts each cell in a row of its own", () => {
    const placements: Array<DetailCellPlacement> = placeDetailCells(
      [1, 1, 1, 1],
      1,
    );

    expect(
      placements.map((placement: DetailCellPlacement): number => {
        return placement.row;
      }),
    ).toEqual([0, 1, 2, 3]);
    expect(
      placements.every((placement: DetailCellPlacement): boolean => {
        return placement.span === 1 && placement.endsRow;
      }),
    ).toBe(true);
  });

  test("a cell too wide for what is left of a row starts the next, and the row it leaves is filled", () => {
    // Four columns: a, b, c, then d spans 2 and does not fit after c.
    const placements: Array<DetailCellPlacement> = placeDetailCells(
      [1, 1, 1, 2, 1],
      4,
    );

    expect(
      placements.map((placement: DetailCellPlacement) => {
        return [placement.row, placement.column, placement.span];
      }),
    ).toEqual([
      [0, 0, 1],
      [0, 1, 1],
      // c stretches over the column d could not take.
      [0, 2, 2],
      [1, 0, 2],
      // e fills what is left of the last row.
      [1, 2, 2],
    ]);
  });

  test("a span wider than the grid is the grid's width", () => {
    expect(placeDetailCells([5, 1], 2)).toEqual([
      {
        row: 0,
        column: 0,
        span: 2,
        isFirstRow: true,
        isLastRow: false,
        endsRow: true,
      },
      {
        row: 1,
        column: 0,
        span: 2,
        isFirstRow: false,
        isLastRow: true,
        endsRow: true,
      },
    ]);
  });

  test("seven fields in three columns: two full rows, and the last field fills the third", () => {
    const placements: Array<DetailCellPlacement> = placeDetailCells(
      [1, 1, 1, 1, 1, 1, 1],
      3,
    );

    expect(rowsOf(placements)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(placements[6]).toEqual({
      row: 2,
      column: 0,
      span: 3,
      isFirstRow: false,
      isLastRow: true,
      endsRow: true,
    });
  });

  test("no fields, no cells", () => {
    expect(placeDetailCells([], 3)).toEqual([]);
    expect(getDetailCellClassNames([], 3)).toEqual([]);
  });

  test("lands each cell where the browser's grid would (2,000 random grids)", () => {
    const random: SeededRandom = seededRandom(4316);

    for (let round: number = 0; round < 2000; round++) {
      const columns: number = 1 + random(6);
      const spans: Array<number> = Array.from(
        { length: random(14) },
        (): number => {
          return 1 + random(columns + 1);
        },
      );

      const placements: Array<DetailCellPlacement> = placeDetailCells(
        spans,
        columns,
      );
      const reference: Array<{ row: number; column: number }> =
        browserPlacement(spans, columns);

      expect(
        placements.map((placement: DetailCellPlacement) => {
          return { row: placement.row, column: placement.column };
        }),
      ).toEqual(reference);

      // Every row is full, and only its last cell ends it.
      for (const row of rowsOf(placements)) {
        const last: number = row[row.length - 1]!;
        const width: number = row.reduce(
          (sum: number, index: number): number => {
            return sum + placements[index]!.span;
          },
          0,
        );

        expect({ spans, columns, width }).toEqual({
          spans,
          columns,
          width: columns,
        });
        row.forEach((index: number): void => {
          expect(placements[index]!.endsRow).toBe(index === last);
        });
      }
    }
  });
});

describe("each cell's classes", () => {
  test("one column: a rule above every field but the first, and no padding under the last", () => {
    expect(
      getDetailCellClassNames([undefined, undefined, undefined], 1),
    ).toEqual([
      `${DETAIL_CELL_BASE_CLASS_NAME} pt-0 pb-4`,
      `${DETAIL_CELL_BASE_CLASS_NAME} border-t pt-4 pb-4`,
      `${DETAIL_CELL_BASE_CLASS_NAME} border-t pt-4 pb-0`,
    ]);
  });

  test("the screenshot's card: Name and Email level from sm up, Timezone across the second row", () => {
    expect(
      getDetailCellClassNames([undefined, undefined, undefined], 2),
    ).toEqual([
      `${DETAIL_CELL_BASE_CLASS_NAME} pt-0 pb-4 sm:pr-6`,
      `${DETAIL_CELL_BASE_CLASS_NAME} border-t pt-4 pb-4 sm:border-t-0 sm:pt-0`,
      `${DETAIL_CELL_BASE_CLASS_NAME} border-t pt-4 pb-0 sm:col-span-2`,
    ]);
  });

  test("every cell is min-w-0, so a long value wraps instead of widening its column", () => {
    for (const className of getDetailCellClassNames([1, 2, 1, 3], 4)) {
      expect(className.split(" ")).toContain("min-w-0");
      expect(className.split(" ")).toContain("border-gray-100");
    }
  });

  test("never writes the first/last trims that misaligned the rows, nor an inline width", () => {
    const random: SeededRandom = seededRandom(1717);

    for (let round: number = 0; round < 200; round++) {
      const columns: number = 1 + random(4);
      const spans: Array<number> = Array.from(
        { length: 1 + random(9) },
        (): number => {
          return 1 + random(3);
        },
      );

      for (const className of getDetailCellClassNames(spans, columns)) {
        expect(className).not.toMatch(/(^|\s)(first|last):/);
        expect(className).not.toMatch(/(^|\s)-?m[xy]?-/);
        expect(className).not.toContain("width");
      }
    }
  });

  test("rows line up and rules run the whole width, for the cards the pages draw", () => {
    // User Settings > Profile.
    expectAlignedRows([undefined, undefined, undefined], 2);
    // A one-column settings card.
    expectAlignedRows([undefined, undefined, undefined, undefined], 1);
    // An even two-column card.
    expectAlignedRows([1, 1, 1, 1], 2);
    // AI agent task: three columns.
    expectAlignedRows([1, 1, 1, 1, 1, 1, 1], 3);
    // Four columns with a wide description.
    expectAlignedRows([1, 1, 1, 1, 2, 1], 4);
    // A wide field first.
    expectAlignedRows([2, 1, 1], 2);
    // One field.
    expectAlignedRows([undefined], 3);
  });

  test("rows line up and rules run the whole width, for any card (500 random grids)", () => {
    const random: SeededRandom = seededRandom(2026);

    for (let round: number = 0; round < 500; round++) {
      const columns: number = 1 + random(5);
      const spans: Array<number | undefined> = Array.from(
        { length: 1 + random(10) },
        (): number | undefined => {
          const draw: number = random(columns + 2);
          return draw === 0 ? undefined : draw;
        },
      );

      expectAlignedRows(spans, columns);
    }
  });
});

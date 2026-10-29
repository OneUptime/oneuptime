import Column from "./Types/Column";
import FieldType from "../Types/FieldType";
import {
  TABLE_BODY_CELL_CLASS_NAME,
  TABLE_CELL_CONTENT_ALIGN_CLASS_NAME,
  TABLE_CELL_TEXT_CLASS_NAME,
  TABLE_CELL_MAX_WIDTH_CLASS_NAME,
  TABLE_CELL_TRUNCATE_CLASS_NAMES,
  TABLE_PRIMARY_CELL_TEXT_CLASS_NAME,
  TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME,
  TABLE_ROW_RULE_CLASS_NAME,
  TABLE_VALUE_GIVE_CLASS_NAME,
  TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME,
  getTableCellPaddingClassName,
  hasMaxWidthClassName,
  hasMinWidthClassName,
} from "./TableLayout";
import GenericObject from "../../../Types/GenericObject";

/*
 * Width cap for a cell that opts into wrapping without naming its own.
 *
 * 28rem is wide enough for a two-line status sentence and narrow enough that
 * one long message cannot starve the columns beside it.
 */
export const DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME: string = "max-w-md";

export interface TableCellClassNameOptions<T extends GenericObject> {
  column: Column<T>;
  /*
   * Compared against the RENDERED cells, not the declared columns: with any
   * column filtered out (hideOnMobile, permissions, the viewer's own layout)
   * the two differ, and the row's end padding would land on the wrong cell -
   * or on none.
   */
  isLastRenderedColumn: boolean;
  /*
   * The row's first cell: no drag grip and no select box before it. It
   * starts where the card's own text does. Absent means a grip or a box
   * comes first.
   */
  isFirstRenderedCell?: boolean | undefined;
  /*
   * The last row draws no rule under itself: the footer's own rule is right
   * there.
   */
  isLastRow?: boolean | undefined;
  /*
   * The row's first column (not counting a grip or a select box): the
   * record's name, in almost every list. Drawn a step heavier, in the
   * reading colour.
   */
  isPrimaryColumn?: boolean | undefined;
}

/**
 * The classes for one desktop body `<td>`.
 *
 * `whitespace-nowrap` is the default and is load-bearing for every date,
 * count, badge and actions cell in the product - it is what keeps
 * "12 Mar 2026, 4:05 pm" from folding onto two lines, in roughly two hundred
 * column declarations that have no layout coverage of their own. Columns that
 * hold prose opt out with `wrapContent`; see Types/Column.ts.
 *
 * The rest is the row's look (TableLayout): the reading size on a 24px
 * line, the padding that puts 24px between two columns and at the row's two
 * ends, and the hairline under every row but the last.
 */
export function getTableCellClassName<T extends GenericObject>(
  options: TableCellClassNameOptions<T>,
): string {
  const whitespaceClassName: string = options.column.wrapContent
    ? "whitespace-normal break-words"
    : "whitespace-nowrap";

  const classNames: Array<string> = [
    whitespaceClassName,
    getTableCellPaddingClassName({
      isFirst: Boolean(options.isFirstRenderedCell),
      isLast: options.isLastRenderedColumn,
    }),
    TABLE_BODY_CELL_CLASS_NAME,
    options.isPrimaryColumn && options.column.type !== FieldType.Actions
      ? TABLE_PRIMARY_CELL_TEXT_CLASS_NAME
      : TABLE_CELL_TEXT_CLASS_NAME,
  ];

  /*
   * The row's buttons sit at its end: the right in a left-to-right page,
   * the left in a right-to-left one (Persian).
   */
  if (options.column.type === FieldType.Actions) {
    classNames.push("text-end");
  }

  if (!options.isLastRow) {
    classNames.push(TABLE_ROW_RULE_CLASS_NAME);
  }

  return classNames.join(" ");
}

/*
 * Whether this column is the row's name that may use the room of a table
 * that fits (TableLayout's TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME): the
 * row's first column, on one line, under the table's own cap - a page that
 * measured its columns (a cap or a floor of its own) keeps its widths, and
 * a column of prose wraps as it always does.
 */
export function isFillingNameColumn<T extends GenericObject>(
  column: Column<T>,
  isPrimaryColumn: boolean | undefined,
): boolean {
  return Boolean(
    isPrimaryColumn &&
      column.type !== FieldType.Actions &&
      !column.wrapContent &&
      !hasMaxWidthClassName(column.contentClassName) &&
      !hasMinWidthClassName(column.contentClassName),
  );
}

/*
 * The kinds of value that are never cut short to make a table fit its card
 * (TABLE_VALUE_GIVE_CLASS_NAME): a date, a number, a tick, a colour - each
 * says what it says only whole. Nor by a person narrowing their column
 * (ColumnResize/ColumnWidths' ColumnWidthKind.Whole).
 */
export const VALUE_KINDS_KEPT_WHOLE: ReadonlyArray<FieldType> = [
  FieldType.Actions,
  FieldType.Date,
  FieldType.DateTime,
  FieldType.Number,
  FieldType.Percent,
  FieldType.Minutes,
  FieldType.USDCents,
  FieldType.Port,
  FieldType.Boolean,
  FieldType.Color,
  FieldType.Icon,
];

/*
 * Whether this column's values may be cut short a little more when their
 * table would otherwise run past its card (useTableScrollState's second
 * reading): one-line values under the table's own cap, in any column but
 * the row's name (which has its own way of giving room,
 * isFillingNameColumn), a column of prose (which wraps), a column a page
 * sized itself, and the kinds kept whole.
 */
export function isGivingValueColumn<T extends GenericObject>(
  column: Column<T>,
  isPrimaryColumn: boolean | undefined,
): boolean {
  return Boolean(
    !isPrimaryColumn &&
      !VALUE_KINDS_KEPT_WHOLE.includes(column.type) &&
      !column.wrapContent &&
      !hasMaxWidthClassName(column.contentClassName) &&
      !hasMinWidthClassName(column.contentClassName),
  );
}

/**
 * The classes for the `<div>` that wraps a cell's content.
 *
 * A wrapping column gets its width cap HERE, on the `<td>`'s direct child,
 * never on the `<td>` itself: CSS leaves the effect of `max-width` on a
 * table-cell box undefined and browsers ignore it, while a max-width on a
 * block child DOES cap the column's contribution under `table-layout:
 * auto` - which is what Table.tsx renders.
 *
 * Every other column but Actions is capped too, at TABLE_CELL_MAX_WIDTH, and
 * ALWAYS together with a clip and an ellipsis (TableLayout): a long name or
 * title is cut short on its one line, and shown in full under the pointer
 * (TableRow), rather than widening the table past the card. A cap on a
 * line that does not wrap without the clip is what painted a sentence over
 * its neighbours in #3585, so the two are only ever written together, here.
 * A column that names its own cap in contentClassName keeps it, clipped the
 * same way.
 */
export function getTableCellContentClassName<T extends GenericObject>(
  column: Column<T>,
  options?: { isPrimaryColumn?: boolean | undefined } | undefined,
): string {
  const classNames: Array<string> = [];

  if (column.type === FieldType.Actions) {
    return column.contentClassName || "";
  }

  if (column.wrapContent) {
    classNames.push(
      column.wrapMaxWidthClassName || DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME,
    );

    // The table's floor, unless the column names its own.
    if (!hasMinWidthClassName(column.contentClassName)) {
      classNames.push(TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME);
    }
  } else {
    if (!hasMaxWidthClassName(column.contentClassName)) {
      classNames.push(TABLE_CELL_MAX_WIDTH_CLASS_NAME);

      /*
       * ...which the row's name loses while the table fits its card, taking
       * the room the row has (TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME).
       */
      if (isFillingNameColumn(column, options?.isPrimaryColumn)) {
        classNames.push(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME);
      }

      // ...and any other value gives way before the rows scroll sideways.
      if (isGivingValueColumn(column, options?.isPrimaryColumn)) {
        classNames.push(TABLE_VALUE_GIVE_CLASS_NAME);
      }
    }

    classNames.push(TABLE_CELL_TRUNCATE_CLASS_NAMES);
  }

  classNames.push(TABLE_CELL_CONTENT_ALIGN_CLASS_NAME);

  if (column.contentClassName) {
    classNames.push(column.contentClassName);
  }

  return classNames.join(" ");
}

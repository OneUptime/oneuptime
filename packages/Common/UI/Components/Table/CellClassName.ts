import Column from "./Types/Column";
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
   * Compared against the RENDERED column count, not the declared one: with
   * any column filtered out (hideOnMobile, permissions, the viewer's own
   * layout) the two differ, and the extra right padding would land on the
   * wrong cell - or on none.
   */
  isLastRenderedColumn: boolean;
}

/**
 * The classes for one desktop body `<td>`.
 *
 * `whitespace-nowrap` is the default and is load-bearing for every date,
 * count, badge and actions cell in the product - it is what keeps
 * "12 Mar 2026, 4:05 pm" from folding onto two lines, in roughly two hundred
 * column declarations that have no layout coverage of their own. Columns that
 * hold prose opt out with `wrapContent`; see Types/Column.ts for why a
 * max-width alone does not work and in fact makes the overlap worse
 * (OneUptime issue #3585).
 *
 * For a column that declares no wrapping this returns the exact string the
 * two cell renderers hard-coded before it existed, character for character.
 */
export function getTableCellClassName<T extends GenericObject>(
  options: TableCellClassNameOptions<T>,
): string {
  const whitespaceClassName: string = options.column.wrapContent
    ? "whitespace-normal break-words"
    : "whitespace-nowrap";

  const paddingRightClassName: string = options.isLastRenderedColumn
    ? "pr-6"
    : "pr-3";

  return `${whitespaceClassName} py-4 pl-4 ${paddingRightClassName} text-sm font-medium text-gray-500 sm:pl-6 align-top`;
}

/**
 * The classes for the `<div>` that wraps a cell's content.
 *
 * Empty for a column that asks for nothing, which is the overwhelming
 * majority - deliberately, so neither the DOM nor a single class shifts for a
 * column that declares neither option.
 *
 * A wrapping column always gets its width cap HERE, on the `<td>`'s direct
 * child, never on the `<td>` itself: CSS leaves the effect of `max-width` on
 * a table-cell box undefined and browsers ignore it, while a max-width on a
 * block child DOES cap the column's max-content contribution under
 * `table-layout: auto` - which is what Table.tsx renders, its `<table>`
 * carrying no table-layout utility.
 */
export function getTableCellContentClassName<T extends GenericObject>(
  column: Column<T>,
): string {
  const classNames: Array<string> = [];

  if (column.wrapContent) {
    classNames.push(
      column.wrapMaxWidthClassName || DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME,
    );
  }

  if (column.contentClassName) {
    classNames.push(column.contentClassName);
  }

  return classNames.join(" ");
}

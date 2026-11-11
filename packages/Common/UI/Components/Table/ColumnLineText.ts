import Column from "./Types/Column";
import GenericObject from "../../../Types/GenericObject";

/*
 * THE WORDS AN ELEMENT COLUMN DRAWS ON ITS LINE.
 *
 * A cell reads its line the way its words do when that is not the page's
 * way (TableRow's getCellLineDirection): an English name on an Arabic page
 * reads left to right, and when it is too long it is cut at its own end,
 * with its "..." there. A plain value's words are its value. A column that
 * draws an element - a record's name drawn as a link or a badge - names
 * them itself (Column.getLineText); without them its cell kept the page's
 * way, and on an Arabic page an English incident title lost its start
 * ("...latency" for "Checkout API latency").
 *
 * A record's own name is the column most lists open with, drawn as a link
 * in nearly all of them. So a column on a record's name or title field
 * that draws an element reads that field's value as its words when it
 * names none of its own: a new list of names is right without anyone
 * remembering to say so. getLineText still wins - for an element that
 * shows other words than the field (a computed name, a translated title),
 * and for one that lays out more than one line, or a mark or a badge beside
 * the name (drawsItsOwnLines): one way for the whole cell would turn the
 * page's own words beside the name the wrong way round.
 *
 * Only the words decide the way the line reads. Sorting, searching and the
 * CSV export still read the column's field (key, getExportValue).
 */

// A record's own name: the fields whose value a name column draws.
export const NAME_FIELD_KEYS: ReadonlyArray<string> = ["name", "title"];

export const isNameFieldKey: (key: unknown) => boolean = (
  key: unknown,
): boolean => {
  return typeof key === "string" && NAME_FIELD_KEYS.includes(key);
};

/*
 * The words a column that draws its own element shows on its line: what
 * getLineText says, when the column says; the row's name or title, when
 * the column is on that field; none otherwise (the cell keeps the page's
 * way).
 */
export function getElementLineText<T extends GenericObject>(
  column: Column<T>,
  item: T,
): string | undefined {
  if (column.getLineText) {
    return column.getLineText(item) || undefined;
  }

  if (!isNameFieldKey(column.key)) {
    return undefined;
  }

  const value: unknown = item[column.key as keyof T];

  return typeof value === "string" && value.trim() ? value : undefined;
}

/*
 * getLineText for a column whose element lays out its own lines: a mark or
 * a badge beside the name, a line of the page's own words under it, or
 * lines that each already read their own way (IsolatedLine, IsolatedText).
 * Its cell keeps the page's way, so those keep their order; the element
 * gives the name its own way where it draws it.
 */
export const drawsItsOwnLines: () => undefined = (): undefined => {
  return undefined;
};

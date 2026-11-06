import { JSONObject } from "../JSON";

/*
 * A PROJECT'S DEFAULT COLUMNS FOR ITS LISTS (Project.defaultTableColumns).
 *
 * Which columns a list shows, and in what order, is first each person's
 * own (ModelTable/ColumnPreference, kept in their browser). A Project Owner
 * or Admin can make a layout the project's own for a list - Customize
 * Columns, "Show these columns to everyone in this project" - and everyone
 * who has not chosen columns of their own for that list sees it. Whoever
 * has, keeps theirs; Reset to default brings them back to the project's.
 *
 * Kept on the project, as one object: a list's key (a ModelTable's
 * userPreferencesKey, "incidents-table") to its layout - the columns' ids
 * in the order they are drawn, and the ids of those switched off, as the
 * person's own layout is kept. It comes with the project the Dashboard
 * reads as it starts (ProjectAPI's list-user-projects), so a list draws the
 * project's columns from its first paint, with no read of its own.
 *
 * Whatever is stored is read as untrusted: a layout written by hand, by an
 * older version, or naming columns a list no longer has. The server keeps
 * only what reads as a layout (getProblem refuses the rest, parse tidies
 * it), and each list keeps only the ids of columns it has.
 *
 * React-free and server-free: the Dashboard and the server read it alike.
 */

export interface TableColumnLayout {
  // Column ids in the order they are drawn.
  order: Array<string>;
  // Column ids switched off.
  hidden: Array<string>;
}

// A list's key to its layout.
export type DefaultTableColumns = Record<string, TableColumnLayout>;

// The most lists a project keeps default columns for.
export const MAX_DEFAULT_TABLE_COLUMNS_TABLES: number = 500;

// The longest key a list is known by (a ModelTable's userPreferencesKey).
export const MAX_TABLE_KEY_LENGTH: number = 200;

// The most column ids one layout names, in each of its two lists.
export const MAX_TABLE_LAYOUT_COLUMN_IDS: number = 300;

/*
 * The longest column id: a column's field, a custom field's or an
 * attribute's key (getColumnIds), with a title to tell two apart.
 */
export const MAX_TABLE_COLUMN_ID_LENGTH: number = 300;

const isPlainObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export class DefaultTableColumnsUtil {
  /*
   * Why a value cannot be stored as a project's default columns, or null
   * when it can: null (none), or an object of lists' keys to layouts, each
   * an `order` and a `hidden` list of column ids, within the limits above.
   */
  public static getProblem(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (!isPlainObject(value)) {
      return "Default table columns must be an object of lists to their columns.";
    }

    const keys: Array<string> = Object.keys(value);

    if (keys.length > MAX_DEFAULT_TABLE_COLUMNS_TABLES) {
      return `Default table columns can be kept for at most ${MAX_DEFAULT_TABLE_COLUMNS_TABLES} lists.`;
    }

    for (const key of keys) {
      if (key.trim().length === 0 || key.length > MAX_TABLE_KEY_LENGTH) {
        return `A list's key must be 1 to ${MAX_TABLE_KEY_LENGTH} characters long.`;
      }

      const layout: unknown = value[key];

      if (!isPlainObject(layout)) {
        return `The default columns of ${key} must be an object with order and hidden.`;
      }

      for (const listName of ["order", "hidden"]) {
        const ids: unknown = layout[listName];

        if (ids === undefined) {
          continue;
        }

        if (!Array.isArray(ids)) {
          return `The ${listName} of ${key}'s default columns must be a list of column ids.`;
        }

        if (ids.length > MAX_TABLE_LAYOUT_COLUMN_IDS) {
          return `The ${listName} of ${key}'s default columns can name at most ${MAX_TABLE_LAYOUT_COLUMN_IDS} columns.`;
        }

        for (const id of ids) {
          if (
            typeof id !== "string" ||
            id.length === 0 ||
            id.length > MAX_TABLE_COLUMN_ID_LENGTH
          ) {
            return `Each column id in ${key}'s default columns must be text of 1 to ${MAX_TABLE_COLUMN_ID_LENGTH} characters.`;
          }
        }
      }
    }

    return null;
  }

  /*
   * One layout read back: its two lists of ids, each id once; null when it
   * is not a layout, or names nothing (which changes nothing).
   */
  public static parseLayout(value: unknown): TableColumnLayout | null {
    if (!isPlainObject(value)) {
      return null;
    }

    const readIds: (ids: unknown) => Array<string> = (
      ids: unknown,
    ): Array<string> => {
      if (!Array.isArray(ids)) {
        return [];
      }

      const seen: Set<string> = new Set();

      return ids
        .filter((id: unknown): id is string => {
          if (
            typeof id !== "string" ||
            id.length === 0 ||
            id.length > MAX_TABLE_COLUMN_ID_LENGTH ||
            seen.has(id)
          ) {
            return false;
          }

          seen.add(id);
          return true;
        })
        .slice(0, MAX_TABLE_LAYOUT_COLUMN_IDS);
    };

    const layout: TableColumnLayout = {
      order: readIds(value["order"]),
      hidden: readIds(value["hidden"]),
    };

    if (layout.order.length === 0 && layout.hidden.length === 0) {
      return null;
    }

    return layout;
  }

  /*
   * A stored value read back: every list's layout that reads as one, by a
   * key a list could have; null when there is none. Anything else - a value
   * written by hand, an empty layout - is left out rather than refused.
   */
  public static parse(value: unknown): DefaultTableColumns | null {
    if (!isPlainObject(value)) {
      return null;
    }

    const parsed: DefaultTableColumns = {};
    let count: number = 0;

    for (const key of Object.keys(value)) {
      if (count >= MAX_DEFAULT_TABLE_COLUMNS_TABLES) {
        break;
      }

      if (key.trim().length === 0 || key.length > MAX_TABLE_KEY_LENGTH) {
        continue;
      }

      const layout: TableColumnLayout | null =
        DefaultTableColumnsUtil.parseLayout(value[key]);

      if (layout) {
        parsed[key] = layout;
        count++;
      }
    }

    return count > 0 ? parsed : null;
  }

  // One list's default columns, or null where the project keeps none.
  public static getLayout(
    value: unknown,
    tableKey: string,
  ): TableColumnLayout | null {
    if (!isPlainObject(value) || !tableKey) {
      return null;
    }

    return DefaultTableColumnsUtil.parseLayout(value[tableKey]);
  }

  /*
   * The project's default columns with one list's set - or, with null,
   * taken away - every other list's as they were. null when no list keeps
   * any: the column is cleared.
   */
  public static withLayout(data: {
    value: unknown;
    tableKey: string;
    layout: TableColumnLayout | null;
  }): DefaultTableColumns | null {
    const current: DefaultTableColumns =
      DefaultTableColumnsUtil.parse(data.value) || {};
    const next: DefaultTableColumns = { ...current };
    const layout: TableColumnLayout | null = data.layout
      ? DefaultTableColumnsUtil.parseLayout(data.layout)
      : null;

    if (layout) {
      next[data.tableKey] = layout;
    } else {
      delete next[data.tableKey];
    }

    // Past the limit, the server says so (getProblem), rather than one dropped unseen.
    return Object.keys(next).length > 0 ? next : null;
  }

  // As the column stores it.
  public static toJSON(value: DefaultTableColumns | null): JSONObject | null {
    if (!value) {
      return null;
    }

    const json: JSONObject = {};

    for (const key of Object.keys(value)) {
      const layout: TableColumnLayout = value[key] as TableColumnLayout;

      json[key] = { order: [...layout.order], hidden: [...layout.hidden] };
    }

    return json;
  }
}

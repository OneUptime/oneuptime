import AnalyticsTableColumnType from "../AnalyticsDatabase/TableColumnType";
import { TableColumnMetadata } from "../Database/TableColumn";
import TableColumnType from "../Database/TableColumnType";
import { JSONValue } from "../JSON";

/*
 * A paid feature can always be switched off, on any plan.
 *
 * A column marked @ColumnBillingAccessControl holds a feature a plan sells:
 * a status page's email reports, a public dashboard, a private status page,
 * its custom HTML, an IP allowlist, a retention override. Writing it needs
 * the plan the decorator names - except for one value: the column's
 * default, what a record holds when nobody has set it. That is the feature
 * off, and every plan has it already: a record created on any plan starts
 * with it. So putting a plan-gated column back to its default never needs a
 * plan, and a project whose trial ended, or that moved to a lower plan, can
 * always switch off what it can no longer switch on. Switching the feature
 * on - writing anything else - still needs the plan.
 *
 * The default is the one the column declares (@TableColumn defaultValue,
 * which matches the database default: a guard test holds every plan-gated
 * column to that). A column that declares none holds nothing until it is
 * set - null - and for a text column the empty string is nothing too: every
 * reader of these columns treats it as nothing set (no allowlist, no custom
 * code, no token). A switch with no declared default is off when it holds
 * nothing, so false is its default as well, as the dashboard's switches read
 * it (ModelSwitchUtil.getColumnBooleanDefault).
 *
 * The comparison is exact. A value of another type ("false" for false, "14"
 * for 14) or a blank line where nothing is expected is not the default, and
 * keeps needing the plan: an unclear value never gets a plan's feature for
 * free.
 *
 * The server's column checks (ColumnPermission for database models, and
 * AnalyticsDatabase/ModelPermission for analytics models, through
 * isAnalyticsPlanGatedColumnDefault - for creates and updates) and the
 * dashboard's plan notes (ModelSwitchUtil.getPlanNeededToWriteColumn) all
 * ask this, so the dashboard offers exactly the moves the server allows.
 */

/*
 * Columns whose empty string means nothing set. Only text a person types:
 * an empty string in a number or date column is not a value at all.
 */
export const EMPTY_TEXT_COLUMN_TYPES: ReadonlyArray<TableColumnType> = [
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.VeryLongText,
  TableColumnType.HTML,
  TableColumnType.CSS,
  TableColumnType.JavaScript,
  TableColumnType.Markdown,
  TableColumnType.Description,
];

// Two JSON values that hold the same thing, keys in any order.
const isSameJsonValue: (left: unknown, right: unknown) => boolean = (
  left: unknown,
  right: unknown,
): boolean => {
  if (left === right) {
    return true;
  }

  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }

  // Only plain data: a class instance (a Date, an ObjectID) is not JSON.
  const isPlain: (value: unknown) => boolean = (value: unknown): boolean => {
    const prototype: unknown = Object.getPrototypeOf(value);
    return (
      Array.isArray(value) ||
      prototype === Object.prototype ||
      prototype === null
    );
  };

  if (!isPlain(left) || !isPlain(right)) {
    return false;
  }

  const leftKeys: Array<string> = Object.keys(left);
  const rightKeys: Array<string> = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key: string): boolean => {
    return (
      Object.prototype.hasOwnProperty.call(right, key) &&
      isSameJsonValue(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      )
    );
  });
};

/*
 * Whether a value written to a column is the column's default - the plan
 * feature it holds switched off (see the top of this file). False for a
 * column with no metadata, and for a value that is not written (undefined).
 */
export const isPlanGatedColumnDefault: (
  metadata: TableColumnMetadata | null | undefined,
  value: unknown,
) => boolean = (
  metadata: TableColumnMetadata | null | undefined,
  value: unknown,
): boolean => {
  if (!metadata || value === undefined) {
    return false;
  }

  const defaultValue: unknown = metadata.defaultValue;

  if (defaultValue === undefined || defaultValue === null) {
    if (value === null) {
      return true;
    }

    if (metadata.type === TableColumnType.Boolean) {
      return value === false;
    }

    return value === "" && EMPTY_TEXT_COLUMN_TYPES.includes(metadata.type);
  }

  return isSameJsonValue(defaultValue, value);
};

/*
 * The same rule for a column of an analytics (ClickHouse) model, which the
 * analytics column check (AnalyticsDatabase/ModelPermission) asks as
 * ColumnPermission asks isPlanGatedColumnDefault: its declared default is
 * its default; without one, nothing (null) is, and so is false for a
 * switch and the empty string for text. No analytics column is plan-gated
 * today; the first one switches off the way a database column does.
 */
export const isAnalyticsPlanGatedColumnDefault: (
  column:
    | { type: AnalyticsTableColumnType; defaultValue: JSONValue | undefined }
    | null
    | undefined,
  value: unknown,
) => boolean = (
  column:
    | { type: AnalyticsTableColumnType; defaultValue: JSONValue | undefined }
    | null
    | undefined,
  value: unknown,
): boolean => {
  if (!column) {
    return false;
  }

  /*
   * Only what the rule above reads of a database column: whether it is a
   * switch, text, or neither.
   */
  const type: TableColumnType =
    column.type === AnalyticsTableColumnType.Boolean
      ? TableColumnType.Boolean
      : column.type === AnalyticsTableColumnType.Text
        ? TableColumnType.ShortText
        : TableColumnType.JSON;

  return isPlanGatedColumnDefault(
    {
      type,
      defaultValue:
        column.defaultValue === undefined || column.defaultValue === null
          ? undefined
          : (column.defaultValue as TableColumnMetadata["defaultValue"]),
    },
    value,
  );
};

/*
 * Whether a value READ from a column leaves the feature it holds off: its
 * default, or nothing stored at all (null, or not read), which every reader
 * of these columns takes for the default. For a page that asks whether a
 * plan feature is still on, as opposed to whether a write needs a plan.
 */
export const isPlanGatedColumnOff: (
  metadata: TableColumnMetadata | null | undefined,
  value: unknown,
) => boolean = (
  metadata: TableColumnMetadata | null | undefined,
  value: unknown,
): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  return isPlanGatedColumnDefault(metadata, value);
};

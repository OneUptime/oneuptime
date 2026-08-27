import { AggregateRow } from "./AggregateBy";

/*
 * Reading values back out of an aggregate row.
 *
 * Postgres returns COUNT and SUM as `bigint`/`numeric`, and node-postgres
 * hands those to JavaScript as STRINGS rather than numbers — a bigint does not
 * fit a double in the general case, so parsing it for you would be lossy. Every
 * `counts.devicesDown` in the product would otherwise be a string that renders
 * fine, compares wrong ("10" < "9"), and adds by concatenating.
 *
 * So aggregate rows are read through here, never indexed into directly.
 */
export default class AggregateResultUtil {
  /**
   * A count/sum column as a number. Missing, NULL and unparseable all read as
   * `0` — an aggregate over no rows is genuinely zero, and `SUM` of an empty
   * set is NULL rather than 0 in SQL.
   */
  public static toNumber(
    row: AggregateRow | undefined | null,
    alias: string,
  ): number {
    if (!row) {
      return 0;
    }

    const value: string | number | boolean | Date | null | undefined =
      row[alias];

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    if (typeof value === "string") {
      const parsed: number = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  /**
   * A boolean column. Postgres booleans arrive as real booleans, but a boolean
   * that travelled through a CASE or a cast can arrive as "t"/"true"/"1".
   */
  public static toBoolean(
    row: AggregateRow | undefined | null,
    alias: string,
  ): boolean {
    if (!row) {
      return false;
    }

    const value: string | number | boolean | Date | null | undefined =
      row[alias];

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return value === "t" || value === "true" || value === "1";
    }

    if (typeof value === "number") {
      return value === 1;
    }

    return false;
  }

  /**
   * A nullable boolean column — a three-state column like `isReachable`, where
   * NULL is a distinct answer ("never polled") and must not collapse to false.
   */
  public static toNullableBoolean(
    row: AggregateRow | undefined | null,
    alias: string,
  ): boolean | null {
    if (!row) {
      return null;
    }

    const value: string | number | boolean | Date | null | undefined =
      row[alias];

    if (value === null || value === undefined) {
      return null;
    }

    return AggregateResultUtil.toBoolean(row, alias);
  }

  /**
   * A text/uuid column, or `null`. The empty string reads as `null` too: a
   * grouped id column is only ever a real id or absent.
   */
  public static toStringOrNull(
    row: AggregateRow | undefined | null,
    alias: string,
  ): string | null {
    if (!row) {
      return null;
    }

    const value: string | number | boolean | Date | null | undefined =
      row[alias];

    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return String(value);
  }
}

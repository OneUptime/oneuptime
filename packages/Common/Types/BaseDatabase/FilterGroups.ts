import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import { refusedValue } from "../../Utils/RefusedValue";
import EqualTo from "./EqualTo";
import EqualToOrNull from "./EqualToOrNull";
import Includes from "./Includes";
import IncludesNoneOrNull from "./IncludesNoneOrNull";
import IsNull from "./IsNull";
import NotEqual from "./NotEqual";
import NotEqualOrNull from "./NotEqualOrNull";
import NotNull from "./NotNull";
import QueryOperator from "./QueryOperator";

/*
 * THE RECORDS ONE OF SEVERAL FILTERS MATCHES, AS ONE FILTER (#11211).
 *
 * A query is a list of conditions ANDed by column, so it cannot ask for the
 * records that match one filter OR another. A status read from two columns
 * needs exactly that: a database's engine metrics are Connected when its
 * collector says so, Disconnected when one reported and stopped, Not
 * connected when none ever did - and "Connected or Not connected" is a
 * condition on one column OR on the other. The lists that offered such a
 * status read the ids of each status's records first - the first 10,000 -
 * and filtered by those ids, so a status with more records than that showed
 * only some of them, and said nothing.
 *
 *   { filterGroups: new FilterGroups({ groups: [
 *       { otelCollectorStatus: "connected" },
 *       { otelCollectorStatus: new NotEqualOrNull("connected"),
 *         collectorLastSeenAt: new IsNull() } ] }) }
 *   { "filterGroups": { "_type": "FilterGroups", "match": "AnyOf",
 *                       "groups": [ { "otelCollectorStatus": "connected" },
 *                                   { ... } ] } }
 *
 * Each group is a filter on the record's own columns, its conditions ANDed;
 * the groups are OR'd (AnyOf), or none of them may match (NoneOf: the
 * records no group matches, an empty column included - a list's "is not").
 * The server answers it inside the one query that lists the records, as
 * one condition on their rows (QueryUtil.serializeQuery), so a filtered list
 * pages, counts and sorts as any other, however many records match. Each
 * column a group names is held to the caller's read of it, as a filter on
 * the column itself is (QueryPermission).
 *
 * A group compares a column with a value - text, a number, a switch, an id
 * - or with one of the operators below. It never reaches a related record,
 * a JSON column, or another filter of this kind: what it may ask is what
 * the server can write as one condition on the row.
 */
export enum FilterGroupsMatch {
  // At least one group matches.
  AnyOf = "AnyOf",
  // No group matches.
  NoneOf = "NoneOf",
}

// The key every query in OneUptime puts the filter under.
export const FILTER_GROUPS_QUERY_KEY: string = "filterGroups";

// The most groups one filter holds.
export const MAX_FILTER_GROUPS: number = 32;

// The most columns one group names.
export const MAX_FILTER_GROUP_COLUMNS: number = 16;

// A column of the record, named as its model names it.
const COLUMN_NAME: RegExp = /^[A-Za-z][A-Za-z0-9]*$/;

// The operators a group may compare a column with.
const GROUP_OPERATORS: ReadonlyArray<{ new (...args: Array<any>): unknown }> = [
  EqualTo,
  EqualToOrNull,
  NotEqual,
  NotEqualOrNull,
  IsNull,
  NotNull,
  Includes,
  IncludesNoneOrNull,
];

// What a group compares one column with.
export type FilterGroupValue =
  | string
  | number
  | boolean
  | ObjectID
  | QueryOperator<any>;

// One group: its columns, each with what it must hold.
export type FilterGroup = Record<string, FilterGroupValue>;

export interface FilterGroupsData {
  groups: Array<FilterGroup | Record<string, unknown>>;
  match?: FilterGroupsMatch | undefined;
}

export default class FilterGroups extends QueryOperator<string> {
  private readonly _groups: Array<FilterGroup>;
  private readonly _match: FilterGroupsMatch;

  public constructor(data: FilterGroupsData) {
    super();

    const match: FilterGroupsMatch = data.match || FilterGroupsMatch.AnyOf;

    if (!Object.values(FilterGroupsMatch).includes(match)) {
      throw new BadDataException(
        `Invalid match for "${FILTER_GROUPS_QUERY_KEY}" in the query: ${JSON.stringify(
          refusedValue(match),
        )}. It is one of ${Object.values(FilterGroupsMatch).join(", ")}.`,
      );
    }

    if (!Array.isArray(data.groups) || data.groups.length === 0) {
      throw new BadDataException(
        `"${FILTER_GROUPS_QUERY_KEY}" in the query holds at least one group of filters.`,
      );
    }

    if (data.groups.length > MAX_FILTER_GROUPS) {
      throw new BadDataException(
        `"${FILTER_GROUPS_QUERY_KEY}" holds at most ${MAX_FILTER_GROUPS} groups.`,
      );
    }

    this._groups = data.groups.map(
      (group: FilterGroup | Record<string, unknown>, index: number) => {
        return FilterGroups.toGroup(group, index);
      },
    );
    this._match = match;
  }

  // Each group, a copy: its columns, each with what it must hold.
  public get groups(): Array<FilterGroup> {
    return this._groups.map((group: FilterGroup): FilterGroup => {
      return { ...group };
    });
  }

  public get match(): FilterGroupsMatch {
    return this._match;
  }

  // Every column a group names, each once, in the order they are named.
  public get columns(): Array<string> {
    const columns: Array<string> = [];

    for (const group of this._groups) {
      for (const column of Object.keys(group)) {
        if (!columns.includes(column)) {
          columns.push(column);
        }
      }
    }

    return columns;
  }

  public override toString(): string {
    return JSON.stringify(this.toJSON());
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.FilterGroups,
      match: this._match,
      groups: this._groups.map((group: FilterGroup): JSONObject => {
        return JSONFunctions.serialize(group as unknown as JSONObject);
      }),
    };
  }

  public static override fromJSON(json: JSONObject): FilterGroups {
    if (json["_type"] !== ObjectType.FilterGroups) {
      throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }

    const groups: unknown = json["groups"];

    if (!Array.isArray(groups)) {
      throw new BadDataException(
        `"${FILTER_GROUPS_QUERY_KEY}" in the query holds at least one group of filters.`,
      );
    }

    return new FilterGroups({
      match: (json["match"] as FilterGroupsMatch | undefined) || undefined,
      groups: groups.map((group: unknown, index: number): FilterGroup => {
        if (!FilterGroups.isPlainObject(group)) {
          throw FilterGroups.getNotAGroupException(index);
        }

        return JSONFunctions.deserialize(
          group as JSONObject,
        ) as unknown as FilterGroup;
      }),
    });
  }

  /*
   * One group as it is kept: a plain object naming 1 to
   * MAX_FILTER_GROUP_COLUMNS columns, each compared with a value or an
   * operator a group may hold - or refused, with what was wrong.
   */
  private static toGroup(group: unknown, index: number): FilterGroup {
    if (!FilterGroups.isPlainObject(group)) {
      throw FilterGroups.getNotAGroupException(index);
    }

    const columns: Array<string> = Object.keys(group);

    if (columns.length === 0) {
      throw new BadDataException(
        `Group ${index + 1} of "${FILTER_GROUPS_QUERY_KEY}" in the query names no column.`,
      );
    }

    if (columns.length > MAX_FILTER_GROUP_COLUMNS) {
      throw new BadDataException(
        `A group of "${FILTER_GROUPS_QUERY_KEY}" names at most ${MAX_FILTER_GROUP_COLUMNS} columns.`,
      );
    }

    const kept: FilterGroup = {};

    for (const column of columns) {
      if (!COLUMN_NAME.test(column)) {
        throw new BadDataException(
          `Invalid column for "${FILTER_GROUPS_QUERY_KEY}" in the query: ${JSON.stringify(
            refusedValue(column),
          )}. A column is one of the record's own, such as "name".`,
        );
      }

      const value: unknown = (group as Record<string, unknown>)[column];

      if (!FilterGroups.isGroupValue(value)) {
        throw new BadDataException(
          `"${column}" of "${FILTER_GROUPS_QUERY_KEY}" in the query compares the column with a value (text, a number, true or false, an ID) or with EqualTo, EqualToOrNull, NotEqual, NotEqualOrNull, IsNull, NotNull, Includes or IncludesNoneOrNull.`,
        );
      }

      kept[column] = value;
    }

    return kept;
  }

  // What a group may compare a column with.
  private static isGroupValue(value: unknown): value is FilterGroupValue {
    if (typeof value === "string" || typeof value === "boolean") {
      return true;
    }

    if (typeof value === "number") {
      return Number.isFinite(value);
    }

    if (value instanceof ObjectID) {
      return true;
    }

    return GROUP_OPERATORS.some(
      (operator: { new (...args: Array<any>): unknown }): boolean => {
        return value instanceof operator;
      },
    );
  }

  private static isPlainObject(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }

  private static getNotAGroupException(index: number): BadDataException {
    return new BadDataException(
      `Group ${index + 1} of "${FILTER_GROUPS_QUERY_KEY}" in the query is a filter: each column with what it must hold.`,
    );
  }
}

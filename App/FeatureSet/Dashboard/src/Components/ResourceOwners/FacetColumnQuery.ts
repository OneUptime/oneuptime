import { FilterOperator } from "./FilterChipDropdownTypes";
import { ResourceFacet } from "./ResourceFacet";
import { buildFacetDateRangeQuery } from "./FacetDateRange";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";

/*
 * What one chip writes into the outgoing query.
 *
 * Lifted out of useResourceOwners' merge loop so the two rules that are easy
 * to get wrong and impossible to see going wrong can be pinned in tests:
 *
 *  - two chips over the same query field must not silently replace each other
 *    (a facet says so with `mergeQueryValue`), and
 *
 *  - "is empty" writes IsNull *at the field* — which is wrong for a chip over
 *    one key inside a JSON column, so those chips opt out with
 *    `handlesValuelessOperators` and build the predicate themselves.
 *
 * Both failures look identical from the outside: a chip lit over a list it is
 * not filtering.
 */

/**
 * Default query value for a facet that supplies no `toQueryValue`. Handles
 * is / is_not / is_empty / is_not_empty for raw-string fields.
 */
export type DefaultFacetQueryValueFunction = (
  values: Array<string>,
  operator: FilterOperator,
  isMulti: boolean,
) => unknown;

export const defaultFacetQueryValue: DefaultFacetQueryValueFunction = (
  values: Array<string>,
  operator: FilterOperator,
  isMulti: boolean,
): unknown => {
  if (operator === "is_empty") {
    return new IsNull();
  }
  if (operator === "is_not_empty") {
    return new NotNull();
  }
  /*
   * Operators that compare against something the user typed have no typed
   * value here — these values are option ids. Only a hand-edited URL can pair
   * the two, and sanitizeFacetSelectionState clamps that before it reaches
   * here; refusing it again is what keeps "cannot express this" from becoming
   * a filter on a string that happens to parse.
   */
  if (
    operator === "before" ||
    operator === "after" ||
    operator === "between" ||
    operator === "contains" ||
    operator === "not_contains" ||
    operator === "starts_with" ||
    operator === "ends_with" ||
    operator === "greater_than" ||
    operator === "greater_than_or_equal" ||
    operator === "less_than" ||
    operator === "less_than_or_equal"
  ) {
    return undefined;
  }
  if (values.length === 0) {
    return undefined;
  }
  if (isMulti) {
    return operator === "is_not"
      ? new IncludesNone(values)
      : new Includes(values);
  }
  return operator === "is_not" ? new NotEqual(values[0]!) : values[0];
};

export interface FacetColumnQuery {
  /** The query key this chip writes. */
  field: string;
  /** The value to assign there, already merged with anything present. */
  value: unknown;
}

export type BuildFacetColumnQueryFunction = (data: {
  facet: ResourceFacet;
  operator: FilterOperator;
  values: Array<string>;
  /**
   * Whatever an earlier facet already wrote at this field, or `undefined` when
   * nothing has.
   */
  existingValue: unknown;
}) => FacetColumnQuery | null;

/**
 * `null` means "this chip constrains nothing" — an empty selection, a
 * half-entered range, a value the operator cannot use. The caller leaves the
 * field out of the request entirely, which is a different statement from
 * writing the key with an undefined value.
 */
export const buildFacetColumnQuery: BuildFacetColumnQueryFunction = (data: {
  facet: ResourceFacet;
  operator: FilterOperator;
  values: Array<string>;
  existingValue: unknown;
}): FacetColumnQuery | null => {
  const { facet, operator } = data;
  const values: Array<string> = data.values || [];
  const field: string = facet.queryField || facet.key;

  const isValueless: boolean =
    operator === "is_empty" || operator === "is_not_empty";

  if (isValueless && !facet.handlesValuelessOperators) {
    return {
      field: field,
      value: operator === "is_empty" ? new IsNull() : new NotNull(),
    };
  }

  if (values.length === 0 && !isValueless) {
    return null;
  }

  const value: unknown = facet.toQueryValue
    ? facet.toQueryValue(values, operator)
    : facet.type === "dateRange"
      ? buildFacetDateRangeQuery(values, operator)
      : defaultFacetQueryValue(values, operator, Boolean(facet.isMultiSelect));

  if (value === undefined) {
    return null;
  }

  return {
    field: field,
    value:
      facet.mergeQueryValue && data.existingValue !== undefined
        ? facet.mergeQueryValue(data.existingValue, value)
        : value,
  };
};

import { TelemetryFieldSignal } from "../../Types/Telemetry/TelemetryFieldReaders";
import { getLinearRegExp } from "../LinearRegExp/PatternCache";
import { escapeRegExp } from "../RegExpEscape";
import {
  TelemetryFilterAnd,
  TelemetryFilterComparison,
  TelemetryFilterExpression,
  TelemetryFilterNot,
  TelemetryFilterOr,
} from "./TelemetryFilterQuery";
import {
  PINNED_ATTRIBUTE_PREFIX,
  TelemetryReadQuery,
} from "./TelemetryFieldReferences";

/*
 * WHETHER A DROP OR SAMPLE FILTER TAKES RECORDS A SAVED QUERY READS (#10436).
 *
 * A scrub rule changes a field, and the readers lookup asks of each field a
 * record reads whether the rule takes it (ScrubRuleFieldReads). A drop
 * filter takes whole records: a monitor, a dashboard's widget, a saved
 * view, a recording rule or an SLO loses what the filter takes when the
 * two queries can keep the same record. So this asks, of each query a
 * record keeps records by (TelemetryReadQuery), whether some record could
 * meet both the reader's query and the filter's:
 *
 *   - the same signal: a log filter takes no span;
 *   - then the filter's query is read under what the reader's query pins -
 *     its services, its severities or span statuses, an attribute's exact
 *     values - one condition at a time, true, false or not known, and
 *     joined as AND, OR and NOT join them (three-valued, Kleene's logic). A
 *     condition on a field the reader pins is decided on each value it
 *     pins, with the engine's own comparison (LogFilterEvaluator): false
 *     on all of them, it rules the record out; true on all, it holds.
 *
 * Only a filter that is false under the reader's query - every record the
 * reader keeps is one the filter cannot match - leaves the reader alone. A
 * condition on anything the reader does not pin (the body, a span's name,
 * an attribute it searches) is not known, and the two are said to overlap:
 * the form would rather name a monitor that may lose records than miss one
 * that does. A filter with severityText = 'Debug' leaves a monitor of
 * errors alone; one of a service leaves another service's monitor alone;
 * one of attributes.env = 'staging' leaves a monitor of env = 'prod' alone.
 */

type Truth = "true" | "false" | "unknown";

const ATTRIBUTES_PREFIX: string = "attributes.";

function ownValues(
  pinned: Record<string, Array<string>>,
  field: string,
): Array<string> | null {
  return Object.prototype.hasOwnProperty.call(pinned, field)
    ? pinned[field] || null
    : null;
}

/*
 * The values the reader's query pins the field a filter names to: the
 * services for primaryEntityId, an attribute's for attributes.<key> and for
 * a bare key the row has no field of. Null when it pins none.
 */
function pinnedValuesOf(data: {
  field: string;
  query: TelemetryReadQuery;
  rowFields: ReadonlySet<string>;
}): Array<string> | null {
  if (data.field.startsWith(ATTRIBUTES_PREFIX)) {
    return ownValues(
      data.query.pinned,
      `${PINNED_ATTRIBUTE_PREFIX}${data.field.slice(ATTRIBUTES_PREFIX.length)}`,
    );
  }

  if (!data.rowFields.has(data.field)) {
    // The engine reads a field the row does not hold as the attribute.
    return ownValues(
      data.query.pinned,
      `${PINNED_ATTRIBUTE_PREFIX}${data.field}`,
    );
  }

  if (data.field === "primaryEntityId") {
    return data.query.serviceIds;
  }

  return ownValues(data.query.pinned, data.field);
}

// One condition on one value, as the engine compares them; null when it cannot say.
function compareValue(
  comparison: TelemetryFilterComparison,
  value: string,
): boolean | null {
  const expected: string | Array<string> = comparison.value;

  switch (comparison.operator) {
    case "=":
      return value === String(expected);
    case "!=":
      return value !== String(expected);
    case "IN":
      return (Array.isArray(expected) ? expected : [String(expected)]).includes(
        value,
      );
    case "LIKE": {
      const raw: string = String(expected);

      if (!raw.includes("%")) {
        return value.toLowerCase().includes(raw.toLowerCase());
      }

      try {
        return getLinearRegExp(
          `^${escapeRegExp(raw).replace(/%/g, ".*").replace(/_/g, ".")}$`,
          "i",
        ).test(value);
      } catch {
        // A pattern with no answer here decides nothing.
        return null;
      }
    }
    default:
      // An operator the engine does not know never matches.
      return false;
  }
}

function compareUnderQuery(data: {
  comparison: TelemetryFilterComparison;
  query: TelemetryReadQuery;
  rowFields: ReadonlySet<string>;
}): Truth {
  const values: Array<string> | null = pinnedValuesOf({
    field: data.comparison.field,
    query: data.query,
    rowFields: data.rowFields,
  });

  if (!values || values.length === 0) {
    return "unknown";
  }

  let anyTrue: boolean = false;
  let anyFalse: boolean = false;

  for (const value of values) {
    const answer: boolean | null = compareValue(data.comparison, value);

    if (answer === null) {
      return "unknown";
    }

    if (answer) {
      anyTrue = true;
    } else {
      anyFalse = true;
    }
  }

  if (anyTrue && anyFalse) {
    return "unknown";
  }

  return anyTrue ? "true" : "false";
}

function evaluateUnderQuery(data: {
  expr: TelemetryFilterExpression;
  query: TelemetryReadQuery;
  rowFields: ReadonlySet<string>;
}): Truth {
  switch (data.expr.type) {
    case "comparison":
      return compareUnderQuery({
        comparison: data.expr as TelemetryFilterComparison,
        query: data.query,
        rowFields: data.rowFields,
      });
    case "and": {
      const and: TelemetryFilterAnd = data.expr as TelemetryFilterAnd;
      const left: Truth = evaluateUnderQuery({ ...data, expr: and.left });
      const right: Truth = evaluateUnderQuery({ ...data, expr: and.right });

      if (left === "false" || right === "false") {
        return "false";
      }

      return left === "true" && right === "true" ? "true" : "unknown";
    }
    case "or": {
      const or: TelemetryFilterOr = data.expr as TelemetryFilterOr;
      const left: Truth = evaluateUnderQuery({ ...data, expr: or.left });
      const right: Truth = evaluateUnderQuery({ ...data, expr: or.right });

      if (left === "true" || right === "true") {
        return "true";
      }

      return left === "false" && right === "false" ? "false" : "unknown";
    }
    case "not": {
      const inner: Truth = evaluateUnderQuery({
        ...data,
        expr: (data.expr as TelemetryFilterNot).expr,
      });

      if (inner === "unknown") {
        return "unknown";
      }

      return inner === "true" ? "false" : "true";
    }
    default:
      return "false";
  }
}

// Whether a reader's query keeps no record at all: two conditions on one field with no value in common.
function keepsNoRecord(query: TelemetryReadQuery): boolean {
  return (
    (query.serviceIds !== null && query.serviceIds.length === 0) ||
    Object.values(query.pinned).some((values: Array<string>): boolean => {
      return values.length === 0;
    })
  );
}

export interface DropFilterReading {
  signal: TelemetryFieldSignal;
  expr: TelemetryFilterExpression;
  // The fields a record of the signal holds itself: any other a filter names is an attribute.
  rowFields: ReadonlySet<string>;
}

/*
 * Whether the filter can take a record the reader's query keeps: only a
 * filter that is false under the query leaves it alone.
 */
export function doesDropFilterReachQuery(
  filter: DropFilterReading,
  query: TelemetryReadQuery,
): boolean {
  if (query.signal !== filter.signal || keepsNoRecord(query)) {
    return false;
  }

  return (
    evaluateUnderQuery({
      expr: filter.expr,
      query,
      rowFields: filter.rowFields,
    }) !== "false"
  );
}

/*
 * Whether the filter takes every record the reader's query keeps: true
 * under it. A reader it reaches but does not take all of may still keep
 * some of its records.
 */
export function doesDropFilterTakeAllOfQuery(
  filter: DropFilterReading,
  query: TelemetryReadQuery,
): boolean {
  if (query.signal !== filter.signal || keepsNoRecord(query)) {
    return false;
  }

  return (
    evaluateUnderQuery({
      expr: filter.expr,
      query,
      rowFields: filter.rowFields,
    }) === "true"
  );
}

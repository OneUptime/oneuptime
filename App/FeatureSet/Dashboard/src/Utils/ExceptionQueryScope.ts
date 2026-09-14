import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import { JSONObject } from "Common/Types/JSON";
import { SearchQueryValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import { ExceptionInstanceScope } from "./ExceptionsAttributeScope";
import {
  TelemetryScopeAttributeValue,
  getFilterAttributes,
  getFilterSearchValue,
  getFilterStringValues,
  isEmptyFilterValue,
} from "./TelemetryQueryFilterValues";

/*
 * Read a stored `Query<ExceptionInstance>` — the slice an exception monitor
 * evaluated, kept on the incident / alert row — as an INSTANCE SCOPE the
 * exceptions explorer can host.
 *
 * The awkward part of this signal is that the two surfaces list different
 * rows. The stored query selects ClickHouse `ExceptionInstance` occurrences;
 * the /exceptions page lists Postgres `TelemetryException` GROUPS. They are
 * joined by `fingerprint` and nothing else — there is no foreign key, the
 * hash is computed identically on both write paths, and it already folds in
 * projectId + primaryEntityId so it cannot collide across services.
 *
 * `ExceptionsViewer` already owns that join: every filter it cannot express
 * on the group row (attributes, any operator-carrying filter) is resolved
 * against the instance table `GROUP BY fingerprint`, and the resulting
 * fingerprints narrow the list, the histogram AND the facet counts together.
 * So the right way to host an alert's exception query is to feed it into
 * that same resolution rather than to bolt a second filter path onto the
 * group query — which is also why this reader has no `notCarried`: whatever
 * it puts on the instance query constrains all three surfaces at once.
 *
 * Pure, so App/Tests/Dashboard can exercise it against a real
 * `MonitorStepExceptionMonitorUtil.toAnalyticsQuery` result without a
 * renderer.
 */

export interface ExceptionScopeChip {
  facetKey: string;
  value: string;
  displayKey: string;
  displayValue: string;
}

export interface ExceptionQueryScope {
  /** Merged into the viewer's own instance scope before fingerprint resolution. */
  instanceScope: ExceptionInstanceScope;
  /** The evaluation window, off `time`. Null when none was stored. */
  window: InBetween<Date> | null;
  chips: Array<ExceptionScopeChip>;
  /** False when the query carried no column or attribute filter of its own. */
  hasScope: boolean;
  /**
   * Whether a host handed over a query AT ALL — true even for the very common
   * monitor that filters nothing and stores only its evaluation window.
   *
   * This is the flag the viewer must branch on, not `hasScope`. A window-only
   * query still says something precise: "the exceptions that OCCURRED in this
   * window". Answering it from the group row's `lastSeenAt` instead — the
   * group's last occurrence ANYWHERE — silently drops every exception that is
   * still firing, which on an incident page is the set the operator came for.
   * So a hosted view always resolves its groups through the instance table,
   * even with nothing else to filter on.
   */
  isHosted: boolean;
}

export const EMPTY_EXCEPTION_QUERY_SCOPE: ExceptionQueryScope = {
  instanceScope: {
    attributeSelections: {},
    attributePredicates: {},
    columnPredicates: {},
  },
  window: null,
  chips: [],
  hasScope: false,
  isHosted: false,
};

/*
 * Consumed by the reader itself: `projectId` is stamped by the resolution
 * query and `time` becomes the pinned window rather than a filter.
 */
const CONSUMED_QUERY_KEYS: Set<string> = new Set<string>([
  "projectId",
  "time",
  "attributes",
]);

/** Chip labels for the instance columns a stored query can carry. */
const COLUMN_CHIP_LABELS: Dictionary<string> = {
  primaryEntityId: "Service",
  entityKeys: "Resource",
  exceptionType: "Type",
  message: "Message",
  environment: "Environment",
  release: "Release",
  traceId: "Trace",
  spanId: "Span",
  sessionId: "Session",
  fingerprint: "Fingerprint",
  spanName: "Span Name",
};

/*
 * Columns whose values are matched as a MEMBERSHIP rather than by equality.
 * `entityKeys` is a ClickHouse array column, so an `Includes` on it compiles
 * to `hasAny(entityKeys, [...])` — writing a bare string there would compare
 * an array to a scalar and match nothing.
 */
const ARRAY_COLUMNS: Set<string> = new Set<string>(["entityKeys"]);

function chipLabelForColumn(column: string): string {
  return COLUMN_CHIP_LABELS[column] || column;
}

/**
 * Read a stored exception-instance query as a viewer scope. A null /
 * non-object query, or one that scopes nothing, yields
 * `EMPTY_EXCEPTION_QUERY_SCOPE` — the viewer then behaves exactly as it does
 * on the standalone /exceptions page.
 */
export function buildExceptionQueryScope(
  query: Query<ExceptionInstance> | JSONObject | null | undefined,
): ExceptionQueryScope {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return EMPTY_EXCEPTION_QUERY_SCOPE;
  }

  const record: JSONObject = query as JSONObject;

  /*
   * An empty object is not a hosted query — it is a caller passing `{}`. Any
   * key at all (in practice always at least `time`) means a host is scoping
   * this view.
   */
  const isHosted: boolean = Object.keys(record).length > 0;

  const attributePredicates: Dictionary<Array<SearchQueryValue>> = {};
  const columnPredicates: Dictionary<Array<SearchQueryValue>> = {};
  const columnQuery: Query<ExceptionInstance> = {};
  const chips: Array<ExceptionScopeChip> = [];

  const window: InBetween<Date> | null = TelemetryQueryTimeRange.getQueryWindow(
    record,
    TelemetryType.Exception,
  );

  const addChip: (
    facetKey: string,
    value: string,
    displayKey: string,
  ) => void = (facetKey: string, value: string, displayKey: string): void => {
    chips.push({
      facetKey: facetKey,
      value: value,
      displayKey: displayKey,
      displayValue: value,
    });
  };

  const attributes: Dictionary<TelemetryScopeAttributeValue> =
    getFilterAttributes(record["attributes"]);

  for (const [key, value] of Object.entries(attributes)) {
    /*
     * A scalar attribute compiles to the fast `attributes['k'] = 'v'` map
     * subscript. Numbers and booleans are stringified because the attributes
     * map is String -> String in ClickHouse; the monitor form writes them the
     * same way.
     */
    attributePredicates[key] = [String(value)];
    addChip(`attributes.${key}`, String(value), key);
  }

  if (
    Object.keys(attributes).length === 0 &&
    record["attributes"] !== undefined &&
    record["attributes"] !== null
  ) {
    /*
     * An attributes value we could not read is forwarded verbatim rather than
     * dropped — the analytics compiler understands more shapes than this
     * reader does, and a widened list under an incident heading is the bug
     * this whole file exists to avoid.
     */
    (columnQuery as JSONObject)["attributes"] = record["attributes"] as never;
  }

  for (const key of Object.keys(record)) {
    if (CONSUMED_QUERY_KEYS.has(key)) {
      continue;
    }

    const raw: unknown = record[key];

    if (raw === undefined || raw === null || isEmptyFilterValue(raw)) {
      continue;
    }

    const search: string | null = getFilterSearchValue(raw);

    if (search !== null) {
      columnPredicates[key] = [new Search<string>(search)];
      addChip(key, search, chipLabelForColumn(key));
      continue;
    }

    const values: Array<string> = getFilterStringValues(raw);

    if (values.length === 0) {
      // Unreadable shape: forward it verbatim so the list stays narrow.
      (columnQuery as JSONObject)[key] = raw as never;
      continue;
    }

    columnPredicates[key] =
      values.length === 1 && !ARRAY_COLUMNS.has(key)
        ? [values[0]!]
        : [new Includes(values)];

    for (const value of values) {
      addChip(key, value, chipLabelForColumn(key));
    }
  }

  const hasScope: boolean =
    Object.keys(attributePredicates).length > 0 ||
    Object.keys(columnPredicates).length > 0 ||
    Object.keys(columnQuery).length > 0;

  if (!hasScope) {
    return {
      ...EMPTY_EXCEPTION_QUERY_SCOPE,
      window: window,
      isHosted: isHosted,
    };
  }

  return {
    instanceScope: {
      attributeSelections: {},
      attributePredicates: attributePredicates,
      columnPredicates: columnPredicates,
      columnQuery: columnQuery,
    },
    window: window,
    chips: chips,
    hasScope: true,
    isHosted: isHosted,
  };
}

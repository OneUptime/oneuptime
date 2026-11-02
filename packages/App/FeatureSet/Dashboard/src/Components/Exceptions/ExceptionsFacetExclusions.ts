import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import { JSONObject } from "Common/Types/JSON";
import {
  getBaseFacetKey,
  isExcludeFacetKey,
} from "Common/Types/Telemetry/FacetExcludeKey";
import { isResourceFacetKey } from "Common/Types/Telemetry/ResourceEntityFacet";
import { getExceptionChipFacetKey } from "./ExceptionsFacetCounts";

/*
 * THE VALUES A READER LEFT OUT OF THE EXCEPTIONS LIST.
 *
 * A facet row's minus leaves its value out: a chip keyed `!<facet>`
 * (FacetExcludeKey) - "Exception Type is not TypeError", "Environment is
 * not staging", "Service is not checkout". They are read apart from the
 * chips that keep values, once, and written into every read from that one
 * reading:
 *
 *   - the list (exception groups, in Postgres): applyExceptionExclusionsToQuery
 *   - the chart and the facet counts (occurrences, in ClickHouse):
 *     applyExceptionExclusionsToPayload
 *   - the class lens: the classes left out join the ones it hides
 *     (ExceptionsViewer's errorClassClause)
 *   - an attribute left out: the instance scope, as every attribute filter
 *     (ExceptionsViewer's instanceScope)
 *
 * Every resource facet - the Service and each catalog type - names the
 * same column (`primaryEntityId`), so the resources left out are one list.
 *
 * Kept free of React so App's tests read it without a renderer.
 */

export const EXCEPTION_ATTRIBUTE_CHIP_PREFIX: string = "attributes.";

export interface ExceptionExclusions {
  // Resources left out: services and every catalog resource type.
  entityIds: Array<string>;
  // Column values left out, by column (exceptionType, environment, ...).
  columns: Record<string, Array<string>>;
  // Attribute values left out, by attribute key.
  attributes: Record<string, Array<string>>;
}

const addValue: (list: Array<string>, value: string) => void = (
  list: Array<string>,
  value: string,
): void => {
  if (!list.includes(value)) {
    list.push(value);
  }
};

export const readExceptionExclusions: (data: {
  chips: ReadonlyArray<{ facetKey: string; value: string }>;
  // A facet counted without its own selection leaves its chips out too.
  omitFacetKey?: string | null | undefined;
}) => ExceptionExclusions = (data: {
  chips: ReadonlyArray<{ facetKey: string; value: string }>;
  omitFacetKey?: string | null | undefined;
}): ExceptionExclusions => {
  const exclusions: ExceptionExclusions = {
    entityIds: [],
    columns: {},
    attributes: {},
  };

  for (const chip of data.chips) {
    if (
      !isExcludeFacetKey(chip.facetKey) ||
      typeof chip.value !== "string" ||
      chip.value.length === 0
    ) {
      continue;
    }

    const baseKey: string = getBaseFacetKey(chip.facetKey);

    if (!baseKey) {
      continue;
    }

    if (
      data.omitFacetKey &&
      getExceptionChipFacetKey(baseKey) === data.omitFacetKey
    ) {
      continue;
    }

    if (isResourceFacetKey(baseKey)) {
      addValue(exclusions.entityIds, chip.value);
      continue;
    }

    if (baseKey.startsWith(EXCEPTION_ATTRIBUTE_CHIP_PREFIX)) {
      const attributeKey: string = baseKey.substring(
        EXCEPTION_ATTRIBUTE_CHIP_PREFIX.length,
      );

      if (attributeKey.length > 0) {
        const values: Array<string> =
          exclusions.attributes[attributeKey] || [];
        addValue(values, chip.value);
        exclusions.attributes[attributeKey] = values;
      }
      continue;
    }

    const values: Array<string> = exclusions.columns[baseKey] || [];
    addValue(values, chip.value);
    exclusions.columns[baseKey] = values;
  }

  return exclusions;
};

/*
 * One value left out is a plain `!=`; several are one NOT IN.
 */
export const toExcludedExceptionValue: (
  values: Array<string>,
) => NotEqual<string> | IncludesNone = (
  values: Array<string>,
): NotEqual<string> | IncludesNone => {
  const unique: Array<string> = Array.from(new Set<string>(values));

  return unique.length === 1
    ? new NotEqual<string>(unique[0]!)
    : new IncludesNone(unique);
};

/*
 * The values left out, onto the exception group list's query - after
 * everything that keeps rows is on it. A column that already keeps values
 * holds one value per exception group, so the values left out of it change
 * nothing and are dropped: the query holds one predicate per column. The
 * class lens column is the clause's own and is never written here.
 */
export const applyExceptionExclusionsToQuery: (data: {
  query: Record<string, unknown>;
  exclusions: ExceptionExclusions;
  // Columns written by a clause of their own (the class lens).
  skipColumns?: ReadonlyArray<string> | undefined;
}) => void = (data: {
  query: Record<string, unknown>;
  exclusions: ExceptionExclusions;
  skipColumns?: ReadonlyArray<string> | undefined;
}): void => {
  if (
    data.exclusions.entityIds.length > 0 &&
    data.query["primaryEntityId"] === undefined
  ) {
    data.query["primaryEntityId"] = toExcludedExceptionValue(
      data.exclusions.entityIds,
    );
  }

  for (const [column, values] of Object.entries(data.exclusions.columns)) {
    if (
      values.length === 0 ||
      (data.skipColumns || []).includes(column) ||
      data.query[column] !== undefined
    ) {
      continue;
    }

    data.query[column] = toExcludedExceptionValue(values);
  }
};

const hasListValue: (value: unknown) => boolean = (value: unknown): boolean => {
  return Array.isArray(value) && value.length > 0;
};

/*
 * The same values left out, onto a histogram or facets request - by the
 * same rule, read off what the request already keeps, so the chart and the
 * counts drop exactly the occurrences of the groups the list drops.
 */
export const applyExceptionExclusionsToPayload: (
  payload: JSONObject,
  exclusions: ExceptionExclusions,
) => void = (payload: JSONObject, exclusions: ExceptionExclusions): void => {
  if (exclusions.entityIds.length > 0 && !hasListValue(payload["serviceIds"])) {
    payload["excludedServiceIds"] = [...exclusions.entityIds];
  }

  const exceptionTypes: Array<string> =
    exclusions.columns["exceptionType"] || [];

  if (
    exceptionTypes.length > 0 &&
    !hasListValue(payload["exceptionTypes"])
  ) {
    payload["excludedExceptionTypes"] = [...exceptionTypes];
  }

  const environments: Array<string> = exclusions.columns["environment"] || [];

  if (environments.length > 0 && !hasListValue(payload["environments"])) {
    payload["excludedEnvironments"] = [...environments];
  }
};

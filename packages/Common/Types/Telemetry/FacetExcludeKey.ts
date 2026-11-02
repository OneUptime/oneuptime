/*
 * How a telemetry facet chip says it LEAVES its value out: on its key.
 *
 *   severityText: debug       keeps only the rows whose severity is debug
 *   !severityText: debug      keeps every row but those
 *
 * Every telemetry explorer writes an exclusion this way - Logs, Traces,
 * Metrics, Exceptions and Security Events - so the chip row, the address
 * (`filters=[["!severityText", ...]]`), a saved view and the facet sidebar
 * all read one marker, and a link carries an exclusion with no second
 * parameter.
 *
 * On the key because a value is data - a hostname, a span name, an
 * attribute - and any marker put on a value could be part of a real one. No
 * column name or attribute key starts with `!`, so the marker is never
 * ambiguous.
 *
 * Kept in Types, free of the UI, so the request and query builders of every
 * explorer (and the shared resource-facet readers beside this file) can read
 * it. The facet sidebar's FacetSelection re-exports it.
 */

export const FACET_EXCLUDE_KEY_PREFIX: string = "!";

// Whether a chip key leaves its value out.
export const isExcludeFacetKey: (facetKey: string) => boolean = (
  facetKey: string,
): boolean => {
  return (
    typeof facetKey === "string" &&
    facetKey.startsWith(FACET_EXCLUDE_KEY_PREFIX)
  );
};

// The key of the chip that leaves a value of this facet out.
export const toExcludeFacetKey: (facetKey: string) => string = (
  facetKey: string,
): string => {
  return isExcludeFacetKey(facetKey)
    ? facetKey
    : `${FACET_EXCLUDE_KEY_PREFIX}${facetKey}`;
};

// The facet an include-or-exclude key filters on.
export const getBaseFacetKey: (facetKey: string) => string = (
  facetKey: string,
): string => {
  return isExcludeFacetKey(facetKey)
    ? facetKey.substring(FACET_EXCLUDE_KEY_PREFIX.length)
    : facetKey;
};

/*
 * The chips that leave values out, each read under the facet it filters:
 * `["!hostId", [...]]` becomes `["hostId", [...]]`, and a chip that keeps
 * its value is left behind. What the resource readers beside this file
 * (collectExcludedResourceEntityFacetSelections) run the kept-value rules
 * over, so a left-out selection is read exactly as a kept one is.
 */
export const getExcludedFacetEntries: (
  entries: Iterable<[string, Iterable<string>]>,
) => Array<[string, Iterable<string>]> = (
  entries: Iterable<[string, Iterable<string>]>,
): Array<[string, Iterable<string>]> => {
  const excluded: Array<[string, Iterable<string>]> = [];

  for (const [facetKey, values] of entries) {
    if (!isExcludeFacetKey(facetKey)) {
      continue;
    }

    const baseKey: string = getBaseFacetKey(facetKey);

    if (!baseKey) {
      continue;
    }

    excluded.push([baseKey, values]);
  }

  return excluded;
};

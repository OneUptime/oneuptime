import { RESOURCE_FACET_CATALOG_KEYS } from "Common/Types/Telemetry/ResourceFacetCatalog";
import { isServiceFacetKey } from "Common/Types/Telemetry/ResourceEntityFacet";

/*
 * The Exceptions explorer's facet counts: which facets it asks the server
 * for, which of them the reader chose a value in, and the services a count
 * reads.
 *
 * A facet with a value chosen is counted without its own selection
 * (Common/UI/Components/TelemetryViewer/FacetCountPlan), so the exception
 * types, environments or services beside a checked one stay listed with
 * their counts and a second can be checked. Kept free of React so App's
 * tests read it without a renderer.
 */

// The key the facets endpoint counts the Service facet under.
export const EXCEPTIONS_SERVICE_FACET_KEY: string = "primaryEntityId";

/*
 * Requested from `/telemetry/exceptions/facets`, in sidebar order: the
 * Service facet, every resource type in the catalog (the server answers each
 * with the project's full list, so a type the project has none of comes back
 * empty and the sidebar folds it away), the exception type and the
 * environment.
 */
export const EXCEPTIONS_EXPLORER_FACET_KEYS: ReadonlyArray<string> = [
  EXCEPTIONS_SERVICE_FACET_KEY,
  ...RESOURCE_FACET_CATALOG_KEYS,
  "exceptionType",
  "environment",
];

const COUNTED_FACET_KEYS: ReadonlySet<string> = new Set<string>(
  EXCEPTIONS_EXPLORER_FACET_KEYS,
);

// The facet a chip's key counts under, or null for one no facet lists.
export const getExceptionChipFacetKey: (chipKey: string) => string | null = (
  chipKey: string,
): string | null => {
  const facetKey: string = isServiceFacetKey(chipKey)
    ? EXCEPTIONS_SERVICE_FACET_KEY
    : chipKey;

  return COUNTED_FACET_KEYS.has(facetKey) ? facetKey : null;
};

/*
 * The facets the reader chose a value in. The page's own (read-only) chips
 * are not a choice.
 */
export const getExceptionChosenFacetKeys: (
  filters: ReadonlyArray<{ facetKey: string; readOnly?: boolean | undefined }>,
) => Array<string> = (
  filters: ReadonlyArray<{ facetKey: string; readOnly?: boolean | undefined }>,
): Array<string> => {
  const keys: Set<string> = new Set<string>();

  for (const filter of filters) {
    if (filter.readOnly) {
      continue;
    }

    const facetKey: string | null = getExceptionChipFacetKey(filter.facetKey);

    if (facetKey) {
      keys.add(facetKey);
    }
  }

  return Array.from(keys);
};

/*
 * The services and resources a facet count reads: what `@service:` resolved
 * to, every resource chip, and the page's own entity - less the counted
 * facet's own choice, when it is the Service facet (typed services and
 * Service chips alike) or a resource facet (its chips). The page's entity
 * always stays: it is the page's scope, not a choice.
 */
export const getExceptionFacetServiceIds: (data: {
  typedServiceIds: ReadonlyArray<string>;
  facetGroups: Readonly<Record<string, ReadonlyArray<string>>>;
  resourceFacetKeys: Iterable<string>;
  pageEntityId?: string | null | undefined;
  omitFacetKey?: string | null | undefined;
}) => Array<string> = (data: {
  typedServiceIds: ReadonlyArray<string>;
  facetGroups: Readonly<Record<string, ReadonlyArray<string>>>;
  resourceFacetKeys: Iterable<string>;
  pageEntityId?: string | null | undefined;
  omitFacetKey?: string | null | undefined;
}): Array<string> => {
  const ids: Set<string> = new Set<string>();

  if (data.omitFacetKey !== EXCEPTIONS_SERVICE_FACET_KEY) {
    for (const id of data.typedServiceIds) {
      ids.add(id);
    }
  }

  for (const facetKey of data.resourceFacetKeys) {
    if (getExceptionChipFacetKey(facetKey) === data.omitFacetKey) {
      continue;
    }

    for (const value of data.facetGroups[facetKey] || []) {
      ids.add(value);
    }
  }

  if (data.pageEntityId) {
    ids.add(data.pageEntityId);
  }

  return Array.from(ids);
};

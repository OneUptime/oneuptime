import Log from "Common/Models/AnalyticsModels/Log";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import ObjectID from "Common/Types/ObjectID";
import {
  RESOURCE_FACET_CATALOG_KEYS,
  getResourceFacetLabelMap,
} from "Common/Types/Telemetry/ResourceFacetCatalog";
import {
  ResourceEntityFacetSelections,
  parseResourceEntityFacetSelections,
} from "Common/Types/Telemetry/ResourceEntityFacet";
import { queryValueToChipValues } from "Common/Types/Telemetry/TelemetrySearchQuery";
import { ATTRIBUTE_FACET_PREFIX } from "./LogsHistogramRequest";
import { LOGS_CHIP_FACET_KEYS } from "../../Utils/SavedViewQueryMerge";

/*
 * The logs explorer's facet chips: which facets the sidebar asks the server
 * for, what a chip's key reads, and how a saved view's / URL's query is read
 * back into chips.
 *
 * The facet list and the chip labels used to be copied inline in the viewer
 * and only knew Host / Docker / Podman / Kubernetes, so a project with
 * Proxmox, vCenter, Ceph, Docker Swarm, serverless, cloud, RUM or IoT
 * resources never saw those facets — and a chip restored for one of them
 * read its raw key ("proxmoxClusterId: …"). Both are derived from the shared
 * resource facet catalog now, so a new resource type is picked up here
 * without an edit.
 *
 * Pure and React-free so App/Tests can pin it without mounting the viewer.
 */

/*
 * Facet keys requested from `/telemetry/logs/facets` for the sidebar:
 * severity, the Service facet, then every non-Service resource type in
 * catalog (sidebar) order. The server lists every resource of a requested
 * type the project has, so a type the project has none of comes back empty
 * and the sidebar folds it away.
 */
export const LOGS_EXPLORER_FACET_KEYS: ReadonlyArray<string> = [
  "severityText",
  "primaryEntityId",
  ...RESOURCE_FACET_CATALOG_KEYS,
];

// Chip key label per facet key. Anything not listed shows its raw key.
export const LOGS_FACET_CHIP_KEY_LABELS: Readonly<Record<string, string>> = {
  severityText: "Severity",
  primaryEntityId: "Service",
  ...getResourceFacetLabelMap(),
  traceId: "Trace",
  spanId: "Span",
  /*
   * The one chip whose value is a substring rather than an exact id —
   * "Message contains" says so, since "body: connection refused" reads
   * like an equality the filter is not.
   */
  body: "Message contains",
};

/*
 * What a chip's key reads. An `attributes.<key>` chip drops the prefix so it
 * reads as `<key>: <value>`; a known facet gets its label; anything else
 * keeps its raw key rather than guessing.
 */
export function getLogsFacetChipDisplayKey(facetKey: string): string {
  if (facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
    return facetKey.substring(ATTRIBUTE_FACET_PREFIX.length);
  }

  return LOGS_FACET_CHIP_KEY_LABELS[facetKey] || facetKey;
}

/*
 * The facet keys read BACK out of a query into chips. Must stay the mirror
 * of what applyLogsFacetFiltersToQuery compiles INTO a query, or a filter
 * that survives a saved view / URL round-trip filters the list while no
 * chip says so — and the histogram, which builds its request from the
 * chips, then counts rows the list excludes.
 */
const FACET_FILTER_KEYS: ReadonlyArray<string> = LOGS_CHIP_FACET_KEYS;

// The chip values a stored query predicate stands for.
export function getLogsQueryValues(value: unknown): Array<string> {
  if (value instanceof Includes) {
    return value.values.map((item: string | number | ObjectID) => {
      return item.toString();
    });
  }

  /*
   * The body chip compiles to a contains-match, so its stored form is a
   * Search rather than a bare string. Without this branch a saved view or
   * deep link carrying one round-trips into a filtered list with no chip.
   */
  if (value instanceof Search) {
    const text: string = value.toString();

    return text.trim().length > 0 ? [text] : [];
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof ObjectID
  ) {
    return [value.toString()];
  }

  return [];
}

/*
 * Read the chips a saved view's (or deep link's) query carries. A predicate
 * the host page pins in `baseQuery` is the page's, not the user's, so it
 * never becomes a removable chip.
 */
export function buildLogsFacetFiltersFromQuery(
  query: Query<Log>,
  baseQuery: Query<Log>,
): Map<string, Set<string>> {
  const nextFilters: Map<string, Set<string>> = new Map();

  for (const facetKey of FACET_FILTER_KEYS) {
    if ((baseQuery as any)[facetKey] !== undefined) {
      continue;
    }

    const values: Array<string> = getLogsQueryValues((query as any)[facetKey]);

    if (values.length > 0) {
      nextFilters.set(facetKey, new Set(values));
    }
  }

  /*
   * `attributes.<key>` chips, the same way. Attribute filters were the one
   * group applyLogsFacetFiltersToQuery compiled INTO a query and nothing read
   * back out, so a saved view carrying `@platform.team:a*` reopened with the
   * filter applied and no chip showing it — and the next chip edit, which
   * recompiles from the chips it can see, silently dropped it.
   */
  const savedAttributes: Record<string, unknown> =
    ((query as any)["attributes"] as Record<string, unknown>) || {};
  const baseAttributes: Record<string, unknown> =
    ((baseQuery as any)["attributes"] as Record<string, unknown>) || {};

  for (const attributeKey of Object.keys(savedAttributes)) {
    // A filter pinned by the host page is not the user's to edit or remove.
    if (baseAttributes[attributeKey] !== undefined) {
      continue;
    }

    const chipValues: Array<string> = queryValueToChipValues(
      savedAttributes[attributeKey],
    );

    if (chipValues.length > 0) {
      nextFilters.set(
        `${ATTRIBUTE_FACET_PREFIX}${attributeKey}`,
        new Set(chipValues),
      );
    }
  }

  /*
   * Resource chips (host, Docker / Podman host, Kubernetes / Proxmox /
   * Docker Swarm / Ceph cluster, vCenter, serverless function, cloud
   * resource, RUM application, IoT fleet) live under `resourceFilters`
   * rather than in a column of their own (see applyLogsFacetFiltersToQuery).
   * Restoring them here is what makes a saved view keep its cluster chip:
   * without it the chip row would come back empty and the next chip edit
   * would recompile the query without the cluster.
   */
  const savedResourceFilters: ResourceEntityFacetSelections =
    parseResourceEntityFacetSelections((query as any)["resourceFilters"]);

  for (const facetKey of Object.keys(savedResourceFilters)) {
    if ((baseQuery as any)[facetKey] !== undefined) {
      continue;
    }

    const values: Array<string> = savedResourceFilters[facetKey] || [];

    if (values.length > 0) {
      nextFilters.set(facetKey, new Set(values));
    }
  }

  return nextFilters;
}

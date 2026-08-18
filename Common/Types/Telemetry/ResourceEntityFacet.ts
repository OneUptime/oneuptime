/*
 * The resource facets of the telemetry explorers (Logs / Traces), split by
 * how a selection has to be turned into a predicate.
 *
 * A signal row names exactly one *primary* entity (`primaryEntityId` +
 * `primaryEntityType`) and, since the entity model shipped, the full
 * membership set it belongs to (`entityKeys`). Which of the two a facet
 * selection has to be matched against depends on the ingestion path:
 *
 *   - Agent-ingested resource telemetry (Infrastructure / Docker / Podman /
 *     Kubernetes agents) has no `service.name`, so the resource IS the
 *     primary entity and `primaryEntityId` holds its Postgres id.
 *   - OTLP telemetry that carries a `service.name` is primary-keyed on its
 *     Service (`OtelIngestBaseService.selectPrimaryEntity`); the host /
 *     cluster it runs on is recorded only in `entityKeys`.
 *
 * The second case is why coalescing every resource facet into one
 * `primaryEntityId IN (...)` list returned nothing for a Kubernetes cluster
 * ingested through an OpenTelemetry Collector: the cluster id was compared
 * against a column that only ever held the Service id. Selections on these
 * facets therefore compile to a per-facet OR of both memberships, and the
 * per-facet groups AND with each other so "cluster X" + "service Y"
 * intersects instead of unioning.
 */

/**
 * Facets whose values are Service ids — the ids that legitimately live in
 * `primaryEntityId` for OTLP telemetry. `serviceId` is the pre-rename alias
 * kept for stale clients (see ResourceFacetResolver).
 */
export const SERVICE_FACET_KEYS: ReadonlyArray<string> = [
  "primaryEntityId",
  "serviceId",
];

/**
 * Facets whose values are ids of a NON-Service resource row. These are the
 * ones that need the entity-key treatment; the value is a Postgres id
 * (Host / DockerHost / PodmanHost / KubernetesCluster) which the server
 * resolves to the resource's identifying value and then to its entity key.
 */
export const RESOURCE_ENTITY_FACET_KEYS: ReadonlyArray<string> = [
  "hostId",
  "dockerHostId",
  "podmanHostId",
  "kubernetesClusterId",
];

const RESOURCE_ENTITY_FACET_KEY_SET: ReadonlySet<string> = new Set<string>(
  RESOURCE_ENTITY_FACET_KEYS,
);

const SERVICE_FACET_KEY_SET: ReadonlySet<string> = new Set<string>(
  SERVICE_FACET_KEYS,
);

/**
 * Every facet key that names a resource, in either group. Kept so call
 * sites that only need "is this a resource chip?" (chip rendering, scope
 * hand-off) do not have to consult both sets.
 */
export const ALL_RESOURCE_FACET_KEYS: ReadonlyArray<string> = [
  ...SERVICE_FACET_KEYS,
  ...RESOURCE_ENTITY_FACET_KEYS,
];

export function isServiceFacetKey(facetKey: string): boolean {
  return SERVICE_FACET_KEY_SET.has(facetKey);
}

export function isResourceEntityFacetKey(facetKey: string): boolean {
  return RESOURCE_ENTITY_FACET_KEY_SET.has(facetKey);
}

export function isResourceFacetKey(facetKey: string): boolean {
  return isServiceFacetKey(facetKey) || isResourceEntityFacetKey(facetKey);
}

/**
 * Selected ids per non-Service resource facet, e.g.
 * `{ kubernetesClusterId: ["<id>"] }`. This is the wire shape sent to the
 * aggregation endpoints (`resourceFilters` in the POST body) and carried on
 * the analytics list query under the same key.
 */
export type ResourceEntityFacetSelections = Record<string, Array<string>>;

/**
 * Collect the non-Service resource selections out of applied facet filters.
 * Accepts anything entry-iterable so the Logs explorer can pass a
 * `Map<string, Set<string>>` and the Traces explorer a plain record via
 * `Object.entries`.
 *
 * Values are de-duplicated and empty facets are dropped, so an emptied chip
 * group never becomes a `[]` that a reader might read as "match nothing".
 */
export function collectResourceEntityFacetSelections(
  entries: Iterable<[string, Iterable<string>]>,
): ResourceEntityFacetSelections {
  const selections: ResourceEntityFacetSelections = {};

  for (const [facetKey, values] of entries) {
    if (!isResourceEntityFacetKey(facetKey)) {
      continue;
    }

    const unique: Set<string> = new Set<string>(selections[facetKey] || []);

    for (const value of values) {
      if (typeof value === "string" && value.length > 0) {
        unique.add(value);
      }
    }

    if (unique.size > 0) {
      selections[facetKey] = Array.from(unique);
    }
  }

  return selections;
}

/** Collect the Service-facet selections, same rules as the helper above. */
export function collectServiceFacetSelections(
  entries: Iterable<[string, Iterable<string>]>,
): Array<string> {
  const unique: Set<string> = new Set<string>();

  for (const [facetKey, values] of entries) {
    if (!isServiceFacetKey(facetKey)) {
      continue;
    }

    for (const value of values) {
      if (typeof value === "string" && value.length > 0) {
        unique.add(value);
      }
    }
  }

  return Array.from(unique);
}

/*
 * Ids are ObjectID (UUID) strings. Validating the shape here means a
 * malformed filter is dropped at the edge instead of reaching a lookup or a
 * SQL parameter.
 */
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Upper bound on ids per facet, so a crafted request cannot send an unbounded list. */
export const MAX_RESOURCE_IDS_PER_FACET: number = 200;

/**
 * Parse an untrusted `resourceFilters` value (request body field or a
 * persisted saved-view query) into the canonical selection shape.
 *
 * Deliberately lenient: anything that is not `{ <known facet key>:
 * <uuid>[] }` is dropped rather than turned into a predicate, because a
 * malformed filter must mean "no constraint" — never "match nothing", which
 * would show an empty explorer with no explanation.
 */
export function parseResourceEntityFacetSelections(
  source: unknown,
): ResourceEntityFacetSelections {
  const selections: ResourceEntityFacetSelections = {};

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return selections;
  }

  const record: Record<string, unknown> = source as Record<string, unknown>;

  for (const facetKey of Object.keys(record)) {
    if (!isResourceEntityFacetKey(facetKey)) {
      continue;
    }

    const raw: unknown = record[facetKey];

    if (!Array.isArray(raw)) {
      continue;
    }

    const ids: Array<string> = Array.from(
      new Set(
        (raw as Array<unknown>).filter((value: unknown): value is string => {
          return typeof value === "string" && UUID_PATTERN.test(value);
        }),
      ),
    ).slice(0, MAX_RESOURCE_IDS_PER_FACET);

    if (ids.length > 0) {
      selections[facetKey] = ids;
    }
  }

  return selections;
}

export function hasResourceEntityFacetSelections(
  selections: ResourceEntityFacetSelections | undefined,
): boolean {
  if (!selections) {
    return false;
  }

  return Object.keys(selections).some((key: string): boolean => {
    return (selections[key] || []).length > 0;
  });
}

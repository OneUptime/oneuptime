import ObjectID from "../../../Types/ObjectID";
import ResourceFacetResolver, {
  ResolvedFacetValue,
  ResourceFacetEntity,
  ResourceFacetListSpec,
} from "./ResourceFacetResolver";
import CaptureSpan from "./CaptureSpan";

/*
 * Orchestrates a telemetry facets request that mixes resource facets (value
 * list from Postgres, counts from ClickHouse) with plain facets (counts
 * only), for the Logs / Traces / Exceptions / Metrics facet endpoints.
 *
 * LIST FIRST. A resource facet's response is the Postgres list with counts
 * merged in, so a resource type the project has none of (or whose sidebar
 * search matched nothing) answers [] whatever ClickHouse says. The
 * explorers request every resource type in the catalog, and most projects
 * only run a few of them — counting before listing would spend one
 * ClickHouse GROUP BY per absent type on every sidebar refresh, just to
 * throw the result away. Listing first lets those facets skip their count
 * query entirely; the Postgres lookups are small, indexed and run in
 * parallel with the plain facets' counts.
 *
 * Every function here degrades per facet: a failing lookup or count costs
 * that facet its values (or its counts), never the whole response.
 */

// Structural twin of every aggregation service's FacetValue.
export interface PlannedFacetValue {
  value: string;
  count: number;
  displayName?: string | undefined;
}

// Counts one facet's values in ClickHouse (a per-facet GROUP BY).
export type FacetValueCounter = (
  facetKey: string,
) => Promise<Array<PlannedFacetValue>>;

// facetKey -> the Postgres rows listed for it. Resource facets only.
export type ListedResourceFacets = Record<string, Array<ResourceFacetEntity>>;

export interface ResourceFacetListRequest {
  projectId: ObjectID;
  facetKeys: Array<string>;
  // Per-facet sidebar search, applied to the Postgres lookup.
  facetSearchText?: Record<string, string> | undefined;
  limit: number;
}

export interface PerFacetCountRequest extends ResourceFacetListRequest {
  countFacet: FacetValueCounter;
}

export default class ResourceFacetPlanner {
  // Requested keys, de-duplicated, in request order.
  public static uniqueFacetKeys(facetKeys: Array<string>): Array<string> {
    return Array.from(new Set<string>(facetKeys));
  }

  // The requested keys whose value list comes from Postgres.
  public static getResourceFacetKeys(facetKeys: Array<string>): Array<string> {
    return ResourceFacetPlanner.uniqueFacetKeys(facetKeys).filter(
      (facetKey: string): boolean => {
        return ResourceFacetResolver.isResourceFacet(facetKey);
      },
    );
  }

  /*
   * Phase one: list every requested resource facet in parallel. Keys that
   * are not resource facets are not looked up and do not appear in the
   * result.
   *
   * Never rejects. Callers start it before they know whether anything will
   * await it, so a rejection here could go unhandled; and listEntities
   * already isolates each facet, so this only guards against the
   * unexpected. Nothing listed means no counts are run and every resource
   * facet answers [] — what a failed lookup always produced.
   */
  @CaptureSpan()
  public static async listResourceFacets(
    request: ResourceFacetListRequest,
  ): Promise<ListedResourceFacets> {
    try {
      const specs: Array<ResourceFacetListSpec> =
        ResourceFacetPlanner.getResourceFacetKeys(request.facetKeys).map(
          (facetKey: string): ResourceFacetListSpec => {
            return {
              facetKey,
              searchText: request.facetSearchText?.[facetKey],
              limit: request.limit,
            };
          },
        );

      if (specs.length === 0) {
        return {};
      }

      return await ResourceFacetResolver.listEntities(request.projectId, specs);
    } catch {
      return {};
    }
  }

  public static hasListedEntities(
    listed: ListedResourceFacets,
    facetKey: string,
  ): boolean {
    return (listed[facetKey] || []).length > 0;
  }

  /*
   * Traces count every resource facet (and statusCode) from ONE shared
   * projection-backed GROUP BY, so the skip is all-or-nothing: the query is
   * still needed when statusCode is requested, or when any requested
   * resource facet listed at least one row to merge counts into.
   */
  public static needsTraceResourceFacetCounts(data: {
    facetKeys: Array<string>;
    listed: ListedResourceFacets;
  }): boolean {
    if (data.facetKeys.includes("statusCode")) {
      return true;
    }

    return ResourceFacetPlanner.getResourceFacetKeys(data.facetKeys).some(
      (facetKey: string): boolean => {
        return ResourceFacetPlanner.hasListedEntities(data.listed, facetKey);
      },
    );
  }

  /*
   * Phase two for a shared count source: one entry per requested resource
   * facet — its listed rows with counts merged in, or [] when nothing was
   * listed (the counts are never consulted for such a facet).
   */
  public static mergeResourceFacetCounts(data: {
    facetKeys: Array<string>;
    listed: ListedResourceFacets;
    countsFor: (facetKey: string) => Map<string, number>;
  }): Record<string, Array<ResolvedFacetValue>> {
    const merged: Record<string, Array<ResolvedFacetValue>> = {};

    for (const facetKey of ResourceFacetPlanner.getResourceFacetKeys(
      data.facetKeys,
    )) {
      merged[facetKey] = ResourceFacetPlanner.hasListedEntities(
        data.listed,
        facetKey,
      )
        ? ResourceFacetResolver.mergeCounts(
            data.listed[facetKey] || [],
            data.countsFor(facetKey),
          )
        : [];
    }

    return merged;
  }

  /*
   * The whole flow for endpoints that count each facet with its own GROUP BY
   * (Logs / Exceptions / Metrics):
   *
   *   - a plain facet is counted as-is; a failing count degrades to [];
   *   - a resource facet waits for its listing. Nothing listed -> [] and NO
   *     count query. Otherwise its count runs and is merged into the listed
   *     rows; a failing count still returns the rows, with count 0, so the
   *     sidebar keeps listing the project's resources.
   *
   * The response carries exactly one entry per distinct requested key.
   */
  @CaptureSpan()
  public static async countPerFacet(
    request: PerFacetCountRequest,
  ): Promise<Record<string, Array<PlannedFacetValue>>> {
    const facetKeys: Array<string> = ResourceFacetPlanner.uniqueFacetKeys(
      request.facetKeys,
    );

    const listingPromise: Promise<ListedResourceFacets> =
      ResourceFacetPlanner.listResourceFacets(request);

    const results: Array<readonly [string, Array<PlannedFacetValue>]> =
      await Promise.all(
        facetKeys.map(
          async (
            facetKey: string,
          ): Promise<readonly [string, Array<PlannedFacetValue>]> => {
            if (!ResourceFacetResolver.isResourceFacet(facetKey)) {
              return [
                facetKey,
                await ResourceFacetPlanner.countOrEmpty(
                  request.countFacet,
                  facetKey,
                ),
              ] as const;
            }

            const listed: ListedResourceFacets = await listingPromise;

            if (!ResourceFacetPlanner.hasListedEntities(listed, facetKey)) {
              return [facetKey, []] as const;
            }

            const values: Array<PlannedFacetValue> =
              await ResourceFacetPlanner.countOrEmpty(
                request.countFacet,
                facetKey,
              );

            return [
              facetKey,
              ResourceFacetResolver.mergeCounts(
                listed[facetKey] || [],
                ResourceFacetPlanner.toCountMap(values),
              ),
            ] as const;
          },
        ),
      );

    return Object.fromEntries(results);
  }

  public static toCountMap(
    values: Array<PlannedFacetValue>,
  ): Map<string, number> {
    const counts: Map<string, number> = new Map<string, number>();

    for (const facetValue of values) {
      counts.set(facetValue.value, facetValue.count);
    }

    return counts;
  }

  private static async countOrEmpty(
    countFacet: FacetValueCounter,
    facetKey: string,
  ): Promise<Array<PlannedFacetValue>> {
    try {
      return await countFacet(facetKey);
    } catch {
      return [];
    }
  }
}

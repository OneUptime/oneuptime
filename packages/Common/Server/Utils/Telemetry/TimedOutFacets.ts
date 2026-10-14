import ClickhouseReadResult from "../AnalyticsDatabase/ClickhouseReadResult";

/*
 * The facets a facets request could not count in time (issue #4707).
 *
 * The facet endpoints count each facet on its own and let a failing count
 * cost that facet its values, never the whole response: a slow facet must not
 * starve the sidebar. But a count stopped at the query time limit used to
 * look exactly like a facet with nothing in it ("No values"), or a resource
 * list with every count at 0. Each endpoint now names those facets in its
 * response, as `timedOutFacets`, so the sidebar can say the counts took too
 * long instead of showing numbers that are not true.
 *
 * Usage: wrap each facet's count in watch(); a stop at the time limit is
 * recorded under the facet keys it leaves uncounted and rethrown, so the
 * caller's own degrade-to-empty handling still runs. Any other failure is
 * rethrown untouched and not recorded.
 */
export default class TimedOutFacets {
  private readonly keys: Set<string> = new Set<string>();

  public async watch<T>(
    facetKeys: string | Array<string>,
    count: () => Promise<T>,
  ): Promise<T> {
    try {
      return await count();
    } catch (error) {
      if (ClickhouseReadResult.isTimeLimitError(error)) {
        for (const facetKey of Array.isArray(facetKeys)
          ? facetKeys
          : [facetKeys]) {
          this.keys.add(facetKey);
        }
      }

      throw error;
    }
  }

  public has(facetKey: string): boolean {
    return this.keys.has(facetKey);
  }

  // In the order they were first recorded.
  public toArray(): Array<string> {
    return Array.from(this.keys);
  }
}

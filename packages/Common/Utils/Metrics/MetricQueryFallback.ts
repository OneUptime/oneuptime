import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import MetricAliasData from "../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import MetricQueryFallback, {
  MetricQueryFallbackHint,
} from "../../Types/Metrics/MetricQueryFallback";

/*
 * Which query a chart draws in each of its slots, for queries that carry a
 * fallback (Types/Metrics/MetricQueryFallback).
 *
 * A chart fetches its queries as it always has. Only when a query with a
 * fallback comes back with no data does it fetch again, with the fallback
 * in that query's slot (getFallbackQueryConfigs); resolve() then keeps a
 * fallback only where it has data, so:
 *
 *   - main has data          -> the main query, as fetched;
 *   - main empty, fallback has data -> the fallback, and its hint;
 *   - both empty             -> the main query, empty, as without a fallback.
 *
 * A chart none of whose queries has a fallback gets back exactly what it
 * passed in, the same arrays, and never a second request.
 *
 * Pure and React-free, so the suites read it without a browser, and every
 * chart surface that wants fallbacks can share it.
 */

export interface ChartedMetricQueries {
  // The query drawn in each slot: its own, or its fallback where it fell back.
  queryConfigs: Array<MetricQueryConfigData>;
  // What is drawn: one result per query, then one per formula.
  results: Array<AggregatedResult>;
  // The slots drawn from their fallback, in order.
  fallbackIndexes: Array<number>;
}

// The longest link a hint draws; a docs path or an address is far shorter.
const MAX_HINT_LINK_LENGTH: number = 2048;

export default class MetricQueryFallbackUtil {
  /*
   * Whether a result has something to draw: at least one point with a
   * finite value. A formula that failed (errorMessage, no rows) has none.
   */
  public static hasData(result: AggregatedResult | undefined | null): boolean {
    if (!result || !Array.isArray(result.data)) {
      return false;
    }

    return result.data.some((row: AggregatedModel): boolean => {
      return MetricQueryFallbackUtil.isDrawablePoint(row);
    });
  }

  /*
   * The query drawn in a slot when it falls back, or undefined when the
   * query has no usable fallback (none, or one without a metric). It is the
   * fallback's own query, with:
   *
   *   - the main query's variable, so formulas over the slot keep reading it;
   *   - the main query's chart type and overlay when the fallback sets
   *     neither, so it is drawn where and as the main query would be;
   *   - no fallback of its own: fallbacks do not chain.
   */
  public static getFallbackQueryConfig(
    queryConfig: MetricQueryConfigData | undefined,
  ): MetricQueryConfigData | undefined {
    const fallback: MetricQueryFallback | undefined = queryConfig?.fallback;
    const fallbackQueryConfig: MetricQueryConfigData | undefined =
      fallback?.queryConfig;

    if (
      !queryConfig ||
      !fallbackQueryConfig ||
      !fallbackQueryConfig.metricQueryData?.filterData?.metricName
    ) {
      return undefined;
    }

    const alias: MetricAliasData | undefined =
      fallbackQueryConfig.metricAliasData;

    const charted: MetricQueryConfigData = {
      ...fallbackQueryConfig,
      metricAliasData: {
        title: alias?.title,
        description: alias?.description,
        legend: alias?.legend,
        legendUnit: alias?.legendUnit,
        metricVariable:
          queryConfig.metricAliasData?.metricVariable ?? alias?.metricVariable,
      },
      chartType: fallbackQueryConfig.chartType ?? queryConfig.chartType,
      overlayWithPreviousQuery:
        fallbackQueryConfig.overlayWithPreviousQuery ??
        queryConfig.overlayWithPreviousQuery,
    };

    delete charted.fallback;

    return charted;
  }

  /*
   * The slots that fall back given the main queries' results: those with a
   * usable fallback whose own result has no data.
   */
  public static getFallbackCandidates(
    queryConfigs: Array<MetricQueryConfigData>,
    results: Array<AggregatedResult>,
  ): Array<number> {
    const candidates: Array<number> = [];

    queryConfigs.forEach(
      (queryConfig: MetricQueryConfigData, index: number): void => {
        if (
          MetricQueryFallbackUtil.getFallbackQueryConfig(queryConfig) &&
          !MetricQueryFallbackUtil.hasData(results[index])
        ) {
          candidates.push(index);
        }
      },
    );

    return candidates;
  }

  /*
   * The queries with the fallback in each of the given slots, or the very
   * same array when no slot changes (no slots, or none with a fallback).
   */
  public static withFallbacks(
    queryConfigs: Array<MetricQueryConfigData>,
    fallbackIndexes: Array<number>,
  ): Array<MetricQueryConfigData> {
    if (fallbackIndexes.length === 0) {
      return queryConfigs;
    }

    const slots: Set<number> = new Set<number>(fallbackIndexes);
    let changed: boolean = false;

    const charted: Array<MetricQueryConfigData> = queryConfigs.map(
      (queryConfig: MetricQueryConfigData, index: number) => {
        if (!slots.has(index)) {
          return queryConfig;
        }

        const fallbackQueryConfig: MetricQueryConfigData | undefined =
          MetricQueryFallbackUtil.getFallbackQueryConfig(queryConfig);

        if (!fallbackQueryConfig) {
          return queryConfig;
        }

        changed = true;
        return fallbackQueryConfig;
      },
    );

    return changed ? charted : queryConfigs;
  }

  /*
   * What to fetch the second time: the queries with every candidate's
   * fallback in its slot. Null when no slot falls back, so a chart whose
   * queries all have data, or have no fallback, makes no second request.
   */
  public static getFallbackQueryConfigs(
    queryConfigs: Array<MetricQueryConfigData>,
    results: Array<AggregatedResult>,
  ): Array<MetricQueryConfigData> | null {
    const candidates: Array<number> =
      MetricQueryFallbackUtil.getFallbackCandidates(queryConfigs, results);

    if (candidates.length === 0) {
      return null;
    }

    return MetricQueryFallbackUtil.withFallbacks(queryConfigs, candidates);
  }

  /*
   * What the chart draws, from the main queries' results and - when it was
   * fetched - the results of getFallbackQueryConfigs(). A fallback is kept
   * only in a candidate slot where it has data; when none is, the main
   * queries and their results come back as they were. Without
   * fallbackResults (not fetched, or the fetch failed) nothing falls back.
   */
  public static resolve(input: {
    queryConfigs: Array<MetricQueryConfigData>;
    results: Array<AggregatedResult>;
    fallbackResults?: Array<AggregatedResult> | undefined;
  }): ChartedMetricQueries {
    const unchanged: ChartedMetricQueries = {
      queryConfigs: input.queryConfigs,
      results: input.results,
      fallbackIndexes: [],
    };

    const fallbackResults: Array<AggregatedResult> | undefined =
      input.fallbackResults;

    if (!fallbackResults) {
      return unchanged;
    }

    const fallbackIndexes: Array<number> =
      MetricQueryFallbackUtil.getFallbackCandidates(
        input.queryConfigs,
        input.results,
      ).filter((index: number): boolean => {
        return MetricQueryFallbackUtil.hasData(fallbackResults[index]);
      });

    if (fallbackIndexes.length === 0) {
      return unchanged;
    }

    /*
     * The second fetch's results throughout: they were read together, so
     * the formulas in them were worked out over the fallbacks drawn. A
     * candidate slot kept on its main query has no data in either fetch.
     */
    return {
      queryConfigs: MetricQueryFallbackUtil.withFallbacks(
        input.queryConfigs,
        fallbackIndexes,
      ),
      results: fallbackResults,
      fallbackIndexes: fallbackIndexes,
    };
  }

  /*
   * The hints of the slots drawn from their fallback, each once, in slot
   * order. A hint without text says nothing and is left out.
   */
  public static getHints(
    queryConfigs: Array<MetricQueryConfigData>,
    fallbackIndexes: Array<number>,
  ): Array<MetricQueryFallbackHint> {
    const hints: Array<MetricQueryFallbackHint> = [];
    const seen: Set<string> = new Set<string>();

    for (const index of [...fallbackIndexes].sort(
      (a: number, b: number): number => {
        return a - b;
      },
    )) {
      const hint: MetricQueryFallbackHint | undefined =
        queryConfigs[index]?.fallback?.hint;

      if (!hint || typeof hint.text !== "string" || !hint.text.trim()) {
        continue;
      }

      const key: string = JSON.stringify([
        hint.text,
        hint.linkText || "",
        hint.linkUrl || "",
      ]);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      hints.push(hint);
    }

    return hints;
  }

  /*
   * A hint's link as a chart may draw it: a path on this installation
   * ("/docs/...") or an http(s) address. Anything else - "javascript:",
   * "data:", a protocol-relative "//host", a URL with spaces or control
   * characters a browser would strip - is left out, so a stored config can
   * never put a script or another site's address behind a hint's link.
   */
  public static getSafeLinkUrl(
    linkUrl: string | undefined | null,
  ): string | undefined {
    if (typeof linkUrl !== "string") {
      return undefined;
    }

    if (linkUrl.length === 0 || linkUrl.length > MAX_HINT_LINK_LENGTH) {
      return undefined;
    }

    for (let index: number = 0; index < linkUrl.length; index++) {
      const code: number = linkUrl.charCodeAt(index);

      // Spaces, controls, DEL and the backslash browsers read as "/".
      if (code <= 0x20 || code === 0x7f || code === 0x5c) {
        return undefined;
      }
    }

    if (linkUrl.startsWith("/")) {
      return linkUrl.startsWith("//") ? undefined : linkUrl;
    }

    const lowerCased: string = linkUrl.toLowerCase();

    if (
      (lowerCased.startsWith("https://") || lowerCased.startsWith("http://")) &&
      linkUrl.length > lowerCased.indexOf("//") + 2
    ) {
      return linkUrl;
    }

    return undefined;
  }

  // Whether two lists of slots are the same, so a host can keep its state.
  public static isSameFallbackIndexes(
    first: Array<number>,
    second: Array<number>,
  ): boolean {
    return (
      first.length === second.length &&
      first.every((index: number, position: number): boolean => {
        return index === second[position];
      })
    );
  }

  private static isDrawablePoint(row: AggregatedModel | undefined): boolean {
    const value: unknown = row?.value;

    if (typeof value === "number") {
      return Number.isFinite(value);
    }

    if (typeof value === "string" && value.trim().length > 0) {
      return Number.isFinite(Number(value));
    }

    return false;
  }
}

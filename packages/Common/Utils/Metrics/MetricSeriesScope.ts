import IsNull from "../../Types/BaseDatabase/IsNull";
import Dictionary from "../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../Types/JSON";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../Types/Metrics/MetricQueryData";
import MetricViewData from "../../Types/Metrics/MetricViewData";

/**
 * The value we can put back on a metric query's attribute filter for one
 * group-by key. A plain string is an exact equality filter; `IsNull` is
 * the "is empty" operator, which the analytics layer compiles to
 * "key absent OR value is the empty string" — exactly what an empty
 * series label means.
 */
export type MetricSeriesFilterValue = string | IsNull;

/**
 * A metric monitor grouped by, say, `host.name` evaluates one series per
 * host and opens ONE incident per breaching host — the affected series is
 * recorded on the incident as `seriesLabels` (e.g. `{host.name: prod-01}`).
 * The monitor's stored query configs, however, are shared by every series
 * it produced: replaying them verbatim on the incident page charts EVERY
 * host, so an incident about one host renders a wall of unrelated lines
 * and (worse) the breaching host can be dropped entirely by the Top-N cap.
 *
 * This narrows those query configs back down to the one series the
 * incident/alert is actually about, by pushing the series labels into the
 * query's attribute filter. Grouping is deliberately left in place: with
 * the filter applied it yields exactly one series, and the legend still
 * names it ("host.name=prod-01") instead of collapsing to a bare metric
 * name.
 *
 * Everything here is pure and identity-preserving — when there is nothing
 * to narrow, the very same objects come back out, so React hosts can call
 * it without churning state.
 */
export default class MetricSeriesScope {
  // How an empty (unset) label value is rendered in human-facing summaries.
  public static readonly UnsetLabelDisplayValue: string = "(unset)";

  public static hasSeriesLabels(
    seriesLabels: JSONObject | null | undefined,
  ): boolean {
    return Boolean(seriesLabels && Object.keys(seriesLabels).length > 0);
  }

  /**
   * Turn one series-label value into something the metric attribute
   * filter can express. Returns null when the value cannot be filtered
   * on at all — the caller then leaves that key alone rather than
   * emitting a predicate that would silently match nothing.
   */
  private static toFilterValue(
    value: JSONValue | undefined,
  ): MetricSeriesFilterValue | null {
    if (value === undefined || value === null) {
      return new IsNull();
    }

    if (typeof value === "string") {
      /*
       * "" is what the series builder writes when the attribute is
       * missing on the sample, so the series really is "rows with no
       * value for this key" — that is the IsEmpty operator, not an
       * equality against the empty string (which the UI's filter
       * sanitizer would drop on the floor anyway).
       */
      if (value === "") {
        return new IsNull();
      }

      /*
       * Whitespace-only is neither: an equality filter on it is dropped
       * by the sanitizer, and treating it as "unset" would be a lie. Skip
       * the key instead.
       */
      if (value.trim() === "") {
        return null;
      }

      return value;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value) : null;
    }

    if (typeof value === "boolean") {
      return String(value);
    }

    /*
     * Arrays, nested objects and Dates have no faithful representation as
     * a metric attribute equality filter (attributes are a
     * Map(String, String) in the analytics store), so they are skipped.
     */
    return null;
  }

  /**
   * The attribute filters that scope ONE query config to the given
   * series.
   *
   * Only the keys this query actually groups by are considered. The
   * monitor worker groups every query by the UNION of the group-by keys
   * across all query configs (so per-series formulas line up), which
   * means `seriesLabels` routinely carries keys a given query never asked
   * for — filtering a query on a dimension it does not group by would
   * narrow the chart to something the monitor never evaluated.
   */
  public static getSeriesFilterAttributesForQuery(input: {
    queryConfig: MetricQueryConfigData | undefined | null;
    seriesLabels: JSONObject | null | undefined;
  }): Dictionary<MetricSeriesFilterValue> {
    const filters: Dictionary<MetricSeriesFilterValue> = {};

    const seriesLabels: JSONObject | null | undefined = input.seriesLabels;

    if (
      !input.queryConfig ||
      !MetricSeriesScope.hasSeriesLabels(seriesLabels)
    ) {
      return filters;
    }

    const groupByAttributeKeys: Array<string> =
      input.queryConfig.metricQueryData?.groupByAttributeKeys || [];

    for (const key of groupByAttributeKeys) {
      if (!key) {
        continue;
      }

      // Key not on the incident's series — we know nothing, so filter nothing.
      if (!Object.prototype.hasOwnProperty.call(seriesLabels, key)) {
        continue;
      }

      const filterValue: MetricSeriesFilterValue | null =
        MetricSeriesScope.toFilterValue(
          (seriesLabels as JSONObject)[key] as JSONValue | undefined,
        );

      if (filterValue === null) {
        continue;
      }

      filters[key] = filterValue;
    }

    return filters;
  }

  /**
   * Narrow every query config to the incident's/alert's own series.
   * Returns the input array unchanged (same reference) when there is
   * nothing to narrow.
   */
  public static scopeQueryConfigsToSeries(input: {
    queryConfigs: Array<MetricQueryConfigData> | undefined | null;
    seriesLabels: JSONObject | null | undefined;
  }): Array<MetricQueryConfigData> {
    const queryConfigs: Array<MetricQueryConfigData> = input.queryConfigs || [];

    if (!MetricSeriesScope.hasSeriesLabels(input.seriesLabels)) {
      return queryConfigs;
    }

    let didNarrowAny: boolean = false;

    const scopedQueryConfigs: Array<MetricQueryConfigData> = queryConfigs.map(
      (queryConfig: MetricQueryConfigData) => {
        const filters: Dictionary<MetricSeriesFilterValue> =
          MetricSeriesScope.getSeriesFilterAttributesForQuery({
            queryConfig: queryConfig,
            seriesLabels: input.seriesLabels,
          });

        if (Object.keys(filters).length === 0) {
          return queryConfig;
        }

        didNarrowAny = true;

        const metricQueryData: MetricQueryData = queryConfig.metricQueryData;

        const existingAttributes: Dictionary<unknown> =
          ((metricQueryData?.filterData as Dictionary<unknown> | undefined)?.[
            "attributes"
          ] as Dictionary<unknown> | undefined) || {};

        return {
          ...queryConfig,
          metricQueryData: {
            ...metricQueryData,
            filterData: {
              ...(metricQueryData?.filterData || {}),
              /*
               * Series labels win over any filter the monitor already
               * carried for the same key — they are strictly narrower,
               * and they describe the series this incident is about.
               */
              attributes: {
                ...existingAttributes,
                ...filters,
              },
            },
          },
        } as MetricQueryConfigData;
      },
    );

    return didNarrowAny ? scopedQueryConfigs : queryConfigs;
  }

  /**
   * Convenience wrapper for the places that hold a whole MetricViewData
   * (the incident/alert "Metrics" cards read one straight off the stored
   * telemetryQuery). Identity-preserving like the array form.
   */
  public static scopeMetricViewDataToSeries<T extends MetricViewData>(input: {
    metricViewData: T | null | undefined;
    seriesLabels: JSONObject | null | undefined;
  }): T | null | undefined {
    const metricViewData: T | null | undefined = input.metricViewData;

    if (!metricViewData || !metricViewData.queryConfigs) {
      /*
       * `queryConfigs` is non-optional on the type, but this data comes
       * from stored JSON. Returning early keeps the identity contract and
       * avoids quietly rewriting a missing list into an empty one.
       */
      return metricViewData;
    }

    const scopedQueryConfigs: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs: metricViewData.queryConfigs,
        seriesLabels: input.seriesLabels,
      });

    if (scopedQueryConfigs === metricViewData.queryConfigs) {
      return metricViewData;
    }

    return {
      ...metricViewData,
      queryConfigs: scopedQueryConfigs,
    };
  }

  /**
   * "host.name = prod-01, service.name = api" — a one-line description of
   * the narrowing that was ACTUALLY applied to these query configs, for
   * card subtitles.
   *
   * Deliberately derived from the filters rather than from the raw labels:
   * a label the queries never grouped by, or one whose value has no
   * faithful filter form (an array, a whitespace-only string), does not
   * narrow anything. Summarising it anyway would have the card claim
   * "scoped to the affected series" over a chart that still shows every
   * series — a worse failure than the bug this class fixes.
   *
   * Returns "" when nothing was narrowed, which is exactly the condition
   * for the card to say nothing.
   */
  public static getAppliedSeriesLabelSummary(input: {
    queryConfigs: Array<MetricQueryConfigData> | undefined | null;
    seriesLabels: JSONObject | null | undefined;
  }): string {
    const parts: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const queryConfig of input.queryConfigs || []) {
      const filters: Dictionary<MetricSeriesFilterValue> =
        MetricSeriesScope.getSeriesFilterAttributesForQuery({
          queryConfig: queryConfig,
          seriesLabels: input.seriesLabels,
        });

      for (const key of Object.keys(filters)) {
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const filterValue: MetricSeriesFilterValue | undefined = filters[key];

        parts.push(
          `${key} = ${
            typeof filterValue === "string"
              ? filterValue
              : MetricSeriesScope.UnsetLabelDisplayValue
          }`,
        );
      }
    }

    return parts.join(", ");
  }
}

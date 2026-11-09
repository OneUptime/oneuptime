import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricExplorerUrl, {
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import {
  buildFormulaConfigsFromSerializedFormulas,
  buildQueryConfigsFromSerializedQueries,
} from "../Utils/MetricConfigReconstruct";

/*
 * The metrics a metric investigation charts: its queries and formulas, the
 * same shapes the metric explorer and its query builder work on.
 *
 * Two lists of queries are the same when they chart the same thing. They
 * are compared through the explorer's own URL serializer, so what a query
 * carries only at run time (its id, a series namer, a value transform) never
 * makes an untouched investigation look changed, and a filter means the same
 * thing here as in a link to the explorer.
 */

export interface MetricInvestigationQueries {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
}

// How the queries are kept in the URL; see toUrlValue.
export interface MetricInvestigationQueriesUrlValue {
  // JSON, in the explorer's `metricQueries` format.
  queries: string;
  // JSON, in the explorer's `metricFormulas` format, when there are any.
  formulas?: string | undefined;
}

const EMPTY_QUERIES: MetricInvestigationQueries = {
  queryConfigs: [],
  formulaConfigs: [],
};

export default class MetricInvestigationQueryUtil {
  // Never null: a host's missing list is an empty one.
  public static normalize(
    queries: Partial<MetricInvestigationQueries> | null | undefined,
  ): MetricInvestigationQueries {
    if (!queries) {
      return EMPTY_QUERIES;
    }

    const queryConfigs: Array<MetricQueryConfigData> = Array.isArray(
      queries.queryConfigs,
    )
      ? queries.queryConfigs
      : [];
    const formulaConfigs: Array<MetricFormulaConfigData> = Array.isArray(
      queries.formulaConfigs,
    )
      ? queries.formulaConfigs
      : [];

    if (
      queryConfigs === queries.queryConfigs &&
      formulaConfigs === queries.formulaConfigs
    ) {
      return queries as MetricInvestigationQueries;
    }

    return { queryConfigs: queryConfigs, formulaConfigs: formulaConfigs };
  }

  public static serializeQueries(
    queries: MetricInvestigationQueries,
  ): Array<SerializedMetricQuery> {
    return queries.queryConfigs.map(
      (queryConfig: MetricQueryConfigData): SerializedMetricQuery => {
        return MetricExplorerUrl.buildSerializedMetricQuery(queryConfig);
      },
    );
  }

  public static serializeFormulas(
    queries: MetricInvestigationQueries,
  ): Array<SerializedMetricFormula> {
    return queries.formulaConfigs.map(
      (formulaConfig: MetricFormulaConfigData): SerializedMetricFormula => {
        return MetricExplorerUrl.buildSerializedMetricFormula(formulaConfig);
      },
    );
  }

  /*
   * The queries' value as a string: equal for two lists that chart the same
   * thing, in the same order. A query still waiting for its metric counts,
   * so adding one is a change until it is removed again.
   */
  public static getKey(
    queries: MetricInvestigationQueries | null | undefined,
  ): string {
    const normalized: MetricInvestigationQueries =
      MetricInvestigationQueryUtil.normalize(queries);

    return JSON.stringify({
      queries: MetricInvestigationQueryUtil.serializeQueries(normalized),
      formulas: MetricInvestigationQueryUtil.serializeFormulas(normalized),
    });
  }

  public static isSame(
    first: MetricInvestigationQueries | null | undefined,
    second: MetricInvestigationQueries | null | undefined,
  ): boolean {
    if (first === second) {
      return true;
    }

    return (
      MetricInvestigationQueryUtil.getKey(first) ===
      MetricInvestigationQueryUtil.getKey(second)
    );
  }

  // Whether any query has its metric picked, so there is a chart to draw.
  public static hasAnyMetric(
    queries: MetricInvestigationQueries | null | undefined,
  ): boolean {
    return MetricInvestigationQueryUtil.normalize(queries).queryConfigs.some(
      (queryConfig: MetricQueryConfigData): boolean => {
        return Boolean(
          queryConfig.metricQueryData?.filterData?.metricName?.toString(),
        );
      },
    );
  }

  /*
   * How the queries are kept in the URL: the explorer's own formats, with
   * what charts nothing (a query still waiting for its metric, a blank
   * formula) left out. Null when nothing is left to keep.
   */
  public static toUrlValue(
    queries: MetricInvestigationQueries,
  ): MetricInvestigationQueriesUrlValue | null {
    const normalized: MetricInvestigationQueries =
      MetricInvestigationQueryUtil.normalize(queries);

    const serializedQueries: Array<SerializedMetricQuery> =
      MetricInvestigationQueryUtil.serializeQueries(normalized).filter(
        MetricExplorerUrl.isMeaningfulMetricQuery,
      );

    if (serializedQueries.length === 0) {
      return null;
    }

    const serializedFormulas: Array<SerializedMetricFormula> =
      MetricInvestigationQueryUtil.serializeFormulas(normalized).filter(
        MetricExplorerUrl.isMeaningfulMetricFormula,
      );

    return {
      queries: JSON.stringify(serializedQueries),
      ...(serializedFormulas.length > 0
        ? { formulas: JSON.stringify(serializedFormulas) }
        : {}),
    };
  }

  /*
   * The queries a URL keeps, rebuilt the way the explorer rebuilds its own
   * links (MetricExplorerUrl's defensive parsers: garbage is dropped, never
   * thrown). Null when the URL keeps no query at all.
   */
  public static fromUrlValue(input: {
    queries: string | null | undefined;
    formulas?: string | null | undefined;
  }): MetricInvestigationQueries | null {
    if (!input.queries) {
      return null;
    }

    const serializedQueries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(input.queries).filter(
        MetricExplorerUrl.isMeaningfulMetricQuery,
      );

    if (serializedQueries.length === 0) {
      return null;
    }

    const serializedFormulas: Array<SerializedMetricFormula> = input.formulas
      ? MetricExplorerUrl.parseMetricFormulasParam(input.formulas).filter(
          MetricExplorerUrl.isMeaningfulMetricFormula,
        )
      : [];

    const queryConfigs: Array<MetricQueryConfigData> =
      buildQueryConfigsFromSerializedQueries(serializedQueries);

    return {
      queryConfigs: queryConfigs,
      formulaConfigs: buildFormulaConfigsFromSerializedFormulas(
        serializedFormulas,
        queryConfigs.length,
      ),
    };
  }
}

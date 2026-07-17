import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import ObjectID from "Common/Types/ObjectID";
import Text from "Common/Types/Text";
import {
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";

/*
 * Rebuild chart-builder configs from the shared serializer's plain-data
 * shapes (URL params, saved explorer views, monitor pre-seed links). Only
 * plain data is reconstructed here — runtime-injected function fields
 * (getSeries, yAxisValueFormatter, transformValue) are attached downstream
 * in MetricView before render, same as for queries built in the UI. Every
 * query gets a fresh stable `id` (the serializer never carries one) so
 * per-chart UI state keys correctly from the first render.
 */

type BuildQueryConfigsFunction = (
  metricQueries: Array<SerializedMetricQuery>,
) => Array<MetricQueryConfigData>;

export const buildQueryConfigsFromSerializedQueries: BuildQueryConfigsFunction =
  (
    metricQueries: Array<SerializedMetricQuery>,
  ): Array<MetricQueryConfigData> => {
    return metricQueries.map(
      (
        metricQuery: SerializedMetricQuery,
        index: number,
      ): MetricQueryConfigData => {
        return {
          id: ObjectID.generate().toString(),
          metricAliasData: {
            /*
             * Prefer the serialized variable so formulas referencing it
             * keep resolving when the captured view's variables were not
             * positional; older links without it fall back to positional
             * lettering (a, b, ...), matching their formulas' era.
             */
            metricVariable:
              metricQuery.variable || Text.getLetterFromAByNumber(index),
            title: metricQuery.alias?.title || "",
            description: metricQuery.alias?.description || "",
            legend: metricQuery.alias?.legend || "",
            legendUnit: metricQuery.alias?.legendUnit || "",
          },
          metricQueryData: {
            filterData: {
              metricName: metricQuery.metricName,
              attributes: metricQuery.attributes || {},
              aggegationType:
                metricQuery.aggregationType || MetricsAggregationType.Avg,
            },
            ...(metricQuery.groupByAttributeKeys &&
            metricQuery.groupByAttributeKeys.length > 0
              ? { groupByAttributeKeys: metricQuery.groupByAttributeKeys }
              : {}),
            ...(metricQuery.topN !== undefined
              ? { topN: metricQuery.topN }
              : {}),
          },
          ...(metricQuery.chartType
            ? { chartType: metricQuery.chartType }
            : {}),
          ...(metricQuery.color ? { color: metricQuery.color } : {}),
          ...(metricQuery.colorsByGroup
            ? { colorsByGroup: metricQuery.colorsByGroup }
            : {}),
          ...(metricQuery.warningThreshold !== undefined
            ? { warningThreshold: metricQuery.warningThreshold }
            : {}),
          ...(metricQuery.criticalThreshold !== undefined
            ? { criticalThreshold: metricQuery.criticalThreshold }
            : {}),
          ...(metricQuery.transformAsRate === true
            ? { transformAsRate: true }
            : {}),
          ...(metricQuery.overlayWithPreviousQuery === true
            ? { overlayWithPreviousQuery: true }
            : {}),
        };
      },
    );
  };

type BuildFormulaConfigsFunction = (
  metricFormulas: Array<SerializedMetricFormula>,
  queryConfigCount: number,
) => Array<MetricFormulaConfigData>;

export const buildFormulaConfigsFromSerializedFormulas: BuildFormulaConfigsFunction =
  (
    metricFormulas: Array<SerializedMetricFormula>,
    queryConfigCount: number,
  ): Array<MetricFormulaConfigData> => {
    return metricFormulas.map(
      (
        formula: SerializedMetricFormula,
        index: number,
      ): MetricFormulaConfigData => {
        /*
         * Default formula variable letters start after the queries so they
         * don't collide with query aliases (a, b, ...).
         */
        const defaultVariable: string = Text.getLetterFromAByNumber(
          queryConfigCount + index,
        );
        return {
          metricAliasData: {
            metricVariable: formula.variable || defaultVariable,
            title: formula.alias?.title || "",
            description: formula.alias?.description || "",
            legend: formula.alias?.legend || "",
            legendUnit: formula.alias?.legendUnit || "",
          },
          metricFormulaData: {
            metricFormula: formula.formula,
          },
          ...(formula.chartType ? { chartType: formula.chartType } : {}),
          ...(formula.color ? { color: formula.color } : {}),
          ...(formula.warningThreshold !== undefined
            ? { warningThreshold: formula.warningThreshold }
            : {}),
          ...(formula.criticalThreshold !== undefined
            ? { criticalThreshold: formula.criticalThreshold }
            : {}),
        };
      },
    );
  };

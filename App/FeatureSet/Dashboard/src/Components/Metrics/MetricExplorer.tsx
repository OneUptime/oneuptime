import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricView from "./MetricView";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import Dictionary from "Common/Types/Dictionary";
import Text from "Common/Types/Text";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";

const MetricExplorer: FunctionComponent = (): ReactElement => {
  const metricQueriesFromUrl: Array<SerializedMetricQuery> =
    getMetricQueriesFromQuery();

  const metricFormulasFromUrl: Array<SerializedMetricFormula> =
    getMetricFormulasFromQuery();

  const defaultEndDate: Date = OneUptimeDate.getCurrentDate();
  const defaultStartDate: Date = OneUptimeDate.addRemoveHours(
    defaultEndDate,
    -1,
  );
  const defaultStartAndEndDate: InBetween<Date> = new InBetween(
    defaultStartDate,
    defaultEndDate,
  );

  const initialTimeRange: InBetween<Date> =
    getTimeRangeFromQuery() ?? defaultStartAndEndDate;

  const initialQueryConfigs: Array<MetricQueryConfigData> =
    metricQueriesFromUrl.map(
      (
        metricQuery: SerializedMetricQuery,
        index: number,
      ): MetricQueryConfigData => {
        /*
         * Only plain data is reconstructed here. Runtime-injected
         * function fields (getSeries, yAxisValueFormatter,
         * transformValue) are attached downstream in MetricView before
         * render, same as for queries built in the UI.
         */
        return {
          metricAliasData: {
            metricVariable: Text.getLetterFromAByNumber(index),
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

  const initialFormulaConfigs: Array<MetricFormulaConfigData> =
    metricFormulasFromUrl.map(
      (
        formula: SerializedMetricFormula,
        index: number,
      ): MetricFormulaConfigData => {
        /*
         * Default formula variable letters start after the queries so they
         * don't collide with query aliases (a, b, ...).
         */
        const defaultVariable: string = Text.getLetterFromAByNumber(
          initialQueryConfigs.length + index,
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
        };
      },
    );

  const [metricViewData, setMetricViewData] = React.useState<MetricViewData>({
    startAndEndDate: initialTimeRange,
    queryConfigs:
      initialQueryConfigs.length > 0
        ? initialQueryConfigs
        : [
            {
              metricAliasData: {
                metricVariable: "a",
                title: "",
                description: "",
                legend: "",
                legendUnit: "",
              },
              metricQueryData: {
                filterData: {
                  metricName: "",
                  attributes: {},
                  aggegationType: MetricsAggregationType.Avg,
                },
              },
            },
          ],
    formulaConfigs: initialFormulaConfigs,
  });

  const lastSerializedStateRef: React.MutableRefObject<string> =
    useRef<string>("");

  useEffect(() => {
    const urlParams: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData(metricViewData);

    const serializedState: string = JSON.stringify(urlParams);

    if (serializedState === lastSerializedStateRef.current) {
      return;
    }

    const params: URLSearchParams = new URLSearchParams(window.location.search);

    for (const paramName of Object.values(MetricExplorerUrlParam)) {
      const paramValue: string | undefined = urlParams[paramName];

      if (paramValue !== undefined) {
        params.set(paramName, paramValue);
      } else {
        params.delete(paramName);
      }
    }

    params.delete("metricName");
    params.delete("attributes");
    params.delete("serviceName");

    const newQueryString: string = params.toString();
    const newUrl: string =
      newQueryString.length > 0
        ? `${window.location.pathname}?${newQueryString}`
        : window.location.pathname;

    window.history.replaceState({}, "", newUrl);

    lastSerializedStateRef.current = serializedState;
  }, [metricViewData]);

  return (
    <MetricView
      data={metricViewData}
      onChange={(data: MetricViewData) => {
        setMetricViewData(data);
      }}
    />
  );
};

export default MetricExplorer;

function getMetricQueriesFromQuery(): Array<SerializedMetricQuery> {
  const metricQueriesParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.MetricQueries,
  );

  if (!metricQueriesParam) {
    return [];
  }

  return MetricExplorerUrl.parseMetricQueriesParam(metricQueriesParam);
}

function getMetricFormulasFromQuery(): Array<SerializedMetricFormula> {
  const formulasParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.MetricFormulas,
  );

  if (!formulasParam) {
    return [];
  }

  return MetricExplorerUrl.parseMetricFormulasParam(formulasParam);
}

function getTimeRangeFromQuery(): InBetween<Date> | null {
  const startTimeParam: string | null =
    Navigation.getQueryStringByName("startTime");
  const endTimeParam: string | null =
    Navigation.getQueryStringByName("endTime");

  if (!startTimeParam || !endTimeParam) {
    return null;
  }

  if (
    !OneUptimeDate.isValidDateString(startTimeParam) ||
    !OneUptimeDate.isValidDateString(endTimeParam)
  ) {
    return null;
  }

  try {
    const startDate: Date = OneUptimeDate.fromString(startTimeParam);
    const endDate: Date = OneUptimeDate.fromString(endTimeParam);

    if (!OneUptimeDate.isOnOrBefore(startDate, endDate)) {
      return null;
    }

    return new InBetween(startDate, endDate);
  } catch {
    return null;
  }
}

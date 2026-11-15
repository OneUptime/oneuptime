import React, { FunctionComponent, ReactElement, useMemo } from "react";
import ObjectID from "Common/Types/ObjectID";
import Search from "Common/Types/BaseDatabase/Search";
import IncidentMetricType from "Common/Types/Incident/IncidentMetricType";
import IncidentMetricTypeUtil from "Common/Utils/Incident/IncidentMetricType";
import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import TimeRange from "Common/Types/Time/TimeRange";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { chartWordsInReadersLanguage } from "../Metrics/Utils/ChartWordsInReadersLanguage";

export interface ComponentProps {
  monitorId: ObjectID;
}

const MonitorIncidentMetrics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const monitorIdString: string = props.monitorId.toString();
  const incidentMetricTypes: Array<IncidentMetricType> =
    IncidentMetricTypeUtil.getAllIncidentMetricTypes();

  type GetQueryConfigsFunction = () => Array<MetricQueryConfigData>;

  const getQueryConfigs: GetQueryConfigsFunction =
    (): Array<MetricQueryConfigData> => {
      const queries: Array<MetricQueryConfigData> = [];

      for (const metricType of incidentMetricTypes) {
        queries.push({
          metricAliasData: {
            metricVariable: metricType,
            title:
              IncidentMetricTypeUtil.getTitleByIncidentMetricType(metricType),
            description:
              IncidentMetricTypeUtil.getDescriptionByIncidentMetricType(
                metricType,
              ),
            legend:
              IncidentMetricTypeUtil.getLegendByIncidentMetricType(metricType),
            legendUnit:
              IncidentMetricTypeUtil.getLegendUnitByIncidentMetricType(
                metricType,
              ),
          },
          metricQueryData: {
            filterData: {
              metricName: metricType,
              attributes: {
                monitorIds: new Search(props.monitorId.toString()),
                projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
              },
              aggegationType:
                IncidentMetricTypeUtil.getAggregationTypeByIncidentMetricType(
                  metricType,
                ),
            },
            groupBy: undefined,
          },
          chartType: MetricChartType.BAR,
        });
      }

      return queries;
    };

  /*
   * Each chart's title, legend and what it shows go to the chart in the
   * reader's language, looked up once here: the charts draw them as they
   * are handed them, and IncidentMetricTypeUtil writes them in English (#8282).
   * Built again only for another monitor or another language, so the card
   * does not fetch again on every render.
   */
  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    return chartWordsInReadersLanguage(getQueryConfigs(), translator);
  }, [monitorIdString, translator.language]);

  return (
    <EmbeddedMetricCard
      title="Incident Metrics"
      description="Incident metrics for this monitor - count, time to acknowledge, time to resolve, and duration."
      queryConfigs={queryConfigs}
      defaultTimeRange={{ range: TimeRange.PAST_ONE_DAY }}
    />
  );
};

export default MonitorIncidentMetrics;

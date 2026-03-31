import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import AlertMetricType from "Common/Types/Alerts/AlertMetricType";
import AlertMetricTypeUtil from "Common/Utils/Alerts/AlertMetricType";
import MetricView from "../Metrics/MetricView";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import Card from "Common/UI/Components/Card/Card";

export interface ComponentProps {
  monitorId: ObjectID;
}

const MonitorAlertMetrics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const alertMetricTypes: Array<AlertMetricType> =
    AlertMetricTypeUtil.getAllAlertMetricTypes();

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_DAY,
  });

  type GetQueryConfigsFunction = () => Array<MetricQueryConfigData>;

  const getQueryConfigs: GetQueryConfigsFunction =
    (): Array<MetricQueryConfigData> => {
      const queries: Array<MetricQueryConfigData> = [];

      for (const metricType of alertMetricTypes) {
        queries.push({
          metricAliasData: {
            metricVariable: metricType,
            title: AlertMetricTypeUtil.getTitleByAlertMetricType(metricType),
            description:
              AlertMetricTypeUtil.getDescriptionByAlertMetricType(metricType),
            legend: AlertMetricTypeUtil.getLegendByAlertMetricType(metricType),
            legendUnit:
              AlertMetricTypeUtil.getLegendUnitByAlertMetricType(metricType),
          },
          metricQueryData: {
            filterData: {
              metricName: metricType,
              attributes: {
                monitorId: props.monitorId.toString(),
                projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
              },
              aggegationType:
                AlertMetricTypeUtil.getAggregationTypeByAlertMetricType(
                  metricType,
                ),
            },
            groupBy: undefined,
          },
        });
      }

      return queries;
    };

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_DAY,
    }),
    queryConfigs: getQueryConfigs(),
    formulaConfigs: [],
  });

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange);
    setMetricViewData((prev: MetricViewData) => {
      return {
        ...prev,
        startAndEndDate: dateRange,
      };
    });
  }, []);

  return (
    <Card
      title="Alert Metrics"
      description="Alert metrics for this monitor - count, time to acknowledge, time to resolve, and duration."
      rightElement={
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={timeRange}
          onChange={handleTimeRangeChange}
        />
      }
    >
      <MetricView
        data={metricViewData}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        onChange={(data: MetricViewData) => {
          setMetricViewData({
            ...data,
            queryConfigs: getQueryConfigs(),
            formulaConfigs: [],
          });
        }}
      />
    </Card>
  );
};

export default MonitorAlertMetrics;

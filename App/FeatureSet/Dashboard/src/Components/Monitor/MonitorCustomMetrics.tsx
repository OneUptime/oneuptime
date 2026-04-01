import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import MetricView from "../Metrics/MetricView";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import IconProp from "Common/Types/Icon/IconProp";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Search from "Common/Types/BaseDatabase/Search";

export interface ComponentProps {
  monitorId: ObjectID;
}

const MonitorCustomMetrics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [customMetricNames, setCustomMetricNames] = useState<Array<string>>([]);

  const fetchCustomMetricNames: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsLoading(true);

      try {
        // Query ClickHouse for recent metrics belonging to this monitor
        // with names starting with "custom.monitor."
        // monitorId is stored as serviceId in the Metric table.
        const listResult = await AnalyticsModelAPI.getList<Metric>({
          modelType: Metric,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            serviceId: props.monitorId,
            name: new Search("custom.monitor.") as any,
            time: new InBetween(
              OneUptimeDate.addRemoveDays(
                OneUptimeDate.getCurrentDate(),
                -30,
              ),
              OneUptimeDate.getCurrentDate(),
            ) as any,
          },
          select: {
            name: true,
          },
          limit: 1000,
          skip: 0,
          sort: {
            name: SortOrder.Ascending,
          },
        });

        // Extract distinct metric names
        const nameSet: Set<string> = new Set<string>();
        for (const metric of listResult.data) {
          const name: string = (metric as any).name || "";
          if (name.length > 0) {
            nameSet.add(name);
          }
        }

        const names: Array<string> = Array.from(nameSet).sort();
        setCustomMetricNames(names);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  useEffect(() => {
    fetchCustomMetricNames().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const getQueryConfigs: () => Array<MetricQueryConfigData> =
    (): Array<MetricQueryConfigData> => {
      return customMetricNames.map(
        (metricName: string): MetricQueryConfigData => {
          const displayName: string = metricName.replace("custom.monitor.", "");

          return {
            metricAliasData: {
              metricVariable: metricName,
              title: displayName,
              description: `Custom metric: ${displayName}`,
              legend: displayName,
              legendUnit: "",
            },
            metricQueryData: {
              filterData: {
                metricName: metricName,
                attributes: {
                  monitorId: props.monitorId.toString(),
                  projectId:
                    ProjectUtil.getCurrentProjectId()?.toString() || "",
                },
                aggegationType: AggregationType.Avg,
              },
              groupBy: {
                attributes: true,
              },
            },
          };
        },
      );
    };

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
    queryConfigs: [],
    formulaConfigs: [],
  });

  useEffect(() => {
    if (customMetricNames.length > 0) {
      setMetricViewData({
        startAndEndDate:
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange),
        queryConfigs: getQueryConfigs(),
        formulaConfigs: [],
      });
    }
  }, [customMetricNames]);

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

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (customMetricNames.length === 0) {
    return (
      <EmptyState
        id="no-custom-metrics"
        icon={IconProp.ChartBar}
        title="No Custom Metrics"
        description="No custom metrics have been captured yet. Use oneuptime.captureMetric() in your monitor script to capture custom metrics."
      />
    );
  }

  return (
    <Card
      title="Custom Metrics"
      description="Custom metrics captured from your monitor script using oneuptime.captureMetric()."
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

export default MonitorCustomMetrics;

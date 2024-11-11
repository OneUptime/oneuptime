import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import MonitorMetricTypeUtil from "Common/Utils/Monitor/MonitorMetricType";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricView from "../Metrics/MetricView";
import { MetricQueryConfigData } from "../Metrics/MetricQueryConfig";
import DashboardNavigation from "../../Utils/Navigation";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorType from "Common/Types/Monitor/MonitorType";
import API from "Common/UI/Utils/API/API";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

export interface ComponentProps {
  monitorId: ObjectID;
}

const MonitorMetricsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitorType, setMonitorType] = useState<MonitorType>(
    MonitorType.Manual, // unknown monitor type.
  );

  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string>("");

  const fetchMonitor: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: props.monitorId,
        select: {
          monitorType: true,
        },
      });

      setMonitorType(item?.monitorType || MonitorType.Manual);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchMonitor().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const monitorMetricTypesByMonitor: Array<MonitorMetricType> =
    MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(monitorType);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  if (monitorMetricTypesByMonitor.length === 0) {
    return <></>;
  }

  // set it to past 1 hour
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -1);

  const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

  type GetQueryConfigByMonitorMetricTypesFunction =
    () => Array<MetricQueryConfigData>;

  const getQueryConfigByMonitorMetricTypes: GetQueryConfigByMonitorMetricTypesFunction =
    (): Array<MetricQueryConfigData> => {
      const queries: Array<MetricQueryConfigData> = [];

      for (const monitorMetricType of monitorMetricTypesByMonitor) {
        queries.push({
          metricAliasData: {
            metricVariable: monitorMetricType,
            title:
              MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                monitorMetricType,
              ),
            description:
              MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
                monitorMetricType,
              ),
          },
          metricQueryData: {
            filterData: {
              metricName: monitorMetricType,
              attributes: {
                monitorId: props.monitorId.toString(),
                projectId: DashboardNavigation.getProjectId()?.toString() || "",
              },
              aggegationType:
                MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
                  monitorMetricType,
                ),

            },
            groupBy: {
              attributes: true
            }
            
          },
          getSeries: (data) => {
            return {
              title: data.attributes.monitorId,
            };
          }
        });
      }

      return queries;
    };

  return (
    <div>
      <MetricView
        data={{
          startAndEndDate: startAndEndDate,
          queryConfigs: getQueryConfigByMonitorMetricTypes(),
          formulaConfigs: [],
        }}
        hideQueryElements={true}
      />
    </div>
  );
};

export default MonitorMetricsElement;

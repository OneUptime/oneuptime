import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import IconProp from "Common/Types/Icon/IconProp";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
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
        /*
         * Query ClickHouse for recent metrics belonging to this monitor
         * with names starting with "custom.monitor."
         * monitorId is stored as primaryEntityId in the Metric table.
         */
        const listResult: ListResult<Metric> =
          await AnalyticsModelAPI.getList<Metric>({
            modelType: Metric,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              primaryEntityId: props.monitorId,
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
    <EmbeddedMetricCard
      title="Custom Metrics"
      description="Custom metrics captured from your monitor script using oneuptime.captureMetric()."
      queryConfigs={getQueryConfigs()}
    />
  );
};

export default MonitorCustomMetrics;

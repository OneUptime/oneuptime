import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import MonitorMetricTypeUtil, {
  MonitorMetricCategory,
} from "Common/Utils/Monitor/MonitorMetricType";
import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import ProjectUtil from "Common/UI/Utils/Project";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import API from "Common/UI/Utils/API/API";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ProbeUtil from "../../Utils/Probe";
import Probe from "Common/Models/DatabaseModels/Probe";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import TimeRange from "Common/Types/Time/TimeRange";
import { buildMonitorMetricQueryConfig } from "./MonitorMetricQueryConfig";

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
  const [probes, setProbes] = useState<Array<Probe>>([]);
  /*
   * Database Health only. The cards drop the series the configured engine can
   * never write, so a MySQL monitor does not carry a permanently empty
   * "Transaction ID Used" chart it can do nothing about.
   */
  const [databaseType, setDatabaseType] = useState<SqlDatabaseType | undefined>(
    undefined,
  );
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const fetchMonitor: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: props.monitorId,
        select: {
          monitorType: true,
          monitorSteps: true,
        },
      });

      const monitorType: MonitorType = item?.monitorType || MonitorType.Manual;

      setMonitorType(monitorType);

      if (monitorType === MonitorType.Database) {
        const steps: Array<MonitorStep> =
          item?.monitorSteps?.data?.monitorStepsInstanceArray || [];

        setDatabaseType(
          steps.find((step: MonitorStep) => {
            return Boolean(step.data?.databaseMonitor?.databaseType);
          })?.data?.databaseMonitor?.databaseType,
        );
      }

      const isProbeableMonitor: boolean =
        MonitorTypeHelper.isProbableMonitor(monitorType);

      if (isProbeableMonitor) {
        setProbes(await ProbeUtil.getAllProbes());
      }
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

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
  }, []);

  /*
   * Build query configs for a specific metric list. Re-computed when probes
   * or monitor type change so chart series labels refresh correctly.
   */
  const buildQueryConfigs: (
    metrics: Array<MonitorMetricType>,
  ) => Array<MetricQueryConfigData> = useCallback(
    (metrics: Array<MonitorMetricType>): Array<MetricQueryConfigData> => {
      return metrics.map(
        (monitorMetricType: MonitorMetricType): MetricQueryConfigData => {
          return buildMonitorMetricQueryConfig({
            monitorId: props.monitorId,
            projectId: ProjectUtil.getCurrentProjectId(),
            monitorType: monitorType,
            metric: monitorMetricType,
            probes: probes,
          });
        },
      );
    },
    [props.monitorId, monitorType, probes],
  );

  const categories: Array<MonitorMetricCategory> = useMemo(() => {
    if (!monitorType) {
      return [];
    }
    return MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
      monitorType,
      databaseType,
    );
  }, [monitorType, databaseType]);

  /*
   * Memoise the per-category query configs so each CategoryMetricsCard only
   * re-renders when its own metrics actually change.
   */
  const categoryQueryConfigs: Array<Array<MetricQueryConfigData>> =
    useMemo(() => {
      return categories.map((category: MonitorMetricCategory) => {
        return buildQueryConfigs(category.metrics);
      });
    }, [categories, buildQueryConfigs]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (categories.length === 0) {
    return <></>;
  }

  return (
    <>
      {categories.map(
        (category: MonitorMetricCategory, index: number): ReactElement => {
          return (
            <EmbeddedMetricCard
              key={category.title}
              title={category.title}
              description={category.description}
              queryConfigs={categoryQueryConfigs[index] || []}
              timeRange={timeRange}
              onTimeRangeChange={handleTimeRangeChange}
            />
          );
        },
      )}
    </>
  );
};

export default MonitorMetricsElement;

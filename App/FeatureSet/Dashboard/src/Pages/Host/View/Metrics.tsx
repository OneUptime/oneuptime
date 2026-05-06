import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import Card from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";

const HostMetrics: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
    queryConfigs: [],
    formulaConfigs: [],
  });

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

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

  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const hostIdentifier: string = host?.hostIdentifier || "";

    const baseAttributes: Record<string, string> = {
      "resource.host.name": hostIdentifier,
    };

    const cpu: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_cpu_utilization",
        title: "CPU Utilization",
        description:
          "CPU utilization across the host (avg across all states / cores).",
        legend: "CPU %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.cpu.utilization",
          attributes: baseAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const cpuPerCoreUser: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_cpu_utilization_user_per_core",
        title: "CPU Utilization (User) by Core",
        description:
          "User-space CPU utilization broken out per logical core. One line per `cpu` attribute (cpu0, cpu1, …).",
        legend: "User CPU %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.cpu.utilization",
          attributes: {
            ...baseAttributes,
            state: "user",
          },
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
        groupByAttributeKeys: ["cpu"],
      },
    };

    const cpuPerCoreSystem: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_cpu_utilization_system_per_core",
        title: "CPU Utilization (System) by Core",
        description:
          "Kernel/system CPU utilization broken out per logical core. One line per `cpu` attribute (cpu0, cpu1, …).",
        legend: "System CPU %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.cpu.utilization",
          attributes: {
            ...baseAttributes,
            state: "system",
          },
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
        groupByAttributeKeys: ["cpu"],
      },
    };

    const load1m: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_load_1m",
        title: "Load Average (1m)",
        description: "1-minute load average reported by the kernel.",
        legend: "Load 1m",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.cpu.load_average.1m",
          attributes: baseAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const memUtil: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_mem_utilization",
        title: "Memory Utilization",
        description: "Memory utilization fraction by state (used, free, etc).",
        legend: "Memory %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.memory.utilization",
          attributes: baseAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const memUsageBytes: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_mem_usage_bytes",
        title: "Memory Usage",
        description: "Memory usage in bytes (sum across states).",
        legend: "Memory",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.memory.usage",
          attributes: baseAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const fsUtil: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_fs_utilization",
        title: "Filesystem Utilization",
        description: "Filesystem utilization across all mounts.",
        legend: "FS %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.filesystem.utilization",
          attributes: baseAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const fsUtilPerMount: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_fs_utilization_used_per_mount",
        title: "Filesystem Utilization by Mount",
        description:
          "Used-space fraction broken out per mount point. One line per `mountpoint` attribute (e.g. /, /var, /home).",
        legend: "Used %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.filesystem.utilization",
          attributes: {
            ...baseAttributes,
            state: "used",
          },
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
        groupByAttributeKeys: ["mountpoint"],
      },
    };

    const diskIo: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_disk_io",
        title: "Disk I/O",
        description: "Disk read + write throughput across all devices.",
        legend: "Disk I/O",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.disk.io",
          attributes: baseAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const netIo: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_net_io",
        title: "Network I/O",
        description: "Network bytes sent + received across all interfaces.",
        legend: "Net I/O",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.network.io",
          attributes: baseAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const netErrors: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_net_errors",
        title: "Network Errors",
        description: "Count of packet errors on all network interfaces.",
        legend: "Errors",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.network.errors",
          attributes: baseAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const procCount: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_processes_count",
        title: "Process Count",
        description: "Number of processes observed on this host.",
        legend: "Processes",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.processes.count",
          attributes: baseAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    return [
      cpu,
      cpuPerCoreUser,
      cpuPerCoreSystem,
      load1m,
      memUtil,
      memUsageBytes,
      fsUtil,
      fsUtilPerMount,
      diskIo,
      netIo,
      netErrors,
      procCount,
    ];
  }, [host?.hostIdentifier]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  return (
    <Card
      title="Host Metrics"
      description="Live system.* metrics from the OpenTelemetry hostmetrics receiver. Use the time range selector to zoom in or out."
    >
      <div>
        <div className="flex items-center justify-end mb-4">
          <RangeStartAndEndDateView
            dashboardStartAndEndDate={timeRange}
            onChange={handleTimeRangeChange}
          />
        </div>
        <MetricView
          data={{
            ...metricViewData,
            queryConfigs: queryConfigs,
          }}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          hideCardInCharts={true}
          onChange={(data: MetricViewData) => {
            setMetricViewData({
              ...data,
              queryConfigs: queryConfigs,
              formulaConfigs: [],
            });
          }}
        />
      </div>
    </Card>
  );
};

export default HostMetrics;

import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
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

const CephClusterMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<CephCluster | null>(null);
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
      const item: CephCluster | null = await ModelAPI.getItem({
        modelType: CephCluster,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      setCluster(item);
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
    const clusterIdentifier: string = cluster?.name || "";

    const commonAttributes: Record<string, string> = {
      "resource.ceph.cluster.name": clusterIdentifier,
    };

    const healthStatus: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "ceph_health",
        title: "Cluster Health Status",
        description:
          "Overall cluster health: 0 = HEALTH_OK, 1 = HEALTH_WARN, 2 = HEALTH_ERR.",
        legend: "Health",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_health_status",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const usedBytes: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "ceph_used_bytes",
        title: "Cluster Used Capacity",
        description: "Raw storage currently used across all OSDs (bytes).",
        legend: "Used",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_cluster_total_used_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const totalBytes: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "ceph_total_bytes",
        title: "Cluster Total Capacity",
        description:
          "Total raw storage capacity across all OSDs, before replication overhead (bytes).",
        legend: "Total",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_cluster_total_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const osdsUp: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "ceph_osds_up",
        title: "OSDs Up",
        description: "Number of OSD daemons that are up.",
        legend: "OSDs Up",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_osd_up",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const monsInQuorum: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "ceph_mons_in_quorum",
        title: "Monitors In Quorum",
        description: "Number of monitor daemons currently in quorum.",
        legend: "Mons",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_mon_quorum_status",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const pgDegraded: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "ceph_pg_degraded",
        title: "Degraded Placement Groups",
        description:
          "Placement groups with fewer data replicas than configured. Non-zero means redundancy is reduced.",
        legend: "Degraded PGs",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_pg_degraded",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const pgUndersized: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "ceph_pg_undersized",
        title: "Undersized Placement Groups",
        description:
          "Placement groups mapped to fewer OSDs than their configured replica count.",
        legend: "Undersized PGs",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_pg_undersized",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const poolReadBytes: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "ceph_pool_rd_bytes",
        title: "Pool Read Throughput (cumulative)",
        description: "Total bytes read across all pools.",
        legend: "Read",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_pool_rd_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const poolWriteBytes: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "ceph_pool_wr_bytes",
        title: "Pool Write Throughput (cumulative)",
        description: "Total bytes written across all pools.",
        legend: "Write",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_pool_wr_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    return [
      healthStatus,
      usedBytes,
      totalBytes,
      osdsUp,
      monsInQuorum,
      pgDegraded,
      pgUndersized,
      poolReadBytes,
      poolWriteBytes,
    ];
  }, [cluster?.name]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  return (
    <Card
      title="Ceph Cluster Metrics"
      description="Health, capacity, OSD, monitor quorum, placement group, and pool throughput metrics for this cluster. Use the time range selector to zoom in or out."
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

export default CephClusterMetrics;

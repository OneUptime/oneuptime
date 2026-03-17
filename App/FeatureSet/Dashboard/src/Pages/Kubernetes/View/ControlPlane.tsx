import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

const KubernetesClusterControlPlane: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
        },
      });
      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterIdentifier: string = cluster.clusterIdentifier || "";

  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -6);
  const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

  // etcd metrics (scraped via prometheus receiver)
  const etcdDbSizeQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "etcd_db_size",
      title: "etcd Database Size",
      description: "Total size of the etcd database",
      legend: "DB Size",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "etcd_mvcc_db_total_size_in_bytes",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  // API Server request rate
  const apiServerRequestRateQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "apiserver_requests",
      title: "API Server Request Rate",
      description: "Total API server requests by verb",
      legend: "Requests",
      legendUnit: "req/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "apiserver_request_total",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Sum,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  // API Server request latency
  const apiServerLatencyQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "apiserver_latency",
      title: "API Server Request Latency",
      description: "API server request duration",
      legend: "Latency",
      legendUnit: "seconds",
    },
    metricQueryData: {
      filterData: {
        metricName: "apiserver_request_duration_seconds",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  // Scheduler pending pods
  const schedulerPendingQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "scheduler_pending",
      title: "Scheduler Pending Pods",
      description: "Number of pods pending scheduling",
      legend: "Pending Pods",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "scheduler_pending_pods",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  // Scheduler latency
  const schedulerLatencyQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "scheduler_latency",
      title: "Scheduler Latency",
      description: "End-to-end scheduling latency",
      legend: "Latency",
      legendUnit: "seconds",
    },
    metricQueryData: {
      filterData: {
        metricName: "scheduler_e2e_scheduling_duration_seconds",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  // Controller Manager work queue depth
  const controllerQueueDepthQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "controller_queue",
      title: "Controller Manager Queue Depth",
      description: "Work queue depth for controller manager",
      legend: "Queue Depth",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "workqueue_depth",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const [etcdMetricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [etcdDbSizeQuery],
    formulaConfigs: [],
  });

  const [apiServerMetricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [apiServerRequestRateQuery, apiServerLatencyQuery],
    formulaConfigs: [],
  });

  const [schedulerMetricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [schedulerPendingQuery, schedulerLatencyQuery],
    formulaConfigs: [],
  });

  const [controllerMetricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [controllerQueueDepthQuery],
    formulaConfigs: [],
  });

  return (
    <Fragment>
      <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-700">
          Control plane metrics require the <code>controlPlane.enabled</code>{" "}
          flag to be set to <code>true</code> in the kubernetes-agent Helm chart
          values. This is typically only available for self-managed Kubernetes
          clusters, not managed services like EKS, GKE, or AKS.
        </p>
      </div>

      <Card
        title="etcd"
        description="etcd is the consistent, distributed key-value store used as the backing store for all cluster data."
      >
        <MetricView
          data={etcdMetricViewData}
          hideQueryElements={true}
          onChange={() => {}}
        />
      </Card>

      <Card
        title="API Server"
        description="The Kubernetes API server validates and configures data for API objects and serves REST operations."
      >
        <MetricView
          data={apiServerMetricViewData}
          hideQueryElements={true}
          onChange={() => {}}
        />
      </Card>

      <Card
        title="Scheduler"
        description="The scheduler watches for newly created pods that have no node assigned and selects a node for them to run on."
      >
        <MetricView
          data={schedulerMetricViewData}
          hideQueryElements={true}
          onChange={() => {}}
        />
      </Card>

      <Card
        title="Controller Manager"
        description="The controller manager runs controller processes that regulate the state of the cluster."
      >
        <MetricView
          data={controllerMetricViewData}
          hideQueryElements={true}
          onChange={() => {}}
        />
      </Card>
    </Fragment>
  );
};

export default KubernetesClusterControlPlane;

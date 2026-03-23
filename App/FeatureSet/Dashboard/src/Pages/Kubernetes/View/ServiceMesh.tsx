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

const KubernetesClusterServiceMesh: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [istioRequestsMetricViewData, setIstioRequestsMetricViewData] =
    useState<MetricViewData | null>(null);
  const [istioLatencyMetricViewData, setIstioLatencyMetricViewData] =
    useState<MetricViewData | null>(null);
  const [linkerdRequestsMetricViewData, setLinkerdRequestsMetricViewData] =
    useState<MetricViewData | null>(null);
  const [linkerdLatencyMetricViewData, setLinkerdLatencyMetricViewData] =
    useState<MetricViewData | null>(null);

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

  useEffect(() => {
    if (!cluster) {
      return;
    }

    const clusterIdentifier: string = cluster.clusterIdentifier || "";
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -6);
    const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

    // Istio metrics
    const istioRequestsTotalQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "istio_requests_total",
        title: "Istio Request Rate",
        description: "Total requests through the Istio service mesh",
        legend: "Requests",
        legendUnit: "req/s",
      },
      metricQueryData: {
        filterData: {
          metricName: "istio_requests_total",
          attributes: {
            "resource.k8s.cluster.name": clusterIdentifier,
          },
          aggegationType: AggregationType.Sum,
          aggregateBy: {},
        },
        groupBy: {
          attributes: true,
        },
      },
    };

    const istioRequestDurationQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "istio_request_duration",
        title: "Istio Request Latency",
        description:
          "Request duration through the Istio service mesh (p50/p99)",
        legend: "Latency",
        legendUnit: "ms",
      },
      metricQueryData: {
        filterData: {
          metricName: "istio_request_duration_milliseconds_bucket",
          attributes: {
            "resource.k8s.cluster.name": clusterIdentifier,
          },
          aggegationType: AggregationType.Avg,
          aggregateBy: {},
        },
        groupBy: {
          attributes: true,
        },
      },
    };

    // Linkerd metrics
    const linkerdRequestTotalQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "linkerd_request_total",
        title: "Linkerd Request Rate",
        description: "Total requests through the Linkerd service mesh",
        legend: "Requests",
        legendUnit: "req/s",
      },
      metricQueryData: {
        filterData: {
          metricName: "request_total",
          attributes: {
            "resource.k8s.cluster.name": clusterIdentifier,
          },
          aggegationType: AggregationType.Sum,
          aggregateBy: {},
        },
        groupBy: {
          attributes: true,
        },
      },
    };

    const linkerdResponseLatencyQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "linkerd_response_latency",
        title: "Linkerd Response Latency",
        description:
          "Response latency through the Linkerd service mesh (p50/p99)",
        legend: "Latency",
        legendUnit: "ms",
      },
      metricQueryData: {
        filterData: {
          metricName: "response_latency_ms_bucket",
          attributes: {
            "resource.k8s.cluster.name": clusterIdentifier,
          },
          aggegationType: AggregationType.Avg,
          aggregateBy: {},
        },
        groupBy: {
          attributes: true,
        },
      },
    };

    setIstioRequestsMetricViewData({
      startAndEndDate: startAndEndDate,
      queryConfigs: [istioRequestsTotalQuery],
      formulaConfigs: [],
    });

    setIstioLatencyMetricViewData({
      startAndEndDate: startAndEndDate,
      queryConfigs: [istioRequestDurationQuery],
      formulaConfigs: [],
    });

    setLinkerdRequestsMetricViewData({
      startAndEndDate: startAndEndDate,
      queryConfigs: [linkerdRequestTotalQuery],
      formulaConfigs: [],
    });

    setLinkerdLatencyMetricViewData({
      startAndEndDate: startAndEndDate,
      queryConfigs: [linkerdResponseLatencyQuery],
      formulaConfigs: [],
    });
  }, [cluster]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (
    !cluster ||
    !istioRequestsMetricViewData ||
    !istioLatencyMetricViewData ||
    !linkerdRequestsMetricViewData ||
    !linkerdLatencyMetricViewData
  ) {
    return <ErrorMessage message="Cluster not found." />;
  }

  return (
    <Fragment>
      <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-700">
          Service mesh metrics require the <code>serviceMesh.enabled</code> flag
          to be set to <code>true</code> and the{" "}
          <code>serviceMesh.provider</code> to be configured in the
          kubernetes-agent Helm chart values. Supported providers are Istio and
          Linkerd.
        </p>
      </div>

      <Card
        title="Istio - Request Rate"
        description="Total request rate through Istio envoy sidecars across all services in the mesh."
      >
        <MetricView
          data={istioRequestsMetricViewData}
          hideQueryElements={true}
          onChange={() => {}}
        />
      </Card>

      <Card
        title="Istio - Request Latency"
        description="Request duration distribution through the Istio service mesh."
      >
        <MetricView
          data={istioLatencyMetricViewData}
          hideQueryElements={true}
          onChange={() => {}}
        />
      </Card>

      <Card
        title="Linkerd - Request Rate"
        description="Total request rate through Linkerd proxy sidecars across all services in the mesh."
      >
        <MetricView
          data={linkerdRequestsMetricViewData}
          hideQueryElements={true}
          onChange={() => {}}
        />
      </Card>

      <Card
        title="Linkerd - Response Latency"
        description="Response latency distribution through the Linkerd service mesh."
      >
        <MetricView
          data={linkerdLatencyMetricViewData}
          hideQueryElements={true}
          onChange={() => {}}
        />
      </Card>
    </Fragment>
  );
};

export default KubernetesClusterServiceMesh;

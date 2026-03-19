import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
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
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import KubernetesOverviewTab from "../../../Components/Kubernetes/KubernetesOverviewTab";
import KubernetesEventsTab from "../../../Components/Kubernetes/KubernetesEventsTab";
import KubernetesMetricsTab from "../../../Components/Kubernetes/KubernetesMetricsTab";
import {
  KubernetesCondition,
  KubernetesNodeObject,
} from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";

const KubernetesClusterNodeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const nodeName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [nodeObject, setNodeObject] = useState<KubernetesNodeObject | null>(
    null,
  );
  const [isLoadingObject, setIsLoadingObject] = useState<boolean>(true);

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

  // Fetch the K8s node object for overview tab
  useEffect(() => {
    if (!cluster?.clusterIdentifier) {
      return;
    }

    const fetchNodeObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: KubernetesNodeObject | null =
          await fetchLatestK8sObject<KubernetesNodeObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "nodes",
            resourceName: nodeName,
          });
        setNodeObject(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchNodeObject().catch(() => {});
  }, [cluster?.clusterIdentifier, nodeName]);

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

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_cpu",
      title: "CPU Utilization",
      description: `CPU utilization for node ${nodeName}`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.cpu.utilization",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_memory",
      title: "Memory Usage",
      description: `Memory usage for node ${nodeName}`,
      legend: "Memory",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.memory.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const filesystemQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_filesystem",
      title: "Filesystem Usage",
      description: `Filesystem usage for node ${nodeName}`,
      legend: "Filesystem",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.filesystem.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const networkRxQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_network_rx",
      title: "Network Receive",
      description: `Network bytes received for node ${nodeName}`,
      legend: "Network RX",
      legendUnit: "bytes/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.network.io.receive",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const networkTxQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_network_tx",
      title: "Network Transmit",
      description: `Network bytes transmitted for node ${nodeName}`,
      legend: "Network TX",
      legendUnit: "bytes/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.network.io.transmit",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  // Determine node status from conditions
  const getNodeStatus: () => { label: string; isReady: boolean } = (): {
    label: string;
    isReady: boolean;
  } => {
    if (!nodeObject) {
      return { label: "Unknown", isReady: false };
    }
    const readyCondition: KubernetesCondition | undefined =
      nodeObject.status.conditions.find((c: KubernetesCondition) => {
        return c.type === "Ready";
      });
    if (readyCondition && readyCondition.status === "True") {
      return { label: "Ready", isReady: true };
    }
    return { label: "NotReady", isReady: false };
  };

  // Build overview summary fields from node object
  const summaryFields: Array<{ title: string; value: string | ReactElement }> =
    [
      { title: "Node Name", value: nodeName },
      { title: "Cluster", value: clusterIdentifier },
    ];

  if (nodeObject) {
    const nodeStatus: { label: string; isReady: boolean } = getNodeStatus();

    summaryFields.push(
      {
        title: "Status",
        value: (
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
              nodeStatus.isReady
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {nodeStatus.label}
          </span>
        ),
      },
      {
        title: "OS Image",
        value: nodeObject.status.nodeInfo.osImage || "N/A",
      },
      {
        title: "Kernel",
        value: nodeObject.status.nodeInfo.kernelVersion || "N/A",
      },
      {
        title: "Container Runtime",
        value: nodeObject.status.nodeInfo.containerRuntimeVersion || "N/A",
      },
      {
        title: "Kubelet Version",
        value: nodeObject.status.nodeInfo.kubeletVersion || "N/A",
      },
      {
        title: "Architecture",
        value: nodeObject.status.nodeInfo.architecture || "N/A",
      },
      {
        title: "CPU Allocatable",
        value: nodeObject.status.allocatable["cpu"] || "N/A",
      },
      {
        title: "Memory Allocatable",
        value: nodeObject.status.allocatable["memory"] || "N/A",
      },
      {
        title: "Created",
        value: nodeObject.metadata.creationTimestamp || "N/A",
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <KubernetesOverviewTab
          summaryFields={summaryFields}
          labels={nodeObject?.metadata.labels || {}}
          annotations={nodeObject?.metadata.annotations || {}}
          conditions={nodeObject?.status.conditions}
          isLoading={isLoadingObject}
        />
      ),
    },
    {
      name: "Events",
      children: (
        <Card
          title="Node Events"
          description="Kubernetes events for this node in the last 24 hours."
        >
          <KubernetesEventsTab
            clusterIdentifier={clusterIdentifier}
            resourceKind="Node"
            resourceName={nodeName}
          />
        </Card>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Node Metrics: ${nodeName}`}
          description="CPU, memory, filesystem, and network usage for this node over the last 6 hours."
        >
          <KubernetesMetricsTab
            queryConfigs={[
              cpuQuery,
              memoryQuery,
              filesystemQuery,
              networkRxQuery,
              networkTxQuery,
            ]}
          />
        </Card>
      ),
    },
  ];

  return (
    <Fragment>
      <div className="mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <InfoCard title="Node Name" value={nodeName || "Unknown"} />
          <InfoCard title="Cluster" value={clusterIdentifier} />
        </div>
      </div>

      <Tabs tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default KubernetesClusterNodeDetail;

import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";

import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import React, {
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
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";

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
      legendUnit: "",
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
    yAxisValueFormatter: KubernetesResourceUtils.formatBytesForChart,
  };

  const filesystemQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_filesystem",
      title: "Filesystem Usage",
      description: `Filesystem usage for node ${nodeName}`,
      legend: "Filesystem",
      legendUnit: "",
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
    yAxisValueFormatter: KubernetesResourceUtils.formatBytesForChart,
  };

  const networkRxQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_network_rx",
      title: "Network Receive",
      description: `Network bytes received for node ${nodeName}`,
      legend: "Network RX",
      legendUnit: "",
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
    yAxisValueFormatter: KubernetesResourceUtils.formatBytesPerSecForChart,
  };

  const networkTxQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_network_tx",
      title: "Network Transmit",
      description: `Network bytes transmitted for node ${nodeName}`,
      legend: "Network TX",
      legendUnit: "",
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
    yAxisValueFormatter: KubernetesResourceUtils.formatBytesPerSecForChart,
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

    // Extract node roles from labels
    const roles: Array<string> = Object.keys(
      nodeObject.metadata.labels,
    )
      .filter((key: string) => {
        return key.startsWith("node-role.kubernetes.io/");
      })
      .map((key: string) => {
        return key.replace("node-role.kubernetes.io/", "");
      });

    // Extract internal IP
    const internalIP: string =
      nodeObject.status.addresses.find(
        (a: { type: string; address: string }) => {
          return a.type === "InternalIP";
        },
      )?.address || "N/A";

    // Check pressure conditions
    const pressureConditions: Array<string> = nodeObject.status.conditions
      .filter((c: KubernetesCondition) => {
        return (
          c.status === "True" &&
          (c.type === "MemoryPressure" ||
            c.type === "DiskPressure" ||
            c.type === "PIDPressure")
        );
      })
      .map((c: KubernetesCondition) => {
        return c.type;
      });

    summaryFields.push({
      title: "Status",
      value: (
        <StatusBadge
          text={nodeStatus.label}
          type={
            nodeStatus.isReady
              ? StatusBadgeType.Success
              : StatusBadgeType.Danger
          }
        />
      ),
    });

    if (roles.length > 0) {
      summaryFields.push({
        title: "Roles",
        value: (
          <div className="flex gap-1 flex-wrap">
            {roles.map((role: string) => {
              return (
                <StatusBadge
                  key={role}
                  text={role}
                  type={StatusBadgeType.Info}
                />
              );
            })}
          </div>
        ),
      });
    }

    summaryFields.push({ title: "Internal IP", value: internalIP });

    if (pressureConditions.length > 0) {
      summaryFields.push({
        title: "Pressure",
        value: (
          <div className="flex gap-1 flex-wrap">
            {pressureConditions.map((p: string) => {
              return (
                <StatusBadge
                  key={p}
                  text={p}
                  type={StatusBadgeType.Danger}
                />
              );
            })}
          </div>
        ),
      });
    }

    summaryFields.push(
      {
        title: "CPU (Capacity / Allocatable)",
        value: `${nodeObject.status.capacity["cpu"] || "N/A"} / ${nodeObject.status.allocatable["cpu"] || "N/A"}`,
      },
      {
        title: "Memory (Capacity / Allocatable)",
        value: `${nodeObject.status.capacity["memory"] || "N/A"} / ${nodeObject.status.allocatable["memory"] || "N/A"}`,
      },
      {
        title: "Pods (Capacity)",
        value: nodeObject.status.capacity["pods"] || "N/A",
      },
      {
        title: "OS Image",
        value: nodeObject.status.nodeInfo.osImage || "N/A",
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
        value: `${nodeObject.status.nodeInfo.operatingSystem || "N/A"}/${nodeObject.status.nodeInfo.architecture || "N/A"}`,
      },
      {
        title: "Kernel",
        value: nodeObject.status.nodeInfo.kernelVersion || "N/A",
      },
      {
        title: "Created",
        value: nodeObject.metadata.creationTimestamp
          ? KubernetesResourceUtils.formatAge(
              nodeObject.metadata.creationTimestamp,
            )
          : "N/A",
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
    {
      name: "YAML",
      children: (
        <KubernetesYamlTab
          clusterIdentifier={clusterIdentifier}
          resourceType="nodes"
          resourceName={nodeName}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterNodeDetail;

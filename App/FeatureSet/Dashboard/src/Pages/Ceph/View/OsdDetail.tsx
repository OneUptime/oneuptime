import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceOverviewTab, {
  SummaryField,
} from "../../../Components/Infrastructure/ResourceOverviewTab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import CephResourceUtils from "../Utils/CephResourceUtils";

/*
 * OSD detail page. The route param (subModelId) is the CephResource
 * externalId — the `ceph_daemon` datapoint label (e.g. `osd.3`) — not a
 * database id, mirroring the Kubernetes detail route contract
 * (Pages/Kubernetes/View/NodeDetail.tsx).
 */

const formatLatencyMs: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(0)} ms`;
};
const CephClusterOsdDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const osdName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<CephCluster | null>(null);
  const [resource, setResource] = useState<CephResourceModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingResource, setIsLoadingResource] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: CephCluster | null = await ModelAPI.getItem({
        modelType: CephCluster,
        id: modelId,
        select: {
          name: true,
        },
      });
      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  const fetchResource: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoadingResource(true);
    try {
      const result: ListResult<CephResourceModel> =
        await ModelAPI.getList<CephResourceModel>({
          modelType: CephResourceModel,
          query: {
            cephClusterId: modelId,
            kind: "Osd",
            externalId: osdName,
          },
          skip: 0,
          limit: 1,
          select: {
            externalId: true,
            hostname: true,
            daemonVersion: true,
            deviceClass: true,
            isUp: true,
            isIn: true,
            statBytes: true,
            statBytesUsed: true,
            applyLatencyMs: true,
            commitLatencyMs: true,
            pgCount: true,
            metricsUpdatedAt: true,
            lastSeenAt: true,
            createdAt: true,
          },
          sort: {},
        });
      setResource(result.data[0] || null);
    } catch {
      // Graceful degradation — overview tab shows the empty state.
    }
    setIsLoadingResource(false);
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
    fetchResource().catch(() => {});
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster?.name) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterName: string = cluster.name;

  const buildOsdQuery: (args: {
    variable: string;
    title: string;
    description: string;
    legend: string;
    legendUnit: string;
    metricName: string;
  }) => MetricQueryConfigData = (args: {
    variable: string;
    title: string;
    description: string;
    legend: string;
    legendUnit: string;
    metricName: string;
  }): MetricQueryConfigData => {
    return {
      metricAliasData: {
        metricVariable: args.variable,
        title: args.title,
        description: args.description,
        legend: args.legend,
        legendUnit: args.legendUnit,
      },
      metricQueryData: {
        filterData: {
          metricName: args.metricName,
          attributes: {
            "resource.ceph.cluster.name": clusterName,
            ceph_daemon: osdName,
          },
          aggegationType: AggregationType.Avg,
          aggregateBy: {},
        },
      },
    };
  };

  const queryConfigs: Array<MetricQueryConfigData> = [
    buildOsdQuery({
      variable: "osd_apply_latency",
      title: "Apply Latency",
      description: `Average time for ${osdName} to apply an operation to its backing store (ms).`,
      legend: "Apply",
      legendUnit: "ms",
      metricName: "ceph_osd_apply_latency_ms",
    }),
    buildOsdQuery({
      variable: "osd_commit_latency",
      title: "Commit Latency",
      description: `Average time for ${osdName} to commit an operation to its journal (ms).`,
      legend: "Commit",
      legendUnit: "ms",
      metricName: "ceph_osd_commit_latency_ms",
    }),
    buildOsdQuery({
      variable: "osd_stat_bytes_used",
      title: "Bytes Used",
      description: `Bytes used on ${osdName}'s backing device.`,
      legend: "Used",
      legendUnit: "bytes",
      metricName: "ceph_osd_stat_bytes_used",
    }),
    buildOsdQuery({
      variable: "osd_numpg",
      title: "Placement Groups",
      description: `Number of placement groups hosted on ${osdName}.`,
      legend: "PGs",
      legendUnit: "",
      metricName: "ceph_osd_numpg",
    }),
  ];

  // Build overview summary fields from the inventory row.
  const summaryFields: Array<SummaryField> = [
    { title: "OSD", value: osdName },
    { title: "Cluster", value: clusterName },
  ];

  if (resource) {
    summaryFields.push(
      {
        title: "Status",
        value: (
          <StatusBadge
            text={resource.isUp ? "Up" : "Down"}
            type={
              resource.isUp ? StatusBadgeType.Success : StatusBadgeType.Danger
            }
          />
        ),
      },
      {
        title: "Placement",
        value: (
          <StatusBadge
            text={resource.isIn ? "In" : "Out"}
            type={
              resource.isIn ? StatusBadgeType.Success : StatusBadgeType.Warning
            }
          />
        ),
      },
      { title: "Host", value: resource.hostname || "N/A" },
      { title: "Device Class", value: resource.deviceClass || "N/A" },
      {
        title: "Used / Total",
        value: `${CephResourceUtils.formatBytes(
          CephResourceUtils.freshMetricValue(resource, resource.statBytesUsed),
        )} / ${CephResourceUtils.formatBytes(
          CephResourceUtils.freshMetricValue(resource, resource.statBytes),
        )}`,
      },
      {
        title: "Placement Groups",
        value: CephResourceUtils.formatCount(
          CephResourceUtils.freshMetricValue(resource, resource.pgCount),
        ),
      },
      {
        title: "Apply / Commit Latency",
        value: `${formatLatencyMs(
          CephResourceUtils.freshMetricValue(resource, resource.applyLatencyMs),
        )} / ${formatLatencyMs(
          CephResourceUtils.freshMetricValue(
            resource,
            resource.commitLatencyMs,
          ),
        )}`,
      },
      { title: "Version", value: resource.daemonVersion || "N/A" },
      {
        title: "Last Seen",
        value: CephResourceUtils.formatLastSeen(resource.lastSeenAt),
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={resource ? summaryFields : []}
          labels={{}}
          annotations={{}}
          isLoading={isLoadingResource}
          emptyMessage={`OSD ${osdName} is not in the inventory yet. It appears here a few minutes after the Ceph agent starts sending metrics.`}
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`OSD Metrics: ${osdName}`}
          description="Latency, capacity, and placement-group metrics for this OSD."
        >
          <ResourceMetricsTab queryConfigs={queryConfigs} />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default CephClusterOsdDetail;

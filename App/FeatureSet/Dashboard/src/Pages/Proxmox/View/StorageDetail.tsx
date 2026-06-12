import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ProxmoxResourceModel from "Common/Models/DatabaseModels/ProxmoxResource";
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
import ResourceOverviewTab, {
  SummaryField,
} from "../../../Components/Infrastructure/ResourceOverviewTab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  externalIdFromRouteParam,
  fetchProxmoxInventoryRow,
  formatBytes,
  formatPercent,
  displayNameForResource,
  displayStatusForResource,
} from "../Utils/ProxmoxResourceUtils";
import OneUptimeDate from "Common/Types/Date";

const ProxmoxClusterStorageDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../proxmox/:modelId/storage/:subModelId — subModelId
   * is the percent-encoded pve externalId ("storage/local", or
   * "storage/<node>/<storage>" on pve-exporter >= 3.x), not a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [cluster, setCluster] = useState<ProxmoxCluster | null>(null);
  const [row, setRow] = useState<ProxmoxResourceModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: ProxmoxCluster | null = await ModelAPI.getItem({
        modelType: ProxmoxCluster,
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

    try {
      const inventoryRow: ProxmoxResourceModel | null =
        await fetchProxmoxInventoryRow({
          proxmoxClusterId: modelId,
          kind: "Storage",
          externalId: externalId,
        });
      setRow(inventoryRow);
    } catch {
      // Graceful degradation — overview tab shows its empty state.
    }
    setIsLoadingRow(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
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
  const storageName: string = row
    ? displayNameForResource(row)
    : externalId.replace(/^storage\//, "");

  const idAttributes: Record<string, string> = {
    "resource.proxmox.cluster.name": clusterName,
    id: externalId,
  };

  const usageQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "storage_usage",
      title: "Storage Usage",
      description: `Disk space used on storage volume ${storageName} over time.`,
      legend: "Used",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "pve_disk_usage_bytes",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  const sizeQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "storage_size",
      title: "Storage Size",
      description: `Total capacity of storage volume ${storageName}.`,
      legend: "Total",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "pve_disk_size_bytes",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  // Build overview summary fields from the inventory row.
  const summaryFields: Array<SummaryField> = [
    { title: "Storage Name", value: storageName },
    { title: "Cluster", value: clusterName },
  ];

  if (row) {
    const status: string = displayStatusForResource(row);
    if (status) {
      summaryFields.push({
        title: "Status",
        value: (
          <StatusBadge
            text={status}
            type={row.isUp ? StatusBadgeType.Success : StatusBadgeType.Danger}
          />
        ),
      });
    }

    if (row.parentNodeName) {
      summaryFields.push({ title: "Node", value: row.parentNodeName });
    }

    const used: number | null =
      row.latestDiskBytes !== null && row.latestDiskBytes !== undefined
        ? Number(row.latestDiskBytes)
        : null;
    const total: number | null =
      row.maxDiskBytes !== null && row.maxDiskBytes !== undefined
        ? Number(row.maxDiskBytes)
        : null;

    if (used !== null) {
      summaryFields.push({ title: "Used", value: formatBytes(used) });
    }
    if (total !== null) {
      summaryFields.push({ title: "Total", value: formatBytes(total) });
    }
    if (used !== null && total !== null && total > 0) {
      summaryFields.push({
        title: "Used %",
        value: formatPercent((used / total) * 100),
      });
    }

    summaryFields.push({ title: "External ID", value: externalId });

    if (row.lastSeenAt) {
      summaryFields.push({
        title: "Last Seen",
        value: OneUptimeDate.fromNow(new Date(row.lastSeenAt as Date)),
      });
    }
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={row ? summaryFields : []}
          labels={{}}
          annotations={{}}
          isLoading={isLoadingRow}
          emptyMessage="Storage details not reported yet. Make sure the Proxmox agent is sending metrics."
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Storage Metrics: ${storageName}`}
          description="Usage against capacity for this storage volume over the selected time range."
        >
          <ResourceMetricsTab queryConfigs={[usageQuery, sizeQuery]} />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default ProxmoxClusterStorageDetail;

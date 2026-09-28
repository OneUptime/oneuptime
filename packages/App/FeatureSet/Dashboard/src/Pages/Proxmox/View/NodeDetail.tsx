import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ProxmoxResourceModel from "Common/Models/DatabaseModels/ProxmoxResource";
import Card from "Common/UI/Components/Card/Card";
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
import ResourceOverviewTab, {
  SummaryField,
} from "../../../Components/Infrastructure/ResourceOverviewTab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import ProxmoxRateChart from "../../../Components/Proxmox/ProxmoxRateChart";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  externalIdFromRouteParam,
  fetchProxmoxInventoryRow,
  formatBytes,
  formatPercent,
  formatUptime,
  displayNameForResource,
  displayStatusForResource,
} from "../Utils/ProxmoxResourceUtils";
import OneUptimeDate from "Common/Types/Date";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ProxmoxMetricDescriptions";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

// A node's pve externalId is "node/<name>".
const NODE_EXTERNAL_ID_PREFIX: string = "node/";

const ProxmoxClusterNodeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../proxmox/:modelId/nodes/:subModelId — subModelId is
   * the percent-encoded pve externalId ("node/pve1"), not a DB id.
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
  const [showRemoveModal, setShowRemoveModal] = useState<boolean>(false);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string>("");

  // The node's own name as Proxmox knows it ("pve1" from "node/pve1").
  const pveNodeName: string = externalId.startsWith(NODE_EXTERNAL_ID_PREFIX)
    ? externalId.substring(NODE_EXTERNAL_ID_PREFIX.length)
    : "";

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
          kind: "Node",
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

  /*
   * Remove a node that has stopped reporting. The server refuses a node
   * that is still up; on success the node is gone, so go back to the
   * cluster's node list. Errors stay in the confirm dialog.
   */
  const removeNode: PromiseVoidFunction = async (): Promise<void> => {
    setIsRemoving(true);
    setRemoveError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString())
            .addRoute("/proxmox-resource/remove-node/")
            .addRoute(modelId.toString()),
          data: {
            nodeName: pveNodeName,
          },
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (response instanceof HTTPErrorResponse) {
        setRemoveError(API.getFriendlyMessage(response));
        setIsRemoving(false);
        return;
      }
    } catch (err) {
      setRemoveError(API.getFriendlyMessage(err));
      setIsRemoving(false);
      return;
    }

    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_NODES] as Route,
        { modelId: modelId },
      ),
    );
  };

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
  const nodeName: string = row
    ? displayNameForResource(row)
    : externalId.replace(/^node\//, "");

  /*
   * All charts filter on the raw `id` datapoint label — the one label
   * every pve-exporter data series carries (the *_info-only `name`
   * label trap).
   */
  const idAttributes: Record<string, string> = {
    "resource.proxmox.cluster.name": clusterName,
    id: externalId,
  };

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_cpu",
      title: "CPU Utilization",
      description: `CPU usage percent for node ${nodeName} (pve_cpu_usage_ratio × 100 — already a true ratio).`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "pve_cpu_usage_ratio",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    transformValue: (value: number): number => {
      return value * 100;
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
        metricName: "pve_memory_usage_bytes",
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

  const rootDiskQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_root_disk",
      title: "Root Filesystem Usage",
      description: `Root filesystem usage for node ${nodeName}`,
      legend: "Disk",
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

  // Build overview summary fields from the inventory row.
  const summaryFields: Array<SummaryField> = [
    { title: "Node Name", value: nodeName },
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
        description: PROXMOX_METRIC_DESCRIPTIONS.nodeStatus,
      });
    }

    const uptime: string = formatUptime(row.uptimeSeconds);
    if (uptime) {
      summaryFields.push({
        title: "Uptime",
        value: uptime,
        description: PROXMOX_METRIC_DESCRIPTIONS.nodeUptime,
      });
    }

    if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined) {
      summaryFields.push({
        title: "CPU",
        value: formatPercent(Number(row.latestCpuPercent)),
        description: PROXMOX_METRIC_DESCRIPTIONS.nodeCpu,
      });
    }

    if (row.latestMemoryBytes !== null && row.latestMemoryBytes !== undefined) {
      summaryFields.push({
        title: "Memory (Used / Total)",
        value: `${formatBytes(Number(row.latestMemoryBytes))} / ${formatBytes(
          row.maxMemoryBytes !== null && row.maxMemoryBytes !== undefined
            ? Number(row.maxMemoryBytes)
            : null,
        )}`,
        description: PROXMOX_METRIC_DESCRIPTIONS.nodeMemory,
      });
    }

    if (row.haState) {
      summaryFields.push({
        title: "HA State",
        value: row.haState,
        description: PROXMOX_METRIC_DESCRIPTIONS.nodeHaState,
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

  /*
   * On the Proxmox VE native push a node taken out of the cluster looks
   * exactly like a dead one: its siblings keep reporting it as down. So
   * a node that has stopped reporting can be removed. A node that is
   * still up has no button: it would come back on its next report.
   */
  const canRemoveNode: boolean = Boolean(
    row && row.isUp === false && pveNodeName,
  );

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <div className="space-y-6">
          <ResourceOverviewTab
            summaryFields={row ? summaryFields : []}
            labels={{}}
            annotations={{}}
            isLoading={isLoadingRow}
            emptyMessage="Node details not reported yet. Make sure the Proxmox agent is sending metrics."
          />
          {canRemoveNode && (
            <Card
              title="Remove Node"
              description="This node has stopped reporting. If it was taken out of the Proxmox cluster, remove it here so it is no longer reported as offline."
              buttons={[
                {
                  title: "Remove node",
                  buttonStyle: ButtonStyleType.DANGER_OUTLINE,
                  icon: IconProp.Trash,
                  onClick: () => {
                    setRemoveError("");
                    setShowRemoveModal(true);
                  },
                },
              ]}
            />
          )}
        </div>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Node Metrics: ${nodeName}`}
          description="CPU, memory, root filesystem, and I/O for this node over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={[cpuQuery, memoryQuery, rootDiskQuery]}
            renderExtraCharts={(dateRange: InBetween<Date>): ReactElement => {
              return (
                <div className="mt-4 space-y-6">
                  <div>
                    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                      Network Throughput
                      <InfoTooltip
                        label="Network Throughput"
                        text={PROXMOX_METRIC_DESCRIPTIONS.nodeNetworkThroughput}
                      />
                    </div>
                    <ProxmoxRateChart
                      clusterName={clusterName}
                      series={[
                        {
                          metricName: "pve_network_receive_bytes",
                          label: "Receive",
                        },
                        {
                          metricName: "pve_network_transmit_bytes",
                          label: "Transmit",
                        },
                      ]}
                      extraAttributes={{ id: externalId }}
                      startDate={dateRange.startValue}
                      endDate={dateRange.endValue}
                      emptyMessage="No network counters reported for this node. pve-exporter only exposes network I/O for resources that report it via the cluster/resources API."
                    />
                  </div>
                  <div>
                    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                      Disk Throughput
                      <InfoTooltip
                        label="Disk Throughput"
                        text={PROXMOX_METRIC_DESCRIPTIONS.nodeDiskThroughput}
                      />
                    </div>
                    <ProxmoxRateChart
                      clusterName={clusterName}
                      series={[
                        {
                          metricName: "pve_disk_read_bytes",
                          label: "Read",
                        },
                        {
                          metricName: "pve_disk_write_bytes",
                          label: "Write",
                        },
                      ]}
                      extraAttributes={{ id: externalId }}
                      startDate={dateRange.startValue}
                      endDate={dateRange.endValue}
                      emptyMessage="No disk I/O counters reported for this node. pve-exporter only exposes disk I/O for resources that report it via the cluster/resources API."
                    />
                  </div>
                </div>
              );
            }}
          />
        </Card>
      ),
    },
  ];

  return (
    <Fragment>
      <Tabs tabs={tabs} onTabChange={() => {}} />
      {showRemoveModal && canRemoveNode && (
        <ConfirmModal
          title="Remove Node"
          description={`Only remove ${pveNodeName} if it has been removed from the Proxmox cluster. OneUptime cannot tell a node that was removed from one that is down, so it keeps reporting it as offline until you remove it here. Once it is removed, its Node Offline alert resolves within a few minutes. If ${pveNodeName} reports again, it comes back.`}
          submitButtonText="Remove node"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isRemoving}
          error={removeError}
          onSubmit={() => {
            removeNode().catch((err: Error) => {
              setRemoveError(API.getFriendlyMessage(err));
              setIsRemoving(false);
            });
          }}
          onClose={() => {
            setShowRemoveModal(false);
            setRemoveError("");
          }}
        />
      )}
    </Fragment>
  );
};

export default ProxmoxClusterNodeDetail;

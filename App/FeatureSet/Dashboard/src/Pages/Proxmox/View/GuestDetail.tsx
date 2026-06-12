import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ProxmoxResourceModel from "Common/Models/DatabaseModels/ProxmoxResource";
import Host from "Common/Models/DatabaseModels/Host";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import React, {
  Fragment,
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
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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

const ProxmoxClusterGuestDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../proxmox/:modelId/guests/:subModelId — subModelId
   * is the percent-encoded pve externalId ("qemu/100", "lxc/101"), not
   * a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [cluster, setCluster] = useState<ProxmoxCluster | null>(null);
  const [row, setRow] = useState<ProxmoxResourceModel | null>(null);
  const [linkedHost, setLinkedHost] = useState<Host | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * WI-17: the ingest path stamps Host.proxmoxClusterId when a Host's
   * hostIdentifier case-insensitively matches a guest name in the same
   * project. The reverse lookup here is the same join, client-side:
   * hosts already linked to this cluster, matched against this guest's
   * name. Best-effort — failure just hides the cross-link card.
   */
  const findLinkedHost: (guestName: string) => Promise<void> = async (
    guestName: string,
  ): Promise<void> => {
    try {
      if (!guestName) {
        return;
      }
      const hosts: ListResult<Host> = await ModelAPI.getList<Host>({
        modelType: Host,
        query: {
          proxmoxClusterId: modelId,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          _id: true,
          name: true,
          hostIdentifier: true,
        },
        sort: {
          hostIdentifier: SortOrder.Ascending,
        },
      });
      const match: Host | undefined = hosts.data.find((host: Host) => {
        return (
          (host.hostIdentifier || "").toLowerCase() === guestName.toLowerCase()
        );
      });
      setLinkedHost(match || null);
    } catch {
      // Cross-link is supplementary.
    }
  };

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
          kind: "Guest",
          externalId: externalId,
        });
      setRow(inventoryRow);
      if (inventoryRow?.name) {
        void findLinkedHost(inventoryRow.name);
      }
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
  const guestName: string = row
    ? displayNameForResource(row)
    : externalId.replace(/^(qemu|lxc)\//, "");
  const isQemu: boolean =
    row?.guestType === "qemu" || externalId.startsWith("qemu/");

  const idAttributes: Record<string, string> = {
    "resource.proxmox.cluster.name": clusterName,
    id: externalId,
  };

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "guest_cpu",
      title: "CPU Utilization",
      description: `CPU usage percent for guest ${guestName} (pve_cpu_usage_ratio × 100).`,
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
      metricVariable: "guest_memory",
      title: "Memory Usage",
      description: `Memory usage for guest ${guestName}`,
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

  // Build overview summary fields from the inventory row.
  const summaryFields: Array<SummaryField> = [
    { title: "Guest Name", value: guestName },
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
            type={row.isUp ? StatusBadgeType.Success : StatusBadgeType.Warning}
          />
        ),
      });
    }

    if (row.vmid !== null && row.vmid !== undefined) {
      summaryFields.push({ title: "VMID", value: String(row.vmid) });
    }
    if (row.guestType) {
      summaryFields.push({
        title: "Type",
        value: row.guestType === "qemu" ? "QEMU VM" : "LXC Container",
      });
    }
    if (row.parentNodeName) {
      summaryFields.push({ title: "Node", value: row.parentNodeName });
    }
    if (row.haState) {
      summaryFields.push({ title: "HA State", value: row.haState });
    }
    if (row.onboot !== null && row.onboot !== undefined) {
      summaryFields.push({
        title: "Start on Boot",
        value: row.onboot ? "Yes" : "No",
      });
    }

    const uptime: string = formatUptime(row.uptimeSeconds);
    if (uptime) {
      summaryFields.push({ title: "Uptime", value: uptime });
    }

    if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined) {
      summaryFields.push({
        title: "CPU",
        value: formatPercent(Number(row.latestCpuPercent)),
      });
    }

    if (row.latestMemoryBytes !== null && row.latestMemoryBytes !== undefined) {
      summaryFields.push({
        title: "Memory (Used / Max)",
        value: `${formatBytes(Number(row.latestMemoryBytes))} / ${formatBytes(
          row.maxMemoryBytes !== null && row.maxMemoryBytes !== undefined
            ? Number(row.maxMemoryBytes)
            : null,
        )}`,
      });
    }

    /*
     * latestDiskBytes NULL for a qemu guest means "needs the QEMU
     * guest agent" — render N/A with a hint, never 0.
     */
    if (row.latestDiskBytes !== null && row.latestDiskBytes !== undefined) {
      summaryFields.push({
        title: "Disk (Used / Max)",
        value: `${formatBytes(Number(row.latestDiskBytes))} / ${formatBytes(
          row.maxDiskBytes !== null && row.maxDiskBytes !== undefined
            ? Number(row.maxDiskBytes)
            : null,
        )}`,
      });
    } else if (isQemu) {
      summaryFields.push({
        title: "Disk (Used / Max)",
        value: "N/A — install the QEMU guest agent for disk usage",
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
   * WI-17 cross-link card: per-process depth lives on the Host product
   * (pve-exporter exposes no per-guest process data), so deep-link to
   * the linked Host when the auto-link found one, and show the
   * install-agent CTA otherwise.
   */
  const renderHostCrossLink: () => ReactElement = (): ReactElement => {
    if (linkedHost && linkedHost._id) {
      const hostRoute: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOST_VIEW] as Route,
        { modelId: new ObjectID(linkedHost._id.toString()) },
      );
      return (
        <Card
          title="Linked Host"
          description="A OneUptime host agent is running inside this guest."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              to={hostRoute}
              className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="text-sm font-semibold text-gray-900">
                {linkedHost.name || linkedHost.hostIdentifier || "Host"}
              </div>
              <div className="text-xs text-gray-500">
                Processes, per-core CPU, mounts, and host-level logs for this
                VM.
              </div>
            </Link>
          </div>
        </Card>
      );
    }

    const hostsRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOSTS] as Route,
    );
    return (
      <Card
        title="Process-Level Visibility"
        description="pve-exporter reports CPU, memory, and I/O for this guest — but not what's running inside it."
      >
        <div className="text-sm text-gray-600">
          Install the OneUptime host agent inside this VM for process-level
          visibility (processes, per-core CPU, mounts, host logs). Once the
          agent reports with a host identifier matching this guest&apos;s name,
          the host is linked here automatically.{" "}
          <Link
            to={hostsRoute}
            className="text-indigo-600 hover:text-indigo-900 font-medium"
          >
            View Hosts &amp; install guide →
          </Link>
        </div>
      </Card>
    );
  };

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <Fragment>
          <ResourceOverviewTab
            summaryFields={row ? summaryFields : []}
            labels={{}}
            annotations={{}}
            isLoading={isLoadingRow}
            emptyMessage="Guest details not reported yet. Make sure the Proxmox agent is sending metrics."
          />
          {!isLoadingRow && <div className="mt-6">{renderHostCrossLink()}</div>}
        </Fragment>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Guest Metrics: ${guestName}`}
          description="CPU, memory, network, and disk I/O for this guest over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={[cpuQuery, memoryQuery]}
            renderExtraCharts={(dateRange: InBetween<Date>): ReactElement => {
              return (
                <div className="mt-4 space-y-6">
                  <div>
                    <div className="mb-2 text-sm font-medium text-gray-700">
                      Network Throughput
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
                    />
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-medium text-gray-700">
                      Disk Throughput
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

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default ProxmoxClusterGuestDetail;

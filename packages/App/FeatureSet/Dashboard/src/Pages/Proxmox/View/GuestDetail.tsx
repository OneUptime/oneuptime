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
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import ProxmoxRateChart from "../../../Components/Proxmox/ProxmoxRateChart";
import ProxmoxPartHero from "../../../Components/Proxmox/Part/ProxmoxPartHero";
import ProxmoxGuestOverview from "../../../Components/Proxmox/Part/ProxmoxGuestOverview";
import {
  ProxmoxPartRoutes,
  getProxmoxPartRoutes,
} from "../../../Components/Proxmox/Part/ProxmoxPartRoutes";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  externalIdFromRouteParam,
  fetchProxmoxInventoryRow,
  formatBytes,
  displayNameForResource,
} from "../Utils/ProxmoxResourceUtils";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ProxmoxMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A Proxmox guest - a QEMU VM or an LXC container - inside its cluster: the
 * hero says which guest it is, where it runs and its state (a lock a task
 * holds, its HA state, its tags); the Overview what about it needs
 * attention, its load, its last backup, what is open on it, its alerts and
 * details; Metrics its charts.
 */

const ProxmoxClusterGuestDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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
      // Graceful degradation — the Overview shows its empty state.
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
  const routes: ProxmoxPartRoutes = getProxmoxPartRoutes(modelId);
  const guestName: string = row
    ? displayNameForResource(row)
    : externalId.replace(/^(qemu|lxc)\//, "");

  const idAttributes: Record<string, string> = {
    "resource.proxmox.cluster.name": clusterName,
    id: externalId,
  };

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "guest_cpu",
      title: "CPU Utilization",
      description: translator.translateTemplate(
        "CPU usage percent for guest {{guestName}} (pve_cpu_usage_ratio × 100).",
        { guestName: guestName },
      ),
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
      description: translator.translateTemplate(
        "Memory usage for guest {{guestName}}",
        { guestName: guestName },
      ),
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
                {linkedHost.name ||
                  linkedHost.hostIdentifier ||
                  translator.translateText("Host")}
              </div>
              <div className="text-xs text-gray-500">
                {translator.translateText(
                  "Processes, per-core CPU, mounts, and host-level logs for this VM.",
                )}
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
          {translator.translateText(
            "Install the OneUptime host agent inside this VM for process-level visibility (processes, per-core CPU, mounts, host logs). Once the agent reports with a host identifier matching this guest's name, the host is linked here automatically.",
          )}{" "}
          <Link
            to={hostsRoute}
            className="text-indigo-600 hover:text-indigo-900 font-medium"
          >
            {translator.translateText("View Hosts & install guide →")}
          </Link>
        </div>
      </Card>
    );
  };

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: isLoadingRow ? (
        <PageLoader isVisible={true} />
      ) : (
        <ProxmoxGuestOverview
          clusterId={modelId}
          clusterName={clusterName}
          externalId={externalId}
          row={row}
          routes={routes}
          footer={row?.isTemplate ? undefined : renderHostCrossLink()}
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate("Guest Metrics: {{guestName}}", {
            guestName: guestName,
          })}
          description="CPU, memory, network, and disk I/O for this guest over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={[cpuQuery, memoryQuery]}
            renderExtraCharts={(dateRange: InBetween<Date>): ReactElement => {
              return (
                <div className="mt-4 space-y-6">
                  <div className="group/zoomhint">
                    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                      {translator.translateText("Network Throughput")}
                      <InfoTooltip
                        label="Network Throughput"
                        text={
                          PROXMOX_METRIC_DESCRIPTIONS.guestNetworkThroughput
                        }
                      />
                      <TimeRangeZoomHint
                        revealOnHover={true}
                        className="ml-auto font-normal"
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
                    />
                  </div>
                  <div className="group/zoomhint">
                    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                      {translator.translateText("Disk Throughput")}
                      <InfoTooltip
                        label="Disk Throughput"
                        text={PROXMOX_METRIC_DESCRIPTIONS.guestDiskThroughput}
                      />
                      <TimeRangeZoomHint
                        revealOnHover={true}
                        className="ml-auto font-normal"
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
    <div data-testid="proxmox-guest-page">
      <ProxmoxPartHero
        kind="Guest"
        row={row}
        externalId={externalId}
        clusterName={clusterName}
        clusterRoute={routes.clusterRoute}
        getPartRoute={routes.getPartRoute}
      />
      <Tabs tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

export default ProxmoxClusterGuestDetail;

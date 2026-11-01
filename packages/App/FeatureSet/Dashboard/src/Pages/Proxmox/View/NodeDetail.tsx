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
  useRef,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import ProxmoxRateChart from "../../../Components/Proxmox/ProxmoxRateChart";
import ProxmoxPartHero from "../../../Components/Proxmox/Part/ProxmoxPartHero";
import ProxmoxNodeOverview from "../../../Components/Proxmox/Part/ProxmoxNodeOverview";
import {
  ProxmoxPartRoutes,
  getProxmoxPartRoutes,
} from "../../../Components/Proxmox/Part/ProxmoxPartRoutes";
import {
  getProxmoxGuestColumns,
  getProxmoxStorageColumns,
  toProxmoxListResource,
} from "../../../Components/Proxmox/ProxmoxResourceColumns";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  externalIdFromRouteParam,
  fetchProxmoxInventoryRow,
  fetchProxmoxRowsOnNode,
  formatBytes,
} from "../Utils/ProxmoxResourceUtils";
import {
  getProxmoxNodeName,
  getProxmoxRowsOnNode,
  sortProxmoxGuests,
  summarizeProxmoxGuests,
} from "../Utils/ProxmoxPartFacts";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A Proxmox VE node inside its cluster: the hero says which node it is,
 * whether it is up and what it runs; the tabs hold its Overview (what
 * needs attention on it, its load, what is open on it, its busiest guests,
 * its alerts and details), its guests, its storage and its metric charts.
 */

export const PROXMOX_NODE_TAB_OVERVIEW: string = "Overview";
export const PROXMOX_NODE_TAB_GUESTS: string = "Guests";
export const PROXMOX_NODE_TAB_STORAGE: string = "Storage";
export const PROXMOX_NODE_TAB_METRICS: string = "Metrics";

const ProxmoxClusterNodeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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
  const [nodeRows, setNodeRows] = useState<Array<ProxmoxResourceModel>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showRemoveModal, setShowRemoveModal] = useState<boolean>(false);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string>("");
  const [refreshToken, setRefreshToken] = useState<number>(0);

  /*
   * "View all guests" on the Overview opens the Guests tab: Tabs keeps its
   * own selection, so it is mounted again on that tab.
   */
  const [tabsKey, setTabsKey] = useState<number>(0);
  const [initialTabName, setInitialTabName] = useState<string>(
    PROXMOX_NODE_TAB_OVERVIEW,
  );

  // The node's own name as Proxmox knows it ("pve1" from "node/pve1").
  const pveNodeName: string = getProxmoxNodeName(null, externalId);

  // Only the newest inventory read may commit.
  const inventorySequence: React.MutableRefObject<number> = useRef<number>(0);

  const fetchInventory: PromiseVoidFunction = async (): Promise<void> => {
    const sequence: number = ++inventorySequence.current;
    try {
      const [inventoryRow, rowsOnNode]: [
        ProxmoxResourceModel | null,
        Array<ProxmoxResourceModel>,
      ] = await Promise.all([
        fetchProxmoxInventoryRow({
          proxmoxClusterId: modelId,
          kind: "Node",
          externalId: externalId,
        }),
        fetchProxmoxRowsOnNode({
          proxmoxClusterId: modelId,
          nodeName: pveNodeName,
        }),
      ]);
      if (sequence !== inventorySequence.current) {
        return;
      }
      setRow(inventoryRow);
      setNodeRows(rowsOnNode);
    } catch {
      // Graceful degradation — the Overview shows its empty state.
    }
    setIsLoadingRow(false);
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

    await fetchInventory();
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const refresh: () => void = (): void => {
    setRefreshToken(Date.now());
    fetchInventory().catch(() => {
      // The page keeps what it showed; the next refresh tries again.
    });
  };

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

    /*
     * A full load, not an in-app navigation: the cluster layout (and its
     * sidebar node count) stays mounted across its child pages and would
     * keep counting the removed node.
     */
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_NODES] as Route,
        { modelId: modelId },
      ),
      { forceNavigate: true },
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
  const nodeName: string = getProxmoxNodeName(row, externalId) || externalId;
  const routes: ProxmoxPartRoutes = getProxmoxPartRoutes(modelId);
  const now: Date = OneUptimeDate.getCurrentDate();

  // What the node reports: its guests (by VMID) and its storage.
  const onNode: {
    guests: Array<ProxmoxResourceModel>;
    storage: Array<ProxmoxResourceModel>;
  } = getProxmoxRowsOnNode(nodeRows, pveNodeName);
  const guests: Array<ProxmoxResourceModel> = sortProxmoxGuests(onNode.guests);
  const storage: Array<ProxmoxResourceModel> = onNode.storage;
  const guestResources: Array<InfrastructureResource> = guests.map(
    toProxmoxListResource,
  );
  const storageResources: Array<InfrastructureResource> = storage.map(
    toProxmoxListResource,
  );

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
      description: translator.translateTemplate(
        "CPU usage percent for node {{nodeName}} (pve_cpu_usage_ratio × 100 — already a true ratio).",
        { nodeName: nodeName },
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
      metricVariable: "node_memory",
      title: "Memory Usage",
      description: translator.translateTemplate(
        "Memory usage for node {{nodeName}}",
        { nodeName: nodeName },
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

  const rootDiskQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_root_disk",
      title: "Root Filesystem Usage",
      description: translator.translateTemplate(
        "Root filesystem usage for node {{nodeName}}",
        { nodeName: nodeName },
      ),
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

  /*
   * On the Proxmox VE native push a node taken out of the cluster looks
   * exactly like a dead one: its siblings keep reporting it as down. So
   * a native-push node that has stopped reporting can be removed. A node
   * that is still up has no button (it would come back on its next
   * report), and neither has an agent node: the agent lets a node go on
   * its own once the cluster no longer lists it.
   */
  const canRemoveNode: boolean = Boolean(
    row && row.isUp === false && row.isNativePush === true && pveNodeName,
  );

  const removeNodeCard: ReactElement | null = canRemoveNode ? (
    <Card
      title="Remove Node"
      description="This node has stopped reporting. If it was taken out of the Proxmox cluster, remove it here so it is no longer reported as offline."
      buttons={[
        {
          title: "Remove Node",
          buttonStyle: ButtonStyleType.DANGER_OUTLINE,
          icon: IconProp.Trash,
          onClick: () => {
            setRemoveError("");
            setShowRemoveModal(true);
          },
        },
      ]}
    />
  ) : null;

  const showGuests: () => void = (): void => {
    setInitialTabName(PROXMOX_NODE_TAB_GUESTS);
    setTabsKey((key: number): number => {
      return key + 1;
    });
  };

  const tabs: Array<Tab> = [
    {
      name: PROXMOX_NODE_TAB_OVERVIEW,
      children: isLoadingRow ? (
        <PageLoader isVisible={true} />
      ) : (
        <ProxmoxNodeOverview
          clusterId={modelId}
          clusterName={clusterName}
          externalId={externalId}
          row={row}
          nodeRows={[...guests, ...storage]}
          routes={routes}
          onShowGuests={showGuests}
          refreshToken={refreshToken}
          footer={removeNodeCard}
        />
      ),
    },
    {
      name: PROXMOX_NODE_TAB_GUESTS,
      countBadge: guests.length,
      children: (
        <ResourceTable
          onRefreshClick={refresh}
          title="Guests"
          description="The VMs, containers and templates on this node, with their current resource usage."
          resources={guestResources}
          isLoading={isLoadingRow}
          showGroupColumn={false}
          builtInColumnDescriptions={{
            status: PROXMOX_METRIC_DESCRIPTIONS.guestsTableStatus,
            cpu: PROXMOX_METRIC_DESCRIPTIONS.guestsTableCpu,
            memory: PROXMOX_METRIC_DESCRIPTIONS.guestsTableMemory,
            age: PROXMOX_METRIC_DESCRIPTIONS.guestsTableUptime,
          }}
          tableIdPrefix="proxmox-node-guests"
          emptyMessage="No guests on this node."
          columns={getProxmoxGuestColumns({
            rows: guests,
            resources: guestResources,
            translator: translator,
            now: now,
          })}
          getViewRoute={(resource: InfrastructureResource): Route => {
            return routes.getPartRoute(
              "Guest",
              resource.additionalAttributes["externalId"] || "",
            );
          }}
        />
      ),
    },
    {
      name: PROXMOX_NODE_TAB_STORAGE,
      countBadge: storage.length,
      children: (
        <ResourceTable
          onRefreshClick={refresh}
          title="Storage"
          description="The storage this node reports, with its current usage. Shared storage is listed on every node that uses it."
          resources={storageResources}
          isLoading={isLoadingRow}
          showGroupColumn={false}
          showResourceMetrics={false}
          // Proxmox reports no uptime for a storage: no column of dashes.
          showAge={false}
          builtInColumnDescriptions={{
            status: PROXMOX_METRIC_DESCRIPTIONS.storageTableStatus,
          }}
          tableIdPrefix="proxmox-node-storage"
          emptyMessage="No storage reported for this node."
          columns={getProxmoxStorageColumns({
            resources: storageResources,
            translator: translator,
          })}
          getViewRoute={(resource: InfrastructureResource): Route => {
            return routes.getPartRoute(
              "Storage",
              resource.additionalAttributes["externalId"] || "",
            );
          }}
        />
      ),
    },
    {
      name: PROXMOX_NODE_TAB_METRICS,
      children: (
        <Card
          title={translator.translateTemplate("Node Metrics: {{nodeName}}", {
            nodeName: nodeName,
          })}
          description="CPU, memory, root filesystem, and I/O for this node over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={[cpuQuery, memoryQuery, rootDiskQuery]}
            renderExtraCharts={(dateRange: InBetween<Date>): ReactElement => {
              return (
                <div className="mt-4 space-y-6">
                  <div className="group/zoomhint">
                    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                      {translator.translateText("Network Throughput")}
                      <InfoTooltip
                        label="Network Throughput"
                        text={PROXMOX_METRIC_DESCRIPTIONS.nodeNetworkThroughput}
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
                      emptyMessage="No network counters reported for this node. pve-exporter only exposes network I/O for resources that report it via the cluster/resources API."
                    />
                  </div>
                  <div className="group/zoomhint">
                    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                      {translator.translateText("Disk Throughput")}
                      <InfoTooltip
                        label="Disk Throughput"
                        text={PROXMOX_METRIC_DESCRIPTIONS.nodeDiskThroughput}
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
    <div data-testid="proxmox-node-page">
      <ProxmoxPartHero
        kind="Node"
        row={row}
        externalId={externalId}
        clusterName={clusterName}
        clusterRoute={routes.clusterRoute}
        getPartRoute={routes.getPartRoute}
        guestSummary={summarizeProxmoxGuests(guests)}
      />
      {/*
       * The tab row wraps on a phone, so Metrics is never out of sight past
       * the edge of the screen.
       */}
      <Tabs
        key={tabsKey}
        tabs={tabs}
        initialTabName={initialTabName}
        wrap={true}
        onTabChange={() => {}}
      />
      {showRemoveModal && canRemoveNode && (
        <ConfirmModal
          title="Remove Node"
          description={translator.translateTemplate(
            "Only remove {{nodeName}} if it has been removed from the Proxmox cluster. Its Node Offline alert then resolves. If it reports again, it comes back.",
            { nodeName: pveNodeName },
          )}
          submitButtonText="Remove Node"
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
    </div>
  );
};

export default ProxmoxClusterNodeDetail;

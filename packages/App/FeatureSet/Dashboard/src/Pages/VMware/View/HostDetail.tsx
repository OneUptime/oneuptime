import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import VMwareCollectionMethod from "Common/Types/VMware/VMwareCollectionMethod";
import OneUptimeDate from "Common/Types/Date";
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
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  VMwareResourceKind,
  externalIdFromRouteParam,
  fetchVMwareInventoryRow,
  fetchVMwareInventoryRows,
  routeParamFromExternalId,
} from "../Utils/VMwareResourceUtils";
import {
  VMwareHostIdentity,
  VMwareHostReportState,
  VMwareHostVirtualMachineSummary,
  getVMwareHostIdentity,
  getVMwareHostLastReportAt,
  getVMwareHostMetricAttributes,
  getVMwareHostReportState,
  summarizeVMwareHostVirtualMachines,
} from "../Utils/VMwareHostData";
import { findVMwareDatacenter } from "../Utils/VMwareHealth";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../../Components/Recommendations/RecommendationFilterUtil";
import VMwarePartHero from "../../../Components/VMware/Part/VMwarePartHero";
import VMwarePartReadError from "../../../Components/VMware/Part/VMwarePartReadError";
import { getVMwareClusterExternalId } from "../../../Components/VMware/Part/VMwarePartRoutes";
import VMwareHostReportNotice from "../../../Components/VMware/Host/VMwareHostReportNotice";
import VMwareHostOverviewTab from "../../../Components/VMware/Host/VMwareHostOverviewTab";
import VMwareHostVirtualMachinesTab from "../../../Components/VMware/Host/VMwareHostVirtualMachinesTab";
import VMwareHostMetricsTab from "../../../Components/VMware/Host/VMwareHostMetricsTab";
import VMwareHostLogsTab from "../../../Components/VMware/Host/VMwareHostLogsTab";

/*
 * An ESXi host inside its vCenter: as deep as a host's page outside VMware,
 * from what vCenter reports about the host. The hero says which host it is,
 * where it sits and whether vCenter can reach it (Connected, Not responding,
 * Powered off, In standby - VMwareHealth, from its usage and its
 * datacenter's counts); the tabs hold its Overview (what on it and its VMs
 * needs attention, tiles, charts, what is open on it, its busiest VMs,
 * network adapters, storage devices, host alerts, details and the AI
 * agent), the virtual machines it runs, every metric chart, and its logs.
 *
 * ESXi runs no agent, so there is no operating system to read - processes,
 * filesystems and load average have no ESXi equivalent vCenter reports.
 * Seeing more of a host is one step from here: turning on its host alerts
 * (Overview) and sending its syslog (Logs).
 */

export const VMWARE_HOST_TAB_OVERVIEW: string = "Overview";
export const VMWARE_HOST_TAB_VIRTUAL_MACHINES: string = "Virtual Machines";
export const VMWARE_HOST_TAB_METRICS: string = "Metrics";
export const VMWARE_HOST_TAB_LOGS: string = "Logs";

const VMwareVCenterHostDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../vmware/:modelId/hosts/:subModelId — subModelId is
   * the percent-encoded inventory externalId ("host/<dc>/<host>"), not
   * a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [row, setRow] = useState<VMwareResourceModel | null>(null);
  /*
   * The host's datacenter: a host that reports no usage is told apart -
   * not responding, powered off, in standby - by its datacenter's counts.
   */
  const [datacenterRow, setDatacenterRow] =
    useState<VMwareResourceModel | null>(null);
  // Its cluster's row: the hero's and the details' link to its page.
  const [clusterRow, setClusterRow] = useState<VMwareResourceModel | null>(
    null,
  );
  const [virtualMachineRows, setVirtualMachineRows] = useState<
    Array<VMwareResourceModel>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingVirtualMachines, setIsLoadingVirtualMachines] =
    useState<boolean>(true);
  const [error, setError] = useState<string>("");
  /*
   * Why the host's own rows could not be read: its Overview says so with
   * Try again, and its Virtual Machines tab with Refresh - never "Not in
   * inventory", which would send someone to a vCenter that was working.
   */
  const [rowError, setRowError] = useState<string>("");
  const [isRetrying, setIsRetrying] = useState<boolean>(false);

  /*
   * "View all virtual machines" on the Overview opens the Virtual Machines
   * tab: Tabs keeps its own selection, so it is mounted again on that tab.
   */
  const [tabsKey, setTabsKey] = useState<number>(0);
  const [initialTabName, setInitialTabName] = useState<string>(
    VMWARE_HOST_TAB_OVERVIEW,
  );

  // Only the newest inventory read may commit (see fetchInventory).
  const inventorySequence: React.MutableRefObject<number> = useRef<number>(0);

  const fetchInventory: (vcenterName: string) => Promise<void> = async (
    vcenterName: string,
  ): Promise<void> => {
    const sequence: number = ++inventorySequence.current;

    const hostRow: VMwareResourceModel | null = await fetchVMwareInventoryRow({
      vmwareVCenterId: modelId,
      kind: VMwareResourceKind.Host,
      externalId: externalId,
    });

    const identity: VMwareHostIdentity = getVMwareHostIdentity({
      vcenterName: vcenterName,
      externalId: externalId,
      row: hostRow,
    });

    const [vmRows, datacenterRows, clusterRows]: [
      Array<VMwareResourceModel>,
      Array<VMwareResourceModel>,
      Array<VMwareResourceModel>,
    ] = await Promise.all([
      identity.hostName
        ? fetchVMwareInventoryRows({
            vmwareVCenterId: modelId,
            kind: VMwareResourceKind.VirtualMachine,
            hostName: identity.hostName,
            datacenterName: identity.datacenterName,
          })
        : Promise.resolve([]),
      fetchVMwareInventoryRows({
        vmwareVCenterId: modelId,
        kind: VMwareResourceKind.Datacenter,
      }),
      hostRow?.clusterName
        ? fetchVMwareInventoryRows({
            vmwareVCenterId: modelId,
            kind: VMwareResourceKind.Cluster,
            clusterName: hostRow.clusterName,
            datacenterName: identity.datacenterName || undefined,
          })
        : Promise.resolve([]),
    ]);

    if (sequence !== inventorySequence.current) {
      return;
    }

    setRow(hostRow);
    setVirtualMachineRows(vmRows);
    setDatacenterRow(
      findVMwareDatacenter(datacenterRows, identity.datacenterName),
    );
    setClusterRow(clusterRows[0] || null);
    setIsLoadingVirtualMachines(false);
  };

  // The host's rows; a failed read is said on the page, not thrown.
  const readInventory: (vcenterName: string) => Promise<void> = async (
    vcenterName: string,
  ): Promise<void> => {
    try {
      await fetchInventory(vcenterName);
      setRowError("");
    } catch (err) {
      setRowError(API.getFriendlyMessage(err));
    }
    setIsLoadingVirtualMachines(false);
  };

  const fetchData: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    let vcenterName: string = "";
    try {
      const item: VMwareVCenter | null = await ModelAPI.getItem({
        modelType: VMwareVCenter,
        id: modelId,
        select: {
          name: true,
          collectionMethod: true,
        },
      });

      if (!item?.name) {
        setError("vCenter not found.");
        setIsLoading(false);
        return;
      }

      setVCenter(item);
      vcenterName = item.name;
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
      return;
    }

    await readInventory(vcenterName);
    setIsLoading(false);
  };

  // Try again after a failed read: the loader while it reads again.
  const retryInventory: () => void = (): void => {
    if (!vcenter?.name) {
      return;
    }
    setIsRetrying(true);
    // readInventory says its own failures; it never rejects.
    void readInventory(vcenter.name).then(() => {
      setIsRetrying(false);
    });
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  const refreshInventory: () => void = (): void => {
    if (!vcenter?.name) {
      return;
    }

    fetchInventory(vcenter.name).catch(() => {
      // The page keeps what it showed; the next refresh tries again.
    });
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!vcenter?.name) {
    return <ErrorMessage message="vCenter not found." />;
  }

  const identity: VMwareHostIdentity = getVMwareHostIdentity({
    vcenterName: vcenter.name,
    externalId: externalId,
    row: row,
  });
  const reportState: VMwareHostReportState = getVMwareHostReportState({
    row: row,
    now: OneUptimeDate.getCurrentDate(),
  });
  const lastReportAt: Date | null = getVMwareHostLastReportAt(row);
  const virtualMachineSummary: VMwareHostVirtualMachineSummary =
    summarizeVMwareHostVirtualMachines(virtualMachineRows);

  const populate: (page: PageMap, subModelId?: string) => Route = (
    page: PageMap,
    subModelId?: string,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[page] as Route,
      subModelId !== undefined
        ? { modelId: modelId, subModelId: subModelId }
        : { modelId: modelId },
    );
  };

  /*
   * The cluster's own page, by its row's inventory id - or, before that
   * row loads, by the id a cluster's is built as.
   */
  const clusterExternalId: string | null = clusterRow?.externalId
    ? clusterRow.externalId
    : row?.clusterName
      ? getVMwareClusterExternalId(identity.datacenterName, row.clusterName)
      : null;
  const clusterRoute: Route | undefined = clusterExternalId
    ? populate(
        PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL,
        routeParamFromExternalId(clusterExternalId),
      )
    : undefined;

  const getVirtualMachineRoute: (vmExternalId: string) => Route = (
    vmExternalId: string,
  ): Route => {
    return populate(
      PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL,
      routeParamFromExternalId(vmExternalId),
    );
  };

  const getRecordRoute: (page: PageMap, id: ObjectID) => Route = (
    page: PageMap,
    id: ObjectID,
  ): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: id,
    });
  };

  const showVirtualMachines: () => void = (): void => {
    setInitialTabName(VMWARE_HOST_TAB_VIRTUAL_MACHINES);
    setTabsKey((key: number): number => {
      return key + 1;
    });
  };

  const tabs: Array<Tab> = [
    {
      name: VMWARE_HOST_TAB_OVERVIEW,
      children: isRetrying ? (
        <PageLoader isVisible={true} />
      ) : rowError ? (
        <VMwarePartReadError
          kind={VMwareResourceKind.Host}
          message={rowError}
          onRetry={retryInventory}
        />
      ) : (
        <VMwareHostOverviewTab
          vcenterId={modelId}
          identity={identity}
          externalId={externalId}
          row={row}
          datacenterRow={datacenterRow}
          virtualMachineRows={virtualMachineRows}
          virtualMachineSummary={virtualMachineSummary}
          clusterRoute={clusterRoute}
          getVirtualMachineRoute={getVirtualMachineRoute}
          getIncidentRoute={(incidentId: ObjectID): Route => {
            return getRecordRoute(PageMap.INCIDENT_VIEW, incidentId);
          }}
          getAlertRoute={(alertId: ObjectID): Route => {
            return getRecordRoute(PageMap.ALERT_VIEW, alertId);
          }}
          getMonitorRoute={(monitorId: ObjectID): Route => {
            return getRecordRoute(PageMap.MONITOR_VIEW, monitorId);
          }}
          getRecommendationsRoute={(
            recommendationIds: Array<string>,
          ): Route => {
            return populate(
              PageMap.VMWARE_VCENTER_VIEW_RECOMMENDATIONS,
            ).addQueryParams({
              [RECOMMENDATION_SELECTION_QUERY_PARAM]:
                RecommendationFilterUtil.toSelectionQuery(recommendationIds),
            });
          }}
          incidentsRoute={populate(PageMap.VMWARE_VCENTER_VIEW_INCIDENTS)}
          alertsRoute={populate(PageMap.VMWARE_VCENTER_VIEW_ALERTS)}
          onShowVirtualMachines={showVirtualMachines}
          onRefreshInventory={refreshInventory}
        />
      ),
    },
    {
      name: VMWARE_HOST_TAB_VIRTUAL_MACHINES,
      /*
       * The VMs, templates left out: the number the hero, "View all N
       * virtual machines" and the vCenter's side menu give.
       */
      countBadge: virtualMachineSummary.total,
      children: (
        <VMwareHostVirtualMachinesTab
          rows={virtualMachineRows}
          hostRow={row}
          datacenterRow={datacenterRow}
          isLoading={isLoadingVirtualMachines || isRetrying}
          error={rowError}
          getVirtualMachineRoute={getVirtualMachineRoute}
          onRefreshClick={rowError ? retryInventory : refreshInventory}
        />
      ),
    },
    {
      name: VMWARE_HOST_TAB_METRICS,
      children: (
        <VMwareHostMetricsTab
          hostName={identity.hostName}
          attributes={getVMwareHostMetricAttributes(identity)}
        />
      ),
    },
    {
      name: VMWARE_HOST_TAB_LOGS,
      children: (
        <VMwareHostLogsTab
          vcenterId={modelId}
          vcenterName={identity.vcenterName}
          hostName={identity.hostName}
          clusterName={row?.clusterName || undefined}
          isProbeCollected={
            vcenter.collectionMethod === VMwareCollectionMethod.Probe
          }
          setupGuideRoute={populate(PageMap.VMWARE_VCENTER_VIEW_DOCUMENTATION)}
        />
      ),
    },
  ];

  return (
    <div data-testid="vmware-host-page">
      <VMwarePartHero
        kind={VMwareResourceKind.Host}
        row={row}
        isRowRead={!rowError && !isRetrying}
        externalId={externalId}
        datacenters={datacenterRow ? [datacenterRow] : []}
        hosts={row ? [row] : []}
        clusterRoute={clusterRoute}
        virtualMachines={virtualMachineSummary}
        now={OneUptimeDate.getCurrentDate()}
      />

      <VMwareHostReportNotice
        reportState={reportState}
        lastReportAt={lastReportAt}
        vcenterRoute={populate(PageMap.VMWARE_VCENTER_VIEW)}
        hostsRoute={populate(PageMap.VMWARE_VCENTER_VIEW_HOSTS)}
      />

      {/*
       * The tab row wraps on a phone, so Logs is never out of sight past
       * the edge of the screen.
       */}
      <Tabs
        key={tabsKey}
        tabs={tabs}
        initialTabName={initialTabName}
        wrap={true}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default VMwareVCenterHostDetail;

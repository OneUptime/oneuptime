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
  toFiniteNumber,
} from "../Utils/VMwareHostData";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../../Components/Recommendations/RecommendationFilterUtil";
import VMwareHostHero from "../../../Components/VMware/Host/VMwareHostHero";
import VMwareHostReportNotice from "../../../Components/VMware/Host/VMwareHostReportNotice";
import VMwareHostOverviewTab from "../../../Components/VMware/Host/VMwareHostOverviewTab";
import VMwareHostVirtualMachinesTab from "../../../Components/VMware/Host/VMwareHostVirtualMachinesTab";
import VMwareHostMetricsTab from "../../../Components/VMware/Host/VMwareHostMetricsTab";
import VMwareHostLogsTab from "../../../Components/VMware/Host/VMwareHostLogsTab";

/*
 * An ESXi host inside its vCenter: as deep as a host's page outside VMware,
 * from what vCenter reports about the host. The hero says which host it is,
 * where it sits and whether vCenter still reports it; the tabs hold its
 * Overview (tiles, charts, what is open on it, its busiest VMs, network
 * adapters, storage devices, host alerts, details and the AI agent), the
 * virtual machines it runs, every metric chart, and its logs.
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
  const [virtualMachineRows, setVirtualMachineRows] = useState<
    Array<VMwareResourceModel>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingVirtualMachines, setIsLoadingVirtualMachines] =
    useState<boolean>(true);
  const [error, setError] = useState<string>("");

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

    const vmRows: Array<VMwareResourceModel> = identity.hostName
      ? await fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.VirtualMachine,
          hostName: identity.hostName,
          datacenterName: identity.datacenterName,
        })
      : [];

    if (sequence !== inventorySequence.current) {
      return;
    }

    setRow(hostRow);
    setVirtualMachineRows(vmRows);
    setIsLoadingVirtualMachines(false);
  };

  const fetchData: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

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
      await fetchInventory(item.name);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
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
   * The cluster's own page: a cluster's inventory id is
   * "cluster/<datacenter>/<cluster>".
   */
  const clusterRoute: Route | undefined =
    row?.clusterName && identity.datacenterName
      ? populate(
          PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL,
          routeParamFromExternalId(
            `cluster/${identity.datacenterName}/${row.clusterName}`,
          ),
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
      children: (
        <VMwareHostOverviewTab
          vcenterId={modelId}
          identity={identity}
          externalId={externalId}
          row={row}
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
          isLoading={isLoadingVirtualMachines}
          getVirtualMachineRoute={getVirtualMachineRoute}
          onRefreshClick={refreshInventory}
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
      <VMwareHostHero
        hostName={identity.hostName}
        reportState={reportState}
        lastReportAt={lastReportAt}
        datacenterName={identity.datacenterName}
        clusterName={row?.clusterName || undefined}
        clusterRoute={clusterRoute}
        isStandalone={row ? !row.clusterName : undefined}
        cpuCapacityMhz={toFiniteNumber(row?.cpuCapacityMhz)}
        memoryCapacityBytes={toFiniteNumber(row?.maxMemoryBytes)}
        virtualMachines={virtualMachineSummary}
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

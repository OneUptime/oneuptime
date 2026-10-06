import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import IncidentStateUtil from "../../../Utils/IncidentState";
import AlertStateUtil from "../../../Utils/AlertState";
import ScheduledMaintenanceStateUtil from "../../../Utils/ScheduledMaintenanceState";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import RecommendationsSideMenuItem from "../../../Components/Recommendations/RecommendationsSideMenuItem";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import ProjectUtil from "Common/UI/Utils/Project";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayResourceKind, {
  StorageArrayResourceKindUtil,
} from "Common/Types/StorageArray/StorageArrayResourceKind";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ResourceCounts {
  volumes?: number | undefined;
  hosts?: number | undefined;
  pods?: number | undefined;
  directories?: number | undefined;
  fileSystems?: number | undefined;
  buckets?: number | undefined;
  // Hardware components, drives, controllers and network interfaces.
  hardware?: number | undefined;
  unhealthyHardware?: number | undefined;
}

export interface ComponentProps {
  modelId: ObjectID;
  /*
   * StorageArray.storageSystem. Undefined while it loads; an empty string
   * for an array whose platform is not known yet (registered by hand, no
   * data so far), which gets no inventory pages until it reports one.
   */
  storageSystem?: string | undefined;
  resourceCounts?: ResourceCounts | undefined;
}

/*
 * The inventory pages an array's platform has, in menu order: a
 * FlashArray's volumes, hosts, pods and directories, a FlashBlade's file
 * systems and buckets, and both platforms' hardware. Driven by
 * StorageArrayResourceKindUtil so the menu offers exactly the pages whose
 * objects the platform reports.
 */
export interface InventoryMenuItem {
  kind: StorageArrayResourceKind;
  pageKey: PageMap;
  title: string;
  icon: IconProp;
  countKey: keyof ResourceCounts;
}

export const INVENTORY_MENU_ITEMS: ReadonlyArray<InventoryMenuItem> = [
  {
    kind: StorageArrayResourceKind.Volume,
    pageKey: PageMap.STORAGE_ARRAY_VIEW_VOLUMES,
    title: "Volumes",
    icon: IconProp.Disc,
    countKey: "volumes",
  },
  {
    kind: StorageArrayResourceKind.Host,
    pageKey: PageMap.STORAGE_ARRAY_VIEW_HOSTS,
    title: "Hosts",
    icon: IconProp.Server,
    countKey: "hosts",
  },
  {
    kind: StorageArrayResourceKind.Pod,
    pageKey: PageMap.STORAGE_ARRAY_VIEW_REPLICATION,
    title: "Replication",
    icon: IconProp.Refresh,
    countKey: "pods",
  },
  {
    kind: StorageArrayResourceKind.Directory,
    pageKey: PageMap.STORAGE_ARRAY_VIEW_DIRECTORIES,
    title: "Directories",
    icon: IconProp.Folder,
    countKey: "directories",
  },
  {
    kind: StorageArrayResourceKind.FileSystem,
    pageKey: PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEMS,
    title: "File Systems",
    icon: IconProp.Folder,
    countKey: "fileSystems",
  },
  {
    kind: StorageArrayResourceKind.Bucket,
    pageKey: PageMap.STORAGE_ARRAY_VIEW_BUCKETS,
    title: "Buckets",
    icon: IconProp.Archive,
    countKey: "buckets",
  },
  {
    kind: StorageArrayResourceKind.Hardware,
    pageKey: PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
    title: "Hardware",
    icon: IconProp.CPUChip,
    countKey: "hardware",
  },
];

export function getInventoryMenuItems(
  storageSystem: string | null | undefined,
): Array<InventoryMenuItem> {
  const kinds: Array<StorageArrayResourceKind> =
    StorageArrayResourceKindUtil.getKindsForSystem(storageSystem);

  return INVENTORY_MENU_ITEMS.filter((item: InventoryMenuItem): boolean => {
    return kinds.includes(item.kind);
  });
}

const StorageArraySideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const counts: ResourceCounts = props.resourceCounts || {};

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [unresolvedIncidentStates, setUnresolvedIncidentStates] = useState<
    Array<IncidentState>
  >([]);
  const [unresolvedAlertStates, setUnresolvedAlertStates] = useState<
    Array<AlertState>
  >([]);
  const [
    activeScheduledMaintenanceStates,
    setActiveScheduledMaintenanceStates,
  ] = useState<Array<ScheduledMaintenanceState>>([]);

  const fetchIncidentStates: PromiseVoidFunction = async (): Promise<void> => {
    try {
      if (projectId) {
        const states: Array<IncidentState> =
          await IncidentStateUtil.getUnresolvedIncidentStates(projectId);
        setUnresolvedIncidentStates(states);
      }
    } catch {
      // ignore — badge simply won't show a count
    }
  };

  const fetchAlertStates: PromiseVoidFunction = async (): Promise<void> => {
    try {
      if (projectId) {
        const states: Array<AlertState> =
          await AlertStateUtil.getUnresolvedAlertStates(projectId);
        setUnresolvedAlertStates(states);
      }
    } catch {
      // ignore — badge simply won't show a count
    }
  };

  const fetchScheduledMaintenanceStates: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        if (projectId) {
          const states: Array<ScheduledMaintenanceState> =
            await ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates(
              projectId,
            );
          setActiveScheduledMaintenanceStates(states);
        }
      } catch {
        // ignore — badge simply won't show a count
      }
    };

  useEffect(() => {
    fetchIncidentStates().catch(() => {
      // do nothing
    });
    fetchAlertStates().catch(() => {
      // do nothing
    });
    fetchScheduledMaintenanceStates().catch(() => {
      // do nothing
    });
  }, []);

  const inventoryItems: Array<ReactElement> = getInventoryMenuItems(
    props.storageSystem,
  ).map((item: InventoryMenuItem): ReactElement => {
    /*
     * Hardware with a part in a bad state shows that number in red, so a
     * failed drive is visible from every tab; otherwise the badge is the
     * page's own count, like every other inventory page.
     */
    const unhealthyHardware: number = counts.unhealthyHardware || 0;
    const showUnhealthy: boolean =
      item.kind === StorageArrayResourceKind.Hardware && unhealthyHardware > 0;

    return (
      <SideMenuItem
        key={item.pageKey}
        link={{
          title: item.title,
          to: RouteUtil.populateRouteParams(RouteMap[item.pageKey] as Route, {
            modelId: props.modelId,
          }),
        }}
        icon={item.icon}
        badge={showUnhealthy ? unhealthyHardware : counts[item.countKey]}
        badgeType={showUnhealthy ? BadgeType.DANGER : undefined}
      />
    );
  });

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Resource Usage",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_INSIGHTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ChartBar}
        />
        <RecommendationsSideMenuItem
          link={{
            title: "Recommendations",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_RECOMMENDATIONS] as Route,
              { modelId: props.modelId },
            ),
          }}
          resourceType={MonitorRecommendationResourceType.StorageArray}
          resourceId={props.modelId}
        />
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_DOCUMENTATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>

      <SideMenuSection title="Telemetry">
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Graph}
        />
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />
      </SideMenuSection>

      {inventoryItems.length > 0 ? (
        <SideMenuSection title="Storage">{inventoryItems}</SideMenuSection>
      ) : (
        <></>
      )}

      <SideMenuSection title="Activity">
        <CountModelSideMenuItem<Incident>
          link={{
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
          badgeType={BadgeType.DANGER}
          modelType={Incident}
          countQuery={{
            projectId: projectId!,
            storageArrays: new Includes([props.modelId]),
            currentIncidentStateId: new Includes(
              unresolvedIncidentStates.map((state: IncidentState) => {
                return state.id!;
              }),
            ),
          }}
        />
        <CountModelSideMenuItem<Alert>
          link={{
            title: "Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ExclaimationCircle}
          badgeType={BadgeType.DANGER}
          modelType={Alert}
          countQuery={{
            projectId: projectId!,
            storageArrays: new Includes([props.modelId]),
            currentAlertStateId: new Includes(
              unresolvedAlertStates.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          }}
        />
        <CountModelSideMenuItem<ScheduledMaintenance>
          link={{
            title: "Scheduled Maintenance",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STORAGE_ARRAY_VIEW_SCHEDULED_MAINTENANCE
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Clock}
          badgeType={BadgeType.WARNING}
          modelType={ScheduledMaintenance}
          countQuery={{
            projectId: projectId!,
            storageArrays: new Includes([props.modelId]),
            currentScheduledMaintenanceStateId: new Includes(
              activeScheduledMaintenanceStates.map(
                (state: ScheduledMaintenanceState) => {
                  return state.id!;
                },
              ),
            ),
          }}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: StorageArray,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Feed",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_FEED] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Delete Storage Array",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default StorageArraySideMenu;

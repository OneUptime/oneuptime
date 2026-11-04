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
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import RecommendationsSideMenuItem from "../../../Components/Recommendations/RecommendationsSideMenuItem";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

// From the inventory summary. A kind it doesn't count shows no badge.
export interface ResourceCounts {
  services?: number | undefined;
  hypervisors?: number | undefined;
  instances?: number | undefined;
  networks?: number | undefined;
  routers?: number | undefined;
  floatingIps?: number | undefined;
  volumes?: number | undefined;
  projects?: number | undefined;
}

export interface ComponentProps {
  modelId: ObjectID;
  resourceCounts?: ResourceCounts | undefined;
}

const OpenStackCloudSideMenu: FunctionComponent<ComponentProps> = (
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

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Topology",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_TOPOLOGY] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.FlowDiagram}
        />
      </SideMenuSection>

      <SideMenuSection title="Control Plane">
        <SideMenuItem
          link={{
            title: "Services",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SERVICES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Activity}
          badge={counts.services}
        />
      </SideMenuSection>

      <SideMenuSection title="Compute">
        <SideMenuItem
          link={{
            title: "Hypervisors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ServerStack}
          badge={counts.hypervisors}
        />
        <SideMenuItem
          link={{
            title: "Instances",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Cube}
          badge={counts.instances}
        />
        <SideMenuItem
          link={{
            title: "Flavors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.SquareStack}
        />
        <SideMenuItem
          link={{
            title: "Availability Zones",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.MapPin}
        />
        <SideMenuItem
          link={{
            title: "Aggregates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.RectangleStack}
        />
      </SideMenuSection>

      <SideMenuSection title="Network">
        <SideMenuItem
          link={{
            title: "Networks",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Globe}
          badge={counts.networks}
        />
        <SideMenuItem
          link={{
            title: "Subnets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SUBNETS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Layers}
        />
        <SideMenuItem
          link={{
            title: "Routers",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Share}
          badge={counts.routers}
        />
        <SideMenuItem
          link={{
            title: "Floating IPs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.MapPin}
          badge={counts.floatingIps}
        />
        <SideMenuItem
          link={{
            title: "Network Agents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Activity}
        />
      </SideMenuSection>

      <SideMenuSection title="Storage">
        <SideMenuItem
          link={{
            title: "Volumes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Disc}
          badge={counts.volumes}
        />
        <SideMenuItem
          link={{
            title: "Storage Pools",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Database}
        />
        <SideMenuItem
          link={{
            title: "Snapshots and Backups",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SNAPSHOTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Archive}
        />
        <SideMenuItem
          link={{
            title: "Images",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_IMAGES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Image}
        />
      </SideMenuSection>

      <SideMenuSection title="Tenancy">
        <SideMenuItem
          link={{
            title: "Projects",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Folder}
          badge={counts.projects}
        />
        <SideMenuItem
          link={{
            title: "Domains",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DOMAINS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.BuildingOffice}
        />
      </SideMenuSection>

      <SideMenuSection title="Telemetry">
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Graph}
        />
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />
        <RecommendationsSideMenuItem
          link={{
            title: "Recommendations",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_RECOMMENDATIONS] as Route,
              { modelId: props.modelId },
            ),
          }}
          resourceType={MonitorRecommendationResourceType.OpenStack}
          resourceId={props.modelId}
        />
      </SideMenuSection>

      <SideMenuSection title="Activity">
        <CountModelSideMenuItem<Incident>
          link={{
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
          badgeType={BadgeType.DANGER}
          modelType={Incident}
          countQuery={{
            projectId: projectId!,
            openStackClouds: new Includes([props.modelId]),
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
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ExclaimationCircle}
          badgeType={BadgeType.DANGER}
          modelType={Alert}
          countQuery={{
            projectId: projectId!,
            openStackClouds: new Includes([props.modelId]),
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
                PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Clock}
          badgeType={BadgeType.WARNING}
          modelType={ScheduledMaintenance}
          countQuery={{
            projectId: projectId!,
            openStackClouds: new Includes([props.modelId]),
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
        modelType: OpenStackCloud,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Feed",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FEED] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Delete Cloud",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DELETE] as Route,
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

export default OpenStackCloudSideMenu;

import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
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
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const NetworkSiteViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [
    activeScheduledMaintenanceStates,
    setActiveScheduledMaintenanceStates,
  ] = useState<Array<ScheduledMaintenanceState>>([]);

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
        // ignore — the badge simply won't show a count.
      }
    };

  useEffect(() => {
    fetchScheduledMaintenanceStates().catch(() => {
      // handled above.
    });
  }, []);

  return (
    <SideMenu>
      <SideMenuSection title="Site">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Devices",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_DEVICES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Signal}
        />
        <SideMenuItem
          link={{
            title: "Child Sites",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_CHILD_SITES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.SquareStack}
        />
        <SideMenuItem
          link={{
            title: "Endpoints",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_ENDPOINTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Squares}
        />
        <SideMenuItem
          link={{
            title: "Status Timeline",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_STATUS_TIMELINE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        {/*
         * Counts only the windows attached to THIS site, matching what the
         * page lists. A window attached to an ancestor covers this site too
         * and is reflected in its uptime, but it is not this site's row to
         * edit.
         */}
        <CountModelSideMenuItem<ScheduledMaintenance>
          link={{
            title: "Scheduled Maintenance",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.NETWORK_SITE_VIEW_SCHEDULED_MAINTENANCE
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Clock}
          badgeType={BadgeType.WARNING}
          modelType={ScheduledMaintenance}
          countQuery={{
            projectId: projectId!,
            networkSites: new Includes([props.modelId]),
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

      <SideMenuSection title="Manage">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Delete Site",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_DELETE] as Route,
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

export default NetworkSiteViewSideMenu;

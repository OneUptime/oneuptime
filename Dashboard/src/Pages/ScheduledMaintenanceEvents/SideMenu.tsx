import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  project?: Project | undefined;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Overview",
      items: [
        {
          link: {
            title: "All Events",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Ongoing Events",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS] as Route,
            ),
          },
          icon: IconProp.Clock,
          badgeType: BadgeType.WARNING,
          modelType: ScheduledMaintenance,
          countQuery: {
            projectId: props.project?._id,
            currentScheduledMaintenanceState: {
              isOngoingState: true,
            },
          } as any,
        },
      ],
    },
    {
      title: "Workspace Connections",
      items: [
        {
          link: {
            title: "Slack",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK
              ] as Route,
            ),
          },
          icon: IconProp.Slack,
        },
        {
          link: {
            title: "Microsoft Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap
                  .SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
              ] as Route,
            ),
          },
          icon: IconProp.MicrosoftTeams,
        },
      ],
    },
    {
      title: "Settings",
      items: [
        {
          link: {
            title: "Event State",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE
              ] as Route,
            ),
          },
          icon: IconProp.ArrowCircleRight,
        },
        {
          link: {
            title: "Event Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Template,
        },
        {
          link: {
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Pencil,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS
              ] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;

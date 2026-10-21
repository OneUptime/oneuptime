import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import React, { FunctionComponent, ReactElement } from "react";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";
import { useWorkspaceSideMenuSection } from "../../Components/Workspace/WorkspaceSideMenuSection";
import useInProgressScheduledMaintenanceStateIds from "../../Components/ScheduledMaintenance/useInProgressScheduledMaintenanceStateIds";

export interface ComponentProps {
  project?: Project | undefined;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Only the chat workspaces this project has connected, or one entry to
   * connect one when it has none (WorkspaceSideMenuSection.ts).
   */
  const workspaceSection: SideMenuSectionProps | null =
    useWorkspaceSideMenuSection({
      slack: PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK,
      microsoftTeams:
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      connect: PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTIONS,
    });

  /*
   * The events in progress: in the project's ongoing state, or in a state
   * of its own placed between Ongoing and Ended, such as "Verifying". The
   * badge waits for the project's states.
   */
  const { inProgressStateIds } = useInProgressScheduledMaintenanceStateIds();

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
          countQuery: inProgressStateIds
            ? ({
                projectId: props.project?._id,
                currentScheduledMaintenanceStateId: new Includes(
                  inProgressStateIds.map((stateId: ObjectID) => {
                    return stateId.toString();
                  }),
                ),
              } as any)
            : undefined,
        },
      ],
    },
    /*
     * The calendar, a page of its own: every event by month, week or day,
     * with the calendars from outside the project beside them. It used to
     * be a List | Calendar switch on All Events. Open, like Overview: people
     * plan maintenance on it.
     */
    {
      title: "Calendar",
      items: [
        {
          link: {
            title: "Maintenance Calendar",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_CALENDAR] as Route,
            ),
          },
          icon: IconProp.Calendar,
        },
      ],
    },
    ...(workspaceSection ? [workspaceSection] : []),
    /*
     * Every "when an event looks like X, do Y" page lives here. Collapsed by
     * default because these are set up once and rarely revisited. Scheduled
     * maintenance has no AI settings page or auto-remediation rules — unlike
     * incidents and alerts, nothing here is investigated or auto-remediated.
     */
    {
      title: "Rules",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_OWNER_RULES
              ] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Runbook Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_RUNBOOK_RULES
              ] as Route,
            ),
          },
          icon: IconProp.BookOpen,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_LABEL_RULES
              ] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
        {
          link: {
            title: "Reminder Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_REMINDER_RULES
              ] as Route,
            ),
          },
          icon: IconProp.Bell,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
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
        {
          link: {
            title: "Measurements",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_MEASUREMENTS
              ] as Route,
            ),
          },
          icon: IconProp.Clock,
        },
        /*
         * The calendars from outside the project the Maintenance Calendar
         * shows beside the events. Set up once, so here in the folded
         * Settings rather than beside the calendar; before Numbering, which
         * is every product's last Settings entry.
         */
        {
          link: {
            title: "Calendar Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR
              ] as Route,
            ),
          },
          icon: IconProp.Calendar,
        },
        // How event numbers look (SM-42) and which comes next.
        {
          link: {
            title: "Numbering",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NUMBERING
              ] as Route,
            ),
          },
          icon: IconProp.Hashtag,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: ScheduledMaintenance,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;

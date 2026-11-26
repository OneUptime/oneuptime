import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import NotOperationalMonitorQuery from "Common/Utils/Monitor/NotOperationalMonitorQuery";
import React, { FunctionComponent, ReactElement } from "react";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";
import { useWorkspaceSideMenuSection } from "../../Components/Workspace/WorkspaceSideMenuSection";

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
      slack: PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK,
      microsoftTeams: PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      mattermost: PageMap.MONITORS_WORKSPACE_CONNECTION_MATTERMOST,
      connect: PageMap.MONITORS_WORKSPACE_CONNECTIONS,
    });

  const sections: SideMenuSectionProps[] = [
    {
      title: "Monitors",
      items: [
        {
          link: {
            title: "All Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        ...(props.project?.isFeatureFlagMonitorGroupsEnabled
          ? [
              {
                link: {
                  title: "Monitor Groups",
                  to: RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITOR_GROUPS] as Route,
                  ),
                },
                icon: IconProp.Squares,
              },
            ]
          : []),
        /*
         * Monitors someone disabled on purpose. A choice, not a fault, so it
         * sits with the monitors rather than under Attention Required, and
         * its count is grey with the pause icon the monitor's own banner
         * shows (DisabledWarning). A red count that never goes away taught
         * people to ignore red (#9126).
         */
        {
          link: {
            title: "Disabled",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_DISABLED] as Route,
            ),
          },
          icon: IconProp.Pause,
          badgeType: BadgeType.PAUSED,
          modelType: Monitor,
          countQuery: {
            projectId: props.project?._id,
            isArchived: false,
            disableActiveMonitoring: true,
          },
        },
      ],
    },
    {
      title: "Attention Required",
      items: [
        {
          link: {
            title: "Not Operational",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_INOPERATIONAL] as Route,
            ),
          },
          icon: IconProp.Alert,
          badgeType: BadgeType.DANGER,
          modelType: Monitor,
          // What the list shows: monitors with monitoring off are Disabled.
          countQuery: {
            projectId: props.project?._id,
            ...NotOperationalMonitorQuery.getQuery(props.project?._id),
          },
        },
        {
          link: {
            title: "Probes Disconnected",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_PROBE_DISCONNECTED] as Route,
            ),
          },
          icon: IconProp.NoSignal,
          badgeType: BadgeType.DANGER,
          modelType: Monitor,
          countQuery: {
            projectId: props.project?._id,
            isArchived: false,
            isAllProbesDisconnectedFromThisMonitor: true,
          },
        },
        /*
         * Monitors no enabled probe checks: every probe of theirs is
         * disabled, or they have none. It was "Probe Disabled", which read
         * as one probe being switched off (#9126). The same words as the
         * monitor's own badge (MonitorRowStatus).
         */
        {
          link: {
            title: "No Probe Enabled",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_PROBE_DISABLED] as Route,
            ),
          },
          icon: IconProp.EyeSlash,
          badgeType: BadgeType.DANGER,
          modelType: Monitor,
          countQuery: {
            projectId: props.project?._id,
            isArchived: false,
            isNoProbeEnabledOnThisMonitor: true,
          },
        },
      ],
    },
    ...(workspaceSection ? [workspaceSection] : []),
    /*
     * Rules run by themselves once written, so they fold away under a
     * section of their own, as Incidents, Alerts and Maintenance file
     * theirs. Their addresses did not move (settings/owner-rules), as
     * Incidents' did not, so bookmarks keep working.
     */
    {
      title: "Rules",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
        /*
         * Who changed the rules above, what and when (#10462): most of them
         * have no page of their own to hold their history.
         */
        {
          link: {
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_RULES_AUDIT_LOGS] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Monitor Status",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS] as Route,
            ),
          },
          icon: IconProp.AltGlobe,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Secrets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_SECRETS] as Route,
            ),
          },
          icon: IconProp.Lock,
        },
        {
          link: {
            title: "Incoming Request Secrets",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.MONITORS_SETTINGS_INCOMING_REQUEST_SECRETS
              ] as Route,
            ),
          },
          icon: IconProp.Key,
        },
        {
          link: {
            title: "Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Template,
        },
        {
          link: {
            title: "Probes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
            ),
          },
          icon: IconProp.Signal,
        },
      ],
    },
    /*
     * The way back to archived monitors, which the list leaves out. Few visits
     * need it, so it waits in Advanced: folded away until opened, and open by
     * itself on the Archived page.
     */
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: Monitor,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;

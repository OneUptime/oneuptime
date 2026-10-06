import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";
import { useWorkspaceSideMenuSection } from "../../Components/Workspace/WorkspaceSideMenuSection";
import useUnresolvedStateIds from "../../Components/EventView/useUnresolvedStateIds";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";

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
      slack: PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK,
      microsoftTeams: PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      connect: PageMap.ALERTS_WORKSPACE_CONNECTIONS,
    });

  /*
   * Active: in a state above the project's resolved state - a state placed
   * after it counts as resolved (Common/Utils/ResolvedState). The badge
   * counts once the states are read.
   */
  const { unresolvedStateIds } = useUnresolvedStateIds("alert");

  const sections: SideMenuSectionProps[] = [
    {
      title: "Alerts",
      items: [
        {
          link: {
            title: "All Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Active Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_ALERTS] as Route,
            ),
          },
          icon: IconProp.ExclaimationCircle,
          badgeType: BadgeType.DANGER,
          modelType: Alert,
          countQuery: unresolvedStateIds
            ? ({
                projectId: props.project?._id,
                currentAlertStateId: new Includes(
                  unresolvedStateIds.map((stateId: ObjectID) => {
                    return stateId.toString();
                  }),
                ),
              } as any)
            : undefined,
        },
      ],
    },
    {
      title: "Episodes",
      items: [
        {
          link: {
            title: "All Episodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODES] as Route,
            ),
          },
          icon: IconProp.SquareStack,
        },
        {
          link: {
            title: "Active Episodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_ALERT_EPISODES] as Route,
            ),
          },
          icon: IconProp.ExclaimationCircle,
          badgeType: BadgeType.WARNING,
          modelType: AlertEpisode,
          countQuery: {
            projectId: props.project?._id,
            resolvedAt: null,
          } as any,
        },
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_DOCS] as Route,
            ),
          },
          icon: IconProp.Book,
        },
      ],
    },
    /*
     * Everything OneUptime AI does for alerts, in one place: what it
     * learned (Insights), what it did (Logs), how it is set up (Settings)
     * and the rules that let it fix things (Auto Remediation Rules). Folded
     * down to its title until opened, like the AI section of every menu
     * (SideMenuSectionState.ts), and open by itself on its pages.
     */
    {
      title: "AI",
      items: [
        {
          link: {
            title: "Insights",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_AI_INSIGHTS] as Route,
            ),
          },
          icon: IconProp.LightBulb,
        },
        {
          link: {
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_AI_LOGS] as Route,
            ),
          },
          icon: IconProp.QueueList,
        },
        {
          link: {
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_AI] as Route,
            ),
          },
          icon: IconProp.Settings,
        },
        {
          link: {
            title: "Auto Remediation Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES] as Route,
            ),
          },
          icon: IconProp.Bolt,
        },
      ],
    },
    ...(workspaceSection ? [workspaceSection] : []),
    /*
     * Every "when an alert looks like X, do Y" page lives here. Collapsed by
     * default because these are set up once and rarely revisited, and left
     * expanded they pushed Settings off the bottom of the menu card.
     */
    {
      title: "Rules",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Grouping Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_GROUPING_RULES] as Route,
            ),
          },
          icon: IconProp.Filter,
        },
        {
          link: {
            title: "On-Call Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_ON_CALL_RULES] as Route,
            ),
          },
          icon: IconProp.Call,
        },
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Runbook Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_RUNBOOK_RULES] as Route,
            ),
          },
          icon: IconProp.BookOpen,
        },
        {
          link: {
            title: "Privacy Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_PRIVACY_RULES] as Route,
            ),
          },
          icon: IconProp.Lock,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
        {
          link: {
            title: "Reminder Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_REMINDER_RULES] as Route,
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
            title: "Alert State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_STATE] as Route,
            ),
          },
          icon: IconProp.ArrowCircleRight,
        },
        {
          link: {
            title: "Alert Severity",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_SEVERITY] as Route,
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Pencil,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Measurements",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_MEASUREMENTS] as Route,
            ),
          },
          icon: IconProp.Clock,
        },
        // The text in front of alert and episode numbers (ALT-42).
        {
          link: {
            title: "Number Prefix",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_NUMBER_PREFIX] as Route,
            ),
          },
          icon: IconProp.Hashtag,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: Alert,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;

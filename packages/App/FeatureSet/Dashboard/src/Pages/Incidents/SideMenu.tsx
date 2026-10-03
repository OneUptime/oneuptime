import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import Project from "Common/Models/DatabaseModels/Project";
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
      slack: PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
      microsoftTeams: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      connect: PageMap.INCIDENTS_WORKSPACE_CONNECTIONS,
    });

  const sections: SideMenuSectionProps[] = [
    {
      title: "Overview",
      items: [
        {
          link: {
            title: "All Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Active Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route,
            ),
          },
          icon: IconProp.Alert,
          badgeType: BadgeType.DANGER,
          modelType: Incident,
          countQuery: {
            projectId: props.project?._id,
            currentIncidentState: {
              isResolvedState: false,
            },
          } as any,
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
              RouteMap[PageMap.INCIDENT_EPISODES] as Route,
            ),
          },
          icon: IconProp.SquareStack3D,
        },
        {
          link: {
            title: "Active Episodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_INCIDENT_EPISODES] as Route,
            ),
          },
          icon: IconProp.Alert,
          badgeType: BadgeType.DANGER,
          modelType: IncidentEpisode,
          countQuery: {
            projectId: props.project?._id,
            resolvedAt: null,
          } as any,
        },
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_EPISODE_DOCS] as Route,
            ),
          },
          icon: IconProp.Book,
        },
      ],
    },
    ...(workspaceSection ? [workspaceSection] : []),
    /*
     * Every "when an incident looks like X, do Y" page lives here. Collapsed by
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
              RouteMap[PageMap.INCIDENTS_SETTINGS_GROUPING_RULES] as Route,
            ),
          },
          icon: IconProp.Filter,
        },
        {
          link: {
            title: "On-Call Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES] as Route,
            ),
          },
          icon: IconProp.Call,
        },
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Runbook Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_RUNBOOK_RULES] as Route,
            ),
          },
          icon: IconProp.BookOpen,
        },
        {
          link: {
            title: "Auto Remediation Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES
              ] as Route,
            ),
          },
          icon: IconProp.Bolt,
        },
        {
          link: {
            title: "Privacy Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_PRIVACY_RULES] as Route,
            ),
          },
          icon: IconProp.Lock,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
        {
          link: {
            title: "SLA Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_SLA_RULES] as Route,
            ),
          },
          icon: IconProp.Clock,
        },
        {
          link: {
            title: "Reminder Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_REMINDER_RULES] as Route,
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
        /*
         * First: this page governs the work AI does on its own for every
         * incident, and nothing limits that work until a limit is set there.
         */
        {
          link: {
            title: "AI",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_AI] as Route,
            ),
          },
          icon: IconProp.Sparkles,
        },
        {
          link: {
            title: "Incident State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_STATE] as Route,
            ),
          },
          icon: IconProp.ArrowCircleRight,
        },
        {
          link: {
            title: "Incident Severity",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_SEVERITY] as Route,
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Incident Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Template,
        },
        {
          link: {
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Pencil,
        },
        {
          link: {
            title: "Postmortem Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Book,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Incident Roles",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_ROLES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Measurements",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_MEASUREMENTS] as Route,
            ),
          },
          icon: IconProp.Clock,
        },
        /*
         * Whether an incident's linked alerts follow it when it is
         * acknowledged or resolved. Its own page so it is findable by name.
         */
        {
          link: {
            title: "Linked Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_LINKED_ALERTS] as Route,
            ),
          },
          icon: IconProp.Link,
        },
        /*
         * The text in front of incident and episode numbers (INC-42). A
         * page of its own, named for what it holds: it was the only thing
         * left on the More Settings page it replaced.
         */
        {
          link: {
            title: "Number Prefix",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_NUMBER_PREFIX] as Route,
            ),
          },
          icon: IconProp.Hashtag,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: Incident,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;

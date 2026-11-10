import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";
import { useWorkspaceSideMenuSection } from "../../Components/Workspace/WorkspaceSideMenuSection";

const SloSideMenu: FunctionComponent = (): ReactElement => {
  /*
   * The rules that post SLOs' error budget policy changes to chat: only the
   * chat workspaces this project has connected, or one entry to connect one
   * when it has none (WorkspaceSideMenuSection.ts).
   */
  const workspaceSection: SideMenuSectionProps | null =
    useWorkspaceSideMenuSection({
      slack: PageMap.SLOS_WORKSPACE_CONNECTION_SLACK,
      microsoftTeams: PageMap.SLOS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      mattermost: PageMap.SLOS_WORKSPACE_CONNECTION_MATTERMOST,
      connect: PageMap.SLOS_WORKSPACE_CONNECTIONS,
    });

  const sections: SideMenuSectionProps[] = [
    {
      title: "Service Level Objectives",
      items: [
        {
          link: {
            title: "SLOs",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.SLOS] as Route),
          },
          icon: IconProp.Gauge,
        },
      ],
    },
    // Folded, as every product's Workspace section is, before its Settings.
    ...(workspaceSection ? [workspaceSection] : []),
    /*
     * Collapsed like every other product's Settings section. Written as a
     * `sections` entry rather than a hand-rolled <SideMenuSection> so the
     * menu works out which section holds the current page and reopens this
     * one on Owner Rules and Label Rules, instead of hiding the page you are
     * on.
     */
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLOS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLOS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived SLOs, which the list leaves out. Few visits need
     * it, so it waits in Advanced: folded away until opened, and open by itself
     * on the Archived page.
     */
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLOS_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: ServiceLevelObjective,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default SloSideMenu;

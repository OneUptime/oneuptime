import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import React, { ReactElement } from "react";
import { getDeveloperSideMenuSectionProps } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const DashboardSideMenu: () => ReactElement = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Workflows",
      items: [
        {
          link: {
            title: "Workflows",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOWS] as Route,
            ),
          },
          icon: IconProp.Workflow,
        },
        {
          link: {
            title: "Global Variables",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOWS_VARIABLES] as Route,
            ),
          },
          icon: IconProp.Variable,
        },
      ],
    },
    /*
     * Runs get a Logs section of their own, open and second in the menu: the
     * run history is where people go to check that a workflow worked, so it
     * should not read as one more thing to build. The page keeps its old
     * /workflows/logs URL, which the section's name now matches.
     */
    {
      title: "Logs",
      items: [
        {
          link: {
            title: "Runs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOWS_LOGS] as Route,
            ),
          },
          icon: IconProp.Logs,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOWS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOWS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived workflows, which the list leaves out. Few visits
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
              RouteMap[PageMap.WORKFLOWS_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
    getDeveloperSideMenuSectionProps({
      modelType: Workflow,
      scope: DeveloperDocsScope.List,
    }),
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;

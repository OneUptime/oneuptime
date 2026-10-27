import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";
import React, { ReactElement } from "react";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const DashboardsSideMenu: () => ReactElement = (): ReactElement => {
  const playlistViewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DASHBOARD_PLAYLIST_VIEW] as Route,
  );

  const sections: SideMenuSectionProps[] = [
    {
      title: "Dashboards",
      items: [
        {
          link: {
            title: "Dashboards",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARDS] as Route,
            ),
          },
          icon: IconProp.Window,
        },
        /*
         * Dashboards shown one after another on a screen (issue #5235). A
         * playlist's own page keeps it marked: the playlist is one of these.
         */
        {
          link: {
            title: "Playlists",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_PLAYLISTS] as Route,
            ),
          },
          activeRoute: Navigation.isOnThisPage(playlistViewRoute)
            ? playlistViewRoute
            : undefined,
          icon: IconProp.QueueList,
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
              RouteMap[PageMap.DASHBOARDS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARDS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
        {
          link: {
            title: "Data Sources",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARDS_SETTINGS_DATA_SOURCES] as Route,
            ),
          },
          icon: IconProp.Database,
        },
      ],
    },
    /*
     * The way back to archived dashboards, which the list leaves out. Few
     * visits need it, so it waits in Advanced: folded away until opened, and
     * open by itself on the Archived page.
     */
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARDS_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: Dashboard,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default DashboardsSideMenu;

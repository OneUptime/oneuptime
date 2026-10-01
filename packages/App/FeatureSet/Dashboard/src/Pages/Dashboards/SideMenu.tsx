import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { ReactElement } from "react";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const DashboardsSideMenu: () => ReactElement = (): ReactElement => {
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
         * Archived dashboards are filtered out of the list above, so without
         * this entry the only way back to one would be its URL.
         */
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
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: Dashboard,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default DashboardsSideMenu;

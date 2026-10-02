import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const RumSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Real User Monitoring",
      items: [
        {
          link: {
            title: "All Applications",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATIONS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
    /*
     * settings-setup-5: this section used to start collapsed, which hid the
     * project-wide replay switch that every piece of replay copy points at.
     * Three items do not need collapsing.
     */
    {
      title: "Settings",
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
        {
          link: {
            title: "Session Replay",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY] as Route,
            ),
          },
          icon: IconProp.Film,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: RumApplication,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default RumSideMenu;

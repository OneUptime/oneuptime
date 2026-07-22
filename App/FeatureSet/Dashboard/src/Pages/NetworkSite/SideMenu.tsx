import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getNetworkMapRootRoute } from "../../Components/NetworkSite/NetworkMapDrillState";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const NetworkSiteSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Network Sites",
      items: [
        {
          link: {
            title: "Sites",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITES] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          /*
           * Deliberately not the bare map route: the map keeps its drill
           * position in the query string, and a link to the pathname the user
           * is already on is swallowed by Navigation.navigate. See
           * getNetworkMapRootRoute.
           */
          link: {
            title: "Network Map",
            to: getNetworkMapRootRoute(),
          },
          icon: IconProp.Map,
        },
        {
          link: {
            title: "Assignment Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_ASSIGNMENT_RULES] as Route,
            ),
          },
          icon: IconProp.Filter,
        },
        {
          link: {
            title: "Links",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_LINKS] as Route,
            ),
          },
          icon: IconProp.Link,
        },
        {
          link: {
            title: "Import",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_IMPORT] as Route,
            ),
          },
          icon: IconProp.Upload,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default NetworkSiteSideMenu;

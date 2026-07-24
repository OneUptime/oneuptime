import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getNetworkMapRootRoute } from "../NetworkSite/NetworkMapDrillState";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The one side menu for the whole Network area. Both the Network Devices
 * and Network Sites sections render this same component, so wherever the
 * user lands they see the entire product — fleet overview, device
 * inventory, site hierarchy, map, topology — as one coherent thing instead
 * of two disconnected page groups.
 */
const NetworkSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Network",
      items: [
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_OVERVIEW] as Route,
            ),
          },
          icon: IconProp.Window,
        },
        {
          link: {
            title: "Devices",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICES] as Route,
            ),
          },
          icon: IconProp.Signal,
        },
        {
          link: {
            title: "Sites",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITES] as Route,
            ),
          },
          icon: IconProp.BuildingOffice,
        },
        {
          /*
           * Deliberately not the bare map route: the map keeps its drill
           * position in the query string, and a link to the pathname the
           * user is already on is swallowed by Navigation.navigate. See
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
            title: "Topology",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_TOPOLOGY] as Route,
            ),
          },
          icon: IconProp.Graph,
        },
        {
          link: {
            title: "Endpoints",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_ENDPOINTS] as Route,
            ),
          },
          icon: IconProp.Squares,
        },
      ],
    },
    {
      title: "Analysis",
      items: [
        {
          link: {
            title: "Latency Matrix",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_LATENCY_MATRIX] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Site Links",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_LINKS] as Route,
            ),
          },
          icon: IconProp.Link,
        },
      ],
    },
    {
      title: "Discovery & Import",
      items: [
        {
          link: {
            title: "Discovery Scans",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_DISCOVERY] as Route,
            ),
          },
          icon: IconProp.Search,
        },
        {
          link: {
            title: "Import Sites",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_IMPORT] as Route,
            ),
          },
          icon: IconProp.Upload,
        },
      ],
    },
    {
      title: "Automation",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Site Assignment Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_ASSIGNMENT_RULES] as Route,
            ),
          },
          icon: IconProp.Filter,
        },
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Label,
        },
      ],
    },
    {
      title: "Archive",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Archived Devices",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default NetworkSideMenu;

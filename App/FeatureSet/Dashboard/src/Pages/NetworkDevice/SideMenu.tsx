import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const NetworkDeviceSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Network Devices",
      items: [
        {
          link: {
            title: "All Devices",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICES] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
        {
          link: {
            title: "Discover Devices",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_DISCOVERY] as Route,
            ),
          },
          icon: IconProp.Search,
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
            title: "Latency Matrix",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_LATENCY_MATRIX] as Route,
            ),
          },
          icon: IconProp.TableCells,
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
  ];

  return <SideMenu sections={sections} />;
};

export default NetworkDeviceSideMenu;

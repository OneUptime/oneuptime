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
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default NetworkDeviceSideMenu;

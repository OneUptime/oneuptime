import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

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
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default RumSideMenu;

import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const CloudSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Cloud",
      items: [
        {
          link: {
            title: "All Resources",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCES] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default CloudSideMenu;

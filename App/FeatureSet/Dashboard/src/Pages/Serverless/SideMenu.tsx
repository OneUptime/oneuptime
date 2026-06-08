import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const ServerlessSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Serverless",
      items: [
        {
          link: {
            title: "All Functions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_FUNCTIONS] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default ServerlessSideMenu;

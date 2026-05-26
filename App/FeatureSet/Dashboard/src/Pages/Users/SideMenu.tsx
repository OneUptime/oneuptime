import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const UsersSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Users",
      items: [
        {
          link: {
            title: "All Users",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
          },
          icon: IconProp.User,
        },
      ],
    },
    {
      title: "Configuration",
      items: [
        {
          link: {
            title: "User Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default UsersSideMenu;

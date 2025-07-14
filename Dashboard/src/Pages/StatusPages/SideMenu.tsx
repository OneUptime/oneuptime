import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Status Pages",
      items: [
        {
          link: {
            title: "All Status Pages",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES] as Route,
            ),
          },
          icon: IconProp.CheckCircle,
        },
      ],
    },
    {
      title: "More",
      items: [
        {
          link: {
            title: "Announcements",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
            ),
          },
          icon: IconProp.Announcement,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;

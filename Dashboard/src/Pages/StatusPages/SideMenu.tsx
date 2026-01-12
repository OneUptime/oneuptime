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
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Announcement Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Announcement,
        },
        {
          link: {
            title: "Subscriber Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Email,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;

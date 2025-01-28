import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

const DashboardSideMenu: FunctionComponent = (

): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Status Pages">
        <SideMenuItem
          link={{
            title: "All Status Pages",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES] as Route,
            ),
          }}
          icon={IconProp.CheckCircle}
        />
      </SideMenuSection>
      <SideMenuSection title="More">
        <SideMenuItem
          link={{
            title: "Announcements",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
            ),
          }}
          icon={IconProp.Announcement}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;

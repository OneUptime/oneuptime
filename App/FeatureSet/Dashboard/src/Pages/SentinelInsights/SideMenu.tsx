import React, { FunctionComponent, ReactElement } from "react";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import IconProp from "Common/Types/Icon/IconProp";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Overview">
        <SideMenuItem
          link={{
            title: "Insights",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SENTINEL_INSIGHTS] as Route,
            ),
          }}
          icon={IconProp.LightBulb}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SENTINEL_INSIGHTS_SETTINGS] as Route,
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;

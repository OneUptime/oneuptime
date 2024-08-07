import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Services",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_SERVICES] as Route,
            ),
          }}
          icon={IconProp.SquareStack}
        />
      </SideMenuSection>
      <SideMenuSection title="Telemetry">
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_LOGS] as Route,
            ),
          }}
          icon={IconProp.Logs}
        />
        <SideMenuItem
          link={{
            title: "Traces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_TRACES] as Route,
            ),
          }}
          icon={IconProp.RectangleStack}
        />
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_METRICS] as Route,
            ),
          }}
          icon={IconProp.ChartBar}
        />
      </SideMenuSection>
      <SideMenuSection title="Views">
        <SideMenuItem
          link={{
            title: "Dashboards",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_DASHBOARDS] as Route,
            ),
          }}
          icon={IconProp.Window}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;

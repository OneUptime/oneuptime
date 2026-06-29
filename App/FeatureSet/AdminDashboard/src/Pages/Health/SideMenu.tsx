import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { ReactElement } from "react";

const HealthSideMenu: () => JSX.Element = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Overview">
        <SideMenuItem
          link={{
            title: "Instance Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HEALTH] as Route,
            ),
          }}
          icon={IconProp.Activity}
        />
      </SideMenuSection>

      <SideMenuSection title="Datastores">
        <SideMenuItem
          link={{
            title: "PostgreSQL",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HEALTH_POSTGRES] as Route,
            ),
          }}
          icon={IconProp.Database}
        />
        <SideMenuItem
          link={{
            title: "ClickHouse",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HEALTH_CLICKHOUSE] as Route,
            ),
          }}
          icon={IconProp.Database}
        />
        <SideMenuItem
          link={{
            title: "Query Console",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HEALTH_QUERY] as Route,
            ),
          }}
          icon={IconProp.Terminal}
        />
      </SideMenuSection>

      <SideMenuSection title="Diagnostics">
        <SideMenuItem
          link={{
            title: "Diagnostic Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HEALTH_LOGS] as Route,
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Global Probes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HEALTH_PROBES] as Route,
            ),
          }}
          icon={IconProp.Signal}
        />
      </SideMenuSection>

      <SideMenuSection title="Maintenance">
        <SideMenuItem
          link={{
            title: "Migrations",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HEALTH_MIGRATIONS] as Route,
            ),
          }}
          icon={IconProp.Database}
        />
        <SideMenuItem
          link={{
            title: "Support Bundle",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HEALTH_SUPPORT_BUNDLE] as Route,
            ),
          }}
          icon={IconProp.File}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default HealthSideMenu;

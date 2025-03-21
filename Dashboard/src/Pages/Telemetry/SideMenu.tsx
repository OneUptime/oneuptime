import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import DashboardNavigation from "../../Utils/Navigation";

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
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_DOCUMENTATION] as Route,
            ),
          }}
          icon={IconProp.Info}
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
      <SideMenuSection title="Exceptions">

        <CountModelSideMenuItem<TelemetryException>
          link={{
            title: "Unresolved",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_EXCEPTIONS_UNRESOLVED] as Route,
            ),
          }}
          badgeType={BadgeType.DANGER}
          icon={IconProp.Alert}
          countQuery={{
            projectId: DashboardNavigation.getProjectId()!,
            isResolved: false,
            isArchived: false,
          }}
          modelType={TelemetryException}
        />
        <SideMenuItem
          link={{
            title: "Resolved",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_EXCEPTIONS_RESOLVED] as Route,
            ),
          }}
          icon={IconProp.Check}
        />
        <SideMenuItem
          link={{
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_EXCEPTIONS_ARCHIVED] as Route,
            ),
          }}
          icon={IconProp.Archive}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;

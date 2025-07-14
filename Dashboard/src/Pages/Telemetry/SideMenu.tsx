import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import ProjectUtil from "Common/UI/Utils/Project";

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Basic",
      items: [
        {
          link: {
            title: "Services",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_SERVICES] as Route,
            ),
          },
          icon: IconProp.SquareStack,
        },
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_DOCUMENTATION] as Route,
            ),
          },
          icon: IconProp.Info,
        },
      ],
    },
    {
      title: "Telemetry",
      items: [
        {
          link: {
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_LOGS] as Route,
            ),
          },
          icon: IconProp.Logs,
        },
        {
          link: {
            title: "Traces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_TRACES] as Route,
            ),
          },
          icon: IconProp.RectangleStack,
        },
        {
          link: {
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_METRICS] as Route,
            ),
          },
          icon: IconProp.ChartBar,
        },
      ],
    },
    {
      title: "Exceptions",
      items: [
        {
          link: {
            title: "Unresolved",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_EXCEPTIONS_UNRESOLVED] as Route,
            ),
          },
          badgeType: BadgeType.DANGER,
          icon: IconProp.Alert,
          modelType: TelemetryException,
          countQuery: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            isResolved: false,
            isArchived: false,
          } as any,
        },
        {
          link: {
            title: "Resolved",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_EXCEPTIONS_RESOLVED] as Route,
            ),
          },
          icon: IconProp.Check,
        },
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_EXCEPTIONS_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;

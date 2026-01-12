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
      title: "Exceptions",
      items: [
        {
          link: {
            title: "Unresolved",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
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
              RouteMap[PageMap.EXCEPTIONS_RESOLVED] as Route,
            ),
          },
          icon: IconProp.Check,
        },
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.EXCEPTIONS_ARCHIVED] as Route,
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

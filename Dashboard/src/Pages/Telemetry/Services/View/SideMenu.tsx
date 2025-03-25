import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import ProjectUtil from "Common/UI/Utils/Project";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_SERVICES_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_DOCUMENTATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>
      <SideMenuSection title="Telemetry">
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />
        <SideMenuItem
          link={{
            title: "Traces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_TRACES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.RectangleStack}
        />
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_METRICS] as Route,
              { modelId: props.modelId },
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
              RouteMap[
                PageMap.TELEMETRY_SERVICES_VIEW_EXCEPTIONS_UNRESOLVED
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          badgeType={BadgeType.DANGER}
          icon={IconProp.Alert}
          countQuery={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            isResolved: false,
            isArchived: false,
            telemetryServiceId: props.modelId,
          }}
          modelType={TelemetryException}
        />
        <SideMenuItem
          link={{
            title: "Resolved",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.TELEMETRY_SERVICES_VIEW_EXCEPTIONS_RESOLVED
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Check}
        />
        <SideMenuItem
          link={{
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.TELEMETRY_SERVICES_VIEW_EXCEPTIONS_ARCHIVED
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Archive}
        />
      </SideMenuSection>
      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />

        <SideMenuItem
          link={{
            title: "Delete Service",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;

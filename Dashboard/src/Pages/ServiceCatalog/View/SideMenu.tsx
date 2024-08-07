import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/src/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/src/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/src/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

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
              RouteMap[PageMap.SERVICE_CATALOG_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_CATALOG_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />

        <SideMenuItem
          link={{
            title: "Dependencies",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_CATALOG_VIEW_DEPENDENCIES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.SquareStack3D}
        />
      </SideMenuSection>

      <SideMenuSection title="Resources">
        <SideMenuItem
          link={{
            title: "Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_CATALOG_VIEW_MONITORS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.AltGlobe}
        />

        <SideMenuItem
          link={{
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_CATALOG_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
        />

        <SideMenuItem
          link={{
            title: "Telemetry",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SERVICE_CATALOG_VIEW_TELEMETRY_SERVICES
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Cube}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_CATALOG_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Delete Service",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_CATALOG_VIEW_DELETE] as Route,
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

import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const NetworkSiteViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Site">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Devices",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_DEVICES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Signal}
        />
        <SideMenuItem
          link={{
            title: "Child Sites",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_CHILD_SITES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.SquareStack}
        />
        <SideMenuItem
          link={{
            title: "Endpoints",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_ENDPOINTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Squares}
        />
        <SideMenuItem
          link={{
            title: "Status Timeline",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_STATUS_TIMELINE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>

      <SideMenuSection title="Manage">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Delete Site",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_VIEW_DELETE] as Route,
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

export default NetworkSiteViewSideMenu;

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

const SloViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="SLO">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Charts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_CHARTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Graph}
        />
        <SideMenuItem
          link={{
            title: "Burn Rate Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_BURN_RATE_RULES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
        />
      </SideMenuSection>

      <SideMenuSection title="Manage">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Delete SLO",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_DELETE] as Route,
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

export default SloViewSideMenu;

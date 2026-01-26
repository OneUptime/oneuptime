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
              RouteMap[PageMap.ALERT_EPISODE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Description",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_DESCRIPTION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Chat}
        />

        <SideMenuItem
          link={{
            title: "Root Cause",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Cube}
        />

        <SideMenuItem
          link={{
            title: "Remediation Notes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_REMEDIATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Wrench}
        />
      </SideMenuSection>

      <SideMenuSection title="Ownership">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      <SideMenuSection title="Timeline">
        <SideMenuItem
          link={{
            title: "State Timeline",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>

      <SideMenuSection title="Alerts">
        <SideMenuItem
          link={{
            title: "Member Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
        />
      </SideMenuSection>

      <SideMenuSection title="Episode Notes">
        <SideMenuItem
          link={{
            title: "Private Notes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Lock}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Episode",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_DELETE] as Route,
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

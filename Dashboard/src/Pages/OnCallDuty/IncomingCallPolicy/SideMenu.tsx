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
              RouteMap[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Escalation Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.BarsArrowDown}
        />
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DOCS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>

      <SideMenuSection title="Logs">
        <SideMenuItem
          link={{
            title: "Call Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      <SideMenuSection title="Danger Zone">
        <SideMenuItem
          link={{
            title: "Delete Policy",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE
              ] as Route,
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

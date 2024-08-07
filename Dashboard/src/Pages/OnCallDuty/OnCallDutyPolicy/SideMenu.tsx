import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/src/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/src/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/src/Components/SideMenu/SideMenuSection";
import Navigation from "Common/UI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let subItemMenuLink: Link | undefined = undefined;

  if (
    Navigation.isOnThisPage(
      RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW]!,
    )
  ) {
    subItemMenuLink = {
      title: "Timeline",
      to: Navigation.getCurrentRoute(),
    };
  }

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Escalation Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.BarsArrowDown}
        />
      </SideMenuSection>

      <SideMenuSection title="Logs">
        <SideMenuItem
          link={{
            title: "Execution Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
          subItemLink={subItemMenuLink}
          subItemIcon={IconProp.Clock}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.TableCells}
        />
        <SideMenuItem
          link={{
            title: "Delete Policy",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE] as Route,
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

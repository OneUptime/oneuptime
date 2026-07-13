import React, { FunctionComponent, ReactElement } from "react";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * No Logs item: the old AIAgentTaskLog table only holds legacy rows — new
 * runs record typed AIRunEvents, rendered in the Overview's activity feed.
 * No Delete item either: runs are system-managed audit records (the AIRun
 * model permits no user deletes).
 */
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
              RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Pull Requests",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENT_TASK_VIEW_PULL_REQUESTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Code}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;

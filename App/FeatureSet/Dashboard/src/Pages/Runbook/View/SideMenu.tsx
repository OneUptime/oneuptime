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

const RunbookViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Steps",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Executions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_EXECUTIONS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Play}
        />
      </SideMenuSection>

      <SideMenuSection title="Owners">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Delete Runbook",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_DELETE] as Route,
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

export default RunbookViewSideMenu;

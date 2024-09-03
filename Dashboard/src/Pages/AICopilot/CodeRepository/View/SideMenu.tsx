import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
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
              RouteMap[PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Services",
            to: RouteUtil.populateRouteParams(
              RouteMap[
              PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_SERVICES
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.SquareStack}
        />

        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[
              PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_DOCUMENTATION
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
      </SideMenuSection>

      <SideMenuSection title="Code Changes">
        <SideMenuItem
          link={{
            title: "In Queue",
            to: RouteUtil.populateRouteParams(
              RouteMap[
              PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_ACTIONS_IN_QUEUE
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />

        <SideMenuItem
          link={{
            title: "Processed",
            to: RouteUtil.populateRouteParams(
              RouteMap[
              PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_ACTIONS_PROCESSED
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.CheckCircle}
        />

      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Actions",
            to: RouteUtil.populateRouteParams(
              RouteMap[
              PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_ACTION_TYPES
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.CPUChip}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[
              PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_SETTINGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Delete Service",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_DELETE] as Route,
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

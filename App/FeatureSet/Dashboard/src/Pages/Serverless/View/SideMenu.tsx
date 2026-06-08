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

const ServerlessFunctionViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
      </SideMenuSection>

      <SideMenuSection title="Observability">
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ChartBar}
        />
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Terminal}
        />
        <SideMenuItem
          link={{
            title: "Traces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_TRACES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Workflow}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Function",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_DELETE] as Route,
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

export default ServerlessFunctionViewSideMenu;

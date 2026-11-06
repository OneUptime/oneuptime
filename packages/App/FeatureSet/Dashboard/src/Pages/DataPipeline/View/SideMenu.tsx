import RecommendationsSideMenuItem from "../../../Components/Recommendations/RecommendationsSideMenuItem";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

// One pipeline's pages: its runs, and the monitors recommended for them.
const PipelineViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const routeOf: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: props.modelId,
    });
  };

  return (
    <SideMenu>
      <SideMenuSection title="Pipeline">
        <SideMenuItem
          link={{
            title: "Overview",
            to: routeOf(PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW),
          }}
          icon={IconProp.Info}
        />
        <RecommendationsSideMenuItem
          link={{
            title: "Recommendations",
            to: routeOf(
              PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW_RECOMMENDATIONS,
            ),
          }}
          resourceType={MonitorRecommendationResourceType.DataPipeline}
          resourceId={props.modelId}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default PipelineViewSideMenu;

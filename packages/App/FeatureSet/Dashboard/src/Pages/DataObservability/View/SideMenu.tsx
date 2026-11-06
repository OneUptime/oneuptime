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

// One database's pages: how its collection stands, its tables, and the monitors recommended for them.
const StoreViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const routeOf: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: props.modelId,
    });
  };

  return (
    <SideMenu>
      <SideMenuSection title="Database">
        <SideMenuItem
          link={{
            title: "Overview",
            to: routeOf(PageMap.DATA_OBSERVABILITY_STORE_VIEW),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Tables",
            to: routeOf(PageMap.DATA_OBSERVABILITY_STORE_VIEW_TABLES),
          }}
          icon={IconProp.TableCells}
        />
        <RecommendationsSideMenuItem
          link={{
            title: "Recommendations",
            to: routeOf(PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS),
          }}
          resourceType={MonitorRecommendationResourceType.DataStore}
          resourceId={props.modelId}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default StoreViewSideMenu;

import ComponentProps from "../Pages/PageComponentProps";
import TopologyPage from "../Pages/Topology/TopologyPage";
import PageMap from "../Utils/PageMap";
import RouteMap, { TopologyRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

const TopologyRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute
        path="/"
        element={
          <TopologyPage
            {...props}
            pageRoute={RouteMap[PageMap.TOPOLOGY] as Route}
          />
        }
      />
      <PageRoute
        path={TopologyRoutePath[PageMap.TOPOLOGY] || ""}
        element={
          <TopologyPage
            {...props}
            pageRoute={RouteMap[PageMap.TOPOLOGY] as Route}
          />
        }
      />
    </Routes>
  );
};

export default TopologyRoutes;

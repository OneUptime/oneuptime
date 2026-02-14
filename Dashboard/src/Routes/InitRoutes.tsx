import { RoutesProps } from "../Types/RoutesProps";
import PageMap from "../Utils/PageMap";
import RouteMap from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import Init from "../Pages/Init/Init";

const InitRoutes: FunctionComponent<RoutesProps> = (
  props: RoutesProps,
): ReactElement => {
  const { projects, isLoading, ...rest } = props;
  return (
    <Routes>
      <PageRoute
        path={RouteMap[PageMap.INIT]?.toString() || ""}
        element={
          <Init
              {...rest}
              pageRoute={RouteMap[PageMap.INIT] as Route}
              projects={projects}
              isLoadingProjects={isLoading}
            />
        }
      />

      <PageRoute
        path={RouteMap[PageMap.INIT_PROJECT]?.toString() || ""}
        element={
          <Init
              {...rest}
              pageRoute={RouteMap[PageMap.INIT_PROJECT] as Route}
              projects={projects}
              isLoadingProjects={isLoading}
            />
        }
      />
    </Routes>
  );
};

export default InitRoutes;

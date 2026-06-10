import ComponentProps from "../Pages/PageComponentProps";
import EntitiesPage from "../Pages/Entities/EntitiesPage";
import PageMap from "../Utils/PageMap";
import RouteMap, { EntitiesRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

const EntitiesRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute
        path="/"
        element={
          <EntitiesPage
            {...props}
            pageRoute={RouteMap[PageMap.ENTITIES] as Route}
          />
        }
      />
      <PageRoute
        path={EntitiesRoutePath[PageMap.ENTITIES] || ""}
        element={
          <EntitiesPage
            {...props}
            pageRoute={RouteMap[PageMap.ENTITIES] as Route}
          />
        }
      />
    </Routes>
  );
};

export default EntitiesRoutes;

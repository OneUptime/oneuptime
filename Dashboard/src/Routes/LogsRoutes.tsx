import ComponentProps from "../Pages/PageComponentProps";
import LogsLayout from "../Pages/Logs/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import LogsPage from "../Pages/Logs/Index";

const LogsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<LogsLayout {...props} />}>
        <PageRoute
          index
          element={
            <LogsPage
                {...props}
                pageRoute={RouteMap[PageMap.LOGS] as Route}
              />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default LogsRoutes;

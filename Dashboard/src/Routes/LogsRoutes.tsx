import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import LogsLayout from "../Pages/Logs/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  ReactElement,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Lazy Pages
const LogsPage: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
  () => {
    return import("../Pages/Logs/Index");
  },
);

const LogsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<LogsLayout {...props} />}>
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <LogsPage
                {...props}
                pageRoute={RouteMap[PageMap.LOGS] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default LogsRoutes;

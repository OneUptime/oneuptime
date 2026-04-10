import ComponentProps from "../Pages/PageComponentProps";
import DockerLayout from "../Pages/Docker/Layout";
import DockerHostViewLayout from "../Pages/Docker/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, DockerRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import DockerHosts from "../Pages/Docker/Hosts";
import DockerDocumentation from "../Pages/Docker/Documentation";
import DockerHostOverview from "../Pages/Docker/View/Overview";
import DockerHostContainers from "../Pages/Docker/View/Containers";
import DockerHostContainerDetail from "../Pages/Docker/View/ContainerDetail";
import DockerHostMetrics from "../Pages/Docker/View/Metrics";
import DockerHostLogs from "../Pages/Docker/View/Logs";
import DockerHostSettings from "../Pages/Docker/View/Settings";
import DockerHostDelete from "../Pages/Docker/View/Delete";
import DockerHostDocumentation from "../Pages/Docker/View/Documentation";

const DockerRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<DockerLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <DockerHosts
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_HOSTS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DOCKER_DOCUMENTATION)}
          element={
            <DockerDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_DOCUMENTATION] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={DockerRoutePath[PageMap.DOCKER_HOST_VIEW] || ""}
        element={<DockerHostViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <DockerHostOverview
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_HOST_VIEW] as Route}
            />
          }
        />

        {/* Containers */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_HOST_VIEW_CONTAINERS,
          )}
          element={
            <DockerHostContainers
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_HOST_VIEW_CONTAINERS] as Route
              }
            />
          }
        />

        {/* Container Detail */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL,
            2,
          )}
          element={
            <DockerHostContainerDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL] as Route
              }
            />
          }
        />

        {/* Metrics */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DOCKER_HOST_VIEW_METRICS)}
          element={
            <DockerHostMetrics
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_HOST_VIEW_METRICS] as Route}
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DOCKER_HOST_VIEW_LOGS)}
          element={
            <DockerHostLogs
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_HOST_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DOCKER_HOST_VIEW_SETTINGS)}
          element={
            <DockerHostSettings
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_HOST_VIEW_SETTINGS] as Route}
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DOCKER_HOST_VIEW_DELETE)}
          element={
            <DockerHostDelete
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_HOST_VIEW_DELETE] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_HOST_VIEW_DOCUMENTATION,
          )}
          element={
            <DockerHostDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_HOST_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default DockerRoutes;

import ComponentProps from "../Pages/PageComponentProps";
import PodmanLayout from "../Pages/Podman/Layout";
import PodmanHostViewLayout from "../Pages/Podman/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, PodmanRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import PodmanHosts from "../Pages/Podman/Hosts";
import PodmanDocumentation from "../Pages/Podman/Documentation";
import PodmanHostOverview from "../Pages/Podman/View/Overview";
import PodmanHostContainers from "../Pages/Podman/View/Containers";
import PodmanHostContainerDetail from "../Pages/Podman/View/ContainerDetail";
import PodmanHostMetrics from "../Pages/Podman/View/Metrics";
import PodmanHostLogs from "../Pages/Podman/View/Logs";
import PodmanHostTraces from "../Pages/Podman/View/Traces";
import PodmanHostProfiles from "../Pages/Podman/View/Profiles";
import PodmanHostIncidents from "../Pages/Podman/View/Incidents";
import PodmanHostAlerts from "../Pages/Podman/View/Alerts";
import PodmanHostScheduledMaintenance from "../Pages/Podman/View/ScheduledMaintenance";
import PodmanHostOwners from "../Pages/Podman/View/Owners";
import PodmanHostAuditLogs from "../Pages/Podman/View/AuditLogs";
import PodmanHostSettings from "../Pages/Podman/View/Settings";
import PodmanHostDelete from "../Pages/Podman/View/Delete";
import PodmanHostDocumentation from "../Pages/Podman/View/Documentation";
import PodmanSettingsOwnerRules from "../Pages/Podman/Settings/OwnerRules";
import PodmanSettingsLabelRules from "../Pages/Podman/Settings/LabelRules";

const PodmanRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<PodmanLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <PodmanHosts
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOSTS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_DOCUMENTATION)}
          element={
            <PodmanDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_DOCUMENTATION] as Route}
            />
          }
        />
        <PageRoute
          path={PodmanRoutePath[PageMap.PODMAN_SETTINGS_OWNER_RULES] || ""}
          element={
            <PodmanSettingsOwnerRules
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_SETTINGS_OWNER_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={PodmanRoutePath[PageMap.PODMAN_SETTINGS_LABEL_RULES] || ""}
          element={
            <PodmanSettingsLabelRules
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_SETTINGS_LABEL_RULES] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={PodmanRoutePath[PageMap.PODMAN_HOST_VIEW] || ""}
        element={<PodmanHostViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <PodmanHostOverview
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW] as Route}
            />
          }
        />

        {/* Containers */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PODMAN_HOST_VIEW_CONTAINERS,
          )}
          element={
            <PodmanHostContainers
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_CONTAINERS] as Route}
            />
          }
        />

        {/* Container Detail */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL,
            2,
          )}
          element={
            <PodmanHostContainerDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL] as Route
              }
            />
          }
        />

        {/* Metrics */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_HOST_VIEW_METRICS)}
          element={
            <PodmanHostMetrics
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_METRICS] as Route}
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_HOST_VIEW_LOGS)}
          element={
            <PodmanHostLogs
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Traces */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_HOST_VIEW_TRACES)}
          element={
            <PodmanHostTraces
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_TRACES] as Route}
            />
          }
        />

        {/* Profiles */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_HOST_VIEW_PROFILES)}
          element={
            <PodmanHostProfiles
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_PROFILES] as Route}
            />
          }
        />

        {/* Incidents */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_HOST_VIEW_INCIDENTS)}
          element={
            <PodmanHostIncidents
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_INCIDENTS] as Route}
            />
          }
        />

        {/* Alerts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_HOST_VIEW_ALERTS)}
          element={
            <PodmanHostAlerts
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_ALERTS] as Route}
            />
          }
        />

        {/* Scheduled Maintenance */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PODMAN_HOST_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <PodmanHostScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.PODMAN_HOST_VIEW_SCHEDULED_MAINTENANCE
                ] as Route
              }
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_HOST_VIEW_OWNERS)}
          element={
            <PodmanHostOwners
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_OWNERS] as Route}
            />
          }
        />

        {/* Audit Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PODMAN_HOST_VIEW_AUDIT_LOGS,
          )}
          element={
            <PodmanHostAuditLogs
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_AUDIT_LOGS] as Route}
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_HOST_VIEW_SETTINGS)}
          element={
            <PodmanHostSettings
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_SETTINGS] as Route}
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PODMAN_HOST_VIEW_DELETE)}
          element={
            <PodmanHostDelete
              {...props}
              pageRoute={RouteMap[PageMap.PODMAN_HOST_VIEW_DELETE] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PODMAN_HOST_VIEW_DOCUMENTATION,
          )}
          element={
            <PodmanHostDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.PODMAN_HOST_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default PodmanRoutes;

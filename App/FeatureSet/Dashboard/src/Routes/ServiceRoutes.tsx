import ComponentProps from "../Pages/PageComponentProps";
import StatusPageViewLayout from "../Pages/Service/View/Layout";
import ServiceLayout from "../Pages/Service/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, ServiceRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import Services from "../Pages/Service/Services";
import ServiceView from "../Pages/Service/View/Index";

import ServiceViewLogs from "../Pages/Service/View/Logs";

import ServiceViewTraces from "../Pages/Service/View/Traces";

import ServiceViewMetrics from "../Pages/Service/View/Metrics";

import ServiceViewProfiles from "../Pages/Service/View/Profiles";

import ServiceViewExceptions from "../Pages/Service/View/Exceptions";

import ServiceViewDelete from "../Pages/Service/View/Delete";

import ServiceViewSettings from "../Pages/Service/View/Settings";

import ServiceViewOwners from "../Pages/Service/View/Owners";

import ServiceViewAuditLogs from "../Pages/Service/View/AuditLogs";

import ServiceViewCodeRepositories from "../Pages/Service/View/CodeRepositories";

import ServiceViewIncidents from "../Pages/Service/View/Incidents";

import ServiceViewAlerts from "../Pages/Service/View/Alerts";

import ServiceViewScheduledMaintenance from "../Pages/Service/View/ScheduledMaintenance";

import ServiceSettingsOwnerRules from "../Pages/Service/Settings/OwnerRules";

import ServiceSettingsLabelRules from "../Pages/Service/Settings/LabelRules";

const ServiceRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<ServiceLayout {...props} />}>
        <PageRoute
          path={ServiceRoutePath[PageMap.SERVICES] || ""}
          element={
            <Services
              {...props}
              pageRoute={RouteMap[PageMap.SERVICES] as Route}
            />
          }
        />
        <PageRoute
          path={ServiceRoutePath[PageMap.SERVICE_SETTINGS_OWNER_RULES] || ""}
          element={
            <ServiceSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVICE_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={ServiceRoutePath[PageMap.SERVICE_SETTINGS_LABEL_RULES] || ""}
          element={
            <ServiceSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVICE_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={ServiceRoutePath[PageMap.SERVICE_VIEW] || ""}
        element={<StatusPageViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <ServiceView
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_DELETE)}
          element={
            <ServiceViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_DELETE] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_SETTINGS)}
          element={
            <ServiceViewSettings
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_SETTINGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_LOGS)}
          element={
            <ServiceViewLogs
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_TRACES)}
          element={
            <ServiceViewTraces
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_METRICS)}
          element={
            <ServiceViewMetrics
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_METRICS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_PROFILES)}
          element={
            <ServiceViewProfiles
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_PROFILES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_EXCEPTIONS)}
          element={
            <ServiceViewExceptions
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_EXCEPTIONS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_OWNERS)}
          element={
            <ServiceViewOwners
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_OWNERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_CODE_REPOSITORIES,
          )}
          element={
            <ServiceViewCodeRepositories
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVICE_VIEW_CODE_REPOSITORIES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_INCIDENTS)}
          element={
            <ServiceViewIncidents
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_INCIDENTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_ALERTS)}
          element={
            <ServiceViewAlerts
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_ALERTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <ServiceViewScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVICE_VIEW_SCHEDULED_MAINTENANCE] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_AUDIT_LOGS)}
          element={
            <ServiceViewAuditLogs
              {...props}
              pageRoute={RouteMap[PageMap.SERVICE_VIEW_AUDIT_LOGS] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ServiceRoutes;

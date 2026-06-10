import ComponentProps from "../Pages/PageComponentProps";
import CloudLayout from "../Pages/Cloud/Layout";
import CloudResourceViewLayout from "../Pages/Cloud/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, CloudRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import CloudResources from "../Pages/Cloud/CloudResources";
import CloudResourceOverview from "../Pages/Cloud/View/Overview";
import CloudResourceMetrics from "../Pages/Cloud/View/Metrics";
import CloudResourceLogs from "../Pages/Cloud/View/Logs";
import CloudResourceTraces from "../Pages/Cloud/View/Traces";
import CloudResourceInstances from "../Pages/Cloud/View/Instances";
import CloudResourceDocumentation from "../Pages/Cloud/View/Documentation";
import CloudResourceDelete from "../Pages/Cloud/View/Delete";
import CloudLabelRules from "../Pages/Cloud/Settings/LabelRules";
import CloudOwnerRules from "../Pages/Cloud/Settings/OwnerRules";

const CloudResourceRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<CloudLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <CloudResources
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCES] as Route}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_SETTINGS_LABEL_RULES] || ""}
          element={
            <CloudLabelRules
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_SETTINGS_LABEL_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_SETTINGS_OWNER_RULES] || ""}
          element={
            <CloudOwnerRules
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_SETTINGS_OWNER_RULES] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={CloudRoutePath[PageMap.CLOUD_RESOURCE_VIEW] || ""}
        element={<CloudResourceViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <CloudResourceOverview
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_RESOURCE_VIEW_METRICS,
          )}
          element={
            <CloudResourceMetrics
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_METRICS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_LOGS)}
          element={
            <CloudResourceLogs
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_TRACES)}
          element={
            <CloudResourceTraces
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_TRACES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_RESOURCE_VIEW_INSTANCES,
          )}
          element={
            <CloudResourceInstances
              {...props}
              pageRoute={
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW_INSTANCES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION,
          )}
          element={
            <CloudResourceDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_DELETE)}
          element={
            <CloudResourceDelete
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default CloudResourceRoutes;

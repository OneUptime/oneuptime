import Loader from "../Components/Loader/Loader";
import Layout from "../Pages/Alerts/Layout";
import AlertViewLayout from "../Pages/Alerts/View/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, { AlertsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
const Alerts: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
  () => {
    return import("../Pages/Alerts/Alerts");
  },
);
const AlertView: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
  () => {
    return import("../Pages/Alerts/View/Index");
  },
);

const AlertViewNotificationLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/View/NotificationLogs");
});

const AlertViewAILogs: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Alerts/View/AILogs");
  });

const AlertsWorkspaceConnectionSlack: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/WorkspaceConnectionSlack");
});

const AlertsWorkspaceConnectionMicrosoftTeams: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/WorkspaceConnectionMicrosoftTeams");
});

const AlertOnCallPolicyExecutionLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/View/OnCallPolicyExecutionLogs");
});

const AlertViewDelete: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Alerts/View/Delete");
  });
const AlertViewStateTimeline: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/View/StateTimeline");
});

const AlertInternalNote: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/View/InternalNote");
});

const UnresolvedAlerts: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Alerts/Unresolved");
  });
const AlertViewCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/View/CustomFields");
});
const AlertViewOwner: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Alerts/View/Owners");
  });

const AlertViewRootCause: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/View/RootCause");
});

const AlertViewRemediation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/View/Remediation");
});

const AlertDescription: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Alerts/View/Description");
  });

const AlertsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  return (
    <Routes>
      <PageRoute path="/" element={<Layout {...props} />}>
        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS] || ""}
          element={
            <Suspense fallback={Loader}>
              <Alerts
                {...props}
                pageRoute={RouteMap[PageMap.ALERTS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.UNRESOLVED_ALERTS] || ""}
          element={
            <Suspense fallback={Loader}>
              <UnresolvedAlerts
                {...props}
                pageRoute={RouteMap[PageMap.UNRESOLVED_ALERTS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            AlertsRoutePath[PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <AlertsWorkspaceConnectionSlack
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            AlertsRoutePath[
              PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <AlertsWorkspaceConnectionMicrosoftTeams
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                  ] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>

      <PageRoute
        path={AlertsRoutePath[PageMap.ALERT_VIEW] || ""}
        element={<AlertViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <AlertView
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <AlertViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_VIEW_NOTIFICATION_LOGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_AI_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <AlertViewAILogs
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_AI_LOGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_DESCRIPTION)}
          element={
            <Suspense fallback={Loader}>
              <AlertDescription
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_DESCRIPTION] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_ROOT_CAUSE)}
          element={
            <Suspense fallback={Loader}>
              <AlertViewRootCause
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_ROOT_CAUSE] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_REMEDIATION)}
          element={
            <Suspense fallback={Loader}>
              <AlertViewRemediation
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_REMEDIATION] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_STATE_TIMELINE)}
          element={
            <Suspense fallback={Loader}>
              <AlertViewStateTimeline
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_STATE_TIMELINE] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_INTERNAL_NOTE)}
          element={
            <Suspense fallback={Loader}>
              <AlertInternalNote
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_INTERNAL_NOTE] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_CUSTOM_FIELDS)}
          element={
            <Suspense fallback={Loader}>
              <AlertViewCustomFields
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_CUSTOM_FIELDS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_OWNERS)}
          element={
            <Suspense fallback={Loader}>
              <AlertViewOwner
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_OWNERS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <AlertOnCallPolicyExecutionLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_DELETE)}
          element={
            <Suspense fallback={Loader}>
              <AlertViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_DELETE] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default AlertsRoutes;

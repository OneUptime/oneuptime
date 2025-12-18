import Navigation from "Common/UI/Utils/Navigation";
import Loader from "../Components/Loader/Loader";
import Layout from "../Pages/Incidents/Layout";
import IncidentViewLayout from "../Pages/Incidents/View/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, { IncidentsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
const Incidents: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
  () => {
    return import("../Pages/Incidents/Incidents");
  },
);

const IncidentViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/Settings");
});

const IncidentViewOnCallPolicyExecutionLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/OnCallPolicyExecutionLogs");
});

const IncidentView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Incidents/View/Index");
  });

const IncidentViewNotificationLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/NotificationLogs");
});

const IncidentViewAILogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/AILogs");
});

const IncidentViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/Delete");
});

const IncidentWorkspaceConnectionSlack: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/WorkspaceConnectionSlack");
});

const IncidentWorkspaceConnectionMicrosoftTeams: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/WorkspaceConnectionMicrosoftTeams");
});

const IncidentViewStateTimeline: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/StateTimeline");
});
const IncidentInternalNote: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/InternalNote");
});
const IncidentPublicNote: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/PublicNote");
});
const UnresolvedIncidents: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Unresolved");
});
const IncidentViewCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/CustomFields");
});
const IncidentViewOwner: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/Owners");
});

const IncidentViewRemediation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/Remediation");
});

const IncidentViewRootCause: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/RootCause");
});

const IncidentViewPostmortem: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/Postmortem");
});

const IncidentViewDescription: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/Description");
});

const IncidentCreate: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Incidents/Create");
  });

const IncidentsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  let hideSideMenu: boolean = false;

  if (Navigation.isOnThisPage(RouteMap[PageMap.INCIDENT_CREATE] as Route)) {
    hideSideMenu = true;
  }

  return (
    <Routes>
      <PageRoute
        path="/"
        element={<Layout {...props} hideSideMenu={hideSideMenu} />}
      >
        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS] || ""}
          element={
            <Suspense fallback={Loader}>
              <Incidents
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENTS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.UNRESOLVED_INCIDENTS] || ""}
          element={
            <Suspense fallback={Loader}>
              <UnresolvedIncidents
                {...props}
                pageRoute={RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK] ||
            ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncidentWorkspaceConnectionSlack
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[
              PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncidentWorkspaceConnectionMicrosoftTeams
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENT_CREATE] || ""}
          element={
            <Suspense fallback={Loader}>
              <IncidentCreate
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_CREATE] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>

      <PageRoute
        path={IncidentsRoutePath[PageMap.INCIDENT_VIEW] || ""}
        element={<IncidentViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <IncidentView
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_DELETE)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_DELETE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_SETTINGS)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewSettings
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_SETTINGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_STATE_TIMELINE,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewStateTimeline
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_VIEW_STATE_TIMELINE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_REMEDIATION)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewRemediation
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_REMEDIATION] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_ROOT_CAUSE)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewRootCause
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_ROOT_CAUSE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_POSTMORTEM)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewPostmortem
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_POSTMORTEM] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_DESCRIPTION)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewDescription
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_DESCRIPTION] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_INTERNAL_NOTE,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentInternalNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_VIEW_INTERNAL_NOTE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_CUSTOM_FIELDS,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_VIEW_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_PUBLIC_NOTE)}
          element={
            <Suspense fallback={Loader}>
              <IncidentPublicNote
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_PUBLIC_NOTE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_OWNERS)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewOwner
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_OWNERS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewOnCallPolicyExecutionLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_AI_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewAILogs
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_AI_LOGS] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default IncidentsRoutes;

import Navigation from "Common/UI/Utils/Navigation";
import Loader from "../Components/Loader/Loader";
import MonitorLayout from "../Pages/Monitor/Layout";
import MonitorViewLayout from "../Pages/Monitor/View/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, { MonitorsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  ReactElement,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
const MonitorPage: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Monitor/Monitors");
  });

const WorkspaceConnectionSlack: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/WorkspaceConnectionSlack");
});

const WorkspaceConnectionTeams: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/WorkspaceConnectionMicrosoftTeams");
});

const MonitorViewMetrics: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/View/Metrics");
});

const MonitorprobeDisconnected: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/ProbeDisconnected");
});

const MonitorProbeDisabled: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/ProbeDisabled");
});

const MonitorView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Monitor/View/Index");
  });
const MonitorViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/View/Delete");
});

const MonitorViewLogs: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Monitor/View/Logs");
  });

const MonitorViewCriteria: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/View/Criteria");
});
const MonitorViewStatusTimeline: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/View/StatusTimeline");
});
const MonitorIncidents: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Monitor/View/Incidents");
  });

const MonitorAlerts: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Monitor/View/Alerts");
  });
const MonitorInoperational: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/NotOperationalMonitors");
});
const MonitorDisabled: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Monitor/DisabledMonitors");
  });
const MonitorViewCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/View/CustomFields");
});
const MonitorViewInterval: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/View/Interval");
});

const MonitorViewDocumentation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/View/Documentation");
});

const MonitorViewProbes: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/View/Probes");
});
const MonitorViewOwner: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Monitor/View/Owners");
  });
const MonitorViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/View/Settings");
});

const MonitorCreate: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Monitor/Create");
  });

// Settings Pages
const MonitorSettingsStatus: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/Settings/MonitorStatus");
});

const MonitorSettingsCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/Settings/MonitorCustomFields");
});

const MonitorSettingsSecrets: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Monitor/Settings/MonitorSecrets");
});

const MonitorRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let hideSideMenu: boolean = false;

  if (Navigation.isOnThisPage(RouteMap[PageMap.MONITOR_CREATE] as Route)) {
    hideSideMenu = true;
  }

  return (
    <Routes>
      <PageRoute
        path="/"
        element={<MonitorLayout hideSideMenu={hideSideMenu} {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <MonitorPage
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_DISABLED] || ""}
          element={
            <Suspense fallback={Loader}>
              <MonitorDisabled
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_DISABLED] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_PROBE_DISCONNECTED] || ""}
          element={
            <Suspense fallback={Loader}>
              <MonitorprobeDisconnected
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITORS_PROBE_DISCONNECTED] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_PROBE_DISABLED] || ""}
          element={
            <Suspense fallback={Loader}>
              <MonitorProbeDisabled
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_PROBE_DISABLED] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_INOPERATIONAL] || ""}
          element={
            <Suspense fallback={Loader}>
              <MonitorInoperational
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_INOPERATIONAL] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            MonitorsRoutePath[PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <WorkspaceConnectionSlack
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            MonitorsRoutePath[
              PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <WorkspaceConnectionTeams
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITOR_CREATE] || ""}
          element={
            <Suspense fallback={Loader}>
              <MonitorCreate
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_CREATE] as Route}
              />
            </Suspense>
          }
        />

        {/* Settings Routes */}
        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_SETTINGS] || ""}
          element={
            <Suspense fallback={Loader}>
              <MonitorSettingsStatus
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_SETTINGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            MonitorsRoutePath[PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <MonitorSettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_SETTINGS_SECRETS] || ""}
          element={
            <Suspense fallback={Loader}>
              <MonitorSettingsSecrets
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_SETTINGS_SECRETS] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>

      <PageRoute
        path={MonitorsRoutePath[PageMap.MONITOR_VIEW] || ""}
        element={<MonitorViewLayout />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <MonitorView
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_SETTINGS)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewSettings
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_SETTINGS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_OWNERS)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewOwner
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_OWNERS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_CRITERIA)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewCriteria
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_METRICS)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewMetrics
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_METRICS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_INTERVAL)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewInterval
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_INTERVAL] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_DOCUMENTATION)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewDocumentation
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITOR_VIEW_DOCUMENTATION] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.MONITOR_VIEW_STATUS_TIMELINE,
          )}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewStatusTimeline
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITOR_VIEW_STATUS_TIMELINE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_INCIDENTS)}
          element={
            <Suspense fallback={Loader}>
              <MonitorIncidents
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_INCIDENTS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_ALERTS)}
          element={
            <Suspense fallback={Loader}>
              <MonitorAlerts
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_ALERTS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_DELETE)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_DELETE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_CUSTOM_FIELDS)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITOR_VIEW_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_PROBES)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewProbes
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <MonitorViewLogs
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_LOGS] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default MonitorRoutes;

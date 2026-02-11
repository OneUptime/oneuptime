import Navigation from "Common/UI/Utils/Navigation";
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

const AlertCreate: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Alerts/Create");
  });
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

// Settings Pages
const AlertSettingsState: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/Settings/AlertState");
});

const AlertSettingsSeverity: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/Settings/AlertSeverity");
});

const AlertSettingsNoteTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/Settings/AlertNoteTemplates");
});

const AlertSettingsNoteTemplatesView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/Settings/AlertNoteTemplateDetail");
});

const AlertSettingsCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/Settings/AlertCustomFields");
});

const AlertSettingsGroupingRules: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/Settings/AlertGroupingRules");
});

const AlertSettingsMore: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/Settings/AlertMoreSettings");
});

// Episode Pages
const Episodes: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
  () => {
    return import("../Pages/Alerts/Episodes");
  },
);

const EpisodeCreate: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Alerts/EpisodeCreate");
  });

const UnresolvedEpisodes: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/UnresolvedEpisodes");
});

// Episode View Pages
const EpisodeViewLayout: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/EpisodeView/Layout");
});

const EpisodeView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Alerts/EpisodeView/Index");
  });

const EpisodeViewDescription: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/EpisodeView/Description");
});

const EpisodeViewRootCause: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/EpisodeView/RootCause");
});

const EpisodeViewOwners: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/EpisodeView/Owners");
});

const EpisodeViewStateTimeline: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/EpisodeView/StateTimeline");
});

const EpisodeViewAlerts: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/EpisodeView/Alerts");
});

const EpisodeViewInternalNote: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/EpisodeView/InternalNote");
});

const EpisodeViewRemediation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/EpisodeView/Remediation");
});

const EpisodeViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Alerts/EpisodeView/Delete");
});

const AlertEpisodeDocs: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Alerts/EpisodeDocs");
  });

const AlertsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  let hideSideMenu: boolean = false;

  if (Navigation.isOnThisPage(RouteMap[PageMap.ALERT_CREATE] as Route)) {
    hideSideMenu = true;
  }

  return (
    <Routes>
      <PageRoute
        path="/"
        element={<Layout {...props} hideSideMenu={hideSideMenu} />}
      >
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

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERT_CREATE] || ""}
          element={
            <Suspense fallback={Loader}>
              <AlertCreate
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_CREATE] as Route}
              />
            </Suspense>
          }
        />

        {/* Settings Routes */}
        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_STATE] || ""}
          element={
            <Suspense fallback={Loader}>
              <AlertSettingsState
                {...props}
                pageRoute={RouteMap[PageMap.ALERTS_SETTINGS_STATE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_SEVERITY] || ""}
          element={
            <Suspense fallback={Loader}>
              <AlertSettingsSeverity
                {...props}
                pageRoute={RouteMap[PageMap.ALERTS_SETTINGS_SEVERITY] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] || ""}
          element={
            <Suspense fallback={Loader}>
              <AlertSettingsNoteTemplates
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            AlertsRoutePath[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES_VIEW] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <AlertSettingsNoteTemplatesView
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES_VIEW] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS] || ""}
          element={
            <Suspense fallback={Loader}>
              <AlertSettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_GROUPING_RULES] || ""}
          element={
            <Suspense fallback={Loader}>
              <AlertSettingsGroupingRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_SETTINGS_GROUPING_RULES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_MORE] || ""}
          element={
            <Suspense fallback={Loader}>
              <AlertSettingsMore
                {...props}
                pageRoute={RouteMap[PageMap.ALERTS_SETTINGS_MORE] as Route}
              />
            </Suspense>
          }
        />

        {/* Episode Routes */}
        <PageRoute
          path={AlertsRoutePath[PageMap.ALERT_EPISODE_CREATE] || ""}
          element={
            <Suspense fallback={Loader}>
              <EpisodeCreate
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_CREATE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERT_EPISODES] || ""}
          element={
            <Suspense fallback={Loader}>
              <Episodes
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODES] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.UNRESOLVED_ALERT_EPISODES] || ""}
          element={
            <Suspense fallback={Loader}>
              <UnresolvedEpisodes
                {...props}
                pageRoute={RouteMap[PageMap.UNRESOLVED_ALERT_EPISODES] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERT_EPISODE_DOCS] || ""}
          element={
            <Suspense fallback={Loader}>
              <AlertEpisodeDocs
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_DOCS] as Route}
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

      {/* Episode View Routes */}
      <PageRoute
        path={AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW] || ""}
        element={<EpisodeViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <EpisodeView
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_VIEW] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_DESCRIPTION,
          )}
          element={
            <Suspense fallback={Loader}>
              <EpisodeViewDescription
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_DESCRIPTION] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE,
          )}
          element={
            <Suspense fallback={Loader}>
              <EpisodeViewRootCause
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_EPISODE_VIEW_OWNERS)}
          element={
            <Suspense fallback={Loader}>
              <EpisodeViewOwners
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_VIEW_OWNERS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE,
          )}
          element={
            <Suspense fallback={Loader}>
              <EpisodeViewStateTimeline
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_EPISODE_VIEW_ALERTS)}
          element={
            <Suspense fallback={Loader}>
              <EpisodeViewAlerts
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_VIEW_ALERTS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE,
          )}
          element={
            <Suspense fallback={Loader}>
              <EpisodeViewInternalNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_REMEDIATION,
          )}
          element={
            <Suspense fallback={Loader}>
              <EpisodeViewRemediation
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_REMEDIATION] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_EPISODE_VIEW_DELETE)}
          element={
            <Suspense fallback={Loader}>
              <EpisodeViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_VIEW_DELETE] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default AlertsRoutes;

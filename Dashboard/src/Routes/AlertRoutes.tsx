import Navigation from "Common/UI/Utils/Navigation";
import Layout from "../Pages/Alerts/Layout";
import AlertViewLayout from "../Pages/Alerts/View/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, { AlertsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import Alerts from "../Pages/Alerts/Alerts";

import AlertCreate from "../Pages/Alerts/Create";
import AlertView from "../Pages/Alerts/View/Index";

import AlertViewNotificationLogs from "../Pages/Alerts/View/NotificationLogs";

import AlertViewAILogs from "../Pages/Alerts/View/AILogs";

import AlertsWorkspaceConnectionSlack from "../Pages/Alerts/WorkspaceConnectionSlack";

import AlertsWorkspaceConnectionMicrosoftTeams from "../Pages/Alerts/WorkspaceConnectionMicrosoftTeams";

import AlertOnCallPolicyExecutionLogs from "../Pages/Alerts/View/OnCallPolicyExecutionLogs";

import AlertViewDelete from "../Pages/Alerts/View/Delete";
import AlertViewStateTimeline from "../Pages/Alerts/View/StateTimeline";

import AlertInternalNote from "../Pages/Alerts/View/InternalNote";

import UnresolvedAlerts from "../Pages/Alerts/Unresolved";
import AlertViewCustomFields from "../Pages/Alerts/View/CustomFields";
import AlertViewOwner from "../Pages/Alerts/View/Owners";

import AlertViewRootCause from "../Pages/Alerts/View/RootCause";

import AlertViewRemediation from "../Pages/Alerts/View/Remediation";

import AlertDescription from "../Pages/Alerts/View/Description";

// Settings Pages
import AlertSettingsState from "../Pages/Alerts/Settings/AlertState";

import AlertSettingsSeverity from "../Pages/Alerts/Settings/AlertSeverity";

import AlertSettingsNoteTemplates from "../Pages/Alerts/Settings/AlertNoteTemplates";

import AlertSettingsNoteTemplatesView from "../Pages/Alerts/Settings/AlertNoteTemplateDetail";

import AlertSettingsCustomFields from "../Pages/Alerts/Settings/AlertCustomFields";

import AlertSettingsGroupingRules from "../Pages/Alerts/Settings/AlertGroupingRules";

import AlertSettingsMore from "../Pages/Alerts/Settings/AlertMoreSettings";

// Episode Pages
import Episodes from "../Pages/Alerts/Episodes";

import EpisodeCreate from "../Pages/Alerts/EpisodeCreate";

import UnresolvedEpisodes from "../Pages/Alerts/UnresolvedEpisodes";

// Episode View Pages
import EpisodeViewLayout from "../Pages/Alerts/EpisodeView/Layout";

import EpisodeView from "../Pages/Alerts/EpisodeView/Index";

import EpisodeViewDescription from "../Pages/Alerts/EpisodeView/Description";

import EpisodeViewRootCause from "../Pages/Alerts/EpisodeView/RootCause";

import EpisodeViewOwners from "../Pages/Alerts/EpisodeView/Owners";

import EpisodeViewStateTimeline from "../Pages/Alerts/EpisodeView/StateTimeline";

import EpisodeViewAlerts from "../Pages/Alerts/EpisodeView/Alerts";

import EpisodeViewInternalNote from "../Pages/Alerts/EpisodeView/InternalNote";

import EpisodeViewRemediation from "../Pages/Alerts/EpisodeView/Remediation";

import EpisodeViewDelete from "../Pages/Alerts/EpisodeView/Delete";

import AlertEpisodeDocs from "../Pages/Alerts/EpisodeDocs";

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
            <Alerts
                {...props}
                pageRoute={RouteMap[PageMap.ALERTS] as Route}
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.UNRESOLVED_ALERTS] || ""}
          element={
            <UnresolvedAlerts
                {...props}
                pageRoute={RouteMap[PageMap.UNRESOLVED_ALERTS] as Route}
              />
          }
        />

        <PageRoute
          path={
            AlertsRoutePath[PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK] || ""
          }
          element={
            <AlertsWorkspaceConnectionSlack
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            AlertsRoutePath[
              PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <AlertsWorkspaceConnectionMicrosoftTeams
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERT_CREATE] || ""}
          element={
            <AlertCreate
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_CREATE] as Route}
              />
          }
        />

        {/* Settings Routes */}
        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_STATE] || ""}
          element={
            <AlertSettingsState
                {...props}
                pageRoute={RouteMap[PageMap.ALERTS_SETTINGS_STATE] as Route}
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_SEVERITY] || ""}
          element={
            <AlertSettingsSeverity
                {...props}
                pageRoute={RouteMap[PageMap.ALERTS_SETTINGS_SEVERITY] as Route}
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] || ""}
          element={
            <AlertSettingsNoteTemplates
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            AlertsRoutePath[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES_VIEW] || ""
          }
          element={
            <AlertSettingsNoteTemplatesView
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES_VIEW] as Route
                }
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS] || ""}
          element={
            <AlertSettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS] as Route
                }
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_GROUPING_RULES] || ""}
          element={
            <AlertSettingsGroupingRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERTS_SETTINGS_GROUPING_RULES] as Route
                }
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERTS_SETTINGS_MORE] || ""}
          element={
            <AlertSettingsMore
                {...props}
                pageRoute={RouteMap[PageMap.ALERTS_SETTINGS_MORE] as Route}
              />
          }
        />

        {/* Episode Routes */}
        <PageRoute
          path={AlertsRoutePath[PageMap.ALERT_EPISODE_CREATE] || ""}
          element={
            <EpisodeCreate
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_CREATE] as Route}
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERT_EPISODES] || ""}
          element={
            <Episodes
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODES] as Route}
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.UNRESOLVED_ALERT_EPISODES] || ""}
          element={
            <UnresolvedEpisodes
                {...props}
                pageRoute={RouteMap[PageMap.UNRESOLVED_ALERT_EPISODES] as Route}
              />
          }
        />

        <PageRoute
          path={AlertsRoutePath[PageMap.ALERT_EPISODE_DOCS] || ""}
          element={
            <AlertEpisodeDocs
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_DOCS] as Route}
              />
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
            <AlertView
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <AlertViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_VIEW_NOTIFICATION_LOGS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_AI_LOGS)}
          element={
            <AlertViewAILogs
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_AI_LOGS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_DESCRIPTION)}
          element={
            <AlertDescription
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_DESCRIPTION] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_ROOT_CAUSE)}
          element={
            <AlertViewRootCause
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_ROOT_CAUSE] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_REMEDIATION)}
          element={
            <AlertViewRemediation
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_REMEDIATION] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_STATE_TIMELINE)}
          element={
            <AlertViewStateTimeline
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_STATE_TIMELINE] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_INTERNAL_NOTE)}
          element={
            <AlertInternalNote
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_INTERNAL_NOTE] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_CUSTOM_FIELDS)}
          element={
            <AlertViewCustomFields
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_CUSTOM_FIELDS] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_OWNERS)}
          element={
            <AlertViewOwner
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_OWNERS] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS,
          )}
          element={
            <AlertOnCallPolicyExecutionLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS
                  ] as Route
                }
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_VIEW_DELETE)}
          element={
            <AlertViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_VIEW_DELETE] as Route}
              />
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
            <EpisodeView
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_VIEW] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_DESCRIPTION,
          )}
          element={
            <EpisodeViewDescription
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_DESCRIPTION] as Route
                }
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE,
          )}
          element={
            <EpisodeViewRootCause
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE] as Route
                }
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_EPISODE_VIEW_OWNERS)}
          element={
            <EpisodeViewOwners
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_VIEW_OWNERS] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE,
          )}
          element={
            <EpisodeViewStateTimeline
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE] as Route
                }
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_EPISODE_VIEW_ALERTS)}
          element={
            <EpisodeViewAlerts
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_VIEW_ALERTS] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE,
          )}
          element={
            <EpisodeViewInternalNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE] as Route
                }
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ALERT_EPISODE_VIEW_REMEDIATION,
          )}
          element={
            <EpisodeViewRemediation
                {...props}
                pageRoute={
                  RouteMap[PageMap.ALERT_EPISODE_VIEW_REMEDIATION] as Route
                }
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ALERT_EPISODE_VIEW_DELETE)}
          element={
            <EpisodeViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.ALERT_EPISODE_VIEW_DELETE] as Route}
              />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default AlertsRoutes;

import Navigation from "Common/UI/Utils/Navigation";
import Layout from "../Pages/Incidents/Layout";
import IncidentViewLayout from "../Pages/Incidents/View/Layout";
import IncidentEpisodeViewLayout from "../Pages/Incidents/EpisodeView/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, { IncidentsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import Incidents from "../Pages/Incidents/Incidents";

import IncidentViewSettings from "../Pages/Incidents/View/Settings";

import IncidentViewOnCallPolicyExecutionLogs from "../Pages/Incidents/View/OnCallPolicyExecutionLogs";

import IncidentView from "../Pages/Incidents/View/Index";

import IncidentViewNotificationLogs from "../Pages/Incidents/View/NotificationLogs";

import IncidentViewAILogs from "../Pages/Incidents/View/AILogs";

import IncidentViewDelete from "../Pages/Incidents/View/Delete";

import IncidentWorkspaceConnectionSlack from "../Pages/Incidents/WorkspaceConnectionSlack";

import IncidentWorkspaceConnectionMicrosoftTeams from "../Pages/Incidents/WorkspaceConnectionMicrosoftTeams";

import IncidentViewStateTimeline from "../Pages/Incidents/View/StateTimeline";

import IncidentViewSla from "../Pages/Incidents/View/Sla";

import IncidentInternalNote from "../Pages/Incidents/View/InternalNote";
import IncidentPublicNote from "../Pages/Incidents/View/PublicNote";
import UnresolvedIncidents from "../Pages/Incidents/Unresolved";
import IncidentViewCustomFields from "../Pages/Incidents/View/CustomFields";
import IncidentViewOwner from "../Pages/Incidents/View/Owners";

import IncidentViewRoles from "../Pages/Incidents/View/Roles";

import IncidentViewRemediation from "../Pages/Incidents/View/Remediation";

import IncidentViewRootCause from "../Pages/Incidents/View/RootCause";

import IncidentViewPostmortem from "../Pages/Incidents/View/Postmortem";

import IncidentViewDescription from "../Pages/Incidents/View/Description";

import IncidentCreate from "../Pages/Incidents/Create";

// Settings Pages
import IncidentSettingsState from "../Pages/Incidents/Settings/IncidentState";

import IncidentSettingsSeverity from "../Pages/Incidents/Settings/IncidentSeverity";

import IncidentSettingsTemplates from "../Pages/Incidents/Settings/IncidentTemplates";

import IncidentSettingsTemplatesView from "../Pages/Incidents/Settings/IncidentTemplatesView";

import IncidentSettingsNoteTemplates from "../Pages/Incidents/Settings/IncidentNoteTemplates";

import IncidentSettingsNoteTemplatesView from "../Pages/Incidents/Settings/IncidentNoteTemplateView";

import IncidentSettingsPostmortemTemplates from "../Pages/Incidents/Settings/IncidentPostmortemTemplates";

import IncidentSettingsPostmortemTemplatesView from "../Pages/Incidents/Settings/IncidentPostmortemTemplateView";

import IncidentSettingsCustomFields from "../Pages/Incidents/Settings/IncidentCustomFields";

import IncidentSettingsGroupingRules from "../Pages/Incidents/Settings/IncidentGroupingRules";

import IncidentSettingsSlaRules from "../Pages/Incidents/Settings/IncidentSlaRules";

import IncidentSettingsRoles from "../Pages/Incidents/Settings/IncidentRoles";

import IncidentSettingsMore from "../Pages/Incidents/Settings/IncidentMoreSettings";

// Incident Episode Pages
import IncidentEpisodes from "../Pages/Incidents/Episodes";

import UnresolvedIncidentEpisodes from "../Pages/Incidents/UnresolvedEpisodes";

import IncidentEpisodeView from "../Pages/Incidents/EpisodeView/Index";

import IncidentEpisodeViewDelete from "../Pages/Incidents/EpisodeView/Delete";

import IncidentEpisodeViewDescription from "../Pages/Incidents/EpisodeView/Description";

import IncidentEpisodeViewRootCause from "../Pages/Incidents/EpisodeView/RootCause";

import IncidentEpisodeViewPostmortem from "../Pages/Incidents/EpisodeView/Postmortem";

import IncidentEpisodeViewRemediation from "../Pages/Incidents/EpisodeView/Remediation";

import IncidentEpisodeViewOwners from "../Pages/Incidents/EpisodeView/Owners";

import IncidentEpisodeViewStateTimeline from "../Pages/Incidents/EpisodeView/StateTimeline";

import IncidentEpisodeViewIncidents from "../Pages/Incidents/EpisodeView/Incidents";

import IncidentEpisodeViewInternalNote from "../Pages/Incidents/EpisodeView/InternalNote";

import IncidentEpisodeViewPublicNote from "../Pages/Incidents/EpisodeView/PublicNote";

import IncidentEpisodeViewSettings from "../Pages/Incidents/EpisodeView/Settings";

import IncidentEpisodeViewMembers from "../Pages/Incidents/EpisodeView/Members";

import IncidentEpisodeCreate from "../Pages/Incidents/EpisodeCreate";

import IncidentEpisodeDocs from "../Pages/Incidents/EpisodeDocs";

const IncidentsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  let hideSideMenu: boolean = false;

  if (Navigation.isOnThisPage(RouteMap[PageMap.INCIDENT_CREATE] as Route)) {
    hideSideMenu = true;
  }

  if (
    Navigation.isOnThisPage(RouteMap[PageMap.INCIDENT_EPISODE_CREATE] as Route)
  ) {
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
            <Incidents
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENTS] as Route}
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.UNRESOLVED_INCIDENTS] || ""}
          element={
            <UnresolvedIncidents
                {...props}
                pageRoute={RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route}
              />
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK] ||
            ""
          }
          element={
            <IncidentWorkspaceConnectionSlack
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[
              PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <IncidentWorkspaceConnectionMicrosoftTeams
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENT_CREATE] || ""}
          element={
            <IncidentCreate
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_CREATE] as Route}
              />
          }
        />

        {/* Settings Routes */}
        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_STATE] || ""}
          element={
            <IncidentSettingsState
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_STATE] as Route}
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_SEVERITY] || ""}
          element={
            <IncidentSettingsSeverity
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_SEVERITY] as Route
                }
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_TEMPLATES] || ""}
          element={
            <IncidentSettingsTemplates
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_TEMPLATES] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW] || ""
          }
          element={
            <IncidentSettingsTemplatesView
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] || ""
          }
          element={
            <IncidentSettingsNoteTemplates
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[
              PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <IncidentSettingsNoteTemplatesView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES_VIEW
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[
              PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES
            ] || ""
          }
          element={
            <IncidentSettingsPostmortemTemplates
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[
              PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <IncidentSettingsPostmortemTemplatesView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES_VIEW
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS] || ""
          }
          element={
            <IncidentSettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_GROUPING_RULES] || ""
          }
          element={
            <IncidentSettingsGroupingRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_GROUPING_RULES] as Route
                }
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_SLA_RULES] || ""}
          element={
            <IncidentSettingsSlaRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_SLA_RULES] as Route
                }
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_ROLES] || ""}
          element={
            <IncidentSettingsRoles
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_ROLES] as Route}
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_MORE] || ""}
          element={
            <IncidentSettingsMore
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_MORE] as Route}
              />
          }
        />

        {/* Incident Episode Routes */}
        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENT_EPISODES] || ""}
          element={
            <IncidentEpisodes
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_EPISODES] as Route}
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.UNRESOLVED_INCIDENT_EPISODES] || ""}
          element={
            <UnresolvedIncidentEpisodes
                {...props}
                pageRoute={
                  RouteMap[PageMap.UNRESOLVED_INCIDENT_EPISODES] as Route
                }
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENT_EPISODE_CREATE] || ""}
          element={
            <IncidentEpisodeCreate
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_EPISODE_CREATE] as Route}
              />
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENT_EPISODE_DOCS] || ""}
          element={
            <IncidentEpisodeDocs
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_EPISODE_DOCS] as Route}
              />
          }
        />
      </PageRoute>

      {/* Incident Episode View Layout */}
      <PageRoute
        path={IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW] || ""}
        element={<IncidentEpisodeViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <IncidentEpisodeView
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_EPISODE_VIEW] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_DELETE,
          )}
          element={
            <IncidentEpisodeViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_DELETE] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_DESCRIPTION,
          )}
          element={
            <IncidentEpisodeViewDescription
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_DESCRIPTION] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_ROOT_CAUSE,
          )}
          element={
            <IncidentEpisodeViewRootCause
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_ROOT_CAUSE] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_POSTMORTEM,
          )}
          element={
            <IncidentEpisodeViewPostmortem
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_POSTMORTEM] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_REMEDIATION,
          )}
          element={
            <IncidentEpisodeViewRemediation
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_REMEDIATION] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_OWNERS,
          )}
          element={
            <IncidentEpisodeViewOwners
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_OWNERS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_STATE_TIMELINE,
          )}
          element={
            <IncidentEpisodeViewStateTimeline
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENT_EPISODE_VIEW_STATE_TIMELINE
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS,
          )}
          element={
            <IncidentEpisodeViewIncidents
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE,
          )}
          element={
            <IncidentEpisodeViewInternalNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_PUBLIC_NOTE,
          )}
          element={
            <IncidentEpisodeViewPublicNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_PUBLIC_NOTE] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_MEMBERS,
          )}
          element={
            <IncidentEpisodeViewMembers
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_MEMBERS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_SETTINGS,
          )}
          element={
            <IncidentEpisodeViewSettings
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_SETTINGS] as Route
                }
              />
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
            <IncidentView
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_DELETE)}
          element={
            <IncidentViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_DELETE] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_SETTINGS)}
          element={
            <IncidentViewSettings
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_SETTINGS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_STATE_TIMELINE,
          )}
          element={
            <IncidentViewStateTimeline
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_VIEW_STATE_TIMELINE] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_SLA)}
          element={
            <IncidentViewSla
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_SLA] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_REMEDIATION)}
          element={
            <IncidentViewRemediation
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_REMEDIATION] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_ROOT_CAUSE)}
          element={
            <IncidentViewRootCause
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_ROOT_CAUSE] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_POSTMORTEM)}
          element={
            <IncidentViewPostmortem
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_POSTMORTEM] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_DESCRIPTION)}
          element={
            <IncidentViewDescription
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_DESCRIPTION] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_INTERNAL_NOTE,
          )}
          element={
            <IncidentInternalNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_VIEW_INTERNAL_NOTE] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_CUSTOM_FIELDS,
          )}
          element={
            <IncidentViewCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_VIEW_CUSTOM_FIELDS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_PUBLIC_NOTE)}
          element={
            <IncidentPublicNote
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_PUBLIC_NOTE] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_OWNERS)}
          element={
            <IncidentViewOwner
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_OWNERS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_ROLES)}
          element={
            <IncidentViewRoles
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_ROLES] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS,
          )}
          element={
            <IncidentViewOnCallPolicyExecutionLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <IncidentViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_AI_LOGS)}
          element={
            <IncidentViewAILogs
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_AI_LOGS] as Route}
              />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default IncidentsRoutes;

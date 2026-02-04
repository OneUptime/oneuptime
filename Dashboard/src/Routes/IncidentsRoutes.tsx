import Navigation from "Common/UI/Utils/Navigation";
import Loader from "../Components/Loader/Loader";
import Layout from "../Pages/Incidents/Layout";
import IncidentViewLayout from "../Pages/Incidents/View/Layout";
import IncidentEpisodeViewLayout from "../Pages/Incidents/EpisodeView/Layout";
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

const IncidentViewSla: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Incidents/View/Sla");
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

const IncidentViewRoles: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/View/Roles");
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

// Settings Pages
const IncidentSettingsState: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentState");
});

const IncidentSettingsSeverity: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentSeverity");
});

const IncidentSettingsTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentTemplates");
});

const IncidentSettingsTemplatesView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentTemplatesView");
});

const IncidentSettingsNoteTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentNoteTemplates");
});

const IncidentSettingsNoteTemplatesView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentNoteTemplateView");
});

const IncidentSettingsPostmortemTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentPostmortemTemplates");
});

const IncidentSettingsPostmortemTemplatesView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentPostmortemTemplateView");
});

const IncidentSettingsCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentCustomFields");
});

const IncidentSettingsGroupingRules: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentGroupingRules");
});

const IncidentSettingsSlaRules: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentSlaRules");
});

const IncidentSettingsRoles: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/Settings/IncidentRoles");
});

// Incident Episode Pages
const IncidentEpisodes: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Incidents/Episodes");
  });

const UnresolvedIncidentEpisodes: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/UnresolvedEpisodes");
});

const IncidentEpisodeView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/Index");
});

const IncidentEpisodeViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/Delete");
});

const IncidentEpisodeViewDescription: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/Description");
});

const IncidentEpisodeViewRootCause: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/RootCause");
});

const IncidentEpisodeViewPostmortem: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/Postmortem");
});

const IncidentEpisodeViewRemediation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/Remediation");
});

const IncidentEpisodeViewOwners: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/Owners");
});

const IncidentEpisodeViewStateTimeline: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/StateTimeline");
});

const IncidentEpisodeViewIncidents: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/Incidents");
});

const IncidentEpisodeViewInternalNote: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/InternalNote");
});

const IncidentEpisodeViewPublicNote: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/PublicNote");
});

const IncidentEpisodeViewMembers: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeView/Members");
});

const IncidentEpisodeCreate: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeCreate");
});

const IncidentEpisodeDocs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Incidents/EpisodeDocs");
});

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

        {/* Settings Routes */}
        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_STATE] || ""}
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsState
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_STATE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_SEVERITY] || ""}
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsSeverity
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_SEVERITY] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_TEMPLATES] || ""}
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsTemplates
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_TEMPLATES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsTemplatesView
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsNoteTemplates
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[
              PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsNoteTemplatesView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[
              PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsPostmortemTemplates
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[
              PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsPostmortemTemplatesView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_GROUPING_RULES] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsGroupingRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_GROUPING_RULES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_SLA_RULES] || ""}
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsSlaRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENTS_SETTINGS_SLA_RULES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_ROLES] || ""}
          element={
            <Suspense fallback={Loader}>
              <IncidentSettingsRoles
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_ROLES] as Route}
              />
            </Suspense>
          }
        />

        {/* Incident Episode Routes */}
        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENT_EPISODES] || ""}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodes
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_EPISODES] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.UNRESOLVED_INCIDENT_EPISODES] || ""}
          element={
            <Suspense fallback={Loader}>
              <UnresolvedIncidentEpisodes
                {...props}
                pageRoute={
                  RouteMap[PageMap.UNRESOLVED_INCIDENT_EPISODES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENT_EPISODE_CREATE] || ""}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeCreate
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_EPISODE_CREATE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={IncidentsRoutePath[PageMap.INCIDENT_EPISODE_DOCS] || ""}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeDocs
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_EPISODE_DOCS] as Route}
              />
            </Suspense>
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
            <Suspense fallback={Loader}>
              <IncidentEpisodeView
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_EPISODE_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_DELETE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_DESCRIPTION,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewDescription
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_DESCRIPTION] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_ROOT_CAUSE,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewRootCause
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_ROOT_CAUSE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_POSTMORTEM,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewPostmortem
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_POSTMORTEM] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_REMEDIATION,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewRemediation
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_REMEDIATION] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_OWNERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewOwners
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_OWNERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_STATE_TIMELINE,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewStateTimeline
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.INCIDENT_EPISODE_VIEW_STATE_TIMELINE
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewIncidents
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewInternalNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_PUBLIC_NOTE,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewPublicNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_PUBLIC_NOTE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INCIDENT_EPISODE_VIEW_MEMBERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentEpisodeViewMembers
                {...props}
                pageRoute={
                  RouteMap[PageMap.INCIDENT_EPISODE_VIEW_MEMBERS] as Route
                }
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
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_SLA)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewSla
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_SLA] as Route}
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
          path={RouteUtil.getLastPathForKey(PageMap.INCIDENT_VIEW_ROLES)}
          element={
            <Suspense fallback={Loader}>
              <IncidentViewRoles
                {...props}
                pageRoute={RouteMap[PageMap.INCIDENT_VIEW_ROLES] as Route}
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

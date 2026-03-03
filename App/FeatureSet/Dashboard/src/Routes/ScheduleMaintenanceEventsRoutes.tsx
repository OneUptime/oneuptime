import Navigation from "Common/UI/Utils/Navigation";
import ComponentProps from "../Pages/PageComponentProps";
import ScheduledMaintenancesLaoyut from "../Pages/ScheduledMaintenanceEvents/Layout";
import ScheduledMaintenanceViewLayout from "../Pages/ScheduledMaintenanceEvents/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  RouteUtil,
  ScheduledMaintenanceEventsRoutePath,
} from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages

import ScheduledMaintenanceEvents from "../Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents";
import ScheduledMaintenanceEventView from "../Pages/ScheduledMaintenanceEvents/View/Index";
import ScheduledMaintenanceEventViewDelete from "../Pages/ScheduledMaintenanceEvents/View/Delete";

import ScheduledMaintenanceEventsWorkspaceConnectionMicrosoftTeams from "../Pages/ScheduledMaintenanceEvents/WorkspaceConnectionMicrosoftTeams";

import ScheduledMaintenanceEventViewOwner from "../Pages/ScheduledMaintenanceEvents/View/Owners";

import ScheduledMaintenanceEventsWorkspaceConnectionSlack from "../Pages/ScheduledMaintenanceEvents/WorkspaceConnectionSlack";

import ScheduledMaintenanceEventsViewSettings from "../Pages/ScheduledMaintenanceEvents/View/Settings";

import ScheduledMaintenanceEventViewStateTimeline from "../Pages/ScheduledMaintenanceEvents/View/StateTimeline";
import ScheduledMaintenanceEventInternalNote from "../Pages/ScheduledMaintenanceEvents/View/InternalNote";
import ScheduledMaintenanceEventPublicNote from "../Pages/ScheduledMaintenanceEvents/View/PublicNote";
import OngoingScheduledMaintenanceEvents from "../Pages/ScheduledMaintenanceEvents/Ongoing";
import ScheduledMaintenanceEventsViewCustomFields from "../Pages/ScheduledMaintenanceEvents/View/CustomFields";

import ScheduledMaintenanceEventViewNotificationLogs from "../Pages/ScheduledMaintenanceEvents/View/NotificationLogs";

import ScheduledMaintenanceEventViewAILogs from "../Pages/ScheduledMaintenanceEvents/View/AILogs";

import ScheduledMaintenanceEventViewDescription from "../Pages/ScheduledMaintenanceEvents/View/Description";

import ScheduledMaintenanceEventCreate from "../Pages/ScheduledMaintenanceEvents/Create";

// Settings Pages
import ScheduledMaintenanceSettingsState from "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceState";

import ScheduledMaintenanceSettingsTemplates from "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates";

import ScheduledMaintenanceSettingsTemplatesView from "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView";

import ScheduledMaintenanceSettingsNoteTemplates from "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates";

import ScheduledMaintenanceSettingsNoteTemplatesView from "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplateView";

import ScheduledMaintenanceSettingsCustomFields from "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCusomFields";

import ScheduledMaintenanceSettingsMore from "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceMoreSettings";

const ScheduledMaintenanceEventsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let hideSideMenu: boolean = false;

  if (
    Navigation.isOnThisPage(
      RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE] as Route,
    )
  ) {
    hideSideMenu = true;
  }

  return (
    <Routes>
      <PageRoute
        path="/"
        element={
          <ScheduledMaintenancesLaoyut {...props} hideSideMenu={hideSideMenu} />
        }
      >
        <PageRoute
          index
          element={
            <ScheduledMaintenanceEvents
              {...props}
              pageRoute={
                RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS
            ] || ""
          }
          element={
            <OngoingScheduledMaintenanceEvents
              {...props}
              pageRoute={
                RouteMap[PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK
            ] || ""
          }
          element={
            <ScheduledMaintenanceEventsWorkspaceConnectionSlack
              {...props}
              pageRoute={
                RouteMap[
                  PageMap
                    .SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap
                .SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <ScheduledMaintenanceEventsWorkspaceConnectionMicrosoftTeams
              {...props}
              pageRoute={
                RouteMap[
                  PageMap
                    .SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE
            ] || ""
          }
          element={
            <ScheduledMaintenanceEventCreate
              {...props}
              pageRoute={
                RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE] as Route
              }
            />
          }
        />

        {/* Settings Routes */}
        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE
            ] || ""
          }
          element={
            <ScheduledMaintenanceSettingsState
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES
            ] || ""
          }
          element={
            <ScheduledMaintenanceSettingsTemplates
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <ScheduledMaintenanceSettingsTemplatesView
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
            ] || ""
          }
          element={
            <ScheduledMaintenanceSettingsNoteTemplates
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <ScheduledMaintenanceSettingsNoteTemplatesView
              {...props}
              pageRoute={
                RouteMap[
                  PageMap
                    .SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS
            ] || ""
          }
          element={
            <ScheduledMaintenanceSettingsCustomFields
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_MORE
            ] || ""
          }
          element={
            <ScheduledMaintenanceSettingsMore
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_MORE
                ] as Route
              }
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={
          ScheduledMaintenanceEventsRoutePath[
            PageMap.SCHEDULED_MAINTENANCE_VIEW
          ] || ""
        }
        element={<ScheduledMaintenanceViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <ScheduledMaintenanceEventView
              {...props}
              pageRoute={RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS,
          )}
          element={
            <ScheduledMaintenanceEventsViewCustomFields
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <ScheduledMaintenanceEventViewNotificationLogs
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_AI_LOGS,
          )}
          element={
            <ScheduledMaintenanceEventViewAILogs
              {...props}
              pageRoute={
                RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_AI_LOGS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS,
          )}
          element={
            <ScheduledMaintenanceEventsViewSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE,
          )}
          element={
            <ScheduledMaintenanceEventViewDelete
              {...props}
              pageRoute={
                RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION,
          )}
          element={
            <ScheduledMaintenanceEventViewDescription
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS,
          )}
          element={
            <ScheduledMaintenanceEventViewOwner
              {...props}
              pageRoute={
                RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE,
          )}
          element={
            <ScheduledMaintenanceEventViewStateTimeline
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE,
          )}
          element={
            <ScheduledMaintenanceEventInternalNote
              {...props}
              pageRoute={
                RouteMap[PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE,
          )}
          element={
            <ScheduledMaintenanceEventPublicNote
              {...props}
              pageRoute={
                RouteMap[PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ScheduledMaintenanceEventsRoutes;

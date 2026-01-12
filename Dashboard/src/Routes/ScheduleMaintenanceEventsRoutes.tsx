import Navigation from "Common/UI/Utils/Navigation";
import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import ScheduledMaintenancesLaoyut from "../Pages/ScheduledMaintenanceEvents/Layout";
import ScheduledMaintenanceViewLayout from "../Pages/ScheduledMaintenanceEvents/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  RouteUtil,
  ScheduledMaintenanceEventsRoutePath,
} from "../Utils/RouteMap";
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

const ScheduledMaintenanceEvents: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents"
  );
});
const ScheduledMaintenanceEventView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/Index");
});
const ScheduledMaintenanceEventViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/Delete");
});

const ScheduledMaintenanceEventsWorkspaceConnectionMicrosoftTeams: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/ScheduledMaintenanceEvents/WorkspaceConnectionMicrosoftTeams"
  );
});

const ScheduledMaintenanceEventViewOwner: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/Owners");
});

const ScheduledMaintenanceEventsWorkspaceConnectionSlack: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/WorkspaceConnectionSlack");
});

const ScheduledMaintenanceEventsViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/Settings");
});

const ScheduledMaintenanceEventViewStateTimeline: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/StateTimeline");
});
const ScheduledMaintenanceEventInternalNote: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/InternalNote");
});
const ScheduledMaintenanceEventPublicNote: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/PublicNote");
});
const OngoingScheduledMaintenanceEvents: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/Ongoing");
});
const ScheduledMaintenanceEventsViewCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/CustomFields");
});

const ScheduledMaintenanceEventViewNotificationLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/NotificationLogs");
});

const ScheduledMaintenanceEventViewAILogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/AILogs");
});

const ScheduledMaintenanceEventViewDescription: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/View/Description");
});

const ScheduledMaintenanceEventCreate: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ScheduledMaintenanceEvents/Create");
});

// Settings Pages
const ScheduledMaintenanceSettingsState: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceState"
  );
});

const ScheduledMaintenanceSettingsTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates"
  );
});

const ScheduledMaintenanceSettingsTemplatesView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView"
  );
});

const ScheduledMaintenanceSettingsNoteTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates"
  );
});

const ScheduledMaintenanceSettingsNoteTemplatesView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplateView"
  );
});

const ScheduledMaintenanceSettingsCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCusomFields"
  );
});

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
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEvents
                {...props}
                pageRoute={
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <OngoingScheduledMaintenanceEvents
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventsWorkspaceConnectionSlack
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap
                      .SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK
                  ] as Route
                }
              />
            </Suspense>
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
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventsWorkspaceConnectionMicrosoftTeams
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap
                      .SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventCreate
                {...props}
                pageRoute={
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE] as Route
                }
              />
            </Suspense>
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
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceSettingsState
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceSettingsTemplates
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceSettingsTemplatesView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceSettingsNoteTemplates
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceSettingsNoteTemplatesView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap
                      .SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            ScheduledMaintenanceEventsRoutePath[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceSettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS
                  ] as Route
                }
              />
            </Suspense>
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
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventView
                {...props}
                pageRoute={
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventsViewCustomFields
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS
                  ] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_AI_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventViewAILogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_AI_LOGS] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventsViewSettings
                {...props}
                pageRoute={
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventViewDescription
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventViewOwner
                {...props}
                pageRoute={
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventViewStateTimeline
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventInternalNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceEventPublicNote
                {...props}
                pageRoute={
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ScheduledMaintenanceEventsRoutes;

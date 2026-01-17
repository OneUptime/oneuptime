import Loader from "../Components/Loader/Loader";
import OnCallDutyLayout from "../Pages/OnCallDuty/Layout";
import OnCallDutyPolicyViewLayout from "../Pages/OnCallDuty/OnCallDutyPolicy/Layout";
import OnCallDutyScheduleViewLayout from "../Pages/OnCallDuty/OnCallDutySchedule/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, { OnCallDutyRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  ReactElement,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Polcies
const OnCallDutyPoliciesPage: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicies");
});
const OnCallDutyExecutionLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyExecutionLogs");
});

const OnCallDutyUserOverrides: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/UserOverrides");
});

const OnCallDutyPolicyViewUserOverrides: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicy/UserOverrides");
});
const OnCallDutyPolicyExecutionLogTimeline: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyExecutionLogView");
});
const OnCallDutyPolicyView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicy/Index");
});
const OnCallDutyPolicyViewOwners: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicy/Owners");
});

const OnCallDutyPolicyViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicy/Delete");
});
const OnCallDutyPolicyViewLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicy/ExecutionLogs");
});
const OnCallDutyPolicyViewLogsView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicy/ExecutionLogView");
});

const OnCallDutyPolicyViewNotificationLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicy/NotificationLogs");
});
const OnCallDutyPolicyViewEscalation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicy/Escalation");
});
const OnCallDutyPolicyViewCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyPolicy/CustomFields");
});

// Schedules
const OnCallDutySchedules: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutySchedules");
});
const OnCallDutyScheduleView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutySchedule/Index");
});
const OnCallDutyScheduleViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutySchedule/Delete");
});
const OnCallDutyScheduleViewLayers: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutySchedule/Layers");
});

const OnCallDutyScheduleViewNotificationLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutySchedule/NotificationLogs");
});
const OnCallDutyScheduleViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutySchedule/Settings");
});

// slack
const WorkspaceConnectionSlack: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/WorkspaceConnectionSlack");
});

// Microsoft Teams
const WorkspaceConnectionTeams: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/WorkspaceConnectionMicrosoftTeams");
});

// User Time Logs
const OnCallDutyUserTimeLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/OnCallDutyUserTimeLogs");
});

// Settings Pages
const OnCallDutySettingsCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/Settings/OnCallDutyPolicyCustomFields");
});

// Incoming Call Policies
const IncomingCallPoliciesPage: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/IncomingCallPolicies");
});

const IncomingCallPolicyViewLayout: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/IncomingCallPolicy/Layout");
});

const IncomingCallPolicyView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/IncomingCallPolicy/Index");
});

const IncomingCallPolicyViewEscalation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/IncomingCallPolicy/Escalation");
});

const IncomingCallPolicyViewLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/IncomingCallPolicy/Logs");
});

const IncomingCallPolicyViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/IncomingCallPolicy/Delete");
});

const IncomingCallPolicyViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/OnCallDuty/IncomingCallPolicy/Settings");
});

const OnCallDutyRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute element={<OnCallDutyLayout {...props} />}>
        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY] || ""}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPoliciesPage
                {...props}
                pageRoute={RouteMap[PageMap.ON_CALL_DUTY] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            OnCallDutyRoutePath[
              PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <WorkspaceConnectionSlack
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            OnCallDutyRoutePath[
              PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <WorkspaceConnectionTeams
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICIES] || ""}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPoliciesPage
                {...props}
                pageRoute={RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_EXECUTION_LOGS] || ""}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyExecutionLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_EXECUTION_LOGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES] ||
            ""
          }
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyUserOverrides
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE] ||
            ""
          }
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyExecutionLogTimeline
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULES] || ""}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutySchedules
                {...props}
                pageRoute={RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALLDUTY_USER_TIME_LOGS] || ""}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyUserTimeLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALLDUTY_USER_TIME_LOGS] as Route
                }
              />
            </Suspense>
          }
        />

        {/* Settings Routes */}
        <PageRoute
          path={
            OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS] ||
            ""
          }
          element={
            <Suspense fallback={Loader}>
              <OnCallDutySettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        {/* Incoming Call Policies */}
        <PageRoute
          path={
            OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES] ||
            ""
          }
          element={
            <Suspense fallback={Loader}>
              <IncomingCallPoliciesPage
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>

      <PageRoute
        path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW] || ""}
        element={<OnCallDutyPolicyViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyView
                {...props}
                pageRoute={RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyViewOwners
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyViewEscalation
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyViewUserOverrides
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyViewCustomFields
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyViewLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW,
            2,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyViewLogsView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_NOTIFICATION_LOGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>
      <PageRoute
        path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW] || ""}
        element={<OnCallDutyScheduleViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyScheduleView
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyScheduleViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyScheduleViewLayers
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyScheduleViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_NOTIFICATION_LOGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyScheduleViewSettings
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>

      {/* Incoming Call Policy View Routes */}
      <PageRoute
        path={
          OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW] ||
          ""
        }
        element={
          <Suspense fallback={Loader}>
            <IncomingCallPolicyViewLayout {...props} />
          </Suspense>
        }
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <IncomingCallPolicyView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncomingCallPolicyViewEscalation
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncomingCallPolicyViewLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncomingCallPolicyViewSettings
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncomingCallPolicyViewDelete
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE
                  ] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default OnCallDutyRoutes;

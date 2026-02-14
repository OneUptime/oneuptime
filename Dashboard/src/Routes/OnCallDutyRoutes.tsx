import OnCallDutyLayout from "../Pages/OnCallDuty/Layout";
import OnCallDutyPolicyViewLayout from "../Pages/OnCallDuty/OnCallDutyPolicy/Layout";
import OnCallDutyScheduleViewLayout from "../Pages/OnCallDuty/OnCallDutySchedule/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, { OnCallDutyRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Polcies
import OnCallDutyPoliciesPage from "../Pages/OnCallDuty/OnCallDutyPolicies";
import OnCallDutyExecutionLogs from "../Pages/OnCallDuty/OnCallDutyExecutionLogs";

import OnCallDutyUserOverrides from "../Pages/OnCallDuty/UserOverrides";

import OnCallDutyPolicyViewUserOverrides from "../Pages/OnCallDuty/OnCallDutyPolicy/UserOverrides";
import OnCallDutyPolicyExecutionLogTimeline from "../Pages/OnCallDuty/OnCallDutyExecutionLogView";
import OnCallDutyPolicyView from "../Pages/OnCallDuty/OnCallDutyPolicy/Index";
import OnCallDutyPolicyViewOwners from "../Pages/OnCallDuty/OnCallDutyPolicy/Owners";

import OnCallDutyPolicyViewDelete from "../Pages/OnCallDuty/OnCallDutyPolicy/Delete";
import OnCallDutyPolicyViewLogs from "../Pages/OnCallDuty/OnCallDutyPolicy/ExecutionLogs";
import OnCallDutyPolicyViewLogsView from "../Pages/OnCallDuty/OnCallDutyPolicy/ExecutionLogView";

import OnCallDutyPolicyViewNotificationLogs from "../Pages/OnCallDuty/OnCallDutyPolicy/NotificationLogs";
import OnCallDutyPolicyViewEscalation from "../Pages/OnCallDuty/OnCallDutyPolicy/Escalation";
import OnCallDutyPolicyViewCustomFields from "../Pages/OnCallDuty/OnCallDutyPolicy/CustomFields";

// Schedules
import OnCallDutySchedules from "../Pages/OnCallDuty/OnCallDutySchedules";
import OnCallDutyScheduleView from "../Pages/OnCallDuty/OnCallDutySchedule/Index";
import OnCallDutyScheduleViewDelete from "../Pages/OnCallDuty/OnCallDutySchedule/Delete";
import OnCallDutyScheduleViewLayers from "../Pages/OnCallDuty/OnCallDutySchedule/Layers";

import OnCallDutyScheduleViewNotificationLogs from "../Pages/OnCallDuty/OnCallDutySchedule/NotificationLogs";
import OnCallDutyScheduleViewSettings from "../Pages/OnCallDuty/OnCallDutySchedule/Settings";

// slack
import WorkspaceConnectionSlack from "../Pages/OnCallDuty/WorkspaceConnectionSlack";

// Microsoft Teams
import WorkspaceConnectionTeams from "../Pages/OnCallDuty/WorkspaceConnectionMicrosoftTeams";

// User Time Logs
import OnCallDutyUserTimeLogs from "../Pages/OnCallDuty/OnCallDutyUserTimeLogs";

// Settings Pages
import OnCallDutySettingsCustomFields from "../Pages/OnCallDuty/Settings/OnCallDutyPolicyCustomFields";

// Incoming Call Policies
import IncomingCallPoliciesPage from "../Pages/OnCallDuty/IncomingCallPolicies";

import IncomingCallPolicyViewLayout from "../Pages/OnCallDuty/IncomingCallPolicy/Layout";

import IncomingCallPolicyView from "../Pages/OnCallDuty/IncomingCallPolicy/Index";

import IncomingCallPolicyViewEscalation from "../Pages/OnCallDuty/IncomingCallPolicy/Escalation";

import IncomingCallPolicyViewLogs from "../Pages/OnCallDuty/IncomingCallPolicy/Logs";

import IncomingCallPolicyViewLogView from "../Pages/OnCallDuty/IncomingCallPolicy/LogView";

import IncomingCallPolicyViewDelete from "../Pages/OnCallDuty/IncomingCallPolicy/Delete";

import IncomingCallPolicyViewSettings from "../Pages/OnCallDuty/IncomingCallPolicy/Settings";

import IncomingCallPolicyViewDocs from "../Pages/OnCallDuty/IncomingCallPolicy/Docs";

const OnCallDutyRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute element={<OnCallDutyLayout {...props} />}>
        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY] || ""}
          element={
            <OnCallDutyPoliciesPage
                {...props}
                pageRoute={RouteMap[PageMap.ON_CALL_DUTY] as Route}
              />
          }
        />

        <PageRoute
          path={
            OnCallDutyRoutePath[
              PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK
            ] || ""
          }
          element={
            <WorkspaceConnectionSlack
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            OnCallDutyRoutePath[
              PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <WorkspaceConnectionTeams
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICIES] || ""}
          element={
            <OnCallDutyPoliciesPage
                {...props}
                pageRoute={RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route}
              />
          }
        />
        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_EXECUTION_LOGS] || ""}
          element={
            <OnCallDutyExecutionLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_EXECUTION_LOGS] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES] ||
            ""
          }
          element={
            <OnCallDutyUserOverrides
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE] ||
            ""
          }
          element={
            <OnCallDutyPolicyExecutionLogTimeline
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULES] || ""}
          element={
            <OnCallDutySchedules
                {...props}
                pageRoute={RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route}
              />
          }
        />

        <PageRoute
          path={OnCallDutyRoutePath[PageMap.ON_CALLDUTY_USER_TIME_LOGS] || ""}
          element={
            <OnCallDutyUserTimeLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALLDUTY_USER_TIME_LOGS] as Route
                }
              />
          }
        />

        {/* Settings Routes */}
        <PageRoute
          path={
            OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS] ||
            ""
          }
          element={
            <OnCallDutySettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS] as Route
                }
              />
          }
        />

        {/* Incoming Call Policies */}
        <PageRoute
          path={
            OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES] ||
            ""
          }
          element={
            <IncomingCallPoliciesPage
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES] as Route
                }
              />
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
            <OnCallDutyPolicyView
                {...props}
                pageRoute={RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE,
          )}
          element={
            <OnCallDutyPolicyViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS,
          )}
          element={
            <OnCallDutyPolicyViewOwners
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
          )}
          element={
            <OnCallDutyPolicyViewEscalation
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES,
          )}
          element={
            <OnCallDutyPolicyViewUserOverrides
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS,
          )}
          element={
            <OnCallDutyPolicyViewCustomFields
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS,
          )}
          element={
            <OnCallDutyPolicyViewLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW,
            2,
          )}
          element={
            <OnCallDutyPolicyViewLogsView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <OnCallDutyPolicyViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_POLICY_VIEW_NOTIFICATION_LOGS
                  ] as Route
                }
              />
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
            <OnCallDutyScheduleView
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE,
          )}
          element={
            <OnCallDutyScheduleViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS,
          )}
          element={
            <OnCallDutyScheduleViewLayers
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <OnCallDutyScheduleViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_NOTIFICATION_LOGS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS,
          )}
          element={
            <OnCallDutyScheduleViewSettings
                {...props}
                pageRoute={
                  RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS] as Route
                }
              />
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
          <IncomingCallPolicyViewLayout {...props} />
        }
      >
        <PageRoute
          index
          element={
            <IncomingCallPolicyView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION,
          )}
          element={
            <IncomingCallPolicyViewEscalation
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS,
          )}
          element={
            <IncomingCallPolicyViewLogs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOG_VIEW,
            2,
          )}
          element={
            <IncomingCallPolicyViewLogView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOG_VIEW
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS,
          )}
          element={
            <IncomingCallPolicyViewSettings
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE,
          )}
          element={
            <IncomingCallPolicyViewDelete
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DOCS,
          )}
          element={
            <IncomingCallPolicyViewDocs
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DOCS
                  ] as Route
                }
              />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default OnCallDutyRoutes;

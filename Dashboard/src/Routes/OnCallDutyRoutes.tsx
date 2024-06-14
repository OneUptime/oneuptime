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
      </PageRoute>
    </Routes>
  );
};

export default OnCallDutyRoutes;

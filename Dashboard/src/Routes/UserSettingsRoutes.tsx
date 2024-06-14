import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import UserSettingsLayout from "../Pages/UserSettings/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { UserSettingsRoutePath } from "../Utils/RouteMap";
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
const UserSettingsNotificationMethods: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/NotificationMethods");
});
const UserSettingsNotificationRules: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/OnCallRules");
});
const UserSettingsNotificationLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/OnCallLogs");
});
const UserSettingsNotificationLogsTimeline: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/OnCallLogsTimeline");
});
const UserSettingsNotiifcationSetting: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/NotificationSettings");
});

const UserSettingsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute element={<UserSettingsLayout {...props} />}>
        <PageRoute
          path={UserSettingsRoutePath[PageMap.USER_SETTINGS] || ""}
          element={
            <Suspense fallback={Loader}>
              <UserSettingsNotificationMethods
                {...props}
                pageRoute={RouteMap[PageMap.USER_SETTINGS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={UserSettingsRoutePath[PageMap.USER_SETTINGS_ON_CALL_LOGS] || ""}
          element={
            <Suspense fallback={Loader}>
              <UserSettingsNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_ON_CALL_LOGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsNotificationLogsTimeline
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsNotiifcationSetting
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] ||
            ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsNotificationMethods
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[PageMap.USER_SETTINGS_ON_CALL_RULES] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsNotificationRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default UserSettingsRoutes;

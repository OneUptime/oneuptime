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
const UserSettingsCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/CustomFields");
});
const UserSettingsIncidentNotificationRules: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/IncidentOnCallRules");
});

const UserSettingsMicrosoftTeamsIntegration: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/MicrosoftTeamsIntegration");
});

const UserSettingsAlertNotificationRules: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/AlertOnCallRules");
});

const UserSettingsAlertEpisodeNotificationRules: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/EpisodeOnCallRules");
});

const UserSettingsIncidentEpisodeNotificationRules: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/IncidentEpisodeOnCallRules");
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

const UserSettingsSlackIntegration: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/SlackIntegration");
});

const UserSettingsIncomingCallPhoneNumbers: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/UserSettings/IncomingCallPhoneNumbers");
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
          path={
            UserSettingsRoutePath[PageMap.USER_SETTINGS_CUSTOM_FIELDS] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_CUSTOM_FIELDS] as Route
                }
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
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsIncidentNotificationRules
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[PageMap.USER_SETTINGS_SLACK_INTEGRATION] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsSlackIntegration
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_SLACK_INTEGRATION] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsMicrosoftTeamsIntegration
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES] ||
            ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsAlertNotificationRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_ALERT_EPISODE_ON_CALL_RULES
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsAlertEpisodeNotificationRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_ALERT_EPISODE_ON_CALL_RULES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_INCIDENT_EPISODE_ON_CALL_RULES
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsIncidentEpisodeNotificationRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_SETTINGS_INCIDENT_EPISODE_ON_CALL_RULES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <UserSettingsIncomingCallPhoneNumbers
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS
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

export default UserSettingsRoutes;

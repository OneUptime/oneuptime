import ComponentProps from "../Pages/PageComponentProps";
import UserSettingsLayout from "../Pages/UserSettings/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { UserSettingsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import UserSettingsNotificationMethods from "../Pages/UserSettings/NotificationMethods";
import UserSettingsCustomFields from "../Pages/UserSettings/CustomFields";
import UserSettingsIncidentNotificationRules from "../Pages/UserSettings/IncidentOnCallRules";

import UserSettingsMicrosoftTeamsIntegration from "../Pages/UserSettings/MicrosoftTeamsIntegration";

import UserSettingsAlertNotificationRules from "../Pages/UserSettings/AlertOnCallRules";

import UserSettingsAlertEpisodeNotificationRules from "../Pages/UserSettings/EpisodeOnCallRules";

import UserSettingsIncidentEpisodeNotificationRules from "../Pages/UserSettings/IncidentEpisodeOnCallRules";

import UserSettingsNotificationLogs from "../Pages/UserSettings/OnCallLogs";
import UserSettingsNotificationLogsTimeline from "../Pages/UserSettings/OnCallLogsTimeline";
import UserSettingsNotiifcationSetting from "../Pages/UserSettings/NotificationSettings";

import UserSettingsSlackIntegration from "../Pages/UserSettings/SlackIntegration";

import UserSettingsIncomingCallPhoneNumbers from "../Pages/UserSettings/IncomingCallPhoneNumbers";

const UserSettingsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute element={<UserSettingsLayout {...props} />}>
        <PageRoute
          path={UserSettingsRoutePath[PageMap.USER_SETTINGS] || ""}
          element={
            <UserSettingsNotificationMethods
              {...props}
              pageRoute={RouteMap[PageMap.USER_SETTINGS] as Route}
            />
          }
        />
        <PageRoute
          path={
            UserSettingsRoutePath[PageMap.USER_SETTINGS_CUSTOM_FIELDS] || ""
          }
          element={
            <UserSettingsCustomFields
              {...props}
              pageRoute={RouteMap[PageMap.USER_SETTINGS_CUSTOM_FIELDS] as Route}
            />
          }
        />
        <PageRoute
          path={UserSettingsRoutePath[PageMap.USER_SETTINGS_ON_CALL_LOGS] || ""}
          element={
            <UserSettingsNotificationLogs
              {...props}
              pageRoute={RouteMap[PageMap.USER_SETTINGS_ON_CALL_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE
            ] || ""
          }
          element={
            <UserSettingsNotificationLogsTimeline
              {...props}
              pageRoute={
                RouteMap[PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS
            ] || ""
          }
          element={
            <UserSettingsNotiifcationSetting
              {...props}
              pageRoute={
                RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] ||
            ""
          }
          element={
            <UserSettingsNotificationMethods
              {...props}
              pageRoute={
                RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES
            ] || ""
          }
          element={
            <UserSettingsIncidentNotificationRules
              {...props}
              pageRoute={
                RouteMap[PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[PageMap.USER_SETTINGS_SLACK_INTEGRATION] || ""
          }
          element={
            <UserSettingsSlackIntegration
              {...props}
              pageRoute={
                RouteMap[PageMap.USER_SETTINGS_SLACK_INTEGRATION] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION
            ] || ""
          }
          element={
            <UserSettingsMicrosoftTeamsIntegration
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES] ||
            ""
          }
          element={
            <UserSettingsAlertNotificationRules
              {...props}
              pageRoute={
                RouteMap[PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_ALERT_EPISODE_ON_CALL_RULES
            ] || ""
          }
          element={
            <UserSettingsAlertEpisodeNotificationRules
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.USER_SETTINGS_ALERT_EPISODE_ON_CALL_RULES
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_INCIDENT_EPISODE_ON_CALL_RULES
            ] || ""
          }
          element={
            <UserSettingsIncidentEpisodeNotificationRules
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.USER_SETTINGS_INCIDENT_EPISODE_ON_CALL_RULES
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            UserSettingsRoutePath[
              PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS
            ] || ""
          }
          element={
            <UserSettingsIncomingCallPhoneNumbers
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS
                ] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default UserSettingsRoutes;

import UserCall from "./Call";
import UserCustomChannels from "./CustomChannels";
import UserEmail from "./Email";
import UserMattermost from "./Mattermost";
import UserMicrosoftTeams from "./MicrosoftTeams";
import UserPush from "./Push";
import PushNotificationsTurnedOff from "./PushNotificationsTurnedOff";
import UserSMS from "./SMS";
import UserSlack from "./Slack";
import UserTelegram from "./Telegram";
import UserWebhook from "./Webhook";
import UserWhatsApp from "./WhatsApp";
import {
  getOfferedWorkspaces,
  useWorkspaceConnections,
} from "../../Utils/Workspace/ConnectedWorkspaces";
import {
  CustomNotificationChannelsState,
  useCustomNotificationChannels,
} from "../../Utils/CustomNotificationChannels";
import { usePushNotificationsTurnedOff } from "../../Utils/PushNotificationsTurnedOff";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import React, { FunctionComponent, ReactElement } from "react";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import Navigation from "Common/UI/Utils/Navigation";
import {
  DEFAULT_NOTIFICATION_METHODS_TAB,
  getNotificationMethodsTabByName,
  NOTIFICATION_METHODS_TAB_NAMES,
  NOTIFICATION_METHODS_TAB_QUERY_PARAM,
  NotificationMethodsTab,
  readNotificationMethodsTab,
} from "./NotificationMethodsTabQuery";

/*
 * Where a person sets up the ways OneUptime reaches them: User Settings >
 * Notification Methods, and the same page an admin opens on their own row
 * under Users.
 *
 * Slack, Microsoft Teams and Mattermost are only there for the workspaces the
 * project has connected. Adding one is pointing at your own account in a
 * workspace the project is already connected to, so a table for a workspace
 * it never connected was one nobody could add a row to. With none
 * connected, the Workspace Apps tab is not there at all.
 *
 * On a first visit the page waits for that answer (a moment) rather than
 * drawing the tabs and then adding or dropping one under the reader. After
 * that it draws at once from the answer remembered from the last visit.
 */
export function getWorkspaceAppsTab(
  offered: ReadonlyArray<WorkspaceType>,
): Tab | null {
  if (offered.length === 0) {
    return null;
  }

  return {
    name: translationKey("Workspace Apps"),
    children: (
      <div className="space-y-4">
        {offered.includes(WorkspaceType.Slack) ? <UserSlack /> : <></>}
        {offered.includes(WorkspaceType.MicrosoftTeams) ? (
          <UserMicrosoftTeams />
        ) : (
          <></>
        )}
        {offered.includes(WorkspaceType.Mattermost) ? (
          <UserMattermost />
        ) : (
          <></>
        )}
      </div>
    ),
  };
}

/*
 * The server's custom channels, when any is on: ways to reach the person that
 * the admin set up for everyone (CustomChannels). With none, there is no tab.
 */
export function getCustomChannelsTab(
  channels: ReadonlyArray<CustomNotificationChannel>,
): Tab | null {
  if (channels.length === 0) {
    return null;
  }

  return {
    name: translationKey("Custom Channels"),
    children: <UserCustomChannels channels={[...channels]} />,
  };
}

/*
 * The push devices - or, while the server has push turned off, what it says
 * in their place (PushNotificationsTurnedOff): no device can be registered
 * then, and nothing is pushed to the ones there are.
 */
export function getPushNotificationsTab(isPushTurnedOff: boolean): Tab {
  return {
    name: translationKey("Push Notifications"),
    children: isPushTurnedOff ? <PushNotificationsTurnedOff /> : <UserPush />,
  };
}

const NotificationMethodTabs: FunctionComponent = (): ReactElement => {
  const offered: ReadonlyArray<WorkspaceType> | null = getOfferedWorkspaces(
    useWorkspaceConnections(),
  );

  // Waited for like the workspaces, so no tab appears under the reader.
  const customChannels: CustomNotificationChannelsState =
    useCustomNotificationChannels();

  // Waited for too, so the push tab never shows devices and then a notice.
  const isPushTurnedOff: boolean | null = usePushNotificationsTurnedOff();

  if (!offered || !customChannels.channels || isPushTurnedOff === null) {
    return <PageSkeleton />;
  }

  const workspaceAppsTab: Tab | null = getWorkspaceAppsTab(offered);
  const customChannelsTab: Tab | null = getCustomChannelsTab(
    customChannels.channels,
  );

  const tabs: Array<Tab> = [
    {
      name: translationKey("Direct Contact"),
      children: (
        <div className="space-y-4">
          <UserEmail />
          <UserSMS />
          <UserCall />
          <UserWhatsApp />
          <UserTelegram />
        </div>
      ),
    },
    ...(workspaceAppsTab ? [workspaceAppsTab] : []),
    ...(customChannelsTab ? [customChannelsTab] : []),
    getPushNotificationsTab(isPushTurnedOff),
    {
      name: translationKey("Webhooks"),
      children: <UserWebhook />,
    },
  ];

  /*
   * A link that asks for a tab (?tab=push-notifications, from Notification
   * Settings' "Set up" beside a channel) opens on it; a tab that is not here
   * (Workspace Apps in a project with no workspace connected) opens the
   * first. The tab opened goes into the address in place, so a reload or a
   * copied link opens it again; the first tab is the bare address.
   */
  const requestedTab: NotificationMethodsTab | null =
    readNotificationMethodsTab(
      Navigation.getQueryStringByName(NOTIFICATION_METHODS_TAB_QUERY_PARAM),
    );

  return (
    <Tabs
      label="Notification Methods"
      tabs={tabs}
      initialTabName={
        requestedTab ? NOTIFICATION_METHODS_TAB_NAMES[requestedTab] : undefined
      }
      onTabChange={(tab: Tab): void => {
        const opened: NotificationMethodsTab | null =
          getNotificationMethodsTabByName(tab.name);

        if (!opened) {
          return;
        }

        Navigation.setQueryString({
          [NOTIFICATION_METHODS_TAB_QUERY_PARAM]:
            opened === DEFAULT_NOTIFICATION_METHODS_TAB ? null : opened,
        });
      }}
    />
  );
};

export default NotificationMethodTabs;

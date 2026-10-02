import UserCall from "./Call";
import UserEmail from "./Email";
import UserMicrosoftTeams from "./MicrosoftTeams";
import UserPush from "./Push";
import UserSMS from "./SMS";
import UserSlack from "./Slack";
import UserTelegram from "./Telegram";
import UserWebhook from "./Webhook";
import UserWhatsApp from "./WhatsApp";
import {
  getOfferedWorkspaces,
  useWorkspaceConnections,
} from "../../Utils/Workspace/ConnectedWorkspaces";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Where a person sets up the ways OneUptime reaches them: User Settings >
 * Notification Methods, and the same page an admin opens on their own row
 * under Users.
 *
 * Slack and Microsoft Teams are only there for the workspaces the project
 * has connected. Adding either is pointing at your own account in a
 * workspace the project is already connected to, so a table for a workspace
 * it never connected was one nobody could add a row to. With neither
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
    name: "Workspace Apps",
    children: (
      <div className="space-y-4">
        {offered.includes(WorkspaceType.Slack) ? <UserSlack /> : <></>}
        {offered.includes(WorkspaceType.MicrosoftTeams) ? (
          <UserMicrosoftTeams />
        ) : (
          <></>
        )}
      </div>
    ),
  };
}

const NotificationMethodTabs: FunctionComponent = (): ReactElement => {
  const offered: ReadonlyArray<WorkspaceType> | null = getOfferedWorkspaces(
    useWorkspaceConnections(),
  );

  if (!offered) {
    return <PageLoader isVisible={true} />;
  }

  const workspaceAppsTab: Tab | null = getWorkspaceAppsTab(offered);

  const tabs: Array<Tab> = [
    {
      name: "Direct Contact",
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
    {
      name: "Push Notifications",
      children: <UserPush />,
    },
    {
      name: "Webhooks",
      children: <UserWebhook />,
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default NotificationMethodTabs;

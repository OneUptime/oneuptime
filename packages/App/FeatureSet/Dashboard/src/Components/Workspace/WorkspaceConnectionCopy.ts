import PageMap from "../../Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";
import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";

/*
 * What the product says about each chat workspace, in one place: the
 * Workspace overview page, and the Slack and Microsoft Teams pages of every
 * product when the workspace is not connected. Each sentence is whole, so it
 * is looked up as one in the Dashboard's locales.
 */
export interface WorkspaceConnectionCopy {
  name: string;
  // The workspace's mark where an icon goes: a button, a menu.
  icon: IconProp;
  // Its official logo: on its tile on the Workspace page, and when it is not connected.
  logo: ProviderLogo;
  // What connecting it gives you, in a sentence.
  description: string;
  // Where a project connects it: its Project Settings page.
  settingsPage: PageMap;
  connectTitle: string;
  notConnectedTitle: string;
  notConnectedDescription: string;
}

export const WORKSPACE_CONNECTION_COPY: Readonly<
  Record<WorkspaceType, WorkspaceConnectionCopy>
> = {
  [WorkspaceType.Slack]: {
    name: "Slack",
    icon: IconProp.Slack,
    logo: ProviderLogo.Slack,
    description:
      "Post notifications to your Slack channels and act on them from Slack.",
    settingsPage: PageMap.SETTINGS_SLACK_INTEGRATION,
    connectTitle: "Connect Slack",
    notConnectedTitle: "Slack is not connected yet!",
    notConnectedDescription:
      "Connect your Slack workspace to this project, then choose here which notifications are posted to which channels.",
  },
  [WorkspaceType.MicrosoftTeams]: {
    name: "Microsoft Teams",
    icon: IconProp.MicrosoftTeams,
    logo: ProviderLogo.MicrosoftTeams,
    description:
      "Post notifications to your Microsoft Teams channels and chats and act on them from Teams.",
    settingsPage: PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
    connectTitle: "Connect Microsoft Teams",
    notConnectedTitle: "Microsoft Teams is not connected yet!",
    notConnectedDescription:
      "Connect your Microsoft Teams workspace to this project, then choose here which notifications are posted to which channels.",
  },
};

export const WORKSPACE_CONNECTIONS_PAGE_COPY: Readonly<{
  title: string;
  description: string;
  connected: string;
  notConnected: string;
  setUpNotifications: string;
}> = {
  title: "Slack and Microsoft Teams",
  description:
    "Send notifications to the chat tool your team already uses. Connect it once for the whole project and it appears in this menu, where you choose which notifications are posted to which channels.",
  connected: "Connected",
  notConnected: "Not connected",
  setUpNotifications: "Set up notifications",
};

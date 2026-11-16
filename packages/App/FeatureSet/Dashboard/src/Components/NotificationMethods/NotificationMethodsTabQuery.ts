import Dictionary from "Common/Types/Dictionary";

/*
 * WHICH TAB OF NOTIFICATION METHODS A LINK OPENS.
 *
 * User Settings > Notification Methods holds a person's ways to be reached
 * on five tabs (NotificationMethodTabs): Direct Contact (email, SMS, calls,
 * WhatsApp, Telegram), Workspace Apps (Slack, Microsoft Teams, Mattermost),
 * Custom Channels, Push Notifications and Webhooks. A link that sends
 * somebody there to set one up - Notification Settings' "Set up" beside a
 * channel that cannot reach them yet - opens the tab that channel is on, by
 * `?tab=<slug>`, instead of leaving them on Direct Contact to hunt for push.
 *
 * The slug, never the tab's name, is what an address carries: the name is
 * a key the reader sees in their own language. The first tab is the bare
 * address. Kept free of React and of the method lists, so a page that only
 * links here does not load them.
 */

export const NOTIFICATION_METHODS_TAB_QUERY_PARAM: string = "tab";

export enum NotificationMethodsTab {
  DirectContact = "direct-contact",
  WorkspaceApps = "workspace-apps",
  CustomChannels = "custom-channels",
  PushNotifications = "push-notifications",
  Webhooks = "webhooks",
}

/*
 * Each tab by the name NotificationMethodTabs gives it, which is also its
 * English key. NotificationMethodsTabQuery.test.tsx renders the tabs and
 * holds each name here to the tab it opens.
 */
export const NOTIFICATION_METHODS_TAB_NAMES: Readonly<
  Record<NotificationMethodsTab, string>
> = {
  [NotificationMethodsTab.DirectContact]: "Direct Contact",
  [NotificationMethodsTab.WorkspaceApps]: "Workspace Apps",
  [NotificationMethodsTab.CustomChannels]: "Custom Channels",
  [NotificationMethodsTab.PushNotifications]: "Push Notifications",
  [NotificationMethodsTab.Webhooks]: "Webhooks",
};

export const DEFAULT_NOTIFICATION_METHODS_TAB: NotificationMethodsTab =
  NotificationMethodsTab.DirectContact;

// The tab an address asks for, or null for one this build does not know.
export const readNotificationMethodsTab: (
  value: string | null | undefined,
) => NotificationMethodsTab | null = (
  value: string | null | undefined,
): NotificationMethodsTab | null => {
  if (!value) {
    return null;
  }

  return (
    (Object.values(NotificationMethodsTab) as Array<string>).includes(value)
      ? value
      : null
  ) as NotificationMethodsTab | null;
};

// The tab whose name this is, for the tab a reader opened.
export const getNotificationMethodsTabByName: (
  name: string,
) => NotificationMethodsTab | null = (
  name: string,
): NotificationMethodsTab | null => {
  const found: [string, string] | undefined = Object.entries(
    NOTIFICATION_METHODS_TAB_NAMES,
  ).find(([, tabName]: [string, string]): boolean => {
    return tabName === name;
  });

  return found ? (found[0] as NotificationMethodsTab) : null;
};

// The query that opens a tab: none for the first, which is the bare address.
export const getNotificationMethodsTabQuery: (
  tab: NotificationMethodsTab,
) => Dictionary<string> = (tab: NotificationMethodsTab): Dictionary<string> => {
  if (tab === DEFAULT_NOTIFICATION_METHODS_TAB) {
    return {};
  }

  return { [NOTIFICATION_METHODS_TAB_QUERY_PARAM]: tab };
};

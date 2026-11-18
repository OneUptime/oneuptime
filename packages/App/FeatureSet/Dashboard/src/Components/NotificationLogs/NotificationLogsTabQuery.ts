/*
 * WHICH TAB OF NOTIFICATION LOGS A LINK OPENS.
 *
 * Notification Logs keep what the project sent on a tab per channel
 * (NotificationLogsTabs): Email, SMS, WhatsApp, Telegram, Webhook, Call,
 * Push and Workspace. A link that sends somebody there to see what became
 * of one message - the verify dialog's "Open Notification Logs" under a
 * code that has not come (#7374) - opens that message's tab, by
 * `?tab=<slug>`, instead of the Email tab every visit starts on.
 *
 * The slug, never the tab's name, is what an address carries: the name is a
 * key the reader sees in their own language. The first tab is the bare
 * address. Kept free of React and of the log tables, so a page that only
 * links here does not load them.
 */

export const NOTIFICATION_LOGS_TAB_QUERY_PARAM: string = "tab";

export enum NotificationLogsTab {
  Email = "email",
  SMS = "sms",
  WhatsApp = "whatsapp",
  Telegram = "telegram",
  Webhook = "webhook",
  Call = "call",
  Push = "push",
  Workspace = "workspace",
}

/*
 * Each tab by the name NotificationLogsTabs gives it, which is also its
 * English key, in the order it draws them.
 */
export const NOTIFICATION_LOGS_TAB_NAMES: Readonly<
  Record<NotificationLogsTab, string>
> = {
  [NotificationLogsTab.Email]: "Email",
  [NotificationLogsTab.SMS]: "SMS",
  [NotificationLogsTab.WhatsApp]: "WhatsApp",
  [NotificationLogsTab.Telegram]: "Telegram",
  [NotificationLogsTab.Webhook]: "Webhook",
  [NotificationLogsTab.Call]: "Call",
  [NotificationLogsTab.Push]: "Push",
  [NotificationLogsTab.Workspace]: "Workspace",
};

export const DEFAULT_NOTIFICATION_LOGS_TAB: NotificationLogsTab =
  NotificationLogsTab.Email;

// The tab an address asks for, or null for one this build does not know.
export const readNotificationLogsTab: (
  value: string | null | undefined,
) => NotificationLogsTab | null = (
  value: string | null | undefined,
): NotificationLogsTab | null => {
  if (!value) {
    return null;
  }

  return (Object.values(NotificationLogsTab) as Array<string>).includes(value)
    ? (value as NotificationLogsTab)
    : null;
};

// "?tab=sms": what opens a tab, or nothing for the first, the bare address.
export const getNotificationLogsTabQueryString: (
  tab: NotificationLogsTab,
) => string = (tab: NotificationLogsTab): string => {
  if (tab === DEFAULT_NOTIFICATION_LOGS_TAB) {
    return "";
  }

  return `?${NOTIFICATION_LOGS_TAB_QUERY_PARAM}=${tab}`;
};

/*
 * SEND NOTIFICATIONS TO SUBSCRIBERS, A STATUS PAGE'S ONE SWITCH FOR ALL OF
 * ITS SUBSCRIBER MESSAGES (StatusPage.sendSubscriberNotifications, on by
 * default).
 *
 * The channel switches (enableEmailSubscribers and the rest) decide how
 * visitors may sign themselves up, and nothing else: subscribers a page
 * already has keep being told whatever they say. This one decides whether
 * the page tells its subscribers anything at all. Off, the page sends its
 * subscribers nothing - no message about an incident (created, changed,
 * a public note, its postmortem), an episode, scheduled maintenance or an
 * announcement, and no emailed report - however an event is created: the
 * dashboard, the API, Terraform, a workflow, a monitor. The page stays
 * online, its subscribers are kept, and the messages a person asks for
 * themselves (a confirmation link, a link to manage their subscription)
 * still go to them.
 *
 * Every sender asks isSendingSubscriberNotifications of the page it is about
 * to send for, and passes the page over with a reason when it says no. It
 * reads "on" for anything but an explicit false, so a page read without the
 * column keeps notifying, as every page did before the switch existed: a
 * select that forgot the column can never silence a project's subscribers.
 * StatusPageSubscriberService.getStatusPagesToSendNotification selects it
 * for every sender.
 */

// The status page column that holds the switch.
export type SubscriberNotificationsColumn = "sendSubscriberNotifications";

export const SUBSCRIBER_NOTIFICATIONS_COLUMN: SubscriberNotificationsColumn =
  "sendSubscriberNotifications";

// Whether a status page sends its subscribers anything.
export const isSendingSubscriberNotifications: (
  statusPage:
    | { sendSubscriberNotifications?: boolean | null | undefined }
    | null
    | undefined,
) => boolean = (
  statusPage:
    | { sendSubscriberNotifications?: boolean | null | undefined }
    | null
    | undefined,
): boolean => {
  return statusPage?.sendSubscriberNotifications !== false;
};

/*
 * Why a page was passed over, in the words of the delivery record, the
 * scheduled maintenance and announcement status messages and the reports.
 */
export const SUBSCRIBER_NOTIFICATIONS_OFF_TEXT: string =
  "not sent, this status page does not send notifications to its subscribers";

// What a report or a send with nothing to send says.
export const SUBSCRIBER_NOTIFICATIONS_OFF_MESSAGE: string =
  "This status page does not send notifications to its subscribers: Send Notifications to Subscribers is off.";

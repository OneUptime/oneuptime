import Route from "Common/Types/API/Route";
import {
  getNotificationLogStatusWords,
  NOTIFICATION_LOG_FILTER_STATUSES,
  NOTIFICATION_LOG_STATUS_FILTER_OPTIONS,
  NotificationLogKind,
  NotificationLogStatusLine,
  NotificationLogStatusMeaning,
  NotificationLogStatusReading,
  NotificationLogStatusWords,
  readNotificationLogStatusLine,
  readPageNotificationLogStatus,
} from "Common/Types/Notification/NotificationLogStatus";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { PillTone } from "Common/UI/Components/Pill/PillTone";

/*
 * WHAT EVERY STATUS OF EVERY NOTIFICATION LOG MEANS, AS THE DASHBOARD DRAWS
 * IT (#11138, #11416).
 *
 * What each status means - its word, where the message stands and what to
 * say of it - is placed once, in Common (Types/Notification
 * /NotificationLogStatus), where Who Was Told's server reads the same
 * meanings. This is how the Dashboard draws them: each meaning's colour,
 * each log's Status filter, and the docs page that explains them. Every
 * page that says what became of a message draws it with
 * NotificationLogStatusPill: the eight logs, Who Was Told, a test page's
 * result and a person's On-Call Logs.
 */

export {
  getNotificationLogStatusWords,
  NOTIFICATION_LOG_FILTER_STATUSES,
  NotificationLogKind,
  NotificationLogStatusLine,
  NotificationLogStatusMeaning,
  readNotificationLogStatusLine,
  readPageNotificationLogStatus,
};

export type { NotificationLogStatusReading, NotificationLogStatusWords };

/*
 * The colour of where a message stands, as the on-call test page and Who
 * Was Told draw their steps: grey while it is handed over, blue while its
 * provider is still to say how it ended, green once it reached them or
 * nothing more will be said, yellow when nobody answered, red when it did
 * not go.
 */
export const NOTIFICATION_LOG_STATUS_TONES: Readonly<
  Record<NotificationLogStatusMeaning, PillTone>
> = {
  [NotificationLogStatusMeaning.HandedOver]: PillTone.Neutral,
  [NotificationLogStatusMeaning.OnItsWay]: PillTone.Info,
  [NotificationLogStatusMeaning.Reached]: PillTone.Success,
  [NotificationLogStatusMeaning.Done]: PillTone.Success,
  [NotificationLogStatusMeaning.NeedsALook]: PillTone.Warning,
  [NotificationLogStatusMeaning.NotSent]: PillTone.Danger,
  [NotificationLogStatusMeaning.Unknown]: PillTone.Neutral,
};

// A log's Status filter: each status it can hold, named as its pill names it.
export function getNotificationLogStatusFilterOptions(
  kind: NotificationLogKind,
): Array<DropdownOption> {
  return NOTIFICATION_LOG_STATUS_FILTER_OPTIONS[kind];
}

/*
 * The docs page that says what each status of each log means, opened by the
 * View Documentation button on every log's card.
 */
export const NOTIFICATION_LOGS_DOCUMENTATION: Route = Route.fromString(
  "/docs/notifications/notification-logs",
);

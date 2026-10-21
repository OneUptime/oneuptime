import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Send Notifications to Subscribers, the one switch for everything a status
 * page tells its subscribers (StatusPage.sendSubscriberNotifications, see
 * Common/Types/StatusPage/SubscriberNotificationsSwitch). It is the first
 * card on Subscribers -> Subscriber Settings, above the Channels card -
 * which decides how visitors may sign up, and nothing more - and the
 * warning at the top of every subscriber list says when it is off.
 *
 * Kept free of React so the components and their tests read these exact
 * strings. Every string is a whole sentence or a whole name, wrapped in
 * translationKey() so npm run i18n:extract finds it, and translated in all
 * seventeen Dashboard locale files.
 */

export const SUBSCRIBER_NOTIFICATIONS_CARD_TEST_ID: string =
  "status-page-subscriber-notifications";

export const SUBSCRIBER_NOTIFICATIONS_SWITCH_TEST_ID: string =
  "subscriber-notifications-switch";

export const SUBSCRIBER_NOTIFICATIONS_OFF_WARNING_TEST_ID: string =
  "subscriber-notifications-off-warning";

export const SubscriberNotificationsCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  // The warning at the top of the subscriber pages while it is off.
  offWarningTitle: string;
  offWarningDescription: string;
  offWarningLink: string;
} = {
  cardTitle: translationKey("Notifications"),
  cardDescription: translationKey(
    "Whether this status page tells its subscribers about anything at all.",
  ),
  switchTitle: translationKey("Send Notifications to Subscribers"),
  switchOnDescription: translationKey(
    "On: subscribers are told about incidents, scheduled maintenance and announcements, each on the channel they chose.",
  ),
  switchOffDescription: translationKey(
    "Off: subscribers are sent nothing, not even reports. They are kept, and visitors can still subscribe.",
  ),
  offWarningTitle: translationKey(
    "This status page sends its subscribers nothing",
  ),
  offWarningDescription: translationKey(
    "Send Notifications to Subscribers is off, so no subscriber is told about incidents, scheduled maintenance or announcements, and no reports are sent.",
  ),
  offWarningLink: translationKey("Change it in Subscriber Settings"),
};

// The sentence under the switch, for the way it is set.
export const getSubscriberNotificationsDescription: (
  isOn: boolean,
) => string = (isOn: boolean): string => {
  return isOn
    ? SubscriberNotificationsCopy.switchOnDescription
    : SubscriberNotificationsCopy.switchOffDescription;
};

export default SubscriberNotificationsCopy;

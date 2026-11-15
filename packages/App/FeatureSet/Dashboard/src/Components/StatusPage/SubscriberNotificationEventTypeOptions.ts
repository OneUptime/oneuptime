import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A SUBSCRIBER NOTIFICATION TEMPLATE'S EVENT TYPE, IN THE READER'S WORDS
 * (#8179).
 *
 * A template is for one event type, stored by its name ("Subscriber
 * Incident Created"), which the API and Terraform take as they are. Each
 * name is a key of the Dashboard's locales: English reads it as written,
 * so an English reader sees the name the API takes, and every other
 * language words the event ("Vorfall erstellt", "Événement de maintenance
 * créé"). Each is looked up once, where it is drawn, and read alike in the
 * Event Type filters of Notification Templates and of a status page's
 * subscriber settings, the template form's Event Type field, both lists'
 * Event Type cells and a template's own page. A Spanish page used to list
 * "Subscriber Incident Created" in every one of them. The stored values
 * stay as they are.
 */
export const SUBSCRIBER_NOTIFICATION_EVENT_TYPE_LABELS: Record<
  StatusPageSubscriberNotificationEventType,
  string
> = {
  [StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation]:
    translationKey("Subscriber Subscription Confirmation"),
  [StatusPageSubscriberNotificationEventType.SubscriberSubscribed]:
    translationKey("Subscriber Subscribed"),
  [StatusPageSubscriberNotificationEventType.SubscriberManageSubscription]:
    translationKey("Subscriber Manage Subscription"),
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated]:
    translationKey("Subscriber Incident Created"),
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged]:
    translationKey("Subscriber Incident State Changed"),
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated]:
    translationKey("Subscriber Incident Note Created"),
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated]:
    translationKey("Subscriber Incident Note Updated"),
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished]:
    translationKey("Subscriber Incident Postmortem Published"),
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated]:
    translationKey("Subscriber Episode Created"),
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged]:
    translationKey("Subscriber Episode State Changed"),
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated]:
    translationKey("Subscriber Episode Note Created"),
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated]:
    translationKey("Subscriber Episode Note Updated"),
  [StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated]:
    translationKey("Subscriber Announcement Created"),
  [StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated]:
    translationKey("Subscriber Announcement Updated"),
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated]:
    translationKey("Subscriber Scheduled Maintenance Created"),
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged]:
    translationKey("Subscriber Scheduled Maintenance State Changed"),
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated]:
    translationKey("Subscriber Scheduled Maintenance Note Created"),
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated]:
    translationKey("Subscriber Scheduled Maintenance Note Updated"),
  [StatusPageSubscriberNotificationEventType.SubscriberReport]:
    translationKey("Subscriber Report"),
};

// The key an event type is worded by, or null for one this Dashboard does not know.
export function getSubscriberNotificationEventTypeLabel(
  eventType: string | undefined | null,
): string | null {
  return (
    SUBSCRIBER_NOTIFICATION_EVENT_TYPE_LABELS[
      (eventType || "") as StatusPageSubscriberNotificationEventType
    ] || null
  );
}

/*
 * An event type in the reader's words, for a cell or a field to draw as it
 * is. One a newer server added reads as it is stored, never looked up; a
 * template with none reads "Unknown".
 */
export function getSubscriberNotificationEventTypeText(
  translator: Translator,
  eventType: string | undefined | null,
): string {
  if (!eventType) {
    return translator.translateText("Unknown");
  }

  const label: string | null =
    getSubscriberNotificationEventTypeLabel(eventType);

  return label ? translator.translateText(label) : eventType;
}

// Every event type, offered in the words its cells draw it in.
export function getSubscriberNotificationEventTypeOptions(): Array<DropdownOption> {
  return Object.values(StatusPageSubscriberNotificationEventType).map(
    (eventType: StatusPageSubscriberNotificationEventType): DropdownOption => {
      return {
        value: eventType,
        label: SUBSCRIBER_NOTIFICATION_EVENT_TYPE_LABELS[eventType],
      };
    },
  );
}

import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * A subscriber notification template's event type, as a name.
 *
 * "Subscriber Incident Created" is what the API, Terraform and the docs in
 * every language call the event a template is for, so it reads as it is
 * written in every language: in the Event Type filters of Notification
 * Templates and of a status page's subscriber settings, in the template
 * form's Event Type field, and in both lists' Event Type cells - one name,
 * never a word the reader's language has no key for.
 */
export function getSubscriberNotificationEventTypeOptions(): Array<DropdownOption> {
  return Object.values(StatusPageSubscriberNotificationEventType).map(
    (eventType: StatusPageSubscriberNotificationEventType): DropdownOption => {
      return { value: eventType, label: eventType, isUserContent: true };
    },
  );
}

import { NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN } from "Common/Types/StatusPage/NewIncidentSubscriberNotificationDefault";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether "Notify Status Page Subscribers" starts ticked when someone
 * declares an incident (#7606,
 * Common/Types/StatusPage/NewIncidentSubscriberNotificationDefault).
 *
 * Incidents -> Settings -> Subscriber Notifications is one card holding one
 * switch, "Notify status page subscribers by default", that saves its
 * Project column the moment it is flipped (the shared ModelSwitchCard). It
 * is on for every project; only a project owner or admin may flip it, and
 * for anyone else it is locked and says so. No dialog either way: it moves
 * only where the box starts, and whoever declares an incident still decides.
 *
 * Each state says what it means for subscribers in one sentence, and how the
 * person declaring changes it - the box's own name, as Declare New Incident
 * shows it, in quotes, so it reads as the box's label rather than as part of
 * the sentence (as every translation already quotes it).
 *
 * Declare New Incident's box keeps its question. In a project that starts it
 * unticked, the question says so too, under the box and again on the
 * summary, so someone used to a ticked box sees why it is not. There the
 * summary's "No" also has "Change to Yes" beside it: the box sits folded
 * under More fields two steps back, so the review - the last thing read
 * before declaring - is where telling subscribers is one click. It is not
 * offered for a private incident, which no status page shows, nor in a
 * project that starts the box ticked: whoever unticked it there saw it.
 *
 * Kept free of React so the page, the form and App/Tests read these exact
 * strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID: string =
  "incident-notify-subscribers-by-default-switch";

export interface NewIncidentNotifyDefaultSettingCopy {
  // The Project column the switch writes.
  column: typeof NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN;
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  // The data-testid of the switch.
  dataTestId: string;
}

export const NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY: NewIncidentNotifyDefaultSettingCopy =
  {
    column: NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN,
    cardTitle: translationKey("Subscriber Notifications"),
    cardDescription: translationKey(
      "Choose whether “Notify Status Page Subscribers” starts ticked when someone declares an incident.",
    ),
    switchTitle: translationKey("Notify status page subscribers by default"),
    switchOnDescription: translationKey(
      "Status page subscribers are notified of a new incident unless whoever declares it unticks “Notify Status Page Subscribers”.",
    ),
    switchOffDescription: translationKey(
      "Status page subscribers are notified of a new incident only if whoever declares it ticks “Notify Status Page Subscribers”.",
    ),
    dataTestId: NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID,
  };

// Declare New Incident: what the box asks, as it always has.
export const NOTIFY_BOX_DESCRIPTION: string = translationKey(
  "Should status page subscribers be notified when this incident is created?",
);

// The same, in a project that starts the box unticked.
export const NOTIFY_BOX_DESCRIPTION_UNTICKED_BY_DEFAULT: string =
  translationKey(
    "Should status page subscribers be notified when this incident is created? Unticked by default in this project.",
  );

// What the box says under it, for how the project starts it.
export const getNotifyBoxDescription: (isTickedByDefault: boolean) => string = (
  isTickedByDefault: boolean,
): string => {
  return isTickedByDefault
    ? NOTIFY_BOX_DESCRIPTION
    : NOTIFY_BOX_DESCRIPTION_UNTICKED_BY_DEFAULT;
};

/*
 * On the summary, beside "No" in a project that starts the box unticked:
 * ticks it, so the incident is declared notifying. It names the answer it
 * gives - the summary's own "Yes" - rather than an action such as "Notify
 * subscribers", which could read as sending something now.
 */
export const NOTIFY_REVIEW_CHANGE_TO_YES: string =
  translationKey("Change to Yes");

export const NOTIFY_REVIEW_CHANGE_TO_YES_TEST_ID: string =
  "incident-create-notify-subscribers-change-to-yes";

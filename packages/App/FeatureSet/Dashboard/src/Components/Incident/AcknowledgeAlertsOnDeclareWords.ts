import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/Types/Translator";
import { AlertsToAcknowledge } from "Common/Utils/Incident/IncidentFromAlerts";

/*
 * THE WORDS OF THE "ACKNOWLEDGE THE ALERTS" BOX on the create-incident page
 * (AcknowledgeAlertsOnDeclare), when an incident is declared from alerts.
 *
 * Every sentence here is a translation key, drawn through the reader's
 * translator with any count in it written the reader's way (#7513): the box
 * sits in a banner that is in the reader's language. The file imports
 * nothing of the browser - no React, no PermissionGate - so the docs tests
 * draw the very same sentences in each docs language.
 */

/*
 * The label of the box. It names which alerts: every one of them, or only
 * those not acknowledged yet. "Acknowledge this alert" has no count in it,
 * so it is said for exactly one alert (isOneFormOnlyForOne): 21 alerts in
 * Russian, which that language counts as "one", read the general form.
 */
export const ACKNOWLEDGE_EVERY_ALERT_TITLE: PluralTemplate = {
  one: "Acknowledge this alert to stop its escalation",
  other: "Acknowledge these {{count}} alerts to stop their escalation",
};

export const ACKNOWLEDGE_ALERTS_NOT_YET_ACKNOWLEDGED_TITLE: PluralTemplate = {
  one: "Acknowledge the {{count}} alert that is not acknowledged yet, to stop its escalation",
  other:
    "Acknowledge the {{count}} alerts that are not acknowledged yet, to stop their escalation",
};

export const getAcknowledgeAlertsTitle: (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
  translator: Translator,
) => string = (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
  translator: Translator,
): string => {
  const count: number = alertsToAcknowledge.alertIds.length;
  const isEveryAlert: boolean = count >= alertCount;

  return translator.translatePlural(
    isEveryAlert
      ? ACKNOWLEDGE_EVERY_ALERT_TITLE
      : ACKNOWLEDGE_ALERTS_NOT_YET_ACKNOWLEDGED_TITLE,
    count,
  );
};

/*
 * What acknowledging does and does not do - the escalation workers look at
 * the alert's state once a minute, and a page that already went out stays
 * out - said of one alert, or of several.
 */
export const ACKNOWLEDGES_ONE_ALERT_DESCRIPTION: string = translationKey(
  "It is acknowledged as you when the incident is declared, and its own on-call escalation stops within a minute. Pages that already went out are not recalled.",
);

export const ACKNOWLEDGES_ALERTS_DESCRIPTION: string = translationKey(
  "They are acknowledged as you when the incident is declared, and their own on-call escalation stops within a minute. Pages that already went out are not recalled.",
);

// The alerts the box leaves alone: those already acknowledged or resolved.
export const ALREADY_ACKNOWLEDGED_ALERTS: PluralTemplate = {
  one: "{{count}} alert is already acknowledged or resolved and is left as it is.",
  other:
    "{{count}} alerts are already acknowledged or resolved and are left as they are.",
};

/*
 * The box's description: what acknowledging does, which alerts are left
 * alone, and, when the box is locked, why - a reason PermissionGate has
 * already written in the reader's language.
 */
export const getAcknowledgeAlertsDescription: (
  alertsToAcknowledge: AlertsToAcknowledge,
  disabledReason: string | undefined,
  translator: Translator,
) => string = (
  alertsToAcknowledge: AlertsToAcknowledge,
  disabledReason: string | undefined,
  translator: Translator,
): string => {
  const whatItDoes: string =
    alertsToAcknowledge.alertIds.length === 1
      ? ACKNOWLEDGES_ONE_ALERT_DESCRIPTION
      : ACKNOWLEDGES_ALERTS_DESCRIPTION;
  const parts: Array<string> = [
    translator.translateText(whatItDoes) || whatItDoes,
  ];

  const alreadyAcknowledgedCount: number =
    alertsToAcknowledge.alreadyAcknowledgedCount;

  if (alreadyAcknowledgedCount > 0) {
    parts.push(
      translator.translatePlural(
        ALREADY_ACKNOWLEDGED_ALERTS,
        alreadyAcknowledgedCount,
      ),
    );
  }

  if (disabledReason) {
    parts.push(disabledReason);
  }

  return parts.join(" ");
};

/*
 * Shown whenever there are alerts to acknowledge that will NOT be - the box
 * is unticked, locked, or not offered because permissions are unknown - so
 * nobody declares an incident believing the alerts stopped paging. Passive
 * on purpose: with the project's linked-alert switch on, acknowledging the
 * incident later acknowledges the alerts too.
 */
export const THE_ALERT_KEEPS_ESCALATING_NOTE: string = translationKey(
  "Declaring the incident does not acknowledge the alert: it keeps escalating until it is acknowledged.",
);

export const THESE_ALERTS_KEEP_ESCALATING_NOTE: string = translationKey(
  "Declaring the incident does not acknowledge these alerts: they keep escalating until they are acknowledged.",
);

export const ALERTS_NOT_YET_ACKNOWLEDGED_KEEP_ESCALATING_NOTE: PluralTemplate =
  {
    one: "Declaring the incident does not acknowledge the alert that is not acknowledged yet: it keeps escalating until it is acknowledged.",
    other:
      "Declaring the incident does not acknowledge the {{count}} alerts that are not acknowledged yet: they keep escalating until they are acknowledged.",
  };

export const getAlertsKeepEscalatingNote: (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
  translator: Translator,
) => string = (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
  translator: Translator,
): string => {
  const count: number = alertsToAcknowledge.alertIds.length;

  if (count >= alertCount) {
    const note: string =
      count === 1
        ? THE_ALERT_KEEPS_ESCALATING_NOTE
        : THESE_ALERTS_KEEP_ESCALATING_NOTE;

    return translator.translateText(note) || note;
  }

  return translator.translatePlural(
    ALERTS_NOT_YET_ACKNOWLEDGED_KEEP_ESCALATING_NOTE,
    count,
  );
};

/*
 * Appended to the On-Call step's summary when the alerts are being
 * acknowledged and the incident runs no on-call policy of its own, so
 * nobody declares an incident believing someone is still being paged for
 * it. Claims only what acknowledging does: an alert episode escalates on its
 * own, and an incident on-call rule can still add a policy on the server.
 */
export const ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE: string = translationKey(
  "The alerts it is declared from are acknowledged too, so their own escalation stops. An alert episode they belong to keeps escalating until the episode is acknowledged, and an incident on-call rule, if any, may still page.",
);

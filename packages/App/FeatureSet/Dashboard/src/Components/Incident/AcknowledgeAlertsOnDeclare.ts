import { AlertsToAcknowledge } from "Common/Utils/Incident/IncidentFromAlerts";

/*
 * The wording of the "acknowledge the alerts" box on the create-incident page
 * when an incident is declared from alerts. Declaring links the alerts but
 * does not acknowledge them, and only acknowledging an alert stops its
 * on-call escalation, so the page offers to do both at once.
 */

/*
 * The label of the "acknowledge the alerts" box. It names which alerts:
 * every one of them, or only those not acknowledged yet.
 */
type GetAcknowledgeAlertsTitleFunction = (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
) => string;

export const getAcknowledgeAlertsTitle: GetAcknowledgeAlertsTitleFunction = (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
): string => {
  const count: number = alertsToAcknowledge.alertIds.length;

  if (count >= alertCount) {
    return count === 1
      ? "Acknowledge the alert to stop its escalation"
      : "Acknowledge the alerts to stop their escalation";
  }

  return count === 1
    ? "Acknowledge the 1 alert that is not acknowledged yet, to stop its escalation"
    : `Acknowledge the ${count} alerts that are not acknowledged yet, to stop their escalation`;
};

type GetAcknowledgeAlertsDescriptionFunction = (
  alertsToAcknowledge: AlertsToAcknowledge,
  disabledReason: string | undefined,
) => string;

/*
 * What acknowledging does and does not stop - the escalation workers look at
 * the alert's state once a minute; a page that already went out stays out;
 * reminders follow their own rule - and, when the box is locked, why.
 */
export const getAcknowledgeAlertsDescription: GetAcknowledgeAlertsDescriptionFunction =
  (
    alertsToAcknowledge: AlertsToAcknowledge,
    disabledReason: string | undefined,
  ): string => {
    const parts: Array<string> = [
      "They are acknowledged as you once the incident is declared, and their on-call escalation stops within a minute. Pages that already went out are not recalled, and reminders stop only if the alert reminder rule stops them on Acknowledged.",
    ];

    const alreadyAcknowledgedCount: number =
      alertsToAcknowledge.alreadyAcknowledgedCount;

    if (alreadyAcknowledgedCount === 1) {
      parts.push(
        "The alert that is already acknowledged or resolved is left as it is.",
      );
    } else if (alreadyAcknowledgedCount > 1) {
      parts.push(
        `The ${alreadyAcknowledgedCount} alerts that are already acknowledged or resolved are left as they are.`,
      );
    }

    if (disabledReason) {
      parts.push(disabledReason);
    }

    return parts.join(" ");
  };

import Alert from "Common/Models/DatabaseModels/Alert";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { AlertsToAcknowledge } from "Common/Utils/Incident/IncidentFromAlerts";

/*
 * The "acknowledge the alerts" box on the create-incident page, when an
 * incident is declared from alerts. Declaring links the alerts but does not
 * acknowledge them, and only acknowledging an alert stops its own on-call
 * escalation, so the page offers to do both at once.
 */

const ACKNOWLEDGE_GATE_OPTIONS: PermissionGateOptions = {
  verb: "acknowledge",
  singularName: "alert",
};

/*
 * Acknowledging an alert from its own page writes a state timeline row and
 * then moves the alert's current state, which is an alert update - so the
 * server checks both before it accepts the request, and so does the box, in
 * that order. The reason reads "You do not have permission to acknowledge
 * this alert..." rather than naming the timeline model.
 */
export const getAcknowledgeAlertsGate: () => PermissionGateResult =
  (): PermissionGateResult => {
    const timelineGate: PermissionGateResult = PermissionGate.check(
      new AlertStateTimeline(),
      ModelAction.Create,
      ACKNOWLEDGE_GATE_OPTIONS,
    );

    if (!timelineGate.isAllowed) {
      return timelineGate;
    }

    return PermissionGate.check(
      new Alert(),
      ModelAction.Update,
      ACKNOWLEDGE_GATE_OPTIONS,
    );
  };

/*
 * The label of the box. It names which alerts: every one of them, or only
 * those not acknowledged yet.
 */
export const getAcknowledgeAlertsTitle: (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
) => string = (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
): string => {
  const count: number = alertsToAcknowledge.alertIds.length;
  const isEveryAlert: boolean = count >= alertCount;

  if (count === 1) {
    return isEveryAlert
      ? "Acknowledge this alert to stop its escalation"
      : "Acknowledge the 1 alert that is not acknowledged yet, to stop its escalation";
  }

  return isEveryAlert
    ? `Acknowledge these ${count} alerts to stop their escalation`
    : `Acknowledge the ${count} alerts that are not acknowledged yet, to stop their escalation`;
};

/*
 * What acknowledging does and does not do - the escalation workers look at
 * the alert's state once a minute, and a page that already went out stays
 * out - which alerts are left alone, and, when the box is locked, why.
 */
export const getAcknowledgeAlertsDescription: (
  alertsToAcknowledge: AlertsToAcknowledge,
  disabledReason: string | undefined,
) => string = (
  alertsToAcknowledge: AlertsToAcknowledge,
  disabledReason: string | undefined,
): string => {
  const parts: Array<string> = [
    alertsToAcknowledge.alertIds.length === 1
      ? "It is acknowledged as you when the incident is declared, and its own on-call escalation stops within a minute. Pages that already went out are not recalled."
      : "They are acknowledged as you when the incident is declared, and their own on-call escalation stops within a minute. Pages that already went out are not recalled.",
  ];

  const alreadyAcknowledgedCount: number =
    alertsToAcknowledge.alreadyAcknowledgedCount;

  if (alreadyAcknowledgedCount === 1) {
    parts.push(
      "1 alert is already acknowledged or resolved and is left as it is.",
    );
  } else if (alreadyAcknowledgedCount > 1) {
    parts.push(
      `${alreadyAcknowledgedCount} alerts are already acknowledged or resolved and are left as they are.`,
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
export const getAlertsKeepEscalatingNote: (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
) => string = (
  alertsToAcknowledge: AlertsToAcknowledge,
  alertCount: number,
): string => {
  const count: number = alertsToAcknowledge.alertIds.length;

  if (count >= alertCount) {
    return count === 1
      ? "Declaring the incident does not acknowledge the alert: it keeps escalating until it is acknowledged."
      : "Declaring the incident does not acknowledge these alerts: they keep escalating until they are acknowledged.";
  }

  return count === 1
    ? "Declaring the incident does not acknowledge the alert that is not acknowledged yet: it keeps escalating until it is acknowledged."
    : `Declaring the incident does not acknowledge the ${count} alerts that are not acknowledged yet: they keep escalating until they are acknowledged.`;
};

/*
 * Appended to the On-Call step's summary when the alerts are being
 * acknowledged and the incident runs no on-call policy of its own, so
 * nobody declares an incident believing someone is still being paged for
 * it. Claims only what acknowledging does: an alert episode escalates on its
 * own, and an incident on-call rule can still add a policy on the server.
 */
export const ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE: string =
  "The alerts it is declared from are acknowledged too, so their own escalation stops. An alert episode they belong to keeps escalating until the episode is acknowledged, and an incident on-call rule, if any, may still page.";

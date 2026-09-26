import { JSONObject } from "../JSON";
import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";

/*
 * Status page subscribers hear about an incident once, when it is created -
 * but only if it is visible on status pages at that moment. A common routine
 * is to declare an incident hidden, work out who is affected, and then turn
 * 'Visible on Status Page' on. The 'created' notification of such an incident
 * is settled as Skipped (hidden from status pages), so without a way back
 * nobody was ever told.
 *
 * Whether publishing should announce the incident is the editor's call: for a
 * live outage it should, but making an old, resolved incident visible "for the
 * record" must not email everyone about a "new" incident. So it is asked when
 * the incident is published, not decided automatically, and the answer travels
 * with that update request as a misc data prop (like SubscriberUpdateNotification,
 * it is not a column - a stored flag would either stick or have to be reset
 * behind the caller's back). IncidentService turns it into a Pending 'created'
 * notification status, and the Incident:SendNotificationToSubscribers job
 * sends it.
 *
 * API callers keep the route they already had: set
 * subscriberNotificationStatusOnIncidentCreated to Pending.
 *
 * Everything here is shared by the dashboard, which offers the checkbox, the
 * server, which acts on it, and the worker, which writes the skip reason, so
 * they cannot drift apart.
 */

export interface IncidentCreatedRenotifyState {
  subscriberNotificationStatusOnIncidentCreated?:
    | StatusPageSubscriberNotificationStatus
    | undefined
    | null;
  shouldStatusPageSubscribersBeNotifiedOnIncidentCreated?:
    | boolean
    | undefined
    | null;
  isVisibleOnStatusPage?: boolean | undefined | null;
  isPrivate?: boolean | undefined | null;
}

export default class IncidentCreatedRenotify {
  // The misc data prop an update request carries to ask for the notification.
  public static readonly miscDataKey: string =
    "notifySubscribersOfIncidentCreatedOnPublish";

  /*
   * Why the worker skipped the 'created' notification of a hidden incident.
   * The data migration that settled incidents left InProgress by the old
   * worker writes the same text, so both read alike on the dashboard.
   */
  public static readonly hiddenFromStatusPagesMessage: string =
    "Incident is not visible on status pages. Skipping notifications to subscribers.";

  // How the dashboard labels that skip next to the notification status.
  public static readonly hiddenFromStatusPagesLabel: string =
    "Skipped: hidden from status pages";

  public static readonly queuedMessage: string =
    "Incident published on status pages. Subscribers will be notified that this incident was created.";

  public static readonly formFieldTitle: string =
    "Notify subscribers that this incident was created";

  public static readonly formFieldDescription: string =
    "Subscribers were not told about this incident because it was hidden from status pages. Tick this to send them the incident-created notification now. It starts unticked for resolved incidents, so publishing an old incident for the record does not announce it as new.";

  /*
   * Only a real yes counts. The flag arrives over JSON, so accept the string
   * form a hand-written API request might send, and nothing looser: a stray
   * "false" or 1 must never email every subscriber of a status page.
   */
  public static isRequested(
    miscDataProps: JSONObject | undefined | null,
  ): boolean {
    if (!miscDataProps || typeof miscDataProps !== "object") {
      return false;
    }

    const value: unknown = miscDataProps[this.miscDataKey];

    return value === true || value === "true";
  }

  public static getMiscDataProps(): JSONObject {
    return {
      [this.miscDataKey]: true,
    };
  }

  /*
   * Whether publishing this incident may queue its 'created' notification
   * again, given what is stored for it right now:
   *
   * - it is hidden today, so this really is the publish;
   * - its 'created' notification was Skipped. Pending and InProgress are on
   *   their way already (and a Pending send reads the incident when it goes
   *   out, so it will see it visible); Success means subscribers were told;
   *   Failed has its own Retry;
   * - notifying on creation is on. An incident created with notifications
   *   off was deliberately kept quiet, and publishing does not change that;
   * - it is not private. Private incidents are hidden from every status page,
   *   so there is nothing to publish.
   */
  public static canRenotifyOnPublish(
    incident: IncidentCreatedRenotifyState,
  ): boolean {
    return (
      incident.isVisibleOnStatusPage !== true &&
      incident.subscriberNotificationStatusOnIncidentCreated ===
        StatusPageSubscriberNotificationStatus.Skipped &&
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated ===
        true &&
      incident.isPrivate !== true
    );
  }

  /*
   * The checkbox starts ticked while the incident is unresolved - publishing
   * a live incident is the moment its audience should hear about it - and
   * unticked once it is resolved, so making an old incident visible for the
   * record does not announce it as new.
   */
  public static isTickedByDefault(data: {
    isResolved: boolean | undefined | null;
  }): boolean {
    return data.isResolved !== true;
  }

  /*
   * Whether a stored status and message say the 'created' notification was
   * skipped because the incident was hidden from status pages.
   */
  public static isHiddenFromStatusPagesSkip(data: {
    status: StatusPageSubscriberNotificationStatus | undefined | null;
    message: string | undefined | null;
  }): boolean {
    return (
      data.status === StatusPageSubscriberNotificationStatus.Skipped &&
      data.message === this.hiddenFromStatusPagesMessage
    );
  }
}

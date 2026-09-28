import { JSONObject } from "../JSON";
import IncidentScopeAddedPagesNotification from "./IncidentScopeAddedPagesNotification";
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
 * The same goes for status pages added to an incident's scope while it was
 * hidden. Adding a page to a visible incident can tell that page it was
 * created (IncidentScopeAddedPagesNotification), but a hidden incident is not
 * sent anywhere, so a page added then was never told - and once it is in the
 * scope it is no longer "added" by any later edit. So publishing also offers
 * the notification when the incident's scope holds pages its record of told
 * pages (Incident.statusPagesNotifiedOnCreation) does not list. The job then
 * sends it to those pages only.
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
  /*
   * The status pages the incident is limited to, and the job's record of the
   * pages it told (Incident.statusPagesNotifiedOnCreation). Only needed to
   * offer the notification to pages added while the incident was hidden.
   */
  statusPages?: unknown;
  statusPagesNotifiedOnCreation?: unknown;
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

  // The same checkbox, for an incident whose earlier subscribers were told.
  public static readonly untoldStatusPagesFormFieldDescription: string =
    "Some status pages this incident is limited to were never sent the notification that it was created, for example pages added while it was hidden. Tick this to send it to them now. Pages that were already told are not sent it again.";

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
   * - notifying on creation is on. An incident created with notifications
   *   off was deliberately kept quiet, and publishing does not change that;
   * - it is not private. Private incidents are hidden from every status page,
   *   so there is nothing to publish;
   * - and there is someone left to tell. Either its 'created' notification
   *   was Skipped, so nobody was told; or it went out (Success, or Failed
   *   part-way) and the incident is limited to status pages its record does
   *   not list - typically pages added while it was hidden (see
   *   hasUntoldStatusPages). Pending and InProgress are on their way already
   *   (and a Pending send reads the incident when it goes out, so it will see
   *   it visible).
   */
  public static canRenotifyOnPublish(
    incident: IncidentCreatedRenotifyState,
  ): boolean {
    if (
      incident.isVisibleOnStatusPage === true ||
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated !==
        true ||
      incident.isPrivate === true
    ) {
      return false;
    }

    return (
      incident.subscriberNotificationStatusOnIncidentCreated ===
        StatusPageSubscriberNotificationStatus.Skipped ||
      this.hasUntoldStatusPages(incident)
    );
  }

  /*
   * Whether a notification that already went out left status pages of the
   * incident's scope untold: its record exists and misses one of them. Pages
   * added while the incident was hidden land here, as do pages whose send
   * failed. A page in the scope that lists none of the incident's monitors,
   * or does not show incidents, is never told either; offering the checkbox
   * for it sends nothing, and the incident feed says so.
   *
   * An incident without a record is not offered it: its notification went out
   * before the record existed, to every page that listed its monitors (see
   * IncidentScopeAddedPagesNotification).
   */
  public static hasUntoldStatusPages(
    incident: IncidentCreatedRenotifyState,
  ): boolean {
    if (
      incident.subscriberNotificationStatusOnIncidentCreated !==
        StatusPageSubscriberNotificationStatus.Success &&
      incident.subscriberNotificationStatusOnIncidentCreated !==
        StatusPageSubscriberNotificationStatus.Failed
    ) {
      return false;
    }

    const recorded: Array<string> | null =
      IncidentScopeAddedPagesNotification.getRecordedStatusPageIds(
        incident.statusPagesNotifiedOnCreation,
      );

    if (recorded === null) {
      return false;
    }

    return IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
      incident.statusPages,
    ).some((id: string): boolean => {
      return !recorded.includes(id);
    });
  }

  // The checkbox's description, for the case canRenotifyOnPublish found.
  public static getFormFieldDescription(
    incident: IncidentCreatedRenotifyState,
  ): string {
    return incident.subscriberNotificationStatusOnIncidentCreated ===
      StatusPageSubscriberNotificationStatus.Skipped
      ? this.formFieldDescription
      : this.untoldStatusPagesFormFieldDescription;
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

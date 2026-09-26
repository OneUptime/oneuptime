import { JSONObject } from "../JSON";
import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";

/*
 * An incident can be limited to some status pages (Incident.statusPages), and
 * the pages it is limited to often change while it is open: a site turns out
 * to be affected after all, or an incident a monitor created on its own gets
 * scoped once someone works out who is affected. Subscribers of a page hear
 * about an incident once, when it is created, so without a way back a page
 * added later never got the 'created' notification at all.
 *
 * Whether a newly added page should hear about it now is the editor's call,
 * so it is asked when pages are added (the dashboard ticks it by default)
 * rather than decided automatically, and the answer travels with that update
 * as a misc data prop - like SubscriberUpdateNotification and
 * IncidentCreatedRenotify, it is not a column. IncidentService turns it into a
 * Pending 'created' notification, and the Incident:SendNotificationToSubscribers
 * job sends it to the pages in the scope that are not yet listed in
 * Incident.statusPagesNotifiedOnCreation. That record is what keeps the pages
 * that were already told from hearing it twice: the request re-queues the
 * notification, and the record decides who it goes to. So the request never
 * rewrites the record - a page that was never actually told (the send failed,
 * or the incident was hidden) must stay unrecorded so it still gets told.
 *
 * Everything here is shared by the dashboard, which offers the checkbox, and
 * the server, which acts on it, so the two cannot drift apart.
 */

// What an update that adds status pages does to the 'created' notification.
export enum IncidentScopeAddedPagesNotificationAction {
  // Nothing to do: no page was added, or the incident is not to be announced.
  None = "None",
  // Put the 'created' notification back to Pending.
  Queue = "Queue",
  /*
   * It is Pending already. The queued send reads the scope when it goes out,
   * so it reaches the added pages without any change.
   */
  AlreadyQueued = "AlreadyQueued",
  /*
   * It is being sent right now. That send read the old scope, and the job
   * only picks up Pending rows, so re-queueing now would race it. The update
   * is refused with rejectedWhileSendingMessage.
   */
  Reject = "Reject",
}

export interface IncidentScopeAddedPagesNotificationState {
  subscriberNotificationStatusOnIncidentCreated?:
    | StatusPageSubscriberNotificationStatus
    | undefined
    | null;
  shouldStatusPageSubscribersBeNotifiedOnIncidentCreated?:
    | boolean
    | undefined
    | null;
  // Both as they will be once the update is written.
  isVisibleOnStatusPage?: boolean | undefined | null;
  isPrivate?: boolean | undefined | null;
}

export interface StatusPageScopeChange {
  addedStatusPageIds: Array<string>;
  removedStatusPageIds: Array<string>;
}

export default class IncidentScopeAddedPagesNotification {
  // The misc data prop an update request carries to ask for the notification.
  public static readonly miscDataKey: string =
    "notifyAddedStatusPagesOfIncidentCreated";

  public static readonly queuedMessage: string =
    "Status pages were added to this incident. Their subscribers will be sent the notification that this incident was created.";

  public static readonly rejectedWhileSendingMessage: string =
    "Subscribers are being sent the notification that this incident was created right now, so it cannot also be queued for the status pages you added. Try again in a minute, or save without 'Send the incident-created notification to newly added pages'.";

  public static readonly formFieldTitle: string =
    "Send the incident-created notification to newly added pages";

  public static readonly formFieldDescription: string =
    "Subscribers of the status pages you add are sent the notification that this incident was created. Pages that were already told are not sent it again.";

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
   * The status page ids in any shape a status page list arrives in - a model,
   * a {_id} or {id} object, an ObjectID or a bare string - lower-cased (the
   * database reads uuids back lower-cased) and without duplicates, in the
   * order first seen.
   */
  public static normalizeStatusPageIds(value: unknown): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    const entries: Array<unknown> = Array.isArray(value) ? value : [value];
    const ids: Array<string> = [];

    for (const entry of entries) {
      const id: string | undefined = this.getStatusPageId(entry);

      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  // Which pages a change of the scope from `before` to `after` adds and removes.
  public static getScopeChange(data: {
    before: unknown;
    after: unknown;
  }): StatusPageScopeChange {
    const before: Array<string> = this.normalizeStatusPageIds(data.before);
    const after: Array<string> = this.normalizeStatusPageIds(data.after);

    return {
      addedStatusPageIds: after.filter((id: string) => {
        return !before.includes(id);
      }),
      removedStatusPageIds: before.filter((id: string) => {
        return !after.includes(id);
      }),
    };
  }

  /*
   * What adding `addedStatusPageIds` to an incident's scope does to its
   * 'created' notification, given where that notification is:
   *
   * - no page added: nothing, whatever else the update does;
   * - notifying on creation is off: nothing. An incident declared with
   *   notifications off was deliberately kept quiet, and scoping it does not
   *   change that;
   * - hidden from status pages or private once the update is written:
   *   nothing. The job would only skip it again; publishing the incident has
   *   its own way to announce it (IncidentCreatedRenotify);
   * - Success, Skipped or Failed: queue it again. The job then sends it to the
   *   pages in the scope it has no record of telling - the added pages, plus,
   *   after a failure, the pages the failed send did not reach;
   * - Pending: already queued, and the queued send reads the new scope;
   * - InProgress: refuse, rather than race the send that is running.
   */
  public static getAction(data: {
    addedStatusPageIds: Array<string>;
    incident: IncidentScopeAddedPagesNotificationState;
  }): IncidentScopeAddedPagesNotificationAction {
    if (data.addedStatusPageIds.length === 0) {
      return IncidentScopeAddedPagesNotificationAction.None;
    }

    const incident: IncidentScopeAddedPagesNotificationState = data.incident;

    if (
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated !== true
    ) {
      return IncidentScopeAddedPagesNotificationAction.None;
    }

    // A null visibility is hidden to the job, so it is here too.
    if (
      incident.isVisibleOnStatusPage !== true ||
      incident.isPrivate === true
    ) {
      return IncidentScopeAddedPagesNotificationAction.None;
    }

    switch (incident.subscriberNotificationStatusOnIncidentCreated) {
      case StatusPageSubscriberNotificationStatus.Pending:
        return IncidentScopeAddedPagesNotificationAction.AlreadyQueued;
      case StatusPageSubscriberNotificationStatus.InProgress:
        return IncidentScopeAddedPagesNotificationAction.Reject;
      default:
        /*
         * Success, Skipped and Failed - and a missing status, which the
         * column's Pending default makes impossible but which would otherwise
         * never be sent.
         */
        return IncidentScopeAddedPagesNotificationAction.Queue;
    }
  }

  private static getStatusPageId(entry: unknown): string | undefined {
    if (!entry) {
      return undefined;
    }

    let id: unknown = entry;

    if (typeof entry === "object") {
      const relation: {
        _id?: unknown;
        id?: unknown;
        _type?: unknown;
        value?: unknown;
      } = entry as {
        _id?: unknown;
        id?: unknown;
        _type?: unknown;
        value?: unknown;
      };

      // A model, an ObjectID, a {_id}/{id} object or a serialized ObjectID.
      if (relation._id !== undefined && relation._id !== null) {
        id = relation._id;
      } else if (relation.id !== undefined && relation.id !== null) {
        id = relation.id;
      } else if (relation._type === "ObjectID" && relation.value) {
        id = relation.value;
      }
    }

    if (typeof id !== "string" && typeof id !== "object") {
      return undefined;
    }

    const text: string = String(id).trim().toLowerCase();

    if (!text || text === "[object object]") {
      return undefined;
    }

    return text;
  }
}

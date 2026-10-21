import { JSONObject } from "../JSON";
import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";
import StatusPageVisibility from "./StatusPageVisibility";

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
 * notification, and the record decides who it goes to.
 *
 * The record only exists once the job has settled a send, so two cases have
 * none, and each is handled so that only the pages the edit adds are told:
 *
 * - the notification went out before the record existed (an incident from an
 *   earlier release, Success or Failed with no record). It reached every page
 *   that listed the incident's monitors back then, so there is no way to tell
 *   an added page from one that was told, and nothing is queued. An empty
 *   record would otherwise read as "nobody was told" and announce the incident
 *   a second time;
 * - the notification was Skipped and never sent (published without
 *   announcing it, or declared without monitors). The pages the incident was
 *   limited to before the edit were deliberately not told, so the update
 *   writes them in as the record when it queues the notification (see
 *   getRecordToSeedOnQueue): the job then tells the added pages only, not the
 *   pages the editor chose not to announce it on.
 *
 * Everything here is shared by the dashboard, which offers the checkbox, and
 * the server, which acts on it, so the two cannot drift apart: the dashboard
 * offers the checkbox exactly when getAction would queue.
 */

// What an update that adds status pages does to the 'created' notification.
export enum IncidentScopeAddedPagesNotificationAction {
  /*
   * Nothing to do: no page was added, every added page was told already, or
   * the incident is not to be announced.
   */
  None = "None",
  // Put the 'created' notification back to Pending.
  Queue = "Queue",
  /*
   * It is Pending, or being sent right now. A queued send reads the scope
   * when it goes out, and a send that is running reads it again once it has
   * finished and queues itself once more for any page added meanwhile, so the
   * added pages are reached without any change here. IncidentService checks
   * once the update is written, in case the send finished in between.
   */
  AlreadyQueued = "AlreadyQueued",
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
  /*
   * Incident.statusPagesNotifiedOnCreation as stored: the pages the job has a
   * record of telling. Null or undefined when it has none (see the header).
   */
  statusPagesNotifiedOnCreation?: unknown;
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

  /*
   * The status the job leaves when pages were added to the scope while it was
   * sending: queued again, for the pages it had not reached.
   */
  public static readonly addedWhileSendingMessage: string =
    "Status pages were added to this incident while its subscribers were being sent the notification that it was created. The added pages will be sent it next.";

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
   * The pages Incident.statusPagesNotifiedOnCreation lists, or null when there
   * is no record: never written (the job has not settled a send since the
   * record was introduced), or not a list.
   */
  public static getRecordedStatusPageIds(value: unknown): Array<string> | null {
    if (!Array.isArray(value)) {
      return null;
    }

    return this.normalizeStatusPageIds(value);
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
   *   nothing. The job would only skip it again. Publishing the incident
   *   offers to announce it to the pages that were not told
   *   (IncidentCreatedRenotify.canRenotifyOnPublish), including pages added
   *   while it was hidden;
   * - every added page is in the record: nothing, they were told already
   *   (a page removed earlier and added back, or an unscoped incident being
   *   narrowed to pages it reached);
   * - Success or Failed with no record: nothing. It went out before the
   *   record existed, to every page that listed the monitors then (see the
   *   header);
   * - Success, Skipped or Failed otherwise: queue it again. The job then
   *   sends it to the pages in the scope it has no record of telling - the
   *   added pages, plus, after a failure, the pages the failed send did not
   *   reach;
   * - Pending or InProgress: already on its way, and it reaches the added
   *   pages (see AlreadyQueued).
   */
  public static getAction(data: {
    addedStatusPageIds: Array<string>;
    incident: IncidentScopeAddedPagesNotificationState;
  }): IncidentScopeAddedPagesNotificationAction {
    const addedStatusPageIds: Array<string> = this.normalizeStatusPageIds(
      data.addedStatusPageIds,
    );

    if (addedStatusPageIds.length === 0) {
      return IncidentScopeAddedPagesNotificationAction.None;
    }

    const incident: IncidentScopeAddedPagesNotificationState = data.incident;

    if (
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated !== true
    ) {
      return IncidentScopeAddedPagesNotificationAction.None;
    }

    /*
     * Shown on status pages, by the one rule the job reads too
     * (StatusPageVisibility): a null visibility is hidden, and a private
     * incident is hidden whatever its switch says.
     */
    if (!StatusPageVisibility.isShown(incident)) {
      return IncidentScopeAddedPagesNotificationAction.None;
    }

    const status: StatusPageSubscriberNotificationStatus | undefined | null =
      incident.subscriberNotificationStatusOnIncidentCreated;

    const recorded: Array<string> | null = this.getRecordedStatusPageIds(
      incident.statusPagesNotifiedOnCreation,
    );

    if (recorded === null) {
      if (
        status === StatusPageSubscriberNotificationStatus.Success ||
        status === StatusPageSubscriberNotificationStatus.Failed
      ) {
        return IncidentScopeAddedPagesNotificationAction.None;
      }
    } else if (
      addedStatusPageIds.every((id: string): boolean => {
        return recorded.includes(id);
      })
    ) {
      return IncidentScopeAddedPagesNotificationAction.None;
    }

    switch (status) {
      case StatusPageSubscriberNotificationStatus.Pending:
      case StatusPageSubscriberNotificationStatus.InProgress:
        return IncidentScopeAddedPagesNotificationAction.AlreadyQueued;
      default:
        /*
         * Success, Skipped and Failed - and a missing status, which the
         * column's Pending default makes impossible but which would otherwise
         * never be sent.
         */
        return IncidentScopeAddedPagesNotificationAction.Queue;
    }
  }

  /*
   * The record an update that queues the notification (action Queue) has to
   * write along with it, or undefined when the stored record stands.
   *
   * With a record, the job already knows who was told. Without one the
   * notification was never sent (getAction does not queue a Success or
   * Failed one without a record), so the pages the incident was limited to
   * before the update were deliberately not told - it was published without
   * announcing it, or declared without monitors. They are written in as the
   * record, so the job tells only the pages the update adds. An incident
   * that was not limited to any page before has nothing to leave out: every
   * page it is now limited to is one the update adds.
   */
  public static getRecordToSeedOnQueue(data: {
    statusPagesNotifiedOnCreation: unknown;
    statusPageIdsBeforeUpdate: unknown;
  }): Array<string> | undefined {
    if (this.getRecordedStatusPageIds(data.statusPagesNotifiedOnCreation)) {
      return undefined;
    }

    return this.normalizeStatusPageIds(data.statusPageIdsBeforeUpdate);
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

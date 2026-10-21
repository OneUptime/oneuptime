import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import { KEPT_STATUS_HISTORY_DAYS } from "../../Types/StateTimeline/RowsKeptOnDelete";

/*
 * DELETING ONE STATUS EVENT OF A MONITOR, BY ITS ID.
 *
 * Someone correcting a monitor's history: "it was never Offline at 3pm".
 * The event goes, and the event before it runs on over its time, so the
 * status at every moment stays known:
 *
 *   - the newest event: the one before it becomes the current status again;
 *   - an event in the middle: the one before it runs on up to the start of
 *     the one after it. The one after it keeps its start: it is when that
 *     status really began. (This used to also move the next event back to
 *     the deleted one's start, so the two covered the deleted span twice and
 *     a day's uptime could add up to more than all of it.)
 *
 * Two deletes are refused, because no event is left to take the time:
 *
 *   - the monitor's only event: the monitor would have no status at all, and
 *     status pages would show it gray;
 *   - the monitor's oldest event while it still covers part of the last
 *     KEPT_STATUS_HISTORY_DAYS days: that time would be left with no status.
 *     Once it ended before that, it can go: the history then begins with the
 *     event after it, outside anything a page draws.
 *
 * A delete that names its events by a query is a clean-up, not a
 * correction: it moves no event, and DatabaseService has already narrowed it
 * to the events that are over (Types/StateTimeline/RowsKeptOnDelete).
 *
 * Shared: the service refuses with these rules (MonitorStatusTimelineService
 * onBeforeDelete), and the monitor's Status Timeline page locks Delete on the
 * one event they would refuse (getLockedOldestEvent), saying why - in the
 * same words, so the API, a workflow step's error, the page's tooltip and a
 * bulk Delete's list of what it skipped all read alike. Each says the rule,
 * what would go gray, and what to do instead.
 */

// Why a delete of one status event is refused.
export enum StatusEventDeleteRefusal {
  OnlyEvent = "OnlyEvent",
  OldestInKeptHistory = "OldestInKeptHistory",
}

export const ONLY_STATUS_EVENT_MESSAGE: string =
  "The monitor's only status event can't be deleted: the monitor would have no status, and status pages would show it gray. To change its status, add a new status event.";

/*
 * The Dashboard's translation key, with {{days}} for KEPT_STATUS_HISTORY_DAYS.
 * The way round the refusal is to add an event that starts BEFORE this one -
 * this one then has an event before it to take its time, so it can go. Not
 * "at the same time": the Dashboard's Starts At field is to the minute, and
 * an event's start rarely is.
 */
export const OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_TEMPLATE: string =
  "The monitor's oldest status event can't be deleted while it covers part of the last {{days}} days: status pages would show that time gray. To replace it, add a status event that starts before it, then delete this one.";

export const OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE: string =
  OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_TEMPLATE.split("{{days}}").join(
    String(KEPT_STATUS_HISTORY_DAYS),
  );

export interface StatusEventInTimeline {
  startsAt?: Date | undefined;
  endsAt?: Date | null | undefined;
}

export interface StatusEventDeleteFacts {
  // The event deleted.
  event: StatusEventInTimeline;
  // The event before it: the latest other one that starts at or before it.
  before: (StatusEventInTimeline & { id: ObjectID }) | null;
  // The event after it: the first one that starts later.
  after: StatusEventInTimeline | null;
  // How many events the monitor has, this one included.
  eventCount: number;
  now: Date;
}

export type StatusEventDeleteDecision =
  | {
      // Refused: no event is left to take the time.
      kind: "refuse";
      refusal: StatusEventDeleteRefusal;
      message: string;
    }
  | {
      // The oldest event, over before the kept history: the history starts later.
      kind: "history-starts-later";
    }
  | {
      // The event before it runs on: its end becomes `endsAt` (null: it is current again).
      kind: "previous-runs-on";
      previousId: ObjectID;
      endsAt: Date | null;
    };

export default class MonitorStatusEventDelete {
  public static decide(
    facts: StatusEventDeleteFacts,
  ): StatusEventDeleteDecision {
    if (facts.eventCount <= 1) {
      return {
        kind: "refuse",
        refusal: StatusEventDeleteRefusal.OnlyEvent,
        message: ONLY_STATUS_EVENT_MESSAGE,
      };
    }

    if (!facts.before) {
      /*
       * Until when the oldest event is in effect: its end, or - open, an
       * orphan a race left - the start of the event after it, as every
       * reader caps it. Neither means it runs on: refused as in effect.
       */
      const inEffectUntil: Date | null =
        facts.event.endsAt || facts.after?.startsAt || null;

      /*
       * The oldest moment kept, as a delete by query reads it
       * (StateTimelineRowsKept): an event that ends after it covers part of
       * the kept history. Compared to the millisecond, as Postgres compares.
       */
      const keptFrom: Date = OneUptimeDate.addRemoveDays(
        facts.now,
        -KEPT_STATUS_HISTORY_DAYS,
      );

      if (
        !inEffectUntil ||
        new Date(inEffectUntil).getTime() > keptFrom.getTime()
      ) {
        return {
          kind: "refuse",
          refusal: StatusEventDeleteRefusal.OldestInKeptHistory,
          message: OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
        };
      }

      return { kind: "history-starts-later" };
    }

    if (!facts.after) {
      /*
       * The newest event: the one before it takes over where it ended - on,
       * as the monitor's current status, when it was still open.
       */
      return {
        kind: "previous-runs-on",
        previousId: facts.before.id,
        endsAt: facts.event.endsAt || null,
      };
    }

    // In the middle: the one before it runs on up to the start of the one after it.
    return {
      kind: "previous-runs-on",
      previousId: facts.before.id,
      endsAt: facts.after.startsAt || facts.event.endsAt || null,
    };
  }

  /*
   * For a page that lists a monitor's status events: the one event a delete
   * by its id would refuse, and why - or null when every event can go. Only
   * the oldest event can be refused (its only event is its oldest), so the
   * page needs no more than the monitor's two oldest events, oldest first,
   * and how many it has.
   *
   * Two events that start at the same moment are each the other's "before",
   * as the service reads them, so neither is refused as the oldest.
   */
  public static getLockedOldestEvent(data: {
    oldestEvents: Array<StatusEventInTimeline & { id: string }>;
    eventCount: number;
    now: Date;
  }): { eventId: string; refusal: StatusEventDeleteRefusal } | null {
    const oldest: (StatusEventInTimeline & { id: string }) | undefined =
      data.oldestEvents[0];

    if (!oldest || data.eventCount < 1) {
      return null;
    }

    const next: (StatusEventInTimeline & { id: string }) | null =
      data.oldestEvents[1] || null;

    const startsWithIt: boolean = Boolean(
      next &&
        next.startsAt &&
        oldest.startsAt &&
        new Date(next.startsAt).getTime() ===
          new Date(oldest.startsAt).getTime(),
    );

    if (startsWithIt && data.eventCount > 1) {
      return null;
    }

    const decision: StatusEventDeleteDecision = MonitorStatusEventDelete.decide(
      {
        event: oldest,
        before: null,
        after: next,
        eventCount: data.eventCount,
        now: data.now,
      },
    );

    return decision.kind === "refuse"
      ? { eventId: oldest.id, refusal: decision.refusal }
      : null;
  }
}

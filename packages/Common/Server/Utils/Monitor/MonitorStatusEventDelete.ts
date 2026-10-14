import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { KEPT_STATUS_HISTORY_DAYS } from "../../../Types/StateTimeline/RowsKeptOnDelete";

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
 *     status pages would show it grey;
 *   - the monitor's oldest event while it still covers part of the last
 *     KEPT_STATUS_HISTORY_DAYS days: that time would be left with no status.
 *     Once it ended before that, it can go: the history then begins with the
 *     event after it, outside anything a page draws.
 *
 * A delete that names its events by a query is a clean-up, not a
 * correction: it moves no event, and DatabaseService has already narrowed it
 * to the events that are over (Types/StateTimeline/RowsKeptOnDelete).
 */

export const ONLY_STATUS_EVENT_MESSAGE: string =
  "This is the monitor's only status event, so it can't be deleted: the monitor would be left with no status, and status pages would show it grey. To change the monitor's status, add a new status event.";

export const OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE: string = `This is the monitor's oldest status event and it covers part of the last ${KEPT_STATUS_HISTORY_DAYS} days, so it can't be deleted: that time would be left with no status, and status pages would show it grey. To change the status for that time, add a status event with the same start, then delete this one.`;

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
  public static decide(facts: StatusEventDeleteFacts): StatusEventDeleteDecision {
    if (facts.eventCount <= 1) {
      return { kind: "refuse", message: ONLY_STATUS_EVENT_MESSAGE };
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
}

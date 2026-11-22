import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { DETECTION_LATE_EVENT_WINDOW_IN_MINUTES } from "../../../Types/SecurityEvent/DetectionFindingConstants";
import {
  QualifiedColumn,
  SQL,
  Statement,
  StatementParameter,
} from "../AnalyticsDatabase/Statement";

/*
 * WHAT A RUN OF A RULE JUDGES, BY WHEN IT ARRIVED.
 *
 * A rule that counts (Types/SecurityEvent/RealTimeDetection) reads a window
 * of its interval as it stood when the events it judges came in, and keeps
 * a group only when those events are what brought it to the threshold: one
 * of them is among the group's matches, and with only what came in before
 * them the group had not reached it. A burst fires once, on the events that
 * make the count; a late event that makes it fires too; and a group past it
 * stays quiet until the next window. Two kinds of run judge events so:
 *
 *  - A real-time run judges the events one write handed it, by id: ids are
 *    time-ordered (UUIDv7, made as each row is built), so a later id came
 *    in later, and the window as it stood is the events with an id no later
 *    than the write's last.
 *  - A scheduled run judges every event that arrived since the rule's last
 *    run (#10337): createdAt, stamped as each row is built, after the
 *    rule's last run and no later than this one. An event that happened
 *    long before it reached OneUptime - a batch a shipper held, a span that
 *    ended a minute after it started, a flow read in whole windows - is
 *    judged by the first run after it arrived, once, with the events of the
 *    window it happened in.
 *
 * A scheduled hunt counts what arrived the same way (#10488): its search,
 * read as the person it runs as, carries its run's range under
 * SECURITY_EVENT_ARRIVAL_QUERY_KEY, which the statement generator compiles
 * with isDetectionArrivalCandidate below - the one condition both read by.
 *
 * Kept apart from SecurityEventService, which re-exports all of it, so the
 * statement generator reads it without loading a service.
 */
export interface DetectionWriteArrival {
  kind?: "write" | undefined;
  // The write's events, by id.
  candidateIds: Array<string>;
  // The lowest and the highest of them.
  firstId: string;
  lastId: string;
  // When they happened, at most: the groups they name are read there.
  candidateStartTime: Date;
  candidateEndTime: Date;
}

export interface DetectionRunArrival {
  kind: "run";
  // What the rule's last run judged: everything that arrived by then. Exclusive.
  arrivedAfter: Date;
  // What this run judges up to. Inclusive.
  arrivedUntil: Date;
  // When the events it judges happened, at most: the groups they name are read there.
  candidateStartTime: Date;
  candidateEndTime: Date;
}

/*
 * How long before it arrived an event a scheduled run judges may have
 * happened (DETECTION_LATE_EVENT_WINDOW_IN_MINUTES), held to each event:
 * one that reached OneUptime later than that is stored and searchable, and
 * Run on Past Events reads it, but no run judges it.
 */
export const DETECTION_RUN_LATE_EVENT_SECONDS: number =
  DETECTION_LATE_EVENT_WINDOW_IN_MINUTES * 60;

export type DetectionArrivalRead = DetectionWriteArrival | DetectionRunArrival;

/*
 * How a read names the table's columns: as written (a service's own
 * statement), or through the statement generator's reference - a column of
 * the table under its alias, where a select's own alias of the same name
 * would otherwise stand in for it.
 */
export type DetectionArrivalColumnRef = (
  columnName: string,
) => string | QualifiedColumn;

// The window as it stood when the events judged came in.
export function detectionArrivedBy(arrival: DetectionArrivalRead): Statement {
  if (arrival.kind === "run") {
    return SQL`createdAt <= ${{
      type: TableColumnType.Date,
      value: arrival.arrivedUntil,
    }}`;
  }

  return SQL`_id <= ${{
    type: TableColumnType.Text,
    value: arrival.lastId,
  }}`;
}

// What had come in before them: judged already.
export function detectionArrivedBefore(
  arrival: DetectionArrivalRead,
): Statement {
  if (arrival.kind === "run") {
    return SQL`createdAt <= ${{
      type: TableColumnType.Date,
      value: arrival.arrivedAfter,
    }}`;
  }

  return SQL`_id < ${{
    type: TableColumnType.Text,
    value: arrival.firstId,
  }}`;
}

/*
 * One of the events judged: for a run, one that arrived in it, within a day
 * of when it happened. `columnRef` names the columns through the statement
 * generator's reference; without it they are written as they are.
 */
export function isDetectionArrivalCandidate(
  arrival: DetectionArrivalRead,
  columnRef?: DetectionArrivalColumnRef | undefined,
): Statement {
  if (arrival.kind === "run") {
    const arrivedAfter: StatementParameter = {
      type: TableColumnType.Date,
      value: arrival.arrivedAfter,
    };
    const arrivedUntil: StatementParameter = {
      type: TableColumnType.Date,
      value: arrival.arrivedUntil,
    };
    const lateSeconds: StatementParameter = {
      type: TableColumnType.Number,
      value: DETECTION_RUN_LATE_EVENT_SECONDS,
    };

    if (columnRef) {
      return SQL`(${columnRef("createdAt")} > ${arrivedAfter} AND ${columnRef(
        "createdAt",
      )} <= ${arrivedUntil} AND ${columnRef("time")} >= ${columnRef(
        "createdAt",
      )} - toIntervalSecond(${lateSeconds}))`;
    }

    return SQL`(createdAt > ${arrivedAfter} AND createdAt <= ${arrivedUntil} AND time >= createdAt - toIntervalSecond(${lateSeconds}))`;
  }

  if (columnRef) {
    return SQL`has(${{
      type: TableColumnType.ArrayText,
      value: arrival.candidateIds,
    }}, ${columnRef("_id")})`;
  }

  return SQL`has(${{
    type: TableColumnType.ArrayText,
    value: arrival.candidateIds,
  }}, _id)`;
}

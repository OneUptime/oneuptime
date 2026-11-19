import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS } from "../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SECURITY_DETECTION_MATCHED_EVENTS_MAX,
  SecurityDetectionMatchedEvent,
  SecurityDetectionMatchedEvents,
  buildSecurityDetectionMatchedEvent,
  keepSecurityDetectionMatchedEvents,
} from "../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import SecurityEventService from "../../Services/SecurityEventService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE EVENTS A DETECTION MATCHED, READ AS IT FIRES (#9619).
 *
 * The source that fires a detection - a rule's run, a feed's check - knows
 * exactly what it counted: its condition, its window, its exceptions and
 * its bounds. Before its detections go to their cases (SecurityCaseIngest),
 * it reads the events behind each group it opens through here, so the case
 * keeps them (Types/SecurityCase/SecurityDetectionMatchedEvents): the
 * earliest SECURITY_DETECTION_MATCHED_EVENTS_MAX of each group, and how far
 * the requests of all of them got.
 *
 * Two bounded reads for all the groups of a run, whatever their number -
 * the events, at most that many of each group (LIMIT n BY), and their
 * request outcomes, counted by group - each held to a time limit. A read
 * that fails keeps nothing: the detection is recorded as it always was, and
 * its case reads its events again when it is viewed. Never throws.
 *
 * As OneUptime, not as a person: what is kept is checked against each
 * reader's access when a case shows it.
 */

// How long one of the reads may take: a run is waiting.
export const MATCHED_EVENTS_READ_TIME_LIMIT_IN_SECONDS: number = 30;

// The SELECT alias of the group an event is kept under.
const GROUP_ALIAS: string = "keptGroup";

export interface MatchedEventsRead {
  projectId: ObjectID;
  // The window the source read: from `start`, up to but not including `end`.
  start: Date;
  end: Date;
  // What the events matched, beside the project and the window.
  condition: Statement;
  /*
   * The group each event is counted under, as the source groups them (a
   * rule's Group By Field); null for a source that counts its matches as
   * one group, kept under "".
   */
  groupExpression: Statement | null;
  // The groups whose events are kept: the ones that fired.
  groupValues: Array<string>;
  /*
   * Group by each of an event's observables, lower-cased, as a threat
   * intel feed's indicators are matched (ThreatIntelIndicatorService):
   * the event is kept under each indicator it carries. Takes the place of
   * groupExpression.
   */
  groupByObservable?: boolean | undefined;
  // Event classes the source never reads, such as its own Detection Findings.
  excludeClassUids?: Array<number> | undefined;
}

// The group expression of a read: what each event is kept under.
function getGroupExpression(read: MatchedEventsRead): Statement {
  if (read.groupByObservable) {
    return SQL`lowerUTF8(keptObservable)`;
  }

  return read.groupExpression || SQL`''`;
}

// The FROM and the WHERE both reads share.
export function buildMatchedEventsFromWhere(
  read: MatchedEventsRead,
): Statement {
  const statement: Statement = new Statement();

  statement.append(` FROM ${AnalyticsTableName.SecurityEvent}`);

  if (read.groupByObservable) {
    statement.append(" ARRAY JOIN observables AS keptObservable");
  }

  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: read.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: read.start,
    }} AND time < ${{
      type: TableColumnType.DateTime64,
      value: read.end,
    }} AND (`,
  );
  statement.append(read.condition);
  statement.append(")");

  for (const classUid of read.excludeClassUids || []) {
    // The code's own numbers, appended as text (SQL`` binds a string as an identifier).
    statement.append(` AND classUid != ${String(Math.trunc(classUid))}`);
  }

  if (read.groupExpression || read.groupByObservable) {
    statement.append(
      SQL` AND has(${{
        type: TableColumnType.ArrayText,
        value: read.groupValues,
      }}, `,
    );
    statement.append(getGroupExpression(read));
    statement.append(")");
  }

  return statement;
}

/*
 * The events, the earliest of each group first: at most `limitPerGroup` of
 * each, with when the events table deletes them.
 */
export function buildMatchedEventsStatement(data: {
  read: MatchedEventsRead;
  limitPerGroup: number;
}): Statement {
  const limit: number = Math.max(1, Math.trunc(data.limitPerGroup));
  const statement: Statement = new Statement();

  statement.append(
    `SELECT ${[...SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS, "retentionDate"].join(", ")}, `,
  );
  statement.append(getGroupExpression(data.read));
  statement.append(` AS ${GROUP_ALIAS}`);
  statement.append(buildMatchedEventsFromWhere(data.read));
  statement.append(
    SQL` ORDER BY time ASC LIMIT ${{
      type: TableColumnType.Number,
      value: limit,
    }}`,
  );
  // The code's own alias, appended as text (SQL`` binds a string as an identifier).
  statement.append(` BY ${GROUP_ALIAS}`);
  statement.append(
    SQL` LIMIT ${{
      type: TableColumnType.Number,
      value: limit * Math.max(1, data.read.groupValues.length),
    }}`,
  );
  statement.append(
    getQuerySettings({
      maxExecutionTimeInSeconds: MATCHED_EVENTS_READ_TIME_LIMIT_IN_SECONDS,
      timeoutOverflowMode: "throw",
    }),
  );

  return statement;
}

// How many of each group's events took each request outcome.
export function buildMatchedOutcomesStatement(
  read: MatchedEventsRead,
): Statement {
  const statement: Statement = new Statement();

  statement.append("SELECT ");
  statement.append(getGroupExpression(read));
  statement.append(` AS ${GROUP_ALIAS}, requestOutcome, count() AS matched`);
  statement.append(buildMatchedEventsFromWhere(read));
  statement.append(` GROUP BY ${GROUP_ALIAS}, requestOutcome`);
  statement.append(
    getQuerySettings({
      maxExecutionTimeInSeconds: MATCHED_EVENTS_READ_TIME_LIMIT_IN_SECONDS,
      timeoutOverflowMode: "throw",
    }),
  );

  return statement;
}

/*
 * The two reads' rows, as what each group keeps: its events (each as a
 * detection keeps one, the earliest first, within the bounds) and its
 * request outcomes. A group with neither is left out.
 */
export function readMatchedEventsRows(data: {
  eventRows: Array<JSONObject>;
  outcomeRows: Array<JSONObject>;
}): Map<string, SecurityDetectionMatchedEvents> {
  const events: Map<string, Array<SecurityDetectionMatchedEvent>> = new Map();
  const outcomes: Map<string, Record<string, number>> = new Map();

  for (const row of data.eventRows) {
    const group: string = String(row[GROUP_ALIAS] ?? "");
    const event: SecurityDetectionMatchedEvent | null =
      buildSecurityDetectionMatchedEvent(row);

    if (!event) {
      continue;
    }

    const list: Array<SecurityDetectionMatchedEvent> = events.get(group) || [];

    if (list.length < SECURITY_DETECTION_MATCHED_EVENTS_MAX) {
      list.push(event);
    }

    events.set(group, list);
  }

  for (const row of data.outcomeRows) {
    const group: string = String(row[GROUP_ALIAS] ?? "");
    const outcome: string =
      typeof row["requestOutcome"] === "string" ? row["requestOutcome"] : "";
    const count: number = Math.trunc(Number(row["matched"]) || 0);

    if (count <= 0) {
      continue;
    }

    const tally: Record<string, number> = outcomes.get(group) || {};
    tally[outcome] = (tally[outcome] || 0) + count;
    outcomes.set(group, tally);
  }

  const kept: Map<string, SecurityDetectionMatchedEvents> = new Map();

  for (const group of new Set<string>([...events.keys(), ...outcomes.keys()])) {
    kept.set(
      group,
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: {
          events: events.get(group) || [],
          outcomes: outcomes.get(group) || {},
        },
      }),
    );
  }

  return kept;
}

/*
 * What a detection recorded as one stored event keeps - a connected
 * product's alert, a threat a security product wrote in the logs: the row
 * as it was stored, and its request's outcome. Null for a row that names no
 * event.
 */
export function getMatchedEventsOfStoredRow(row: {
  [column: string]: unknown;
}): SecurityDetectionMatchedEvents | null {
  const event: SecurityDetectionMatchedEvent | null =
    buildSecurityDetectionMatchedEvent(row);

  if (!event) {
    return null;
  }

  return {
    events: [event],
    outcomes: { [event.requestOutcome]: 1 },
  };
}

async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  const result: Awaited<ReturnType<typeof SecurityEventService.executeQuery>> =
    await SecurityEventService.executeQuery(statement);
  const response: { data?: Array<JSONObject> } = await result.json<{
    data?: Array<JSONObject>;
  }>();

  return response.data || [];
}

export default class SecurityDetectionMatchedEventsReader {
  /*
   * What each group of a firing keeps, by its value - the value as the
   * read groups it (a threat intel indicator lower-cased). Empty when there
   * is no group to read, and when a read fails, which is logged.
   */
  @CaptureSpan()
  public static async readForGroups(
    read: MatchedEventsRead,
  ): Promise<Map<string, SecurityDetectionMatchedEvents>> {
    const isGrouped: boolean = Boolean(
      read.groupExpression || read.groupByObservable,
    );

    if (isGrouped && read.groupValues.length === 0) {
      return new Map();
    }

    try {
      const [eventRows, outcomeRows]: [Array<JSONObject>, Array<JSONObject>] =
        await Promise.all([
          readRows(
            buildMatchedEventsStatement({
              read,
              limitPerGroup: SECURITY_DETECTION_MATCHED_EVENTS_MAX,
            }),
          ),
          readRows(buildMatchedOutcomesStatement(read)),
        ]);

      return readMatchedEventsRows({ eventRows, outcomeRows });
    } catch (error) {
      logger.warn(
        `SecurityDetectionMatchedEventsReader: the events of project ${read.projectId.toString()}'s firing could not be read to keep; its detections keep none: ${error}`,
      );

      return new Map();
    }
  }
}

import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import URL from "../../../Types/API/URL";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityEntity,
  mergeSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import DatabaseConfig from "../../DatabaseConfig";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import RumSessionService from "../../Services/RumSessionService";
import SecurityDetectionService from "../../Services/SecurityDetectionService";
import SecurityEventService, {
  SECURITY_CONNECTION_READ_TIME_LIMIT,
} from "../../Services/SecurityEventService";
import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHAT A SECURITY CASE'S REQUESTS LEFT BEHIND.
 *
 * A security event read from a log line written inside a request carries
 * that request's trace, span and session (SecurityEvent.traceId, spanId,
 * sessionId), and the exception the request threw once it was followed
 * (the oneuptime.exception.fingerprint attribute). The case's events are
 * the ones that name what the case names - its entities - over the time it
 * was detected in, and the events behind its detections; what they link to
 * is the case's evidence: the trace of each request, the session replay it
 * was part of, the exception it threw.
 *
 * The Preserve the evidence and Fix the code with AI steps read it here.
 * Every read is the project's own, bounded in time and in rows, and made as
 * OneUptime (a step runs as OneUptime, as every playbook step does).
 */

// The most requests a case's evidence is read from.
export const MAX_EVIDENCE_REQUESTS: number = 25;

// The most detections whose events are read for the case.
export const MAX_EVIDENCE_DETECTIONS: number = 100;

// The most session replays one step pins.
export const MAX_PINNED_SESSIONS: number = 10;

// The most exceptions one Fix the code with AI step asks a fix for.
export const MAX_FIXED_EXCEPTIONS: number = 3;

// Room around the time the case was detected in: requests start before their log lines.
export const EVIDENCE_WINDOW_PADDING_IN_HOURS: number = 1;

// The longest stretch of time a case's evidence is looked for over.
export const MAX_EVIDENCE_WINDOW_IN_DAYS: number = 30;

// A session replay may have started this long before the request that names it.
export const SESSION_LOOKBACK_IN_HOURS: number = 24;

// One request behind the case: what it links to.
export interface SecurityCaseRequestEvidence {
  traceId: string;
  spanId: string;
  sessionId: string;
  exceptionFingerprint: string;
  requestOutcome: string;
  message: string;
  lastSeen: Date | null;
}

export interface SecurityCaseEvidenceWindow {
  startTime: Date;
  endTime: Date;
}

// A session replay found for a session id: the application it was recorded in.
export interface SecurityCaseSessionReplay {
  sessionId: string;
  rumApplicationId: string;
}

/*
 * The time the case's evidence is looked for over: from an hour before its
 * first detection to an hour after its last (or now), at most
 * MAX_EVIDENCE_WINDOW_IN_DAYS long, ending at that end.
 */
export function getEvidenceWindow(
  securityCase: SecurityCase,
  now: Date = OneUptimeDate.getCurrentDate(),
): SecurityCaseEvidenceWindow {
  const padding: number = EVIDENCE_WINDOW_PADDING_IN_HOURS * 60 * 60 * 1000;
  const first: Date | undefined =
    securityCase.firstDetectedAt || securityCase.createdAt || undefined;
  const last: Date | undefined = securityCase.lastDetectedAt || undefined;

  const endTime: Date = new Date(
    Math.min(now.getTime(), (last ? new Date(last) : now).getTime() + padding),
  );
  const earliest: number =
    endTime.getTime() - MAX_EVIDENCE_WINDOW_IN_DAYS * 24 * 60 * 60 * 1000;
  const startTime: Date = new Date(
    Math.max(earliest, (first ? new Date(first) : endTime).getTime() - padding),
  );

  return { startTime, endTime };
}

// Distinct, trimmed, non-empty values, at most `limit`.
export function distinctValues(
  values: ReadonlyArray<string | undefined | null>,
  limit: number,
): Array<string> {
  const list: Array<string> = [];

  for (const value of values) {
    const text: string = (value || "").trim();

    if (text && !list.includes(text)) {
      list.push(text);
    }

    if (list.length >= limit) {
      break;
    }
  }

  return list;
}

/*
 * The requests the case's events happened in, the latest first: one row a
 * trace (and session), with what it links to. Events that name what the
 * case names over its window, or that are behind its detections; only those
 * that carry a trace or a session.
 */
export function buildRequestEvidenceStatement(data: {
  databaseName: string;
  tableName: string;
  projectId: ObjectID;
  values: Array<string>;
  eventUids: Array<string>;
  window: SecurityCaseEvidenceWindow;
  limit: number;
}): Statement {
  const fingerprintKey: string =
    SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint;

  const statement: Statement = SQL`SELECT traceId, any(spanId) AS spanId, sessionId, anyIf(attributes[${{
    type: TableColumnType.Text,
    value: fingerprintKey,
  }}], attributes[${{
    type: TableColumnType.Text,
    value: fingerprintKey,
  }}] != '') AS exceptionFingerprint, anyIf(requestOutcome, requestOutcome != '') AS requestOutcome, any(message) AS message, max(time) AS lastSeen FROM `;
  statement.append(`${data.databaseName}.${data.tableName}`);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.window.startTime,
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: data.window.endTime,
    }} AND (traceId != '' OR sessionId != '') AND (`,
  );

  const conditions: Array<Statement> = [];

  if (data.values.length > 0) {
    conditions.push(
      SQL`hasAny(observables, ${{
        type: TableColumnType.ArrayText,
        value: data.values,
      }})`,
    );
  }

  if (data.eventUids.length > 0) {
    conditions.push(
      SQL`eventUid IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.eventUids),
      }})`,
    );
  }

  conditions.forEach((condition: Statement, index: number): void => {
    if (index > 0) {
      statement.append(" OR ");
    }

    statement.append(condition);
  });

  statement.append(
    SQL`) GROUP BY traceId, sessionId ORDER BY lastSeen DESC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

  return statement;
}

function readText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

// ClickHouse writes DateTime64 as "2026-10-14 09:00:00.000000000", in UTC.
function readClickhouseTime(value: unknown): Date | null {
  const text: string = readText(value);

  if (!text) {
    return null;
  }

  const date: Date = new Date(
    text.includes("T") ? text : `${text.replace(" ", "T")}Z`,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

export function readRequestEvidenceRow(
  row: JSONObject,
): SecurityCaseRequestEvidence {
  return {
    traceId: readText(row["traceId"]),
    spanId: readText(row["spanId"]),
    sessionId: readText(row["sessionId"]),
    exceptionFingerprint: readText(row["exceptionFingerprint"]),
    requestOutcome: readText(row["requestOutcome"]),
    message: readText(row["message"]),
    lastSeen: readClickhouseTime(row["lastSeen"]),
  };
}

/*
 * The application each of these sessions was recorded in, when OneUptime
 * holds a replay of it. A session id a log line carries may be no browser
 * session at all, and then is not found.
 */
export function buildSessionReplayStatement(data: {
  databaseName: string;
  tableName: string;
  projectId: ObjectID;
  sessionIds: Array<string>;
  window: SecurityCaseEvidenceWindow;
}): Statement {
  const statement: Statement = SQL`SELECT sessionId, any(rumApplicationId) AS rumApplicationId FROM `;
  statement.append(`${data.databaseName}.${data.tableName}`);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND startTime >= ${{
      type: TableColumnType.DateTime64,
      value: new Date(
        data.window.startTime.getTime() -
          SESSION_LOOKBACK_IN_HOURS * 60 * 60 * 1000,
      ),
    }} AND startTime <= ${{
      type: TableColumnType.DateTime64,
      value: data.window.endTime,
    }} AND sessionId IN (${{
      type: TableColumnType.Text,
      value: new Includes(data.sessionIds),
    }}) GROUP BY sessionId LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, data.sessionIds.length),
    }}`,
  );
  statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

  return statement;
}

/*
 * Where each piece of evidence opens in the Dashboard. Built from the
 * Dashboard's address the way a case's own link is
 * (SecurityCaseService.getCaseLinkInDashboard), so a case note or a feed
 * entry links straight to it.
 */
export class SecurityCaseEvidenceLinks {
  public constructor(
    private readonly dashboardUrl: URL,
    private readonly projectId: ObjectID,
  ) {}

  private at(path: string): URL {
    return URL.fromString(this.dashboardUrl.toString()).addRoute(
      `/${this.projectId.toString()}${path}`,
    );
  }

  public trace(traceId: string, spanId?: string | undefined): URL {
    const url: URL = this.at(`/traces/view/${encodeURIComponent(traceId)}`);

    return spanId ? url.addQueryParam("spanId", spanId, true) : url;
  }

  public sessionReplay(rumApplicationId: string, sessionId: string): URL {
    return this.at(
      `/rum/${rumApplicationId}/session-replay/${encodeURIComponent(sessionId)}`,
    );
  }

  public exception(telemetryExceptionId: string): URL {
    return this.at(`/exceptions/${telemetryExceptionId}`);
  }

  public exceptionAiAssistance(telemetryExceptionId: string): URL {
    return this.at(`/exceptions/${telemetryExceptionId}/ai-assistance`);
  }

  public runbookRun(runbookId: string, runbookExecutionId: string): URL {
    return this.at(`/runbooks/${runbookId}/executions/${runbookExecutionId}`);
  }

  public announcement(announcementId: string): URL {
    return this.at(`/status-pages/announcements/${announcementId}`);
  }
}

export default class SecurityCaseEvidence {
  public static async getLinks(
    projectId: ObjectID,
  ): Promise<SecurityCaseEvidenceLinks> {
    return new SecurityCaseEvidenceLinks(
      await DatabaseConfig.getDashboardUrl(),
      projectId,
    );
  }

  // The events behind the case's detections, by their uids.
  @CaptureSpan()
  public static async getDetectionEventUids(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<Array<string>> {
    const detections: Array<SecurityDetection> =
      await SecurityDetectionService.findBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
        },
        select: { eventUid: true },
        skip: 0,
        limit: MAX_EVIDENCE_DETECTIONS,
        props: { isRoot: true },
      });

    return distinctValues(
      detections.map((detection: SecurityDetection): string | undefined => {
        return detection.eventUid;
      }),
      MAX_EVIDENCE_DETECTIONS,
    );
  }

  // The requests behind the case, the latest first (buildRequestEvidenceStatement).
  @CaptureSpan()
  public static async findRequests(data: {
    projectId: ObjectID;
    securityCase: SecurityCase;
    limit?: number | undefined;
  }): Promise<Array<SecurityCaseRequestEvidence>> {
    const values: Array<string> = distinctValues(
      mergeSecurityEntities(
        (data.securityCase.entities || []) as unknown as Array<SecurityEntity>,
      ).map((entity: SecurityEntity): string => {
        return entity.value;
      }),
      50,
    );
    const eventUids: Array<string> = data.securityCase.id
      ? await this.getDetectionEventUids({
          projectId: data.projectId,
          securityCaseId: data.securityCase.id,
        })
      : [];

    if (values.length === 0 && eventUids.length === 0) {
      return [];
    }

    if (!SecurityEventService.database) {
      SecurityEventService.useDefaultDatabase();
    }

    const results: Results = await SecurityEventService.executeQuery(
      buildRequestEvidenceStatement({
        databaseName:
          SecurityEventService.database.getDatasourceOptions().database!,
        tableName: SecurityEventService.model.tableName,
        projectId: data.projectId,
        values,
        eventUids,
        window: getEvidenceWindow(data.securityCase),
        limit: data.limit || MAX_EVIDENCE_REQUESTS,
      }),
    );
    const response: DbJSONResponse = await results.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map(readRequestEvidenceRow);
  }

  // The session replays OneUptime holds of these sessions.
  @CaptureSpan()
  public static async findSessionReplays(data: {
    projectId: ObjectID;
    sessionIds: Array<string>;
    window: SecurityCaseEvidenceWindow;
  }): Promise<Array<SecurityCaseSessionReplay>> {
    if (data.sessionIds.length === 0) {
      return [];
    }

    if (!RumSessionService.database) {
      RumSessionService.useDefaultDatabase();
    }

    const results: Results = await RumSessionService.executeQuery(
      buildSessionReplayStatement({
        databaseName:
          RumSessionService.database.getDatasourceOptions().database!,
        tableName: RumSessionService.model.tableName,
        projectId: data.projectId,
        sessionIds: data.sessionIds,
        window: data.window,
      }),
    );
    const response: DbJSONResponse = await results.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || [])
      .map((row: JSONObject): SecurityCaseSessionReplay => {
        return {
          sessionId: readText(row["sessionId"]),
          rumApplicationId: readText(row["rumApplicationId"]),
        };
      })
      .filter((replay: SecurityCaseSessionReplay): boolean => {
        return (
          Boolean(replay.sessionId) &&
          ObjectID.isValidUUID(replay.rumApplicationId)
        );
      });
  }

  /*
   * The exception groups these fingerprints are, the project's own. A
   * fingerprint names one group a service, so one may be several groups;
   * each is returned.
   */
  @CaptureSpan()
  public static async findExceptions(data: {
    projectId: ObjectID;
    fingerprints: Array<string>;
  }): Promise<Array<TelemetryException>> {
    if (data.fingerprints.length === 0) {
      return [];
    }

    return await TelemetryExceptionService.findBy({
      query: {
        projectId: data.projectId,
        fingerprint: new Includes(data.fingerprints),
      },
      select: {
        _id: true,
        fingerprint: true,
        exceptionType: true,
        message: true,
        isResolved: true,
        isArchived: true,
      },
      skip: 0,
      limit: data.fingerprints.length * 5,
      props: { isRoot: true },
    });
  }
}

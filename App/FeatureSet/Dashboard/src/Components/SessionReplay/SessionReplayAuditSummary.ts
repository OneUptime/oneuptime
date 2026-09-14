import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  readDtoNumber,
  readDtoOptionalNumber,
  readDtoString,
} from "Common/Types/Rum/SessionReplayApi";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import { formatSessionDuration } from "./SessionReplayPlayability";

/*
 * The audit row deliberately retains only a session id. The recording header
 * follows the project's replay retention and erasure rules, so this extra
 * context is fetched at read time and may be absent. It never includes the
 * end-user identity fields, which have a narrower permission of their own.
 */

export const SESSION_REPLAY_AUDIT_SUMMARIES_ROUTE: string =
  "/telemetry/rum/session-replay/summaries";
export const SESSION_REPLAY_AUDIT_SHORT_ID_LENGTH: number = 8;

export interface SessionReplayAuditSummary {
  sessionId: string;
  startTime: string;
  startTimeUnixMs?: number | undefined;
  durationMs: number;
  entryUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
}

export interface SessionReplayAuditPresentation {
  primaryLabel: string;
  sessionLabel: string;
  fullSessionId: string;
  startedAt: Date | null;
  durationLabel: string;
  deviceLabel: string;
}

export function uniqueSessionIds(
  sessionIds: Array<string | null | undefined>,
): Array<string> {
  const unique: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const value of sessionIds) {
    const sessionId: string = typeof value === "string" ? value.trim() : "";

    if (!sessionId || seen.has(sessionId)) {
      continue;
    }

    seen.add(sessionId);
    unique.push(sessionId);
  }

  return unique;
}

export function parseSessionReplayAuditSummary(
  value: JSONObject,
): SessionReplayAuditSummary {
  const record: Record<string, unknown> = value as Record<string, unknown>;

  return {
    sessionId: readDtoString(record, "sessionId"),
    startTime: readDtoString(record, "startTime"),
    startTimeUnixMs: readDtoOptionalNumber(record, "startTimeUnixMs"),
    durationMs: readDtoNumber(record, "durationMs"),
    entryUrl: readDtoString(record, "entryUrl"),
    browserName: readDtoString(record, "browserName"),
    browserVersion: readDtoString(record, "browserVersion"),
    osName: readDtoString(record, "osName"),
    deviceType: readDtoString(record, "deviceType"),
  };
}

export async function fetchSessionReplayAuditSummaries(data: {
  rumApplicationId: ObjectID;
  sessionIds: Array<string | null | undefined>;
}): Promise<Map<string, SessionReplayAuditSummary>> {
  const sessionIds: Array<string> = uniqueSessionIds(data.sessionIds);
  const summaries: Map<string, SessionReplayAuditSummary> = new Map<
    string,
    SessionReplayAuditSummary
  >();

  if (sessionIds.length === 0) {
    return summaries;
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        SESSION_REPLAY_AUDIT_SUMMARIES_ROUTE,
      ),
      data: {
        rumApplicationId: data.rumApplicationId.toString(),
        sessionIds: sessionIds,
      },
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (!response.isSuccess()) {
    throw response;
  }

  const rows: JSONArray = Array.isArray(response.data["sessions"])
    ? (response.data["sessions"] as JSONArray)
    : [];

  for (const row of rows) {
    const summary: SessionReplayAuditSummary =
      parseSessionReplayAuditSummary(row);

    /* Ignore malformed or unsolicited rows instead of enriching the wrong id. */
    if (!sessionIds.includes(summary.sessionId)) {
      continue;
    }

    summaries.set(summary.sessionId, summary);
  }

  return summaries;
}

export function sessionReplayEntryPath(entryUrl: string): string {
  const value: string = entryUrl.trim();

  if (!value) {
    return "";
  }

  try {
    const parsed: globalThis.URL = new globalThis.URL(value);

    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return value;
  }
}

function titleCase(value: string): string {
  const trimmed: string = value.trim();

  if (!trimmed) {
    return "";
  }

  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export function sessionReplayDeviceLabel(
  summary: SessionReplayAuditSummary,
): string {
  const browser: string = [summary.browserName, summary.browserVersion]
    .filter(Boolean)
    .join(" ");
  const browserAndOs: string =
    browser && summary.osName
      ? `${browser} on ${summary.osName}`
      : browser || summary.osName;
  const device: string = titleCase(summary.deviceType);

  return [browserAndOs, device].filter(Boolean).join(" · ");
}

export function sessionReplayStartDate(
  summary: SessionReplayAuditSummary,
): Date | null {
  const value: string | number | undefined =
    summary.startTimeUnixMs !== undefined
      ? summary.startTimeUnixMs
      : summary.startTime;

  if (value === undefined || value === "") {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function describeSessionReplayAuditSession(data: {
  sessionId: string;
  summary?: SessionReplayAuditSummary | undefined;
}): SessionReplayAuditPresentation {
  const fullSessionId: string = data.sessionId.trim();
  const summary: SessionReplayAuditSummary | undefined =
    data.summary?.sessionId === fullSessionId ? data.summary : undefined;
  const shortId: string = fullSessionId.slice(
    0,
    SESSION_REPLAY_AUDIT_SHORT_ID_LENGTH,
  );
  const durationLabel: string = summary
    ? formatSessionDuration(summary.durationMs)
    : "";

  return {
    primaryLabel:
      (summary && sessionReplayEntryPath(summary.entryUrl)) ||
      "Open session replay",
    sessionLabel: shortId ? `Session ${shortId}` : "Session unavailable",
    fullSessionId: fullSessionId,
    startedAt: summary ? sessionReplayStartDate(summary) : null,
    durationLabel: durationLabel === "—" ? "" : durationLabel,
    deviceLabel: summary ? sessionReplayDeviceLabel(summary) : "",
  };
}

import { ResponseJSON } from "@clickhouse/client";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  RUM_COUNTRY_WINDOW_IN_MINUTES,
  RumScanSession,
  RumUserCountriesRow,
  buildUserInTwoCountriesEvent,
} from "../../../../Utils/SecurityEvent/TelemetryScan/RumSignals";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import RumSessionService from "../../../Services/RumSessionService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  TelemetryScanWindow,
  buildRumUserCountriesStatement,
} from "./TelemetryScanStatements";
import { readRowDate, readRowText } from "./TelemetryScanRows";
import { TelemetryWindowRead } from "./TelemetryScanTypes";

/*
 * "Your OneUptime data" - session replays: each window, the identified
 * users whose sessions of the last RUM_COUNTRY_WINDOW_IN_MINUTES (and a
 * little more, so a pair split across two windows is still seen together)
 * came from two or more countries, and at least one of them arrived in the
 * window (Utils/SecurityEvent/TelemetryScan/RumSignals.ts).
 *
 * The same user and countries are reported once a day: the event's id
 * says so, and the scan stores an id once.
 */

// The most users one window reports.
export const MAX_RUM_USERS_PER_WINDOW: number = 50;

// The most sessions of one user the database returns.
export const MAX_RUM_SESSIONS_PER_USER: number = 20;

// How far before a window's end its sessions may have started.
export const RUM_LOOKBACK_IN_MINUTES: number =
  RUM_COUNTRY_WINDOW_IN_MINUTES * 2;

function toRumScanSession(value: JSONValue): RumScanSession | null {
  // A tuple: sessionId, applicationId, country, sessionStart, browser, os.
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }

  const startTime: Date | null = readRowDate(value[3]);

  if (!startTime) {
    return null;
  }

  return {
    sessionId: readRowText(value[0]),
    rumApplicationId: readRowText(value[1]),
    countryCode: readRowText(value[2]),
    startTime,
    browserName: readRowText(value[4]),
    osName: readRowText(value[5]),
  };
}

export function toRumUserCountriesRow(row: JSONObject): RumUserCountriesRow {
  const sessions: Array<RumScanSession> = [];
  const values: JSONValue | undefined = row["sessions"];

  if (Array.isArray(values)) {
    for (const value of values) {
      const session: RumScanSession | null = toRumScanSession(value);

      if (session) {
        sessions.push(session);
      }
    }
  }

  return {
    userKey: readRowText(row["userKey"]),
    sessions,
  };
}

export default class RumSecurityScan {
  @CaptureSpan()
  public static async readWindow(data: {
    window: TelemetryScanWindow;
  }): Promise<TelemetryWindowRead> {
    const result: Results = await RumSessionService.executeQuery(
      buildRumUserCountriesStatement({
        projectId: data.window.projectId,
        arrivedAfter: data.window.arrivedAfter,
        arrivedUntil: data.window.arrivedUntil,
        startedAfter: new Date(
          data.window.arrivedUntil.getTime() -
            RUM_LOOKBACK_IN_MINUTES * 60 * 1000,
        ),
        sessionsPerUser: MAX_RUM_SESSIONS_PER_USER,
        limit: MAX_RUM_USERS_PER_WINDOW,
      }),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const rows: Array<JSONObject> = (response.data || []) as Array<JSONObject>;

    const events: Array<NormalizedSecurityEvent> = [];

    for (const row of rows) {
      const event: NormalizedSecurityEvent | null =
        buildUserInTwoCountriesEvent(toRumUserCountriesRow(row));

      if (event) {
        events.push(event);
      }
    }

    return { events, recordsRead: rows.length, pageRows: 0, hasMore: false };
  }
}

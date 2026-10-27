import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import { buildTelemetrySecurityEvent } from "./TelemetrySecurityEvent";

/*
 * WHAT SESSION REPLAYS SAY ABOUT AN ATTACK: one signed-in user using the
 * app from two or more countries within RUM_COUNTRY_WINDOW_IN_MINUTES -
 * nobody travels that fast, so somebody else has their session or their
 * password (Server/Utils/SecurityEvent/TelemetryScan/RumSecurityScan.ts).
 *
 * The user is named by the session replay's identity key, a keyed hash of
 * what the app identified them by, never by their name or email: those
 * stay behind Session Replay's own identity permission, and the event links
 * to the sessions, where somebody allowed to can see who it was. The event's
 * session is the latest of them, so the event opens on it.
 *
 * Pure: the scan hands it the rows it read.
 */

export const AUTHENTICATION_CLASS_UID: number = 3002;

// How close together two sessions in different countries must start.
export const RUM_COUNTRY_WINDOW_IN_MINUTES: number = 60;

// The most sessions an event lists.
export const MAX_RUM_SESSIONS_LISTED: number = 10;

export const RUM_ATTRIBUTES: {
  userKey: string;
  countries: string;
  sessionIds: string;
  applicationId: string;
  browsers: string;
} = {
  userKey: "rum.identified_user_key",
  countries: "rum.countries",
  sessionIds: "rum.session_ids",
  applicationId: "rum.application_id",
  browsers: "rum.browsers",
};

export interface RumScanSession {
  sessionId: string;
  rumApplicationId: string;
  countryCode: string;
  startTime: Date;
  browserName: string;
  osName: string;
}

// One identified user's recent sessions, as the database grouped them.
export interface RumUserCountriesRow {
  userKey: string;
  sessions: Array<RumScanSession>;
}

// Two-letter country codes, upper-cased, each once, in order.
export function readCountries(sessions: Array<RumScanSession>): Array<string> {
  const countries: Set<string> = new Set();

  for (const session of sessions) {
    const code: string = (session.countryCode || "").trim().toUpperCase();

    if (code.length === 2) {
      countries.add(code);
    }
  }

  return Array.from(countries).sort();
}

/*
 * The sessions in different countries that started closest together, or
 * null when no two did within the window: what makes it impossible travel
 * rather than two trips.
 */
export function findClosestCountryChange(
  sessions: Array<RumScanSession>,
): { from: RumScanSession; to: RumScanSession; minutes: number } | null {
  const ordered: Array<RumScanSession> = sessions
    .filter((session: RumScanSession): boolean => {
      return (
        (session.countryCode || "").trim().length === 2 &&
        !Number.isNaN(session.startTime.getTime())
      );
    })
    .sort((a: RumScanSession, b: RumScanSession): number => {
      return a.startTime.getTime() - b.startTime.getTime();
    });

  let closest: {
    from: RumScanSession;
    to: RumScanSession;
    minutes: number;
  } | null = null;

  for (let index: number = 1; index < ordered.length; index++) {
    const previous: RumScanSession = ordered[index - 1]!;
    const current: RumScanSession = ordered[index]!;

    if (
      previous.countryCode.trim().toUpperCase() ===
      current.countryCode.trim().toUpperCase()
    ) {
      continue;
    }

    const minutes: number =
      (current.startTime.getTime() - previous.startTime.getTime()) / 60000;

    if (
      minutes <= RUM_COUNTRY_WINDOW_IN_MINUTES &&
      (!closest || minutes < closest.minutes)
    ) {
      closest = { from: previous, to: current, minutes };
    }
  }

  return closest;
}

export function buildUserInTwoCountriesEvent(
  row: RumUserCountriesRow,
): NormalizedSecurityEvent | null {
  const userKey: string = (row.userKey || "").trim();

  if (!userKey) {
    return null;
  }

  const change: {
    from: RumScanSession;
    to: RumScanSession;
    minutes: number;
  } | null = findClosestCountryChange(row.sessions);

  if (!change) {
    return null;
  }

  const countries: Array<string> = readCountries(row.sessions);
  const latest: RumScanSession = [...row.sessions].sort(
    (a: RumScanSession, b: RumScanSession): number => {
      return b.startTime.getTime() - a.startTime.getTime();
    },
  )[0]!;
  const minutes: number = Math.max(1, Math.round(change.minutes));
  const from: string = change.from.countryCode.trim().toUpperCase();
  const to: string = change.to.countryCode.trim().toUpperCase();

  const sessionIds: Array<string> = row.sessions
    .map((session: RumScanSession): string => {
      return session.sessionId;
    })
    .filter(Boolean)
    .slice(0, MAX_RUM_SESSIONS_LISTED);

  const browsers: Array<string> = Array.from(
    new Set(
      row.sessions
        .map((session: RumScanSession): string => {
          return [session.browserName, session.osName]
            .filter(Boolean)
            .join(" on ");
        })
        .filter(Boolean),
    ),
  ).slice(0, 5);

  const attributes: JSONObject = {
    [RUM_ATTRIBUTES.userKey]: userKey,
    [RUM_ATTRIBUTES.countries]: countries.join(","),
    [RUM_ATTRIBUTES.sessionIds]: sessionIds.join(","),
    [RUM_ATTRIBUTES.applicationId]: latest.rumApplicationId,
  };

  if (browsers.length > 0) {
    attributes[RUM_ATTRIBUTES.browsers] = browsers.join(", ");
  }

  // One event a user a day for the same countries, however often it is seen.
  const day: string = change.to.startTime.toISOString().slice(0, 10);

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.RumSessions,
    signal: SecurityTelemetrySignal.UserInTwoCountries,
    time: change.to.startTime,
    eventUid: `rum:${SecurityTelemetrySignal.UserInTwoCountries}:${userKey}:${countries.join("-")}:${day}`,
    classUid: AUTHENTICATION_CLASS_UID,
    activityName: "Logon",
    statusName: "Success",
    severity: OcsfSeverity.Medium,
    message: `One signed-in user used the app from ${from} and then ${to}, ${minutes} ${
      minutes === 1 ? "minute" : "minutes"
    } apart`,
    attributes,
    extraObservables: [userKey],
    sessionId: latest.sessionId,
  });
}

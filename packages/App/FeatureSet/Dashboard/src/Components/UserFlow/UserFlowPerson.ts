import { JSONObject } from "Common/Types/JSON";
import {
  UserFlowJourneysResponseDto,
  UserFlowSessionDetailDto,
  UserFlowSessionDto,
} from "Common/Types/Rum/UserFlow";
import {
  UserFlowSessionJourney,
  UserFlowVisit,
} from "Common/Utils/Rum/UserFlow";
import {
  describeSessionUser,
  SessionUserDescription,
  shortVisitorId,
} from "../SessionReplay/SessionReplayUserIdentity";
import {
  getSessionReplayPlayability,
  isSessionReplayRecordingLive,
  SessionReplayPlayability,
} from "../SessionReplay/SessionReplayPlayability";

/*
 * Whose journeys the User Flows page is showing, when it is not everyone's.
 *
 * Plain TypeScript with no React and no Common/UI import, so node tests can
 * pin it. Three kinds come from a link and go back into one: the pseudonymous
 * digest, the visitor id and the session id, none of which names anybody.
 * The fourth is what someone typed, which may be a reference - typically an
 * email - and so never reaches a URL. It lives in the page's memory until the
 * server's answer says which of the three it was (resolveUserFlowPerson),
 * and only that goes in the address.
 */

export type UserFlowPerson =
  | { kind: "user"; identifiedUserKey: string }
  | { kind: "visitor"; visitorId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "lookup"; identifier: string };

/*
 * One person's page opens on their journeys, because a flow map of one person
 * is a thin line: it says less than the list and takes more reading. The map
 * is there for someone with many sessions, as what they usually do.
 */
export type UserFlowView = "journeys" | "map";

export const DEFAULT_USER_FLOW_PERSON_VIEW: UserFlowView = "journeys";

/* How much of a session id the page shows, as the session list's chip does. */
export const SHORT_USER_FLOW_SESSION_ID_LENGTH: number = 8;

export function shortUserFlowSessionId(sessionId: string): string {
  return sessionId.slice(0, SHORT_USER_FLOW_SESSION_ID_LENGTH);
}

/* The endpoint's `filters`: one key, or nothing for everyone. */
export function getUserFlowPersonFilters(
  person: UserFlowPerson | undefined,
): JSONObject {
  switch (person?.kind) {
    case "user":
      return { identifiedUserKey: person.identifiedUserKey };
    case "visitor":
      return { visitorId: person.visitorId };
    case "session":
      return { sessionId: person.sessionId };
    case "lookup":
      return { identifier: person.identifier };
    default:
      return {};
  }
}

/* What the data on screen was read for: "" is everyone. */
export function getUserFlowPersonKey(
  person: UserFlowPerson | undefined,
): string {
  switch (person?.kind) {
    case "user":
      return `user:${person.identifiedUserKey}`;
    case "visitor":
      return `visitor:${person.visitorId}`;
    case "session":
      return `session:${person.sessionId}`;
    case "lookup":
      return `lookup:${person.identifier}`;
    default:
      return "";
  }
}

/*
 * Which of the three a typed value turned out to be, from the sessions it
 * matched. The session id first, then the visitor id, because those are
 * exact matches against the value itself; a digest is what is left. Nothing
 * matched leaves what was typed: there is nothing to put in the address.
 */
export function resolveUserFlowPerson(
  person: UserFlowPerson,
  response: UserFlowJourneysResponseDto | null,
): UserFlowPerson {
  if (person.kind !== "lookup" || !response) {
    return person;
  }

  const identifier: string = person.identifier;

  if (
    response.sessions.some((session: UserFlowSessionDto): boolean => {
      return session.sessionId === identifier;
    })
  ) {
    return { kind: "session", sessionId: identifier };
  }

  const first: UserFlowSessionDetailDto | undefined =
    response.sessions[0]?.detail;

  if (!first) {
    return person;
  }

  if (first.visitorId === identifier) {
    return { kind: "visitor", visitorId: identifier };
  }

  return first.identifiedUserKey
    ? { kind: "user", identifiedUserKey: first.identifiedUserKey }
    : person;
}

/*
 * The person a session belongs to, as a link can name them: the user when one
 * was identified, otherwise the browser. Null when it names neither.
 */
export function getUserFlowSessionOwner(
  detail: UserFlowSessionDetailDto | undefined,
): UserFlowPerson | null {
  if (detail?.identifiedUserKey) {
    return { kind: "user", identifiedUserKey: detail.identifiedUserKey };
  }

  return detail?.visitorId
    ? { kind: "visitor", visitorId: detail.visitorId }
    : null;
}

/* The shared ranking of a session's identity facts, for the words it speaks. */
export function describeUserFlowSessionOwner(
  detail: UserFlowSessionDetailDto,
): SessionUserDescription {
  return describeSessionUser({
    identifiedUserLabel: detail.identifiedUserLabel ?? "",
    isIdentityVisible: detail.identifiedUserLabel !== undefined,
    identifiedUserKey: detail.identifiedUserKey,
    visitorId: detail.visitorId,
  });
}

export type UserFlowPersonLabelKind =
  | "user"
  | "hidden"
  | "visitor"
  | "session"
  | "typed"
  | "unknown-user";

export interface UserFlowPersonDescription {
  kind: UserFlowPersonLabelKind;
  /* The name, the short id, or what was typed. Empty for unknown-user. */
  value: string;
  /* Why it reads this way, for the hover. */
  title: string;
  initials: string;
  hue: number | null;
}

function firstDetail(
  response: UserFlowJourneysResponseDto | null,
): UserFlowSessionDetailDto | undefined {
  return response?.sessions.find((session: UserFlowSessionDto): boolean => {
    return Boolean(session.detail);
  })?.detail;
}

/*
 * Who the page says it is showing. The server's answer decides a name, so a
 * reload of a link still reads "jane@example.com" for a role that may read
 * it and "Hidden" for one that may not: the name itself is never in the URL.
 */
export function describeUserFlowPerson(
  person: UserFlowPerson,
  response: UserFlowJourneysResponseDto | null,
): UserFlowPersonDescription {
  if (person.kind === "session") {
    return {
      kind: "session",
      value: shortUserFlowSessionId(person.sessionId),
      title: person.sessionId,
      initials: "S",
      hue: null,
    };
  }

  if (person.kind === "visitor") {
    const visitor: SessionUserDescription = describeSessionUser({
      identifiedUserLabel: "",
      isIdentityVisible: true,
      identifiedUserKey: "",
      visitorId: person.visitorId,
    });

    return {
      kind: "visitor",
      value: shortVisitorId(person.visitorId),
      title: visitor.title,
      initials: visitor.initials,
      hue: visitor.hue,
    };
  }

  if (person.kind === "lookup") {
    return {
      kind: "typed",
      value: person.identifier,
      title: person.identifier,
      initials: "?",
      hue: null,
    };
  }

  const detail: UserFlowSessionDetailDto | undefined = firstDetail(response);

  if (!detail) {
    return {
      kind: "unknown-user",
      value: "",
      title: "",
      initials: "?",
      hue: null,
    };
  }

  const user: SessionUserDescription = describeUserFlowSessionOwner({
    ...detail,
    identifiedUserKey: person.identifiedUserKey,
  });

  return {
    kind: user.kind === "identified" ? "user" : "hidden",
    value: user.text,
    title: user.title,
    initials: user.initials,
    hue: user.hue,
  };
}

/* What the page needs to know about a session's footage. */
export interface UserFlowRecordingState {
  /* Footage may still arrive: the last page is not an exit yet. */
  isLive: boolean;
  isWatchable: boolean;
  /* Why there is nothing to watch; empty when there is. */
  reason: string;
}

/*
 * The shared answer to "is Watch an honest button", so the journey and the
 * session list cannot disagree. A session with no detail came from a read
 * that does not carry it: the same link the map's tables offer.
 */
export function getUserFlowRecordingState(
  detail: UserFlowSessionDetailDto | undefined,
  nowUnixMs: number,
): UserFlowRecordingState {
  if (!detail) {
    return { isLive: false, isWatchable: true, reason: "" };
  }

  const playability: SessionReplayPlayability = getSessionReplayPlayability(
    {
      isFinalized: detail.isFinalized,
      sealedReason: detail.sealedReason,
      chunkCount: detail.chunkCount,
      missingChunkCount: 0,
      hasRecordingEnded: detail.hasRecordingEnded,
    },
    nowUnixMs,
  );

  return {
    isLive: isSessionReplayRecordingLive(detail),
    isWatchable: playability.isWatchable,
    reason: playability.isWatchable ? "" : playability.tooltip,
  };
}

/* "/pricing → … → /checkout": a closed session, at a glance. */
export function summarizeUserFlowJourney(
  journey: UserFlowSessionJourney,
): string {
  const first: UserFlowVisit | undefined = journey.visits[0];
  const last: UserFlowVisit | undefined =
    journey.visits[journey.visits.length - 1];

  if (!first || !last) {
    return "";
  }

  if (journey.visits.length === 1) {
    return first.page;
  }

  return journey.visits.length === 2
    ? `${first.page} → ${last.page}`
    : `${first.page} → … → ${last.page}`;
}

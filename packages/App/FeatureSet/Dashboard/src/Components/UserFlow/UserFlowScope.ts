import { JSONObject } from "Common/Types/JSON";
import { SESSION_REPLAY_VISITOR_ID_PATTERN } from "Common/Types/Rum/SessionReplay";
import { SessionReplayUserKind } from "Common/Types/Rum/SessionReplayApi";
import { UserFlowScopeDto } from "Common/Types/Rum/UserFlow";
import { isLikelySessionId } from "../SessionReplay/SessionReplaySearchQuery";
import {
  describeSessionUser,
  describeUserRollup,
  SessionUserDescription,
  stableHue,
} from "../SessionReplay/SessionReplayUserIdentity";

/*
 * Whose journeys the User Flows page draws: everyone (null), one identified
 * user, one browser or one session.
 *
 * Every other control on the page re-folds journeys it already has. This one
 * goes to the server, because the read takes the newest sessions in the
 * window, and the person someone asks about may not be among them.
 *
 * A person is one of two things here. A reference someone typed ("jane@acme")
 * travels in the request body only, for the server to hash: it names a real
 * end user, so it never goes in the URL (see FILTER_URL_KEYS). A key is what
 * the server stores them under, which names nobody, so a link can carry it.
 * A person picked from a list has both: the key to ask with, the label to say
 * who it is.
 *
 * Plain TypeScript with no React and no Common/UI import, so node tests can
 * pin it.
 */

export type UserFlowScope =
  | { kind: "user"; identifiedUserKey: string; identifiedUserRef: string }
  | { kind: "visitor"; visitorId: string }
  | { kind: "session"; sessionId: string };

/*
 * The box takes what the session list's search box takes for these
 * (user:, visitor:, id:), and session: because people will type it.
 */
const USER_TOKEN: string = "user";
const VISITOR_TOKEN: string = "visitor";
const SESSION_TOKENS: ReadonlyArray<string> = ["id", "session"];

export const USER_FLOW_SCOPE_MAX_OPTIONS: number = 8;

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).trim()
    : value;
}

function userScope(reference: string): UserFlowScope {
  return { kind: "user", identifiedUserKey: "", identifiedUserRef: reference };
}

/*
 * What someone typed, or null when it cannot be asked: nothing yet, or a
 * token whose value could never match. A bare long hex string is taken for a
 * session id, the one thing in this box people paste rather than type; a
 * reference of that shape is reached with user:. Everything else is a
 * reference, however it looks: they are opaque, and a customer's own ids
 * come in every shape.
 */
export function parseUserFlowScopeInput(text: string): UserFlowScope | null {
  const value: string = text.trim();

  if (!value) {
    return null;
  }

  const separator: number = value.indexOf(":");
  const token: string =
    separator > 0 ? value.slice(0, separator).toLowerCase() : "";
  const rest: string = unquote(value.slice(separator + 1).trim());

  if (token === USER_TOKEN) {
    return rest ? userScope(rest) : null;
  }

  if (token === VISITOR_TOKEN) {
    const visitorId: string = rest.toLowerCase();

    return SESSION_REPLAY_VISITOR_ID_PATTERN.test(visitorId)
      ? { kind: "visitor", visitorId: visitorId }
      : null;
  }

  if (SESSION_TOKENS.includes(token)) {
    return isLikelySessionId(rest)
      ? { kind: "session", sessionId: rest.toLowerCase() }
      : null;
  }

  if (isLikelySessionId(value)) {
    return { kind: "session", sessionId: value.toLowerCase() };
  }

  return userScope(unquote(value));
}

/* The endpoint's `filters`. The key wins: it needs no hashing and no gate. */
export function getUserFlowScopeFilters(scope: UserFlowScope): JSONObject {
  switch (scope.kind) {
    case "user":
      return scope.identifiedUserKey
        ? { identifiedUserKey: scope.identifiedUserKey }
        : { identifiedUserRef: scope.identifiedUserRef };
    case "visitor":
      return { visitorId: scope.visitorId };
    case "session":
      return { sessionId: scope.sessionId };
  }
}

/* Changes exactly when the request would: a label learned later does not. */
export function getUserFlowScopeKey(scope: UserFlowScope | null): string {
  return scope ? JSON.stringify(getUserFlowScopeFilters(scope)) : "";
}

/*
 * Did the server narrow the read as asked? An answer that says otherwise holds
 * other people's journeys, and must not be drawn under this person's name. It
 * takes a server older than the Dashboard, which ignores the filter.
 */
export function isUserFlowResponseForScope(
  scope: UserFlowScope | null,
  applied: UserFlowScopeDto | null,
): boolean {
  if (!scope) {
    return applied === null;
  }

  if (applied?.kind !== scope.kind) {
    return false;
  }

  switch (scope.kind) {
    case "user":
      return (
        !scope.identifiedUserKey ||
        scope.identifiedUserKey === applied.identifiedUserKey
      );
    case "visitor":
      return scope.visitorId === applied.visitorId;
    case "session":
      return scope.sessionId === applied.sessionId;
  }
}

/* A row of the Users rollup as a scope. Null for the unlinked bucket. */
export function getUserFlowScopeOfRollup(row: {
  kind: SessionReplayUserKind;
  identifiedUserKey: string;
  visitorId: string;
  identifiedUserLabel?: string | undefined;
}): UserFlowScope | null {
  if (row.kind === "identified" && row.identifiedUserKey) {
    return {
      kind: "user",
      identifiedUserKey: row.identifiedUserKey,
      identifiedUserRef: row.identifiedUserLabel ?? "",
    };
  }

  if (row.kind === "visitor" && row.visitorId) {
    return { kind: "visitor", visitorId: row.visitorId };
  }

  return null;
}

/* Whoever a session belongs to, to widen from it to them. */
export function getUserFlowScopeOfSessionOwner(
  applied: UserFlowScopeDto | null,
): UserFlowScope | null {
  if (applied?.kind !== "session") {
    return null;
  }

  return getUserFlowScopeOfRollup({
    kind: applied.identifiedUserKey ? "identified" : "visitor",
    identifiedUserKey: applied.identifiedUserKey,
    visitorId: applied.visitorId,
    identifiedUserLabel: applied.identifiedUserLabel,
  });
}

/*
 * The person a scope is about, by the one ranking every other screen uses,
 * or an empty text while nothing says who that is: the read is still running,
 * or no session in the window names them. The page words that case itself.
 * Null for a session: see describeUserFlowSessionOwner.
 */
export function describeUserFlowScopePerson(
  scope: UserFlowScope,
  applied: UserFlowScopeDto | null,
): SessionUserDescription | null {
  if (scope.kind === "session") {
    return null;
  }

  if (scope.kind === "visitor") {
    return describeUserRollup({
      kind: "visitor",
      identifiedUserKey: "",
      visitorId: scope.visitorId,
      isIdentityVisible: false,
    });
  }

  const key: string =
    scope.identifiedUserKey || applied?.identifiedUserKey || "";
  const label: string =
    scope.identifiedUserRef || applied?.identifiedUserLabel || "";
  const isHidden: boolean =
    !label && applied !== null && applied.identifiedUserLabel === undefined;

  if (label || isHidden) {
    return describeUserRollup({
      kind: "identified",
      identifiedUserKey: key,
      visitorId: "",
      identifiedUserLabel: label,
      isIdentityVisible: !isHidden,
    });
  }

  return {
    kind: "identified",
    text: "",
    title: "",
    initials: "?",
    hue: key ? stableHue(key) : null,
    filter: null,
  };
}

/* Who a session belongs to, or null when nothing links it to anyone. */
export function describeUserFlowSessionOwner(
  applied: UserFlowScopeDto | null,
): SessionUserDescription | null {
  if (!getUserFlowScopeOfSessionOwner(applied) || !applied) {
    return null;
  }

  /*
   * No key means nobody was identified, so there is nothing to hide from a
   * role without the identity permission: it is a visitor to them as well.
   */
  return describeSessionUser({
    identifiedUserLabel: applied.identifiedUserLabel ?? "",
    isIdentityVisible:
      !applied.identifiedUserKey || applied.identifiedUserLabel !== undefined,
    identifiedUserKey: applied.identifiedUserKey,
    visitorId: applied.visitorId,
  });
}

/* One row of the filter's list. */
export type UserFlowScopeOption =
  | { kind: "typed"; id: string; scope: UserFlowScope; text: string }
  | {
      kind: "person";
      id: string;
      scope: UserFlowScope;
      person: SessionUserDescription;
      sessionCount: number;
    };

export interface UserFlowScopeOptionUser {
  groupKey: string;
  kind: SessionReplayUserKind;
  identifiedUserKey: string;
  visitorId: string;
  identifiedUserLabel?: string | undefined;
  isIdentityVisible: boolean;
  sessionCount: number;
}

/*
 * What the filter offers for the text so far: the text itself, when it can be
 * asked, then the people seen in the range whose name or visitor id holds it.
 * The list is a page of the newest people, so it helps, and only the typed
 * row can reach everyone: a person can be found here without being listed.
 */
export function buildUserFlowScopeOptions(
  text: string,
  users: Array<UserFlowScopeOptionUser>,
): Array<UserFlowScopeOption> {
  const needle: string = text.trim().toLowerCase();
  const people: Array<UserFlowScopeOption> = [];

  for (const user of users) {
    const scope: UserFlowScope | null = getUserFlowScopeOfRollup(user);

    if (!scope) {
      continue;
    }

    const person: SessionUserDescription = describeUserRollup(user);
    const isMatch: boolean =
      !needle ||
      person.text.toLowerCase().includes(needle) ||
      user.visitorId.includes(needle);

    if (isMatch) {
      people.push({
        kind: "person",
        id: user.groupKey,
        scope: scope,
        person: person,
        sessionCount: user.sessionCount,
      });
    }
  }

  const typed: UserFlowScope | null = parseUserFlowScopeInput(text);
  const isListed: boolean = people.some(
    (option: UserFlowScopeOption): boolean => {
      return (
        option.kind === "person" && option.person.text.toLowerCase() === needle
      );
    },
  );

  const options: Array<UserFlowScopeOption> =
    typed && !isListed
      ? [{ kind: "typed", id: "typed", scope: typed, text: text.trim() }]
      : [];

  return [...options, ...people].slice(0, USER_FLOW_SCOPE_MAX_OPTIONS);
}

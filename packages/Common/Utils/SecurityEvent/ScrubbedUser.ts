import { JSONObject } from "../../Types/JSON";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  ScrubPlaceholderKind,
  getScrubPlaceholderKind,
} from "../../Types/Telemetry/ScrubRule";

// Where a request's user is kept on its event: enduser.id.
const REQUEST_USER_ATTRIBUTE: string = SECURITY_REQUEST_ATTRIBUTES.userId;

/*
 * A USER A SCRUB RULE HID (#10435).
 *
 * Security Events reads logs and traces after ingest's scrub rules have run,
 * so where a rule hid a user it reads what the rule left: the principal user
 * of an OpenTelemetry request (enduser.id, user.id), an AI call's user, a
 * cloud audit log's principalEmail, an SSH line's account. Taken as the
 * user, "[REDACTED]" was one account everybody shared:
 *
 *   - "Repeated failed sign-ins for one account" (15 failures of one user)
 *     summed everyone's failures into one false case, and "Password
 *     spraying" (five users from one address) could never fire;
 *   - the case's user was "[REDACTED]", and a playbook offered to suspend it.
 *
 * So every event's user is read through readEventUser, where the events of
 * logs and telemetry are made (buildLogSecurityEvent, buildTelemetry
 * SecurityEvent, the request trace follow-up):
 *
 *   - Redact's "[REDACTED]" and a mask stand for everybody a rule hid: the
 *     event has no user. With #10415, a rule that counts per user leaves
 *     it out rather than count it as one, and Run on Past Events says how
 *     many a scrub rule hid;
 *   - a Hash token stands for one user, the same every time, so it stays
 *     the user - "Repeated failed sign-ins" still counts per account, and
 *     "Password spraying" still tells five apart - but it is never an
 *     account to act on (SecurityEntity's getEntityAsActionable).
 *
 * Either way the event says so: its marker holds what the rule left and
 * whether it was in a log or a span, never the user, which the rule was set
 * to hide.
 */

// Which of an event's users a rule hid: the one who acted, or the one acted on.
export enum ScrubbedUserRole {
  Principal = "principal",
  Target = "target",
}

// The kind of record the user was read from, and so whose scrub rules hid it.
export type ScrubbedUserSignal = "log" | "trace";

// The value of the marker's "hidden" attribute: a scrub rule hid it.
export const USER_HIDDEN_BY_SCRUB_RULE: string = "scrub-rule";

// The marker's attributes, per role.
export const SCRUBBED_USER_ATTRIBUTES: Readonly<
  Record<ScrubbedUserRole, { hidden: string; scrubbed: string; in: string }>
> = {
  [ScrubbedUserRole.Principal]: {
    hidden: "oneuptime.principal_user_hidden",
    scrubbed: "oneuptime.principal_user_scrubbed",
    in: "oneuptime.principal_user_scrubbed_in",
  },
  [ScrubbedUserRole.Target]: {
    hidden: "oneuptime.target_user_hidden",
    scrubbed: "oneuptime.target_user_scrubbed",
    in: "oneuptime.target_user_scrubbed_in",
  },
};

// The longest value a marker keeps of what the rule left.
const MAX_SCRUBBED_USER_LENGTH: number = 255;

export interface ScrubbedUser {
  kind: ScrubPlaceholderKind;
  // What the rule left: "[REDACTED]", a mask, or a token.
  value: string;
}

export interface EventUserReading {
  /*
   * The user the event names: the value as read, a Hash token included,
   * or "" when Redact or Mask hid it.
   */
  user: string;
  // What a scrub rule left, when one did.
  scrubbed: ScrubbedUser | null;
}

function cut(text: string): string {
  return text.length > MAX_SCRUBBED_USER_LENGTH
    ? `${text.slice(0, MAX_SCRUBBED_USER_LENGTH - 1)}…`
    : text;
}

// A user as an event names it: see the file's comment.
export function readEventUser(
  value: string | null | undefined,
): EventUserReading {
  const text: string = (value || "").trim();
  const kind: ScrubPlaceholderKind | null = getScrubPlaceholderKind(text);

  if (!kind) {
    return { user: text, scrubbed: null };
  }

  return {
    user: kind === ScrubPlaceholderKind.Hashed ? text : "",
    scrubbed: { kind, value: cut(text) },
  };
}

/*
 * Of the values a record names its user by, in the order they are
 * preferred (an AI call's user, then enduser.id, then user.id), the one an
 * event names: the first that no rule touched, else the first a Hash rule
 * left, else the first Redact or Mask left (so the event says a rule hid
 * it), else "". A rule that hid one of them falls back to what is left.
 */
export function pickEventUser(
  values: ReadonlyArray<string | null | undefined>,
): string {
  const texts: Array<string> = values
    .map((value: string | null | undefined): string => {
      return (value || "").trim();
    })
    .filter((text: string): boolean => {
      return text !== "";
    });

  for (const kind of [
    null,
    ScrubPlaceholderKind.Hashed,
    ScrubPlaceholderKind.Redacted,
    ScrubPlaceholderKind.Masked,
  ]) {
    const found: string | undefined = texts.find((text: string): boolean => {
      return getScrubPlaceholderKind(text) === kind;
    });

    if (found !== undefined) {
      return found;
    }
  }

  return "";
}

// The event's user of a role was hidden by a scrub rule: what it left, and where.
export function markEventUserScrubbed(
  attributes: JSONObject,
  data: {
    role: ScrubbedUserRole;
    scrubbed: ScrubbedUser;
    signal?: ScrubbedUserSignal | undefined;
  },
): void {
  const keys: { hidden: string; scrubbed: string; in: string } =
    SCRUBBED_USER_ATTRIBUTES[data.role];

  attributes[keys.hidden] = USER_HIDDEN_BY_SCRUB_RULE;
  attributes[keys.scrubbed] = data.scrubbed.value;

  if (data.signal) {
    attributes[keys.in] = data.signal;
  } else {
    delete attributes[keys.in];
  }
}

/*
 * The event names its user of a role after all - the request's trace held
 * the user a log's rule hid - so nothing of the marker is left to say
 * otherwise.
 */
export function clearEventUserScrubbed(
  attributes: JSONObject,
  role: ScrubbedUserRole,
): void {
  const keys: { hidden: string; scrubbed: string; in: string } =
    SCRUBBED_USER_ATTRIBUTES[role];

  delete attributes[keys.hidden];
  delete attributes[keys.scrubbed];
  delete attributes[keys.in];
}

/*
 * The users of an event, read and marked in one go: what buildLogSecurity
 * Event and buildTelemetrySecurityEvent name, with the marker for each a
 * rule hid written into `attributes`.
 */
export function readEventUsers(data: {
  principalUser: string | null | undefined;
  targetUser: string | null | undefined;
  attributes: JSONObject;
  signal?: ScrubbedUserSignal | undefined;
}): { principalUser: string; targetUser: string } {
  const principal: EventUserReading = readEventUser(data.principalUser);
  const target: EventUserReading = readEventUser(data.targetUser);

  if (principal.scrubbed) {
    markEventUserScrubbed(data.attributes, {
      role: ScrubbedUserRole.Principal,
      scrubbed: principal.scrubbed,
      signal: data.signal,
    });
  }

  if (target.scrubbed) {
    markEventUserScrubbed(data.attributes, {
      role: ScrubbedUserRole.Target,
      scrubbed: target.scrubbed,
      signal: data.signal,
    });
  }

  return { principalUser: principal.user, targetUser: target.user };
}

function readAttribute(attributes: unknown, key: string): string {
  if (!attributes || typeof attributes !== "object") {
    return "";
  }

  const value: unknown = Object.prototype.hasOwnProperty.call(attributes, key)
    ? (attributes as Record<string, unknown>)[key]
    : undefined;

  return typeof value === "string" ? value.trim() : "";
}

/*
 * A USER SECURITY EVENTS NAMED BEHIND A HASH TOKEN (#10632).
 *
 * A Hash token stands for one user, and Security Events' user vault knows
 * which, for the users a Hash rule hid where it reads one
 * (Server/Utils/SecurityEvent/UserVault). A scan names the event's user by
 * the vault, before the event is stored: the user is the account the
 * token stood for, so rules, cases, playbooks and every check read it as
 * any other user, and the marker that said a rule hid it is cleared. What
 * the rule left is kept beside it, so the logs and traces that hold only
 * the token can still be searched for it.
 */
export const HASHED_USER_ATTRIBUTES: Readonly<
  Record<ScrubbedUserRole, string>
> = {
  [ScrubbedUserRole.Principal]: "oneuptime.principal_user_hashed_as",
  [ScrubbedUserRole.Target]: "oneuptime.target_user_hashed_as",
};

/*
 * A USER ERASED FROM THE USER VAULT ON REQUEST (#10908).
 *
 * An erasure puts the token back where the vault had named the user: the
 * event's user is what the rule left again, the marker says a scrub rule
 * hid it, and this says why it no longer names anybody - so the event's
 * panel can say "Erased on request" beside the token. Never who it was.
 */
export const ERASED_USER_ATTRIBUTES: Readonly<
  Record<ScrubbedUserRole, string>
> = {
  [ScrubbedUserRole.Principal]: "oneuptime.principal_user_erased",
  [ScrubbedUserRole.Target]: "oneuptime.target_user_erased",
};

// The value of the erased attribute: an erasure request took the user out.
export const USER_ERASED_ON_REQUEST: string = "erasure-request";

// Whether an erasure request took the event's user of a role out (#10908).
export function isEventUserErased(
  event: { attributes?: unknown },
  role: ScrubbedUserRole,
): boolean {
  return (
    readAttribute(event.attributes, ERASED_USER_ATTRIBUTES[role]) ===
    USER_ERASED_ON_REQUEST
  );
}

/*
 * What a Hash rule left of an event's user of a role, when Security Events
 * named the user behind it (#10632): the token the logs and traces hold in
 * the user's place, or "" when the event names its user as it was read.
 */
export function readHashedEventUser(
  event: { attributes?: unknown },
  role: ScrubbedUserRole,
): string {
  return readAttribute(event.attributes, HASHED_USER_ATTRIBUTES[role]);
}

// The roles, in the order an event's users are read.
export const SCRUBBED_USER_ROLES: ReadonlyArray<ScrubbedUserRole> = [
  ScrubbedUserRole.Principal,
  ScrubbedUserRole.Target,
];

// What a rule left of an event's user of a role: its user as stored.
export function readEventUserOfRole(
  event: {
    principalUser?: string | undefined;
    targetUser?: string | undefined;
  },
  role: ScrubbedUserRole,
): string {
  return (
    (role === ScrubbedUserRole.Principal
      ? event.principalUser
      : event.targetUser) || ""
  ).trim();
}

/*
 * The event names its user of a role after all: `named`, the user the
 * vault holds behind what the rule left (`hashed`). The user, among the
 * observables in the token's place, and the request's user when it was
 * the token; the marker cleared, and what the rule left kept beside it.
 */
export function nameHashedEventUser(
  event: {
    principalUser?: string | undefined;
    targetUser?: string | undefined;
    observables?: Array<string> | undefined;
    attributes: JSONObject;
  },
  data: { role: ScrubbedUserRole; hashed: string; named: string },
): void {
  const named: string = data.named.trim();

  if (!named) {
    return;
  }

  if (data.role === ScrubbedUserRole.Principal) {
    event.principalUser = named;
  } else {
    event.targetUser = named;
  }

  const hashed: string = data.hashed.toLowerCase();
  const observables: Array<string> = (event.observables || []).filter(
    (observable: string): boolean => {
      return observable.toLowerCase() !== hashed;
    },
  );

  if (
    !observables.some((observable: string): boolean => {
      return observable.toLowerCase() === named.toLowerCase();
    })
  ) {
    observables.push(named);
  }

  event.observables = observables;

  // The request's user, as a span named it (TraceSignals, RequestFollowUp).
  if (
    data.role === ScrubbedUserRole.Principal &&
    event.attributes[REQUEST_USER_ATTRIBUTE] === data.hashed
  ) {
    event.attributes[REQUEST_USER_ATTRIBUTE] = named;
  }

  clearEventUserScrubbed(event.attributes, data.role);
  event.attributes[HASHED_USER_ATTRIBUTES[data.role]] = data.hashed;
}

// A user a scrub rule hid, as an event says it.
export interface HiddenEventUser {
  kind: ScrubPlaceholderKind;
  // What the rule left.
  value: string;
  // The kind of record it was read from, when the event says.
  signal: ScrubbedUserSignal | null;
}

/*
 * The user of a role a scrub rule hid from an event, or null when the event
 * carries no marker - what the pages read, so an event says "hidden by a
 * scrub rule" where it would have named the user.
 */
export function readHiddenEventUser(
  event: { attributes?: unknown },
  role: ScrubbedUserRole,
): HiddenEventUser | null {
  const keys: { hidden: string; scrubbed: string; in: string } =
    SCRUBBED_USER_ATTRIBUTES[role];

  if (
    readAttribute(event.attributes, keys.hidden) !== USER_HIDDEN_BY_SCRUB_RULE
  ) {
    return null;
  }

  const value: string = readAttribute(event.attributes, keys.scrubbed);
  const signal: string = readAttribute(event.attributes, keys.in);

  return {
    kind: getScrubPlaceholderKind(value) || ScrubPlaceholderKind.Redacted,
    value,
    signal: signal === "log" || signal === "trace" ? signal : null,
  };
}

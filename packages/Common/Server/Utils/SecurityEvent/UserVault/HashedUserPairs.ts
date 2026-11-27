import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { SecurityLogLine } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import PercentDecodedText from "../../../../Utils/DataSecurity/PercentDecodedText";
import PlusAsSpaceText from "../../../../Utils/DataSecurity/PlusAsSpaceText";
import ScrubHashToken from "../../Telemetry/ScrubHashToken";

/*
 * WHICH USER A HASH RULE'S TOKEN STANDS FOR, WORKED OUT AT INGEST (#10632).
 *
 * Ingest has what a place held before the project's scrub rules ran and
 * what they left there (the scrub engines hand both over: ScrubAction's
 * ScrubHashedUserRecorder). A Hash rule replaces what it matches with the
 * project's token for it, and leaves the rest as it was, so a value with
 * one token in it - the whole value ("[HASHED:3f9a...]") or a part of it
 * ("auth0|[HASHED:3f9a...]") - names what the token replaced: the text
 * before it and after it are the value's own, and the token stood for the
 * text between them.
 *
 * Kept only when the token is worked out of that text again
 * (ScrubHashToken.ofValue, with the project's key): so the vault holds
 * nothing a Hash rule did not really hash - not a value a Redact or Mask
 * rule hid, not a token a sender wrote, not a guess where two values do
 * not line up. A value with two tokens or more, or a token of the form made
 * before tokens had a key, is not read: it stays hidden.
 *
 * Where a user is read, and so where one is kept:
 *
 *   - a span's users, as the trace scan reads them (the scrub engine hands
 *     over enduser.id, user.id and an AI call's user: readHashedUserPair);
 *   - a log line's users, as Security Events' own log parsers read them
 *     (readHashedUsersOfLogLine): the line is read before the rules and as
 *     they left it, and each event's principal and target user paired. So
 *     a cloud audit log's principal, an SSH sign-in's account, a firewall's
 *     user are kept exactly where Security Events would have named them
 *     unscrubbed, and nowhere else: never a token in a message, an email in
 *     an error, a card number a Hash rule hashed.
 */

// A Hash rule's token of today's form, anywhere in a text.
const TOKEN_IN_TEXT: RegExp = /\[HASHED:[0-9a-f]{16}\]/g;

// A token and the user it stands for.
export interface HashedUserPair {
  token: string;
  user: string;
}

// Every token of today's form a text holds, in order.
export function readHashTokens(text: string): Array<string> {
  return (typeof text === "string" ? text.match(TOKEN_IN_TEXT) : null) || [];
}

/*
 * The user one token in `after` stands for, from `before`: the text the
 * token took the place of, when the rest of the two values line up and the
 * project's token for that text is the token. Null otherwise.
 */
export function readHashedUserPair(data: {
  projectId: ObjectID | string;
  before: string;
  after: string;
}): HashedUserPair | null {
  const before: string = typeof data.before === "string" ? data.before : "";
  const after: string = typeof data.after === "string" ? data.after : "";
  const tokens: Array<string> = readHashTokens(after);

  if (tokens.length !== 1 || !before) {
    return null;
  }

  const token: string = tokens[0]!;
  const at: number = after.indexOf(token);
  const prefix: string = after.slice(0, at);
  const suffix: string = after.slice(at + token.length);

  if (
    before.length <= prefix.length + suffix.length ||
    !before.startsWith(prefix) ||
    !before.endsWith(suffix)
  ) {
    return null;
  }

  const hidden: string = before.slice(
    prefix.length,
    before.length - suffix.length,
  );

  /*
   * As written, or as an Email Address Hash rule reads what it hides: an
   * address in a percent-encoded URL is the address it reads as, and its
   * token that address's (ScrubAction.asItReads, #10935) - or as a Custom
   * Regex Hash rule reads a match it found only with its "+"s read as the
   * spaces a query string writes them for (readScrubMatch, #11199). The
   * user kept is the value the token was made of.
   */
  for (const value of new Set<string>([
    hidden,
    PercentDecodedText.readableOf(hidden),
    PlusAsSpaceText.readableOf(hidden),
  ])) {
    if (
      ScrubHashToken.ofValue({ projectId: data.projectId, value }) === token
    ) {
      return { token, user: value.trim() };
    }
  }

  return null;
}

function asAttributes(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

// Whether a line, as the rules left it, holds a token of today's form.
export function doesLogRowHoldHashToken(logRow: JSONObject): boolean {
  if (readHashTokens(String(logRow["body"] ?? "")).length > 0) {
    return true;
  }

  return Object.values(asAttributes(logRow["attributes"])).some(
    (value: unknown): boolean => {
      return typeof value === "string" && readHashTokens(value).length > 0;
    },
  );
}

/*
 * Every token of today's form a line holds as the rules left it, in its
 * body and its top-level text attributes: what the line could name.
 */
export function readLogRowHashTokens(logRow: JSONObject): Array<string> {
  const tokens: Set<string> = new Set<string>(
    readHashTokens(String(logRow["body"] ?? "")),
  );

  for (const value of Object.values(asAttributes(logRow["attributes"]))) {
    if (typeof value === "string") {
      for (const token of readHashTokens(value)) {
        tokens.add(token);
      }
    }
  }

  return Array.from(tokens);
}

/*
 * The users a log line's tokens stand for, where Security Events' log
 * parsers read a user (SecurityLogParser): the line as the rules left it
 * is read first, and only when it is a line the log scan reads
 * (SECURITY_LOG_PREFILTER, as the database reads it) and one of its events
 * names a user that holds a token is it read again as it was - its body,
 * and its top-level text attributes, before the rules. Each event of the
 * one is paired with the same event of the other; a line read into a
 * different number of events pairs nothing.
 */
export function readHashedUsersOfLogLine(data: {
  projectId: ObjectID | string;
  bodyBefore: string;
  attributesBefore: JSONObject;
  logRow: JSONObject;
}): Array<HashedUserPair> {
  const bodyAfter: string =
    typeof data.logRow["body"] === "string"
      ? (data.logRow["body"] as string)
      : "";
  const attributesAfter: JSONObject = asAttributes(data.logRow["attributes"]);

  if (
    !doesLogRowHoldHashToken(data.logRow) ||
    !matchesSecurityLogPrefilter(bodyAfter)
  ) {
    return [];
  }

  const time: Date = new Date();
  const afterEvents: Array<NormalizedSecurityEvent> = SecurityLogParser.parse({
    body: bodyAfter,
    attributes: attributesAfter,
    time,
  });

  const namesToken: boolean = afterEvents.some(
    (event: NormalizedSecurityEvent): boolean => {
      return (
        readHashTokens(event.principalUser || "").length > 0 ||
        readHashTokens(event.targetUser || "").length > 0
      );
    },
  );

  if (!namesToken) {
    return [];
  }

  const before: SecurityLogLine = {
    body: data.bodyBefore,
    // Lists and maps as the rules left them: a user Security Events reads is a text.
    attributes: { ...attributesAfter, ...data.attributesBefore },
    time,
  };
  const beforeEvents: Array<NormalizedSecurityEvent> =
    SecurityLogParser.parse(before);

  if (beforeEvents.length !== afterEvents.length) {
    return [];
  }

  const pairs: Array<HashedUserPair> = [];

  afterEvents.forEach((after: NormalizedSecurityEvent, index: number): void => {
    const was: NormalizedSecurityEvent = beforeEvents[index]!;

    for (const [userBefore, userAfter] of [
      [was.principalUser, after.principalUser],
      [was.targetUser, after.targetUser],
    ] as Array<[string | undefined, string | undefined]>) {
      const pair: HashedUserPair | null = readHashedUserPair({
        projectId: data.projectId,
        before: userBefore || "",
        after: userAfter || "",
      });

      if (pair) {
        pairs.push(pair);
      }
    }
  });

  return pairs;
}

import ObjectID from "../../../../../../Types/ObjectID";
import Crypto from "../../../../../../Utils/Crypto";
import { normalizeExceptionText } from "../../../../Telemetry/ExceptionSanitizer";

/*
 * Shared exception identity for the two exception detectors (NewException and
 * ExceptionSpike).
 *
 * THE PROBLEM THIS SOLVES. A TelemetryException GROUP is keyed at ingest on
 * sha256(projectId + primaryEntityId + normalizedMessage + normalizedStackTrace
 * + exceptionType) — the STACK TRACE is part of that key. One logical failure
 * raised from several call sites is therefore several groups, and a detector
 * that emits one insight per group files the same finding several times over.
 * Worse, the insight TITLE used to be the exceptionType alone, so those rows
 * were not merely duplicated, they were indistinguishable: a service whose
 * instrumentation reports `exception.type = "401"` produced a wall of
 * identical "New exception: 401 in api" rows.
 *
 * THE FAILURE MODE is the unit a human actually triages: one service, one
 * exception type, one normalized message. Everything below that (which call
 * stack it surfaced on) is detail that belongs inside the insight, not a
 * separate row in the inbox.
 */

/*
 * How much of the message rides in the insight title. Titles must stay
 * scannable in a list, but they must also carry enough of the message to tell
 * two findings apart — the type alone frequently cannot (HTTP status codes,
 * bare `Error`, `Exception`).
 */
export const EXCEPTION_LABEL_MESSAGE_MAX_LENGTH: number = 80;

/*
 * Human label for an exception: the type AND the message, because either one
 * alone collides. `TypeError` is not a finding; `TypeError: Cannot read
 * properties of undefined (reading 'user')` is.
 *
 * Only the message is truncated (the type is short by construction), so a
 * label is never longer than the type plus the cap plus the separator.
 */
export function buildExceptionLabel(
  exceptionType: string | undefined,
  message: string | undefined,
  messageMaxLength: number = EXCEPTION_LABEL_MESSAGE_MAX_LENGTH,
): string {
  const type: string = (exceptionType || "").trim();
  const fullMessage: string = (message || "").trim();

  if (!type && !fullMessage) {
    return "Unknown exception";
  }

  if (!fullMessage) {
    return type;
  }

  const shortMessage: string =
    fullMessage.length <= messageMaxLength
      ? fullMessage
      : `${fullMessage.slice(0, messageMaxLength)}…`;

  if (!type) {
    return shortMessage;
  }

  /*
   * Runtimes routinely prefix the message with the type ("Error: connect
   * ECONNREFUSED", "ValueError: invalid literal"), and some SDKs report the
   * message as the type verbatim. Saying it twice reads as a bug.
   */
  const lowerType: string = type.toLowerCase();
  const lowerMessage: string = fullMessage.toLowerCase();

  if (
    lowerMessage === lowerType ||
    lowerMessage.startsWith(`${lowerType}:`) ||
    lowerMessage.startsWith(`${lowerType} `)
  ) {
    return shortMessage;
  }

  return `${type}: ${shortMessage}`;
}

/*
 * Stable identity of a FAILURE MODE — the dedupe key insights are filed under.
 *
 * (entity, type, normalized message) and deliberately NOT the stack trace:
 * collapsing stack-trace-only variants of one failure into one insight is the
 * entire point. The entity id stays in the clear so a fingerprint is greppable
 * back to a service, and it guarantees the key can never collide across
 * services; the type+message half is hashed so an unbounded telemetry string
 * cannot blow past the fingerprint column.
 *
 * `${exceptionType}|${normalizeExceptionText(message)}` is the SAME signature
 * TelemetryExceptionService.validateNoOpenFixForSimilarException already uses
 * to stop the fix lane opening near-identical pull requests for one throw site
 * ("observed: 15 near-identical PRs for one invalid-uuid throw site"). The
 * insight lane had no equivalent — this is that same rule, applied one stage
 * earlier so the duplicates never reach the inbox in the first place.
 *
 * The RAW message is normalized here rather than the sanitized one: the
 * fingerprint is an identity that MUST stay byte-for-byte stable across ticks
 * and releases (a key that drifts files a duplicate on every drift), and
 * normalizeExceptionText carries exactly that stability contract, while the
 * secret redactor layered on top of it for display does not.
 */
export function buildExceptionFailureModeKey(data: {
  primaryEntityId: ObjectID | undefined;
  exceptionType: string | undefined;
  message: string | undefined;
}): string {
  const entityId: string =
    data.primaryEntityId?.toString() || "unattributed-entity";
  const type: string = (data.exceptionType || "").trim();
  const normalizedMessage: string = normalizeExceptionText(
    (data.message || "").trim(),
  );

  const contentHash: string = Crypto.getSha256Hash(
    `${type}|${normalizedMessage}`,
  );

  return `${entityId}:${contentHash}`;
}

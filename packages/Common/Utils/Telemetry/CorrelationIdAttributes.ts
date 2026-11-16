import { LlmConversationIdAttributeKeys } from "../../Types/Telemetry/LlmConventions";

/*
 * THE IDS A RECORD IS FILED UNDER, AND THE ATTRIBUTES THEY ARE READ FROM.
 *
 * Ingest copies two ids out of a log's or a span's attributes into columns
 * of their own, which join the record to the rest of what happened:
 *
 *   - sessionId: the session the record belongs to, read from `session.id`
 *     or the resource's `resource.session.id` - the random id session
 *     replay files a recording under, which the browser and mobile
 *     recorders hand the page's own telemetry to stamp, and which a
 *     recording's Logs, Traces and Errors and a session's erasure find
 *     records by;
 *   - llmConversationId: on an AI call, the conversation it belongs to,
 *     read from the conversation keys (LlmConversationIdAttributeKeys).
 *
 * Both are correlation ids, as a trace id is - OpenTelemetry defines
 * `session.id` as the id of a visit, made by the client - not secrets. A
 * Sensitive Attribute Keys rule's key list names "session id" for the
 * login sessions sent as `session_id`, `sessionid`, `JSESSIONID` or in a
 * cookie, and used to hide the attribute a record's session id was read
 * from too, while the record kept the same id in its column: hidden in one
 * field and shown, searchable, in the next, it protected nothing, and the
 * column cannot be hidden without unlinking every record from its
 * recording and its erasure (#8924). So a Sensitive Attribute Keys rule
 * leaves an attribute alone when it holds the record's own id - the value
 * the record already stores - and hides every other value under such a key
 * as before: a `session.id` that holds something else than the record's
 * session (a backend's own session, under the recorder's), an event's, a
 * link's, one inside a list or a map.
 */

// Where a record's session id is read from, first to last.
export const SESSION_ID_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "session.id",
  /*
   * A browser or mobile SDK sets session.id once, on the resource, which
   * TelemetryUtil.getAttributes prefixes with "resource.". Reading only the
   * bare key would look correct in a unit test and fail in production.
   */
  "resource.session.id",
];

/*
 * Every attribute key a record's own id can be read from: what the Data
 * Security coverage of a Sensitive Attribute Keys rule leaves out, as the
 * rule may keep it.
 */
export const CORRELATION_ID_ATTRIBUTE_KEYS: ReadonlySet<string> =
  new Set<string>([
    ...SESSION_ID_ATTRIBUTE_KEYS,
    ...LlmConversationIdAttributeKeys,
  ]);

/*
 * A text, a number or true or false, as the record's column holds it; null
 * for a list, a map or nothing - no usable id.
 */
function asIdText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

/*
 * A record's session id, as ingest stores it in its sessionId column: the
 * first of SESSION_ID_ATTRIBUTE_KEYS that holds one, "" when none does. A
 * number or true or false is nonsense but harmless to read as text; a list
 * or a map is no join key, and the next key is read.
 */
export function readSessionIdFromAttributes(
  attributes: Record<string, unknown> | undefined,
): string {
  if (!attributes) {
    return "";
  }

  for (const key of SESSION_ID_ATTRIBUTE_KEYS) {
    const text: string | null = asIdText(attributes[key]);

    if (text !== null && text !== "") {
      return text;
    }
  }

  return "";
}

/*
 * The attribute keys of a record - a log row, a span row - that hold its
 * own session id or conversation id: the very value its sessionId or
 * llmConversationId column stores. Read before any rule changes them.
 */
export function correlationIdAttributeKeys(record: {
  attributes?: unknown;
  sessionId?: unknown;
  llmConversationId?: unknown;
}): Set<string> {
  const kept: Set<string> = new Set<string>();
  const attributes: unknown = record.attributes;

  if (!attributes || typeof attributes !== "object") {
    return kept;
  }

  const values: Record<string, unknown> = attributes as Record<string, unknown>;
  const sessionId: unknown = record.sessionId;

  if (typeof sessionId === "string" && sessionId !== "") {
    for (const key of SESSION_ID_ATTRIBUTE_KEYS) {
      if (asIdText(values[key]) === sessionId) {
        kept.add(key);
      }
    }
  }

  // Read as LlmSpan reads it: the text, trimmed.
  const conversationId: unknown = record.llmConversationId;

  if (typeof conversationId === "string" && conversationId !== "") {
    for (const key of LlmConversationIdAttributeKeys) {
      if (asIdText(values[key])?.trim() === conversationId) {
        kept.add(key);
      }
    }
  }

  return kept;
}

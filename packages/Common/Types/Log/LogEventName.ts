/*
 * The attribute a log record that is an event names that event in.
 *
 * OpenTelemetry SDKs used to send an event's name as the `event.name`
 * attribute (the Events API); since the Events API was folded into the Logs
 * API (opentelemetry-proto 1.5) they send it in the LogRecord's own
 * event_name field instead - Python's SDK from 1.39, for one - and most
 * instrumentations still set the attribute. Log ingest stamps the field onto
 * the attribute when a record does not set it, so every event is found by
 * one key, whichever SDK sent it: on the Logs page, in filters, and by the
 * reads that look for one kind of event (the AI conversations read of GenAI
 * events, for one).
 */
export const LogEventNameAttributeKey: string = "event.name";

// The longest event name kept; the spec recommends no more than 256.
export const LOG_EVENT_NAME_MAX_LENGTH: number = 1024;

export default class LogEventName {
  /*
   * A decoded OTLP log record's event name field - `eventName` as OTLP/JSON,
   * protobufjs and the gRPC loader all spell it, or `event_name` - or ""
   * when it sends none. A name past LOG_EVENT_NAME_MAX_LENGTH is not one.
   */
  public static fromRecord(record: unknown): string {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return "";
    }

    const fields: Record<string, unknown> = record as Record<string, unknown>;
    const name: unknown = fields["eventName"] ?? fields["event_name"];

    if (typeof name !== "string") {
      return "";
    }

    const trimmed: string = name.trim();

    return trimmed.length > LOG_EVENT_NAME_MAX_LENGTH ? "" : trimmed;
  }

  /*
   * Puts the record's event name field on its attribute map as
   * `event.name`, unless the record sets that attribute itself (what the
   * record says of itself wins). Returns whether it did.
   */
  public static stampOnAttributes(
    attributes: Record<string, unknown>,
    record: unknown,
  ): boolean {
    const existing: unknown = attributes[LogEventNameAttributeKey];

    if (
      existing !== undefined &&
      existing !== null &&
      !(typeof existing === "string" && existing.trim() === "")
    ) {
      return false;
    }

    const name: string = LogEventName.fromRecord(record);

    if (!name) {
      return false;
    }

    attributes[LogEventNameAttributeKey] = name;

    return true;
  }
}

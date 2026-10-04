/*
 * Which parts of a log a scrub rule scrubs. TraceScrubField is the same for
 * spans.
 */
enum LogScrubField {
  // The log message.
  Body = "body",
  // The values of the log's attributes.
  Attributes = "attributes",
  // The message and the attribute values: what a new rule scrubs.
  Both = "both",
}

export default LogScrubField;

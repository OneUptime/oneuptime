/*
 * The records a telemetry scan reads, by where they are kept.
 *
 * Its own module, importing nothing: the occurrence reads
 * (TelemetryFindingOccurrences) and the scrub rule proofs
 * (TelemetryScrubProof) name it while they load, and they can load in the
 * middle of the scanner (TelemetryDataScanner), which reaches them back
 * through the services it imports. An enum read from a module still
 * loading is undefined. The scanner re-exports it.
 */
export enum TelemetrySampleSource {
  Logs = "Logs",
  Traces = "Traces",
  Exceptions = "Exceptions",
  AiConversations = "AiConversations",
  RumLogs = "RumLogs",
  RumSpans = "RumSpans",
  RumSessions = "RumSessions",
  Metrics = "Metrics",
}

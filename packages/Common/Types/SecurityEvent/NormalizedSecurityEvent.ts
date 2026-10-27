import { JSONObject } from "../JSON";
import OcsfSeverity from "./OcsfSeverity";
import SecurityEventRequestOutcome from "./SecurityEventRequestOutcome";

/*
 * The canonical, dialect-neutral shape every ingested security event is
 * normalized into before it becomes a SecurityEvent ClickHouse row.
 *
 * Normalizers (OCSF, Google SecOps UDM, SecOps detection alerts, generic
 * JSON) each produce this; the ingest service maps it 1:1 onto table
 * columns. Keep this flat — nested source payloads are flattened into
 * `attributes` so arbitrary fields stay queryable without schema changes.
 */
export default interface NormalizedSecurityEvent {
  /*
   * Event time from the source payload; ingest falls back to "now" when the
   * source carries no usable timestamp.
   */
  time: Date;

  /*
   * Source-assigned unique id for the event (OCSF metadata.uid, UDM
   * metadata.id). Empty string when the source has none — ingest then
   * derives a content hash so repeated deliveries stay deduplicatable.
   */
  eventUid: string;

  categoryUid: number;
  categoryName: string;
  classUid: number;
  className: string;

  activityName: string;

  severityId: number;
  severityName: OcsfSeverity;

  /*
   * Outcome/status of the activity: Success, Failure, Blocked, Allowed, ...
   * Empty string when the source does not say.
   */
  statusName: string;

  /*
   * Human-readable one-line summary of the event.
   */
  message: string;

  vendorName: string;
  productName: string;

  /*
   * Detection rule provenance, when the event is a finding.
   */
  ruleId: string;
  ruleName: string;

  /*
   * MITRE ATT&CK references, e.g. tactics ["TA0006"], techniques ["T1110"].
   */
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;

  /*
   * Actor side of the event.
   */
  principalUser: string;
  principalHost: string;
  principalIp: string;
  principalProcess: string;

  /*
   * The process the event is about, and its parent - what Sigma's Image,
   * CommandLine, ParentImage and ParentCommandLine read. In Process
   * Activity that is the process that was started (or ended, or opened)
   * and the process that started it; in any other event it is the process
   * that acted (made the connection, wrote the file). Name is the file
   * name (powershell.exe), path the executable's full path. Empty when the
   * source does not say.
   */
  processName: string;
  processPath: string;
  processCommandLine: string;
  parentProcessName: string;
  parentProcessPath: string;
  parentProcessCommandLine: string;

  /*
   * Target side of the event.
   */
  targetUser: string;
  targetHost: string;
  targetIp: string;
  targetPort: number;
  targetResource: string;

  /*
   * Every extracted observable value (users, hostnames, IPs, hashes,
   * domains) in one array — powers "all events mentioning X" queries and
   * the entity-neighborhood graph via a single bloom-indexed column.
   */
  observables: Array<string>;

  /*
   * The full source payload, flattened to dot-notation keys with string
   * values.
   */
  attributes: JSONObject;

  /*
   * The request the event happened in, when the source carries its trace
   * context: a log line written inside a traced request, an event sent with
   * a W3C trace id. What links the event to its trace, its spans, the
   * exception it threw and the session it was part of. Absent (or empty)
   * when the source says nothing - every writer that predates them.
   */
  traceId?: string | undefined;
  spanId?: string | undefined;
  sessionId?: string | undefined;

  /*
   * How far that request got, as its trace shows
   * (Types/SecurityEvent/SecurityEventRequestOutcome). Absent when nobody
   * followed it.
   */
  requestOutcome?: SecurityEventRequestOutcome | undefined;
}

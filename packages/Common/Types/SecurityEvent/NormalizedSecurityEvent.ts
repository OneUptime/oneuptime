import { JSONObject } from "../JSON";
import OcsfSeverity from "./OcsfSeverity";

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
}

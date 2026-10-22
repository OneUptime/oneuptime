import IP from "../../../Types/IP/IP";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { SecurityEventRecord } from "./SecurityEventRecord";

/*
 * A OneUptime security event in the shape each SIEM takes it:
 *
 *   - Splunk: an HTTP Event Collector event - time in epoch seconds, host,
 *     source, sourcetype and index beside the event itself, whose fields
 *     use the names of Splunk's Common Information Model (src, src_ip,
 *     src_user, dest, dest_ip, dest_port, user, signature, severity...),
 *     so the Splunk security apps read them as they read their own.
 *     https://docs.splunk.com/Documentation/Splunk/latest/Data/FormateventsforHTTPEventCollector
 *   - Microsoft Sentinel: one row of the custom table the setup guide's
 *     data collection rule declares, its columns named and typed there
 *     (TimeGenerated first). Sentinel's analytics rules query the table.
 *     https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-ingestion-api-overview
 *   - Elastic: a document in Elastic Common Schema (ECS), so Elastic
 *     Security's detection rules, timelines and the SIEM app read it:
 *     event.kind is "alert" for what OneUptime found and "event" for the
 *     rest, and an address goes in an ECS ip field only when it is one.
 *     https://www.elastic.co/guide/en/ecs/current/index.html
 *
 * Empty values are left out everywhere, so a SIEM never sees a column of
 * blanks for what OneUptime did not know.
 */

// The OCSF category every finding belongs to: what OneUptime found, not what it saw.
const OCSF_FINDINGS_CATEGORY_UID: number = 2;
const OCSF_AUTHENTICATION_CLASS_UID: number = 3002;
const OCSF_PROCESS_ACTIVITY_CLASS_UID: number = 1007;
const OCSF_NETWORK_ACTIVITY_CLASS_UID: number = 4001;

export const SIEM_EVENT_SOURCE: string = "oneuptime";
const MAX_MESSAGE_LENGTH: number = 32 * 1024;

function cut(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

// Only the keys whose value says something.
function compact(values: JSONObject): JSONObject {
  const result: JSONObject = {};

  for (const key of Object.keys(values)) {
    const value: JSONValue | undefined = values[key];

    if (
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value as JSONObject).length === 0)
    ) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

export function validIpAddress(value: string): string {
  const candidate: string = (value || "").trim();

  return candidate && candidate.length <= 64 && IP.isIP(candidate)
    ? candidate
    : "";
}

function uniqueValues(values: Array<string>): Array<string> {
  return Array.from(
    new Set(
      values
        .map((value: string): string => {
          return value.trim();
        })
        .filter((value: string): boolean => {
          return value.length > 0;
        }),
    ),
  );
}

function isFinding(record: SecurityEventRecord): boolean {
  return record.categoryUid === OCSF_FINDINGS_CATEGORY_UID;
}

// OCSF status -> what happened, in the words CIM and ECS use.
function outcomeOf(record: SecurityEventRecord): "success" | "failure" | "" {
  const status: string = record.statusName.trim().toLowerCase();

  if (status === "success" || status === "allowed") {
    return "success";
  }

  if (
    status === "failure" ||
    status === "blocked" ||
    status === "denied" ||
    status === "quarantined"
  ) {
    return "failure";
  }

  return "";
}

function isoTime(date: Date | null): string {
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

/*
 * ---------------------------------------------------------------------
 * Splunk HTTP Event Collector
 * ---------------------------------------------------------------------
 */

export function toSplunkHecEvent(
  record: SecurityEventRecord,
  options: { index?: string | undefined; sourceType: string },
): JSONObject {
  const sourceIp: string = validIpAddress(record.principalIp);
  const destinationIp: string = validIpAddress(record.targetIp);
  const outcome: string = outcomeOf(record);

  const event: JSONObject = compact({
    message: cut(record.message, MAX_MESSAGE_LENGTH),
    time: isoTime(record.time),
    oneuptime_event_id: record.id,
    event_uid: record.eventUid,
    class_name: record.className,
    category_name: record.categoryName,
    activity_name: record.activityName,
    status: record.statusName,
    action:
      outcome === "success"
        ? "allowed"
        : outcome === "failure"
          ? "blocked"
          : "",
    severity: record.severityName.toLowerCase(),
    severity_id: record.severityId,
    vendor: record.vendorName,
    product: record.productName,
    vendor_product: [record.vendorName, record.productName]
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join(" "),
    signature: record.ruleName,
    signature_id: record.ruleId,
    mitre_attack_tactics: record.mitreTactics,
    mitre_attack_techniques: record.mitreTechniques,
    src_user: record.principalUser,
    src_host: record.principalHost,
    src_ip: sourceIp,
    src: sourceIp || record.principalHost,
    user: record.targetUser || record.principalUser,
    dest_host: record.targetHost,
    dest_ip: destinationIp,
    dest: destinationIp || record.targetHost,
    dest_port: record.targetPort > 0 ? record.targetPort : null,
    object: record.targetResource,
    process: record.processCommandLine || record.processName,
    process_name: record.processName,
    process_path: record.processPath,
    parent_process_name: record.parentProcessName,
    parent_process: record.parentProcessCommandLine,
    observables: record.observables,
    attributes: record.attributes,
  });

  const timeInSeconds: number =
    record.time && !Number.isNaN(record.time.getTime())
      ? Math.round(record.time.getTime()) / 1000
      : Date.now() / 1000;

  return compact({
    time: timeInSeconds,
    host: record.principalHost || SIEM_EVENT_SOURCE,
    source: SIEM_EVENT_SOURCE,
    sourcetype: options.sourceType,
    index: options.index || "",
    event,
  });
}

/*
 * ---------------------------------------------------------------------
 * Microsoft Sentinel (Azure Monitor Logs Ingestion API)
 * ---------------------------------------------------------------------
 */

/*
 * The custom table's columns, in the order the setup guide's table and
 * data collection rule declare them. The guide's JSON is tested against
 * this list, so the two cannot drift apart.
 */
export const SENTINEL_TABLE_COLUMNS: ReadonlyArray<{
  name: string;
  type: "datetime" | "string" | "int" | "dynamic";
}> = [
  { name: "TimeGenerated", type: "datetime" },
  { name: "EventId", type: "string" },
  { name: "EventUid", type: "string" },
  { name: "ClassName", type: "string" },
  { name: "CategoryName", type: "string" },
  { name: "ActivityName", type: "string" },
  { name: "Severity", type: "string" },
  { name: "SeverityId", type: "int" },
  { name: "Status", type: "string" },
  { name: "Message", type: "string" },
  { name: "VendorName", type: "string" },
  { name: "ProductName", type: "string" },
  { name: "RuleId", type: "string" },
  { name: "RuleName", type: "string" },
  { name: "MitreTactics", type: "dynamic" },
  { name: "MitreTechniques", type: "dynamic" },
  { name: "PrincipalUser", type: "string" },
  { name: "PrincipalHost", type: "string" },
  { name: "PrincipalIp", type: "string" },
  { name: "TargetUser", type: "string" },
  { name: "TargetHost", type: "string" },
  { name: "TargetIp", type: "string" },
  { name: "TargetPort", type: "int" },
  { name: "TargetResource", type: "string" },
  { name: "ProcessName", type: "string" },
  { name: "ProcessCommandLine", type: "string" },
  { name: "ParentProcessName", type: "string" },
  { name: "Observables", type: "dynamic" },
  { name: "Attributes", type: "dynamic" },
];

export function toSentinelRecord(record: SecurityEventRecord): JSONObject {
  return compact({
    TimeGenerated: isoTime(record.time) || new Date().toISOString(),
    EventId: record.id,
    EventUid: record.eventUid,
    ClassName: record.className,
    CategoryName: record.categoryName,
    ActivityName: record.activityName,
    Severity: record.severityName,
    SeverityId: record.severityId,
    Status: record.statusName,
    Message: cut(record.message, MAX_MESSAGE_LENGTH),
    VendorName: record.vendorName,
    ProductName: record.productName,
    RuleId: record.ruleId,
    RuleName: record.ruleName,
    MitreTactics: record.mitreTactics,
    MitreTechniques: record.mitreTechniques,
    PrincipalUser: record.principalUser,
    PrincipalHost: record.principalHost,
    PrincipalIp: record.principalIp,
    TargetUser: record.targetUser,
    TargetHost: record.targetHost,
    TargetIp: record.targetIp,
    TargetPort: record.targetPort > 0 ? record.targetPort : null,
    TargetResource: record.targetResource,
    ProcessName: record.processName,
    ProcessCommandLine: record.processCommandLine,
    ParentProcessName: record.parentProcessName,
    Observables: record.observables,
    Attributes: record.attributes,
  });
}

/*
 * ---------------------------------------------------------------------
 * Elastic (Elastic Common Schema)
 * ---------------------------------------------------------------------
 */

export const ECS_VERSION: string = "8.11.0";

// OCSF class -> ECS event.category, for the classes ECS has a category of.
function ecsCategories(record: SecurityEventRecord): Array<string> {
  if (record.classUid === OCSF_AUTHENTICATION_CLASS_UID) {
    return ["authentication"];
  }

  if (record.classUid === OCSF_PROCESS_ACTIVITY_CLASS_UID) {
    return ["process"];
  }

  if (
    record.classUid >= OCSF_NETWORK_ACTIVITY_CLASS_UID &&
    record.classUid < OCSF_NETWORK_ACTIVITY_CLASS_UID + 100
  ) {
    return ["network"];
  }

  if (isFinding(record)) {
    return ["intrusion_detection"];
  }

  return [];
}

export function toEcsDocument(record: SecurityEventRecord): JSONObject {
  const sourceIp: string = validIpAddress(record.principalIp);
  const destinationIp: string = validIpAddress(record.targetIp);

  return compact({
    "@timestamp": isoTime(record.time) || new Date().toISOString(),
    message: cut(record.message, MAX_MESSAGE_LENGTH),
    ecs: { version: ECS_VERSION },
    event: compact({
      kind: isFinding(record) ? "alert" : "event",
      category: ecsCategories(record),
      action: record.activityName,
      outcome: outcomeOf(record) || "unknown",
      severity: record.severityId,
      id: record.eventUid,
      created: isoTime(record.createdAt),
      dataset: "oneuptime.security",
      module: SIEM_EVENT_SOURCE,
      provider: record.productName,
    }),
    rule: compact({ id: record.ruleId, name: record.ruleName }),
    threat:
      record.mitreTactics.length > 0 || record.mitreTechniques.length > 0
        ? compact({
            framework: "MITRE ATT&CK",
            tactic: compact({ name: record.mitreTactics }),
            technique: compact({ id: record.mitreTechniques }),
          })
        : {},
    user: compact({
      name: record.principalUser,
      target: compact({ name: record.targetUser }),
    }),
    host: compact({ name: record.principalHost }),
    source: compact({ ip: sourceIp }),
    destination: compact({
      ip: destinationIp,
      domain: record.targetHost,
      port: record.targetPort > 0 ? record.targetPort : null,
    }),
    process: compact({
      name: record.processName,
      executable: record.processPath,
      command_line: record.processCommandLine,
      parent: compact({
        name: record.parentProcessName,
        executable: record.parentProcessPath,
        command_line: record.parentProcessCommandLine,
      }),
    }),
    observer: compact({
      vendor: record.vendorName,
      product: record.productName,
    }),
    related: compact({
      ip: uniqueValues(
        [record.principalIp, record.targetIp, ...record.observables].map(
          validIpAddress,
        ),
      ),
      user: uniqueValues([record.principalUser, record.targetUser]),
      hosts: uniqueValues([record.principalHost, record.targetHost]),
    }),
    /*
     * OneUptime's own fields, under its name. The attributes are one JSON
     * text: a SIEM's mapping takes a field per key, and a project's
     * attribute keys are many and chosen by its sources.
     */
    oneuptime: compact({
      event_id: record.id,
      class_name: record.className,
      category_name: record.categoryName,
      severity: record.severityName,
      status: record.statusName,
      resource: record.targetResource,
      observables: record.observables,
      attributes:
        Object.keys(record.attributes).length > 0
          ? JSON.stringify(record.attributes)
          : "",
    }),
  });
}

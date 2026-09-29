import { JSONObject } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../Types/SecurityEvent/OcsfSeverity";
import {
  OcsfEventClassProps,
  ocsfCategoryForClassUid,
  ocsfEventClassByUid,
} from "../../Types/SecurityEvent/OcsfEventClass";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
  readString,
  readStringArray,
  readValue,
} from "./NormalizerHelpers";

/*
 * Google SecOps (Chronicle) UDM event -> NormalizedSecurityEvent.
 *
 * UDM reaches us in two spellings: snake_case (BigQuery export, docs) and
 * camelCase (Chronicle API responses). Every field read tolerates both.
 * metadata.event_type drives the OCSF class mapping; anything unmapped
 * keeps class uid 0 with a prettified class name so no event is dropped.
 *
 * https://cloud.google.com/chronicle/docs/reference/udm-field-list
 */

interface UdmClassMapping {
  classUid: number;
  activityName: string;
}

const UDM_EVENT_TYPE_TO_OCSF: Record<string, UdmClassMapping> = {
  // Identity & Access Management
  USER_LOGIN: { classUid: 3002, activityName: "Logon" },
  USER_LOGOUT: { classUid: 3002, activityName: "Logoff" },
  USER_CREATION: { classUid: 3001, activityName: "Create" },
  USER_DELETION: { classUid: 3001, activityName: "Delete" },
  USER_CHANGE_PASSWORD: { classUid: 3001, activityName: "Change Password" },
  USER_CHANGE_PERMISSIONS: {
    classUid: 3005,
    activityName: "Change Permissions",
  },
  USER_BADGE_IN: { classUid: 3002, activityName: "Logon" },
  USER_UNCATEGORIZED: { classUid: 3001, activityName: "Other" },
  GROUP_CREATION: { classUid: 3006, activityName: "Create" },
  GROUP_DELETION: { classUid: 3006, activityName: "Delete" },
  GROUP_MODIFICATION: { classUid: 3006, activityName: "Update" },
  GROUP_UNCATEGORIZED: { classUid: 3006, activityName: "Other" },

  // Network Activity
  NETWORK_CONNECTION: { classUid: 4001, activityName: "Traffic" },
  NETWORK_FLOW: { classUid: 4001, activityName: "Traffic" },
  NETWORK_UNCATEGORIZED: { classUid: 4001, activityName: "Other" },
  NETWORK_HTTP: { classUid: 4002, activityName: "HTTP Request" },
  NETWORK_DNS: { classUid: 4003, activityName: "Query" },
  NETWORK_DHCP: { classUid: 4004, activityName: "DHCP" },
  NETWORK_SMTP: { classUid: 4009, activityName: "Send" },
  NETWORK_FTP: { classUid: 4008, activityName: "Transfer" },
  EMAIL_TRANSACTION: { classUid: 4009, activityName: "Send" },
  EMAIL_UNCATEGORIZED: { classUid: 4009, activityName: "Other" },

  // System Activity
  PROCESS_LAUNCH: { classUid: 1007, activityName: "Launch" },
  PROCESS_TERMINATION: { classUid: 1007, activityName: "Terminate" },
  PROCESS_OPEN: { classUid: 1007, activityName: "Open" },
  PROCESS_INJECTION: { classUid: 1007, activityName: "Inject" },
  PROCESS_PRIVILEGE_ESCALATION: {
    classUid: 1007,
    activityName: "Privilege Escalation",
  },
  PROCESS_MODULE_LOAD: { classUid: 1005, activityName: "Load" },
  PROCESS_UNCATEGORIZED: { classUid: 1007, activityName: "Other" },
  FILE_CREATION: { classUid: 1001, activityName: "Create" },
  FILE_DELETION: { classUid: 1001, activityName: "Delete" },
  FILE_MODIFICATION: { classUid: 1001, activityName: "Update" },
  FILE_READ: { classUid: 1001, activityName: "Read" },
  FILE_COPY: { classUid: 1001, activityName: "Copy" },
  FILE_MOVE: { classUid: 1001, activityName: "Rename" },
  FILE_OPEN: { classUid: 1001, activityName: "Open" },
  FILE_SYNC: { classUid: 1001, activityName: "Update" },
  FILE_UNCATEGORIZED: { classUid: 1001, activityName: "Other" },
  REGISTRY_CREATION: { classUid: 201001, activityName: "Create" },
  REGISTRY_MODIFICATION: { classUid: 201001, activityName: "Modify" },
  REGISTRY_DELETION: { classUid: 201001, activityName: "Delete" },
  REGISTRY_UNCATEGORIZED: { classUid: 201001, activityName: "Other" },
  SCHEDULED_TASK_CREATION: { classUid: 1006, activityName: "Create" },
  SCHEDULED_TASK_DELETION: { classUid: 1006, activityName: "Delete" },
  SCHEDULED_TASK_MODIFICATION: { classUid: 1006, activityName: "Update" },
  SCHEDULED_TASK_UNCATEGORIZED: { classUid: 1006, activityName: "Other" },

  // Findings
  SCAN_VULN_HOST: { classUid: 2002, activityName: "Scan" },
  SCAN_VULN_NETWORK: { classUid: 2002, activityName: "Scan" },
  SCAN_FILE: { classUid: 2004, activityName: "Scan" },
  SCAN_HOST: { classUid: 2004, activityName: "Scan" },
  SCAN_NETWORK: { classUid: 2004, activityName: "Scan" },
  SCAN_PROCESS: { classUid: 2004, activityName: "Scan" },
  SCAN_UNCATEGORIZED: { classUid: 2004, activityName: "Scan" },

  // Application Activity / Discovery
  SERVICE_START: { classUid: 6002, activityName: "Start" },
  SERVICE_STOP: { classUid: 6002, activityName: "Stop" },
  SERVICE_CREATION: { classUid: 6002, activityName: "Install" },
  SERVICE_DELETION: { classUid: 6002, activityName: "Remove" },
  SERVICE_MODIFICATION: { classUid: 6002, activityName: "Update" },
  SERVICE_UNSPECIFIED: { classUid: 6002, activityName: "Other" },
  STATUS_STARTUP: { classUid: 6002, activityName: "Start" },
  STATUS_SHUTDOWN: { classUid: 6002, activityName: "Stop" },
  STATUS_HEARTBEAT: { classUid: 6002, activityName: "Heartbeat" },
  STATUS_UPDATE: { classUid: 6002, activityName: "Update" },
  STATUS_UNCATEGORIZED: { classUid: 6002, activityName: "Other" },
  SETTING_CREATION: { classUid: 5002, activityName: "Create" },
  SETTING_MODIFICATION: { classUid: 5002, activityName: "Update" },
  SETTING_DELETION: { classUid: 5002, activityName: "Delete" },
  SETTING_UNCATEGORIZED: { classUid: 5002, activityName: "Other" },
  RESOURCE_CREATION: { classUid: 6003, activityName: "Create" },
  RESOURCE_DELETION: { classUid: 6003, activityName: "Delete" },
  RESOURCE_PERMISSIONS_CHANGE: { classUid: 6003, activityName: "Update" },
  RESOURCE_READ: { classUid: 6003, activityName: "Read" },
  RESOURCE_WRITTEN: { classUid: 6003, activityName: "Update" },

  GENERIC_EVENT: { classUid: 0, activityName: "" },
};

const UDM_ACTION_TO_STATUS: Record<string, string> = {
  ALLOW: "Allowed",
  ALLOW_WITH_MODIFICATION: "Allowed",
  BLOCK: "Blocked",
  QUARANTINE: "Quarantined",
  FAIL: "Failure",
  UNKNOWN_ACTION: "",
};

/** "NETWORK_CONNECTION" -> "Network Connection". */
export function prettifyUdmEventType(eventType: string): string {
  return eventType
    .split("_")
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .map((part: string): string => {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function readAny(payload: JSONObject, paths: Array<string>): string {
  for (const path of paths) {
    const value: string = readString(payload, path);
    if (value) {
      return value;
    }
  }

  return "";
}

function readAnyArray(
  payload: JSONObject,
  paths: Array<string>,
): Array<string> {
  for (const path of paths) {
    const value: Array<string> = readStringArray(payload, path);
    if (value.length > 0) {
      return value;
    }
  }

  return [];
}

interface SecurityResultSummary {
  severity: OcsfSeverity | null;
  statusName: string;
  ruleId: string;
  ruleName: string;
  summary: string;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
}

/*
 * A UDM event can carry several security_result entries (one per security
 * product verdict). Severity is the max across all of them; the first
 * entry that names a rule/action/summary wins those fields.
 */
function summarizeSecurityResults(payload: JSONObject): SecurityResultSummary {
  const summary: SecurityResultSummary = {
    severity: null,
    statusName: "",
    ruleId: "",
    ruleName: "",
    summary: "",
    mitreTactics: [],
    mitreTechniques: [],
  };

  const results: unknown =
    readValue(payload, "security_result") ??
    readValue(payload, "securityResult");

  if (!Array.isArray(results)) {
    return summary;
  }

  for (const entry of results) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }

    const result: JSONObject = entry as JSONObject;

    const severity: OcsfSeverity | null = normalizeOcsfSeverity(
      readString(result, "severity"),
    );

    if (
      severity &&
      (!summary.severity ||
        OcsfSeverityId[severity] > OcsfSeverityId[summary.severity])
    ) {
      summary.severity = severity;
    }

    if (!summary.statusName) {
      const actions: Array<string> = readStringArray(result, "action");
      for (const action of actions) {
        const mapped: string | undefined =
          UDM_ACTION_TO_STATUS[action.toUpperCase()];
        if (mapped) {
          summary.statusName = mapped;
          break;
        }
      }
    }

    if (!summary.ruleId) {
      summary.ruleId = readAny(result, ["rule_id", "ruleId"]);
    }

    if (!summary.ruleName) {
      summary.ruleName = readAny(result, ["rule_name", "ruleName"]);
    }

    if (!summary.summary) {
      summary.summary = readAny(result, ["summary", "description"]);
    }

    const attackDetails: unknown =
      readValue(result, "attack_details") ?? readValue(result, "attackDetails");

    if (
      attackDetails &&
      typeof attackDetails === "object" &&
      !Array.isArray(attackDetails)
    ) {
      const details: JSONObject = attackDetails as JSONObject;

      const tactics: unknown = readValue(details, "tactics");
      if (Array.isArray(tactics)) {
        for (const tactic of tactics) {
          const id: string = readString(tactic as JSONObject, "id");
          if (id && !summary.mitreTactics.includes(id)) {
            summary.mitreTactics.push(id);
          }
        }
      }

      const techniques: unknown = readValue(details, "techniques");
      if (Array.isArray(techniques)) {
        for (const technique of techniques) {
          const id: string = readString(technique as JSONObject, "id");
          if (id && !summary.mitreTechniques.includes(id)) {
            summary.mitreTechniques.push(id);
          }
        }
      }
    }
  }

  return summary;
}

export default class UdmNormalizer {
  public static isUdmEvent(payload: JSONObject): boolean {
    return Boolean(
      readAny(payload, ["metadata.event_type", "metadata.eventType"]),
    );
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const eventType: string = readAny(payload, [
      "metadata.event_type",
      "metadata.eventType",
    ]).toUpperCase();

    const mapping: UdmClassMapping | undefined =
      UDM_EVENT_TYPE_TO_OCSF[eventType];

    const classUid: number = mapping ? mapping.classUid : 0;
    const mappedClass: OcsfEventClassProps | undefined =
      ocsfEventClassByUid(classUid);

    const className: string =
      classUid !== 0 && mappedClass
        ? mappedClass.name
        : eventType
          ? prettifyUdmEventType(eventType)
          : "Base Event";

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(classUid);

    const results: SecurityResultSummary = summarizeSecurityResults(payload);

    const severityName: OcsfSeverity = results.severity || OcsfSeverity.Unknown;

    const time: Date | null = parseEventTime(
      readValue(payload, "metadata.event_timestamp") ??
        readValue(payload, "metadata.eventTimestamp") ??
        readValue(payload, "metadata.collected_timestamp") ??
        readValue(payload, "metadata.collectedTimestamp"),
    );

    const principalUser: string = readAny(payload, [
      "principal.user.userid",
      "principal.user.user_display_name",
      "principal.user.userDisplayName",
      "principal.user.email_addresses",
      "principal.user.emailAddresses",
    ]);

    const principalHost: string = readAny(payload, [
      "principal.hostname",
      "principal.asset.hostname",
    ]);

    const principalIps: Array<string> = readAnyArray(payload, [
      "principal.ip",
      "principal.asset.ip",
    ]);

    const principalProcess: string = readAny(payload, [
      "principal.process.file.full_path",
      "principal.process.file.fullPath",
      "principal.process.command_line",
      "principal.process.commandLine",
    ]);

    const targetUser: string = readAny(payload, [
      "target.user.userid",
      "target.user.user_display_name",
      "target.user.userDisplayName",
      "target.user.email_addresses",
      "target.user.emailAddresses",
    ]);

    const targetHost: string = readAny(payload, [
      "target.hostname",
      "target.asset.hostname",
      "target.domain.name",
    ]);

    const targetIps: Array<string> = readAnyArray(payload, [
      "target.ip",
      "target.asset.ip",
    ]);

    const targetPortRaw: string = readAny(payload, ["target.port"]);
    const targetPort: number = targetPortRaw ? Number(targetPortRaw) || 0 : 0;

    const targetResource: string = readAny(payload, [
      "target.resource.name",
      "target.url",
      "target.application",
      "target.file.full_path",
      "target.file.fullPath",
    ]);

    const eventUid: string =
      readAny(payload, [
        "metadata.id",
        "metadata.product_log_id",
        "metadata.productLogId",
      ]) || contentHashEventUid(payload);

    const message: string =
      readAny(payload, ["metadata.description"]) ||
      results.summary ||
      (eventType ? prettifyUdmEventType(eventType) : "Security event");

    return {
      time: time || new Date(),
      eventUid,
      categoryUid,
      categoryName,
      classUid,
      className,
      activityName: mapping ? mapping.activityName : "",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: results.statusName,
      message,
      vendorName: readAny(payload, [
        "metadata.vendor_name",
        "metadata.vendorName",
      ]),
      productName: readAny(payload, [
        "metadata.product_name",
        "metadata.productName",
      ]),
      ruleId: results.ruleId,
      ruleName: results.ruleName,
      mitreTactics: results.mitreTactics,
      mitreTechniques: results.mitreTechniques,
      principalUser,
      principalHost,
      principalIp: principalIps[0] || "",
      principalProcess,
      targetUser,
      targetHost,
      targetIp: targetIps[0] || "",
      targetPort,
      targetResource,
      observables: buildObservables([
        principalUser,
        targetUser,
        principalHost,
        targetHost,
        ...principalIps,
        ...targetIps,
        readAny(payload, ["target.domain.name", "network.dns.questions.name"]),
      ]),
      attributes: flattenPayload(payload),
    };
  }
}

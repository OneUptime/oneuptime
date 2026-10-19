import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import { SecurityEventRecord } from "./SecurityEventRecord";

/*
 * A OneUptime security event as a Google SecOps UDM event - what the
 * Chronicle API's events:import takes (inlineSource.events[].udm).
 *
 * UDM checks each event type for the fields it needs: a USER_LOGIN names
 * the account and the machine, a PROCESS_LAUNCH the machine and the
 * process, a NETWORK_CONNECTION both ends. An event is given the specific
 * type only when it carries those fields, and GENERIC_EVENT - which needs
 * nothing - otherwise, so every event OneUptime holds has a type SecOps
 * accepts. What OneUptime found about it (a rule's match, its severity, the
 * ATT&CK tactics and techniques) is the UDM security result, and the
 * event's id and class are additional fields, so an analyst in SecOps can
 * find the event in OneUptime again.
 *
 * Field names are the canonical JSON names of the UDM proto (lowerCamelCase),
 * which the API reads.
 * https://cloud.google.com/chronicle/docs/reference/udm-field-list
 */

export enum UdmEventType {
  UserLogin = "USER_LOGIN",
  ProcessLaunch = "PROCESS_LAUNCH",
  NetworkConnection = "NETWORK_CONNECTION",
  GenericEvent = "GENERIC_EVENT",
}

// OCSF classes (OcsfEventClass) a specific UDM type exists for.
const OCSF_AUTHENTICATION_CLASS_UID: number = 3002;
const OCSF_PROCESS_ACTIVITY_CLASS_UID: number = 1007;
const OCSF_NETWORK_ACTIVITY_CLASS_UID: number = 4001;

export const UDM_VENDOR_NAME_FALLBACK: string = "OneUptime";
export const UDM_PRODUCT_NAME_FALLBACK: string = "OneUptime Security Events";

// How long a free-text UDM field may be, and how many extra fields an event carries.
const MAX_DESCRIPTION_LENGTH: number = 1024;
const MAX_ADDITIONAL_FIELDS: number = 40;
const MAX_ADDITIONAL_VALUE_LENGTH: number = 512;

// OCSF severity name -> UDM SecurityResult.ProductSeverity.
const UDM_SEVERITY: Record<string, string> = {
  Unknown: "UNKNOWN_SEVERITY",
  Informational: "INFORMATIONAL",
  Low: "LOW",
  Medium: "MEDIUM",
  High: "HIGH",
  Critical: "CRITICAL",
  Fatal: "CRITICAL",
  Other: "UNKNOWN_SEVERITY",
};

// OCSF status -> UDM SecurityResult.Action, the inverse of the UDM normalizer's.
const UDM_ACTION: Record<string, string> = {
  success: "ALLOW",
  allowed: "ALLOW",
  failure: "FAIL",
  blocked: "BLOCK",
  denied: "BLOCK",
  quarantined: "QUARANTINE",
};

function cut(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function validIp(value: string): string {
  const candidate: string = (value || "").trim();

  return candidate && candidate.length <= 64 && IP.isIP(candidate)
    ? candidate
    : "";
}

function isEmailAddress(value: string): boolean {
  const at: number = value.indexOf("@");

  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1;
}

// A UDM User: the id, and the address as an address when it is one.
function udmUser(name: string): JSONObject | null {
  const userId: string = (name || "").trim();

  if (!userId) {
    return null;
  }

  const user: JSONObject = { userid: cut(userId, 256) };

  if (isEmailAddress(userId)) {
    user["emailAddresses"] = [cut(userId, 256)];
  }

  return user;
}

// A UDM Noun (principal or target): a machine, its user, process and port.
function udmNoun(data: {
  hostname?: string | undefined;
  ip?: string | undefined;
  user?: string | undefined;
  commandLine?: string | undefined;
  port?: number | undefined;
  url?: string | undefined;
  resourceName?: string | undefined;
}): JSONObject {
  const noun: JSONObject = {};
  const hostname: string = (data.hostname || "").trim();
  const ip: string = validIp(data.ip || "");
  const user: JSONObject | null = udmUser(data.user || "");
  const commandLine: string = (data.commandLine || "").trim();

  if (hostname) {
    noun["hostname"] = cut(hostname, 256);
  }

  if (ip) {
    noun["ip"] = [ip];
  }

  if (user) {
    noun["user"] = user;
  }

  if (commandLine) {
    noun["process"] = { commandLine: cut(commandLine, 2048) };
  }

  if (data.port && data.port > 0 && data.port <= 65535) {
    noun["port"] = Math.trunc(data.port);
  }

  if (data.url) {
    noun["url"] = cut(data.url, 2048);
  }

  if (data.resourceName) {
    noun["resource"] = { name: cut(data.resourceName, 1024) };
  }

  return noun;
}

function hasMachine(noun: JSONObject): boolean {
  return Boolean(noun["hostname"] || noun["ip"]);
}

function isUrl(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("/")
  );
}

/*
 * The UDM type an event is sent as: the specific one when it carries the
 * fields that type needs, GENERIC_EVENT otherwise.
 */
export function chooseUdmEventType(record: SecurityEventRecord): UdmEventType {
  const principalHasMachine: boolean = Boolean(
    record.principalHost.trim() || validIp(record.principalIp),
  );
  const targetHasMachine: boolean = Boolean(
    record.targetHost.trim() || validIp(record.targetIp),
  );

  if (
    record.classUid === OCSF_AUTHENTICATION_CLASS_UID &&
    (record.principalUser.trim() || record.targetUser.trim()) &&
    (principalHasMachine || targetHasMachine)
  ) {
    return UdmEventType.UserLogin;
  }

  if (
    record.classUid === OCSF_PROCESS_ACTIVITY_CLASS_UID &&
    record.principalProcess.trim() &&
    principalHasMachine
  ) {
    return UdmEventType.ProcessLaunch;
  }

  if (
    record.classUid === OCSF_NETWORK_ACTIVITY_CLASS_UID &&
    principalHasMachine &&
    targetHasMachine
  ) {
    return UdmEventType.NetworkConnection;
  }

  return UdmEventType.GenericEvent;
}

// The few things about the event that UDM has no field for, so it can be found in OneUptime.
function additionalFields(record: SecurityEventRecord): JSONObject {
  const additional: JSONObject = {};

  const own: Array<[string, string]> = [
    ["oneuptime_event_id", record.id],
    ["oneuptime_event_uid", record.eventUid],
    ["oneuptime_class", record.className],
    ["oneuptime_category", record.categoryName],
    ["oneuptime_activity", record.activityName],
    ["oneuptime_status", record.statusName],
  ];

  for (const [key, value] of own) {
    if (value) {
      additional[key] = cut(value, MAX_ADDITIONAL_VALUE_LENGTH);
    }
  }

  let count: number = Object.keys(additional).length;

  for (const key of Object.keys(record.attributes).sort()) {
    if (count >= MAX_ADDITIONAL_FIELDS) {
      break;
    }

    const value: string = record.attributes[key] || "";

    if (!value || additional[key] !== undefined) {
      continue;
    }

    additional[cut(key, 128)] = cut(value, MAX_ADDITIONAL_VALUE_LENGTH);
    count++;
  }

  return additional;
}

function securityResult(record: SecurityEventRecord): JSONObject {
  const result: JSONObject = {
    severity: UDM_SEVERITY[record.severityName] || "UNKNOWN_SEVERITY",
    summary: cut(record.ruleName || record.className || "Security event", 256),
  };

  if (record.message) {
    result["description"] = cut(record.message, MAX_DESCRIPTION_LENGTH);
  }

  if (record.ruleName) {
    result["ruleName"] = cut(record.ruleName, 256);
  }

  if (record.ruleId) {
    result["ruleId"] = cut(record.ruleId, 256);
  }

  const action: string | undefined =
    UDM_ACTION[record.statusName.trim().toLowerCase()];

  if (action) {
    result["action"] = [action];
  }

  if (record.mitreTactics.length > 0 || record.mitreTechniques.length > 0) {
    result["attackDetails"] = {
      tactics: record.mitreTactics.map((id: string): JSONObject => {
        return { id };
      }),
      techniques: record.mitreTechniques.map((id: string): JSONObject => {
        return { id };
      }),
    };
  }

  return result;
}

export function toUdmEvent(
  record: SecurityEventRecord,
  eventType: UdmEventType = chooseUdmEventType(record),
): JSONObject {
  const metadata: JSONObject = {
    eventTimestamp: record.time.toISOString(),
    eventType,
    vendorName: cut(record.vendorName || UDM_VENDOR_NAME_FALLBACK, 256),
    productName: cut(record.productName || UDM_PRODUCT_NAME_FALLBACK, 256),
  };

  const productEventType: string = [record.className, record.activityName]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" / ");

  if (productEventType) {
    metadata["productEventType"] = cut(productEventType, 256);
  }

  if (record.eventUid) {
    metadata["productLogId"] = cut(record.eventUid, 256);
  }

  if (record.message) {
    metadata["description"] = cut(record.message, MAX_DESCRIPTION_LENGTH);
  }

  const targetResource: string = record.targetResource.trim();
  const isLogin: boolean = eventType === UdmEventType.UserLogin;
  const isProcessLaunch: boolean = eventType === UdmEventType.ProcessLaunch;

  /*
   * A login names the account on the target: OneUptime's sign-in events
   * keep it as the principal user (the one acting), UDM as the target user
   * (the one signed in to). The address it came from stays the principal.
   * A launched process is the target's process in UDM.
   */
  const principal: JSONObject = udmNoun({
    hostname: record.principalHost,
    ip: record.principalIp,
    user: isLogin ? "" : record.principalUser,
    commandLine: isProcessLaunch ? "" : record.principalProcess,
  });

  const target: JSONObject = udmNoun({
    hostname: record.targetHost,
    ip: record.targetIp,
    user: isLogin
      ? record.targetUser || record.principalUser
      : record.targetUser,
    commandLine: isProcessLaunch ? record.principalProcess : "",
    port: record.targetPort,
    url: targetResource && isUrl(targetResource) ? targetResource : "",
    resourceName:
      targetResource && !isUrl(targetResource) ? targetResource : "",
  });

  /*
   * A launched process runs on the principal's machine; UDM wants the
   * machine on the target's side of a PROCESS_LAUNCH too when the event
   * names no other target.
   */
  if (isProcessLaunch && !hasMachine(target)) {
    if (principal["hostname"]) {
      target["hostname"] = principal["hostname"];
    }

    if (principal["ip"]) {
      target["ip"] = principal["ip"];
    }
  }

  const event: JSONObject = { metadata };

  if (Object.keys(principal).length > 0) {
    event["principal"] = principal;
  }

  if (Object.keys(target).length > 0) {
    event["target"] = target;
  }

  if (isLogin) {
    event["extensions"] = { auth: { type: "AUTHTYPE_UNSPECIFIED" } };
  }

  event["securityResult"] = [securityResult(record)];

  const additional: JSONObject = additionalFields(record);

  if (Object.keys(additional).length > 0) {
    event["additional"] = additional;
  }

  return event;
}

import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import {
  OCSF_PROCESS_ACTIVITY_CLASS_UID,
  ProcessActivityKind,
  getProcessActivityKind,
  readProcessActivityId,
} from "../../../Types/SecurityEvent/OcsfProcessActivity";
import { ProcessReading, fileNameOfPath } from "../NormalizerHelpers";
import { SecurityEventRecord } from "./SecurityEventRecord";

/*
 * A OneUptime security event as a Google SecOps UDM event - what the
 * Chronicle API's events:import takes (inlineSource.events[].udm).
 *
 * UDM checks each event type for the fields it needs: a USER_LOGIN names
 * the account and the machine, a process event (PROCESS_LAUNCH,
 * PROCESS_OPEN, ...) the machine and the process acted on, a
 * NETWORK_CONNECTION both ends. An event is given the specific type only
 * when it carries those fields, and GENERIC_EVENT - which needs nothing -
 * otherwise, so every event OneUptime holds has a type SecOps accepts.
 * What OneUptime found about it (a rule's match, its severity, the ATT&CK
 * tactics and techniques) is the UDM security result, and the event's id
 * and class are additional fields, so an analyst in SecOps can find the
 * event in OneUptime again.
 *
 * Field names are the canonical JSON names of the UDM proto (lowerCamelCase),
 * which the API reads.
 * https://cloud.google.com/chronicle/docs/reference/udm-field-list
 * https://cloud.google.com/chronicle/docs/unified-data-model/udm-usage
 */

export enum UdmEventType {
  UserLogin = "USER_LOGIN",
  ProcessLaunch = "PROCESS_LAUNCH",
  ProcessOpen = "PROCESS_OPEN",
  ProcessInjection = "PROCESS_INJECTION",
  ProcessTermination = "PROCESS_TERMINATION",
  ProcessPrivilegeEscalation = "PROCESS_PRIVILEGE_ESCALATION",
  ProcessUncategorized = "PROCESS_UNCATEGORIZED",
  NetworkConnection = "NETWORK_CONNECTION",
  GenericEvent = "GENERIC_EVENT",
}

/*
 * The process event types in which one process acts on another: the one
 * that acted is the principal's process and the one acted on the target's
 * (UDM usage guide, "PROCESS_INJECTION, PROCESS_LAUNCH, PROCESS_OPEN,
 * PROCESS_TERMINATION, PROCESS_UNCATEGORIZED"). A launch is the same with
 * the parent as the one that acted, which OneUptime already holds as the
 * parent's own fields.
 */
const ACTED_ON_PROCESS_TYPES: ReadonlyArray<UdmEventType> = [
  UdmEventType.ProcessOpen,
  UdmEventType.ProcessInjection,
  UdmEventType.ProcessTermination,
  UdmEventType.ProcessPrivilegeEscalation,
  UdmEventType.ProcessUncategorized,
];

// The UDM type of each kind of process activity done to another process.
const ACTED_ON_TYPE_BY_KIND: Readonly<
  Record<Exclude<ProcessActivityKind, ProcessActivityKind.Launch>, UdmEventType>
> = {
  [ProcessActivityKind.Open]: UdmEventType.ProcessOpen,
  [ProcessActivityKind.Inject]: UdmEventType.ProcessInjection,
  [ProcessActivityKind.Terminate]: UdmEventType.ProcessTermination,
  [ProcessActivityKind.PrivilegeEscalation]:
    UdmEventType.ProcessPrivilegeEscalation,
  [ProcessActivityKind.Other]: UdmEventType.ProcessUncategorized,
};

// OCSF classes (OcsfEventClass) a specific UDM type exists for.
const OCSF_AUTHENTICATION_CLASS_UID: number = 3002;
const OCSF_NETWORK_ACTIVITY_CLASS_UID: number = 4001;

export const UDM_VENDOR_NAME_FALLBACK: string = "OneUptime";
export const UDM_PRODUCT_NAME_FALLBACK: string = "OneUptime Security Events";

// How long a free-text UDM field may be, and how many extra fields an event carries.
const MAX_DESCRIPTION_LENGTH: number = 1024;
const MAX_ADDITIONAL_FIELDS: number = 40;
const MAX_ADDITIONAL_VALUE_LENGTH: number = 512;

const WHITESPACE: RegExp = /\s/;

/*
 * Both tables are Maps, not objects: a status is the source's own text, and
 * an object answers "constructor" or "toString" with what every object
 * inherits - which went out as an action of [null], a batch SecOps refuses.
 */

// OCSF severity name -> UDM SecurityResult.ProductSeverity.
const UDM_SEVERITY: ReadonlyMap<string, string> = new Map<string, string>([
  ["Unknown", "UNKNOWN_SEVERITY"],
  ["Informational", "INFORMATIONAL"],
  ["Low", "LOW"],
  ["Medium", "MEDIUM"],
  ["High", "HIGH"],
  ["Critical", "CRITICAL"],
  ["Fatal", "CRITICAL"],
  ["Other", "UNKNOWN_SEVERITY"],
]);

// OCSF status -> UDM SecurityResult.Action, the inverse of the UDM normalizer's.
const UDM_ACTION: ReadonlyMap<string, string> = new Map<string, string>([
  ["success", "ALLOW"],
  ["allowed", "ALLOW"],
  ["failure", "FAIL"],
  ["blocked", "BLOCK"],
  ["denied", "BLOCK"],
  ["quarantined", "QUARANTINE"],
]);

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

/*
 * A UDM Process: its command line, and its executable. UDM has no field
 * for a process's name: the executable is file.fullPath - its path when
 * the source gave one, else its name, as SecOps' own parsers keep an image
 * name they have no path for - and the name is in file.names, where
 * OneUptime's UDM reader takes it back from.
 */
function udmProcess(reading: ProcessReading): JSONObject | null {
  const name: string = (reading.name || "").trim();
  const path: string = (reading.path || "").trim();
  const commandLine: string = (reading.commandLine || "").trim();

  if (!name && !path && !commandLine) {
    return null;
  }

  const udmProcessNoun: JSONObject = {};

  if (commandLine) {
    udmProcessNoun["commandLine"] = cut(commandLine, 2048);
  }

  const executable: string = path || name;

  if (executable) {
    const file: JSONObject = { fullPath: cut(executable, 1024) };
    const fileName: string = name || fileNameOfPath(path);

    if (fileName) {
      file["names"] = [cut(fileName, 256)];
    }

    udmProcessNoun["file"] = file;
  }

  return udmProcessNoun;
}

/*
 * A process known by one text only - principalProcess, the process that
 * acted, which a source fills with a name, a path or a command line: a
 * command line when it has a space in it, its executable otherwise.
 */
function processFromText(text: string): ProcessReading {
  const trimmed: string = (text || "").trim();

  if (!trimmed) {
    return {};
  }

  if (WHITESPACE.test(trimmed)) {
    return { commandLine: trimmed };
  }

  return { path: trimmed, name: fileNameOfPath(trimmed) };
}

/*
 * Whether the event names no process in its own process fields at all: a
 * row stored before OneUptime read them, which knows its process only as
 * principalProcess.
 */
function namesNoProcessOfItsOwn(record: SecurityEventRecord): boolean {
  return ![
    record.processName,
    record.processPath,
    record.processCommandLine,
    record.parentProcessName,
    record.parentProcessPath,
    record.parentProcessCommandLine,
  ].some((value: string): boolean => {
    return Boolean((value || "").trim());
  });
}

// The process the event is about, from its own process fields.
function ownProcess(record: SecurityEventRecord): JSONObject | null {
  return udmProcess({
    name: record.processName,
    path: record.processPath,
    commandLine: record.processCommandLine,
  });
}

function parentProcess(record: SecurityEventRecord): JSONObject | null {
  return udmProcess({
    name: record.parentProcessName,
    path: record.parentProcessPath,
    commandLine: record.parentProcessCommandLine,
  });
}

/*
 * The process the event is about. A row stored before OneUptime read the
 * process fields names only principalProcess, which stands in for it;
 * once any of them is filled, they say which process it is, and the
 * process that acted is never taken for it.
 */
function eventProcess(record: SecurityEventRecord): JSONObject | null {
  if (namesNoProcessOfItsOwn(record)) {
    return udmProcess(processFromText(record.principalProcess));
  }

  return ownProcess(record);
}

// The process that acted on another: principalProcess.
function actingProcess(record: SecurityEventRecord): JSONObject | null {
  return udmProcess(processFromText(record.principalProcess));
}

function withParent(
  process: JSONObject | null,
  parent: JSONObject | null,
): JSONObject | null {
  if (process && parent) {
    process["parentProcess"] = parent;
  }

  return process;
}

/*
 * What a Process Activity did to its process, read as ingest read it: the
 * activity id its payload carried (kept in the attributes) before the
 * name, so an event whose source sent only the id - stored before
 * OneUptime named such an activity - is sent as the activity its process
 * fields were read by.
 */
function processActivityOf(record: SecurityEventRecord): ProcessActivityKind {
  return getProcessActivityKind({
    activityId: readProcessActivityId(record.attributes["activity_id"]),
    activityName: record.activityName,
  });
}

// A UDM Noun (principal or target): a machine, its user, process and port.
function udmNoun(data: {
  hostname?: string | undefined;
  ip?: string | undefined;
  user?: string | undefined;
  process?: JSONObject | null | undefined;
  port?: number | undefined;
  url?: string | undefined;
  resourceName?: string | undefined;
}): JSONObject {
  const noun: JSONObject = {};
  const hostname: string = (data.hostname || "").trim();
  const ip: string = validIp(data.ip || "");
  const user: JSONObject | null = udmUser(data.user || "");

  if (hostname) {
    noun["hostname"] = cut(hostname, 256);
  }

  if (ip) {
    noun["ip"] = [ip];
  }

  if (user) {
    noun["user"] = user;
  }

  if (data.process) {
    noun["process"] = data.process;
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
 * The UDM type of a Process Activity on a machine, when the event carries
 * what that type needs, and null when it does not:
 *
 *  - a launch, the process launched (which a row stored before the process
 *    fields knows as principalProcess);
 *  - an open, an injection, an end or any other activity, the process
 *    acted on, from the event's own process fields - never principalProcess,
 *    which is the process that acted;
 *  - a privilege escalation, which UDM checks for the process that raised
 *    its privileges and the user it ran as, is PROCESS_UNCATEGORIZED
 *    without them.
 */
function processEventType(record: SecurityEventRecord): UdmEventType | null {
  const kind: ProcessActivityKind = processActivityOf(record);

  if (kind === ProcessActivityKind.Launch) {
    return eventProcess(record) ? UdmEventType.ProcessLaunch : null;
  }

  if (
    kind === ProcessActivityKind.PrivilegeEscalation &&
    actingProcess(record) &&
    record.principalUser.trim()
  ) {
    return UdmEventType.ProcessPrivilegeEscalation;
  }

  if (!ownProcess(record)) {
    return null;
  }

  return kind === ProcessActivityKind.PrivilegeEscalation
    ? UdmEventType.ProcessUncategorized
    : ACTED_ON_TYPE_BY_KIND[kind];
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
    principalHasMachine
  ) {
    const processType: UdmEventType | null = processEventType(record);

    if (processType) {
      return processType;
    }
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
    severity: UDM_SEVERITY.get(record.severityName) || "UNKNOWN_SEVERITY",
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

  const action: string | undefined = UDM_ACTION.get(
    record.statusName.trim().toLowerCase(),
  );

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
  const isActedOn: boolean = ACTED_ON_PROCESS_TYPES.includes(eventType);

  /*
   * A login names the account on the target: OneUptime's sign-in events
   * keep it as the principal user (the one acting), UDM as the target user
   * (the one signed in to). The address it came from stays the principal.
   *
   * In a process event the principal's process is the one that acted and
   * the target's the one acted on: in a launch, the parent and the process
   * it launched; in an open, an injection or an end, principalProcess and
   * the process opened, injected into or ended, with that process's own
   * parent. In any other event the process is the principal's, with its
   * parent.
   */
  let principalsProcess: JSONObject | null = null;
  let targetsProcess: JSONObject | null = null;

  if (isProcessLaunch) {
    principalsProcess = parentProcess(record);
    targetsProcess = eventProcess(record);
  } else if (isActedOn) {
    principalsProcess = actingProcess(record);
    targetsProcess = withParent(ownProcess(record), parentProcess(record));
  } else {
    principalsProcess = withParent(eventProcess(record), parentProcess(record));
  }

  const principal: JSONObject = udmNoun({
    hostname: record.principalHost,
    ip: record.principalIp,
    user: isLogin ? "" : record.principalUser,
    process: principalsProcess,
  });

  const target: JSONObject = udmNoun({
    hostname: record.targetHost,
    ip: record.targetIp,
    user: isLogin
      ? record.targetUser || record.principalUser
      : record.targetUser,
    process: targetsProcess,
    port: record.targetPort,
    url: targetResource && isUrl(targetResource) ? targetResource : "",
    resourceName:
      targetResource && !isUrl(targetResource) ? targetResource : "",
  });

  /*
   * The process acted on runs on the principal's machine; UDM wants the
   * machine on the target's side of a process event too when the event
   * names no other target.
   */
  if ((isProcessLaunch || isActedOn) && !hasMachine(target)) {
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

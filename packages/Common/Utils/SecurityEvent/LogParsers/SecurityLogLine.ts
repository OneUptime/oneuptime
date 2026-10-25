import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../Types/SecurityCase/SecurityConnection";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ocsfCategoryForClassUid,
  ocsfEventClassByUid,
} from "../../../Types/SecurityEvent/OcsfEventClass";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SECURITY_LOG_ID_ATTRIBUTE,
  SECURITY_LOG_SOURCE_ATTRIBUTE,
  SECURITY_LOG_SOURCE_VALUE,
  SecurityLogFormatDefinition,
  getSecurityLogFormatDefinition,
} from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  ProcessReading,
  buildObservables,
  buildProcessFields,
} from "../NormalizerHelpers";

/*
 * One log line as the log parsers read it: the line itself, the attributes
 * it was sent with (flattened, the way the Log table stores them) and where
 * it came from.
 *
 * Every parser reads a line with indexOf and slices, never a regular
 * expression with a repeat: these are lines anybody can write into a log
 * (a username in an SSH log is whatever an attacker typed), so the time a
 * parser takes must grow in line with the line, whatever it holds.
 */
export interface SecurityLogLine {
  body: string;
  attributes: JSONObject;
  time: Date;
  // The log record's own id, so an event can always be traced back to it.
  logId?: string | undefined;
  // The service the log was sent under.
  serviceName?: string | undefined;
  /*
   * The record the log was sent under - its primary entity: a Service, a
   * Host, a Kubernetes cluster... (Types/Telemetry/ServiceType) - so the
   * event is connected to it exactly (Types/SecurityCase/SecurityConnection).
   */
  resourceId?: string | undefined;
  resourceType?: string | undefined;
}

// The longest line a text parser reads; past it a line is cut, not skipped.
export const MAX_TEXT_LINE_LENGTH: number = 16 * 1024;

// The longest JSON document a JSON parser reads; a bigger one is skipped.
export const MAX_JSON_LINE_LENGTH: number = 256 * 1024;

// The longest message an event made from a log keeps.
export const MAX_EVENT_MESSAGE_LENGTH: number = 1000;

// An IP address, a port or a host name is never longer than this.
const MAX_TOKEN_LENGTH: number = 255;

export function cutText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit - 1)}…`;
}

/*
 * The word that starts at `from`: everything up to the next space (or the
 * end). Bounded by MAX_TOKEN_LENGTH so a line of one endless word cannot
 * make a token of it.
 */
export function readWord(text: string, from: number): string {
  if (from < 0 || from >= text.length) {
    return "";
  }

  const end: number = text.indexOf(" ", from);
  const word: string = end === -1 ? text.slice(from) : text.slice(from, end);

  return word.length > MAX_TOKEN_LENGTH ? "" : word;
}

// An address worth recording: a valid IPv4 or IPv6 address, else "".
export function readIpAddress(value: string): string {
  const candidate: string = (value || "").trim();

  if (!candidate || candidate.length > 64) {
    return "";
  }

  return IP.isIP(candidate) ? candidate : "";
}

// A port number 1-65535, else 0.
export function readPort(value: string): number {
  const candidate: string = (value || "").trim();

  if (!candidate || candidate.length > 5) {
    return 0;
  }

  for (let index: number = 0; index < candidate.length; index++) {
    const code: number = candidate.charCodeAt(index);

    if (code < 48 || code > 57) {
      return 0;
    }
  }

  const port: number = Number(candidate);

  return port >= 1 && port <= 65535 ? port : 0;
}

/*
 * The first value of a flattened attribute among `keys`, as text: OTLP
 * resource attributes (host.name), journald fields and syslog fields name
 * the same things differently.
 */
export function readAttribute(
  attributes: JSONObject,
  keys: Array<string>,
): string {
  for (const key of keys) {
    const value: unknown = attributes[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, MAX_TOKEN_LENGTH);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

// The host a line was written on, from the attributes OTLP and syslog set.
export function readLogHost(line: SecurityLogLine): string {
  return readAttribute(line.attributes, [
    "host.name",
    "resource.host.name",
    "hostname",
    "syslog.hostname",
    "_HOSTNAME",
    "k8s.node.name",
  ]);
}

export interface LogSecurityEventInput {
  line: SecurityLogLine;
  format: SecurityLogFormat;
  classUid: number;
  activityName: string;
  statusName: string;
  severity: OcsfSeverity;
  message: string;
  time?: Date | undefined;
  // The source's own id for the record (an audit ID, a CloudTrail event ID).
  eventUid?: string | undefined;
  // Distinguishes the events of one line that holds several records.
  recordIndex?: number | undefined;
  principalUser?: string | undefined;
  principalHost?: string | undefined;
  principalIp?: string | undefined;
  principalProcess?: string | undefined;
  // The process the line is about (a command sudo ran), and its parent.
  process?: ProcessReading | undefined;
  parentProcess?: ProcessReading | undefined;
  targetUser?: string | undefined;
  targetHost?: string | undefined;
  targetIp?: string | undefined;
  targetPort?: number | undefined;
  targetResource?: string | undefined;
  // What the parser read, already flat: the attributes rules match on.
  attributes: JSONObject;
  mitreTactics?: Array<string> | undefined;
  mitreTechniques?: Array<string> | undefined;
}

/*
 * A parser's reading of a line, as the security event it becomes. The
 * vendor and product are the format's (SecurityLogFormat), the class and
 * category OCSF's, and every event carries where it came from: the source
 * "logs", its format and the id of the log record.
 */
export function buildLogSecurityEvent(
  input: LogSecurityEventInput,
): NormalizedSecurityEvent {
  const definition: SecurityLogFormatDefinition | undefined =
    getSecurityLogFormatDefinition(input.format);
  const category: { categoryUid: number; categoryName: string } =
    ocsfCategoryForClassUid(input.classUid);
  const className: string =
    ocsfEventClassByUid(input.classUid)?.name || "Base Event";
  const logId: string = input.line.logId || "";

  const principalUser: string = (input.principalUser || "").trim();
  const principalHost: string = (input.principalHost || "").trim();
  const principalIp: string = (input.principalIp || "").trim();
  const targetUser: string = (input.targetUser || "").trim();
  const targetHost: string = (input.targetHost || "").trim();
  const targetIp: string = (input.targetIp || "").trim();

  const attributes: JSONObject = {
    ...input.attributes,
    [SECURITY_LOG_SOURCE_ATTRIBUTE]: SECURITY_LOG_SOURCE_VALUE,
    [SECURITY_LOG_FORMAT_ATTRIBUTE]: input.format,
  };

  if (logId) {
    attributes[SECURITY_LOG_ID_ATTRIBUTE] = logId;
  }

  if (input.line.serviceName) {
    attributes["oneuptime.log.service"] = input.line.serviceName;
  }

  /*
   * The record the log was sent under, when the log names one (a real id
   * and its type): what connects the event to that host or service exactly.
   */
  const resourceId: string = (input.line.resourceId || "").trim();
  const resourceType: string = (input.line.resourceType || "").trim();

  if (resourceType && ObjectID.isValidUUID(resourceId)) {
    attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE] = resourceId;
    attributes[SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE] = resourceType;
  }

  const recordSuffix: string =
    input.recordIndex !== undefined ? `:${input.recordIndex}` : "";
  const eventUid: string =
    input.eventUid || (logId ? `log:${logId}${recordSuffix}` : "");

  return {
    time: input.time || input.line.time,
    eventUid,
    categoryUid: category.categoryUid,
    categoryName: category.categoryName,
    classUid: input.classUid,
    className,
    activityName: input.activityName,
    severityId: OcsfSeverityId[input.severity],
    severityName: input.severity,
    statusName: input.statusName,
    message: cutText(input.message, MAX_EVENT_MESSAGE_LENGTH),
    vendorName: definition?.vendorName || "",
    productName: definition?.productName || "",
    ruleId: "",
    ruleName: "",
    mitreTactics: input.mitreTactics || [],
    mitreTechniques: input.mitreTechniques || [],
    principalUser,
    principalHost,
    principalIp,
    principalProcess: (input.principalProcess || "").trim(),
    ...buildProcessFields({
      process: input.process,
      parent: input.parentProcess,
    }),
    targetUser,
    targetHost,
    targetIp,
    targetPort: input.targetPort || 0,
    targetResource: (input.targetResource || "").trim(),
    observables: buildObservables([
      principalUser,
      targetUser,
      principalHost,
      targetHost,
      principalIp,
      targetIp,
    ]),
    attributes,
  };
}

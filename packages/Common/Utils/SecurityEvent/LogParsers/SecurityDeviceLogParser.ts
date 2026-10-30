import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import { ParsedCef, findCefStart, parseCef } from "../../Syslog/CefParser";
import { ParsedLeef, findLeefStart, parseLeef } from "../../Syslog/LeefParser";
import { parseEventTime } from "../NormalizerHelpers";
import {
  SecurityLogLine,
  buildLogSecurityEvent,
  cutText,
  readIpAddress,
  readPort,
  readRemoteIpAddress,
} from "./SecurityLogLine";

/*
 * What security products send over syslog in the two formats SIEMs share:
 * Common Event Format (CEF, ArcSight's) and Log Event Extended Format
 * (LEEF, IBM QRadar's). Firewalls, IDS and IPS, WAFs, web proxies, VPN
 * gateways and endpoint products from almost every vendor speak one of
 * them, so these two parsers read hundreds of products:
 *
 *   CEF:0|Imperva Inc.|SecureSphere|15.0|Protocol|SQL injection|High|act=block src=203.0.113.7 dst=10.0.0.5 dpt=443
 *   LEEF:1.0|Zscaler|NSSWeblog|5.7|Blocked|cat=Malicious Content	src=192.0.2.15	usrName=alice@example.com	action=Blocked	sev=9
 *
 * The line names its own maker in its header, and the event keeps it: the
 * vendor and product are the device's, never "CEF". The fields stay as the
 * device wrote them (cef.src, leef.usrName), the same keys the log has.
 *
 * A security product writes a record for nearly everything it does - each
 * connection a firewall allowed, each page a proxy served - and only some
 * of them are worth a security team's time. A record becomes a security
 * event when it is (SecurityDeviceLogParser.read):
 *
 *   - a threat the product found: its name, category or signature says so
 *     (THREAT_MARKERS) - malware, an intrusion, an exploit, an attack;
 *   - something it blocked or detected: its action says so
 *     (BLOCK_ACTIONS, DETECT_ACTIONS) - a denied connection, a dropped
 *     packet, a quarantined file, an alert;
 *   - a sign-in to it or through it, failed or not (SIGN_IN_MARKERS) - a
 *     VPN or an administrator signing in;
 *   - or rated High or Very-High by the product itself.
 *
 * Everything else - an allowed connection, a routine system message -
 * stays a log. Every word these rules read is in the line itself, which is
 * what lets the log scan ask the database for these lines alone
 * (SECURITY_DEVICE_PREFILTER_GROUPS).
 */

export const DEVICE_AUTHENTICATION_CLASS_UID: number = 3002;
export const DEVICE_DETECTION_FINDING_CLASS_UID: number = 2004;
export const DEVICE_NETWORK_ACTIVITY_CLASS_UID: number = 4001;
export const DEVICE_HTTP_ACTIVITY_CLASS_UID: number = 4002;

/*
 * Words in a record's name, category, signature or message that say it is
 * a sign-in. Matched as written, lowercase, anywhere in those fields.
 */
export const SIGN_IN_MARKERS: ReadonlyArray<string> = [
  "login",
  "logon",
  "log in",
  "log on",
  "logged in",
  "logged on",
  "sign-in",
  "sign in",
  "signin",
  "signed in",
  "authenticat",
];

/*
 * Words in a record's name, category or signature that say it is a threat
 * the product found. Matched as written, lowercase.
 */
export const THREAT_MARKERS: ReadonlyArray<string> = [
  "threat",
  "attack",
  "attempted",
  "malware",
  "virus",
  "trojan",
  "worm",
  "ransomware",
  "spyware",
  "botnet",
  "exploit",
  "intrusion",
  "ips signature",
  "vulnerab",
  "suspicious",
  "malicious",
  "phishing",
  "brute force",
  "brute-force",
  "bruteforce",
  "injection",
  "backdoor",
  "command and control",
  "infected",
  "quarantin",
  "compromise",
  "port scan",
  "portscan",
  "ddos",
  "detection",
];

// An action that stopped something: a word of the action field, as written.
export const BLOCK_ACTIONS: ReadonlyArray<string> = [
  "block",
  "blocked",
  "deny",
  "denied",
  "drop",
  "dropped",
  "reject",
  "rejected",
  "reset",
  "prevent",
  "prevented",
  "quarantine",
  "quarantined",
  "clean",
  "cleaned",
  "terminate",
  "terminated",
  "sinkhole",
  "refuse",
  "refused",
  "disallow",
  "disallowed",
  "discard",
  "discarded",
  "isolate",
  "isolated",
  "delete",
  "deleted",
];

// An action that let something through but raised it.
export const DETECT_ACTIONS: ReadonlyArray<string> = [
  "alert",
  "alerted",
  "detect",
  "detected",
];

// Words that say a sign-in, or a request, did not succeed.
const FAILURE_MARKERS: ReadonlyArray<string> = [
  "fail",
  "denied",
  "deny",
  "invalid",
  "reject",
  "wrong",
  "bad password",
  "locked",
  "unauthorized",
];

const SUCCESS_MARKERS: ReadonlyArray<string> = [
  "success",
  "succeeded",
  "allow",
  "accept",
  "permit",
];

// A device's time as epoch seconds, milliseconds or finer, digits only.
const EPOCH_TIME: RegExp = /^\d{9,19}$/;
// A device's time in ISO 8601: a date, a T and the hour and minute.
const ISO_TIME_START: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// A product's own severity: CEF's and LEEF's 0 to 10, or CEF's four words.
const HIGH_NUMERIC_SEVERITIES: ReadonlyArray<string> = ["7", "8", "9", "10"];
const HIGH_WORD_SEVERITIES: ReadonlyArray<string> = [
  "high",
  "very-high",
  "very high",
];

/*
 * The words of the prefilter that hold every line this parser keeps
 * (SecurityLogParser's SECURITY_LOG_PREFILTER reads them): each rule above
 * is decided on text that is in the line, so a line it keeps holds one of
 * these, lowercase.
 */
export const SECURITY_DEVICE_PREFILTER_WORDS: ReadonlyArray<string> = [
  ...SIGN_IN_MARKERS,
  ...THREAT_MARKERS,
  ...BLOCK_ACTIONS,
  ...DETECT_ACTIONS,
  ...HIGH_NUMERIC_SEVERITIES.map((severity: string): string => {
    return `|${severity}|`;
  }),
  ...HIGH_WORD_SEVERITIES.map((severity: string): string => {
    return `|${severity}|`;
  }),
  ...HIGH_NUMERIC_SEVERITIES.map((severity: string): string => {
    return `sev=${severity}`;
  }),
];

interface DeviceRecord {
  format: SecurityLogFormat.Cef | SecurityLogFormat.Leef;
  // The attribute prefix the record's fields are kept under.
  prefix: string;
  vendor: string;
  product: string;
  productVersion: string;
  // CEF's device event class id (a signature id), LEEF's event id.
  signatureId: string;
  // CEF's name; LEEF has none, so its category, else its event id.
  name: string;
  // The product's severity, as written.
  severity: string;
  // The text that must be in the line for a high severity to count.
  severityMarker: string;
  fields: Record<string, string>;
  // The header's own fields, kept as attributes.
  header: Record<string, string>;
}

function readField(
  fields: Record<string, string>,
  keys: ReadonlyArray<string>,
): string {
  for (const key of keys) {
    const value: string | undefined = fields[key];

    if (value !== undefined && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function holdsAny(lowerText: string, words: ReadonlyArray<string>): boolean {
  return words.some((word: string): boolean => {
    return lowerText.indexOf(word) !== -1;
  });
}

/*
 * The words of an action field ("reset-both", "Blocked by policy"), split
 * on anything that is not a letter, lowercase.
 */
function actionWords(action: string): Array<string> {
  const words: Array<string> = [];
  let current: string = "";
  const lower: string = action.toLowerCase();

  for (let index: number = 0; index < lower.length; index++) {
    const character: string = lower.charAt(index);

    if (character >= "a" && character <= "z") {
      current += character;
      continue;
    }

    if (current) {
      words.push(current);
      current = "";
    }
  }

  if (current) {
    words.push(current);
  }

  return words;
}

function hasActionWord(action: string, words: ReadonlyArray<string>): boolean {
  return actionWords(action).some((word: string): boolean => {
    return words.includes(word);
  });
}

function fromCef(cef: ParsedCef): DeviceRecord {
  return {
    format: SecurityLogFormat.Cef,
    prefix: "cef",
    vendor: cef.deviceVendor,
    product: cef.deviceProduct,
    productVersion: cef.deviceVersion,
    signatureId: cef.deviceEventClassId,
    name: cef.name,
    severity: cef.severity,
    severityMarker: `|${cef.severity.toLowerCase()}|`,
    fields: cef.extensions,
    header: {
      vendor: cef.deviceVendor,
      product: cef.deviceProduct,
      device_version: cef.deviceVersion,
      event_class_id: cef.deviceEventClassId,
      name: cef.name,
      severity: cef.severity,
    },
  };
}

function fromLeef(leef: ParsedLeef): DeviceRecord {
  const severity: string = (leef.attributes["sev"] || "").trim();

  return {
    format: SecurityLogFormat.Leef,
    prefix: "leef",
    vendor: leef.vendor,
    product: leef.product,
    productVersion: leef.productVersion,
    signatureId: leef.eventId,
    name: readField(leef.attributes, ["cat", "category"]) || leef.eventId,
    severity,
    severityMarker: `sev=${severity.toLowerCase()}`,
    fields: leef.attributes,
    header: {
      vendor: leef.vendor,
      product: leef.product,
      version: leef.productVersion,
      event_id: leef.eventId,
    },
  };
}

// The product's severity as OCSF's: 0-10 or CEF's words.
export function readDeviceSeverity(severity: string): OcsfSeverity {
  const value: string = severity.trim().toLowerCase();

  if (value === "very-high" || value === "very high") {
    return OcsfSeverity.Critical;
  }

  if (value === "high") {
    return OcsfSeverity.High;
  }

  if (value === "medium") {
    return OcsfSeverity.Medium;
  }

  if (value === "low") {
    return OcsfSeverity.Low;
  }

  if (!value || value.length > 2) {
    return OcsfSeverity.Unknown;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 48 || code > 57) {
      return OcsfSeverity.Unknown;
    }
  }

  const level: number = Number(value);

  if (level === 0) {
    return OcsfSeverity.Informational;
  }

  if (level <= 3) {
    return OcsfSeverity.Low;
  }

  if (level <= 6) {
    return OcsfSeverity.Medium;
  }

  if (level <= 8) {
    return OcsfSeverity.High;
  }

  if (level <= 10) {
    return OcsfSeverity.Critical;
  }

  return OcsfSeverity.Unknown;
}

const SEVERITY_RANK: Record<string, number> = {
  [OcsfSeverity.Unknown]: 0,
  [OcsfSeverity.Informational]: 1,
  [OcsfSeverity.Low]: 2,
  [OcsfSeverity.Medium]: 3,
  [OcsfSeverity.High]: 4,
  [OcsfSeverity.Critical]: 5,
  [OcsfSeverity.Fatal]: 6,
  [OcsfSeverity.Other]: 0,
};

// The higher of two severities.
function atLeast(severity: OcsfSeverity, floor: OcsfSeverity): OcsfSeverity {
  return (SEVERITY_RANK[severity] || 0) >= (SEVERITY_RANK[floor] || 0)
    ? severity
    : floor;
}

/*
 * When the record happened, as the device says: an epoch number or an ISO
 * 8601 time. A device's own text dates ("Oct 30 2026 10:00:00") name no
 * time zone, so the time the line was written is kept for those.
 */
function readDeviceTime(record: DeviceRecord): Date | undefined {
  const value: string =
    record.format === SecurityLogFormat.Cef
      ? readField(record.fields, ["rt", "deviceReceiptTime", "end", "start"])
      : readField(record.fields, ["devTime"]);

  if (!value) {
    return undefined;
  }

  const isNumber: boolean = EPOCH_TIME.test(value);
  const isIso: boolean = ISO_TIME_START.test(value);

  if (!isNumber && !isIso) {
    return undefined;
  }

  return parseEventTime(value) || undefined;
}

// Actions that let something through.
const ALLOW_ACTIONS: ReadonlyArray<string> = [
  "allow",
  "allowed",
  "accept",
  "accepted",
  "permit",
  "permitted",
  "pass",
  "passed",
];

// A word of the line's action, prettified.
function prettyWord(word: string): string {
  const trimmed: string = word.trim();

  if (!trimmed) {
    return "";
  }

  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1).toLowerCase()}`;
}

/*
 * The event's status, from the line's action: Blocked, Detected or
 * Allowed, as the product's own word for it varies ("reset-both",
 * "dropped", "Prevent"); any other action as written.
 */
export function readActionStatus(action: string): string {
  if (hasActionWord(action, BLOCK_ACTIONS)) {
    return "Blocked";
  }

  if (hasActionWord(action, DETECT_ACTIONS)) {
    return "Detected";
  }

  if (hasActionWord(action, ALLOW_ACTIONS)) {
    return "Allowed";
  }

  return prettyWord(action);
}

export interface SecurityDeviceReading {
  record: DeviceRecord;
  // Why the record is a security event.
  reason: "threat" | "blocked" | "detected" | "sign-in" | "high-severity";
}

export default class SecurityDeviceLogParser {
  /*
   * The record a line holds, when it is a security event by the rules in
   * the file's comment; null for any other line.
   */
  public static read(line: SecurityLogLine): SecurityDeviceReading | null {
    const body: string = line.body || "";

    let record: DeviceRecord | null = null;

    if (findCefStart(body) !== -1) {
      const cef: ParsedCef | null = parseCef(body);
      record = cef ? fromCef(cef) : null;
    } else if (findLeefStart(body) !== -1) {
      const leef: ParsedLeef | null = parseLeef(body);
      record = leef ? fromLeef(leef) : null;
    }

    if (!record) {
      return null;
    }

    const lowerLine: string = body.toLowerCase();
    /*
     * Each field is read on its own, never joined to the next: a word the
     * rules find is then always in the line as written, which is what the
     * database's prefilter reads.
     */
    const namedFields: Array<string> = [
      record.name,
      readField(record.fields, ["cat", "deviceEventCategory", "category"]),
      record.signatureId,
    ].map((field: string): string => {
      return field.toLowerCase();
    });
    const action: string = readField(record.fields, [
      "act",
      "deviceAction",
      "action",
    ]);
    const url: string = readField(record.fields, [
      "request",
      "requestURL",
      "url",
    ]);
    const message: string = readField(record.fields, ["msg", "message"]);
    const namesAny: (words: ReadonlyArray<string>) => boolean = (
      words: ReadonlyArray<string>,
    ): boolean => {
      return namedFields.some((field: string): boolean => {
        return holdsAny(field, words);
      });
    };

    if (namesAny(THREAT_MARKERS)) {
      return { record, reason: "threat" };
    }

    /*
     * A sign-in before an action: a VPN refusing a password is a failed
     * sign-in, not a refused connection. The message says so only for a
     * record that has no action and no address of its own - a router's
     * "login failure for user guest" - never for a proxy that blocked a
     * request to a sign-in page.
     */
    if (
      namesAny(SIGN_IN_MARKERS) ||
      (!action && !url && holdsAny(message.toLowerCase(), SIGN_IN_MARKERS))
    ) {
      return { record, reason: "sign-in" };
    }

    if (hasActionWord(action, BLOCK_ACTIONS)) {
      return { record, reason: "blocked" };
    }

    if (hasActionWord(action, DETECT_ACTIONS)) {
      return { record, reason: "detected" };
    }

    const severity: string = record.severity.trim().toLowerCase();
    // LEEF's sev is a number from 1 to 10; only CEF also has words.
    const isHigh: boolean =
      HIGH_NUMERIC_SEVERITIES.includes(severity) ||
      (record.format === SecurityLogFormat.Cef &&
        HIGH_WORD_SEVERITIES.includes(severity));

    if (isHigh && lowerLine.indexOf(record.severityMarker) !== -1) {
      return { record, reason: "high-severity" };
    }

    return null;
  }

  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const reading: SecurityDeviceReading | null =
      SecurityDeviceLogParser.read(line);

    if (!reading) {
      return [];
    }

    return [SecurityDeviceLogParser.toEvent(line, reading)];
  }

  private static toEvent(
    line: SecurityLogLine,
    reading: SecurityDeviceReading,
  ): NormalizedSecurityEvent {
    const record: DeviceRecord = reading.record;
    const fields: Record<string, string> = record.fields;

    const sourceIp: string = readRemoteIpAddress(
      readField(fields, ["src", "sourceAddress", "c6a2", "srcIP"]),
    );
    const destinationIp: string = readIpAddress(
      readField(fields, ["dst", "destinationAddress", "c6a3", "dstIP"]),
    );
    const sourcePort: number = readPort(
      readField(fields, ["spt", "sourcePort", "srcPort"]),
    );
    const destinationPort: number = readPort(
      readField(fields, ["dpt", "destinationPort", "dstPort"]),
    );
    const sourceUser: string = readField(fields, [
      "suser",
      "sourceUserName",
      "usrName",
      "accountName",
      "userName",
      "user",
    ]);
    const destinationUser: string = readField(fields, [
      "duser",
      "destinationUserName",
      "dstUserName",
    ]);
    const sourceHost: string = readField(fields, [
      "shost",
      "sourceHostName",
      "srcHostName",
      "identHostName",
    ]);
    const destinationHost: string = readField(fields, [
      "dhost",
      "destinationHostName",
      "dstHostName",
    ]);
    const deviceHost: string =
      readField(fields, ["dvchost", "deviceHostName", "devName"]) ||
      readIpAddress(readField(fields, ["dvc", "deviceAddress", "devIP"]));
    const action: string = readField(fields, ["act", "deviceAction", "action"]);
    const outcome: string = readField(fields, [
      "outcome",
      "eventOutcome",
      "result",
    ]);
    const url: string = readField(fields, ["request", "requestURL", "url"]);
    const method: string = readField(fields, ["requestMethod", "method"]);
    const message: string = readField(fields, ["msg", "message"]);
    const fileName: string = readField(fields, [
      "fname",
      "fileName",
      "filePath",
    ]);
    const processName: string = readField(fields, [
      "sproc",
      "sourceProcessName",
      "dproc",
      "destinationProcessName",
      "deviceProcessName",
    ]);
    const deviceSeverity: OcsfSeverity = readDeviceSeverity(record.severity);

    const lowerStatusText: string =
      `${outcome} ${action} ${record.name} ${message}`.toLowerCase();
    const isFailure: boolean = holdsAny(lowerStatusText, FAILURE_MARKERS);
    const isSuccess: boolean =
      !isFailure && holdsAny(lowerStatusText, SUCCESS_MARKERS);

    let classUid: number = DEVICE_DETECTION_FINDING_CLASS_UID;
    let activityName: string = "Create";
    let statusName: string = readActionStatus(action);
    let severity: OcsfSeverity = deviceSeverity;
    let principalUser: string = sourceUser || "";
    let targetUser: string = destinationUser;
    let ruleName: string = record.name;
    let ruleId: string = record.signatureId;

    if (reading.reason === "sign-in") {
      classUid = DEVICE_AUTHENTICATION_CLASS_UID;
      activityName = "Logon";
      statusName = isFailure ? "Failure" : isSuccess ? "Success" : "";
      // The account that signed in: whoever the device names first.
      principalUser = sourceUser || destinationUser;
      targetUser = sourceUser && destinationUser ? destinationUser : "";
      ruleName = "";
      ruleId = "";
      severity = isFailure
        ? atLeast(deviceSeverity, OcsfSeverity.Low)
        : deviceSeverity === OcsfSeverity.Unknown
          ? OcsfSeverity.Informational
          : deviceSeverity;
    } else if (reading.reason === "blocked" && (sourceIp || destinationIp)) {
      if (url) {
        classUid = DEVICE_HTTP_ACTIVITY_CLASS_UID;
        activityName = method ? method.toUpperCase().slice(0, 16) : "Request";
      } else {
        classUid = DEVICE_NETWORK_ACTIVITY_CLASS_UID;
        activityName = "Refuse";
      }

      ruleName = "";
      ruleId = "";
      statusName = readActionStatus(action) || "Blocked";
      severity =
        deviceSeverity === OcsfSeverity.Unknown
          ? OcsfSeverity.Low
          : deviceSeverity;
    } else {
      // A threat, an alert, or a record the product rated High.
      statusName = readActionStatus(action);
      severity =
        deviceSeverity === OcsfSeverity.Unknown
          ? OcsfSeverity.Medium
          : deviceSeverity;
    }

    const who: string = principalUser || sourceIp || sourceHost;
    const where: string = destinationIp
      ? `${destinationIp}${destinationPort ? `:${destinationPort}` : ""}`
      : destinationHost;
    const what: string = record.name || record.signatureId || "Event";
    const summary: string =
      reading.reason === "sign-in"
        ? `${isFailure ? "Failed sign-in" : "Sign-in"}${principalUser ? ` for ${principalUser}` : ""}${sourceIp ? ` from ${sourceIp}` : ""}${deviceHost || record.product ? ` on ${deviceHost || record.product}` : ""}`
        : `${what}${who ? ` from ${who}` : ""}${where ? ` to ${where}` : ""}${action ? ` (${action.toLowerCase()})` : ""}`;

    const attributes: JSONObject = {};

    for (const key of Object.keys(record.header)) {
      attributes[`${record.prefix}.${key}`] = record.header[key]!;
    }

    for (const key of Object.keys(fields)) {
      attributes[`${record.prefix}.${key}`] = fields[key]!;
    }

    const externalId: string = readField(fields, ["externalId"]);

    return buildLogSecurityEvent({
      line,
      format: record.format,
      classUid,
      activityName,
      statusName,
      severity,
      message: message ? `${summary}: ${cutText(message, 500)}` : summary,
      time: readDeviceTime(record),
      vendorName: record.vendor,
      productName: record.product,
      ruleId,
      ruleName,
      eventUid:
        externalId && record.vendor && record.product
          ? `${record.format}:${record.vendor}:${record.product}:${externalId}`
          : undefined,
      principalUser,
      principalHost: sourceHost,
      principalIp: sourceIp,
      principalProcess: processName,
      targetUser,
      targetHost: destinationHost || deviceHost,
      targetIp: destinationIp,
      targetPort: destinationPort,
      targetResource: url || fileName,
      attributes: {
        ...attributes,
        ...(sourcePort ? { "source.port": String(sourcePort) } : {}),
      },
    });
  }
}

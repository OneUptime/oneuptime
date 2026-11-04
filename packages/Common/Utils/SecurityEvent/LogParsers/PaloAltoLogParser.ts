import { JSONObject } from "../../../Types/JSON";
import lookupTable from "../../LookupTable";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import { readActionStatus } from "./SecurityDeviceLogParser";
import {
  SecurityLogLine,
  buildLogSecurityEvent,
  cutText,
  readIpAddress,
  readPort,
  readRemoteIpAddress,
} from "./SecurityLogLine";

/*
 * Palo Alto Networks firewalls' own syslog (PAN-OS): each record one line
 * of comma-separated fields, in the order PAN-OS documents for its log type
 * (Syslog Field Descriptions), after the syslog header when the line still
 * has one:
 *
 *   <14>Oct 30 10:00:00 PA-3220 1,2026/10/30 10:00:00,012801000000,THREAT,vulnerability,2561,2026/10/30 10:00:00,203.0.113.7,192.0.2.20,...
 *
 * A record becomes a security event when it is (PaloAltoLogParser.read):
 *
 *   - THREAT: a threat the firewall found - a virus, spyware, an exploit of
 *     a vulnerability, a flood, a scan, a bad packet, a WildFire verdict
 *     other than benign - whatever it did about it; and a URL, a file or
 *     data it blocked;
 *   - TRAFFIC: a connection it denied, dropped or reset;
 *   - GLOBALPROTECT: a VPN sign-in to the portal or a gateway, failed or not;
 *   - SYSTEM: an administrator signing in to the firewall, failed or not;
 *   - CONFIG: an administrator's change to its configuration.
 *
 * Everything else - an allowed connection, a URL browsed, a routine system
 * message - stays a log. Every word these rules read is in the line itself
 * (the type, the subtype, the action, the event id), which is what lets the
 * log scan ask the database for these lines alone
 * (PALO_ALTO_PREFILTER_GROUPS).
 *
 * The fields keep PAN-OS's own names for them (panos.src, panos.threatid,
 * panos.srcuser), so a rule written against PAN-OS's fields reads them as
 * documented. The record is read with indexOf and one pass over its
 * characters, never a regular expression: it is text anybody on the
 * network can shape.
 */

export const PALO_ALTO_VENDOR_NAME: string = "Palo Alto Networks";
export const PALO_ALTO_PRODUCT_NAME: string = "PAN-OS";

const AUTHENTICATION: number = 3002;
const DETECTION_FINDING: number = 2004;
const NETWORK_ACTIVITY: number = 4001;
const HTTP_ACTIVITY: number = 4002;
const API_ACTIVITY: number = 6003;

// The log types read, as PAN-OS writes them in a record's fourth field.
export enum PaloAltoLogType {
  Traffic = "TRAFFIC",
  Threat = "THREAT",
  GlobalProtect = "GLOBALPROTECT",
  System = "SYSTEM",
  Config = "CONFIG",
}

const LOG_TYPES: ReadonlyArray<PaloAltoLogType> = [
  PaloAltoLogType.Threat,
  PaloAltoLogType.Traffic,
  PaloAltoLogType.GlobalProtect,
  PaloAltoLogType.System,
  PaloAltoLogType.Config,
];

/*
 * Each log type's fields, by PAN-OS's own variable name, in the order its
 * Format line documents them; a FUTURE_USE position is named "" and kept
 * nowhere. Later releases add fields at the end.
 */
const COMMON_START: ReadonlyArray<string> = [
  "",
  "receive_time",
  "serial",
  "type",
  "subtype",
  "",
  "time_generated",
];

// TRAFFIC and THREAT share their first 30 fields.
const SESSION_FIELDS: ReadonlyArray<string> = [
  ...COMMON_START,
  "src",
  "dst",
  "natsrc",
  "natdst",
  "rule",
  "srcuser",
  "dstuser",
  "app",
  "vsys",
  "from",
  "to",
  "inbound_if",
  "outbound_if",
  "logset",
  "",
  "sessionid",
  "repeatcnt",
  "sport",
  "dport",
  "natsport",
  "natdport",
  "flags",
  "proto",
  "action",
];

export const PALO_ALTO_FIELDS: ReadonlyMap<
  string,
  ReadonlyArray<string>
> = lookupTable({
  [PaloAltoLogType.Traffic]: [
    ...SESSION_FIELDS,
    "bytes",
    "bytes_sent",
    "bytes_received",
    "packets",
    "start",
    "elapsed",
    "category",
    "",
    "seqno",
    "actionflags",
    "srcloc",
    "dstloc",
    "",
    "pkts_sent",
    "pkts_received",
    "session_end_reason",
  ],
  [PaloAltoLogType.Threat]: [
    ...SESSION_FIELDS,
    "misc",
    "threatid",
    "category",
    "severity",
    "direction",
    "seqno",
    "actionflags",
    "srcloc",
    "dstloc",
    "",
    "contenttype",
    "pcap_id",
    "filedigest",
    "cloud",
    "url_idx",
    "user_agent",
    "filetype",
    "xff",
    "referer",
    "sender",
    "subject",
    "recipient",
    "reportid",
  ],
  [PaloAltoLogType.GlobalProtect]: [
    ...COMMON_START,
    "vsys",
    "eventid",
    "stage",
    "auth_method",
    "tunnel_type",
    "srcuser",
    "srcregion",
    "machinename",
    "public_ip",
    "public_ipv6",
    "private_ip",
    "private_ipv6",
    "hostid",
    "serialnumber",
    "client_ver",
    "client_os",
    "client_os_ver",
    "repeatcnt",
    "reason",
    "error",
    "opaque",
    "status",
    "location",
    "login_duration",
    "connect_method",
    "error_code",
    "portal",
    "seqno",
  ],
  [PaloAltoLogType.System]: [
    ...COMMON_START,
    "vsys",
    "eventid",
    "object",
    "",
    "",
    "module",
    "severity",
    "opaque",
    "seqno",
  ],
  [PaloAltoLogType.Config]: [
    ...COMMON_START,
    "host",
    "vsys",
    "cmd",
    "admin",
    "client",
    "result",
    "path",
    "before_change_detail",
    "after_change_detail",
    "seqno",
  ],
});

// The most fields one record is read for; PAN-OS writes about a hundred.
const MAX_FIELDS: number = 160;
// The longest value of one field an event keeps.
const MAX_FIELD_LENGTH: number = 1000;
// A record's own first field (FUTURE_USE, "1") is never longer than this.
const MAX_FIRST_FIELD_LENGTH: number = 8;
// "2026/10/30 10:00:00": PAN-OS's receive time.
const RECEIVE_TIME_LENGTH: number = 19;

// THREAT subtypes that are threats whatever the firewall did about them.
export const PALO_ALTO_THREAT_SUBTYPES: ReadonlyArray<string> = [
  "virus",
  "spyware",
  "vulnerability",
  "wildfire-virus",
  "ml-virus",
  "flood",
  "scan",
  "packet",
];

// A WildFire submission's verdicts that are not a threat.
const BENIGN_VERDICTS: ReadonlyArray<string> = ["benign", ""];

/*
 * The actions that stopped something, as PAN-OS writes them - its manual
 * writes some with a space ("reset both", "drop ICMP"), its logs with a
 * dash - beside the words every security product's action may hold.
 */
export const PALO_ALTO_BLOCK_ACTIONS: ReadonlyArray<string> = [
  "deny",
  "drop",
  "drop-icmp",
  "drop icmp",
  "drop-all-packets",
  "reset-client",
  "reset-server",
  "reset-both",
  "reset client",
  "reset server",
  "reset both",
  "block-url",
  "block-continue",
  "block-override",
  "block-ip",
  "sinkhole",
  "random-drop",
];

// The GLOBALPROTECT events that are a sign-in: to the portal, or a gateway.
const GLOBALPROTECT_SIGN_IN_SUFFIX: string = "-auth";

// SYSTEM event ids and descriptions that are an administrator's sign-in.
const SYSTEM_SIGN_IN_FAILED_WORDS: ReadonlyArray<string> = [
  "auth-fail",
  "failed authentication",
];
const SYSTEM_SIGN_IN_WORDS: ReadonlyArray<string> = [
  ...SYSTEM_SIGN_IN_FAILED_WORDS,
  "auth-succ",
  "logged in via",
];

const CONFIG_RESULTS: ReadonlyArray<string> = [
  "submitted",
  "succeeded",
  "failed",
  "unauthorized",
];

const PAN_SEVERITIES: ReadonlyMap<string, OcsfSeverity> = lookupTable({
  informational: OcsfSeverity.Informational,
  low: OcsfSeverity.Low,
  medium: OcsfSeverity.Medium,
  high: OcsfSeverity.High,
  critical: OcsfSeverity.Critical,
});

/*
 * What the log scan asks the database for: a record of each type read,
 * with one of the words that make it an event, lowercase as the match is
 * case-insensitive. The type is written ",THREAT," between the serial and
 * the subtype; the subtype, the action and the event id each between
 * commas.
 */
export const PALO_ALTO_PREFILTER_GROUPS: ReadonlyArray<{
  requires: string;
  anyOf: ReadonlyArray<string>;
}> = [
  {
    requires: ",threat,",
    anyOf: [
      ...PALO_ALTO_THREAT_SUBTYPES.map((subtype: string): string => {
        return `,threat,${subtype},`;
      }),
      ",threat,wildfire,",
      ...PALO_ALTO_BLOCK_ACTIONS.map((action: string): string => {
        return `,${action},`;
      }),
    ],
  },
  {
    requires: ",traffic,",
    anyOf: [
      ",traffic,deny,",
      ",traffic,drop,",
      ...PALO_ALTO_BLOCK_ACTIONS.map((action: string): string => {
        return `,${action},`;
      }),
    ],
  },
  {
    requires: ",globalprotect,",
    anyOf: [`${GLOBALPROTECT_SIGN_IN_SUFFIX},`],
  },
  {
    requires: ",system,",
    anyOf: SYSTEM_SIGN_IN_WORDS,
  },
  {
    requires: ",config,",
    anyOf: CONFIG_RESULTS.map((result: string): string => {
      return `,${result},`;
    }),
  },
];

/*
 * A CSV record's fields, quoted ones ("a, b") unquoted, with "" inside a
 * quoted field read as one quote. One pass; at most MAX_FIELDS fields.
 */
export function splitPanOsFields(record: string): Array<string> {
  const fields: Array<string> = [];
  let current: string = "";
  let quoted: boolean = false;

  for (let index: number = 0; index < record.length; index++) {
    const character: string = record.charAt(index);

    if (quoted) {
      if (character === '"') {
        if (record.charAt(index + 1) === '"') {
          current += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }

      continue;
    }

    if (character === '"' && current.length === 0) {
      quoted = true;
      continue;
    }

    if (character === ",") {
      fields.push(current);
      current = "";

      if (fields.length >= MAX_FIELDS) {
        return fields;
      }

      continue;
    }

    current += character;
  }

  fields.push(current);

  return fields;
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

// "2026/10/30 10:00:00" - PAN-OS's receive time, digits where it has them.
function isReceiveTime(text: string): boolean {
  if (text.length !== RECEIVE_TIME_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);
    const expected: string =
      index === 4 || index === 7
        ? "/"
        : index === 10
          ? " "
          : index === 13 || index === 16
            ? ":"
            : "digit";

    if (expected === "digit" ? !isDigit(character) : character !== expected) {
      return false;
    }
  }

  return true;
}

// A serial number: letters and digits, as PAN-OS writes a device's.
function isSerial(text: string): boolean {
  if (!text || text.length > 32) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);
    const isLetter: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z");

    if (!isLetter && !isDigit(character)) {
      return false;
    }
  }

  return true;
}

export interface PaloAltoRecord {
  type: PaloAltoLogType;
  fields: Record<string, string>;
}

/*
 * The record a line holds: where ",TYPE," sits after the three fields
 * every record opens with - its first field, the receive time and the
 * serial number - or null for a line that is not one.
 */
export function readPaloAltoRecord(body: string): PaloAltoRecord | null {
  const text: string = body || "";

  for (const type of LOG_TYPES) {
    const marker: string = `,${type},`;
    const at: number = text.indexOf(marker);

    if (at === -1) {
      continue;
    }

    const serialStart: number = text.lastIndexOf(",", at - 1) + 1;
    const serial: string = text.slice(serialStart, at);

    if (serialStart === 0 || !isSerial(serial)) {
      continue;
    }

    const receiveStart: number = serialStart - 1 - RECEIVE_TIME_LENGTH;

    if (
      receiveStart < 2 ||
      !isReceiveTime(text.slice(receiveStart, serialStart - 1)) ||
      text.charAt(receiveStart - 1) !== ","
    ) {
      continue;
    }

    /*
     * The first field: from after the header's last space or colon (a tag
     * written "PA-3220:1,...") - or the line's start.
     */
    const firstEnd: number = receiveStart - 1;
    const firstStart: number =
      Math.max(
        text.lastIndexOf(" ", firstEnd),
        text.lastIndexOf(":", firstEnd),
      ) + 1;
    const first: string = text.slice(firstStart, firstEnd);

    if (!first || first.length > MAX_FIRST_FIELD_LENGTH) {
      continue;
    }

    const values: Array<string> = splitPanOsFields(text.slice(firstStart));
    const names: ReadonlyArray<string> = PALO_ALTO_FIELDS.get(type) || [];
    const fields: Record<string, string> = {};

    values.forEach((value: string, index: number): void => {
      const name: string =
        names[index] === undefined ? `field_${index}` : names[index]!;
      const trimmed: string = value.trim();

      if (!name || !trimmed || name === "__proto__") {
        return;
      }

      fields[name] = cutText(trimmed, MAX_FIELD_LENGTH);
    });

    if ((fields["type"] || "") !== type) {
      continue;
    }

    return { type, fields };
  }

  return null;
}

// A field's words, lowercase.
function lower(fields: Record<string, string>, name: string): string {
  return (fields[name] || "").toLowerCase();
}

// An action that stopped something, exactly as the prefilter asks for it.
function isBlockAction(action: string): boolean {
  return PALO_ALTO_BLOCK_ACTIONS.includes(action.trim().toLowerCase());
}

export type PaloAltoReason =
  | "threat"
  | "blocked"
  | "sign-in"
  | "admin-sign-in"
  | "config-change";

export interface PaloAltoReading {
  record: PaloAltoRecord;
  reason: PaloAltoReason;
}

/*
 * "Eicar Test File(39040)" -> the name and the id PAN-OS writes a threat
 * with; a name with no id after it is kept whole.
 */
export function readPanOsThreat(threatId: string): {
  name: string;
  id: string;
} {
  const value: string = threatId.trim();
  const open: number = value.lastIndexOf("(");

  if (open > 0 && value.endsWith(")")) {
    const id: string = value.slice(open + 1, -1);
    let digits: boolean = id.length > 0;

    for (let index: number = 0; index < id.length; index++) {
      if (!isDigit(id.charAt(index))) {
        digits = false;
        break;
      }
    }

    if (digits) {
      return { name: value.slice(0, open).trim(), id };
    }
  }

  return { name: value, id: "" };
}

// The address a SYSTEM description says a sign-in came from ("From: 203.0.113.7.").
function addressInDescription(description: string): string {
  const marker: string = "from: ";
  const at: number = description.toLowerCase().indexOf(marker);
  const alternative: number = description.toLowerCase().indexOf(" from ");
  const start: number =
    at !== -1
      ? at + marker.length
      : alternative !== -1
        ? alternative + " from ".length
        : -1;

  if (start === -1) {
    return "";
  }

  let end: number = start;

  while (
    end < description.length &&
    end - start < 64 &&
    description.charAt(end) !== " " &&
    description.charAt(end) !== ","
  ) {
    end++;
  }

  let candidate: string = description.slice(start, end);

  while (candidate.endsWith(".")) {
    candidate = candidate.slice(0, -1);
  }

  return readRemoteIpAddress(candidate);
}

// The account a SYSTEM description names: "for user 'admin'" or "User admin logged in".
function userInDescription(description: string): string {
  const quoted: string = "user '";
  const at: number = description.toLowerCase().indexOf(quoted);

  if (at !== -1) {
    const end: number = description.indexOf("'", at + quoted.length);

    if (end !== -1 && end - at < 300) {
      return description.slice(at + quoted.length, end);
    }
  }

  if (description.toLowerCase().startsWith("user ")) {
    const end: number = description.indexOf(" ", 5);

    return end === -1 ? "" : description.slice(5, Math.min(end, 300));
  }

  return "";
}

export default class PaloAltoLogParser {
  // The record a line holds, when it is a security event by the rules above.
  public static read(line: SecurityLogLine): PaloAltoReading | null {
    const record: PaloAltoRecord | null = readPaloAltoRecord(line.body || "");

    if (!record) {
      return null;
    }

    const fields: Record<string, string> = record.fields;
    const subtype: string = lower(fields, "subtype");
    const action: string = lower(fields, "action");
    /*
     * Each word a rule decides on must be in the line as written, between
     * the commas around it - what the database's prefilter reads - so a
     * value PAN-OS quoted, or one that only reads that way trimmed, is no
     * event the prefilter could have kept out.
     */
    const lowerLine: string = (line.body || "").toLowerCase();
    const written: (marker: string) => boolean = (marker: string): boolean => {
      return lowerLine.indexOf(marker) !== -1;
    };
    const isBlocked: boolean = isBlockAction(action) && written(`,${action},`);

    switch (record.type) {
      case PaloAltoLogType.Threat: {
        if (
          PALO_ALTO_THREAT_SUBTYPES.includes(subtype) &&
          written(`,threat,${subtype},`)
        ) {
          return { record, reason: "threat" };
        }

        if (
          subtype === "wildfire" &&
          written(",threat,wildfire,") &&
          !BENIGN_VERDICTS.includes(lower(fields, "category"))
        ) {
          return { record, reason: "threat" };
        }

        return isBlocked ? { record, reason: "blocked" } : null;
      }
      case PaloAltoLogType.Traffic:
        return ((subtype === "deny" || subtype === "drop") &&
          written(`,traffic,${subtype},`)) ||
          isBlocked
          ? { record, reason: "blocked" }
          : null;
      case PaloAltoLogType.GlobalProtect:
        return lower(fields, "eventid").endsWith(
          GLOBALPROTECT_SIGN_IN_SUFFIX,
        ) && written(`${GLOBALPROTECT_SIGN_IN_SUFFIX},`)
          ? { record, reason: "sign-in" }
          : null;
      case PaloAltoLogType.System: {
        const said: string = `${lower(fields, "eventid")} ${lower(fields, "opaque")}`;

        return SYSTEM_SIGN_IN_WORDS.some((word: string): boolean => {
          return said.indexOf(word) !== -1 && written(word);
        })
          ? { record, reason: "admin-sign-in" }
          : null;
      }
      case PaloAltoLogType.Config: {
        const result: string = lower(fields, "result");

        return CONFIG_RESULTS.includes(result) && written(`,${result},`)
          ? { record, reason: "config-change" }
          : null;
      }
    }
  }

  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const reading: PaloAltoReading | null = PaloAltoLogParser.read(line);

    if (!reading) {
      return [];
    }

    return [PaloAltoLogParser.toEvent(line, reading)];
  }

  private static toEvent(
    line: SecurityLogLine,
    reading: PaloAltoReading,
  ): NormalizedSecurityEvent {
    const fields: Record<string, string> = reading.record.fields;
    const field: (name: string) => string = (name: string): string => {
      return fields[name] || "";
    };
    const sourceIp: string = readRemoteIpAddress(field("src"));
    const destinationIp: string = readIpAddress(field("dst"));
    const destinationPort: number = readPort(field("dport"));
    const where: string = destinationIp
      ? `${destinationIp}${destinationPort ? `:${destinationPort}` : ""}`
      : "";
    const device: string = field("serial");
    const attributes: JSONObject = {};

    for (const name of Object.keys(fields)) {
      attributes[`panos.${name}`] = fields[name]!;
    }

    const base: {
      line: SecurityLogLine;
      format: SecurityLogFormat;
      vendorName: string;
      productName: string;
      attributes: JSONObject;
      eventUid: string | undefined;
    } = {
      line,
      format: SecurityLogFormat.PaloAlto,
      vendorName: PALO_ALTO_VENDOR_NAME,
      productName: PALO_ALTO_PRODUCT_NAME,
      attributes,
      // A record's sequence number is its own on the firewall that wrote it.
      eventUid:
        device && field("seqno")
          ? `panos:${device}:${reading.record.type}:${field("seqno")}`
          : undefined,
    };

    switch (reading.reason) {
      case "threat": {
        const threat: { name: string; id: string } = readPanOsThreat(
          field("threatid"),
        );
        const severity: OcsfSeverity =
          PAN_SEVERITIES.get(lower(fields, "severity")) || OcsfSeverity.Medium;
        const name: string =
          threat.name || `${field("subtype") || "Threat"} detected`;

        return buildLogSecurityEvent({
          ...base,
          classUid: DETECTION_FINDING,
          activityName: "Create",
          statusName: readActionStatus(field("action")) || "Detected",
          severity,
          message: `${name}${sourceIp ? ` from ${sourceIp}` : ""}${where ? ` to ${where}` : ""}${field("action") ? ` (${field("action").toLowerCase()})` : ""}`,
          ruleName: name,
          ruleId: threat.id,
          principalUser: field("srcuser"),
          principalIp: sourceIp,
          targetUser: field("dstuser"),
          targetIp: destinationIp,
          targetPort: destinationPort,
          targetResource: field("misc"),
        });
      }
      case "blocked": {
        const isUrl: boolean =
          reading.record.type === PaloAltoLogType.Threat &&
          lower(fields, "subtype") === "url";
        const isFileOrData: boolean =
          reading.record.type === PaloAltoLogType.Threat && !isUrl;
        const app: string = field("app");
        const rule: string = field("rule");

        if (isFileOrData) {
          const threat: { name: string; id: string } = readPanOsThreat(
            field("threatid"),
          );

          return buildLogSecurityEvent({
            ...base,
            classUid: DETECTION_FINDING,
            activityName: "Create",
            statusName: "Blocked",
            severity:
              PAN_SEVERITIES.get(lower(fields, "severity")) || OcsfSeverity.Low,
            message: `${threat.name || "A file"} blocked${sourceIp ? ` from ${sourceIp}` : ""}${where ? ` to ${where}` : ""}${field("misc") ? `: ${field("misc")}` : ""}`,
            ruleName: threat.name,
            ruleId: threat.id,
            principalUser: field("srcuser"),
            principalIp: sourceIp,
            targetIp: destinationIp,
            targetPort: destinationPort,
            targetResource: field("misc"),
          });
        }

        return buildLogSecurityEvent({
          ...base,
          classUid: isUrl ? HTTP_ACTIVITY : NETWORK_ACTIVITY,
          activityName: isUrl ? "Request" : "Refuse",
          statusName: "Blocked",
          severity: OcsfSeverity.Low,
          message: isUrl
            ? `Request to ${field("misc") || where || "a URL"} blocked${sourceIp ? ` from ${sourceIp}` : ""}${field("category") ? ` (${field("category")})` : ""}`
            : `${app && app !== "incomplete" ? app : "Connection"}${sourceIp ? ` from ${sourceIp}` : ""}${where ? ` to ${where}` : ""} blocked (${(field("action") || field("subtype") || "deny").toLowerCase()}${rule ? `, rule ${rule}` : ""})`,
          principalUser: field("srcuser"),
          principalIp: sourceIp,
          targetUser: field("dstuser"),
          targetIp: destinationIp,
          targetPort: destinationPort,
          targetResource: isUrl ? field("misc") : rule,
        });
      }
      case "sign-in": {
        const failed: boolean = lower(fields, "status") === "failure";
        const user: string = field("srcuser");
        const ip: string = readRemoteIpAddress(field("public_ip"));
        const why: string = field("error") || field("reason");

        return buildLogSecurityEvent({
          ...base,
          classUid: AUTHENTICATION,
          activityName: "Logon",
          statusName: failed ? "Failure" : "Success",
          severity: failed ? OcsfSeverity.Low : OcsfSeverity.Informational,
          message: `${failed ? "Failed GlobalProtect sign-in" : "GlobalProtect sign-in"}${user ? ` for ${user}` : ""}${ip ? ` from ${ip}` : ""}${field("portal") ? ` to ${field("portal")}` : ""}${failed && why ? `: ${cutText(why, 300)}` : ""}`,
          principalUser: user,
          principalIp: ip,
          principalHost: field("machinename"),
          targetHost: field("portal") || device,
        });
      }
      case "admin-sign-in": {
        const description: string = field("opaque");
        const said: string = `${lower(fields, "eventid")} ${description.toLowerCase()}`;
        const failed: boolean = SYSTEM_SIGN_IN_FAILED_WORDS.some(
          (word: string): boolean => {
            return said.indexOf(word) !== -1;
          },
        );
        const user: string = field("object") || userInDescription(description);
        const ip: string = addressInDescription(description);

        return buildLogSecurityEvent({
          ...base,
          classUid: AUTHENTICATION,
          activityName: "Logon",
          statusName: failed ? "Failure" : "Success",
          severity: failed ? OcsfSeverity.Low : OcsfSeverity.Informational,
          message: `${failed ? "Failed administrator sign-in" : "Administrator sign-in"}${user ? ` for ${user}` : ""}${ip ? ` from ${ip}` : ""} on the firewall${device ? ` ${device}` : ""}`,
          principalUser: user,
          principalIp: ip,
          targetHost: device,
        });
      }
      case "config-change": {
        const result: string = lower(fields, "result");
        const failed: boolean =
          result === "failed" || result === "unauthorized";
        const admin: string = field("admin");
        const host: string = readRemoteIpAddress(field("host"));
        const command: string = field("cmd") || "change";

        return buildLogSecurityEvent({
          ...base,
          classUid: API_ACTIVITY,
          activityName: cutText(command, 64),
          statusName: failed ? "Failure" : "Success",
          severity: failed ? OcsfSeverity.Low : OcsfSeverity.Informational,
          message: `${admin || "An administrator"} ran ${command}${field("path") ? ` on ${cutText(field("path"), 300)}` : ""}${host ? ` from ${host}` : ""}${field("client") ? ` (${field("client")})` : ""}${failed ? `: ${field("result").toLowerCase()}` : ""}`,
          principalUser: admin,
          principalIp: host,
          targetHost: device,
          targetResource: field("path"),
        });
      }
    }
  }
}

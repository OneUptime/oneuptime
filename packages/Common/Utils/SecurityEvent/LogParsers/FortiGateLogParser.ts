import { JSONObject } from "../../../Types/JSON";
import lookupTable from "../../LookupTable";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import { parseEventTime } from "../NormalizerHelpers";
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
 * Fortinet FortiGate firewalls' own syslog: each record one line of
 * key=value pairs, a value with spaces in double quotes, after the syslog
 * header when the line still has one:
 *
 *   date=2026-10-30 time=10:00:00 devname="FGT60F" devid="FGT60FTK2209XXXX" logid="0419016384" type="utm" subtype="ips" level="alert" severity="critical" srcip=203.0.113.7 dstip=192.0.2.20 dstport=80 action="dropped" attack="Apache.Log4j.Error.Log.Remote.Code.Execution" attackid=51006
 *
 * Older FortiOS writes the same keys with fewer quotes (type=utm). A record
 * becomes a security event when it is (FortiGateLogParser.read):
 *
 *   - a UTM record of a threat: an IPS signature, a virus, an anomaly
 *     (a DoS sensor), a WAF violation - whatever the FortiGate did about
 *     it; and any other UTM record (web filter, application control, DNS
 *     filter, DLP...) it blocked;
 *   - a traffic record it denied;
 *   - an event record of a sign-in, failed or not - an administrator, an
 *     SSL VPN or IPsec user, a firewall authentication - its log
 *     description says so ("Admin login failed", "SSL VPN login fail");
 *   - an event record of an administrator's configuration change (it names
 *     the configuration path it changed, cfgpath).
 *
 * Everything else - an accepted or closed session, a routine system
 * message - stays a log. Every word these rules read is in the line, which
 * is what the log scan asks the database for (FORTIGATE_PREFILTER_GROUPS).
 *
 * The fields keep FortiGate's own keys (fortigate.srcip, fortigate.attack),
 * as its log reference names them. The pairs are read in one pass over
 * the line, never with a regular expression.
 */

export const FORTIGATE_VENDOR_NAME: string = "Fortinet";
export const FORTIGATE_PRODUCT_NAME: string = "FortiGate";

const AUTHENTICATION: number = 3002;
const DETECTION_FINDING: number = 2004;
const NETWORK_ACTIVITY: number = 4001;
const HTTP_ACTIVITY: number = 4002;
const API_ACTIVITY: number = 6003;

// The most pairs one record is read for, and the longest value one keeps.
const MAX_PAIRS: number = 200;
const MAX_KEY_LENGTH: number = 64;
const MAX_VALUE_LENGTH: number = 2000;

// UTM subtypes that are threats whatever the FortiGate did about them.
export const FORTIGATE_THREAT_SUBTYPES: ReadonlyArray<string> = [
  "ips",
  "virus",
  "anomaly",
  "waf",
];

// The actions that stopped something, as FortiGate writes them.
export const FORTIGATE_BLOCK_ACTIONS: ReadonlyArray<string> = [
  "deny",
  "block",
  "blocked",
  "drop",
  "dropped",
  "reset",
  "reject",
  "quarantine",
  "clear_session",
];

// What makes an event record a sign-in, and a failed one.
const SIGN_IN_WORDS: ReadonlyArray<string> = ["login", "authentication"];
const SIGN_OUT_WORDS: ReadonlyArray<string> = ["logout", "log out", "logoff"];
const FAILED_WORDS: ReadonlyArray<string> = ["fail", "denied", "invalid"];

const CONFIG_CHANGE_ACTIONS: ReadonlyArray<string> = [
  "add",
  "edit",
  "delete",
  "set",
  "move",
  "clone",
  "rename",
  "unset",
];

const SEVERITIES: ReadonlyMap<string, OcsfSeverity> = lookupTable({
  critical: OcsfSeverity.Critical,
  high: OcsfSeverity.High,
  medium: OcsfSeverity.Medium,
  low: OcsfSeverity.Low,
  info: OcsfSeverity.Informational,
  informational: OcsfSeverity.Informational,
});

// FortiGate's log levels, as an OCSF severity for a UTM record without one.
const LEVELS: ReadonlyMap<string, OcsfSeverity> = lookupTable({
  emergency: OcsfSeverity.Critical,
  alert: OcsfSeverity.High,
  critical: OcsfSeverity.High,
  error: OcsfSeverity.Medium,
  warning: OcsfSeverity.Medium,
  notice: OcsfSeverity.Low,
  information: OcsfSeverity.Low,
  debug: OcsfSeverity.Informational,
});

/*
 * What the log scan asks the database for: a FortiGate record (logid=) of
 * a UTM type, a denied or blocked action, a sign-in or a configuration
 * change - each the way the line writes it, quoted or not, lowercase. An
 * action is asked for by how its value starts, so a value the parser reads
 * trimmed ("deny ") is asked for too.
 */
export const FORTIGATE_PREFILTER_GROUPS: ReadonlyArray<{
  requires: string;
  anyOf: ReadonlyArray<string>;
}> = [
  {
    requires: "logid=",
    anyOf: [
      'type="utm',
      "type=utm",
      ...FORTIGATE_BLOCK_ACTIONS.flatMap((action: string): Array<string> => {
        return [`action="${action}`, `action=${action}`];
      }),
      ...SIGN_IN_WORDS,
      "cfgpath=",
    ],
  },
];

function isKeyCharacter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9") ||
    character === "_" ||
    character === "-"
  );
}

/*
 * The key=value pairs of a line, in one pass: a key is letters, digits,
 * dashes and underscores starting the line or after a space; its value
 * runs to the next space, or - quoted - to the next quote that is not
 * escaped by a backslash. The first of two pairs with one key is kept.
 */
export function readFortiGatePairs(body: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  const text: string = body || "";
  let count: number = 0;
  let index: number = 0;

  while (index < text.length && count < MAX_PAIRS) {
    // The start of a key: the line's start, or after a space.
    if (index > 0 && text.charAt(index - 1) !== " ") {
      index++;
      continue;
    }

    let end: number = index;

    while (end < text.length && isKeyCharacter(text.charAt(end))) {
      end++;
    }

    if (
      end === index ||
      end - index > MAX_KEY_LENGTH ||
      text.charAt(end) !== "="
    ) {
      index = Math.max(end, index + 1);
      continue;
    }

    const key: string = text.slice(index, end).toLowerCase();
    let valueStart: number = end + 1;
    let value: string = "";

    if (text.charAt(valueStart) === '"') {
      valueStart++;
      let cursor: number = valueStart;

      while (cursor < text.length) {
        const character: string = text.charAt(cursor);

        if (character === "\\" && cursor + 1 < text.length) {
          value += text.charAt(cursor + 1);
          cursor += 2;
          continue;
        }

        if (character === '"') {
          break;
        }

        value += character;
        cursor++;
      }

      index = cursor + 1;
    } else {
      const space: number = text.indexOf(" ", valueStart);
      const valueEnd: number = space === -1 ? text.length : space;

      value = text.slice(valueStart, valueEnd);
      index = valueEnd;
    }

    if (key !== "__proto__" && pairs[key] === undefined) {
      pairs[key] = cutText(value.trim(), MAX_VALUE_LENGTH);
      count++;
    }
  }

  return pairs;
}

export interface FortiGateRecord {
  pairs: Record<string, string>;
}

/*
 * A FortiGate record: a log id, a type and the device that wrote it (its
 * name or its serial number), or null for any other line.
 */
export function readFortiGateRecord(body: string): FortiGateRecord | null {
  const text: string = body || "";

  if (text.indexOf("logid=") === -1 || text.indexOf("type=") === -1) {
    return null;
  }

  const pairs: Record<string, string> = readFortiGatePairs(text);

  if (!pairs["logid"] || !pairs["type"] || !(pairs["devid"] || pairs["devname"])) {
    return null;
  }

  return { pairs };
}

export type FortiGateReason =
  | "threat"
  | "blocked"
  | "sign-in"
  | "config-change";

export interface FortiGateReading {
  record: FortiGateRecord;
  reason: FortiGateReason;
}

function holdsAny(text: string, words: ReadonlyArray<string>): boolean {
  return words.some((word: string): boolean => {
    return text.indexOf(word) !== -1;
  });
}

function isBlockAction(action: string): boolean {
  return FORTIGATE_BLOCK_ACTIONS.includes(action.toLowerCase());
}

// When the record happened: its eventtime, else its date and time (UTC when no zone).
function readFortiGateTime(pairs: Record<string, string>): Date | undefined {
  const eventTime: string = pairs["eventtime"] || "";
  let digits: boolean = eventTime.length >= 9 && eventTime.length <= 19;

  for (let index: number = 0; digits && index < eventTime.length; index++) {
    const code: number = eventTime.charCodeAt(index);
    digits = code >= 48 && code <= 57;
  }

  if (digits) {
    return parseEventTime(eventTime) || undefined;
  }

  const date: string = pairs["date"] || "";
  const time: string = pairs["time"] || "";
  const zone: string = (pairs["tz"] || "").trim();

  if (date.length !== 10 || time.length < 8) {
    return undefined;
  }

  const offset: string =
    zone.length === 5 && (zone.charAt(0) === "+" || zone.charAt(0) === "-")
      ? `${zone.slice(0, 3)}:${zone.slice(3)}`
      : "Z";

  return parseEventTime(`${date}T${time.slice(0, 8)}${offset}`) || undefined;
}

export default class FortiGateLogParser {
  // The record a line holds, when it is a security event by the rules above.
  public static read(line: SecurityLogLine): FortiGateReading | null {
    const record: FortiGateRecord | null = readFortiGateRecord(
      line.body || "",
    );

    if (!record) {
      return null;
    }

    const pairs: Record<string, string> = record.pairs;
    const type: string = (pairs["type"] || "").toLowerCase();
    const subtype: string = (pairs["subtype"] || "").toLowerCase();
    const action: string = (pairs["action"] || "").toLowerCase();
    /*
     * Each word a rule decides on must be in the line as written - what the
     * database's prefilter reads - so a value only read that way once
     * trimmed or unescaped is no event the prefilter could have kept out.
     */
    const lowerLine: string = (line.body || "").toLowerCase();
    const written: (marker: string) => boolean = (marker: string): boolean => {
      return lowerLine.indexOf(marker) !== -1;
    };
    const isBlocked: boolean =
      isBlockAction(action) &&
      (written(`action="${action}`) || written(`action=${action}`));

    if (type === "utm" && (written('type="utm') || written("type=utm"))) {
      if (FORTIGATE_THREAT_SUBTYPES.includes(subtype)) {
        return { record, reason: "threat" };
      }

      return isBlocked ? { record, reason: "blocked" } : null;
    }

    if (type === "traffic") {
      return isBlocked ? { record, reason: "blocked" } : null;
    }

    if (type === "event") {
      const said: string =
        `${pairs["logdesc"] || ""} ${action} ${pairs["msg"] || ""}`.toLowerCase();

      if (
        SIGN_IN_WORDS.some((word: string): boolean => {
          return said.indexOf(word) !== -1 && written(word);
        }) &&
        !holdsAny(said, SIGN_OUT_WORDS)
      ) {
        return { record, reason: "sign-in" };
      }

      if (pairs["cfgpath"] && CONFIG_CHANGE_ACTIONS.includes(action)) {
        return { record, reason: "config-change" };
      }
    }

    return null;
  }

  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const reading: FortiGateReading | null = FortiGateLogParser.read(line);

    if (!reading) {
      return [];
    }

    return [FortiGateLogParser.toEvent(line, reading)];
  }

  private static toEvent(
    line: SecurityLogLine,
    reading: FortiGateReading,
  ): NormalizedSecurityEvent {
    const pairs: Record<string, string> = reading.record.pairs;
    const pair: (key: string) => string = (key: string): string => {
      return pairs[key] || "";
    };
    const sourceIp: string = readRemoteIpAddress(pair("srcip"));
    const destinationIp: string = readIpAddress(pair("dstip"));
    const destinationPort: number = readPort(pair("dstport"));
    const where: string = destinationIp
      ? `${destinationIp}${destinationPort ? `:${destinationPort}` : ""}`
      : "";
    const device: string = pair("devname") || pair("devid");
    const user: string = pair("user") || pair("srcuser") || pair("unauthuser");
    const attributes: JSONObject = {};

    for (const key of Object.keys(pairs)) {
      attributes[`fortigate.${key}`] = pairs[key]!;
    }

    const base: {
      line: SecurityLogLine;
      format: SecurityLogFormat;
      vendorName: string;
      productName: string;
      attributes: JSONObject;
      time: Date | undefined;
    } = {
      line,
      format: SecurityLogFormat.FortiGate,
      vendorName: FORTIGATE_VENDOR_NAME,
      productName: FORTIGATE_PRODUCT_NAME,
      attributes,
      time: readFortiGateTime(pairs),
    };

    switch (reading.reason) {
      case "threat": {
        const name: string =
          pair("attack") ||
          pair("virus") ||
          pair("signature") ||
          pair("msg") ||
          `FortiGate ${pair("subtype")} finding`;
        const severity: OcsfSeverity =
          SEVERITIES.get(pair("severity").toLowerCase()) ||
          SEVERITIES.get(pair("crlevel").toLowerCase()) ||
          LEVELS.get(pair("level").toLowerCase()) ||
          OcsfSeverity.Medium;

        return buildLogSecurityEvent({
          ...base,
          classUid: DETECTION_FINDING,
          activityName: "Create",
          statusName: readActionStatus(pair("action")) || "Detected",
          severity,
          message: `${cutText(name, 300)}${sourceIp ? ` from ${sourceIp}` : ""}${where ? ` to ${where}` : ""}${pair("action") ? ` (${pair("action").toLowerCase()})` : ""}`,
          ruleName: name,
          ruleId: pair("attackid") || pair("virusid") || pair("logid"),
          principalUser: user,
          principalIp: sourceIp,
          targetIp: destinationIp,
          targetPort: destinationPort,
          targetHost: pair("hostname"),
          targetResource: pair("url") || pair("filename"),
        });
      }
      case "blocked": {
        const isTraffic: boolean = pair("type").toLowerCase() === "traffic";
        const url: string = pair("url");
        const isRequest: boolean = !isTraffic && Boolean(url || pair("hostname"));
        const policy: string = pair("policyname") || pair("policyid");
        const what: string = isTraffic
          ? pair("service") || pair("app") || "Connection"
          : pair("catdesc") || pair("app") || pair("subtype");

        return buildLogSecurityEvent({
          ...base,
          classUid: isRequest ? HTTP_ACTIVITY : NETWORK_ACTIVITY,
          activityName: isRequest ? "Request" : "Refuse",
          statusName: "Blocked",
          severity: OcsfSeverity.Low,
          message: isRequest
            ? `Request to ${cutText(`${pair("hostname")}${url}`, 300) || where} blocked${sourceIp ? ` from ${sourceIp}` : ""}${what ? ` (${what})` : ""}`
            : `${what}${sourceIp ? ` from ${sourceIp}` : ""}${where ? ` to ${where}` : ""} blocked (${pair("action").toLowerCase() || "deny"}${policy ? `, policy ${policy}` : ""})`,
          principalUser: user,
          principalIp: sourceIp,
          targetIp: destinationIp,
          targetPort: destinationPort,
          targetHost: pair("hostname"),
          targetResource: isRequest ? url : policy,
        });
      }
      case "sign-in": {
        const said: string =
          `${pair("logdesc")} ${pair("action")} ${pair("status")} ${pair("msg")}`.toLowerCase();
        const failed: boolean =
          pair("status").toLowerCase() === "failed" ||
          pair("status").toLowerCase() === "failure" ||
          holdsAny(said, FAILED_WORDS);
        const ip: string =
          sourceIp || readRemoteIpAddress(pair("remip")) || uiAddress(pair("ui"));
        const what: string = pair("logdesc") || "Sign-in";

        return buildLogSecurityEvent({
          ...base,
          classUid: AUTHENTICATION,
          activityName: "Logon",
          statusName: failed ? "Failure" : "Success",
          severity: failed ? OcsfSeverity.Low : OcsfSeverity.Informational,
          message: `${cutText(what, 200)}${user ? ` for ${user}` : ""}${ip ? ` from ${ip}` : ""}${device ? ` on ${device}` : ""}${failed && pair("reason") ? `: ${cutText(pair("reason"), 200)}` : ""}`,
          principalUser: user,
          principalIp: ip,
          targetHost: device,
        });
      }
      case "config-change": {
        const ip: string = uiAddress(pair("ui"));
        const path: string = [pair("cfgpath"), pair("cfgobj")]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join(" ");

        return buildLogSecurityEvent({
          ...base,
          classUid: API_ACTIVITY,
          activityName: cutText(pair("action") || "Edit", 64),
          statusName: "Success",
          severity: OcsfSeverity.Informational,
          message: `${user || "An administrator"} ${pair("action").toLowerCase() || "changed"} ${cutText(path, 300) || "the configuration"}${ip ? ` from ${ip}` : ""}${device ? ` on ${device}` : ""}`,
          principalUser: user,
          principalIp: ip,
          targetHost: device,
          targetResource: path,
        });
      }
    }
  }
}

// "https(203.0.113.7)" or "ssh(203.0.113.7)" - the address a FortiGate ui names.
export function uiAddress(ui: string): string {
  const open: number = ui.indexOf("(");
  const close: number = ui.indexOf(")", open + 1);

  if (open === -1 || close === -1 || close - open > 64) {
    return "";
  }

  return readRemoteIpAddress(ui.slice(open + 1, close));
}

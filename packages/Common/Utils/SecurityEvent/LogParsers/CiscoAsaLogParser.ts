import { JSONObject } from "../../../Types/JSON";
import lookupTable from "../../LookupTable";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  SecurityLogLine,
  buildLogSecurityEvent,
  cutText,
  readIpAddress,
  readPort,
  readRemoteIpAddress,
} from "./SecurityLogLine";

/*
 * Cisco ASA's own syslog, and Firepower Threat Defense's, which shares its
 * messages: each a line "%ASA-<level>-<message id>: <text>" (or %FTD-),
 * after the syslog header when the line still has one, in the words Cisco's
 * syslog message guide gives each message id:
 *
 *   %ASA-4-106023: Deny tcp src outside:203.0.113.7/52314 dst inside:192.0.2.5/443 by access-group "outside_access_in" [0x0, 0x0]
 *
 * The messages read (CISCO_ASA_MESSAGES), and what each becomes:
 *
 *   - a connection denied - by an access list (106023, 106100 when it says
 *     denied, 710003), at the edge (106001, 106006, 106007, 106014), or as
 *     an attack (a spoofed address 106016, a land attack 106017, a
 *     teardrop 106020, a reverse path check 106021): a refused connection;
 *   - what the ASA's threat detection, its IPS signatures and its botnet
 *     traffic filter found (733100-733105, 400000-400050, 338001-338008):
 *     a finding;
 *   - a person signing in - to the ASA itself (605004, 605005, 611101,
 *     611102), through AAA (113004, 113005, 113015) or AnyConnect
 *     (113039): a sign-in, failed or not;
 *   - an administrator's command or privilege level (111008, 111010,
 *     502103).
 *
 * Everything else - a connection built or torn down, a routine message -
 * stays a log. The message id is in the line as written, which is what
 * the log scan asks the database for (CISCO_ASA_PREFILTER_GROUPS).
 *
 * The fields keep the names Cisco's guide gives them, under "asa."
 * (asa.message_id, asa.src_ip, asa.acl). Each message is read with
 * indexOf on its own words, never a regular expression.
 */

export const CISCO_VENDOR_NAME: string = "Cisco";
export const CISCO_ASA_PRODUCT_NAME: string = "Cisco ASA";
export const CISCO_FTD_PRODUCT_NAME: string = "Cisco Firepower Threat Defense";

const AUTHENTICATION: number = 3002;
const USER_ACCESS_MANAGEMENT: number = 3005;
const DETECTION_FINDING: number = 2004;
const NETWORK_ACTIVITY: number = 4001;
const API_ACTIVITY: number = 6003;

// The longest message text read; a longer one is cut, never skipped.
const MAX_TEXT_LENGTH: number = 4096;
// An address, a port or an interface name is never longer than this.
const MAX_TOKEN_LENGTH: number = 128;

export enum CiscoAsaKind {
  Denied = "denied",
  Attack = "attack",
  Finding = "finding",
  SignIn = "sign-in",
  Command = "command",
  Privilege = "privilege",
}

// The prefixes a message starts with: the ASA's and FTD's own.
const PREFIXES: ReadonlyArray<{ marker: string; productName: string }> = [
  { marker: "%ASA-", productName: CISCO_ASA_PRODUCT_NAME },
  { marker: "%FTD-", productName: CISCO_FTD_PRODUCT_NAME },
];

const IPS_MESSAGE_IDS: Array<string> = [];

for (let id: number = 400000; id <= 400050; id++) {
  IPS_MESSAGE_IDS.push(String(id));
}

// The messages read, by id, with what each is.
export const CISCO_ASA_MESSAGES: ReadonlyMap<string, CiscoAsaKind> =
  lookupTable({
    "106001": CiscoAsaKind.Denied,
    "106006": CiscoAsaKind.Denied,
    "106007": CiscoAsaKind.Denied,
    "106014": CiscoAsaKind.Denied,
    "106023": CiscoAsaKind.Denied,
    "106100": CiscoAsaKind.Denied,
    "710003": CiscoAsaKind.Denied,
    "106016": CiscoAsaKind.Attack,
    "106017": CiscoAsaKind.Attack,
    "106020": CiscoAsaKind.Attack,
    "106021": CiscoAsaKind.Attack,
    "733100": CiscoAsaKind.Finding,
    "733101": CiscoAsaKind.Finding,
    "733102": CiscoAsaKind.Finding,
    "733104": CiscoAsaKind.Finding,
    "733105": CiscoAsaKind.Finding,
    "338001": CiscoAsaKind.Finding,
    "338002": CiscoAsaKind.Finding,
    "338003": CiscoAsaKind.Finding,
    "338004": CiscoAsaKind.Finding,
    "338005": CiscoAsaKind.Finding,
    "338006": CiscoAsaKind.Finding,
    "338007": CiscoAsaKind.Finding,
    "338008": CiscoAsaKind.Finding,
    ...Object.fromEntries(
      IPS_MESSAGE_IDS.map((id: string): [string, CiscoAsaKind] => {
        return [id, CiscoAsaKind.Finding];
      }),
    ),
    "113004": CiscoAsaKind.SignIn,
    "113005": CiscoAsaKind.SignIn,
    "113015": CiscoAsaKind.SignIn,
    "113039": CiscoAsaKind.SignIn,
    "605004": CiscoAsaKind.SignIn,
    "605005": CiscoAsaKind.SignIn,
    "611101": CiscoAsaKind.SignIn,
    "611102": CiscoAsaKind.SignIn,
    "111008": CiscoAsaKind.Command,
    "111010": CiscoAsaKind.Command,
    "502103": CiscoAsaKind.Privilege,
  });

// What each attack the ASA dropped was, in a message's words.
const ATTACK_WORDS: ReadonlyMap<string, string> = lookupTable({
  "106016": "a spoofed packet",
  "106017": "a land attack",
  "106020": "a teardrop attack",
  "106021": "a packet that failed its reverse path check",
});

// The sign-ins that worked; the rest of CiscoAsaKind.SignIn failed.
const SUCCESSFUL_SIGN_INS: ReadonlyArray<string> = [
  "113004",
  "113039",
  "605005",
  "611101",
];

/*
 * An access list's every hit is logged by 106100 - the permitted ones too -
 * so it is read only when it says it denied.
 */
const DENIED_ONLY_MESSAGE_ID: string = "106100";
const DENIED_WORD: string = " denied ";

/*
 * What the log scan asks the database for: an ASA or FTD message of an id
 * read, as the line writes it ("-106023:"), lowercase - and 106100 only
 * when it says denied.
 */
export const CISCO_ASA_PREFILTER_GROUPS: ReadonlyArray<{
  requires: string;
  anyOf: ReadonlyArray<string>;
}> = [
  ...PREFIXES.map((prefix: { marker: string }) => {
    return {
      requires: prefix.marker.toLowerCase(),
      anyOf: Array.from(CISCO_ASA_MESSAGES.keys())
        .filter((id: string): boolean => {
          return id !== DENIED_ONLY_MESSAGE_ID;
        })
        .map((id: string): string => {
          return `-${id}:`;
        }),
    };
  }),
  {
    requires: `-${DENIED_ONLY_MESSAGE_ID}:`,
    anyOf: [DENIED_WORD],
  },
];

// The ASA's syslog levels (0 emergencies to 7 debugging) as a finding's severity.
const LEVEL_SEVERITIES: ReadonlyArray<OcsfSeverity> = [
  OcsfSeverity.Critical,
  OcsfSeverity.Critical,
  OcsfSeverity.High,
  OcsfSeverity.Medium,
  OcsfSeverity.Medium,
  OcsfSeverity.Low,
  OcsfSeverity.Low,
  OcsfSeverity.Informational,
];

// The botnet traffic filter's threat levels.
const THREAT_LEVELS: ReadonlyMap<string, OcsfSeverity> = lookupTable({
  "very-high": OcsfSeverity.Critical,
  high: OcsfSeverity.High,
  moderate: OcsfSeverity.Medium,
  low: OcsfSeverity.Low,
  "very-low": OcsfSeverity.Informational,
});

export interface CiscoAsaMessage {
  productName: string;
  level: number;
  id: string;
  kind: CiscoAsaKind;
  text: string;
}

function isDigits(text: string): boolean {
  if (!text) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

/*
 * The message a line holds - "%ASA-4-106023: ..." anywhere in it - when
 * it is one read, else null.
 */
export function readCiscoAsaMessage(body: string): CiscoAsaMessage | null {
  const text: string = body || "";

  for (const prefix of PREFIXES) {
    const at: number = text.indexOf(prefix.marker);

    if (at === -1) {
      continue;
    }

    const levelAt: number = at + prefix.marker.length;
    const level: string = text.charAt(levelAt);

    if (!isDigits(level) || text.charAt(levelAt + 1) !== "-") {
      continue;
    }

    const idStart: number = levelAt + 2;
    const colon: number = text.indexOf(":", idStart);

    if (colon === -1 || colon - idStart !== 6) {
      continue;
    }

    const id: string = text.slice(idStart, colon);
    const kind: CiscoAsaKind | undefined = CISCO_ASA_MESSAGES.get(id);

    if (!isDigits(id) || !kind) {
      continue;
    }

    return {
      productName: prefix.productName,
      level: Number(level),
      id,
      kind,
      text: cutText(text.slice(colon + 1).trim(), MAX_TEXT_LENGTH),
    };
  }

  return null;
}

// The word that starts at `from`, up to a space (or the text's end), bounded.
function wordAt(text: string, from: number): string {
  if (from < 0 || from >= text.length) {
    return "";
  }

  const end: number = text.indexOf(" ", from);
  const word: string = end === -1 ? text.slice(from) : text.slice(from, end);

  return word.length > MAX_TOKEN_LENGTH ? "" : word;
}

// The word after `marker` in the text, or "".
function wordAfter(text: string, marker: string): string {
  const at: number = text.indexOf(marker);

  return at === -1 ? "" : wordAt(text, at + marker.length);
}

export interface AsaEndpoint {
  interface: string;
  ip: string;
  port: number;
}

/*
 * One end of a connection, as Cisco writes it: "outside:203.0.113.7/52314",
 * "203.0.113.7/52314", "outside/203.0.113.7(52314)", "(10.0.0.1)" or a bare
 * address - with a comma or a closing bracket after it trimmed off.
 */
export function readAsaEndpoint(token: string): AsaEndpoint {
  let value: string = token.trim();

  while (value.endsWith(",") || value.endsWith(".")) {
    value = value.slice(0, -1);
  }

  if (value.startsWith("(") && value.endsWith(")")) {
    value = value.slice(1, -1);
  }

  // "outside/203.0.113.7(52314)": the interface before the slash.
  const slash: number = value.indexOf("/");
  const paren: number = value.indexOf("(");

  if (paren !== -1 && slash !== -1 && slash < paren && value.endsWith(")")) {
    const address: AsaEndpoint = readAddressAndPort(value.slice(slash + 1));

    return { ...address, interface: value.slice(0, slash) };
  }

  // A bare address, IPv6's colons and all.
  const bare: AsaEndpoint = readAddressAndPort(value);

  if (bare.ip) {
    return bare;
  }

  /*
   * "outside:203.0.113.7/52314" - or "outside:2001:db8::1/443", an IPv6
   * address after the interface: the first colon parts them when what
   * follows it is an address.
   */
  const colon: number = value.indexOf(":");

  if (colon > 0) {
    const address: AsaEndpoint = readAddressAndPort(value.slice(colon + 1));

    if (address.ip) {
      return { ...address, interface: value.slice(0, colon) };
    }
  }

  return bare;
}

// "203.0.113.7/52314", "203.0.113.7(52314)" or a bare address.
function readAddressAndPort(text: string): AsaEndpoint {
  let value: string = text;
  let port: number = 0;
  const open: number = value.indexOf("(");

  if (open !== -1 && value.endsWith(")")) {
    port = readPort(value.slice(open + 1, -1));
    value = value.slice(0, open);
  } else {
    const lastSlash: number = value.lastIndexOf("/");

    if (lastSlash !== -1) {
      port = readPort(value.slice(lastSlash + 1));
      value = value.slice(0, lastSlash);
    }
  }

  return { interface: "", ip: readIpAddress(value), port };
}

// What a message says between "user = " and the next " :" or the end.
function afterLabel(text: string, label: string): string {
  const at: number = text.toLowerCase().indexOf(label.toLowerCase());

  if (at === -1) {
    return "";
  }

  const start: number = at + label.length;
  const separators: Array<number> = [" :", ",", " ;"]
    .map((separator: string): number => {
      return text.indexOf(separator, start);
    })
    .filter((index: number): boolean => {
      return index !== -1;
    });
  const end: number = separators.length > 0 ? Math.min(...separators) : text.length;
  const value: string = text.slice(start, end).trim();

  return value.length > MAX_TOKEN_LENGTH ? "" : value;
}

// "Group <grp> User <alice> IP <203.0.113.7>": the text between the angle brackets after a word.
function bracketed(text: string, word: string): string {
  const at: number = text.indexOf(`${word} <`);

  if (at === -1) {
    return "";
  }

  const start: number = at + word.length + 2;
  const end: number = text.indexOf(">", start);

  return end === -1 || end - start > MAX_TOKEN_LENGTH
    ? ""
    : text.slice(start, end);
}

// 'quoted' or "quoted" text after a marker.
function quotedAfter(text: string, marker: string): string {
  const at: number = text.indexOf(marker);

  if (at === -1) {
    return "";
  }

  const quote: string = text.charAt(at + marker.length);

  if (quote !== "'" && quote !== '"') {
    return wordAt(text, at + marker.length);
  }

  const start: number = at + marker.length + 1;
  const end: number = text.indexOf(quote, start);

  return end === -1 || end - start > 1000 ? "" : text.slice(start, end);
}

interface ConnectionParts {
  protocol: string;
  source: AsaEndpoint;
  destination: AsaEndpoint;
  acl: string;
}

const NO_ENDPOINT: AsaEndpoint = { interface: "", ip: "", port: 0 };

// Who and where of a denied connection, as each message words it.
function readConnection(message: CiscoAsaMessage): ConnectionParts {
  const text: string = message.text;
  const lowerText: string = text.toLowerCase();
  const parts: ConnectionParts = {
    protocol: "",
    source: NO_ENDPOINT,
    destination: NO_ENDPOINT,
    acl: "",
  };

  switch (message.id) {
    case "106023":
    case "106014": {
      /*
       * "Deny tcp src outside:A/P dst inside:B/Q by access-group "acl"",
       * "Deny inbound icmp src outside:A dst inside:B (type 8, code 0)".
       */
      parts.protocol =
        wordAfter(text, "Deny inbound ") || wordAfter(text, "Deny ");
      parts.source = readAsaEndpoint(wordAfter(text, " src "));
      parts.destination = readAsaEndpoint(wordAfter(text, " dst "));
      parts.acl = quotedAfter(text, "access-group ");
      break;
    }
    case "106100": {
      // "access-list acl denied tcp outside/A(P) -> inside/B(Q) hit-cnt 1".
      parts.acl = wordAfter(text, "access-list ");
      parts.protocol = wordAfter(text, " denied ");
      const arrow: number = text.indexOf(" -> ");
      const sourceStart: number = text.lastIndexOf(" ", arrow - 1) + 1;

      if (arrow !== -1 && sourceStart > 0) {
        parts.source = readAsaEndpoint(text.slice(sourceStart, arrow));
        parts.destination = readAsaEndpoint(wordAt(text, arrow + 4));
      }
      break;
    }
    default: {
      // "... denied from A/P to B/Q ...", "Deny inbound UDP from A/P to B/Q".
      parts.protocol =
        wordAfter(text, "Deny inbound ") ||
        wordAfter(text, "Inbound ") ||
        wordAfter(text, "Deny ");
      parts.source = readAsaEndpoint(
        wordAfter(text, " from ") || wordAfter(text, "from "),
      );

      /*
       * The destination follows the source: "Deny IP due to Land Attack
       * from A to B" has a " to " of its own before it.
       */
      const fromAt: number = text.indexOf(" from ");
      const toAt: number = text.indexOf(" to ", fromAt === -1 ? 0 : fromAt);

      parts.destination =
        toAt === -1 ? NO_ENDPOINT : readAsaEndpoint(wordAt(text, toAt + 4));

      if (lowerText.indexOf("access denied by acl") !== -1) {
        parts.protocol = wordAt(text, 0);
      }
    }
  }

  return parts;
}

export interface CiscoAsaReading {
  message: CiscoAsaMessage;
}

export default class CiscoAsaLogParser {
  // The message a line holds, when it is a security event by the rules above.
  public static read(line: SecurityLogLine): CiscoAsaReading | null {
    const message: CiscoAsaMessage | null = readCiscoAsaMessage(
      line.body || "",
    );

    if (!message) {
      return null;
    }

    // An access list's hit is read only when it says denied, as written.
    if (
      message.id === DENIED_ONLY_MESSAGE_ID &&
      (line.body || "").toLowerCase().indexOf(DENIED_WORD) === -1
    ) {
      return null;
    }

    return { message };
  }

  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const reading: CiscoAsaReading | null = CiscoAsaLogParser.read(line);

    if (!reading) {
      return [];
    }

    return [CiscoAsaLogParser.toEvent(line, reading.message)];
  }

  private static toEvent(
    line: SecurityLogLine,
    message: CiscoAsaMessage,
  ): NormalizedSecurityEvent {
    const text: string = message.text;
    const attributes: JSONObject = {
      "asa.message_id": message.id,
      "asa.severity": String(message.level),
      "asa.message": text,
    };
    const base: {
      line: SecurityLogLine;
      format: SecurityLogFormat;
      vendorName: string;
      productName: string;
      ruleId: string;
    } = {
      line,
      format: SecurityLogFormat.CiscoAsa,
      vendorName: CISCO_VENDOR_NAME,
      productName: message.productName,
      ruleId: message.id,
    };
    const device: string = message.productName === CISCO_FTD_PRODUCT_NAME ? "FTD" : "ASA";

    switch (message.kind) {
      case CiscoAsaKind.Denied:
      case CiscoAsaKind.Attack: {
        const connection: ConnectionParts = readConnection(message);
        const sourceIp: string = readRemoteIpAddress(connection.source.ip);
        const destinationIp: string = connection.destination.ip;
        const where: string = destinationIp
          ? `${destinationIp}${connection.destination.port ? `:${connection.destination.port}` : ""}`
          : "";
        const isAttack: boolean = message.kind === CiscoAsaKind.Attack;

        if (connection.protocol) {
          attributes["asa.protocol"] = connection.protocol;
        }

        if (connection.acl) {
          attributes["asa.acl"] = connection.acl;
        }

        for (const [key, endpoint] of [
          ["src", connection.source],
          ["dst", connection.destination],
        ] as Array<[string, AsaEndpoint]>) {
          if (endpoint.interface) {
            attributes[`asa.${key}_interface`] = endpoint.interface;
          }

          if (endpoint.ip) {
            attributes[`asa.${key}_ip`] = endpoint.ip;
          }

          if (endpoint.port) {
            attributes[`asa.${key}_port`] = String(endpoint.port);
          }
        }

        return buildLogSecurityEvent({
          ...base,
          classUid: NETWORK_ACTIVITY,
          activityName: "Refuse",
          statusName: "Blocked",
          severity: isAttack ? OcsfSeverity.Medium : OcsfSeverity.Low,
          message: isAttack
            ? `The ${device} denied ${ATTACK_WORDS.get(message.id) || "an attack"}${sourceIp ? ` from ${sourceIp}` : ""}${where ? ` to ${where}` : ""}`
            : `${connection.protocol ? `${connection.protocol.toUpperCase()} connection` : "Connection"}${sourceIp ? ` from ${sourceIp}` : ""}${where ? ` to ${where}` : ""} denied${connection.acl ? ` by ${connection.acl}` : ""}`,
          ruleName: connection.acl,
          principalIp: sourceIp,
          targetIp: destinationIp,
          targetPort: connection.destination.port,
          targetResource: connection.acl,
          attributes,
        });
      }
      case CiscoAsaKind.Finding: {
        const isBotnet: boolean = message.id.startsWith("338");
        const isIps: boolean = message.id.startsWith("4000");
        const threatLevel: string = afterLabel(text, "threat-level: ").toLowerCase();
        const severity: OcsfSeverity =
          (isBotnet ? THREAT_LEVELS.get(threatLevel) : undefined) ||
          LEVEL_SEVERITIES[message.level] ||
          OcsfSeverity.Medium;
        const from: AsaEndpoint = readAsaEndpoint(wordAfter(text, " from "));
        const to: AsaEndpoint = readAsaEndpoint(wordAfter(text, " to "));
        const attacker: string = readRemoteIpAddress(
          from.ip ||
            wordAfter(text, "Host ") ||
            wordAfter(text, "adds host ") ||
            "",
        );
        const name: string = isIps
          ? cutText(
              text.indexOf(" from ") > 0
                ? text.slice(0, text.indexOf(" from "))
                : text,
              120,
            )
          : isBotnet
            ? `Botnet traffic filter: ${afterLabel(text, "category: ") || "blacklisted traffic"}`
            : `Threat detection: ${cutText(text.split(".")[0] || text, 120)}`;
        const dropped: boolean =
          text.toLowerCase().indexOf("dropped") !== -1 ||
          text.toLowerCase().indexOf("shun") !== -1;

        if (threatLevel) {
          attributes["asa.threat_level"] = threatLevel;
        }

        return buildLogSecurityEvent({
          ...base,
          classUid: DETECTION_FINDING,
          activityName: "Create",
          statusName: dropped ? "Blocked" : "Detected",
          severity,
          message: `${name}${attacker ? ` from ${attacker}` : ""}${to.ip ? ` to ${to.ip}${to.port ? `:${to.port}` : ""}` : ""}`,
          ruleName: name,
          principalIp: attacker,
          targetIp: to.ip,
          targetPort: to.port,
          attributes,
        });
      }
      case CiscoAsaKind.SignIn: {
        const failed: boolean = !SUCCESSFUL_SIGN_INS.includes(message.id);
        let user: string =
          quotedAfter(text, "for user ") ||
          afterLabel(text, "user = ") ||
          afterLabel(text, "Uname: ") ||
          bracketed(text, "User");

        // A user name the ASA hides is no user.
        if (user.startsWith("*")) {
          user = "";
        }

        const ip: string = readRemoteIpAddress(
          readAsaEndpoint(wordAfter(text, "from ")).ip ||
            afterLabel(text, "user IP = ") ||
            afterLabel(text, "IP address: ") ||
            bracketed(text, "IP"),
        );
        const reason: string = afterLabel(text, "reason = ");
        const how: string =
          message.id === "113039"
            ? "AnyConnect"
            : message.id.startsWith("113")
              ? "AAA"
              : "management";

        if (user) {
          attributes["asa.user"] = user;
        }

        return buildLogSecurityEvent({
          ...base,
          classUid: AUTHENTICATION,
          activityName: "Logon",
          statusName: failed ? "Failure" : "Success",
          severity: failed ? OcsfSeverity.Low : OcsfSeverity.Informational,
          message: `${failed ? `Failed ${how} sign-in` : `${how === "management" ? "Management" : how} sign-in`}${user ? ` for ${user}` : ""}${ip ? ` from ${ip}` : ""} on the ${device}${failed && reason ? `: ${reason}` : ""}`,
          principalUser: user,
          principalIp: ip,
          attributes,
        });
      }
      case CiscoAsaKind.Command: {
        const user: string = quotedAfter(text, "User ");
        const command: string =
          quotedAfter(text, "executed the ") || quotedAfter(text, "executed ");
        const ip: string = readRemoteIpAddress(
          readAsaEndpoint(wordAfter(text, "from IP ")).ip,
        );

        if (user) {
          attributes["asa.user"] = user;
        }

        if (command) {
          attributes["asa.command"] = command;
        }

        return buildLogSecurityEvent({
          ...base,
          classUid: API_ACTIVITY,
          activityName: "Execute",
          statusName: "Success",
          severity: OcsfSeverity.Informational,
          message: `${user || "An administrator"} ran ${command ? `'${cutText(command, 300)}'` : "a command"} on the ${device}${ip ? ` from ${ip}` : ""}`,
          principalUser: user,
          principalIp: ip,
          targetResource: command,
          attributes,
        });
      }
      case CiscoAsaKind.Privilege: {
        const user: string = afterLabel(text, "Uname: ").split(" ")[0] || "";
        const to: string = wordAfter(text, "To: ");

        if (user) {
          attributes["asa.user"] = user;
        }

        return buildLogSecurityEvent({
          ...base,
          classUid: USER_ACCESS_MANAGEMENT,
          activityName: "Assign Privileges",
          statusName: "Success",
          severity: to === "15" ? OcsfSeverity.Low : OcsfSeverity.Informational,
          message: `${user || "An administrator"}'s privilege level on the ${device} changed${to ? ` to ${to}` : ""}`,
          principalUser: user,
          targetUser: user,
          attributes,
        });
      }
    }
  }
}

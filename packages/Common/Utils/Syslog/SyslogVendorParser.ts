import NetworkEventAttribute, {
  MAX_NETWORK_EVENT_SUBJECT_LENGTH,
} from "../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../Types/NetworkEvent/NetworkEventType";
import { ParsedCef } from "./CefParser";

/*
 * ONE INTERFACE FOR EVERY VENDOR'S SYSLOG.
 *
 * A vendor parser is a catalog entry, not a code path of its own: it says
 * how to tell its messages apart (detect), how to take one apart
 * (extract: its fields, the device's own words, who sent it), and - as
 * data - which messages are which network events (rules). Everything else
 * is shared: SyslogEventNormalizer runs the catalog over each message and
 * writes what it finds as log attributes, the same for all of them.
 *
 * Adding a vendor is adding a file under Vendors/ and a line in
 * SyslogVendorCatalog. Adding an event a vendor already logs is adding a
 * rule to its list.
 */

// The built-in parsers. Stored in logs as `syslog.parser`: never rename one.
export enum SyslogParserId {
  SophosFirewall = "sophos-firewall",
  FortinetFortiGate = "fortinet-fortigate",
  Cisco = "cisco",
  ExtremeExos = "extreme-exos",
  ExtremeVoss = "extreme-voss",
  ArubaAosCx = "aruba-aos-cx",
  ArubaAosSwitch = "aruba-aos-switch",
  MikroTikRouterOs = "mikrotik-routeros",
  CambiumEnterpriseWifi = "cambium-enterprise-wifi",
  UbiquitiUniFi = "ubiquiti-unifi",
  Linux = "linux",
  // A CEF message from a product with no parser of its own.
  Cef = "cef",
}

/*
 * How much of a message detection and the event rules read. Events are
 * short lines; a megabyte of firewall payload after one is not part of it.
 */
export const MAX_VENDOR_TEXT_LENGTH: number = 2048;

export interface SyslogParseInput {
  // The message as it is stored: the log body.
  message: string;
  /*
   * Everything after the syslog header, when that is more than `message`
   * (ParsedSyslogMessage.content): an RFC 3164 tag is part of many vendors'
   * own format.
   */
  content?: string | undefined;
  hostname?: string | undefined;
  appName?: string | undefined;
}

export interface SyslogParseContext {
  // What parsers read: the content, cut to MAX_VENDOR_TEXT_LENGTH.
  text: string;
  // The whole content, for parsers that read pairs out of long lines.
  fullText: string;
  hostname?: string | undefined;
  appName?: string | undefined;
  // The CEF message in the line, when it holds one.
  cef: ParsedCef | null;
  // The line's key=value pairs, read once and only when a parser asks.
  getKeyValues: () => Record<string, string>;
}

/*
 * Who a message says it is about, in fields of its own format, for matching
 * it to a network device. Most lines say nothing: the address they came
 * from is all there is.
 */
export interface SyslogDeviceIdentity {
  hostname?: string | undefined;
  serialNumber?: string | undefined;
  macAddress?: string | undefined;
  ipAddress?: string | undefined;
  /*
   * True when a controller sent the message about a device it manages, so
   * these fields name that device and not the sender.
   */
  managedDevice?: boolean | undefined;
}

export interface SyslogVendorExtraction {
  // The message's own fields, stored under the parser's attribute prefix.
  fields: Record<string, string>;
  // The device's own words for what happened, without header or field names.
  text: string;
  identity?: SyslogDeviceIdentity | undefined;
  /*
   * The syslog severity (0 emergency ... 7 debug) the message itself
   * states, used when it arrived without a priority.
   */
  severity?: number | undefined;
  /*
   * True when what the syslog header gave as the host name is part of the
   * vendor's own format, and so names no device.
   */
  headerHostnameIsNotAHost?: boolean | undefined;
}

// What a field must be for a rule to match: this text (any case), one of these, or this pattern.
export type SyslogRuleFieldCondition = string | Array<string> | RegExp;

/*
 * Where a normalized attribute's value comes from: "$1" is the first
 * group of the rule's text pattern ("$2" the second, ...), "@name" one of
 * the message's fields, anything else the value itself. A list is tried in
 * order and the first one with a value wins.
 */
export type SyslogRuleValueSource = string | Array<string>;

export interface SyslogEventRule {
  event: NetworkEventType;
  // Every field named here must match.
  when?: Record<string, SyslogRuleFieldCondition> | undefined;
  // And the device's words must match this, when given.
  text?: RegExp | undefined;
  // The attributes to store with the event.
  set?:
    | Partial<Record<NetworkEventAttribute, SyslogRuleValueSource>>
    | undefined;
}

export interface SyslogVendorParser {
  id: SyslogParserId;
  // The maker, as people write it: "Sophos", "Extreme Networks".
  vendor: string;
  // The product line whose messages this reads.
  product: string;
  // The format, in a few words, for the docs and the parser list.
  format: string;
  /*
   * The namespace of the message's own fields ("sophos" stores con_name as
   * sophos.con_name); empty when the parser adds none.
   */
  attributePrefix: string;
  /*
   * Words that name this maker in a device's vendor or system description,
   * lower case. A message with this product's shape but nothing in it that
   * proves who made the device is read with this parser when its device is
   * known to be this maker's.
   */
  vendorKeywords: Array<string>;
  // Whether the message itself shows it is this product's.
  detect: (context: SyslogParseContext) => boolean;
  /*
   * Whether a message has this product's shape, for a device already
   * known to be this maker's. Only for formats without a mark of their own.
   */
  detectForKnownVendor?: ((context: SyslogParseContext) => boolean) | undefined;
  extract: (context: SyslogParseContext) => SyslogVendorExtraction;
  // Which messages are which events. The first rule that matches wins.
  rules: Array<SyslogEventRule>;
}

/*
 * Whether a line holds `key=` as a pair of its own: at the start of the
 * line or after whitespace. A cheap first look before the pairs are read.
 */
export function hasKeyValuePair(text: string, key: string): boolean {
  const needle: string = `${key}=`;
  let from: number = 0;

  for (;;) {
    const at: number = text.indexOf(needle, from);

    if (at === -1) {
      return false;
    }

    if (at === 0) {
      return true;
    }

    const before: string = text.charAt(at - 1);

    if (before === " " || before === "\t" || before === "\n") {
      return true;
    }

    from = at + needle.length;
  }
}

export interface SyslogRuleMatch {
  event: NetworkEventType;
  attributes: Partial<Record<NetworkEventAttribute, string>>;
  // Which of the parser's rules matched: its place in the list.
  ruleIndex: number;
}

function matchesFieldCondition(
  value: string | undefined,
  condition: SyslogRuleFieldCondition,
): boolean {
  if (value === undefined) {
    return false;
  }

  if (condition instanceof RegExp) {
    return condition.test(value);
  }

  const lowered: string = value.trim().toLowerCase();

  if (Array.isArray(condition)) {
    return condition.some((candidate: string): boolean => {
      return candidate.toLowerCase() === lowered;
    });
  }

  return condition.toLowerCase() === lowered;
}

function capSubject(value: string): string {
  const trimmed: string = value.trim();

  return trimmed.length > MAX_NETWORK_EVENT_SUBJECT_LENGTH
    ? trimmed.slice(0, MAX_NETWORK_EVENT_SUBJECT_LENGTH)
    : trimmed;
}

const GROUP_SOURCE: RegExp = /^\$([1-9])$/;

function resolveValue(
  source: SyslogRuleValueSource,
  fields: Record<string, string>,
  groups: Array<string | undefined>,
): string {
  const candidates: Array<string> = Array.isArray(source) ? source : [source];

  for (const candidate of candidates) {
    let value: string | undefined;
    const group: RegExpMatchArray | null = candidate.match(GROUP_SOURCE);

    if (group) {
      value = groups[parseInt(group[1]!, 10)];
    } else if (candidate.startsWith("@")) {
      const key: string = candidate.slice(1);

      value = Object.prototype.hasOwnProperty.call(fields, key)
        ? fields[key]
        : undefined;
    } else {
      value = candidate;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      return capSubject(value);
    }
  }

  return "";
}

/*
 * The event a message is, by a parser's rules, or null when none of them
 * matches. Rules read the device's words cut to MAX_VENDOR_TEXT_LENGTH.
 */
export function matchEventRule(
  rules: Array<SyslogEventRule>,
  extraction: SyslogVendorExtraction,
): SyslogRuleMatch | null {
  const text: string =
    extraction.text.length > MAX_VENDOR_TEXT_LENGTH
      ? extraction.text.slice(0, MAX_VENDOR_TEXT_LENGTH)
      : extraction.text;

  for (let ruleIndex: number = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule: SyslogEventRule = rules[ruleIndex]!;
    let isMatch: boolean = true;

    for (const fieldName of Object.keys(rule.when || {})) {
      const value: string | undefined = Object.prototype.hasOwnProperty.call(
        extraction.fields,
        fieldName,
      )
        ? extraction.fields[fieldName]
        : undefined;

      if (!matchesFieldCondition(value, rule.when![fieldName]!)) {
        isMatch = false;
        break;
      }
    }

    if (!isMatch) {
      continue;
    }

    let groups: Array<string | undefined> = [];

    if (rule.text) {
      const textMatch: RegExpMatchArray | null = text.match(rule.text);

      if (!textMatch) {
        continue;
      }

      groups = textMatch;
    }

    const attributes: Partial<Record<NetworkEventAttribute, string>> = {};

    for (const attribute of Object.keys(
      rule.set || {},
    ) as Array<NetworkEventAttribute>) {
      const value: string = resolveValue(
        rule.set![attribute]!,
        extraction.fields,
        groups,
      );

      if (value) {
        attributes[attribute] = value;
      }
    }

    return { event: rule.event, attributes: attributes, ruleIndex: ruleIndex };
  }

  return null;
}

/*
 * Whether a device's vendor (its Vendor column, or its system description)
 * names a parser's maker.
 */
export function isVendorOfParser(
  parser: Pick<SyslogVendorParser, "vendorKeywords">,
  deviceVendor: string | null | undefined,
): boolean {
  const lowered: string = (deviceVendor || "").toLowerCase();

  if (!lowered) {
    return false;
  }

  return parser.vendorKeywords.some((keyword: string): boolean => {
    return lowered.includes(keyword);
  });
}

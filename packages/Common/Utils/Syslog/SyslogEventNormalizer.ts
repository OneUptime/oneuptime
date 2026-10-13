import NetworkEventAttribute, {
  MAX_NETWORK_EVENT_MESSAGE_LENGTH,
  NETWORK_EVENT_DOMAIN,
} from "../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../Types/NetworkEvent/NetworkEventType";
import { getNetworkEventClassAttributes } from "../NetworkEvent/NetworkEventLog";
import SyslogAttribute from "../../Types/Syslog/SyslogAttribute";
import {
  MAX_KEY_VALUE_INPUT_LENGTH,
  parseKeyValuePairs,
} from "../Log/KeyValueParser";
import {
  ParsedCef,
  cefSeverityToSyslogSeverity,
  findCefStart,
  parseCef,
} from "./CefParser";
import { ParsedSyslogMessage, parseSyslogMessage } from "./SyslogMessageParser";
import { SYSLOG_VENDOR_PARSERS } from "./SyslogVendorCatalog";
import {
  MAX_VENDOR_TEXT_LENGTH,
  SyslogDeviceIdentity,
  SyslogParseContext,
  SyslogParseInput,
  SyslogParserId,
  SyslogRuleMatch,
  SyslogVendorExtraction,
  SyslogVendorParser,
  isVendorOfParser,
  matchEventRule,
} from "./SyslogVendorParser";

/*
 * FROM A VENDOR'S LINE TO ATTRIBUTES ANYONE CAN SEARCH.
 *
 * Runs once per syslog message, whichever way it arrived, and answers
 * three questions:
 *
 *   1. Whose format is this? The catalog's parsers are asked in turn
 *      (SyslogVendorCatalog); a CEF message is read as CEF first.
 *   2. What does it say? The message's own fields, under the parser's
 *      prefix (sophos.con_name, cisco.mnemonic, cef.src).
 *   3. Is it something that happened on the network? If one of the
 *      parser's rules matches, the event's name and what it is about
 *      (event.name = interface.down, network.interface.name = Gi0/1).
 *
 * It also reads who the message says it is from - a host name, a serial
 * number, a MAC address - for matching it to a network device.
 *
 * Nothing here ever fails a message: a line no parser knows comes back
 * with no attributes and is stored as it always was.
 *
 * Everything is bounded. Parsers and rules read at most
 * MAX_VENDOR_TEXT_LENGTH characters, key=value and CEF pairs have the
 * ceilings of their own readers, and the rules' patterns are written
 * without nested repetition (SyslogVendorRules.test.ts times each of them
 * on text built to be slow).
 */

// The attribute prefix of a CEF message's header and extension fields.
export const CEF_ATTRIBUTE_PREFIX: string = "cef";

export interface SyslogNormalizeOptions {
  /*
   * The maker of the network device the message is from, when it is known
   * (the device's Vendor, or its system description). Lets a format with
   * no mark of its own be read with its maker's parser.
   */
  deviceVendor?: string | null | undefined;
}

export interface NormalizedSyslogMessage {
  // The parser that read the message, or null when none knows it.
  parserId: SyslogParserId | null;
  // The maker, as the parser names it or the CEF header says.
  vendor: string | null;
  // The event the message is, or null.
  eventName: NetworkEventType | null;
  /*
   * Which of the parser's rules said so: its place in the parser's list.
   * For the suites that hold every rule to a sample line.
   */
  ruleIndex: number | null;
  // What to store with the log, beside what it already carries.
  attributes: Record<string, string>;
  /*
   * Who the message itself says it is about, in fields of its own format:
   * a serial number, a MAC address, an address, a name. Empty for most
   * lines.
   */
  identity: SyslogDeviceIdentity;
  /*
   * The host name of the syslog header - the sender's own word for itself.
   * Left out when the header has none, and when what stands there is part
   * of the vendor's format and names nobody.
   */
  headerHostname?: string | undefined;
  // The syslog severity the message itself states (0 to 7), if it does.
  severity?: number | undefined;
}

const UNSAFE_ATTRIBUTE_KEY_CHARACTER: RegExp = /[^A-Za-z0-9_.@-]/g;

function toAttributeKey(prefix: string, key: string): string | null {
  const safeKey: string = key.replace(UNSAFE_ATTRIBUTE_KEY_CHARACTER, "_");

  if (!safeKey || safeKey === "__proto__") {
    return null;
  }

  return `${prefix}.${safeKey}`;
}

function cut(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }

  let end: number = length;

  // Never end on the first half of a surrogate pair.
  const lastCharCode: number = value.charCodeAt(end - 1);

  if (lastCharCode >= 0xd800 && lastCharCode <= 0xdbff) {
    end -= 1;
  }

  return value.slice(0, end);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed: string = (value || "").trim();

  return trimmed ? trimmed : undefined;
}

function buildContext(input: SyslogParseInput): SyslogParseContext {
  const source: string =
    typeof input.content === "string" && input.content.length > 0
      ? input.content
      : typeof input.message === "string"
        ? input.message
        : "";

  const fullText: string = cut(source, MAX_KEY_VALUE_INPUT_LENGTH);
  let keyValues: Record<string, string> | null = null;

  return {
    text: cut(fullText, MAX_VENDOR_TEXT_LENGTH),
    fullText: fullText,
    hostname: input.hostname,
    appName: input.appName,
    cef: findCefStart(fullText) === -1 ? null : parseCef(fullText),
    getKeyValues: (): Record<string, string> => {
      if (keyValues === null) {
        keyValues = parseKeyValuePairs(fullText);
      }

      return keyValues;
    },
  };
}

function findParser(
  context: SyslogParseContext,
  options: SyslogNormalizeOptions | undefined,
): SyslogVendorParser | null {
  for (const parser of SYSLOG_VENDOR_PARSERS) {
    if (parser.detect(context)) {
      return parser;
    }
  }

  // A format with no mark of its own, from a device whose maker is known.
  if (options?.deviceVendor) {
    for (const parser of SYSLOG_VENDOR_PARSERS) {
      if (
        parser.detectForKnownVendor &&
        isVendorOfParser(parser, options.deviceVendor) &&
        parser.detectForKnownVendor(context)
      ) {
        return parser;
      }
    }
  }

  return null;
}

function addCefAttributes(
  attributes: Record<string, string>,
  cef: ParsedCef,
): void {
  const header: Record<string, string> = {
    vendor: cef.deviceVendor,
    product: cef.deviceProduct,
    device_version: cef.deviceVersion,
    event_class_id: cef.deviceEventClassId,
    name: cef.name,
    severity: cef.severity,
  };

  for (const key of Object.keys(header)) {
    if (header[key]) {
      attributes[`${CEF_ATTRIBUTE_PREFIX}.${key}`] = header[key]!;
    }
  }

  for (const key of Object.keys(cef.extensions)) {
    const attributeKey: string | null = toAttributeKey(
      CEF_ATTRIBUTE_PREFIX,
      key,
    );

    /*
     * A header field keeps its name: an extension pair called "name" or
     * "vendor" does not replace it.
     */
    if (
      attributeKey &&
      !Object.prototype.hasOwnProperty.call(attributes, attributeKey)
    ) {
      attributes[attributeKey] = cef.extensions[key]!;
    }
  }
}

// Who a CEF message says sent it, by the standard's own keys.
function readCefIdentity(cef: ParsedCef): SyslogDeviceIdentity {
  return {
    hostname: nonEmpty(cef.extensions["dvchost"]),
    ipAddress: nonEmpty(cef.extensions["dvc"]),
    macAddress: nonEmpty(cef.extensions["dvcmac"]),
    serialNumber: nonEmpty(cef.extensions["deviceExternalId"]),
  };
}

function mergeIdentity(
  preferred: SyslogDeviceIdentity | undefined,
  fallback: SyslogDeviceIdentity,
): SyslogDeviceIdentity {
  const identity: SyslogDeviceIdentity = {};

  const hostname: string | undefined =
    nonEmpty(preferred?.hostname) || nonEmpty(fallback.hostname);
  const serialNumber: string | undefined =
    nonEmpty(preferred?.serialNumber) || nonEmpty(fallback.serialNumber);
  const macAddress: string | undefined =
    nonEmpty(preferred?.macAddress) || nonEmpty(fallback.macAddress);
  const ipAddress: string | undefined =
    nonEmpty(preferred?.ipAddress) || nonEmpty(fallback.ipAddress);

  if (hostname) {
    identity.hostname = hostname;
  }

  if (serialNumber) {
    identity.serialNumber = serialNumber;
  }

  if (macAddress) {
    identity.macAddress = macAddress;
  }

  if (ipAddress) {
    identity.ipAddress = ipAddress;
  }

  if (preferred?.managedDevice || fallback.managedDevice) {
    identity.managedDevice = true;
  }

  return identity;
}

function emptyResult(
  input: Pick<SyslogParseInput, "hostname"> | null | undefined,
): NormalizedSyslogMessage {
  const result: NormalizedSyslogMessage = {
    parserId: null,
    vendor: null,
    eventName: null,
    ruleIndex: null,
    attributes: {},
    identity: {},
  };

  const headerHostname: string | undefined = nonEmpty(
    typeof input?.hostname === "string" ? input.hostname : undefined,
  );

  if (headerHostname) {
    result.headerHostname = headerHostname;
  }

  return result;
}

// A syslog line, read whole: its header, and what it says.
export interface ReadSyslogLine {
  parsed: ParsedSyslogMessage;
  normalized: NormalizedSyslogMessage;
}

export default class SyslogEventNormalizer {
  /*
   * Reads a syslog line from its first character: the header, then the
   * message. Null for an empty line. What the ingest paths do in two
   * steps, in one - for the Dashboard and for tests.
   */
  public static readLine(
    raw: string,
    options?: SyslogNormalizeOptions | undefined,
  ): ReadSyslogLine | null {
    const parsed: ParsedSyslogMessage | null = parseSyslogMessage(raw);

    if (!parsed) {
      return null;
    }

    return {
      parsed: parsed,
      normalized: SyslogEventNormalizer.normalizeParsed(parsed, options),
    };
  }

  // What a syslog message whose header is already read says.
  public static normalizeParsed(
    parsed: Pick<
      ParsedSyslogMessage,
      "message" | "content" | "hostname" | "appName"
    >,
    options?: SyslogNormalizeOptions | undefined,
  ): NormalizedSyslogMessage {
    return SyslogEventNormalizer.normalize(
      {
        message: parsed.message,
        content: parsed.content,
        hostname: parsed.hostname,
        appName: parsed.appName,
      },
      options,
    );
  }

  /*
   * What a syslog message says, beyond its header. Never throws: a
   * parser that fails on a line leaves the line as it was.
   */
  public static normalize(
    input: SyslogParseInput,
    options?: SyslogNormalizeOptions | undefined,
  ): NormalizedSyslogMessage {
    const result: NormalizedSyslogMessage = emptyResult(input);

    try {
      SyslogEventNormalizer.read(input, options, result);
    } catch {
      // A line a parser trips on is stored as it came.
      return emptyResult(input);
    }

    return result;
  }

  private static read(
    input: SyslogParseInput,
    options: SyslogNormalizeOptions | undefined,
    result: NormalizedSyslogMessage,
  ): void {
    const context: SyslogParseContext = buildContext(input);

    if (!context.fullText) {
      return;
    }

    const attributes: Record<string, string> = result.attributes;
    let identity: SyslogDeviceIdentity = result.identity;

    if (context.cef) {
      addCefAttributes(attributes, context.cef);
      identity = mergeIdentity(readCefIdentity(context.cef), identity);

      const cefVendor: string | undefined = nonEmpty(context.cef.deviceVendor);

      if (cefVendor) {
        result.vendor = cefVendor;
      }

      result.parserId = SyslogParserId.Cef;
      result.severity = cefSeverityToSyslogSeverity(context.cef.severity);
    }

    const parser: SyslogVendorParser | null = findParser(context, options);

    if (parser) {
      const extraction: SyslogVendorExtraction = parser.extract(context);

      result.parserId = parser.id;

      if (parser.vendor) {
        result.vendor = parser.vendor;
      }

      if (parser.attributePrefix) {
        for (const key of Object.keys(extraction.fields)) {
          const attributeKey: string | null = toAttributeKey(
            parser.attributePrefix,
            key,
          );

          if (attributeKey) {
            attributes[attributeKey] = extraction.fields[key]!;
          }
        }
      }

      if (extraction.headerHostnameIsNotAHost) {
        delete result.headerHostname;
      }

      identity = mergeIdentity(extraction.identity, identity);

      if (extraction.severity !== undefined) {
        result.severity = extraction.severity;
      }

      const match: SyslogRuleMatch | null = matchEventRule(
        parser.rules,
        extraction,
      );

      if (match) {
        result.eventName = match.event;
        result.ruleIndex = match.ruleIndex;
        attributes[NetworkEventAttribute.Domain] = NETWORK_EVENT_DOMAIN;
        attributes[NetworkEventAttribute.Name] = match.event;
        Object.assign(attributes, getNetworkEventClassAttributes(match.event));

        for (const key of Object.keys(
          match.attributes,
        ) as Array<NetworkEventAttribute>) {
          attributes[key] = match.attributes[key]!;
        }

        const words: string = extraction.text.trim();

        if (words) {
          attributes[NetworkEventAttribute.Message] = cut(
            words,
            MAX_NETWORK_EVENT_MESSAGE_LENGTH,
          );
        }
      }
    }

    if (result.parserId) {
      attributes[SyslogAttribute.Parser] = result.parserId;
    }

    if (result.vendor) {
      attributes[SyslogAttribute.Vendor] = result.vendor;
    }

    result.identity = identity;
  }
}

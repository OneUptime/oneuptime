import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../../Types/NetworkEvent/NetworkEventType";
import {
  SyslogParseContext,
  SyslogParserId,
  SyslogVendorExtraction,
  SyslogVendorParser,
} from "../SyslogVendorParser";

/*
 * HPE Aruba Networking switches: two operating systems, two parsers.
 *
 * AOS-CX. Every event log entry is five fields between pipes after the
 * word Event - the event ID, the severity, the management module's role
 * and slot, and the text:
 *
 *   intfd[1733]: Event|403|LOG_INFO|AMM|1/1|Link status for interface 1/1/49 is up
 *
 * The texts are the templates of the AOS-CX Event Log Message Reference
 * Guide ("Link status for interface {interface} is {state}"). The rules
 * read the text, not the event ID: the ID of a message has moved between
 * releases (link up is 403 in 10.7 and 404 in 10.15).
 *
 * AOS-SWITCH (ArubaOS-Switch, ProVision, ProCurve). An event number of
 * five digits, the system module, and the text:
 *
 *   00077 ports: port 3 is now off-line
 *
 * The number is missing on switches set not to send it, so a line with the
 * module and text alone is read the same way when its device is known to
 * be an HPE or Aruba one.
 *
 * Both store their fields as `aruba.<key>`.
 */

const AOS_CX_EVENT: RegExp =
  /\bEvent\|(\d{1,6})\|LOG_([A-Z]{3,8})\|([^|]{0,16})\|([^|]{0,16})\|/;

const AOS_CX_SEVERITY_LEVELS: Record<string, number> = {
  EMER: 0,
  ALERT: 1,
  CRIT: 2,
  ERR: 3,
  WARN: 4,
  NOTICE: 5,
  INFO: 6,
  DEBUG: 7,
};

const arubaAosCx: SyslogVendorParser = {
  id: SyslogParserId.ArubaAosCx,
  vendor: "HPE Aruba Networking",
  product: "AOS-CX",
  format: "Event|ID|LOG_SEVERITY|role|slot|text",
  attributePrefix: "aruba",
  vendorKeywords: ["aruba", "hpe", "hewlett"],

  detect: (context: SyslogParseContext): boolean => {
    return context.text.includes("Event|") && AOS_CX_EVENT.test(context.text);
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    const match: RegExpMatchArray | null = context.text.match(AOS_CX_EVENT);

    if (!match || match.index === undefined) {
      return { fields: {}, text: "" };
    }

    const fields: Record<string, string> = {
      event_id: match[1]!,
      severity: match[2]!,
    };

    if (match[3]) {
      fields["role"] = match[3];
    }

    if (match[4]) {
      fields["slot"] = match[4];
    }

    return {
      fields: fields,
      text: context.text.slice(match.index + match[0].length).trim(),
      severity: AOS_CX_SEVERITY_LEVELS[match[2]!],
    };
  },

  rules: [
    // "Link status for interface {interface} is {state}"
    {
      event: NetworkEventType.InterfaceDown,
      text: /^Link status for interface (\S{1,64}) is down\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    {
      event: NetworkEventType.InterfaceUp,
      text: /^Link status for interface (\S{1,64}) is up\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },

    // "PSU {name} changed state to {state}"
    {
      event: NetworkEventType.HardwarePowerSupplyOk,
      text: /^(PSU \S{1,32}) changed state to ok\b/i,
      set: { [NetworkEventAttribute.HardwareName]: "$1" },
    },
    {
      event: NetworkEventType.HardwarePowerSupplyFailed,
      text: /^(PSU \S{1,32}) changed state to (?:fault|fail|absent|warning)/i,
      set: { [NetworkEventAttribute.HardwareName]: "$1" },
    },

    // "Status of fan {FanName} has changed from {OldStatus} to {NewStatus}"
    {
      event: NetworkEventType.HardwareFanOk,
      text: /^Status of (fan \S{1,32}) has changed from \S{1,32} to ok\b/i,
      set: { [NetworkEventAttribute.HardwareName]: "$1" },
    },
    {
      event: NetworkEventType.HardwareFanFailed,
      text: /^Status of (fan \S{1,32}) has changed from \S{1,32} to (?:fault|fail)/i,
      set: { [NetworkEventAttribute.HardwareName]: "$1" },
    },
  ],
};

// "00077 ports: port 3 is now off-line", with the Event Log's own prefix or without.
const AOS_SWITCH_NUMBERED: RegExp =
  /^(?:[IWMDE] \d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} )?(\d{5}) ([A-Za-z][A-Za-z0-9_-]{0,31}): /;

// The same line from a switch that does not send the number.
const AOS_SWITCH_UNNUMBERED: RegExp = /^([A-Za-z][A-Za-z0-9_-]{0,31}): /;

const AOS_SWITCH_PORT_TEXT: RegExp =
  /^(?:ports|FFI|stp|chassis|system): .{0,40}\bport \S{1,32} is\b/;

const arubaAosSwitch: SyslogVendorParser = {
  id: SyslogParserId.ArubaAosSwitch,
  vendor: "HPE Aruba Networking",
  product: "AOS-Switch (ArubaOS-Switch, ProCurve)",
  format: "event number, module, text",
  attributePrefix: "aruba",
  vendorKeywords: ["aruba", "hpe", "hewlett", "procurve"],

  detect: (context: SyslogParseContext): boolean => {
    return AOS_SWITCH_NUMBERED.test(context.text);
  },

  detectForKnownVendor: (context: SyslogParseContext): boolean => {
    return AOS_SWITCH_PORT_TEXT.test(context.text);
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    const numbered: RegExpMatchArray | null =
      context.text.match(AOS_SWITCH_NUMBERED);

    if (numbered) {
      return {
        fields: { event_id: numbered[1]!, module: numbered[2]! },
        text: context.text.slice(numbered[0].length).trim(),
      };
    }

    const unnumbered: RegExpMatchArray | null = context.text.match(
      AOS_SWITCH_UNNUMBERED,
    );

    if (unnumbered) {
      return {
        fields: { module: unnumbered[1]! },
        text: context.text.slice(unnumbered[0].length).trim(),
      };
    }

    return { fields: {}, text: "" };
  },

  rules: [
    // 00077 ports: port 3 is now off-line
    {
      event: NetworkEventType.InterfaceDown,
      when: { module: "ports" },
      text: /\bport (\S{1,32}) is now off-line\b/,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    // 00076 ports: port 3 is now on-line
    {
      event: NetworkEventType.InterfaceUp,
      when: { module: "ports" },
      text: /\bport (\S{1,32}) is now on-line\b/,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
  ],
};

export { arubaAosCx, arubaAosSwitch };

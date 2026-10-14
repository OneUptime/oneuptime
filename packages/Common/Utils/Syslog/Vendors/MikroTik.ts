import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../../Types/NetworkEvent/NetworkEventType";
import {
  SyslogParseContext,
  SyslogParserId,
  SyslogVendorExtraction,
  SyslogVendorParser,
} from "../SyslogVendorParser";

/*
 * MikroTik RouterOS.
 *
 * A remote logging action sends each entry in one of three formats
 * (remote-log-format; https://manual.mikrotik.com/docs/diagnostics-monitoring-and-troubleshooting/log/).
 * The same login failure, as the server receives it in each:
 *
 *   default  system,error,critical login failure for user guest from 192.168.88.17 via ssh
 *   syslog   <27>Oct  2 17:36:35 MikroTik login failure for user guest from 192.168.88.17 via ssh
 *   cef      Oct  2 17:36:35 MikroTik CEF:0|MikroTik|hAP ax^2|7.25beta5|10|system,error,critical|High|dvchost=MikroTik dvc=192.168.88.36 msg=login failure for user guest from 192.168.88.17 via ssh app=ssh duser=guest outcome=failure src=192.168.88.17
 *
 * The default format has no syslog priority and no header: the entry's
 * topics, then its message. The CEF format (RouterOS 7.18 and later) has
 * the topics as the event's name. The syslog format drops the topics, so
 * nothing in such a line says it is RouterOS's: it is read with this
 * parser when its device is known to be a MikroTik.
 *
 * The topics are stored as `mikrotik.topics`.
 */

// Topics RouterOS writes first: the feature, then how important it is.
const TOPICS: RegExp =
  /^((?:[a-z][a-z0-9-]{1,24},){1,6}[a-z][a-z0-9-]{1,24}) (?=\S)/;

// At least one of these is among an entry's topics.
const SEVERITY_TOPICS: Array<string> = [
  "debug",
  "info",
  "warning",
  "error",
  "critical",
];

/*
 * The severity RouterOS itself sends for a set of topics
 * (syslog-severity=auto): debug 7, info 6, warning 4, error 3.
 */
function severityOfTopics(topics: Array<string>): number | undefined {
  if (topics.includes("error") || topics.includes("critical")) {
    return 3;
  }

  if (topics.includes("warning")) {
    return 4;
  }

  if (topics.includes("info")) {
    return 6;
  }

  if (topics.includes("debug")) {
    return 7;
  }

  return undefined;
}

function readTopics(text: string): { topics: string; rest: string } | null {
  const match: RegExpMatchArray | null = text.match(TOPICS);

  if (!match) {
    return null;
  }

  const topics: Array<string> = match[1]!.split(",");

  if (
    !topics.some((topic: string): boolean => {
      return SEVERITY_TOPICS.includes(topic);
    })
  ) {
    return null;
  }

  return { topics: match[1]!, rest: text.slice(match[0].length).trim() };
}

// What RouterOS writes when it sends no topics: the messages the rules know.
const KNOWN_MESSAGE: RegExp =
  /^(?:login failure for user .{1,64} from \S{1,64} via \S{1,16}|user \S{1,64} logged (?:in|out) from \S{1,64} via \S{1,16}|\S{1,32} link (?:up|down)\b|router (?:was )?rebooted\b)/;

const mikroTikRouterOs: SyslogVendorParser = {
  id: SyslogParserId.MikroTikRouterOs,
  vendor: "MikroTik",
  product: "RouterOS",
  format: "topics and message, BSD syslog, or CEF",
  attributePrefix: "mikrotik",
  vendorKeywords: ["mikrotik", "routeros"],

  detect: (context: SyslogParseContext): boolean => {
    if (context.cef) {
      return context.cef.deviceVendor.toLowerCase() === "mikrotik";
    }

    return readTopics(context.text) !== null;
  },

  detectForKnownVendor: (context: SyslogParseContext): boolean => {
    return KNOWN_MESSAGE.test(context.text);
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    if (context.cef) {
      // The event's name is its topics; the entry is in msg.
      const topics: string = context.cef.name;

      return {
        fields: topics ? { topics: topics } : {},
        text: context.cef.extensions["msg"] || "",
        identity: {
          hostname: context.cef.extensions["dvchost"],
          ipAddress: context.cef.extensions["dvc"],
        },
        severity: severityOfTopics(topics.split(",")),
      };
    }

    const withTopics: { topics: string; rest: string } | null = readTopics(
      context.text,
    );

    if (withTopics) {
      return {
        fields: { topics: withTopics.topics },
        text: withTopics.rest,
        severity: severityOfTopics(withTopics.topics.split(",")),
      };
    }

    return { fields: {}, text: context.text.trim() };
  },

  rules: [
    // system,error,critical login failure for user admin from 192.168.88.17 via ssh
    {
      event: NetworkEventType.AuthLoginFailed,
      text: /^login failure for user (.{1,64}) from (\S{1,64}) via (\S{1,16})\s*$/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$2",
        [NetworkEventAttribute.ProtocolName]: "$3",
      },
    },
    // system,info,account user admin logged in from 10.1.101.212 via winbox
    {
      event: NetworkEventType.AuthLoginSuccess,
      text: /^user (\S{1,64}) logged in from (\S{1,64}) via (\S{1,16})/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$2",
        [NetworkEventAttribute.ProtocolName]: "$3",
      },
    },

    // interface,info ether2 link up (speed 1G, full duplex)
    {
      event: NetworkEventType.InterfaceUp,
      text: /^(\S{1,32}) link up\b/,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    // interface,info ether1 link down
    {
      event: NetworkEventType.InterfaceDown,
      text: /^(\S{1,32}) link down\b/,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },

    // system,info router rebooted
    {
      event: NetworkEventType.DeviceReboot,
      text: /^router (?:was )?rebooted\b/,
    },

    // system,info mangle rule changed by admin
    {
      event: NetworkEventType.DeviceConfigChange,
      when: { topics: /^system,info$/ },
      text: /\b(?:added|changed|removed|moved) by (\S{1,64})\s*$/,
      set: { [NetworkEventAttribute.UserName]: "$1" },
    },
  ],
};

export default mikroTikRouterOs;

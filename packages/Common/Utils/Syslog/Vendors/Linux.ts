import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../../Types/NetworkEvent/NetworkEventType";
import {
  SyslogParseContext,
  SyslogParserId,
  SyslogVendorExtraction,
  SyslogVendorParser,
} from "../SyslogVendorParser";

/*
 * Linux-based devices.
 *
 * Access points, gateways and many switches are Linux underneath, and
 * what they send over syslog is what the same programs write on any Linux
 * machine: the kernel's network drivers when a link changes, hostapd when
 * a Wi-Fi client joins or leaves, and the SSH server (OpenSSH or
 * Dropbear) when someone signs in. A UniFi access point's own syslog, as
 * opposed to its controller's CEF export, is made of exactly these.
 *
 * No maker can be read from such a line, so this parser names none: it
 * only says what happened.
 *
 *   kernel: [1234.5] e1000e: eth0 NIC Link is Down
 *   hostapd: wlan0: STA 00:11:22:33:44:55 IEEE 802.11: associated
 *   sshd[4321]: Failed password for invalid user admin from 192.0.2.10 port 51234 ssh2
 *   dropbear[4321]: Bad password attempt for 'admin' from 192.0.2.10:51234
 */

const PROGRAMS: Array<string> = ["kernel", "hostapd", "sshd", "dropbear"];

// "sshd[4321]: " at the start of the content.
const PROGRAM_TAG: RegExp =
  /^(kernel|hostapd|sshd|dropbear)(?:\[\d{1,10}\])?: ?/;

// The kernel's uptime stamp: "[ 1234.567890] ".
const KERNEL_UPTIME: RegExp = /^\[ {0,8}\d{1,10}\.\d{1,9}\] ?/;

function readProgram(
  context: SyslogParseContext,
): { program: string; text: string } | null {
  const tag: RegExpMatchArray | null = context.text.match(PROGRAM_TAG);

  if (tag) {
    return {
      program: tag[1]!,
      text: context.text.slice(tag[0].length),
    };
  }

  // RFC 5424 names the program in its own header field, not in the text.
  const appName: string = (context.appName || "").toLowerCase();

  if (PROGRAMS.includes(appName)) {
    return { program: appName, text: context.text };
  }

  return null;
}

const linux: SyslogVendorParser = {
  id: SyslogParserId.Linux,
  vendor: "",
  product: "Linux-based devices (kernel, hostapd, OpenSSH, Dropbear)",
  format: "program: text",
  attributePrefix: "",
  vendorKeywords: [],

  detect: (context: SyslogParseContext): boolean => {
    return readProgram(context) !== null;
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    const read: { program: string; text: string } | null = readProgram(context);

    if (!read) {
      return { fields: {}, text: "" };
    }

    return {
      fields: { program: read.program },
      text: read.text.replace(KERNEL_UPTIME, "").trim(),
    };
  },

  rules: [
    // e1000e: eth0 NIC Link is Down   /   r8169 0000:02:00.0 eth0: Link is Down
    {
      event: NetworkEventType.InterfaceDown,
      when: { program: "kernel" },
      text: /\b([a-z][a-z0-9._-]{1,15}):? (?:NIC )?Link is Down\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    {
      event: NetworkEventType.InterfaceUp,
      when: { program: "kernel" },
      text: /\b([a-z][a-z0-9._-]{1,15}):? (?:NIC )?Link is Up\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },

    // wlan0: STA 00:11:22:33:44:55 IEEE 802.11: associated
    {
      event: NetworkEventType.WirelessClientConnected,
      when: { program: "hostapd" },
      text: /\bSTA ([0-9a-fA-F:]{17}) IEEE 802\.11: associated\b|\bAP-STA-CONNECTED ([0-9a-fA-F:]{17})\b/,
      set: { [NetworkEventAttribute.ClientMac]: ["$1", "$2"] },
    },
    {
      event: NetworkEventType.WirelessClientDisconnected,
      when: { program: "hostapd" },
      text: /\bSTA ([0-9a-fA-F:]{17}) IEEE 802\.11: (?:disassociated|deauthenticated)\b|\bAP-STA-DISCONNECTED ([0-9a-fA-F:]{17})\b/,
      set: { [NetworkEventAttribute.ClientMac]: ["$1", "$2"] },
    },

    // Failed password for invalid user admin from 192.0.2.10 port 51234 ssh2
    {
      event: NetworkEventType.AuthLoginFailed,
      when: { program: "sshd" },
      text: /^Failed \S{1,32} for (?:invalid user )?(\S{1,64}) from (\S{1,64}) port \d{1,5}/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$2",
        [NetworkEventAttribute.ProtocolName]: "ssh",
      },
    },
    // Accepted publickey for admin from 192.0.2.10 port 51234 ssh2
    {
      event: NetworkEventType.AuthLoginSuccess,
      when: { program: "sshd" },
      text: /^Accepted \S{1,32} for (\S{1,64}) from (\S{1,64}) port \d{1,5}/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$2",
        [NetworkEventAttribute.ProtocolName]: "ssh",
      },
    },
    // Bad password attempt for 'admin' from 192.0.2.10:51234
    {
      event: NetworkEventType.AuthLoginFailed,
      when: { program: "dropbear" },
      text: /^Bad password attempt for '([^']{0,64})' from ([0-9a-fA-F.:]{3,45}?)(?::\d{1,5})?\s*$/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$2",
        [NetworkEventAttribute.ProtocolName]: "ssh",
      },
    },
    // Password auth succeeded for 'admin' from 192.0.2.10:51234
    {
      event: NetworkEventType.AuthLoginSuccess,
      when: { program: "dropbear" },
      text: /^(?:Password|Pubkey) auth succeeded for '([^']{0,64})'(?: with \S{1,32} key \S{1,128})? from ([0-9a-fA-F.:]{3,45}?)(?::\d{1,5})?\s*$/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$2",
        [NetworkEventAttribute.ProtocolName]: "ssh",
      },
    },
  ],
};

export default linux;

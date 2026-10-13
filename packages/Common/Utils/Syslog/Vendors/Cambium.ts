import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../../Types/NetworkEvent/NetworkEventType";
import {
  SyslogParseContext,
  SyslogParserId,
  SyslogVendorExtraction,
  SyslogVendorParser,
} from "../SyslogVendorParser";

/*
 * Cambium Networks Enterprise Wi-Fi access points (cnPilot, XV, XE, XH).
 *
 * The access point forwards each of its events as a syslog message: a
 * capitalised mnemonic of the module, the severity (1 highest to 7) and
 * the event's name, then the text, with the client and the WLAN in
 * brackets ("Troubleshooting Tools in cnPilot E-Series APs", Cambium
 * Networks):
 *
 *   WIFI-6-CLIENT-CONNECTED Client [00-24-D7-AB-FB-3C] connected to wireless lan [camb]
 *
 * The texts are the ones Cambium lists for its access points' syslogs
 * (https://community.cambiumnetworks.com/t/list-of-syslogs-supported-on-cnpilot-aps/51363).
 *
 * The mnemonic's parts are stored as `cambium.module`, `cambium.severity`
 * and `cambium.event`.
 */

const MNEMONIC: RegExp =
  /^([A-Z][A-Z0-9]{1,15})-([1-7])-([A-Z][A-Z0-9]{0,23}(?:-[A-Z0-9]{1,24}){0,6}) (?=\S)/;

/*
 * The mnemonic alone, where a host name would be. The events are written
 * "timestamp mnemonic text", so in a syslog line with no host name the
 * mnemonic is read as the host.
 */
const MNEMONIC_AS_HOST: RegExp =
  /^([A-Z][A-Z0-9]{1,15})-([1-7])-([A-Z][A-Z0-9]{0,23}(?:-[A-Z0-9]{1,24}){0,6})$/;

/*
 * The events' texts. A line that starts with one is this product's when
 * its mnemonic stands where the host name would, and when its device is
 * known to be a Cambium one (an access point set to send the text alone).
 */
const KNOWN_TEXT: RegExp =
  /^(?:Client \[[^\]]{1,32}\] (?:connected to|disconnected from|disconnect-info|failed handshake on) |System rebooted due to watchdog reset|Administrator initiated system reboot|Restarting system, free memory|System configuration change applied|Tunnel on interface ?\[)/;

function readMnemonic(context: SyslogParseContext): {
  module: string;
  severity: string;
  event: string;
  text: string;
  isInPlaceOfHost: boolean;
} | null {
  const inText: RegExpMatchArray | null = context.text.match(MNEMONIC);

  if (inText) {
    return {
      module: inText[1]!,
      severity: inText[2]!,
      event: inText[3]!,
      text: context.text.slice(inText[0].length).trim(),
      isInPlaceOfHost: false,
    };
  }

  const asHost: RegExpMatchArray | null = (context.hostname || "").match(
    MNEMONIC_AS_HOST,
  );

  if (asHost && KNOWN_TEXT.test(context.text)) {
    return {
      module: asHost[1]!,
      severity: asHost[2]!,
      event: asHost[3]!,
      text: context.text.trim(),
      isInPlaceOfHost: true,
    };
  }

  return null;
}

const cambiumEnterpriseWifi: SyslogVendorParser = {
  id: SyslogParserId.CambiumEnterpriseWifi,
  vendor: "Cambium Networks",
  product: "Enterprise Wi-Fi access points (cnPilot, XV, XE, XH)",
  format: "MODULE-SEVERITY-EVENT",
  attributePrefix: "cambium",
  vendorKeywords: ["cambium"],

  detect: (context: SyslogParseContext): boolean => {
    return readMnemonic(context) !== null;
  },

  detectForKnownVendor: (context: SyslogParseContext): boolean => {
    return KNOWN_TEXT.test(context.text);
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    const mnemonic: ReturnType<typeof readMnemonic> = readMnemonic(context);

    if (!mnemonic) {
      return { fields: {}, text: context.text.trim() };
    }

    return {
      fields: {
        module: mnemonic.module,
        severity: mnemonic.severity,
        event: mnemonic.event,
      },
      text: mnemonic.text,
      severity: parseInt(mnemonic.severity, 10),
      headerHostnameIsNotAHost: mnemonic.isInPlaceOfHost,
    };
  },

  rules: [
    // clientConnected: "Client [client] connected to wireless lan [wlan]"
    {
      event: NetworkEventType.WirelessClientConnected,
      text: /^Client \[([^\]]{1,32})\] connected to (?:wireless lan|WLAN) \[([^\]]{1,64})\]/,
      set: {
        [NetworkEventAttribute.ClientMac]: "$1",
        [NetworkEventAttribute.WifiSsid]: "$2",
      },
    },
    // clientDisconnected: "Client [client] disconnected from WLAN [wlan], after [age] secs and used [data] bytes"
    {
      event: NetworkEventType.WirelessClientDisconnected,
      text: /^Client \[([^\]]{1,32})\] disconnected from (?:wireless lan|WLAN) \[([^\]]{1,64})\]/,
      set: {
        [NetworkEventAttribute.ClientMac]: "$1",
        [NetworkEventAttribute.WifiSsid]: "$2",
      },
    },

    // watchdogReset, adminReboot and lowMemoryRestart.
    {
      event: NetworkEventType.DeviceReboot,
      text: /^System rebooted due to watchdog reset\b|^Administrator initiated system reboot\b|^Restarting system, free memory\b/,
    },

    // configApplied: "System configuration change applied"
    {
      event: NetworkEventType.DeviceConfigChange,
      text: /^System configuration change applied\b/,
    },

    // tunnelDown: "Tunnel on interface[interface] went down"
    {
      event: NetworkEventType.VpnTunnelDown,
      text: /^Tunnel on interface ?\[([^\]]{1,64})\] went down\b/,
      set: { [NetworkEventAttribute.VpnTunnelName]: "$1" },
    },
    // tunnelUp: "Tunnel on interface[interface] is up and running"
    {
      event: NetworkEventType.VpnTunnelUp,
      text: /^Tunnel on interface ?\[([^\]]{1,64})\] is up and running\b/,
      set: { [NetworkEventAttribute.VpnTunnelName]: "$1" },
    },
  ],
};

export default cambiumEnterpriseWifi;

import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../../Types/NetworkEvent/NetworkEventType";
import {
  SyslogParseContext,
  SyslogParserId,
  SyslogRuleValueSource,
  SyslogVendorExtraction,
  SyslogVendorParser,
  hasKeyValuePair,
} from "../SyslogVendorParser";

/*
 * Sophos Firewall (SFOS, XG and XGS).
 *
 * Every log is one line of key=value pairs, in one of two layouts the
 * firewall's syslog server setting chooses between
 * (https://docs.sophos.com/nsg/sophos-firewall/21.0/syslog/index.html):
 *
 *   Central Reporting   device_name="SFW" timestamp="..." device_model="..."
 *                       device_serial_id="..." log_id="..." log_type="Event"
 *                       log_component="IPSec" log_subtype="System" ...
 *   Device Standard     device="SFW" date=... time=... timezone="..."
 *   (legacy)            device_name="..." device_id=... log_id=...
 *                       log_type="Event" log_component="IPSec" ...
 *
 * Both name what a line is about with log_type, log_component and
 * log_subtype, and say what happened in status and message. log_id is
 * twelve digits - type, component, subtype, severity - ending in the
 * five-digit message ID the guide lists each message under, kept here as
 * the field message_id. The rules read the words first and fall back on
 * the ID, so a release that rewords a message is still understood.
 *
 * The fields are stored as `sophos.<key>`, the names a Key=Value Parser
 * with the Target Prefix `sophos` gives them - the set-up OneUptime's docs
 * described before this parser existed, so searches and monitors written
 * then keep reading the same attributes.
 */

const LOG_ID: RegExp = /^\d{7}(\d{5})$/;

const TUNNEL: Partial<Record<NetworkEventAttribute, SyslogRuleValueSource>> = {
  [NetworkEventAttribute.VpnTunnelName]: ["@con_name", "@connectionname"],
  [NetworkEventAttribute.PeerAddress]: ["@dst_ip", "@remoteip"],
  [NetworkEventAttribute.ProtocolName]: "ipsec",
};

const GATEWAY: Partial<Record<NetworkEventAttribute, SyslogRuleValueSource>> = {
  [NetworkEventAttribute.GatewayName]: ["@gw_name", "@gatewayname"],
};

const WHO: Partial<Record<NetworkEventAttribute, SyslogRuleValueSource>> = {
  [NetworkEventAttribute.UserName]: ["@user_name", "@user"],
  [NetworkEventAttribute.ClientAddress]: "@src_ip",
};

const sophosFirewall: SyslogVendorParser = {
  id: SyslogParserId.SophosFirewall,
  vendor: "Sophos",
  product: "Sophos Firewall (SFOS, XG, XGS)",
  format: "key=value",
  attributePrefix: "sophos",
  vendorKeywords: ["sophos"],

  detect: (context: SyslogParseContext): boolean => {
    return (
      hasKeyValuePair(context.fullText, "log_component") &&
      hasKeyValuePair(context.fullText, "log_type")
    );
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    const fields: Record<string, string> = { ...context.getKeyValues() };
    const logId: RegExpMatchArray | null = (fields["log_id"] || "").match(
      LOG_ID,
    );

    if (logId && !Object.prototype.hasOwnProperty.call(fields, "message_id")) {
      fields["message_id"] = logId[1]!;
    }

    return {
      fields: fields,
      text: fields["message"] || "",
      identity: {
        // Central Reporting, then the legacy layout's name for it.
        serialNumber: fields["device_serial_id"] || fields["device_id"],
      },
    };
  },

  rules: [
    // IPsec tunnels: messages 17801 (established) and 17802 (terminated).
    {
      event: NetworkEventType.VpnTunnelUp,
      when: { log_component: "IPSec", status: ["Established", "Establish"] },
      set: TUNNEL,
    },
    {
      event: NetworkEventType.VpnTunnelDown,
      when: { log_component: "IPSec", status: ["Terminated", "Terminate"] },
      set: TUNNEL,
    },
    {
      event: NetworkEventType.VpnTunnelUp,
      when: { message_id: "17801" },
      set: TUNNEL,
    },
    {
      event: NetworkEventType.VpnTunnelDown,
      when: { message_id: "17802" },
      set: TUNNEL,
    },

    // Interfaces, 17813 and 17820: "Interface Port2 is Down", "Primary link Port5 is Up".
    {
      event: NetworkEventType.InterfaceDown,
      when: { log_component: "Interface" },
      text: /^(?:Interface|Primary link|Backup link) (\S{1,64}) is down\b/i,
      set: {
        [NetworkEventAttribute.InterfaceName]: ["$1", "@interface"],
      },
    },
    {
      event: NetworkEventType.InterfaceUp,
      when: { log_component: "Interface" },
      text: /^(?:Interface|Primary link|Backup link) (\S{1,64}) is up\b/i,
      set: {
        [NetworkEventAttribute.InterfaceName]: ["$1", "@interface"],
      },
    },

    // WAN gateways, 17814: "Gateway DHCP_Port2_GW is Down".
    {
      event: NetworkEventType.GatewayDown,
      when: { log_component: "Gateway" },
      text: /^Gateway (.{1,128}?) is down\b/i,
      set: {
        [NetworkEventAttribute.GatewayName]: ["@gatewayname", "$1"],
      },
    },
    {
      event: NetworkEventType.GatewayUp,
      when: { log_component: "Gateway" },
      text: /^Gateway (.{1,128}?) is up\b/i,
      set: {
        [NetworkEventAttribute.GatewayName]: ["@gatewayname", "$1"],
      },
    },

    /*
     * High availability, messages 60012 to 60019. Becoming primary while
     * running (60015) is the failover; the same at start-up (60016 to
     * 60019) is the pair forming, and every other change is a change of
     * role.
     */
    {
      event: NetworkEventType.HaStateChange,
      when: { log_component: "HA" },
      text: /becomes (standalone|auxiliary|primary) at appliance start ?up/i,
      set: { [NetworkEventAttribute.HaRole]: "$1" },
    },
    {
      event: NetworkEventType.HaFailover,
      when: { log_component: "HA" },
      text: /becomes (primary)\b/i,
      set: { [NetworkEventAttribute.HaRole]: "$1" },
    },
    {
      event: NetworkEventType.HaStateChange,
      when: { log_component: "HA" },
      text: /becomes (standalone|auxiliary)\b/i,
      set: { [NetworkEventAttribute.HaRole]: "$1" },
    },
    {
      event: NetworkEventType.HaStateChange,
      when: { log_component: "HA" },
      text: /goes in fault\b/i,
      set: { [NetworkEventAttribute.HaRole]: "fault" },
    },
    {
      event: NetworkEventType.HaFailover,
      when: { message_id: "60015" },
      set: { [NetworkEventAttribute.HaRole]: "primary" },
    },
    {
      event: NetworkEventType.HaStateChange,
      when: { message_id: ["60012", "60016"] },
      set: { [NetworkEventAttribute.HaRole]: "standalone" },
    },
    {
      event: NetworkEventType.HaStateChange,
      when: { message_id: ["60013", "60017"] },
      set: { [NetworkEventAttribute.HaRole]: "fault" },
    },
    {
      event: NetworkEventType.HaStateChange,
      when: { message_id: ["60014", "60018"] },
      set: { [NetworkEventAttribute.HaRole]: "auxiliary" },
    },
    {
      event: NetworkEventType.HaStateChange,
      when: { message_id: "60019" },
      set: { [NetworkEventAttribute.HaRole]: "primary" },
    },

    /*
     * SD-WAN, messages 19021 to 19024 and 19026. The SLA summary the
     * firewall writes every interval (19025, log_subtype "Information") is
     * a measurement, not an event, and is left alone.
     */
    {
      event: NetworkEventType.SdwanSlaNotMet,
      when: { log_type: "SD-WAN", message_id: "19024" },
      set: GATEWAY,
    },
    {
      event: NetworkEventType.SdwanSlaMet,
      when: { log_type: "SD-WAN", message_id: "19023" },
      set: GATEWAY,
    },
    {
      event: NetworkEventType.GatewayDown,
      when: { log_type: "SD-WAN", message_id: "19022" },
      set: GATEWAY,
    },
    {
      event: NetworkEventType.GatewayUp,
      when: { log_type: "SD-WAN", message_id: "19021" },
      set: GATEWAY,
    },
    {
      event: NetworkEventType.SdwanSlaNotMet,
      when: {
        log_type: "SD-WAN",
        log_subtype: "Health check",
        status: "SLA not met",
      },
      set: GATEWAY,
    },
    {
      event: NetworkEventType.SdwanSlaMet,
      when: {
        log_type: "SD-WAN",
        log_subtype: "Health check",
        status: "SLA met",
      },
      set: GATEWAY,
    },
    {
      event: NetworkEventType.GatewayDown,
      when: {
        log_type: "SD-WAN",
        log_subtype: "Health check",
        status: "Unavailable",
      },
      set: GATEWAY,
    },
    {
      event: NetworkEventType.GatewayUp,
      when: {
        log_type: "SD-WAN",
        log_subtype: "Health check",
        status: "Available",
      },
      set: GATEWAY,
    },
    {
      event: NetworkEventType.WanFailover,
      when: { log_type: "SD-WAN", log_subtype: "Route change" },
      text: /route changed from \S{1,128} to (\S{1,128})/i,
      set: { [NetworkEventAttribute.GatewayName]: "$1" },
    },
    {
      event: NetworkEventType.WanFailover,
      when: { log_type: "SD-WAN", log_subtype: "Route change" },
    },

    // Remote Ethernet Devices the firewall manages: 18014 and 18015.
    {
      event: NetworkEventType.DeviceOnline,
      when: { log_component: "RED", status: "Connected" },
    },
    {
      event: NetworkEventType.DeviceOffline,
      when: { log_component: "RED", status: "Disconnected" },
    },

    // Signing in: 17701 and its siblings, one pair per way of signing in.
    {
      event: NetworkEventType.AuthLoginFailed,
      when: { log_subtype: "Authentication", status: "Failed" },
      set: WHO,
    },
    {
      event: NetworkEventType.AuthLoginSuccess,
      when: { log_subtype: "Authentication", status: "Successful" },
      text: /logged in successfully/i,
      set: WHO,
    },

    // What an administrator changed, from the web console or the CLI.
    {
      event: NetworkEventType.DeviceConfigChange,
      when: { log_subtype: "Admin", status: "Successful" },
      set: WHO,
    },
  ],
};

export default sophosFirewall;

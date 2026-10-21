import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../../Types/NetworkEvent/NetworkEventType";
import {
  SyslogParseContext,
  SyslogParserId,
  SyslogVendorExtraction,
  SyslogVendorParser,
  hasKeyValuePair,
} from "../SyslogVendorParser";

/*
 * Fortinet FortiGate (FortiOS).
 *
 * One line of key=value pairs per log, in FortiOS's default syslog format:
 *
 *   date=2021-04-20 time=17:06:31 devname="FG100" devid="FG100..."
 *   logid="0101037138" type="event" subtype="vpn" level="notice" vd="root"
 *   logdesc="IPsec connection status changed" action="tunnel-down"
 *   vpntunnel="to_HQ" ...
 *
 * logid is ten digits: the log type and subtype, then a six-digit message
 * ID - the number the FortiOS Log Message Reference lists each message
 * under (https://docs.fortinet.com/document/fortigate/7.4.0/fortios-log-message-reference).
 * The rules below match on that ID, so they do not depend on the wording
 * of logdesc or msg, which FortiOS releases adjust.
 *
 * The fields are stored as `fortigate.<key>`.
 */

/*
 * logid by its message ID: four digits of type and subtype, then the ID
 * padded to six.
 */
const TUNNEL_STATUS: RegExp = /^\d{4}037138$/;
const INTERFACE_STATUS: RegExp = /^\d{4}0200(?:90|99)$/;
const ADMIN_LOGIN_FAILED: RegExp = /^\d{4}032002$/;
const ADMIN_LOGIN_SUCCESSFUL: RegExp = /^\d{4}032001$/;
const REBOOTED_OR_STARTED: RegExp = /^\d{4}032(?:138|009)$/;
const CONFIGURATION_CHANGED: RegExp = /^\d{4}032102$/;
const POWER_SUPPLY_FAILED: RegExp = /^\d{4}022105$/;
const POWER_SUPPLY_RESTORED: RegExp = /^\d{4}022104$/;
const FAN_ANOMALY: RegExp = /^\d{4}022108$/;
const FAN_NORMAL: RegExp = /^\d{4}022151$/;
const HA_FAILOVER_SUCCESS: RegExp = /^\d{4}035016$/;
const HA_MEMBER_STATE_MOVED: RegExp = /^\d{4}037892$/;
const HA_MEMBER_DEAD: RegExp = /^\d{4}037893$/;
const HA_MEMBER_JOINED: RegExp = /^\d{4}037894$/;

const fortinetFortiGate: SyslogVendorParser = {
  id: SyslogParserId.FortinetFortiGate,
  vendor: "Fortinet",
  product: "FortiGate (FortiOS)",
  format: "key=value",
  attributePrefix: "fortigate",
  vendorKeywords: ["fortinet", "fortigate"],

  detect: (context: SyslogParseContext): boolean => {
    return (
      hasKeyValuePair(context.fullText, "logid") &&
      hasKeyValuePair(context.fullText, "type") &&
      hasKeyValuePair(context.fullText, "subtype")
    );
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    const fields: Record<string, string> = context.getKeyValues();

    return {
      fields: fields,
      text: fields["msg"] || fields["logdesc"] || "",
      identity: {
        hostname: fields["devname"],
        serialNumber: fields["devid"],
      },
    };
  },

  rules: [
    // 37138, "IPsec connection status changed": action tunnel-up / tunnel-down.
    {
      event: NetworkEventType.VpnTunnelDown,
      when: { logid: TUNNEL_STATUS, action: "tunnel-down" },
      set: {
        [NetworkEventAttribute.VpnTunnelName]: "@vpntunnel",
        [NetworkEventAttribute.PeerAddress]: "@remip",
        [NetworkEventAttribute.ProtocolName]: "ipsec",
      },
    },
    {
      event: NetworkEventType.VpnTunnelUp,
      when: { logid: TUNNEL_STATUS, action: "tunnel-up" },
      set: {
        [NetworkEventAttribute.VpnTunnelName]: "@vpntunnel",
        [NetworkEventAttribute.PeerAddress]: "@remip",
        [NetworkEventAttribute.ProtocolName]: "ipsec",
      },
    },

    // 20090 "Interface link status changed", 20099 "Interface status changed".
    {
      event: NetworkEventType.InterfaceDown,
      when: { logid: INTERFACE_STATUS, status: "down" },
      text: /^(?:.{0,200}?\binterface ([^\s,.]{1,64}))?/i,
      set: { [NetworkEventAttribute.InterfaceName]: ["@intf", "$1"] },
    },
    {
      event: NetworkEventType.InterfaceUp,
      when: { logid: INTERFACE_STATUS, status: "up" },
      text: /^(?:.{0,200}?\binterface ([^\s,.]{1,64}))?/i,
      set: { [NetworkEventAttribute.InterfaceName]: ["@intf", "$1"] },
    },

    // 32001 "Admin login successful", 32002 "Admin login failed".
    {
      event: NetworkEventType.AuthLoginFailed,
      when: { logid: ADMIN_LOGIN_FAILED },
      set: {
        [NetworkEventAttribute.UserName]: "@user",
        [NetworkEventAttribute.ClientAddress]: "@srcip",
      },
    },
    {
      event: NetworkEventType.AuthLoginSuccess,
      when: { logid: ADMIN_LOGIN_SUCCESSFUL },
      set: {
        [NetworkEventAttribute.UserName]: "@user",
        [NetworkEventAttribute.ClientAddress]: "@srcip",
      },
    },

    // 32138 "Device rebooted", 32009 "FortiGate started".
    {
      event: NetworkEventType.DeviceReboot,
      when: { logid: REBOOTED_OR_STARTED },
    },

    // 32102 "Configuration changed".
    {
      event: NetworkEventType.DeviceConfigChange,
      when: { logid: CONFIGURATION_CHANGED },
      set: { [NetworkEventAttribute.UserName]: "@user" },
    },

    // 22105 "Power supply failed", 22104 "Power supply restored".
    {
      event: NetworkEventType.HardwarePowerSupplyFailed,
      when: { logid: POWER_SUPPLY_FAILED },
      set: { [NetworkEventAttribute.HardwareName]: "@unit" },
    },
    {
      event: NetworkEventType.HardwarePowerSupplyOk,
      when: { logid: POWER_SUPPLY_RESTORED },
      set: { [NetworkEventAttribute.HardwareName]: "@unit" },
    },

    // 22108 "Fan anomaly", 22151 "Fan normal".
    {
      event: NetworkEventType.HardwareFanFailed,
      when: { logid: FAN_ANOMALY },
    },
    {
      event: NetworkEventType.HardwareFanOk,
      when: { logid: FAN_NORMAL },
    },

    /*
     * High availability: 35016 "HA failover success", 37892 "Virtual
     * cluster member state moved", 37893 "Virtual cluster member dead",
     * 37894 "Virtual cluster member joined".
     */
    {
      event: NetworkEventType.HaFailover,
      when: { logid: HA_FAILOVER_SUCCESS },
    },
    {
      event: NetworkEventType.HaStateChange,
      when: { logid: HA_MEMBER_STATE_MOVED },
      set: {
        [NetworkEventAttribute.HaRole]: ["@ha_role", "@vcluster_state"],
      },
    },
    {
      event: NetworkEventType.HaPeerDown,
      when: { logid: HA_MEMBER_DEAD },
      set: { [NetworkEventAttribute.HaPeer]: "@sn" },
    },
    {
      event: NetworkEventType.HaPeerUp,
      when: { logid: HA_MEMBER_JOINED },
      set: { [NetworkEventAttribute.HaPeer]: "@sn" },
    },

    /*
     * SD-WAN, 22923 "SDWAN status" and 22925 "SDWAN SLA information". The
     * message says which way it went; the periodic SLA report with nothing
     * wrong ("Health Check SLA status.") is a measurement and is left alone.
     */
    {
      event: NetworkEventType.GatewayDown,
      when: { subtype: "sdwan" },
      text: /^Member link is unreachable\b/i,
      set: {
        [NetworkEventAttribute.GatewayName]: ["@interface", "@member"],
      },
    },
    {
      event: NetworkEventType.GatewayUp,
      when: { subtype: "sdwan" },
      text: /^Member link is available\b/i,
      set: {
        [NetworkEventAttribute.GatewayName]: ["@interface", "@member"],
      },
    },
    {
      event: NetworkEventType.SdwanSlaNotMet,
      when: { subtype: "sdwan" },
      text: /\bMember out-of-sla\b|\bSLA failed\b/i,
      set: {
        [NetworkEventAttribute.GatewayName]: [
          "@interface",
          "@healthcheck",
          "@member",
        ],
      },
    },
    {
      event: NetworkEventType.SdwanSlaMet,
      when: { subtype: "sdwan" },
      text: /\bMember in sla\b/i,
      set: {
        [NetworkEventAttribute.GatewayName]: [
          "@interface",
          "@healthcheck",
          "@member",
        ],
      },
    },
  ],
};

export default fortinetFortiGate;

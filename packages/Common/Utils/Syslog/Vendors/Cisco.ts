import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../../Types/NetworkEvent/NetworkEventType";
import {
  SyslogParseContext,
  SyslogParserId,
  SyslogVendorExtraction,
  SyslogVendorParser,
} from "../SyslogVendorParser";

/*
 * Cisco IOS, IOS XE, NX-OS and ASA.
 *
 * Every Cisco system message carries the same mark, wherever its header
 * puts it:
 *
 *   %FACILITY-SEVERITY-MNEMONIC: Message-text
 *
 *   %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down
 *   %ASA-1-104001: (Secondary) Switching to ACTIVE - Service card in other unit has failed.
 *
 * The facility names the part of the system, the severity is the syslog
 * one (0 to 7), and the mnemonic names the message - on an ASA it is the
 * six-digit message number. Some platforms put a sub-facility between
 * facility and severity (%LINEPROTO-SP-5-UPDOWN). The message texts are
 * the ones Cisco's System Message Guides list for each mnemonic.
 *
 * The header before the mark varies with the device's `logging` and
 * `service timestamps` settings (a sequence number, an asterisk before an
 * unsynchronised clock, no host name), so nothing here depends on it.
 *
 * The fields are stored as `cisco.facility`, `cisco.severity` and
 * `cisco.mnemonic`.
 */

const SYSTEM_MESSAGE: RegExp =
  /%([A-Z][A-Z0-9_]{1,40})(?:-([A-Z][A-Z0-9_]{0,20}))?-([0-7])-([A-Z0-9_]{2,60}): ?/;

interface CiscoSystemMessage {
  facility: string;
  severity: string;
  mnemonic: string;
  text: string;
}

function readSystemMessage(text: string): CiscoSystemMessage | null {
  const match: RegExpMatchArray | null = text.match(SYSTEM_MESSAGE);

  if (!match || match.index === undefined) {
    return null;
  }

  return {
    facility: match[1]!,
    severity: match[3]!,
    mnemonic: match[4]!,
    text: text.slice(match.index + match[0].length).trim(),
  };
}

const cisco: SyslogVendorParser = {
  id: SyslogParserId.Cisco,
  vendor: "Cisco",
  product: "IOS, IOS XE, NX-OS and ASA",
  format: "%FACILITY-SEVERITY-MNEMONIC",
  attributePrefix: "cisco",
  vendorKeywords: ["cisco"],

  detect: (context: SyslogParseContext): boolean => {
    return context.text.includes("%") && SYSTEM_MESSAGE.test(context.text);
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    const message: CiscoSystemMessage | null = readSystemMessage(context.text);

    if (!message) {
      return { fields: {}, text: "" };
    }

    return {
      fields: {
        facility: message.facility,
        severity: message.severity,
        mnemonic: message.mnemonic,
      },
      text: message.text,
      severity: parseInt(message.severity, 10),
    };
  },

  rules: [
    /*
     * Interfaces. %LINK-3-UPDOWN and %LINK-5-CHANGED are the physical
     * layer, %LINEPROTO-5-UPDOWN the line protocol; an ASA writes the
     * latter as messages 411001 (up) and 411002 (down); NX-OS writes
     * %ETHPORT-5-IF_DOWN_<reason> and %ETHPORT-5-IF_UP.
     */
    {
      event: NetworkEventType.InterfaceDown,
      when: { facility: ["LINK", "LINEPROTO"] },
      text: /^(?:Line protocol on )?Interface ([^\s,]{1,64}), changed state to (?:administratively )?down\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    {
      event: NetworkEventType.InterfaceUp,
      when: { facility: ["LINK", "LINEPROTO"] },
      text: /^(?:Line protocol on )?Interface ([^\s,]{1,64}), changed state to up\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    {
      event: NetworkEventType.InterfaceDown,
      when: { facility: "ASA", mnemonic: "411002" },
      text: /^Line protocol on Interface ([^\s,]{1,64}), changed state to down\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    {
      event: NetworkEventType.InterfaceUp,
      when: { facility: "ASA", mnemonic: "411001" },
      text: /^Line protocol on Interface ([^\s,]{1,64}), changed state to up\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    {
      event: NetworkEventType.InterfaceDown,
      when: { facility: "ETHPORT", mnemonic: /^IF_DOWN/ },
      text: /^Interface ([^\s,]{1,64}) is down\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    {
      event: NetworkEventType.InterfaceUp,
      when: { facility: "ETHPORT", mnemonic: "IF_UP" },
      text: /^Interface ([^\s,]{1,64}) is up\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },

    // %PM-4-ERR_DISABLE: bpduguard error detected on Gi0/1, putting Gi0/1 in err-disable state
    {
      event: NetworkEventType.InterfaceErrorDisabled,
      when: { facility: "PM", mnemonic: "ERR_DISABLE" },
      text: /error detected on ([^\s,]{1,64}),/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },

    // %SYS-5-RESTART: System restarted --   and   %SYS-5-RELOAD: Reload requested by ...
    {
      event: NetworkEventType.DeviceReboot,
      when: { facility: "SYS", mnemonic: ["RESTART", "RELOAD"] },
    },

    // %SYS-5-CONFIG_I: Configured from console by admin on vty0 (10.1.1.1)
    {
      event: NetworkEventType.DeviceConfigChange,
      when: { mnemonic: ["CONFIG_I", "VSHD_SYSLOG_CONFIG_I"] },
      text: /^Configured from \S{1,64} by (\S{1,64})(?: on (?:\S{1,64} \(([^)\s]{1,64})\)|([0-9a-fA-F.:]{3,45})@\S{1,32}))?/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: ["$2", "$3"],
      },
    },
    {
      event: NetworkEventType.DeviceConfigChange,
      when: { mnemonic: ["CONFIG_I", "VSHD_SYSLOG_CONFIG_I"] },
    },

    // %OSPF-5-ADJCHG: Process 1, Nbr 10.0.0.2 on Gi0/0 from FULL to DOWN, Neighbor Down: Dead timer expired
    {
      event: NetworkEventType.RoutingNeighborDown,
      when: { facility: ["OSPF", "OSPFV3"], mnemonic: "ADJCHG" },
      text: /\bNbr (\S{1,64}) on (\S{1,64}) from \S{1,32} to DOWN\b/,
      set: {
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.InterfaceName]: "$2",
        [NetworkEventAttribute.ProtocolName]: "ospf",
      },
    },
    {
      event: NetworkEventType.RoutingNeighborUp,
      when: { facility: ["OSPF", "OSPFV3"], mnemonic: "ADJCHG" },
      text: /\bNbr (\S{1,64}) on (\S{1,64}) from \S{1,32} to FULL\b/,
      set: {
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.InterfaceName]: "$2",
        [NetworkEventAttribute.ProtocolName]: "ospf",
      },
    },

    // %BGP-5-ADJCHANGE: neighbor 10.0.0.2 Down BGP Notification sent
    {
      event: NetworkEventType.RoutingNeighborDown,
      when: { facility: ["BGP", "BGP_SESSION"], mnemonic: "ADJCHANGE" },
      text: /^neighbor (\S{1,64})(?: \S{1,32}){0,6}? Down\b/,
      set: {
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.ProtocolName]: "bgp",
      },
    },
    {
      event: NetworkEventType.RoutingNeighborUp,
      when: { facility: ["BGP", "BGP_SESSION"], mnemonic: "ADJCHANGE" },
      text: /^neighbor (\S{1,64})(?: \S{1,32}){0,6}? Up\b/,
      set: {
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.ProtocolName]: "bgp",
      },
    },

    // %DUAL-5-NBRCHANGE: EIGRP-IPv4 1: Neighbor 10.0.0.2 (Gi0/0) is down: holding time expired
    {
      event: NetworkEventType.RoutingNeighborDown,
      when: { facility: "DUAL", mnemonic: "NBRCHANGE" },
      text: /\bNeighbor (\S{1,64}) \(([^)\s]{1,64})\) is down\b/,
      set: {
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.InterfaceName]: "$2",
        [NetworkEventAttribute.ProtocolName]: "eigrp",
      },
    },
    {
      event: NetworkEventType.RoutingNeighborUp,
      when: { facility: "DUAL", mnemonic: "NBRCHANGE" },
      text: /\bNeighbor (\S{1,64}) \(([^)\s]{1,64})\) is up\b/,
      set: {
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.InterfaceName]: "$2",
        [NetworkEventAttribute.ProtocolName]: "eigrp",
      },
    },

    // %SEC_LOGIN-4-LOGIN_FAILED: Login failed [user: admin] [Source: 10.1.1.1] [localport: 22] [Reason: ...]
    {
      event: NetworkEventType.AuthLoginFailed,
      when: { facility: "SEC_LOGIN", mnemonic: "LOGIN_FAILED" },
      text: /\[user: ([^\]]{0,64})\] \[Source: ([^\]]{0,64})\]/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$2",
      },
    },
    {
      event: NetworkEventType.AuthLoginSuccess,
      when: { facility: "SEC_LOGIN", mnemonic: "LOGIN_SUCCESS" },
      text: /\[user: ([^\]]{0,64})\] \[Source: ([^\]]{0,64})\]/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$2",
      },
    },
    // %ASA-6-605004: Login denied from 10.1.1.1/4135 to inside:10.1.1.2/ssh for user "admin"
    {
      event: NetworkEventType.AuthLoginFailed,
      when: { facility: "ASA", mnemonic: "605004" },
      text: /^Login denied from ([^/\s]{1,64})\/\S{1,16} to \S{1,128} for user "([^"]{0,64})"/,
      set: {
        [NetworkEventAttribute.UserName]: "$2",
        [NetworkEventAttribute.ClientAddress]: "$1",
      },
    },
    {
      event: NetworkEventType.AuthLoginSuccess,
      when: { facility: "ASA", mnemonic: "605005" },
      text: /^Login permitted from ([^/\s]{1,64})\/\S{1,16} to \S{1,128} for user "([^"]{0,64})"/,
      set: {
        [NetworkEventAttribute.UserName]: "$2",
        [NetworkEventAttribute.ClientAddress]: "$1",
      },
    },

    /*
     * High availability. HSRP taking the active role, and an ASA pair
     * failing over (104001 switching to ACTIVE), are failovers; the other
     * HSRP changes and an ASA going to standby (104002) are changes of role.
     */
    {
      event: NetworkEventType.HaFailover,
      when: { facility: ["HSRP", "STANDBY"], mnemonic: "STATECHANGE" },
      text: /^(\S{1,64}) Grp \d{1,5} state \S{1,32} -> (Active)\b/,
      set: {
        [NetworkEventAttribute.HaRole]: "$2",
        [NetworkEventAttribute.InterfaceName]: "$1",
      },
    },
    {
      event: NetworkEventType.HaStateChange,
      when: { facility: ["HSRP", "STANDBY"], mnemonic: "STATECHANGE" },
      text: /^(\S{1,64}) Grp \d{1,5} state \S{1,32} -> (\S{1,32})/,
      set: {
        [NetworkEventAttribute.HaRole]: "$2",
        [NetworkEventAttribute.InterfaceName]: "$1",
      },
    },
    {
      event: NetworkEventType.HaFailover,
      when: { facility: "ASA", mnemonic: "104001" },
      set: { [NetworkEventAttribute.HaRole]: "active" },
    },
    {
      event: NetworkEventType.HaStateChange,
      when: { facility: "ASA", mnemonic: "104002" },
      set: { [NetworkEventAttribute.HaRole]: "standby" },
    },

    // %STACKMGR-4-SWITCH_REMOVED: Switch 2 has been REMOVED from the stack
    {
      event: NetworkEventType.HaPeerDown,
      when: { facility: "STACKMGR", mnemonic: "SWITCH_REMOVED" },
      text: /^(Switch \d{1,3})\b/,
      set: { [NetworkEventAttribute.HaPeer]: "$1" },
    },
    {
      event: NetworkEventType.HaPeerUp,
      when: { facility: "STACKMGR", mnemonic: "SWITCH_ADDED" },
      text: /^(Switch \d{1,3})\b/,
      set: { [NetworkEventAttribute.HaPeer]: "$1" },
    },

    // %CRYPTO-5-SESSION_STATUS: Crypto tunnel is DOWN. Peer 203.0.113.2:500 Id: 203.0.113.2
    {
      event: NetworkEventType.VpnTunnelDown,
      when: { facility: "CRYPTO", mnemonic: "SESSION_STATUS" },
      text: /^Crypto tunnel is DOWN\.\s{1,4}Peer ([0-9a-fA-F.:]{3,45}?)(?::\d{1,5})?\s/,
      set: {
        [NetworkEventAttribute.VpnTunnelName]: "$1",
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.ProtocolName]: "ipsec",
      },
    },
    {
      event: NetworkEventType.VpnTunnelUp,
      when: { facility: "CRYPTO", mnemonic: "SESSION_STATUS" },
      text: /^Crypto tunnel is UP\.\s{1,4}Peer ([0-9a-fA-F.:]{3,45}?)(?::\d{1,5})?\s/,
      set: {
        [NetworkEventAttribute.VpnTunnelName]: "$1",
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.ProtocolName]: "ipsec",
      },
    },
    // %ASA-5-713259: Group = HQ, IP = 203.0.113.2, Session is being torn down. Reason: ...
    {
      event: NetworkEventType.VpnTunnelDown,
      when: { facility: "ASA", mnemonic: "713259" },
      text: /^Group = ([^,]{1,128}),/,
      set: {
        [NetworkEventAttribute.VpnTunnelName]: "$1",
        [NetworkEventAttribute.ProtocolName]: "ipsec",
      },
    },
    // %ASA-5-713120: Group = HQ, IP = 203.0.113.2, PHASE 2 COMPLETED (msgid=...)
    {
      event: NetworkEventType.VpnTunnelUp,
      when: { facility: "ASA", mnemonic: "713120" },
      text: /^Group = ([^,]{1,128}),/,
      set: {
        [NetworkEventAttribute.VpnTunnelName]: "$1",
        [NetworkEventAttribute.ProtocolName]: "ipsec",
      },
    },

    // %SPANTREE-2-LOOPGUARD_BLOCK: Loop guard blocking port Gi0/1 on VLAN0001.
    {
      event: NetworkEventType.LoopDetected,
      when: { facility: "SPANTREE", mnemonic: "LOOPGUARD_BLOCK" },
      text: /\bport (\S{1,64}) on\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    // %SPANTREE-5-TOPOTRAP: Topology Change Trap for vlan 10
    {
      event: NetworkEventType.StpTopologyChange,
      when: { facility: "SPANTREE", mnemonic: "TOPOTRAP" },
    },

    // %ILPOWER-3-CONTROLLER_PORT_ERR: Controller port error, Interface Gi1/0/1: Power Controller reports ...
    {
      event: NetworkEventType.PoeFault,
      when: { facility: "ILPOWER", mnemonic: "CONTROLLER_PORT_ERR" },
      text: /\bInterface ([^\s:,]{1,64})/,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },

    /*
     * Fans and power supplies. Each platform has mnemonics of its own
     * (%C4K_IOSMODPORTMAN-4-FANTRAYBAD, %CI-3-PSFAIL, %FAN-3-FAN_FAILED),
     * and they share a vocabulary: the part, and BAD, FAIL or FAULT - or
     * GOOD and OK when it is back. PoE (%ILPOWER) is not a power supply.
     */
    {
      event: NetworkEventType.HardwareFanFailed,
      when: {
        mnemonic: /FAN\w{0,20}(?:BAD|FAIL|FAULT)|(?:BAD|FAIL|FAULT)\w{0,20}FAN/,
      },
    },
    {
      event: NetworkEventType.HardwareFanOk,
      when: { mnemonic: /FAN\w{0,20}(?:GOOD|OK)\b|FAN_OK/ },
    },
    {
      event: NetworkEventType.HardwarePowerSupplyFailed,
      when: {
        facility: /^(?!ILPOWER$)/,
        mnemonic:
          /(?:POWERSUPPLY|POWER_SUPPLY|PSU|^PS|_PS_?)\w{0,20}(?:BAD|FAIL|FAULT)/,
      },
    },
    {
      event: NetworkEventType.HardwarePowerSupplyOk,
      when: {
        facility: /^(?!ILPOWER$)/,
        mnemonic:
          /(?:POWERSUPPLY|POWER_SUPPLY|PSU|^PS|_PS_?)\w{0,20}(?:GOOD|OK)\b/,
      },
    },
  ],
};

export default cisco;

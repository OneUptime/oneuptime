import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../../Types/NetworkEvent/NetworkEventType";
import {
  SyslogParseContext,
  SyslogParserId,
  SyslogVendorExtraction,
  SyslogVendorParser,
} from "../SyslogVendorParser";

/*
 * Extreme Networks: two operating systems, two parsers.
 *
 * EXTREMEXOS / SWITCH ENGINE. Every message carries a four-letter
 * severity in angle brackets, alone or with the event's name, depending on
 * the switch's `configure log target ... format` setting
 * (https://documentation.extremenetworks.com/exos_commands_16/EXOS_16_2/EXOS_Commands_All/r_configure-log-target-format.shtml):
 *
 *   <Info> Port 1:12 link down                           (the syslog default)
 *   <Info:vlan> Port 1:12 link down                      (event-name component)
 *   <Info:vlan.msgs.portLinkStateDown> Port 1:12 link down     (... condition)
 *
 * The severities are Crit, Erro, Warn, Noti, Info, Summ, Verb and Data. A
 * syslog target sends no host name by default, and the tag before the
 * severity is the component ("vlan:", "AAA:"). The message texts are the
 * ones the EMS Messages Catalog lists
 * (https://documentation.extremenetworks.com/ems_catalog_16/).
 *
 * FABRIC ENGINE / VOSS. A different line altogether:
 *
 *   CP1 [03/18/70 09:55:35.890] 0x0000c5e7 00300001.238 DYNAMIC SET GlobalRouter HW INFO Link Down(1/47)
 *
 * the slot, the switch's own time, an event code, an alarm code (with its
 * type and status on alarm messages), the VRF, the module, the severity
 * and the text.
 *
 * Both store their fields as `extreme.<key>`.
 */

const EXOS_SEVERITY: RegExp =
  /<(Crit|Erro|Warn|Noti|Info|Summ|Verb|Data)(?::([A-Za-z][A-Za-z0-9_.]{0,80}))?> ?/;

// How far into the content the severity may start: after a component tag.
const MAX_EXOS_SEVERITY_OFFSET: number = 64;

// EXOS severities as syslog ones.
const EXOS_SEVERITY_LEVELS: Record<string, number> = {
  Crit: 2,
  Erro: 3,
  Warn: 4,
  Noti: 5,
  Info: 6,
  Summ: 7,
  Verb: 7,
  Data: 7,
};

const extremeExos: SyslogVendorParser = {
  id: SyslogParserId.ExtremeExos,
  vendor: "Extreme Networks",
  product: "ExtremeXOS, Switch Engine",
  format: "<Severity:Component.Condition>",
  attributePrefix: "extreme",
  vendorKeywords: ["extreme"],

  detect: (context: SyslogParseContext): boolean => {
    if (!context.text.includes("<")) {
      return false;
    }

    const match: RegExpMatchArray | null = context.text.match(EXOS_SEVERITY);

    /*
     * The severity opens the message, after the tag at most: the same
     * letters in angle brackets further into some other device's text are
     * not it.
     */
    return (
      match !== null &&
      match.index !== undefined &&
      match.index <= MAX_EXOS_SEVERITY_OFFSET
    );
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    const match: RegExpMatchArray | null = context.text.match(EXOS_SEVERITY);

    if (!match || match.index === undefined) {
      return { fields: {}, text: "" };
    }

    const severity: string = match[1]!;
    const event: string = match[2] || "";
    const fields: Record<string, string> = { severity: severity };

    if (event) {
      fields["event"] = event;
    }

    /*
     * The component a message belongs to: the first part of the event's
     * name, or the tag the switch sends in its place.
     */
    const component: string = (
      event.split(".")[0] ||
      context.appName ||
      ""
    ).trim();

    if (component) {
      fields["component"] = component;
    }

    return {
      fields: fields,
      text: context.text.slice(match.index + match[0].length).trim(),
      severity: EXOS_SEVERITY_LEVELS[severity],
    };
  },

  rules: [
    // vlan.msgs.portLinkStateDown: "Port %port% link %downWithReason%"
    {
      event: NetworkEventType.InterfaceDown,
      text: /^Port (\S{1,64}) link down\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    // vlan.msgs.portLinkStateUp: "Port %port% link UP at speed %speed% and %duplex%"
    {
      event: NetworkEventType.InterfaceUp,
      text: /^Port (\S{1,64}) link up\b/i,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },

    // AAA.authFail: "Login failed for user %name% through %source%"
    {
      event: NetworkEventType.AuthLoginFailed,
      text: /^Login failed for user (\S{1,64}) through (\S{1,32})(?: \(([^)\s]{1,64})\))?/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$3",
        [NetworkEventAttribute.ProtocolName]: "$2",
      },
    },
    // AAA.authPass: "Login passed for user %name% through %source%"
    {
      event: NetworkEventType.AuthLoginSuccess,
      text: /^Login passed for user (\S{1,64}) through (\S{1,32})(?: \(([^)\s]{1,64})\))?/,
      set: {
        [NetworkEventAttribute.UserName]: "$1",
        [NetworkEventAttribute.ClientAddress]: "$3",
        [NetworkEventAttribute.ProtocolName]: "$2",
      },
    },

    // EPM.reboot: "Rebooting with reason %reason%"; EPM.UnexpctRebootDtect.
    {
      event: NetworkEventType.DeviceReboot,
      text: /^Rebooting with reason\b|^Booting after System Failure\b/,
    },

    // HAL.Sys.FanTrayFail: "Fan tray %fanTray% has failed"
    {
      event: NetworkEventType.HardwareFanFailed,
      text: /^(Fan tray \d{1,3}) has failed\b/,
      set: { [NetworkEventAttribute.HardwareName]: "$1" },
    },
    // HAL.Sys.TempWarning and HAL.Sys.TempCritical.
    {
      event: NetworkEventType.HardwareTemperatureHigh,
      text: /\bChassis air intake temperature\b/,
    },

    // ELRP.DsblPortLoopDtect: "Disabling port %port%. %durationMsg%"
    {
      event: NetworkEventType.LoopDetected,
      when: { component: "ELRP" },
      text: /^Disabling port ([0-9:]{1,16})\./,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },

    // ospf.neighbor.ChgState: "Changing the state of neighbor rtid %rtid% ipa %ip% to state = %state% %reason%."
    {
      event: NetworkEventType.RoutingNeighborDown,
      text: /^Changing the state of neighbor rtid \S{1,64} ipa (\S{1,64}) to state = DOWN\b/,
      set: {
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.ProtocolName]: "ospf",
      },
    },
    {
      event: NetworkEventType.RoutingNeighborUp,
      text: /^Changing the state of neighbor rtid \S{1,64} ipa (\S{1,64}) to state = FULL\b/,
      set: {
        [NetworkEventAttribute.PeerAddress]: "$1",
        [NetworkEventAttribute.ProtocolName]: "ospf",
      },
    },

    // VSM.RmtMLAGPeerDown: "Peer %vrid%:%peer%:: Peer is down"
    {
      event: NetworkEventType.HaPeerDown,
      text: /^Peer (\S{1,128}?):: Peer is down\b/,
      set: { [NetworkEventAttribute.HaPeer]: "$1" },
    },
    // VSM.RmtMLAGPeerUp: "Peer %vrid%:%peer%:: Peer is active"
    {
      event: NetworkEventType.HaPeerUp,
      text: /^Peer (\S{1,128}?):: Peer is active\b/,
      set: { [NetworkEventAttribute.HaPeer]: "$1" },
    },

    // POE.port_fault: "Port %slotPort% has encountered a fault condition"
    {
      event: NetworkEventType.PoeFault,
      text: /^Port (\S{1,64}) has encountered a fault condition\b/,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
  ],
};

/*
 * [time] event-code alarm-code [type status] VRF module SEVERITY text. The
 * time is the switch's own; the zone after it is optional.
 */
const VOSS_LINE: RegExp =
  /(?:\b(CP\d|IO\d|SF\d) )?\[\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?::[A-Za-z]{2,5})?\] (0x[0-9a-fA-F]{8}) [0-9a-fA-F]{8}(?:\.\d{1,6})? (?:(?:DYNAMIC|PERSISTENT) (?:SET|CLEAR) )?(\S{1,64}) ([A-Za-z][A-Za-z0-9_-]{0,31}) (INFO|WARNING|ERROR|FATAL|DEBUG|NOTICE|CRITICAL|ALERT|EMERGENCY) /;

const VOSS_SEVERITY_LEVELS: Record<string, number> = {
  EMERGENCY: 0,
  FATAL: 0,
  ALERT: 1,
  CRITICAL: 2,
  ERROR: 3,
  WARNING: 4,
  NOTICE: 5,
  INFO: 6,
  DEBUG: 7,
};

const extremeVoss: SyslogVendorParser = {
  id: SyslogParserId.ExtremeVoss,
  vendor: "Extreme Networks",
  product: "Fabric Engine, VOSS",
  format: "[time] event-code VRF module SEVERITY",
  attributePrefix: "extreme",
  vendorKeywords: ["extreme"],

  detect: (context: SyslogParseContext): boolean => {
    return context.text.includes("] 0x") && VOSS_LINE.test(context.text);
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    const match: RegExpMatchArray | null = context.text.match(VOSS_LINE);

    if (!match || match.index === undefined) {
      return { fields: {}, text: "" };
    }

    const fields: Record<string, string> = {
      event_code: match[2]!,
      vrf: match[3]!,
      module: match[4]!,
      severity: match[5]!,
    };

    if (match[1]) {
      fields["slot"] = match[1];
    }

    return {
      fields: fields,
      text: context.text.slice(match.index + match[0].length).trim(),
      severity: VOSS_SEVERITY_LEVELS[match[5]!],
    };
  },

  rules: [
    // GlobalRouter HW INFO Link Down(1/47)
    {
      event: NetworkEventType.InterfaceDown,
      text: /^Link Down\(([^)\s]{1,32})\)/,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    {
      event: NetworkEventType.InterfaceUp,
      text: /^Link Up\(([^)\s]{1,32})\)/,
      set: { [NetworkEventAttribute.InterfaceName]: "$1" },
    },
    // GlobalRouter SNMP INFO SPBM detected adj DOWN on Port1/14, ...
    {
      event: NetworkEventType.RoutingNeighborDown,
      text: /^SPBM detected adj DOWN on (?:Port)?([^\s,]{1,32})/,
      set: {
        [NetworkEventAttribute.InterfaceName]: "$1",
        [NetworkEventAttribute.ProtocolName]: "isis",
      },
    },
    {
      event: NetworkEventType.RoutingNeighborUp,
      text: /^SPBM detected adj UP on (?:Port)?([^\s,]{1,32})/,
      set: {
        [NetworkEventAttribute.InterfaceName]: "$1",
        [NetworkEventAttribute.ProtocolName]: "isis",
      },
    },
  ],
};

export { extremeExos, extremeVoss };

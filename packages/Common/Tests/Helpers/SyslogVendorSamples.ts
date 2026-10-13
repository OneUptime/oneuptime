/*
 * SYSLOG LINES AS NETWORK DEVICES SEND THEM, one set per vendor parser.
 *
 * Every line is written from the vendor's own public documentation - its
 * log reference, message catalog or help article, named in `source` - and
 * from nothing else: no line here was copied from another project's test
 * data or parser, and the names, addresses, serial numbers and MAC
 * addresses in the composed ones are invented.
 *
 *   verbatim   the line is the documentation's own example, as printed
 *              (a syslog priority or header may be put in front of it,
 *              as a device would send it);
 *   composed   the documentation gives the message's format - a template,
 *              a field table, a message ID and its meaning - and the line
 *              fills it in.
 *
 * `expect` says what the line must be read as: the parser, the event (null
 * for a line that is stored but is not an event), and the attributes and
 * identity that must be there. The suites that read these lines are
 * SyslogVendorParsers.test.ts (Common) and the ingest suites in App.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface SyslogVendorSample {
  // A short name, unique in the list.
  name: string;
  // The documentation the line is written from.
  source: string;
  kind: "verbatim" | "composed";
  // The line as the device sends it.
  line: string;
  // The device's Vendor, for a format only its maker's parser may read.
  deviceVendor?: string | undefined;
  expect: {
    parserId: string | null;
    vendor?: string | null | undefined;
    eventName: string | null;
    // Attributes that must be stored, with these values.
    attributes?: Record<string, string> | undefined;
    // Attributes that must not be stored.
    absent?: Array<string> | undefined;
    /*
     * Who the message itself names, in its own fields - exactly these and
     * nothing else.
     */
    identity?:
      | {
          hostname?: string | undefined;
          serialNumber?: string | undefined;
          macAddress?: string | undefined;
          ipAddress?: string | undefined;
          managedDevice?: boolean | undefined;
        }
      | undefined;
    /*
     * The host name of the syslog header; null when the line must have
     * none (it has no header, or what stands there names nobody).
     */
    headerHostname?: string | null | undefined;
    // The syslog severity the message itself states.
    severity?: number | undefined;
  };
}

const SOPHOS_GUIDE: string =
  "Sophos Firewall syslog guide, v21.0 - https://docs.sophos.com/nsg/sophos-firewall/21.0/syslog/index.html";

const FORTINET_VPN_LOGS: string =
  "FortiOS 6.2.0 Cookbook, Understanding VPN related logs - https://docs.fortinet.com/document/fortigate/6.2.0/cookbook/834425/understanding-vpn-related-logs";

const FORTINET_SDWAN_LOGS: string =
  "FortiOS 7.6.3 Administration Guide, Understanding SD-WAN related logs - https://docs.fortinet.com/document/fortigate/7.6.3/administration-guide/856781/understanding-sd-wan-related-logs";

const FORTINET_REFERENCE: string =
  "FortiOS 7.4.0 Log Message Reference - https://docs.fortinet.com/document/fortigate/7.4.0/fortios-log-message-reference";

const CISCO_MESSAGES: string =
  "Cisco IOS, NX-OS and ASA System Message Guides (the %FACILITY-SEVERITY-MNEMONIC message of each mnemonic)";

const EXTREME_EMS: string =
  "ExtremeXOS 16.2 EMS Messages Catalog - https://documentation.extremenetworks.com/ems_catalog_16/ - and the configure log target format command reference";

const EXTREME_VOSS: string =
  "VOSS 6.1 Release Notes and VOSS 8.2 Troubleshooting guide - https://documentation.extremenetworks.com/";

const ARUBA_AOS_CX: string =
  "AOS-CX Event Log Message Reference Guide, and HPE's AOS-CX 10.7 Event Log and Syslog filtering guide";

const ARUBA_AOS_SWITCH: string =
  "ArubaOS-Switch 16.11 Management and Configuration Guide, Event Log entries - https://arubanetworking.hpe.com/techdocs/AOS-S/16.11/MCG/KB/content/kb/eve-log-ent.htm";

const MIKROTIK_LOG: string =
  "RouterOS manual, Log - https://manual.mikrotik.com/docs/diagnostics-monitoring-and-troubleshooting/log/ and https://help.mikrotik.com/docs/spaces/ROS/pages/328094/Log";

const CAMBIUM_EVENTS: string =
  "Cambium Networks, Troubleshooting Tools in cnPilot E-Series APs, and List Of Syslogs Supported On cnPilot APs - https://community.cambiumnetworks.com/t/list-of-syslogs-supported-on-cnpilot-aps/51363";

const UNIFI_SIEM: string =
  "Ubiquiti Help Center, UniFi System Logs & SIEM Integration - https://help.ui.com/hc/en-us/articles/33349041044119-UniFi-System-Logs-SIEM-Integration";

const LINUX_PROGRAMS: string =
  "The log messages of OpenSSH (sshd), Dropbear, hostapd and the Linux kernel's network drivers";

const CEF_STANDARD: string =
  "ArcSight Common Event Format (CEF) implementation standard";

export const SOPHOS_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "sophos ipsec tunnel terminated, central reporting",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: '<30>device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X21000ABCD12345" log_id="063211617802" log_type="Event" log_component="IPSec" log_subtype="System" log_version=1 severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."',
    expect: {
      parserId: "sophos-firewall",
      vendor: "Sophos",
      eventName: "vpn.tunnel_down",
      attributes: {
        "syslog.vendor": "Sophos",
        "syslog.parser": "sophos-firewall",
        "event.domain": "network",
        "event.name": "vpn.tunnel_down",
        "vpn.tunnel.name": "HQ-Branch1",
        "network.peer.address": "10.171.4.118",
        "network.protocol.name": "ipsec",
        "event.message":
          "IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.",
        "sophos.log_component": "IPSec",
        "sophos.con_name": "HQ-Branch1",
        "sophos.status": "Terminated",
        "sophos.message_id": "17802",
        "sophos.device_model": "XGS2100",
      },
      identity: { serialNumber: "X21000ABCD12345" },
    },
  },
  {
    name: "sophos ipsec tunnel established, legacy layout",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: '<30>Jan 31 18:02:03 fw-branch device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" device_name="XG115w" device_id=C01001K234RXPA1 log_id=063211617801 log_type="Event" log_component="IPSec" log_subtype="System" status="Established" priority=Notice connectionname="Tunnel A" message="IPSec Connection Tunnel A established"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "vpn.tunnel_up",
      attributes: {
        "vpn.tunnel.name": "Tunnel A",
        "sophos.connectionname": "Tunnel A",
        "sophos.device_id": "C01001K234RXPA1",
      },
      identity: { serialNumber: "C01001K234RXPA1" },
      headerHostname: "fw-branch",
    },
  },
  {
    name: "sophos ipsec tunnel terminated, read from its message id alone",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" device_name="XG115w" device_id=C01001K234RXPA1 log_id=063211617802 log_type="Event" log_component="IPSec" log_subtype="System" priority=Notice connectionname="Tunnel A" message="IPSec Connection Tunnel A is down"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "vpn.tunnel_down",
      attributes: { "vpn.tunnel.name": "Tunnel A" },
    },
  },
  {
    name: "sophos ipsec tunnel terminated, the legacy layout's spelling of the status",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063211617802 log_type="Event" log_component="IPSec" log_subtype="System" status="Terminate" priority=Notice connectionname="Tunnel A" message="IPSec Connection Tunnel A terminated"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "vpn.tunnel_down",
      attributes: {
        "vpn.tunnel.name": "Tunnel A",
      },
    },
  },
  {
    name: "sophos ipsec tunnel established, read from its message id alone",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063211617801 log_type="Event" log_component="IPSec" log_subtype="System" priority=Notice connectionname="Tunnel B" message="IPSec Connection Tunnel B is up"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "vpn.tunnel_up",
      attributes: {
        "vpn.tunnel.name": "Tunnel B",
      },
    },
  },
  {
    name: "sophos ha: the appliance becomes auxiliary",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063911560014 log_type="Event" log_component="HA" log_subtype="System" priority=Notification status="Successful" message="Appliance becomes auxiliary"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "ha.state_change",
      attributes: {
        "ha.role": "auxiliary",
      },
    },
  },
  {
    name: "sophos ha failover, read from its message id when the words differ",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063911560015 log_type="Event" log_component="HA" log_subtype="System" priority=Notification status="Successful" message="HA state changed"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "ha.failover",
      attributes: {
        "ha.role": "primary",
      },
    },
  },
  {
    name: "sophos ha standalone, read from its message id when the words differ",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063911560012 log_type="Event" log_component="HA" log_subtype="System" priority=Notification status="Successful" message="HA state changed"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "ha.state_change",
      attributes: {
        "ha.role": "standalone",
      },
    },
  },
  {
    name: "sophos ha fault at start-up, read from its message id when the words differ",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063911560017 log_type="Event" log_component="HA" log_subtype="System" priority=Notification status="Successful" message="HA state changed"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "ha.state_change",
      attributes: {
        "ha.role": "fault",
      },
    },
  },
  {
    name: "sophos ha auxiliary at start-up, read from its message id when the words differ",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063911560018 log_type="Event" log_component="HA" log_subtype="System" priority=Notification status="Successful" message="HA state changed"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "ha.state_change",
      attributes: {
        "ha.role": "auxiliary",
      },
    },
  },
  {
    name: "sophos ha primary at start-up, read from its message id when the words differ",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063911560019 log_type="Event" log_component="HA" log_subtype="System" priority=Notification status="Successful" message="HA state changed"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "ha.state_change",
      attributes: {
        "ha.role": "primary",
      },
    },
  },
  {
    name: "sophos sd-wan sla met",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device_name="SFW" timestamp="2024-05-02T11:05:00+0200" device_model="XGS2100" device_serial_id="X21000ABCD12345" log_id="158824519023" log_type="SD-WAN" log_component="Profile" log_subtype="Health check" log_version=1 severity="Notice" profile_name="Branch-Internet" gw_name="WAN2" status="SLA met"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "sdwan.sla_met",
      attributes: {
        "network.gateway.name": "WAN2",
      },
    },
  },
  {
    name: "sophos sd-wan gateway available",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device_name="SFW" timestamp="2024-05-02T11:05:00+0200" device_model="XGS2100" device_serial_id="X21000ABCD12345" log_id="158824519021" log_type="SD-WAN" log_component="Profile" log_subtype="Health check" log_version=1 severity="Notice" profile_name="Branch-Internet" gw_name="WAN2" status="Available"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "gateway.up",
      attributes: {
        "network.gateway.name": "WAN2",
      },
    },
  },
  {
    name: "sophos sd-wan sla not met, read from its status when the line has no log id",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'log_type="SD-WAN" log_component="Profile" log_subtype="Health check" profile_name="Branch-Internet" gw_name="WAN1" status="SLA not met"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "sdwan.sla_not_met",
      attributes: {
        "network.gateway.name": "WAN1",
      },
    },
  },
  {
    name: "sophos sd-wan sla met, read from its status when the line has no log id",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'log_type="SD-WAN" log_component="Profile" log_subtype="Health check" profile_name="Branch-Internet" gw_name="WAN1" status="SLA met"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "sdwan.sla_met",
      attributes: {
        "network.gateway.name": "WAN1",
      },
    },
  },
  {
    name: "sophos sd-wan gateway unavailable, read from its status when the line has no log id",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'log_type="SD-WAN" log_component="Profile" log_subtype="Health check" profile_name="Branch-Internet" gw_name="WAN1" status="Unavailable"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "gateway.down",
      attributes: {
        "network.gateway.name": "WAN1",
      },
    },
  },
  {
    name: "sophos sd-wan gateway available, read from its status when the line has no log id",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'log_type="SD-WAN" log_component="Profile" log_subtype="Health check" profile_name="Branch-Internet" gw_name="WAN1" status="Available"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "gateway.up",
      attributes: {
        "network.gateway.name": "WAN1",
      },
    },
  },
  {
    name: "sophos sd-wan route change that names no gateways",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device_name="SFW" timestamp="2024-05-02T11:05:00+0200" device_model="XGS2100" device_serial_id="X21000ABCD12345" log_id="158826519026" log_type="SD-WAN" log_component="Route" log_subtype="Route change" log_version=1 severity="Notice" message="SD-WAN route updated"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "wan.failover",
    },
  },
  {
    name: "sophos remote ethernet device connected",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=066811618014 log_type="Event" log_component="RED" log_subtype="System" status="Connected" priority=Information red_id="A350196C47072B0" branch_name="Branch-Office" message="A350196C47072B0/Branch-Office is now re-connected after 12000ms"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "device.online",
    },
  },
  {
    name: "sophos interface down",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2017-01-31 time=18:13:29 timezone="IST" device_name="CR750iNG-XP" device_id=C44310050024-P29PUA log_id=063611617813 log_type="Event" log_component="Interface" log_subtype="System" priority=Notice message="Interface Port2 is Down"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "interface.down",
      attributes: {
        "network.interface.name": "Port2",
        "event.message": "Interface Port2 is Down",
      },
    },
  },
  {
    name: "sophos interface up",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2017-01-31 time=18:14:02 timezone="IST" device_name="CR750iNG-XP" device_id=C44310050024-P29PUA log_id=063611617813 log_type="Event" log_component="Interface" log_subtype="System" priority=Notice message="Interface Port2 is Up"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "interface.up",
      attributes: {
        "network.interface.name": "Port2",
        "event.message": "Interface Port2 is Up",
      },
    },
  },
  {
    name: "sophos primary link up",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2017-01-31 time=18:13:29 timezone="IST" device_name="CR750iNG-XP" device_id=C44310050024-P29PUA log_id=063611617820 log_type="Event" log_component="Interface" log_subtype="System" priority=Notice message="Primary link Port5 is Up"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "interface.up",
      attributes: { "network.interface.name": "Port5" },
    },
  },
  {
    name: "sophos gateway down",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2017-01-31 time=18:13:29 timezone="IST" device_name="CR750iNG-XP" device_id=C44310050024-P29PUA log_id=063911517814 log_type="Event" log_component="Gateway" log_subtype="System" priority=Notice gatewayname="DHCP_Port2_GW" message="Gateway DHCP_Port2_GW is Down"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "gateway.down",
      attributes: { "network.gateway.name": "DHCP_Port2_GW" },
    },
  },
  {
    name: "sophos gateway up",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2017-01-31 time=18:20:01 timezone="IST" device_name="CR750iNG-XP" device_id=C44310050024-P29PUA log_id=063911517814 log_type="Event" log_component="Gateway" log_subtype="System" priority=Notice gatewayname="DHCP_Port2_GW" message="Gateway DHCP_Port2_GW is Up"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "gateway.up",
      attributes: { "network.gateway.name": "DHCP_Port2_GW" },
    },
  },
  {
    name: "sophos ha: the appliance becomes primary",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063911560015 log_type="Event" log_component="HA" log_subtype="System" priority=Notification status="Successful" message="Appliance becomes primary"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "ha.failover",
      attributes: { "ha.role": "primary" },
    },
  },
  {
    name: "sophos ha: becoming primary at start-up is the pair forming",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063911560019 log_type="Event" log_component="HA" log_subtype="System" priority=Notification status="Successful" message="Appliance becomes primary at appliance start up"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "ha.state_change",
      attributes: { "ha.role": "primary" },
    },
  },
  {
    name: "sophos ha: the appliance goes in fault",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2020-01-31 time=18:13:29 timezone="IST" device_name="XG210" device_id=C22001K234RXPA1 log_id=063911560013 log_type="Event" log_component="HA" log_subtype="System" priority=Notification status="Successful" message="Appliance goes in fault"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "ha.state_change",
      attributes: { "ha.role": "fault" },
    },
  },
  {
    name: "sophos sd-wan sla not met",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device_name="SFW" timestamp="2024-05-02T11:05:00+0200" device_model="XGS2100" device_serial_id="X21000ABCD12345" log_id="158824519024" log_type="SD-WAN" log_component="Profile" log_subtype="Health check" log_version=1 severity="Notice" profile_name="Branch-Internet" gw_name="WAN2" status="SLA not met" message="SLA not met for gateway WAN2"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "sdwan.sla_not_met",
      attributes: {
        "network.gateway.name": "WAN2",
        "sophos.profile_name": "Branch-Internet",
      },
    },
  },
  {
    name: "sophos sd-wan gateway unavailable",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device_name="SFW" timestamp="2024-05-02T11:05:00+0200" device_model="XGS2100" device_serial_id="X21000ABCD12345" log_id="158824519022" log_type="SD-WAN" log_component="Profile" log_subtype="Health check" log_version=1 severity="Notice" profile_name="Branch-Internet" gw_name="WAN2" status="Unavailable"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "gateway.down",
      attributes: { "network.gateway.name": "WAN2" },
    },
  },
  {
    name: "sophos sd-wan route change",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device_name="SFW" timestamp="2024-05-02T11:05:00+0200" device_model="XGS2100" device_serial_id="X21000ABCD12345" log_id="158826519026" log_type="SD-WAN" log_component="Route" log_subtype="Route change" log_version=1 severity="Notice" message="SD-WAN route changed from gw2 to gw1"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "wan.failover",
      attributes: { "network.gateway.name": "gw1" },
    },
  },
  {
    name: "sophos sd-wan sla summary is a measurement, not an event",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'log_id=158825619025 log_type="SD-WAN" log_component="SLA" log_subtype="Information" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"',
    expect: {
      parserId: "sophos-firewall",
      eventName: null,
      attributes: {
        "sophos.gw_name": "WAN2",
        "sophos.latency": "11",
        "sophos.sla_status": "SLA met",
      },
      absent: ["event.name", "event.domain", "event.message"],
    },
  },
  {
    name: "sophos sign-in failed",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2017-01-31 time=18:13:38 timezone="IST" device_name="CR750iNG-XP" device_id=C44313350024-P29PUA log_id=062910617702 log_type="Event" log_component="Firewall Authentication" log_subtype="Authentication" status="Failed" priority=Notice user_name="test1" usergroupname="" auth_client="Web Client" auth_mechanism="Local" reason="wrong credentials" src_ip=10.198.47.71 message="User test1 failed to login to Firewall through Local authentication mechanism from 10.198.47.71 because of wrong credentials"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "auth.login_failed",
      attributes: {
        "user.name": "test1",
        "client.address": "10.198.47.71",
      },
    },
  },
  {
    name: "sophos sign-in succeeded",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2017-01-31 time=18:13:38 timezone="IST" device_name="CR750iNG-XP" device_id=C44313350024-P29PUA log_id=062910617701 log_type="Event" log_component="Firewall Authentication" log_subtype="Authentication" status="Successful" priority=Information user_name="test1" src_ip=10.198.47.71 message="User test1 of group Open Group logged in successfully to Firewall through Local authentication mechanism from 10.198.47.71"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "auth.login_success",
      attributes: { "user.name": "test1" },
    },
  },
  {
    name: "sophos sign-out is not a sign-in",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2017-01-31 time=18:13:38 timezone="IST" device_name="CR750iNG-XP" device_id=C44313350024-P29PUA log_id=062910617703 log_type="Event" log_component="Firewall Authentication" log_subtype="Authentication" status="Successful" priority=Information user_name="test1" src_ip=10.198.47.71 message="User test1 was logged out of firewall"',
    expect: { parserId: "sophos-firewall", eventName: null },
  },
  {
    name: "sophos admin change from the web console",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2021-06-02 time=10:11:12 timezone="CEST" device_name="XG210" device_id=C22001K234RXPA1 log_id=062009617504 log_type="Event" log_component="GUI" log_subtype="Admin" status="Successful" priority=Notice user_name="admin" src_ip=10.1.1.50 message="Interface \'Port4\' turned off by \'admin\' from \'10.1.1.50\' using \'GUI\'"',
    expect: {
      parserId: "sophos-firewall",
      eventName: "device.config_change",
      attributes: { "user.name": "admin", "client.address": "10.1.1.50" },
    },
  },
  {
    name: "sophos remote ethernet device disconnected",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device="SFW" date=2021-06-02 time=10:11:12 timezone="CEST" device_name="XG210" device_id=C22001K234RXPA1 log_id=066811618015 log_type="Event" log_component="RED" log_subtype="System" status="Disconnected" priority=Information red_id="A350196C47072B0" branch_name="Branch-Office" message="A350196C47072B0/Branch-Office is now disconnected"',
    expect: { parserId: "sophos-firewall", eventName: "device.offline" },
  },
  {
    name: "sophos firewall rule log is stored with its fields and is no event",
    source: SOPHOS_GUIDE,
    kind: "composed",
    line: 'device_name="SFW" timestamp="2023-12-11T09:02:50-0500" device_model="SF01V" device_serial_id="SFDemo-1234567" log_id="010101600001" log_type="Firewall" log_component="Firewall Rule" log_subtype="Allowed" log_version=1 severity="Information" fw_rule_id="5" src_ip="10.1.1.20" dst_ip="203.0.113.9" protocol="TCP" dst_port=443',
    expect: {
      parserId: "sophos-firewall",
      eventName: null,
      attributes: {
        "sophos.log_type": "Firewall",
        "sophos.dst_port": "443",
        "sophos.message_id": "00001",
      },
      absent: ["event.name"],
    },
  },
];

export const FORTINET_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "fortigate fan normal",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0100022151" type="event" subtype="system" level="notice" vd="root" logdesc="Fan normal" action="fan-monitor" status="success" msg="Fan 1 is functioning properly"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "hardware.fan_ok",
    },
  },
  {
    name: "fortigate ha cluster member state moved",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0108037892" type="event" subtype="ha" level="notice" vd="root" logdesc="Virtual cluster member state moved" msg="Virtual cluster\'s member state moved" vcluster=1 ha_role="primary" vcluster_state="work" vcluster_member=0 hostname="FG100-HQ" sn="FG100E4Q17000001"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "ha.state_change",
      attributes: {
        "ha.role": "primary",
      },
    },
  },
  {
    name: "fortigate ha cluster member joined",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0108037894" type="event" subtype="ha" level="critical" vd="root" logdesc="Virtual cluster member joined" msg="Virtual cluster detected member join" vcluster=1 sn="FG100E4Q17000002" ha_group=1',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "ha.peer_up",
      attributes: {
        "ha.peer": "FG100E4Q17000002",
      },
    },
  },
  {
    name: "fortigate ipsec tunnel down",
    source: FORTINET_VPN_LOGS,
    kind: "verbatim",
    line: '<189>date=2018-12-06 time=13:42:51 logid="0101037138" type="event" subtype="vpn" level="notice" vd="root" eventtime=1544132571 logdesc="IPsec connection status changed" msg="IPsec connection status change" action="tunnel-down" remip=11.101.1.1 locip=173.1.1.1 remport=500 locport=500 outintf="port13" cookies="30820aa390687e39/886e72bf5461fb8d" user="N/A" group="N/A" xauthuser="N/A" xauthgroup="N/A" assignip=11.11.11.1 vpntunnel="to_HQ" tunnelip=N/A tunnelid=1530910786 tunneltype="ipsec" duration=6425 sentbyte=504 rcvdbyte=152 nextstat=0',
    expect: {
      parserId: "fortinet-fortigate",
      vendor: "Fortinet",
      eventName: "vpn.tunnel_down",
      attributes: {
        "syslog.vendor": "Fortinet",
        "vpn.tunnel.name": "to_HQ",
        "network.peer.address": "11.101.1.1",
        "event.message": "IPsec connection status change",
        "fortigate.action": "tunnel-down",
        "fortigate.logid": "0101037138",
      },
    },
  },
  {
    name: "fortigate ipsec tunnel up",
    source: FORTINET_VPN_LOGS,
    kind: "verbatim",
    line: '<189>date=2018-12-06 time=13:43:24 logid="0101037138" type="event" subtype="vpn" level="notice" vd="root" eventtime=1544132604 logdesc="IPsec connection status changed" msg="IPsec connection status change" action="tunnel-up" remip=11.101.1.1 locip=173.1.1.1 remport=500 locport=500 outintf="port13" cookies="5b1c59fab2029e43/bf517e686d3943d2" user="N/A" group="N/A" xauthuser="N/A" xauthgroup="N/A" assignip=11.11.11.1 vpntunnel="to_HQ" tunnelip=N/A tunnelid=1530910918 tunneltype="ipsec" duration=0 sentbyte=0 rcvdbyte=0 nextstat=0',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "vpn.tunnel_up",
      attributes: { "vpn.tunnel.name": "to_HQ" },
    },
  },
  {
    name: "fortigate ipsec negotiation progress is no event",
    source: FORTINET_VPN_LOGS,
    kind: "verbatim",
    line: 'date=2018-12-06 time=13:42:51 logid="0101037127" type="event" subtype="vpn" level="notice" vd="root" eventtime=1544132571 logdesc="Progress IPsec phase 1" msg="progress IPsec phase 1" action="negotiate" remip=11.101.1.1',
    expect: { parserId: "fortinet-fortigate", eventName: null },
  },
  {
    name: "fortigate sd-wan member out of sla",
    source: FORTINET_SDWAN_LOGS,
    kind: "verbatim",
    line: 'date=2021-04-20 time=21:32:33 eventtime=1618979553388751880 tz="-0700" logid="0113022923" type="event" subtype="sdwan" level="notice" vd="root" logdesc="SDWAN status" eventtype="Health Check" healthcheck="test" slatargetid=1 member="1" msg="Member status changed. Member out-of-sla."',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "sdwan.sla_not_met",
      attributes: { "network.gateway.name": "test" },
    },
  },
  {
    name: "fortigate sd-wan member back in sla",
    source: FORTINET_SDWAN_LOGS,
    kind: "verbatim",
    line: 'date=2021-04-20 time=21:38:49 eventtime=1618979929908754060 tz="-0700" logid="0113022923" type="event" subtype="sdwan" level="information" vd="root" logdesc="SDWAN status" eventtype="Health Check" healthcheck="test" slatargetid=1 member="1" msg="Member status changed. Member in sla."',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "sdwan.sla_met",
      attributes: { "network.gateway.name": "test" },
    },
  },
  {
    name: "fortigate sd-wan member link unreachable",
    source: FORTINET_SDWAN_LOGS,
    kind: "verbatim",
    line: 'date=2021-04-20 time=23:04:32 eventtime=1618985072898756700 tz="-0700" logid="0113022923" type="event" subtype="sdwan" level="notice" vd="root" logdesc="SDWAN status" eventtype="Service" interface="R150" member="1" serviceid=1 service="test" gateway=10.100.1.1 msg="Member link is unreachable or miss threshold. Stop forwarding traffic. "',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "gateway.down",
      attributes: { "network.gateway.name": "R150" },
    },
  },
  {
    name: "fortigate sd-wan member link available",
    source: FORTINET_SDWAN_LOGS,
    kind: "verbatim",
    line: 'date=2021-04-20 time=23:06:08 eventtime=1618985168018789600 tz="-0700" logid="0113022923" type="event" subtype="sdwan" level="notice" vd="root" logdesc="SDWAN status" eventtype="Service" interface="R150" member="1" serviceid=1 service="test" gateway=10.100.1.1 msg="Member link is available. Start forwarding traffic. "',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "gateway.up",
      attributes: { "network.gateway.name": "R150" },
    },
  },
  {
    name: "fortigate sd-wan pass-member count is no event",
    source: FORTINET_SDWAN_LOGS,
    kind: "verbatim",
    line: 'date=2021-04-20 time=21:32:33 eventtime=1618979553388763760 tz="-0700" logid="0113022923" type="event" subtype="sdwan" level="notice" vd="root" logdesc="SDWAN status" eventtype="Health Check" healthcheck="test" slatargetid=1 oldvalue="2" newvalue="1" msg="Number of pass member changed."',
    expect: { parserId: "fortinet-fortigate", eventName: null },
  },
  {
    name: "fortigate sd-wan periodic sla report is no event",
    source: FORTINET_SDWAN_LOGS,
    kind: "verbatim",
    line: 'date=2021-04-20 time=23:18:12 eventtime=1618985892509027220 tz="-0700" logid="0113022925" type="event" subtype="sdwan" level="information" vd="root" logdesc="SDWAN SLA information" eventtype="SLA" healthcheck="test" slatargetid=1 interface="R150" status="up" latency="0.060" jitter="0.003" packetloss="0.000%" inbandwidthavailable="0kbps" outbandwidthavailable="200.00Mbps" bibandwidthavailable="200.00Mbps" inbandwidthused="1kbps" outbandwidthused="1kbps" bibandwidthused="2kbps" slamap="0x1" msg="Health Check SLA status."',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: null,
      attributes: { "fortigate.latency": "0.060" },
    },
  },
  {
    name: "fortigate interface down",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0100020099" type="event" subtype="system" level="warning" vd="root" logdesc="Interface status changed" action="interface-stat-change" status="DOWN" msg="Link monitor: Interface port2 was turned down"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "interface.down",
      attributes: { "network.interface.name": "port2" },
      identity: { hostname: "FG100-HQ", serialNumber: "FG100E4Q17000001" },
    },
  },
  {
    name: "fortigate interface up, the same interface back",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:03:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103380 tz="+0000" logid="0100020099" type="event" subtype="system" level="notice" vd="root" logdesc="Interface status changed" action="interface-stat-change" status="UP" msg="Link monitor: Interface port2 was turned up"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "interface.up",
      attributes: { "network.interface.name": "port2" },
    },
  },
  {
    name: "fortigate interface link up, named by its intf field",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:02:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103320 tz="+0000" logid="0100020090" type="event" subtype="system" level="notice" vd="root" logdesc="Interface link status changed" status="up" msg="Interface link status changed" intf="wan1"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "interface.up",
      attributes: { "network.interface.name": "wan1" },
    },
  },
  {
    name: "fortigate admin login failed",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0100032002" type="event" subtype="system" level="alert" vd="root" logdesc="Admin login failed" sn="0" user="admin" ui="ssh(10.1.1.50)" method="ssh" srcip=10.1.1.50 dstip=10.1.1.1 action="login" status="failed" reason="passwd_invalid" msg="Administrator admin login failed from ssh(10.1.1.50) because of invalid password"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "auth.login_failed",
      attributes: { "user.name": "admin", "client.address": "10.1.1.50" },
    },
  },
  {
    name: "fortigate admin login successful",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:30 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103230 tz="+0000" logid="0100032001" type="event" subtype="system" level="information" vd="root" logdesc="Admin login successful" sn="1704103230" user="admin" ui="https(10.1.1.50)" method="https" srcip=10.1.1.50 dstip=10.1.1.1 action="login" status="success" reason="none" profile="super_admin" msg="Administrator admin logged in successfully from https(10.1.1.50)"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "auth.login_success",
      attributes: { "user.name": "admin" },
    },
  },
  {
    name: "fortigate device rebooted",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0100032138" type="event" subtype="system" level="critical" vd="root" logdesc="Device rebooted" ui="https(10.1.1.50)" action="reboot" user="admin" msg="User admin rebooted the device from https(10.1.1.50)."',
    expect: { parserId: "fortinet-fortigate", eventName: "device.reboot" },
  },
  {
    name: "fortigate started",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:03:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103380 tz="+0000" logid="0100032009" type="event" subtype="system" level="information" vd="root" logdesc="FortiGate started" msg="FortiGate started"',
    expect: { parserId: "fortinet-fortigate", eventName: "device.reboot" },
  },
  {
    name: "fortigate configuration changed",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0100032102" type="event" subtype="system" level="alert" vd="root" logdesc="Configuration changed" user="admin" ui="https(10.1.1.50)" msg="Configuration is changed in the admin session"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "device.config_change",
      attributes: { "user.name": "admin" },
    },
  },
  {
    name: "fortigate power supply failed",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0100022105" type="event" subtype="system" level="critical" vd="root" logdesc="Power supply failed" action="power-supply-monitor" status="failure" unit="PS2" msg="Power supply 2 failure"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "hardware.power_supply_failed",
      attributes: { "hw.name": "PS2" },
    },
  },
  {
    name: "fortigate power supply restored",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:05:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103500 tz="+0000" logid="0100022104" type="event" subtype="system" level="critical" vd="root" logdesc="Power supply restored" action="power-supply-monitor" status="success" unit="PS2" msg="Power supply 2 is functioning properly"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "hardware.power_supply_ok",
    },
  },
  {
    name: "fortigate fan anomaly",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0100022108" type="event" subtype="system" level="warning" vd="root" logdesc="Fan anomaly" action="fan-monitor" status="failure" msg="Fan 1 failure"',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "hardware.fan_failed",
    },
  },
  {
    name: "fortigate ha failover",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0108035016" type="event" subtype="ha" level="notice" vd="root" logdesc="HA failover success" msg="HA failover success"',
    expect: { parserId: "fortinet-fortigate", eventName: "ha.failover" },
  },
  {
    name: "fortigate ha cluster member dead",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0108037893" type="event" subtype="ha" level="critical" vd="root" logdesc="Virtual cluster member dead" msg="Virtual cluster detected member dead" vcluster=1 sn="FG100E4Q17000002" ha_group=1',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: "ha.peer_down",
      attributes: { "ha.peer": "FG100E4Q17000002" },
    },
  },
  {
    name: "fortigate traffic log is stored with its fields and is no event",
    source: FORTINET_REFERENCE,
    kind: "composed",
    line: 'date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" eventtime=1704103200 tz="+0000" logid="0000000013" type="traffic" subtype="forward" level="notice" vd="root" srcip=10.1.1.20 srcport=51000 dstip=203.0.113.9 dstport=443 action="close" policyid=5',
    expect: {
      parserId: "fortinet-fortigate",
      eventName: null,
      attributes: { "fortigate.dstport": "443", "fortigate.type": "traffic" },
    },
  },
];

export const CISCO_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "cisco asa interface line protocol up",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<164>%ASA-4-411001: Line protocol on Interface inside, changed state to up",
    expect: {
      parserId: "cisco",
      eventName: "interface.up",
      attributes: {
        "network.interface.name": "inside",
      },
    },
  },
  {
    name: "cisco configuration change in words the pattern does not know",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>71: *Mar  1 00:24:02.123: %SYS-5-CONFIG_I: Configuration applied by the automation service",
    expect: {
      parserId: "cisco",
      eventName: "device.config_change",
    },
  },
  {
    name: "cisco eigrp neighbour up",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>72: *Mar  1 00:25:02.123: %DUAL-5-NBRCHANGE: EIGRP-IPv4 1: Neighbor 10.0.0.2 (GigabitEthernet0/0) is up: new adjacency",
    expect: {
      parserId: "cisco",
      eventName: "routing.neighbor_up",
      attributes: {
        "network.peer.address": "10.0.0.2",
        "network.protocol.name": "eigrp",
      },
    },
  },
  {
    name: "cisco asa login permitted",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: '<166>%ASA-6-605005: Login permitted from 10.1.1.50/4135 to inside:10.1.1.2/ssh for user "admin"',
    expect: {
      parserId: "cisco",
      eventName: "auth.login_success",
      attributes: {
        "user.name": "admin",
        "client.address": "10.1.1.50",
      },
    },
  },
  {
    name: "cisco asa switching to standby",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<161>%ASA-1-104002: (Primary) Switching to STANDBY - Other unit wants me Standby.",
    expect: {
      parserId: "cisco",
      eventName: "ha.state_change",
      attributes: {
        "ha.role": "standby",
      },
    },
  },
  {
    name: "cisco stack member added",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<188>73: *Mar  1 00:26:02.123: %STACKMGR-4-SWITCH_ADDED: Switch 2 has been ADDED to the stack",
    expect: {
      parserId: "cisco",
      eventName: "ha.peer_up",
      attributes: {
        "ha.peer": "Switch 2",
      },
    },
  },
  {
    name: "cisco ios crypto tunnel up",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>75: *Mar  1 00:27:12.123: %CRYPTO-5-SESSION_STATUS: Crypto tunnel is UP.  Peer 203.0.113.2:500       Id: 203.0.113.2",
    expect: {
      parserId: "cisco",
      eventName: "vpn.tunnel_up",
      attributes: {
        "vpn.tunnel.name": "203.0.113.2",
      },
    },
  },
  {
    name: "cisco asa site-to-site phase 2 completed",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<165>%ASA-5-713120: Group = HQ-Branch1, IP = 203.0.113.2, PHASE 2 COMPLETED (msgid=0d2f6a12)",
    expect: {
      parserId: "cisco",
      eventName: "vpn.tunnel_up",
      attributes: {
        "vpn.tunnel.name": "HQ-Branch1",
      },
    },
  },
  {
    name: "cisco spanning tree topology change",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>76: *Mar  1 00:28:02.123: %SPANTREE-5-TOPOTRAP: Topology Change Trap for vlan 10",
    expect: {
      parserId: "cisco",
      eventName: "stp.topology_change",
    },
  },
  {
    name: "cisco catalyst fan tray good again",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<190>77: *Mar  1 00:29:02.123: %C4K_IOSMODPORTMAN-6-FANTRAYGOOD: Fan tray is okay",
    expect: {
      parserId: "cisco",
      eventName: "hardware.fan_ok",
    },
  },
  {
    name: "cisco ios link down, sequence number and unsynchronised clock",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<187>45: *Mar  1 00:01:02.123: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
    expect: {
      parserId: "cisco",
      vendor: "Cisco",
      eventName: "interface.down",
      attributes: {
        "syslog.vendor": "Cisco",
        "network.interface.name": "GigabitEthernet0/1",
        "event.message": "Interface GigabitEthernet0/1, changed state to down",
        "cisco.facility": "LINK",
        "cisco.severity": "3",
        "cisco.mnemonic": "UPDOWN",
      },
      severity: 3,
    },
  },
  {
    name: "cisco ios line protocol up, with a host name",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>Oct 13 10:11:12 core-sw1 46: Oct 13 10:11:11.123 UTC: %LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to up",
    expect: {
      parserId: "cisco",
      eventName: "interface.up",
      attributes: { "network.interface.name": "GigabitEthernet0/1" },
      identity: {},
      headerHostname: "core-sw1",
    },
  },
  {
    name: "cisco ios interface shut by an administrator",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>47: *Mar  1 00:02:02.123: %LINK-5-CHANGED: Interface GigabitEthernet0/2, changed state to administratively down",
    expect: {
      parserId: "cisco",
      eventName: "interface.down",
      attributes: { "network.interface.name": "GigabitEthernet0/2" },
    },
  },
  {
    name: "cisco ios configured from a terminal",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>48: *Mar  1 00:03:02.123: %SYS-5-CONFIG_I: Configured from console by admin on vty0 (10.1.1.50)",
    expect: {
      parserId: "cisco",
      eventName: "device.config_change",
      attributes: { "user.name": "admin", "client.address": "10.1.1.50" },
    },
  },
  {
    name: "cisco nx-os configured from a terminal",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>2026 Oct 13 10:11:12 nexus1 %VSHD-5-VSHD_SYSLOG_CONFIG_I: Configured from vty by admin on 10.1.1.50@pts/0",
    expect: {
      parserId: "cisco",
      eventName: "device.config_change",
      attributes: { "user.name": "admin", "client.address": "10.1.1.50" },
    },
  },
  {
    name: "cisco ios system restarted",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>3: *Mar  1 00:00:42.123: %SYS-5-RESTART: System restarted --",
    expect: { parserId: "cisco", eventName: "device.reboot" },
  },
  {
    name: "cisco ospf neighbour down",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>50: *Mar  1 00:05:02.123: %OSPF-5-ADJCHG: Process 1, Nbr 10.0.0.2 on GigabitEthernet0/0 from FULL to DOWN, Neighbor Down: Dead timer expired",
    expect: {
      parserId: "cisco",
      eventName: "routing.neighbor_down",
      attributes: {
        "network.peer.address": "10.0.0.2",
        "network.interface.name": "GigabitEthernet0/0",
        "network.protocol.name": "ospf",
      },
    },
  },
  {
    name: "cisco ospf neighbour full",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>51: *Mar  1 00:06:02.123: %OSPF-5-ADJCHG: Process 1, Nbr 10.0.0.2 on GigabitEthernet0/0 from LOADING to FULL, Loading Done",
    expect: {
      parserId: "cisco",
      eventName: "routing.neighbor_up",
      attributes: { "network.peer.address": "10.0.0.2" },
    },
  },
  {
    name: "cisco ospf neighbour in an intermediate state is no event",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>52: *Mar  1 00:06:01.123: %OSPF-5-ADJCHG: Process 1, Nbr 10.0.0.2 on GigabitEthernet0/0 from INIT to 2WAY, 2-Way Received",
    expect: { parserId: "cisco", eventName: null },
  },
  {
    name: "cisco bgp neighbour down",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>53: *Mar  1 00:07:02.123: %BGP-5-ADJCHANGE: neighbor 10.0.0.2 Down BGP Notification sent",
    expect: {
      parserId: "cisco",
      eventName: "routing.neighbor_down",
      attributes: {
        "network.peer.address": "10.0.0.2",
        "network.protocol.name": "bgp",
      },
    },
  },
  {
    name: "cisco bgp neighbour of a vrf up",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>54: *Mar  1 00:08:02.123: %BGP-5-ADJCHANGE: neighbor 10.0.0.2 vpn vrf RED Up",
    expect: {
      parserId: "cisco",
      eventName: "routing.neighbor_up",
      attributes: { "network.peer.address": "10.0.0.2" },
    },
  },
  {
    name: "cisco eigrp neighbour down",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>55: *Mar  1 00:09:02.123: %DUAL-5-NBRCHANGE: EIGRP-IPv4 1: Neighbor 10.0.0.2 (GigabitEthernet0/0) is down: holding time expired",
    expect: {
      parserId: "cisco",
      eventName: "routing.neighbor_down",
      attributes: {
        "network.peer.address": "10.0.0.2",
        "network.interface.name": "GigabitEthernet0/0",
        "network.protocol.name": "eigrp",
      },
    },
  },
  {
    name: "cisco ios login failed",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<188>56: *Mar  1 00:10:02.123: %SEC_LOGIN-4-LOGIN_FAILED: Login failed [user: admin] [Source: 10.1.1.50] [localport: 22] [Reason: Login Authentication Failed] at 10:11:12 UTC Tue Oct 13 2026",
    expect: {
      parserId: "cisco",
      eventName: "auth.login_failed",
      attributes: { "user.name": "admin", "client.address": "10.1.1.50" },
    },
  },
  {
    name: "cisco ios login success",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>57: *Mar  1 00:10:12.123: %SEC_LOGIN-5-LOGIN_SUCCESS: Login Success [user: admin] [Source: 10.1.1.50] [localport: 22] at 10:11:22 UTC Tue Oct 13 2026",
    expect: {
      parserId: "cisco",
      eventName: "auth.login_success",
      attributes: { "user.name": "admin" },
    },
  },
  {
    name: "cisco hsrp becomes active",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>58: *Mar  1 00:11:02.123: %HSRP-5-STATECHANGE: GigabitEthernet0/0 Grp 1 state Standby -> Active",
    expect: {
      parserId: "cisco",
      eventName: "ha.failover",
      attributes: {
        "ha.role": "Active",
        "network.interface.name": "GigabitEthernet0/0",
      },
    },
  },
  {
    name: "cisco hsrp falls back to standby",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>59: *Mar  1 00:12:02.123: %HSRP-5-STATECHANGE: GigabitEthernet0/0 Grp 1 state Speak -> Standby",
    expect: {
      parserId: "cisco",
      eventName: "ha.state_change",
      attributes: { "ha.role": "Standby" },
    },
  },
  {
    name: "cisco asa failover to active",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<161>Oct 13 2026 10:11:12 asa-hq : %ASA-1-104001: (Secondary) Switching to ACTIVE - Service card in other unit has failed.",
    expect: {
      parserId: "cisco",
      eventName: "ha.failover",
      attributes: {
        "ha.role": "active",
        "cisco.facility": "ASA",
        "cisco.mnemonic": "104001",
      },
    },
  },
  {
    name: "cisco asa interface line protocol down",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<164>%ASA-4-411002: Line protocol on Interface inside, changed state to down",
    expect: {
      parserId: "cisco",
      eventName: "interface.down",
      attributes: { "network.interface.name": "inside" },
    },
  },
  {
    name: "cisco asa login denied",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: '<166>%ASA-6-605004: Login denied from 10.1.1.50/4135 to inside:10.1.1.2/ssh for user "admin"',
    expect: {
      parserId: "cisco",
      eventName: "auth.login_failed",
      attributes: { "user.name": "admin", "client.address": "10.1.1.50" },
    },
  },
  {
    name: "cisco asa site-to-site session torn down",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<165>%ASA-5-713259: Group = HQ-Branch1, IP = 203.0.113.2, Session is being torn down. Reason: Lost Service",
    expect: {
      parserId: "cisco",
      eventName: "vpn.tunnel_down",
      attributes: { "vpn.tunnel.name": "HQ-Branch1" },
    },
  },
  {
    name: "cisco ios crypto tunnel down",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>60: *Mar  1 00:13:02.123: %CRYPTO-5-SESSION_STATUS: Crypto tunnel is DOWN.  Peer 203.0.113.2:500       Id: 203.0.113.2",
    expect: {
      parserId: "cisco",
      eventName: "vpn.tunnel_down",
      attributes: {
        "vpn.tunnel.name": "203.0.113.2",
        "network.peer.address": "203.0.113.2",
      },
    },
  },
  {
    name: "cisco port err-disabled",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<188>61: *Mar  1 00:14:02.123: %PM-4-ERR_DISABLE: bpduguard error detected on Gi0/1, putting Gi0/1 in err-disable state",
    expect: {
      parserId: "cisco",
      eventName: "interface.error_disabled",
      attributes: { "network.interface.name": "Gi0/1" },
    },
  },
  {
    name: "cisco stack member removed",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<188>62: *Mar  1 00:15:02.123: %STACKMGR-4-SWITCH_REMOVED: Switch 2 has been REMOVED from the stack",
    expect: {
      parserId: "cisco",
      eventName: "ha.peer_down",
      attributes: { "ha.peer": "Switch 2" },
    },
  },
  {
    name: "cisco nx-os interface down",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>2026 Oct 13 10:11:12 nexus1 %ETHPORT-5-IF_DOWN_LINK_FAILURE: Interface Ethernet1/1 is down (Link failure)",
    expect: {
      parserId: "cisco",
      eventName: "interface.down",
      attributes: { "network.interface.name": "Ethernet1/1" },
    },
  },
  {
    name: "cisco nx-os interface up",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>2026 Oct 13 10:12:12 nexus1 %ETHPORT-5-IF_UP: Interface Ethernet1/1 is up in mode trunk",
    expect: {
      parserId: "cisco",
      eventName: "interface.up",
      attributes: { "network.interface.name": "Ethernet1/1" },
    },
  },
  {
    name: "cisco loop guard blocks a port",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<186>63: *Mar  1 00:16:02.123: %SPANTREE-2-LOOPGUARD_BLOCK: Loop guard blocking port Gi0/1 on VLAN0001.",
    expect: {
      parserId: "cisco",
      eventName: "loop.detected",
      attributes: { "network.interface.name": "Gi0/1" },
    },
  },
  {
    name: "cisco poe controller port error",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<187>64: *Mar  1 00:17:02.123: %ILPOWER-3-CONTROLLER_PORT_ERR: Controller port error, Interface Gi1/0/1: Power Controller reports power Tstart error detected",
    expect: {
      parserId: "cisco",
      eventName: "poe.fault",
      attributes: { "network.interface.name": "Gi1/0/1" },
    },
  },
  {
    name: "cisco poe power granted is not a power supply event",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<189>65: *Mar  1 00:18:02.123: %ILPOWER-5-POWER_GRANTED: Interface Gi1/0/1: Power granted",
    expect: { parserId: "cisco", eventName: null },
  },
  {
    name: "cisco catalyst power supply failed",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<188>66: *Mar  1 00:19:02.123: %C4K_IOSMODPORTMAN-4-POWERSUPPLYBAD: Power supply 2 has failed or been turned off",
    expect: {
      parserId: "cisco",
      eventName: "hardware.power_supply_failed",
    },
  },
  {
    name: "cisco catalyst power supply good again",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<190>67: *Mar  1 00:20:02.123: %C4K_IOSMODPORTMAN-6-POWERSUPPLYGOOD: Power supply 2 is okay",
    expect: { parserId: "cisco", eventName: "hardware.power_supply_ok" },
  },
  {
    name: "cisco catalyst fan tray failed",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<188>68: *Mar  1 00:21:02.123: %C4K_IOSMODPORTMAN-4-FANTRAYBAD: Fan tray has failed",
    expect: { parserId: "cisco", eventName: "hardware.fan_failed" },
  },
  {
    name: "cisco port security violation is not a power supply event",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<186>69: *Mar  1 00:22:02.123: %PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address 0011.2233.4455 on port GigabitEthernet0/3.",
    expect: { parserId: "cisco", eventName: null },
  },
  {
    name: "cisco clock update is stored with its mnemonic and is no event",
    source: CISCO_MESSAGES,
    kind: "composed",
    line: "<190>70: *Mar  1 00:23:02.123: %SYS-6-CLOCKUPDATE: System clock has been updated from 00:23:02 UTC to 10:11:12 UTC, configured from console by admin on vty0 (10.1.1.50).",
    expect: {
      parserId: "cisco",
      eventName: null,
      attributes: { "cisco.mnemonic": "CLOCKUPDATE" },
      absent: ["event.name"],
    },
  },
];

export const EXTREME_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "exos ospf neighbour full",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<133>Oct 13 10:18:42 sw-core-1 ospf: <Noti:ospf.neighbor.ChgState> Changing the state of neighbor rtid 10.0.0.2 ipa 192.0.2.2 to state = FULL due to loading done.",
    expect: {
      parserId: "extreme-exos",
      eventName: "routing.neighbor_up",
      attributes: {
        "network.peer.address": "192.0.2.2",
      },
    },
  },
  {
    name: "exos mlag peer active",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<134>Oct 13 10:19:42 sw-core-1 VSM: <Info:VSM.RmtMLAGPeerUp> Peer 2:core-2:: Peer is active",
    expect: {
      parserId: "extreme-exos",
      eventName: "ha.peer_up",
      attributes: {
        "ha.peer": "2:core-2",
      },
    },
  },
  {
    name: "voss spbm adjacency up",
    source: EXTREME_VOSS,
    kind: "composed",
    line: "CP1 [10/13/26 10:24:12.101:UTC] 0x000ec5f3 00000000 GlobalRouter SNMP INFO SPBM detected adj UP on Port1/14, neighbor 0014.c7e1.33df",
    expect: {
      parserId: "extreme-voss",
      eventName: "routing.neighbor_up",
      attributes: {
        "network.interface.name": "1/14",
      },
    },
  },
  {
    name: "voss alarm message is stored with its fields and is no event",
    source: EXTREME_VOSS,
    kind: "composed",
    line: "CP1 [06/10/15 19:27:07.901:EST] 0x00398600 0e600000 DYNAMIC SET GlobalRouter SMTP WARNING SMTP: server 192.0.2.25 is not reachable",
    expect: {
      parserId: "extreme-voss",
      eventName: null,
      attributes: {
        "extreme.module": "SMTP",
        "extreme.severity": "WARNING",
      },
    },
  },
  {
    name: "exos port link down, the syslog target's default format",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<134>Oct 13 10:11:12 vlan: <Info> Port 1:12 link down",
    expect: {
      parserId: "extreme-exos",
      vendor: "Extreme Networks",
      eventName: "interface.down",
      attributes: {
        "syslog.vendor": "Extreme Networks",
        "network.interface.name": "1:12",
        "event.message": "Port 1:12 link down",
        "extreme.severity": "Info",
        "extreme.component": "vlan",
      },
      absent: ["extreme.event"],
      severity: 6,
    },
  },
  {
    name: "exos port link down with a reason, and the event's full name",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<134>Oct 13 10:11:12 sw-core-1 vlan: <Info:vlan.msgs.portLinkStateDown> Port 1:12 link down - Local fault",
    expect: {
      parserId: "extreme-exos",
      eventName: "interface.down",
      attributes: {
        "network.interface.name": "1:12",
        "extreme.event": "vlan.msgs.portLinkStateDown",
        "extreme.component": "vlan",
      },
      identity: {},
      headerHostname: "sw-core-1",
    },
  },
  {
    name: "exos port link up",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<134>Oct 13 10:11:42 sw-core-1 vlan: <Info:vlan.msgs.portLinkStateUp> Port 1:12 link UP at speed 1 Gbps and full-duplex",
    expect: {
      parserId: "extreme-exos",
      eventName: "interface.up",
      attributes: { "network.interface.name": "1:12" },
    },
  },
  {
    name: "exos login failed",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<132>Oct 13 10:12:12 sw-core-1 AAA: <Warn:AAA.authFail> Login failed for user admin through ssh (10.1.1.50)",
    expect: {
      parserId: "extreme-exos",
      eventName: "auth.login_failed",
      attributes: {
        "user.name": "admin",
        "client.address": "10.1.1.50",
        "network.protocol.name": "ssh",
      },
      severity: 4,
    },
  },
  {
    name: "exos login passed",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<134>Oct 13 10:12:22 sw-core-1 AAA: <Info:AAA.authPass> Login passed for user admin through ssh (10.1.1.50)",
    expect: {
      parserId: "extreme-exos",
      eventName: "auth.login_success",
      attributes: { "user.name": "admin" },
    },
  },
  {
    name: "exos rebooting",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<132>Oct 13 10:13:12 sw-core-1 EPM: <Warn:EPM.reboot> Rebooting with reason User requested switch reboot",
    expect: { parserId: "extreme-exos", eventName: "device.reboot" },
  },
  {
    name: "exos booting after a failure",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<132>Oct 13 10:15:12 sw-core-1 EPM: <Warn:EPM.UnexpctRebootDtect> Booting after System Failure.",
    expect: { parserId: "extreme-exos", eventName: "device.reboot" },
  },
  {
    name: "exos fan tray failed",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<131>Oct 13 10:16:12 sw-core-1 HAL: <Erro:HAL.Sys.FanTrayFail> Fan tray 1 has failed",
    expect: {
      parserId: "extreme-exos",
      eventName: "hardware.fan_failed",
      attributes: { "hw.name": "Fan tray 1" },
      severity: 3,
    },
  },
  {
    name: "exos elrp disables a looping port",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<132>Oct 13 10:17:12 sw-core-1 ELRP: <Warn:ELRP.DsblPortLoopDtect> Disabling port 1:2. Port will be disabled permanently",
    expect: {
      parserId: "extreme-exos",
      eventName: "loop.detected",
      attributes: { "network.interface.name": "1:2" },
    },
  },
  {
    name: "exos ospf neighbour down",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<133>Oct 13 10:18:12 sw-core-1 ospf: <Noti:ospf.neighbor.ChgState> Changing the state of neighbor rtid 10.0.0.2 ipa 192.0.2.2 to state = DOWN due to inactivity timer.",
    expect: {
      parserId: "extreme-exos",
      eventName: "routing.neighbor_down",
      attributes: {
        "network.peer.address": "192.0.2.2",
        "network.protocol.name": "ospf",
      },
    },
  },
  {
    name: "exos mlag peer down",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<134>Oct 13 10:19:12 sw-core-1 VSM: <Info:VSM.RmtMLAGPeerDown> Peer 2:core-2:: Peer is down",
    expect: {
      parserId: "extreme-exos",
      eventName: "ha.peer_down",
      attributes: { "ha.peer": "2:core-2" },
    },
  },
  {
    name: "exos poe port fault",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<131>Oct 13 10:20:12 sw-core-1 POE: <Erro:POE.port_fault> Port 1:5 has encountered a fault condition",
    expect: {
      parserId: "extreme-exos",
      eventName: "poe.fault",
      attributes: { "network.interface.name": "1:5" },
    },
  },
  {
    name: "exos temperature warning",
    source: EXTREME_EMS,
    kind: "composed",
    line: "<132>Oct 13 10:21:12 sw-core-1 HAL: <Warn:HAL.Sys.TempWarning> MSM-A Chassis air intake temperature 45C. System shutdown may occur if corrective action is not taken.  System shutdown will happen at 50C.",
    expect: {
      parserId: "extreme-exos",
      eventName: "hardware.temperature_high",
    },
  },
  {
    name: "exos sntp message is stored and is no event",
    source: EXTREME_EMS,
    kind: "verbatim",
    line: "May 29 12:17:20.11 SNTP: <Warn:SNTP.RslvSrvrFail> tSntpc: (sntpcLib.c:606) The SNTP server parameter value (TheWrongServer.example.com) can not be resolved.",
    expect: {
      parserId: "extreme-exos",
      eventName: null,
      attributes: { "extreme.event": "SNTP.RslvSrvrFail" },
    },
  },
  {
    name: "voss link down",
    source: EXTREME_VOSS,
    kind: "verbatim",
    line: "CP1 [03/18/70 09:55:35.890] 0x0000c5e7 00300001.238 DYNAMIC SET GlobalRouter HW INFO Link Down(1/47)",
    expect: {
      parserId: "extreme-voss",
      vendor: "Extreme Networks",
      eventName: "interface.down",
      attributes: {
        "network.interface.name": "1/47",
        "extreme.slot": "CP1",
        "extreme.event_code": "0x0000c5e7",
        "extreme.vrf": "GlobalRouter",
        "extreme.module": "HW",
        "extreme.severity": "INFO",
      },
      severity: 6,
    },
  },
  {
    name: "voss link up, behind a syslog header",
    source: EXTREME_VOSS,
    kind: "composed",
    line: "<134>Oct 13 10:22:12 vsp-1 CP1 [10/13/26 10:22:12.101:UTC] 0x0000c5ec 00300001.238 DYNAMIC CLEAR GlobalRouter HW INFO Link Up(1/47)",
    expect: {
      parserId: "extreme-voss",
      eventName: "interface.up",
      attributes: { "network.interface.name": "1/47" },
    },
  },
  {
    name: "voss spbm adjacency down",
    source: EXTREME_VOSS,
    kind: "composed",
    line: "CP1 [10/13/26 10:23:12.101:UTC] 0x000ec5f2 00000000 GlobalRouter SNMP INFO SPBM detected adj DOWN on Port1/14, neighbor 0014.c7e1.33df",
    expect: {
      parserId: "extreme-voss",
      eventName: "routing.neighbor_down",
      attributes: {
        "network.interface.name": "1/14",
        "network.protocol.name": "isis",
      },
    },
  },
];

export const ARUBA_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "aos-cx fan ok again",
    source: ARUBA_AOS_CX,
    kind: "composed",
    line: "<190>1 2020-12-14T20:05:13.700108+00:00 Leaf2A-RU21 fand 790 - - Event|216|LOG_INFO|AMM|1/1|Status of fan 1/1/2 has changed from fault to ok",
    expect: {
      parserId: "aruba-aos-cx",
      eventName: "hardware.fan_ok",
      attributes: {
        "hw.name": "fan 1/1/2",
      },
    },
  },
  {
    name: "aos-cx link up, as the switch's log prints it",
    source: ARUBA_AOS_CX,
    kind: "verbatim",
    line: "2020-12-14T19:57:13.700108+00:00 Leaf2A-RU21 intfd[1733]: Event|403|LOG_INFO|AMM|1/1|Link status for interface 1/1/49 is up",
    expect: {
      parserId: "aruba-aos-cx",
      vendor: "HPE Aruba Networking",
      eventName: "interface.up",
      attributes: {
        "syslog.vendor": "HPE Aruba Networking",
        "network.interface.name": "1/1/49",
        "event.message": "Link status for interface 1/1/49 is up",
        "aruba.event_id": "403",
        "aruba.severity": "INFO",
        "aruba.role": "AMM",
        "aruba.slot": "1/1",
      },
      severity: 6,
    },
  },
  {
    name: "aos-cx link down, as rfc 5424",
    source: ARUBA_AOS_CX,
    kind: "composed",
    line: "<190>1 2020-12-14T19:58:13.700108+00:00 Leaf2A-RU21 intfd 1733 - - Event|404|LOG_INFO|AMM|1/1|Link status for interface 1/1/49 is down",
    expect: {
      parserId: "aruba-aos-cx",
      eventName: "interface.down",
      attributes: { "network.interface.name": "1/1/49" },
      identity: {},
      headerHostname: "Leaf2A-RU21",
    },
  },
  {
    name: "aos-cx power supply fault",
    source: ARUBA_AOS_CX,
    kind: "composed",
    line: "<187>1 2020-12-14T19:59:13.700108+00:00 Leaf2A-RU21 powerd 801 - - Event|301|LOG_ERR|AMM|1/1|PSU 1/2 changed state to fault_input",
    expect: {
      parserId: "aruba-aos-cx",
      eventName: "hardware.power_supply_failed",
      attributes: { "hw.name": "PSU 1/2" },
      severity: 3,
    },
  },
  {
    name: "aos-cx power supply ok",
    source: ARUBA_AOS_CX,
    kind: "composed",
    line: "<190>1 2020-12-14T20:01:13.700108+00:00 Leaf2A-RU21 powerd 801 - - Event|301|LOG_INFO|AMM|1/1|PSU 1/2 changed state to ok",
    expect: {
      parserId: "aruba-aos-cx",
      eventName: "hardware.power_supply_ok",
      attributes: { "hw.name": "PSU 1/2" },
    },
  },
  {
    name: "aos-cx fan fault",
    source: ARUBA_AOS_CX,
    kind: "composed",
    line: "<187>1 2020-12-14T20:02:13.700108+00:00 Leaf2A-RU21 fand 790 - - Event|216|LOG_ERR|AMM|1/1|Status of fan 1/1/2 has changed from ok to fault",
    expect: {
      parserId: "aruba-aos-cx",
      eventName: "hardware.fan_failed",
      attributes: { "hw.name": "fan 1/1/2" },
    },
  },
  {
    name: "aos-cx another event is stored with its id and is no event",
    source: ARUBA_AOS_CX,
    kind: "composed",
    line: "<190>1 2020-12-14T20:03:13.700108+00:00 Leaf2A-RU21 lldpd 911 - - Event|109|LOG_INFO|AMM|1/1|LLDP neighbor 70:72:cf:aa:bb:cc added on 1/1/49",
    expect: {
      parserId: "aruba-aos-cx",
      eventName: null,
      attributes: { "aruba.event_id": "109" },
    },
  },
  {
    name: "aos-switch port off-line, as the event log prints it",
    source: ARUBA_AOS_SWITCH,
    kind: "verbatim",
    line: "I 01/07/90 20:22:33 00077 ports: port 3 is now off-line",
    expect: {
      parserId: "aruba-aos-switch",
      vendor: "HPE Aruba Networking",
      eventName: "interface.down",
      attributes: {
        "network.interface.name": "3",
        "aruba.event_id": "00077",
        "aruba.module": "ports",
        "event.message": "port 3 is now off-line",
      },
    },
  },
  {
    name: "aos-switch port on-line, behind a syslog header",
    source: ARUBA_AOS_SWITCH,
    kind: "composed",
    line: "<14>Jan  7 20:22:55 10.1.1.5 00076 ports: port 3 is now on-line",
    expect: {
      parserId: "aruba-aos-switch",
      eventName: "interface.up",
      attributes: { "network.interface.name": "3" },
    },
  },
  {
    name: "aos-switch spanning tree message is stored with its number and is no event",
    source: ARUBA_AOS_SWITCH,
    kind: "composed",
    line: "<12>Jan  7 20:23:10 10.1.1.5 00435 ports: port 3 is Blocked by STP",
    expect: {
      parserId: "aruba-aos-switch",
      eventName: null,
      attributes: { "aruba.event_id": "00435", "aruba.module": "ports" },
    },
  },
  {
    name: "aos-switch without the event number, read for a known hpe device",
    source: ARUBA_AOS_SWITCH,
    kind: "composed",
    line: "<14>Jan  7 20:22:33 10.1.1.5 ports: port A12 is now off-line",
    deviceVendor: "HPE ProCurve",
    expect: {
      parserId: "aruba-aos-switch",
      eventName: "interface.down",
      attributes: { "network.interface.name": "A12" },
    },
  },
];

export const MIKROTIK_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "routeros login failure, default format: topics and no priority",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "system,error,critical login failure for user guest from 192.168.88.17 via ssh",
    expect: {
      parserId: "mikrotik-routeros",
      vendor: "MikroTik",
      eventName: "auth.login_failed",
      attributes: {
        "syslog.vendor": "MikroTik",
        "user.name": "guest",
        "client.address": "192.168.88.17",
        "network.protocol.name": "ssh",
        "event.message":
          "login failure for user guest from 192.168.88.17 via ssh",
        "mikrotik.topics": "system,error,critical",
      },
      severity: 3,
    },
  },
  {
    name: "routeros login failure, cef format",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "Oct  2 17:36:35 MikroTik CEF:0|MikroTik|hAP ax^2|7.25beta5|10|system,error,critical|High|dvchost=MikroTik dvc=192.168.88.36 msg=login failure for user guest from 192.168.88.17 via ssh app=ssh duser=guest outcome=failure src=192.168.88.17",
    expect: {
      parserId: "mikrotik-routeros",
      vendor: "MikroTik",
      eventName: "auth.login_failed",
      attributes: {
        "user.name": "guest",
        "client.address": "192.168.88.17",
        "mikrotik.topics": "system,error,critical",
        "cef.vendor": "MikroTik",
        "cef.product": "hAP ax^2",
        "cef.device_version": "7.25beta5",
        "cef.event_class_id": "10",
        "cef.severity": "High",
        "cef.dvc": "192.168.88.36",
        "cef.duser": "guest",
        "cef.outcome": "failure",
      },
      identity: { hostname: "MikroTik", ipAddress: "192.168.88.36" },
      headerHostname: "MikroTik",
      severity: 3,
    },
  },
  {
    name: "routeros login failure, syslog format, for a known mikrotik device",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "<27>Oct  2 17:36:35 MikroTik login failure for user guest from 192.168.88.17 via ssh",
    deviceVendor: "MikroTik",
    expect: {
      parserId: "mikrotik-routeros",
      eventName: "auth.login_failed",
      attributes: { "user.name": "guest" },
      absent: ["mikrotik.topics"],
    },
  },
  {
    name: "routeros login failure for a user name with spaces and the word from",
    source: MIKROTIK_LOG,
    kind: "composed",
    line: "system,error,critical login failure for user guest from the lab from 192.168.88.17 via ssh",
    expect: {
      parserId: "mikrotik-routeros",
      eventName: "auth.login_failed",
      attributes: {
        "user.name": "guest from the lab",
        "client.address": "192.168.88.17",
      },
    },
  },
  {
    name: "routeros user logged in",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "system,info,account user admin logged in from 10.1.101.212 via winbox",
    expect: {
      parserId: "mikrotik-routeros",
      eventName: "auth.login_success",
      attributes: {
        "user.name": "admin",
        "client.address": "10.1.101.212",
        "network.protocol.name": "winbox",
      },
      severity: 6,
    },
  },
  {
    name: "routeros user logged out is no event",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "system,info,account user admin logged out from 10.1.101.212 via telnet",
    expect: { parserId: "mikrotik-routeros", eventName: null },
  },
  {
    name: "routeros interface link up",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "interface,info ether2 link up (speed 1G, full duplex)",
    expect: {
      parserId: "mikrotik-routeros",
      eventName: "interface.up",
      attributes: { "network.interface.name": "ether2" },
    },
  },
  {
    name: "routeros interface link down",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "interface,info ether1 link down",
    expect: {
      parserId: "mikrotik-routeros",
      eventName: "interface.down",
      attributes: { "network.interface.name": "ether1" },
    },
  },
  {
    name: "routeros interface link down, the same interface as the link up",
    source: MIKROTIK_LOG,
    kind: "composed",
    line: "interface,info ether2 link down",
    expect: {
      parserId: "mikrotik-routeros",
      eventName: "interface.down",
      attributes: { "network.interface.name": "ether2" },
    },
  },
  {
    name: "routeros router rebooted",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "system,info router rebooted",
    expect: { parserId: "mikrotik-routeros", eventName: "device.reboot" },
  },
  {
    name: "routeros configuration changed",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "system,info mangle rule changed by admin",
    expect: {
      parserId: "mikrotik-routeros",
      eventName: "device.config_change",
      attributes: { "user.name": "admin" },
    },
  },
  {
    name: "routeros firewall log is stored with its topics and is no event",
    source: MIKROTIK_LOG,
    kind: "composed",
    line: "firewall,info input: in:ether1 out:(none), src-mac 00:21:29:6d:82:07, proto UDP, 10.5.101.1:520->10.5.101.255:520, len 132",
    expect: {
      parserId: "mikrotik-routeros",
      eventName: null,
      attributes: { "mikrotik.topics": "firewall,info" },
    },
  },
];

export const CAMBIUM_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "cambium tunnel up",
    source: CAMBIUM_EVENTS,
    kind: "composed",
    line: "<13>May 23 21:23:20 E400-AABBCC NETWORK-5-TUNNEL-UP Tunnel on interface[gre0] is up and running",
    expect: {
      parserId: "cambium-enterprise-wifi",
      eventName: "vpn.tunnel_up",
      attributes: {
        "vpn.tunnel.name": "gre0",
      },
    },
  },
  {
    name: "cambium wi-fi client connected, the event as the access point writes it",
    source: CAMBIUM_EVENTS,
    kind: "verbatim",
    line: "<14>May 23 21:15:20 WIFI-6-CLIENT-CONNECTED Client [00-24-D7-AB-FB-3C] connected to wireless lan [camb]",
    expect: {
      parserId: "cambium-enterprise-wifi",
      vendor: "Cambium Networks",
      eventName: "wireless.client_connected",
      attributes: {
        "client.mac": "00-24-D7-AB-FB-3C",
        "wifi.ssid": "camb",
        "cambium.module": "WIFI",
        "cambium.severity": "6",
        "cambium.event": "CLIENT-CONNECTED",
        "event.message":
          "Client [00-24-D7-AB-FB-3C] connected to wireless lan [camb]",
      },
      // The mnemonic stands where a host name would: it names no device.
      identity: {},
      headerHostname: null,
      severity: 6,
    },
  },
  {
    name: "cambium invalid pre-shared key, the event as the access point writes it",
    source: CAMBIUM_EVENTS,
    kind: "verbatim",
    line: "May 23 21:15:19 WIFI-6-CLIENT-WPA2-INVALID-PSK Client [00-24-D7-AB-FB-3C] failed handshake on wireless lan [camb] due to invalid pre-shared key",
    expect: {
      parserId: "cambium-enterprise-wifi",
      eventName: null,
      attributes: { "cambium.event": "CLIENT-WPA2-INVALID-PSK" },
      identity: {},
      headerHostname: null,
    },
  },
  {
    name: "cambium wi-fi client connected, with the access point's host name",
    source: CAMBIUM_EVENTS,
    kind: "composed",
    line: "<14>May 23 21:15:20 E400-AABBCC WIFI-6-CLIENT-CONNECTED Client [00-24-D7-AB-FB-3C] connected to wireless lan [camb]",
    expect: {
      parserId: "cambium-enterprise-wifi",
      vendor: "Cambium Networks",
      eventName: "wireless.client_connected",
      attributes: {
        "syslog.vendor": "Cambium Networks",
        "client.mac": "00-24-D7-AB-FB-3C",
        "wifi.ssid": "camb",
        "cambium.module": "WIFI",
        "cambium.severity": "6",
        "cambium.event": "CLIENT-CONNECTED",
      },
      identity: {},
      headerHostname: "E400-AABBCC",
      severity: 6,
    },
  },
  {
    name: "cambium wi-fi client disconnected",
    source: CAMBIUM_EVENTS,
    kind: "composed",
    line: "<14>May 23 21:15:20 E400-AABBCC WIFI-6-CLIENT-DISCONNECTED Client [00-24-D7-AB-FB-3C] disconnected from wireless lan [camb]",
    expect: {
      parserId: "cambium-enterprise-wifi",
      eventName: "wireless.client_disconnected",
      attributes: { "client.mac": "00-24-D7-AB-FB-3C", "wifi.ssid": "camb" },
    },
  },
  {
    name: "cambium wi-fi client disconnected, with its age and usage",
    source: CAMBIUM_EVENTS,
    kind: "composed",
    line: "<14>May 23 21:16:20 E400-AABBCC WIFI-6-CLIENT-DISCONNECTED Client [00-24-D7-AB-FB-3C] disconnected from WLAN [camb], after 60 secs and used 20480 bytes",
    expect: {
      parserId: "cambium-enterprise-wifi",
      eventName: "wireless.client_disconnected",
      attributes: { "wifi.ssid": "camb" },
    },
  },
  {
    name: "cambium invalid pre-shared key is stored and is no event",
    source: CAMBIUM_EVENTS,
    kind: "composed",
    line: "<12>May 23 21:15:19 E400-AABBCC WIFI-6-CLIENT-WPA2-INVALID-PSK Client [00-24-D7-AB-FB-3C] failed handshake on wireless lan [camb] due to invalid pre-shared key",
    expect: {
      parserId: "cambium-enterprise-wifi",
      eventName: null,
      attributes: { "cambium.event": "CLIENT-WPA2-INVALID-PSK" },
    },
  },
  {
    name: "cambium rebooted by its watchdog",
    source: CAMBIUM_EVENTS,
    kind: "composed",
    line: "<11>May 23 21:20:20 E400-AABBCC SYSTEM-3-WATCHDOG-RESET System rebooted due to watchdog reset",
    expect: {
      parserId: "cambium-enterprise-wifi",
      eventName: "device.reboot",
    },
  },
  {
    name: "cambium configuration applied",
    source: CAMBIUM_EVENTS,
    kind: "composed",
    line: "<13>May 23 21:21:20 E400-AABBCC SYSTEM-5-CONFIG-APPLIED System configuration change applied",
    expect: {
      parserId: "cambium-enterprise-wifi",
      eventName: "device.config_change",
    },
  },
  {
    name: "cambium tunnel went down",
    source: CAMBIUM_EVENTS,
    kind: "composed",
    line: "<12>May 23 21:22:20 E400-AABBCC NETWORK-4-TUNNEL-DOWN Tunnel on interface[gre0] went down",
    expect: {
      parserId: "cambium-enterprise-wifi",
      eventName: "vpn.tunnel_down",
      attributes: { "vpn.tunnel.name": "gre0" },
    },
  },
  {
    name: "cambium event text without its mnemonic, for a known cambium device",
    source: CAMBIUM_EVENTS,
    kind: "composed",
    line: "<14>May 23 21:15:20 E400-AABBCC Client [00-24-D7-AB-FB-3C] connected to wireless lan [camb]",
    deviceVendor: "Cambium Networks",
    expect: {
      parserId: "cambium-enterprise-wifi",
      eventName: "wireless.client_connected",
      attributes: { "client.mac": "00-24-D7-AB-FB-3C" },
    },
  },
];

export const UNIFI_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "unifi wi-fi client connected, named for the access point it joined",
    source: UNIFI_SIEM,
    kind: "composed",
    line: "CEF:0|Ubiquiti|UniFi Network|9.3.33|400|WiFi Client Connected|2|UNIFIcategory=Monitoring UNIFIsubCategory=WiFi UNIFIhost=Office UDM Pro UNIFIconnectedToDeviceName=Lobby AP UNIFIconnectedToDeviceIp=192.168.100.5 UNIFIconnectedToDeviceMac=d8:b3:70:fb:fc:dd UNIFIclientAlias=Apple Watch 0d:87 UNIFIclientMac=0a:be:db:c8:0d:81 UNIFIwifiName=Employee WiFi msg=Apple Watch 0d:87 connected to Employee WiFi on Lobby AP.",
    expect: {
      parserId: "ubiquiti-unifi",
      eventName: "wireless.client_connected",
      attributes: {
        "client.mac": "0a:be:db:c8:0d:81",
        "wifi.ssid": "Employee WiFi",
      },
    },
  },
  {
    name: "unifi admin accessed the network application",
    source: UNIFI_SIEM,
    kind: "verbatim",
    line: "CEF:0|Ubiquiti|UniFi Network|9.3.33|544|Admin Accessed UniFi Network|1|UNIFIcategory=System UNIFIsubCategory=Admin UNIFIhost=Office UDM Pro UNIFIaccessMethod=web UNIFIadmin=Craig src=105.5.138.59 msg=Craig accessed UniFi Network using the web. Source IP: 105.5.138.59",
    expect: {
      parserId: "ubiquiti-unifi",
      vendor: "Ubiquiti",
      eventName: "auth.login_success",
      attributes: {
        "syslog.vendor": "Ubiquiti",
        "syslog.parser": "ubiquiti-unifi",
        "user.name": "Craig",
        "client.address": "105.5.138.59",
        "network.protocol.name": "web",
        "event.message":
          "Craig accessed UniFi Network using the web. Source IP: 105.5.138.59",
        "cef.vendor": "Ubiquiti",
        "cef.product": "UniFi Network",
        "cef.device_version": "9.3.33",
        "cef.event_class_id": "544",
        "cef.name": "Admin Accessed UniFi Network",
        "cef.severity": "1",
        "cef.UNIFIcategory": "System",
        "cef.UNIFIsubCategory": "Admin",
        "cef.UNIFIhost": "Office UDM Pro",
        "cef.src": "105.5.138.59",
      },
      severity: 6,
    },
  },
  {
    name: "unifi wi-fi client disconnected, named for the access point it was on",
    source: UNIFI_SIEM,
    kind: "verbatim",
    line: "<14>Oct 13 10:11:12 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|401|WiFi Client Disconnected|2|UNIFIcategory=Monitoring UNIFIsubCategory=WiFi UNIFIhost=Office UDM Pro UNIFIlastConnectedToDeviceName=Lobby AP UNIFIlastConnectedToDeviceIp=192.168.100.5 UNIFIlastConnectedToDeviceMac=d8:b3:70:fb:fc:dd UNIFIlastConnectedToDeviceModel=U7-Pro UNIFIlastConnectedToDeviceVersion=8.0.9 UNIFIclientAlias=Apple Watch 0d:87 UNIFIclientHostname=Craig Watch UNIFIclientIp=192.168.10.178 UNIFIclientMac=0a:be:db:c8:0d:81 UNIFIwifiChannel=153 UNIFIwifiChannelWidth=20 UNIFIwifiName=Employee WiFi UNIFIwifiBand=na UNIFIwifiAirtimeUtilization=14 UNIFIwifiInterference=9 UNIFIlastConnectedToWiFiRssi=-77 UNIFIduration=6m 22s UNIFIusageDown=11.78 KB UNIFIusageUp=4.46 KB UNIFInetworkName=Employee Network UNIFInetworkSubnet=192.168.10.0/24 UNIFInetworkVlan=10 msg=Apple Watch 0d:87 disconnected from Employee WiFi. Time Connected: 6m 22s. Data Used: 4.46 KB (up) / 11.78 KB (down). Last Connected To: Lobby AP at -77 dBm.",
    expect: {
      parserId: "ubiquiti-unifi",
      eventName: "wireless.client_disconnected",
      attributes: {
        "client.mac": "0a:be:db:c8:0d:81",
        "wifi.ssid": "Employee WiFi",
        "cef.UNIFIclientAlias": "Apple Watch 0d:87",
        "cef.UNIFIduration": "6m 22s",
        "cef.UNIFIusageDown": "11.78 KB",
        "cef.UNIFInetworkSubnet": "192.168.10.0/24",
      },
      // The access point the client was on, not the console that says so.
      identity: {
        hostname: "Lobby AP",
        macAddress: "d8:b3:70:fb:fc:dd",
        ipAddress: "192.168.100.5",
        managedDevice: true,
      },
      headerHostname: "udm-pro",
    },
  },
  {
    name: "unifi device offline, named for the device itself",
    source: UNIFI_SIEM,
    kind: "composed",
    line: "<12>Oct 13 10:12:12 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|3|Device Offline|5|UNIFIcategory=System UNIFIsubCategory=Devices UNIFIhost=Office UDM Pro UNIFIdeviceName=Warehouse Switch UNIFIdeviceIp=192.168.100.9 UNIFIdeviceMac=f4:e2:c6:aa:bb:cc UNIFIdeviceModel=USW-24-PoE UNIFIdeviceVersion=7.1.26 msg=Warehouse Switch went offline.",
    expect: {
      parserId: "ubiquiti-unifi",
      eventName: "device.offline",
      attributes: { "event.message": "Warehouse Switch went offline." },
      identity: {
        hostname: "Warehouse Switch",
        macAddress: "f4:e2:c6:aa:bb:cc",
        ipAddress: "192.168.100.9",
        managedDevice: true,
      },
      headerHostname: "udm-pro",
      severity: 4,
    },
  },
  {
    name: "unifi wan failover",
    source: UNIFI_SIEM,
    kind: "composed",
    line: "CEF:0|Ubiquiti|UniFi Network|9.3.33|50|WAN Failover|6|UNIFIcategory=Internet UNIFIsubCategory=Outage & Failover UNIFIhost=Office UDM Pro UNIFIfailoverWanName=Backup LTE UNIFIfailoverWanIsp=Example Mobile msg=Internet failed over to Backup LTE.",
    expect: {
      parserId: "ubiquiti-unifi",
      eventName: "wan.failover",
      attributes: { "network.gateway.name": "Backup LTE" },
    },
  },
  {
    name: "unifi admin made configuration changes",
    source: UNIFI_SIEM,
    kind: "composed",
    line: "CEF:0|Ubiquiti|UniFi Network|9.3.33|545|Admin Made Config Changes|1|UNIFIcategory=System UNIFIsubCategory=Admin UNIFIhost=Office UDM Pro UNIFIadmin=Craig src=105.5.138.59 msg=Craig made 2 changes to WiFi settings.",
    expect: {
      parserId: "ubiquiti-unifi",
      eventName: "device.config_change",
      attributes: { "user.name": "Craig" },
    },
  },
  {
    name: "unifi access point underpowered",
    source: UNIFI_SIEM,
    kind: "composed",
    line: "CEF:0|Ubiquiti|UniFi Network|9.3.33|210|AP Underpowered|4|UNIFIcategory=Power UNIFIsubCategory=PoE UNIFIhost=Office UDM Pro UNIFIdeviceName=Lobby AP UNIFIdeviceMac=d8:b3:70:fb:fc:dd UNIFIdevicePort=7 msg=Lobby AP is underpowered.",
    expect: {
      parserId: "ubiquiti-unifi",
      eventName: "poe.fault",
      attributes: { "network.interface.name": "7" },
      identity: {
        hostname: "Lobby AP",
        macAddress: "d8:b3:70:fb:fc:dd",
        managedDevice: true,
      },
    },
  },
  {
    name: "unifi event the help article does not list is stored with its fields",
    source: UNIFI_SIEM,
    kind: "composed",
    line: "CEF:0|Ubiquiti|UniFi Network|9.3.33|402|WiFi Client Roaming|2|UNIFIcategory=Monitoring UNIFIsubCategory=WiFi UNIFIhost=Office UDM Pro UNIFIclientMac=0a:be:db:c8:0d:81 msg=Apple Watch 0d:87 roamed.",
    expect: {
      parserId: "ubiquiti-unifi",
      eventName: null,
      attributes: { "cef.name": "WiFi Client Roaming" },
      absent: ["event.name"],
    },
  },
];

export const LINUX_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "openssh failed password for an invalid user",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<38>Oct 13 10:11:12 ap-lobby sshd[4321]: Failed password for invalid user admin from 192.0.2.10 port 51234 ssh2",
    expect: {
      parserId: "linux",
      vendor: null,
      eventName: "auth.login_failed",
      attributes: {
        "syslog.parser": "linux",
        "user.name": "admin",
        "client.address": "192.0.2.10",
        "network.protocol.name": "ssh",
      },
      absent: ["syslog.vendor"],
      identity: {},
      headerHostname: "ap-lobby",
    },
  },
  {
    name: "openssh accepted public key",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<38>Oct 13 10:11:22 ap-lobby sshd[4321]: Accepted publickey for admin from 192.0.2.10 port 51234 ssh2: RSA SHA256:AbCdEf",
    expect: {
      parserId: "linux",
      eventName: "auth.login_success",
      attributes: { "user.name": "admin", "client.address": "192.0.2.10" },
    },
  },
  {
    name: "dropbear bad password",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<36>Oct 13 10:12:12 ap-lobby dropbear[4321]: Bad password attempt for 'admin' from 192.0.2.10:51234",
    expect: {
      parserId: "linux",
      eventName: "auth.login_failed",
      attributes: { "user.name": "admin", "client.address": "192.0.2.10" },
    },
  },
  {
    name: "dropbear password accepted",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<38>Oct 13 10:12:22 ap-lobby dropbear[4321]: Password auth succeeded for 'admin' from 192.0.2.10:51234",
    expect: {
      parserId: "linux",
      eventName: "auth.login_success",
      attributes: { "user.name": "admin", "client.address": "192.0.2.10" },
    },
  },
  {
    name: "hostapd station associated",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<30>Oct 13 10:13:12 ap-lobby hostapd: wlan0: STA 00:11:22:33:44:55 IEEE 802.11: associated",
    expect: {
      parserId: "linux",
      eventName: "wireless.client_connected",
      attributes: { "client.mac": "00:11:22:33:44:55" },
    },
  },
  {
    name: "hostapd station disassociated",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<30>Oct 13 10:14:12 ap-lobby hostapd: wlan0: STA 00:11:22:33:44:55 IEEE 802.11: disassociated",
    expect: {
      parserId: "linux",
      eventName: "wireless.client_disconnected",
      attributes: { "client.mac": "00:11:22:33:44:55" },
    },
  },
  {
    name: "kernel network driver link down",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<6>Oct 13 10:15:12 gw-1 kernel: [1234.567890] e1000e: eth0 NIC Link is Down",
    expect: {
      parserId: "linux",
      eventName: "interface.down",
      attributes: {
        "network.interface.name": "eth0",
        "event.message": "e1000e: eth0 NIC Link is Down",
      },
    },
  },
  {
    name: "kernel network driver link up",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<6>Oct 13 10:15:42 gw-1 kernel: [1264.567890] r8169 0000:02:00.0 eth1: Link is Up - 1Gbps/Full - flow control rx/tx",
    expect: {
      parserId: "linux",
      eventName: "interface.up",
      attributes: { "network.interface.name": "eth1" },
    },
  },
  {
    name: "kernel network driver link up, the same interface back",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<6>Oct 13 10:15:22 gw-1 kernel: [1244.567890] e1000e: eth0 NIC Link is Up 1000 Mbps Full Duplex, Flow Control: Rx/Tx",
    expect: {
      parserId: "linux",
      eventName: "interface.up",
      attributes: { "network.interface.name": "eth0" },
    },
  },
  {
    name: "sshd named in the rfc 5424 header, not in the text",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<38>1 2026-10-13T10:16:12.003Z ap-lobby sshd 4321 - - Failed password for root from 192.0.2.10 port 51234 ssh2",
    expect: {
      parserId: "linux",
      eventName: "auth.login_failed",
      attributes: { "user.name": "root" },
    },
  },
  {
    name: "a kernel line that is not about a link is no event",
    source: LINUX_PROGRAMS,
    kind: "composed",
    line: "<6>Oct 13 10:17:12 gw-1 kernel: [1354.567890] br0: port 1(eth0) entered forwarding state",
    expect: { parserId: "linux", eventName: null },
  },
];

export const CEF_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "cef from a product with no parser of its own",
    source: CEF_STANDARD,
    kind: "verbatim",
    line: "Sep 19 08:26:10 host CEF:0|Security|threatmanager|1.0|100|worm successfully stopped|10|src=10.0.0.1 dst=2.1.2.2 spt=1232",
    expect: {
      parserId: "cef",
      vendor: "Security",
      eventName: null,
      attributes: {
        "syslog.parser": "cef",
        "syslog.vendor": "Security",
        "cef.vendor": "Security",
        "cef.product": "threatmanager",
        "cef.device_version": "1.0",
        "cef.event_class_id": "100",
        "cef.name": "worm successfully stopped",
        "cef.severity": "10",
        "cef.src": "10.0.0.1",
        "cef.dst": "2.1.2.2",
        "cef.spt": "1232",
      },
      absent: ["event.name"],
      identity: {},
      headerHostname: "host",
      severity: 2,
    },
  },
  {
    name: "cef that names the device it is about",
    source: CEF_STANDARD,
    kind: "composed",
    line: "<134>CEF:0|Example|Controller|2.0|77|Port Flapping|5|dvchost=sw-floor-2 dvc=10.20.0.7 dvcmac=00:0A:95:9D:68:16 deviceExternalId=SN12345 msg=Port 3 is flapping",
    expect: {
      parserId: "cef",
      vendor: "Example",
      eventName: null,
      identity: {
        hostname: "sw-floor-2",
        ipAddress: "10.20.0.7",
        macAddress: "00:0A:95:9D:68:16",
        serialNumber: "SN12345",
      },
      severity: 4,
    },
  },
];

// Lines no parser claims: stored as they came, with nothing added.
export const UNRECOGNIZED_SAMPLES: Array<SyslogVendorSample> = [
  {
    name: "a plain rfc 3164 line from a server",
    source: "RFC 3164, The BSD syslog Protocol, section 5.4, example 1",
    kind: "verbatim",
    line: "<34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick on /dev/pts/8",
    expect: {
      parserId: null,
      eventName: null,
      identity: {},
      headerHostname: "mymachine",
    },
  },
  {
    name: "a plain rfc 5424 line from an application",
    source: "RFC 5424, The Syslog Protocol, section 6.5, example 3",
    kind: "verbatim",
    line: '<165>1 2003-10-11T22:14:15.003Z mymachine.example.com evntslog - ID47 [exampleSDID@32473 iut="3" eventSource="Application" eventID="1011"] BOMAn application event log entry...',
    expect: {
      parserId: null,
      eventName: null,
      identity: {},
      headerHostname: "mymachine.example.com",
    },
  },
  {
    name: "a routeros line in syslog format, from a device whose maker is not known",
    source: MIKROTIK_LOG,
    kind: "verbatim",
    line: "<27>Oct  2 17:36:35 MikroTik login failure for user guest from 192.168.88.17 via ssh",
    expect: { parserId: null, eventName: null },
  },
  {
    name: "an aos-switch line without its number, from a device whose maker is not known",
    source: ARUBA_AOS_SWITCH,
    kind: "composed",
    line: "<14>Jan  7 20:22:33 10.1.1.5 ports: port A12 is now off-line",
    expect: { parserId: null, eventName: null },
  },
  {
    name: "a logfmt line that is nobody's firewall",
    source: "logfmt, the key=value style applications log in",
    kind: "composed",
    line: '<14>Oct 13 10:11:12 app-1 level=info msg="request served" status=200 duration=12ms',
    expect: { parserId: null, eventName: null },
  },
];

export const ALL_SYSLOG_VENDOR_SAMPLES: Array<SyslogVendorSample> = [
  ...SOPHOS_SAMPLES,
  ...FORTINET_SAMPLES,
  ...CISCO_SAMPLES,
  ...EXTREME_SAMPLES,
  ...ARUBA_SAMPLES,
  ...MIKROTIK_SAMPLES,
  ...CAMBIUM_SAMPLES,
  ...UNIFI_SAMPLES,
  ...LINUX_SAMPLES,
  ...CEF_SAMPLES,
  ...UNRECOGNIZED_SAMPLES,
];

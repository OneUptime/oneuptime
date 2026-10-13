import URL from "Common/Types/API/URL";
import { DEFAULT_SYSLOG_RECEIVER_PORT } from "Common/Types/Syslog/SyslogReceiverDefaults";
import { DOCS_URL } from "Common/UI/Config";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { SyslogParserId } from "Common/Utils/Syslog/SyslogVendorParser";

/*
 * Pointing a device's syslog at a probe, per vendor: what the set-up card
 * on the Events pages shows when nothing has arrived yet. Each guide is the
 * few lines a person pastes into the device (or the few clicks in its web
 * interface), already pointed at the probe's port.
 *
 * The configuration is code and stays as written in every language; the
 * words around it are translated where they are drawn.
 *
 * Plain logic, free of React, so App/Tests can read it - and the docs test
 * holds the docs page to the same port and vendors.
 */

// What the guides write where the probe's address goes.
export const PROBE_ADDRESS_PLACEHOLDER: string = "<probe-address>";

// The docs page with every vendor's steps (monitor/network-events.md).
export const NETWORK_EVENTS_DOCS_PATH: string = "/monitor/network-events";

export function getNetworkEventsDocsUrl(): URL {
  return URL.fromString(DOCS_URL.toString()).addRoute(NETWORK_EVENTS_DOCS_PATH);
}

// The port a probe hears syslog on, over UDP and over TCP.
export const SYSLOG_PORT: number = DEFAULT_SYSLOG_RECEIVER_PORT;

export enum SyslogSetupVendor {
  Cisco = "cisco",
  Sophos = "sophos",
  Fortinet = "fortinet",
  Extreme = "extreme",
  Aruba = "aruba",
  MikroTik = "mikrotik",
  UniFi = "unifi",
  Cambium = "cambium",
  Other = "other",
}

export interface SyslogSetupGuide {
  vendor: SyslogSetupVendor;
  /*
   * The tab's name: a product name, the same in every language - except
   * "Other devices" (OTHER_DEVICES_NAME), which is translated.
   */
  name: string;
  // The parsers that read what this guide makes a device send.
  parsers: Array<SyslogParserId>;
  /*
   * Lines to paste into the device's configuration, or null for a device
   * set up in a web interface (the steps say where).
   */
  configuration: string | null;
  // The steps, as English keys (translated where drawn).
  steps: Array<string>;
}

export const OTHER_DEVICES_NAME: string = translationKey("Other devices");

const STEP_PASTE_CONFIGURATION: string = translationKey(
  "Paste this into the device's configuration, with your probe's IP address in place of <probe-address>.",
);
const STEP_CISCO_SEVERITY: string = translationKey(
  "The second line sends informational messages and everything more serious: link changes, restarts and sign-ins are among them.",
);
const STEP_CISCO_NXOS: string = translationKey(
  "On NX-OS the line is: logging server <probe-address> 6 port 5140 use-vrf management.",
);
const STEP_SOPHOS_OPEN: string = translationKey(
  "In the firewall's web admin, open System services > Log settings and, under Syslog servers, choose Add.",
);
const STEP_SOPHOS_SERVER: string = translationKey(
  "Enter your probe's IP address and port 5140, and set the severity level to Information. Either log format the firewall offers is read.",
);
const STEP_SOPHOS_LOGS: string = translationKey(
  "Back on Log settings, tick the new server for the logs to send: the system events at least. Firewall traffic logs are many, so leave them out unless you want them.",
);
const STEP_FORTINET_FILTER: string = translationKey(
  "FortiGate sends what its log settings select. Event logs carry the tunnels, links and failovers; traffic logs are many, so leave them out unless you want them.",
);
const STEP_EXTREME_TARGET: string = translationKey(
  "Change VR-Default to the virtual router your probe is reached through.",
);
const STEP_ARUBA_VRF: string = translationKey(
  "On AOS-CX, add vrf mgmt to the line when the probe is reached through the management port.",
);
const STEP_ARUBA_AOS_SWITCH: string = translationKey(
  "On AOS-Switch the line is: logging <probe-address> udp 5140.",
);
const STEP_MIKROTIK_TOPICS: string = translationKey(
  "The first line points the router's built-in remote action at the probe; the others choose what it sends. Leave the remote log format as it is.",
);
const STEP_UNIFI_OPEN: string = translationKey(
  "In UniFi Network, open Integration > System Logging / SIEM and select SIEM Server as the destination.",
);
const STEP_UNIFI_SERVER: string = translationKey(
  "Enter your probe's IP address and port 5140, and choose the log categories to export.",
);
const STEP_UNIFI_DEVICES: string = translationKey(
  "The console reports on the access points and switches it manages. Events land on each device's own page when the device is in OneUptime with its MAC address, and on the console's otherwise.",
);
const STEP_CAMBIUM_OPEN: string = translationKey(
  "In cnMaestro or the access point's web interface, open the system settings and find the syslog servers.",
);
const STEP_CAMBIUM_SERVER: string = translationKey(
  "Enter your probe's IP address as a syslog server, with port 5140 where the form asks for a port, and set the syslog severity to Info.",
);
const STEP_PORT_514: string = translationKey(
  "A device that can only send to port 514 needs the probe to listen there: see the note under step 1.",
);
const STEP_OTHER_SERVER: string = translationKey(
  "Add a remote syslog server on the device: your probe's IP address, port 5140, over UDP or TCP.",
);
const STEP_OTHER_SEVERITY: string = translationKey(
  "Send informational messages and everything more serious.",
);
const STEP_OTHER_FORMATS: string = translationKey(
  "RFC 3164, RFC 5424 and CEF are all read. A device whose format OneUptime does not know still has its messages stored, and you can name its events yourself in a log pipeline.",
);

export function getSyslogSetupGuides(): Array<SyslogSetupGuide> {
  return [
    {
      vendor: SyslogSetupVendor.Cisco,
      name: "Cisco",
      parsers: [SyslogParserId.Cisco],
      configuration: [
        `logging host ${PROBE_ADDRESS_PLACEHOLDER} transport udp port ${SYSLOG_PORT}`,
        "logging trap informational",
        "service timestamps log datetime msec",
      ].join("\n"),
      steps: [STEP_PASTE_CONFIGURATION, STEP_CISCO_SEVERITY, STEP_CISCO_NXOS],
    },
    {
      vendor: SyslogSetupVendor.Sophos,
      name: "Sophos Firewall",
      parsers: [SyslogParserId.SophosFirewall],
      configuration: null,
      steps: [STEP_SOPHOS_OPEN, STEP_SOPHOS_SERVER, STEP_SOPHOS_LOGS],
    },
    {
      vendor: SyslogSetupVendor.Fortinet,
      name: "FortiGate",
      parsers: [SyslogParserId.FortinetFortiGate],
      configuration: [
        "config log syslogd setting",
        "    set status enable",
        `    set server "${PROBE_ADDRESS_PLACEHOLDER}"`,
        `    set port ${SYSLOG_PORT}`,
        "    set mode udp",
        "    set format default",
        "end",
      ].join("\n"),
      steps: [STEP_PASTE_CONFIGURATION, STEP_FORTINET_FILTER],
    },
    {
      vendor: SyslogSetupVendor.Extreme,
      name: "Extreme Networks",
      parsers: [SyslogParserId.ExtremeExos, SyslogParserId.ExtremeVoss],
      configuration: [
        `configure syslog add ${PROBE_ADDRESS_PLACEHOLDER}:${SYSLOG_PORT} vr VR-Default local7`,
        `enable log target syslog ${PROBE_ADDRESS_PLACEHOLDER}:${SYSLOG_PORT} vr VR-Default local7`,
        "enable syslog",
      ].join("\n"),
      steps: [STEP_PASTE_CONFIGURATION, STEP_EXTREME_TARGET],
    },
    {
      vendor: SyslogSetupVendor.Aruba,
      name: "HPE Aruba",
      parsers: [SyslogParserId.ArubaAosCx, SyslogParserId.ArubaAosSwitch],
      configuration: `logging ${PROBE_ADDRESS_PLACEHOLDER} udp ${SYSLOG_PORT} severity info`,
      steps: [STEP_PASTE_CONFIGURATION, STEP_ARUBA_VRF, STEP_ARUBA_AOS_SWITCH],
    },
    {
      vendor: SyslogSetupVendor.MikroTik,
      name: "MikroTik",
      parsers: [SyslogParserId.MikroTikRouterOs],
      configuration: [
        `/system logging action set remote remote=${PROBE_ADDRESS_PLACEHOLDER} remote-port=${SYSLOG_PORT}`,
        "/system logging add topics=info action=remote",
        "/system logging add topics=warning action=remote",
        "/system logging add topics=error action=remote",
        "/system logging add topics=critical action=remote",
      ].join("\n"),
      steps: [STEP_PASTE_CONFIGURATION, STEP_MIKROTIK_TOPICS],
    },
    {
      vendor: SyslogSetupVendor.UniFi,
      name: "UniFi",
      parsers: [SyslogParserId.UbiquitiUniFi],
      configuration: null,
      steps: [STEP_UNIFI_OPEN, STEP_UNIFI_SERVER, STEP_UNIFI_DEVICES],
    },
    {
      vendor: SyslogSetupVendor.Cambium,
      name: "Cambium",
      parsers: [SyslogParserId.CambiumEnterpriseWifi],
      configuration: null,
      steps: [STEP_CAMBIUM_OPEN, STEP_CAMBIUM_SERVER, STEP_PORT_514],
    },
    {
      vendor: SyslogSetupVendor.Other,
      name: OTHER_DEVICES_NAME,
      // Linux-based devices, and anything that speaks CEF.
      parsers: [SyslogParserId.Linux, SyslogParserId.Cef],
      configuration: null,
      steps: [STEP_OTHER_SERVER, STEP_OTHER_SEVERITY, STEP_OTHER_FORMATS],
    },
  ];
}

/*
 * The guide's configuration with the probe's address in it, when the page
 * knows it; else with the placeholder the steps explain.
 */
export function getConfigurationForProbe(
  guide: SyslogSetupGuide,
  probeAddress: string | null,
): string | null {
  if (!guide.configuration) {
    return null;
  }

  if (!probeAddress) {
    return guide.configuration;
  }

  return guide.configuration
    .split(PROBE_ADDRESS_PLACEHOLDER)
    .join(probeAddress);
}

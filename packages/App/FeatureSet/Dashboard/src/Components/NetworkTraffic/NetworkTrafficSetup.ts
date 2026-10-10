import URL from "Common/Types/API/URL";
import {
  DEFAULT_IPFIX_COLLECTOR_PORT,
  DEFAULT_NETFLOW_COLLECTOR_PORT,
  DEFAULT_SFLOW_COLLECTOR_PORT,
} from "Common/Types/NetFlow/NetworkFlowCollectorPorts";
import { DOCS_URL } from "Common/UI/Config";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Turning flow export on, per vendor: what the set-up card on the Traffic
 * pages shows when nothing has arrived yet. Each guide is the few lines a
 * person pastes into the device (or the few clicks in a cloud dashboard),
 * already pointed at the probe's ports, with what the device can export.
 *
 * The configuration is code and stays as written in every language; the
 * words around it are translated where they are drawn.
 *
 * Plain logic, free of React, so App/Tests can read it - and the docs test
 * holds the docs page to the same ports and vendors.
 */

// What the guides write where the probe's address goes.
export const PROBE_ADDRESS_PLACEHOLDER: string = "<probe-address>";

// The docs page with every vendor's commands (monitor/network-traffic.md).
export const NETWORK_TRAFFIC_DOCS_PATH: string = "/monitor/network-traffic";

export function getNetworkTrafficDocsUrl(): URL {
  return URL.fromString(DOCS_URL.toString()).addRoute(
    NETWORK_TRAFFIC_DOCS_PATH,
  );
}

export enum TrafficSetupVendor {
  CiscoIosXe = "cisco-ios-xe",
  CiscoIos = "cisco-ios",
  Arista = "arista",
  Meraki = "meraki",
  Other = "other",
}

export interface TrafficSetupGuide {
  vendor: TrafficSetupVendor;
  // The tab's name: a product name, the same in every language.
  label: string;
  // What the device sends, and to which port.
  format: string;
  port: number;
  /*
   * Lines to paste into the device's configuration, or null for a device
   * set up in a web dashboard (the steps say where).
   */
  configuration: string | null;
  // The steps, as English keys (translated where drawn).
  steps: Array<string>;
}

export const COLLECTOR_PORTS: {
  netFlow: number;
  ipfix: number;
  sFlow: number;
} = {
  netFlow: DEFAULT_NETFLOW_COLLECTOR_PORT,
  ipfix: DEFAULT_IPFIX_COLLECTOR_PORT,
  sFlow: DEFAULT_SFLOW_COLLECTOR_PORT,
};

const STEP_PASTE_CONFIGURATION: string = translationKey(
  "Paste this into the device's configuration, with your probe's IP address in place of <probe-address>.",
);
const STEP_EVERY_INTERFACE: string = translationKey(
  "Add the last line to every interface whose traffic you want to see. Watching traffic as it comes in on each interface counts every conversation once.",
);
const STEP_TIMEOUTS: string = translationKey(
  "The 60-second timeouts keep the charts current and let the probe read the records within a minute.",
);
const STEP_SFLOW_SAMPLING: string = translationKey(
  "sFlow samples one packet in every N (16384 here); the Traffic pages multiply the samples back up, so the numbers are estimates.",
);
const STEP_MERAKI_OPEN: string = translationKey(
  "In the Meraki dashboard, open Network-wide > General and find Reporting.",
);
const STEP_MERAKI_ENABLE: string = translationKey(
  "Set NetFlow traffic reporting to Enabled: send NetFlow traffic statistics.",
);
const STEP_MERAKI_COLLECTOR: string = translationKey(
  "Enter your probe's IP address as the NetFlow collector IP and 2055 as the NetFlow collector port, then save.",
);
const STEP_MERAKI_SCOPE: string = translationKey(
  "MX appliances and Z-series gateways export NetFlow v9 for the traffic that passes through them. Traffic that a switch keeps within a VLAN never reaches them, so it is not in the export.",
);
const STEP_OTHER_FORMATS: string = translationKey(
  "Send NetFlow v5, NetFlow v9 or IPFIX to your probe's IP address on UDP port 2055 (or 4739), or sFlow v5 on UDP port 6343. Every port takes every format.",
);
const STEP_OTHER_TIMEOUTS: string = translationKey(
  "Set the device's active flow timeout to 60 seconds and, for NetFlow v9 and IPFIX, send its templates every 60 seconds.",
);
const STEP_OTHER_DOCS: string = translationKey(
  "The docs have the commands for Juniper, Fortinet, Palo Alto, MikroTik, pfSense and Linux hosts.",
);

export function getTrafficSetupGuides(): Array<TrafficSetupGuide> {
  return [
    {
      vendor: TrafficSetupVendor.CiscoIosXe,
      label: "Cisco IOS XE",
      format: "IPFIX",
      port: COLLECTOR_PORTS.ipfix,
      configuration: [
        "flow exporter ONEUPTIME",
        ` destination ${PROBE_ADDRESS_PLACEHOLDER}`,
        " source Loopback0",
        ` transport udp ${COLLECTOR_PORTS.ipfix}`,
        " export-protocol ipfix",
        " template data timeout 60",
        " option interface-table",
        " option sampler-table",
        "!",
        "flow monitor ONEUPTIME",
        " exporter ONEUPTIME",
        " cache timeout active 60",
        " record netflow ipv4 original-input",
        "!",
        "interface GigabitEthernet0/0/0",
        " ip flow monitor ONEUPTIME input",
      ].join("\n"),
      steps: [STEP_PASTE_CONFIGURATION, STEP_EVERY_INTERFACE, STEP_TIMEOUTS],
    },
    {
      vendor: TrafficSetupVendor.CiscoIos,
      label: "Cisco IOS",
      format: "NetFlow v9",
      port: COLLECTOR_PORTS.netFlow,
      configuration: [
        "ip flow-export version 9",
        `ip flow-export destination ${PROBE_ADDRESS_PLACEHOLDER} ${COLLECTOR_PORTS.netFlow}`,
        "ip flow-export source Loopback0",
        "ip flow-export template timeout-rate 1",
        "ip flow-cache timeout active 1",
        "!",
        "interface GigabitEthernet0/0",
        " ip flow ingress",
      ].join("\n"),
      steps: [STEP_PASTE_CONFIGURATION, STEP_EVERY_INTERFACE, STEP_TIMEOUTS],
    },
    {
      vendor: TrafficSetupVendor.Arista,
      label: "Arista EOS",
      format: "sFlow",
      port: COLLECTOR_PORTS.sFlow,
      configuration: [
        "sflow sample 16384",
        `sflow destination ${PROBE_ADDRESS_PLACEHOLDER} ${COLLECTOR_PORTS.sFlow}`,
        "sflow source-interface Loopback0",
        "sflow run",
      ].join("\n"),
      steps: [STEP_PASTE_CONFIGURATION, STEP_SFLOW_SAMPLING],
    },
    {
      vendor: TrafficSetupVendor.Meraki,
      label: "Cisco Meraki MX / Z",
      format: "NetFlow v9",
      port: COLLECTOR_PORTS.netFlow,
      configuration: null,
      steps: [
        STEP_MERAKI_OPEN,
        STEP_MERAKI_ENABLE,
        STEP_MERAKI_COLLECTOR,
        STEP_MERAKI_SCOPE,
      ],
    },
    {
      vendor: TrafficSetupVendor.Other,
      label: "Other devices",
      format: "NetFlow, IPFIX or sFlow",
      port: COLLECTOR_PORTS.netFlow,
      configuration: null,
      steps: [STEP_OTHER_FORMATS, STEP_OTHER_TIMEOUTS, STEP_OTHER_DOCS],
    },
  ];
}

/*
 * The guide's configuration with the probe's address in it, when the page
 * knows it; else with the placeholder the steps explain.
 */
export function getConfigurationForProbe(
  guide: TrafficSetupGuide,
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

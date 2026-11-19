import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveryImportAlerting,
  DiscoveryImportSettings,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  isDeviceAddressMonitorType,
  isDeviceTargetMonitorType,
  isDeviceUrlMonitorType,
} from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import { MonitorTemplateAlertSummary } from "Common/Utils/Monitor/MonitorTemplateAlertSummary";
import { isPingOnlyDiscoveredHost } from "Common/Utils/NetworkDiscovery/DiscoveryImportEligibility";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT AN IMPORT WILL DO, BEFORE IT DOES IT (OneUptime issue #4811).
 *
 * The Review dialog's monitoring step ends in one short account of the
 * outcome, in the reader's terms: how many hosts become devices walked over
 * SNMP and how many are only pinged, how often the probe checks them, which
 * template their monitors come from and whether a problem opens an incident,
 * an alert, or reaches nobody - and how much of that the plan has room for.
 * "514 hosts: 480 network devices polled every 5 minutes; 34 pinged; each
 * gets a monitor from Network device alert pack: an incident when one stops
 * answering."
 *
 * Worked out here, as data, from the very choices the import is sent with;
 * the step turns it into sentences in the reader's language. React-free, so
 * every combination is tested on its own.
 */

/*
 * A monitor template the reader can pick, as the step knows it: a Network
 * Device template, whose monitor reads each device's polls, a Ping, IP,
 * Port or NTP template, whose monitor checks each device's address (issue
 * #5145), or a Website, API or SSL Certificate template, whose monitor
 * checks a URL on each device (issue #9546).
 */
export interface DiscoveryImportTemplateChoice {
  // Empty for the recommended template the import would create.
  id: string;
  // As someone named it; empty for a template with no name.
  name: string;
  monitorType: MonitorType;
  summary: MonitorTemplateAlertSummary;
  /*
   * How often a monitor made from it checks, as the template's cron, for a
   * template checked from a probe. A Network Device monitor is judged on
   * every poll instead.
   */
  monitoringInterval?: string | undefined;
  // The ports a Port template's steps check, each once.
  ports?: Array<number> | undefined;
  /*
   * The URL a web template's first step checks, as written: each device's
   * monitor checks it with the device's address as its host.
   */
  templateUrl?: string | undefined;
  /*
   * Why no device's monitor can be made from it, in English, as the server
   * would refuse it: a web template whose URL has no host a device's
   * address can take, say. Listed all the same - the reader sees what to
   * change - but Import waits until it is changed.
   */
  unusableReason?: string | undefined;
  // Not in the project yet: Import creates it first.
  isCreatedOnImport?: boolean | undefined;
}

/*
 * Whether the template's monitors check each device's address (Ping, IP,
 * Port, NTP) rather than read its polls (Network Device) or check a URL on
 * it.
 */
export function checksDeviceAddress(
  choice: DiscoveryImportTemplateChoice | null | undefined,
): boolean {
  return Boolean(choice && isDeviceAddressMonitorType(choice.monitorType));
}

// Whether the template's monitors check a URL on each device (Website, API, SSL Certificate).
export function checksDeviceUrl(
  choice: DiscoveryImportTemplateChoice | null | undefined,
): boolean {
  return Boolean(choice && isDeviceUrlMonitorType(choice.monitorType));
}

/*
 * Whether the template's monitors check each device from a probe, on the
 * template's schedule - its address, or a URL on it - rather than read the
 * device's polls: every kind but Network Device.
 */
export function checksFromProbe(
  choice: DiscoveryImportTemplateChoice | null | undefined,
): boolean {
  return Boolean(choice && isDeviceTargetMonitorType(choice.monitorType));
}

// The value the recommended template Import would create is picked by.
export const RECOMMENDED_TEMPLATE_CHOICE_VALUE: string = "recommended";

// The value a template is picked by: its id, or the recommended one's value.
export function getTemplateChoiceValue(
  choice: DiscoveryImportTemplateChoice,
): string {
  return choice.id || RECOMMENDED_TEMPLATE_CHOICE_VALUE;
}

// An alert policy of the project, as far as the summary is concerned.
export interface DiscoveryImportPolicyFact {
  name: string;
  isEnabled: boolean;
  // Covers every device in the project (no sites, roles or labels).
  isUnscoped: boolean;
  templateName?: string | undefined;
  // Has a template to provision from at all.
  hasTemplate: boolean;
}

export enum DiscoveryImportAlertReach {
  // Nothing the import does, and no policy, raises anything.
  Nobody = "Nobody",
  // The import's monitors raise what the template raises.
  Template = "Template",
  // No monitors from the import, but a policy covers every device.
  Policies = "Policies",
}

export interface DiscoveryImportOutcome {
  // New devices the import creates.
  hostCount: number;
  /*
   * Devices already added that were picked to get a monitor (issue #9544):
   * each gets the template's monitor when monitors are asked for, and is
   * otherwise left as it is.
   */
  existingDeviceCount: number;
  snmpHostCount: number;
  pingOnlyHostCount: number;
  pollingIntervalInMinutes: number;
  // Each SNMP device gets its vendor's health template on its first poll.
  appliesVendorTemplates: boolean;
  // Devices the import creates a monitor for: new ones, and ones already added.
  monitorCount: number;
  // Monitors past the plan's room: devices imported without one.
  monitorsBeyondRoom: number;
  template: DiscoveryImportTemplateChoice | null;
  reach: DiscoveryImportAlertReach;
  /*
   * The template opens incidents / creates alerts on ANY of the devices
   * imported: on a device that answers ping only, only what its ping-only
   * checks raise.
   */
  raisesIncidents: boolean;
  raisesAlerts: boolean;
  /*
   * Ping-only devices whose monitor can raise nothing: every check of the
   * template that opens an incident or an alert reads an SNMP walk, and
   * these devices are only pinged. Never any for a Ping, IP, Port, NTP,
   * Website, API or SSL Certificate template: its monitors check the device
   * themselves.
   */
  pingOnlyHostsWithoutAlerts: number;
  // Enabled policies that cover every device, by name.
  coveringPolicyNames: Array<string>;
  // Enabled policies scoped to sites, roles or labels.
  scopedPolicyCount: number;
}

export function countPingOnlyHosts(
  hosts: ReadonlyArray<DiscoveredNetworkDevice>,
): number {
  return hosts.filter((host: DiscoveredNetworkDevice): boolean => {
    return isPingOnlyDiscoveredHost(host);
  }).length;
}

export function getDiscoveryImportOutcome(data: {
  // The hosts the import brings in as new devices.
  hosts: ReadonlyArray<DiscoveredNetworkDevice>;
  /*
   * Hosts that are devices already, with no monitor, picked to get one
   * (issue #9544). They are not imported again: only given the template's
   * monitor, when monitors are asked for.
   */
  existingHosts?: ReadonlyArray<DiscoveredNetworkDevice> | undefined;
  settings: DiscoveryImportSettings;
  template: DiscoveryImportTemplateChoice | null;
  policies: ReadonlyArray<DiscoveryImportPolicyFact>;
  // How many more monitors the plan allows; null when it sets no limit.
  monitorRoom: number | null;
}): DiscoveryImportOutcome {
  const hostCount: number = data.hosts.length;
  const existingHosts: ReadonlyArray<DiscoveredNetworkDevice> =
    data.existingHosts || [];
  const existingDeviceCount: number = existingHosts.length;
  const pingOnlyHostCount: number = countPingOnlyHosts(data.hosts);
  const snmpHostCount: number = hostCount - pingOnlyHostCount;

  const wantsMonitors: boolean =
    data.settings.alerting === DiscoveryImportAlerting.MonitorTemplate &&
    Boolean(data.template);

  const template: DiscoveryImportTemplateChoice | null = wantsMonitors
    ? data.template
    : null;

  // Every host the template's monitor is made for: new and already added.
  const monitoredHosts: ReadonlyArray<DiscoveredNetworkDevice> = wantsMonitors
    ? [...data.hosts, ...existingHosts]
    : [];
  const monitorCount: number = monitoredHosts.length;
  const pingOnlyMonitoredCount: number = countPingOnlyHosts(monitoredHosts);

  const monitorsBeyondRoom: number =
    wantsMonitors && data.monitorRoom !== null
      ? Math.max(0, monitorCount - Math.max(0, data.monitorRoom))
      : 0;

  const enabledPolicies: Array<DiscoveryImportPolicyFact> =
    data.policies.filter((policy: DiscoveryImportPolicyFact): boolean => {
      return policy.isEnabled && policy.hasTemplate;
    });

  const coveringPolicyNames: Array<string> = enabledPolicies
    .filter((policy: DiscoveryImportPolicyFact): boolean => {
      return policy.isUnscoped;
    })
    .map((policy: DiscoveryImportPolicyFact): string => {
      return policy.name;
    });

  const scopedPolicyCount: number = enabledPolicies.filter(
    (policy: DiscoveryImportPolicyFact): boolean => {
      return !policy.isUnscoped;
    },
  ).length;

  /*
   * What the monitors raise on THESE devices. When every one of them
   * answers ping only - issue #5145's 516 kitchen displays and registers -
   * a Network Device template's checks that read an SNMP walk raise nothing
   * on any of them, so what it raises is what its ping-only checks raise:
   * the summary must not promise alerts only an SNMP device could create.
   */
  const isEveryHostPingOnly: boolean =
    monitorCount > 0 && pingOnlyMonitoredCount === monitorCount;
  const readsWalks: boolean = Boolean(template && !checksFromProbe(template));
  const raisesIncidents: boolean = Boolean(
    template &&
      (isEveryHostPingOnly && readsWalks
        ? template.summary.raisesIncidentsOnPingOnlyDevices
        : template.summary.raisesIncidents),
  );
  const raisesAlerts: boolean = Boolean(
    template &&
      (isEveryHostPingOnly && readsWalks
        ? template.summary.raisesAlertsOnPingOnlyDevices
        : template.summary.raisesAlerts),
  );
  /*
   * A monitor that checks the device itself, from a probe - its address or
   * a URL on it - fires on a device that only answers ping as much as on
   * any other.
   */
  const raisesOnPingOnly: boolean = Boolean(
    template &&
      (checksFromProbe(template) ||
        template.summary.raisesIncidentsOnPingOnlyDevices ||
        template.summary.raisesAlertsOnPingOnlyDevices),
  );

  let reach: DiscoveryImportAlertReach = DiscoveryImportAlertReach.Nobody;

  if (template && (raisesIncidents || raisesAlerts)) {
    reach = DiscoveryImportAlertReach.Template;
  } else if (coveringPolicyNames.length > 0) {
    reach = DiscoveryImportAlertReach.Policies;
  }

  return {
    hostCount: hostCount,
    existingDeviceCount: existingDeviceCount,
    snmpHostCount: snmpHostCount,
    pingOnlyHostCount: pingOnlyHostCount,
    pollingIntervalInMinutes: data.settings.pollingIntervalInMinutes,
    appliesVendorTemplates:
      data.settings.applyVendorTemplates && snmpHostCount > 0,
    monitorCount: monitorCount,
    monitorsBeyondRoom: monitorsBeyondRoom,
    template: template,
    reach: reach,
    raisesIncidents: raisesIncidents,
    raisesAlerts: raisesAlerts,
    pingOnlyHostsWithoutAlerts:
      template && !raisesOnPingOnly ? pingOnlyMonitoredCount : 0,
    coveringPolicyNames: coveringPolicyNames,
    scopedPolicyCount: scopedPolicyCount,
  };
}

/*
 * Whether the monitoring step can be imported from as it stands: a host to
 * import - or a device already added to give a monitor (issue #9544) - and,
 * when monitors are asked for, a template picked. Devices that are already
 * added and get no monitor leave nothing to do.
 */
export function getDiscoveryImportBlocker(data: {
  hostCount: number;
  existingDeviceCount?: number | undefined;
  settings: DiscoveryImportSettings;
  template: DiscoveryImportTemplateChoice | null;
}): string | null {
  const existingDeviceCount: number = data.existingDeviceCount || 0;
  const wantsMonitors: boolean =
    data.settings.alerting === DiscoveryImportAlerting.MonitorTemplate;

  if (data.hostCount === 0 && existingDeviceCount === 0) {
    return "Select at least one host to import.";
  }

  if (wantsMonitors && !data.template) {
    return "Pick the monitor template each device is monitored with.";
  }

  if (wantsMonitors && data.template?.unusableReason) {
    return data.template.unusableReason;
  }

  if (data.hostCount === 0 && !wantsMonitors) {
    return EXISTING_DEVICES_NEED_A_TEMPLATE;
  }

  return null;
}

/*
 * Why there is nothing to import when every host picked is a device already
 * and the step asks for no monitor: those hosts were picked to get one.
 */
export const EXISTING_DEVICES_NEED_A_TEMPLATE: string = translationKey(
  "The devices you picked are already added. Give them a monitor from a template, or go back and pick new hosts.",
);

/*
 * The same, in the Discovered Devices list's Add to monitoring (issue
 * #9675), which picks its devices before it opens: there is no step to go
 * back to.
 */
export const EXISTING_DISCOVERED_DEVICES_NEED_A_TEMPLATE: string =
  translationKey(
    "The devices you picked are already added. Give them a monitor from a template.",
  );

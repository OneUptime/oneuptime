import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveryImportAlerting,
  DiscoveryImportSettings,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { isDeviceAddressMonitorType } from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import { MonitorTemplateAlertSummary } from "Common/Utils/Monitor/MonitorTemplateAlertSummary";
import { isPingOnlyDiscoveredHost } from "Common/Utils/NetworkDiscovery/DiscoveryImportEligibility";

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
 * Device template, whose monitor reads each device's polls, or a Ping, IP or
 * Port template, whose monitor checks each device's address (issue #5145).
 */
export interface DiscoveryImportTemplateChoice {
  // Empty for the recommended template the import would create.
  id: string;
  name: string;
  monitorType: MonitorType;
  summary: MonitorTemplateAlertSummary;
  /*
   * How often an address monitor made from it checks, as the template's
   * cron. A Network Device monitor is judged on every poll instead.
   */
  monitoringInterval?: string | undefined;
  // The ports a Port template's steps check, each once.
  ports?: Array<number> | undefined;
  // Not in the project yet: Import creates it first.
  isCreatedOnImport?: boolean | undefined;
}

/*
 * Whether the template's monitors check each device's address (Ping, IP,
 * Port) rather than read its polls (Network Device).
 */
export function checksDeviceAddress(
  choice: DiscoveryImportTemplateChoice | null | undefined,
): boolean {
  return Boolean(choice && isDeviceAddressMonitorType(choice.monitorType));
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
  hostCount: number;
  snmpHostCount: number;
  pingOnlyHostCount: number;
  pollingIntervalInMinutes: number;
  // Each SNMP device gets its vendor's health template on its first poll.
  appliesVendorTemplates: boolean;
  // Devices the import creates a monitor for.
  monitorCount: number;
  // Monitors past the plan's room: devices imported without one.
  monitorsBeyondRoom: number;
  template: DiscoveryImportTemplateChoice | null;
  reach: DiscoveryImportAlertReach;
  // The template opens incidents / creates alerts on ANY of the devices.
  raisesIncidents: boolean;
  raisesAlerts: boolean;
  /*
   * Ping-only devices whose monitor can raise nothing: every check of the
   * template that opens an incident or an alert reads an SNMP walk, and
   * these devices are only pinged. Never any for a Ping, IP or Port
   * template: its monitors check the address themselves.
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
  hosts: ReadonlyArray<DiscoveredNetworkDevice>;
  settings: DiscoveryImportSettings;
  template: DiscoveryImportTemplateChoice | null;
  policies: ReadonlyArray<DiscoveryImportPolicyFact>;
  // How many more monitors the plan allows; null when it sets no limit.
  monitorRoom: number | null;
}): DiscoveryImportOutcome {
  const hostCount: number = data.hosts.length;
  const pingOnlyHostCount: number = countPingOnlyHosts(data.hosts);
  const snmpHostCount: number = hostCount - pingOnlyHostCount;

  const wantsMonitors: boolean =
    data.settings.alerting === DiscoveryImportAlerting.MonitorTemplate &&
    Boolean(data.template);

  const template: DiscoveryImportTemplateChoice | null = wantsMonitors
    ? data.template
    : null;

  const monitorCount: number = wantsMonitors ? hostCount : 0;

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

  const raisesIncidents: boolean = Boolean(template?.summary.raisesIncidents);
  const raisesAlerts: boolean = Boolean(template?.summary.raisesAlerts);
  /*
   * A monitor that checks the address itself fires on a device that only
   * answers ping as much as on any other.
   */
  const raisesOnPingOnly: boolean = Boolean(
    template &&
      (checksDeviceAddress(template) ||
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
      template && !raisesOnPingOnly ? pingOnlyHostCount : 0,
    coveringPolicyNames: coveringPolicyNames,
    scopedPolicyCount: scopedPolicyCount,
  };
}

/*
 * Whether the monitoring step can be imported from as it stands: a host to
 * import, and - when monitors are asked for - a template picked.
 */
export function getDiscoveryImportBlocker(data: {
  hostCount: number;
  settings: DiscoveryImportSettings;
  template: DiscoveryImportTemplateChoice | null;
}): string | null {
  if (data.hostCount === 0) {
    return "Select at least one host to import.";
  }

  if (
    data.settings.alerting === DiscoveryImportAlerting.MonitorTemplate &&
    !data.template
  ) {
    return "Pick the monitor template each device is monitored with.";
  }

  return null;
}

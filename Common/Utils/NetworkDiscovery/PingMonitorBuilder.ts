import Monitor from "../../Models/DatabaseModels/Monitor";
import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Hostname from "../../Types/API/Hostname";
import IP from "../../Types/IP/IP";
import MonitorCriteriaInstance from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";

/*
 * The Ping monitor a ping-only discovered host imports with.
 *
 * WHY THIS EXISTS
 *
 * A host that answered ICMP but not SNMP imports as a monitor-backed device:
 * no probe, no credentials, polling off (DiscoveredDeviceBuilder). That is
 * deliberate — there is nothing to walk it with — but it leaves the device
 * with NO health source at all. Its status reads "Pending" forever, its
 * "Last Seen" reads never, and the only way out was for an operator to hand-
 * create a Ping monitor and hand-bind it, per device. Fourteen discovered
 * phones meant fourteen monitors and fourteen device edits, which is
 * OneUptime/oneuptime#3447.
 *
 * The probe already proved the host answers ICMP — that is the only reason it
 * is in the scan results at all (SubnetScanner records a no-SNMP host only
 * when it was in `pingAliveHosts`). So the monitor this builds is not a guess:
 * it re-asks, on a schedule, the exact question the scan already answered once.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No database and no permission work — the caller persists it through
 * MonitorService/ModelAPI so tenant, billing, probe-attachment and status-
 * timeline hooks still run. Creating a monitor is billable and plan-limited,
 * so provisioning is always something the operator opted into, never a
 * side effect of importing.
 */

/*
 * Monitor.name is varchar(100), but the real ceiling is the SLUG: Monitor is
 * @SlugifyColumn("name", "slug") and Slug.getSlug appends a dash plus ten
 * random digits into its own varchar(100), and the create path THROWS on
 * overflow rather than truncating. So a name over ~88 characters fails the
 * create even though the name column would have taken it — the same trap
 * MAX_DEVICE_NAME_LENGTH exists for on the device side.
 *
 * 88 leaves exactly the slug's 11-character tail. Device names already arrive
 * clamped to 80 by DiscoveredDeviceBuilder and the prefix is 5, so 85 is the
 * realistic worst case through the import path; this is the backstop for a
 * device renamed by hand afterwards.
 */
export const MAX_PING_MONITOR_NAME_LENGTH: number = 88;

const PING_MONITOR_NAME_PREFIX: string = "Ping ";

/*
 * How often the provisioned monitor pings, as a cron expression.
 *
 * Set explicitly because leaving `monitoringInterval` NULL is NOT "use a
 * sensible default" — MonitorProbeService falls back to now + 1 MINUTE when
 * the column is null (both in claimMonitorProbesForProbing's batch UPDATE and
 * in the per-probe path). Importing a subnet's worth of IP phones would then
 * ping every one of them every sixty seconds, forever, because nobody chose
 * that. Five minutes is what the monitor create page pre-seeds, so a
 * provisioned monitor matches a hand-made one and the operator can change it
 * from the same dropdown.
 */
export const PING_MONITOR_INTERVAL: string = "*/5 * * * *";

/**
 * The four project-scoped ids every monitor's default criteria are seeded
 * with. The caller resolves them once per import run — they are properties of
 * the project, not of any one host — and passes the same set for every device.
 */
export interface MonitorCriteriaSeedIds {
  // The project's operational status, e.g. "Operational".
  onlineMonitorStatusId: ObjectID;
  // The project's offline status, e.g. "Offline".
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
}

export interface BuildPingMonitorData {
  projectId: ObjectID;
  // The host being imported. Only its address is used.
  host: DiscoveredNetworkDevice;
  /*
   * The name of the NetworkDevice this monitor will be bound to, so the two
   * read as a pair in a monitor list that also contains unrelated monitors.
   */
  deviceName: string;
  seedIds: MonitorCriteriaSeedIds;
}

/**
 * The monitor's name: "Ping <device name>", clamped to the column.
 *
 * Named after the DEVICE rather than the address because that is what an
 * operator scanning a monitor list is looking for, and because two devices can
 * legitimately share an address across separate VRFs while their names differ.
 */
export function buildPingMonitorName(deviceName: string): string {
  const trimmedDeviceName: string = (deviceName || "").trim();

  const composed: string = `${PING_MONITOR_NAME_PREFIX}${trimmedDeviceName}`;

  return composed.length > MAX_PING_MONITOR_NAME_LENGTH
    ? composed.substring(0, MAX_PING_MONITOR_NAME_LENGTH)
    : composed;
}

/**
 * The destination the monitor pings.
 *
 * A discovered host's address is an IP in every case the scanner produces —
 * it sweeps address ranges — but the column is free text and a hand-written
 * scan row could hold a name, so anything that does not parse as an IP is
 * carried as a Hostname rather than rejected. MonitorStep accepts either.
 */
export function buildPingMonitorDestination(address: string): IP | Hostname {
  const trimmedAddress: string = (address || "").trim();

  if (IP.isIP(trimmedAddress)) {
    return IP.fromString(trimmedAddress);
  }

  return new Hostname(trimmedAddress);
}

/**
 * Turn OFF incident creation on every criteria instance of a step, leaving
 * `changeMonitorStatus` alone.
 *
 * A hand-made Ping monitor defaults to opening an incident when the host stops
 * answering, which is right for a monitor someone deliberately created for one
 * service. This is a BULK action: an operator ticking "import 14 hosts" is
 * recording inventory, and the default would hand them fourteen monitors that
 * each open an incident — with on-call notifications, workspace posts and
 * status-page impact — the first time a consumer access point or an IP phone
 * misses a ping.
 *
 * `changeMonitorStatus` stays true because that is the whole point: it is what
 * moves the monitor's status, which is what the device's status pill reads.
 * So the device goes Up/Down correctly and nobody gets paged for it. Turning
 * incidents back on is one edit per monitor, and is the operator's call.
 */
function suppressIncidentCreation(step: MonitorStep): void {
  const criteriaInstances: Array<MonitorCriteriaInstance> =
    step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

  for (const criteriaInstance of criteriaInstances) {
    if (criteriaInstance.data) {
      criteriaInstance.data.createIncidents = false;
    }
  }
}

/**
 * One ping-only discovered host -> the Ping monitor that will report its
 * health once bound to the device through `NetworkDevice.monitorId`.
 *
 * The caller creates this monitor FIRST, then creates the device carrying the
 * new monitor's id: `NetworkDeviceService.onCreateSuccess` stamps the
 * monitor's current status onto the device at bind time, so the device's
 * status pill resolves on the first render rather than waiting for the
 * monitor's next status CHANGE (which on a healthy network may never come —
 * that was OneUptime/oneuptime#3392).
 */
export function buildPingMonitorForDiscoveredHost(
  data: BuildPingMonitorData,
): Monitor {
  const address: string = (data.host?.ipAddress || "").trim();

  if (!address) {
    throw new Error(
      "A discovered host needs an address before a Ping monitor can be built for it.",
    );
  }

  const monitor: Monitor = new Monitor();

  monitor.projectId = new ObjectID(data.projectId.toString());
  monitor.name = buildPingMonitorName(data.deviceName);
  monitor.description = `Reachability for ${address}, created when this device was imported from a network discovery scan. The device answered ping but not SNMP, so this monitor is what reports whether it is up.`;
  monitor.monitorType = MonitorType.Ping;
  monitor.monitoringInterval = PING_MONITOR_INTERVAL;

  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: monitor.name,
    monitorType: MonitorType.Ping,
    onlineMonitorStatusId: data.seedIds.onlineMonitorStatusId,
    offlineMonitorStatusId: data.seedIds.offlineMonitorStatusId,
    defaultIncidentSeverityId: data.seedIds.defaultIncidentSeverityId,
    defaultAlertSeverityId: data.seedIds.defaultAlertSeverityId,
  });

  /*
   * The destination is what makes the step valid: MonitorStep's validation
   * rejects a Ping step without one ("Monitor Destination is required").
   */
  step.setMonitorDestination(buildPingMonitorDestination(address));

  suppressIncidentCreation(step);

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: data.seedIds.onlineMonitorStatusId,
  };

  monitor.monitorSteps = monitorSteps;

  return monitor;
}

import { JSONObject, JSONValue } from "../JSON";
import {
  OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES,
  OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES,
  OPENSTACK_BARE_METAL_ERROR_STATES,
  OPENSTACK_BARE_METAL_IN_MAINTENANCE,
  OPENSTACK_BARE_METAL_TRANSITIONAL_STATES,
  OPENSTACK_SERVICES_EVERY_CLOUD_RUNS,
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_SERVICE_STATUS_DOWN,
  OPENSTACK_STACK_FAILED_STATUSES,
  OPENSTACK_STACK_IN_PROGRESS_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
} from "./OpenStackResourceKind";

/*
 * WHERE AN OPENSTACK PART STOPS BEING FINE.
 *
 * One set of lines for everything that judges a part: the Overview and lists
 * (OpenStackHealth), the server's read of what needs attention
 * (OpenStackResourceService.getAttentionRows) and the alert templates
 * (OpenStackAlertTemplates). A page and an alert that disagree about what is full
 * are how people stop trusting both, which the VMware audit found at 80/95 and 90.
 *
 * Pure, with no React and no database, so all of those can read it.
 */

export const OPENSTACK_STORAGE_POOL_WARNING_PERCENT: number = 85;
export const OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT: number = 95;

// Past this share of what Placement allows, a hypervisor has little room to give.
export const OPENSTACK_ALLOCATION_WARNING_PERCENT: number = 90;

export const OPENSTACK_IP_POOL_WARNING_PERCENT: number = 90;

// At this share of its addresses, an external network has none left to give.
export const OPENSTACK_IP_POOL_EXHAUSTED_PERCENT: number = 100;

// More active L3 agents than this for one router is a split brain.
export const OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS: number = 1;

// Past this share of a quota, a project's next instance or volume is at risk.
export const OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT: number = 90;

// How long a part may sit in a state on the way to something else.
export const OPENSTACK_INSTANCE_STUCK_MINUTES: number = 60;
export const OPENSTACK_VOLUME_STUCK_MINUTES: number = 30;
// An image left in queued is what a failed upload looks like: nothing ever moves it on.
export const OPENSTACK_IMAGE_STUCK_MINUTES: number = 60;
/*
 * Twice the hour Heat and Magnum each give a stack or cluster of their own accord. Past their
 * timeouts they fail it themselves, so what is left in progress has a longer timeout someone
 * chose, or an engine that stopped and left it (recorded: restarting Heat's engine did not move
 * either stack it had been working on).
 */
export const OPENSTACK_STACK_STUCK_MINUTES: number = 120;
export const OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES: number = 120;

/*
 * Ironic gives up on a node waiting for its agent after 30 minutes by default, and the node is then
 * in a failed state, which says so itself. Past twice that and as long again, Ironic has not given
 * up and nothing has moved. A long disk erase can honestly take this long: the page sees its
 * heartbeats through provision_updated_at, and an alert only sees the word.
 */
export const OPENSTACK_BARE_METAL_STUCK_MINUTES: number = 120;

/*
 * What a hypervisor's instances really use, as apart from what is promised on it. Past
 * these its instances are competing with each other, whatever Placement allows.
 */
export const OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT: number = 90;
export const OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT: number = 90;

// An instance using all of its vCPUs for this long is limited by its flavor.
export const OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT: number = 95;

/*
 * The same line the VMware templates draw for a host. A guest's disk at this latency is
 * slow enough for its users to notice, and past what a healthy backend does when busy.
 */
export const OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS: number = 50;

/*
 * A share of its vCPUs an instance spent waiting for the hypervisor. Past this a neighbour
 * is the problem, rather than the instance itself.
 */
export const OPENSTACK_INSTANCE_CPU_CONTENTION_WARNING_PERCENT: number = 10;

/*
 * A service someone disabled is planned work, until it has been so long that
 * somebody probably forgot it.
 */
export const OPENSTACK_SERVICE_DISABLED_WARNING_DAYS: number = 7;

/*
 * How close a public endpoint's certificate may come to its end. A month is when someone can
 * still renew it in working hours, and a week is when it is about to take every user with it.
 */
export const OPENSTACK_CERTIFICATE_EXPIRY_WARNING_DAYS: number = 30;
export const OPENSTACK_CERTIFICATE_EXPIRY_CRITICAL_DAYS: number = 7;

/*
 * How long a lifecycle run's server may take to reach ACTIVE before a boot counts as slow. Tempest's
 * own build_timeout, which is how long OpenStack's own tests give a server, and well under what a
 * run waits before calling a boot failed.
 */
export const OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS: number = 300;

/*
 * The same for a node: in maintenance on purpose, until it has been there so long that somebody
 * probably forgot it, and the machine has been out of what the cloud can give all that time.
 */
export const OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS: number = 7;

/*
 * What fills up within this many days is what Capacity Forecast Under N Days alerts on, and what
 * the Capacity page marks. Two weeks: about what it takes to find a host a home, or to clean up.
 */
export const OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS: number = 14;

/*
 * A host's allocations and its instances can disagree for a moment whenever one is starting or
 * going away. Disagreeing for this long is no moment.
 */
export const OPENSTACK_ALLOCATION_MISMATCH_MINUTES: number = 30;

/*
 * A service a cloud may not run says nothing when it stops. Asked about one whose API is not
 * answering, the exporter the agent runs answers 200 with nothing, exactly as it does for a cloud
 * that never had the service: recorded on Ironic (services-ironic/api-down) and on Designate. So all
 * anyone can say is that a service which was reporting has gone quiet: stopped, or taken away. Three
 * of its collections, at 5 minutes each, and one more to be sure, before a page says that.
 */
export const OPENSTACK_QUIET_SERVICE_MINUTES: number = 20;

/*
 * A cloud that took a service away for good has no way to say so, and no read of it will ever vouch
 * for its rows again, so they would stay for ever. This long after the rest of the cloud last
 * reported without it, they go. It comes back with its rows if it was only stopped.
 */
export const OPENSTACK_QUIET_SERVICE_FORGOTTEN_DAYS: number = 14;

/*
 * What an operator set: Nova and Cinder say enabled or disabled, Neutron says up or
 * down. Nothing here is a failure, whichever word it is in.
 */
/*
 * Workers where one down of several is a warning, because the others carry on. All of them down is a
 * control-plane outage. There are a few of these in a region however large it is.
 */
export const OPENSTACK_REDUNDANT_WORKERS: ReadonlySet<string> = new Set([
  "nova-scheduler",
  "nova-conductor",
  // Its nodes move to the others on Ironic's hash ring, so one down of several loses nothing.
  "ironic-conductor",
]);

export function isOpenStackServiceQuiet(data: {
  service?: string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (!data.service || OPENSTACK_SERVICES_EVERY_CLOUD_RUNS.has(data.service)) {
    return false;
  }
  const minutes: number | null = minutesInState({
    stateChangedAt: data.lastSeenAt,
    now: data.now,
  });
  return minutes !== null && minutes >= OPENSTACK_QUIET_SERVICE_MINUTES;
}

export function isOpenStackAdminDisabled(
  adminState: string | null | undefined,
): boolean {
  return adminState === "disabled" || adminState === "down";
}

export function isOpenStackServiceDown(data: {
  status?: string | null | undefined;
  adminState?: string | null | undefined;
}): boolean {
  return (
    data.status === OPENSTACK_SERVICE_STATUS_DOWN &&
    !isOpenStackAdminDisabled(data.adminState)
  );
}

/*
 * An operator told Nova this service is down, usually so its instances can be evacuated. It reads
 * down whatever the service is doing, and only until someone lets it back up. Only a native read
 * of Nova says so: the exporter's series have no such label, and then this is simply not known.
 */
export function isOpenStackServiceForcedDown(data: {
  status?: string | null | undefined;
  facts?: JSONObject | null | undefined;
}): boolean {
  return (
    data.status === OPENSTACK_SERVICE_STATUS_DOWN &&
    data.facts?.["forcedDown"] === true
  );
}

/*
 * Nova names a service by its short host name and a hypervisor by its full one, and
 * Placement agrees with the hypervisor: `compute-01` and
 * `compute-01.example.internal` are one machine. Anything joining the two compares
 * this. An IP address has no short form, so it is left whole.
 */
const IPV4_ADDRESS: RegExp = /^[0-9.]+$/;

export function getOpenStackShortHostName(
  hostName: string | null | undefined,
): string {
  const name: string = (hostName || "").trim();
  if (IPV4_ADDRESS.test(name) || name.includes(":")) {
    return name;
  }
  const dot: number = name.indexOf(".");
  return dot > 0 ? name.substring(0, dot) : name;
}

export function isSameOpenStackHost(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  const short: string = getOpenStackShortHostName(first);
  return short !== "" && short === getOpenStackShortHostName(second);
}

/*
 * Whether a floating IP is in use. Neutron sets its router only once it is associated
 * with a port, and that router is the one thing every source says: the exporter has
 * no port label, and the APIs say both. A spare address is meant to be DOWN.
 */
export function isOpenStackFloatingIpAssociated(
  facts: JSONObject | null | undefined,
): boolean {
  return Boolean(facts?.["routerId"] || facts?.["portId"]);
}

export function minutesInState(data: {
  stateChangedAt?: Date | string | null | undefined;
  now: Date;
}): number | null {
  if (!data.stateChangedAt) {
    return null;
  }
  const changedAt: Date = new Date(data.stateChangedAt);
  if (isNaN(changedAt.getTime())) {
    return null;
  }
  return Math.max(0, (data.now.getTime() - changedAt.getTime()) / 60000);
}

export function isOpenStackInstanceStuck(data: {
  status?: string | null | undefined;
  stateChangedAt?: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (
    !data.status ||
    !OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES.has(data.status)
  ) {
    return false;
  }
  const minutes: number | null = minutesInState(data);
  return minutes !== null && minutes >= OPENSTACK_INSTANCE_STUCK_MINUTES;
}

export function isOpenStackVolumeStuck(data: {
  status?: string | null | undefined;
  stateChangedAt?: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (
    !data.status ||
    !OPENSTACK_VOLUME_TRANSITIONAL_STATUSES.has(data.status)
  ) {
    return false;
  }
  const minutes: number | null = minutesInState(data);
  return minutes !== null && minutes >= OPENSTACK_VOLUME_STUCK_MINUTES;
}

export function isOpenStackImageStuck(data: {
  status?: string | null | undefined;
  stateChangedAt?: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (!data.status || !OPENSTACK_IMAGE_TRANSITIONAL_STATUSES.has(data.status)) {
    return false;
  }
  const minutes: number | null = minutesInState(data);
  return minutes !== null && minutes >= OPENSTACK_IMAGE_STUCK_MINUTES;
}

export function isOpenStackBareMetalNodeInError(
  status: string | null | undefined,
): boolean {
  return Boolean(status && OPENSTACK_BARE_METAL_ERROR_STATES.has(status));
}

export function isOpenStackBareMetalNodeInMaintenance(
  adminState: string | null | undefined,
): boolean {
  return adminState === OPENSTACK_BARE_METAL_IN_MAINTENANCE;
}

/*
 * When Ironic last saw a node move, or OneUptime last saw it change state when Ironic has not said.
 * provision_updated_at is the better of the two: it says what happened before anyone was watching,
 * and a step that heartbeats keeps moving it, so a long erase is not a node stuck.
 */
function getOpenStackBareMetalMovedAt(data: {
  stateChangedAt?: Date | string | null | undefined;
  provisionUpdatedAt?: Date | string | null | undefined;
}): Date | string | null | undefined {
  return data.provisionUpdatedAt || data.stateChangedAt;
}

// A node someone put in maintenance is planned, whatever word it stopped at.
export function isOpenStackBareMetalNodeStuck(data: {
  status?: string | null | undefined;
  adminState?: string | null | undefined;
  stateChangedAt?: Date | string | null | undefined;
  provisionUpdatedAt?: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (
    !data.status ||
    !OPENSTACK_BARE_METAL_TRANSITIONAL_STATES.has(data.status) ||
    isOpenStackBareMetalNodeInMaintenance(data.adminState)
  ) {
    return false;
  }
  const minutes: number | null = minutesInState({
    stateChangedAt: getOpenStackBareMetalMovedAt(data),
    now: data.now,
  });
  return minutes !== null && minutes >= OPENSTACK_BARE_METAL_STUCK_MINUTES;
}

export function isOpenStackBareMetalMaintenanceTooLong(data: {
  adminState?: string | null | undefined;
  stateChangedAt?: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (!isOpenStackBareMetalNodeInMaintenance(data.adminState)) {
    return false;
  }
  const minutes: number | null = minutesInState({
    stateChangedAt: data.stateChangedAt,
    now: data.now,
  });
  return (
    minutes !== null &&
    minutes >= OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS * 24 * 60
  );
}

/*
 * A deployed node with its power off: whatever runs on it has stopped. Nothing else counts. An
 * empty power state is not known rather than wrong (recorded: an `available` node reads None until
 * something has set it), and a node that is not deployed may be on or off for good reason: a failed
 * deploy leaves it on, and fast-track keeps one on between deploys.
 *
 * An instance someone stopped does this too, and that is planned: Nova powers its node off and
 * Ironic leaves it active. Only something holding that instance's status can tell, which a page and
 * the server's read can, and an alert cannot: it reads one series.
 */
export function isOpenStackBareMetalPowerUnexpected(data: {
  status?: string | null | undefined;
  adminState?: string | null | undefined;
  powerState?: string | null | undefined;
  instanceStatus?: string | null | undefined;
}): boolean {
  return (
    data.status === "active" &&
    data.powerState === "power off" &&
    data.instanceStatus !== "SHUTOFF" &&
    !isOpenStackBareMetalNodeInMaintenance(data.adminState)
  );
}

/*
 * Whether Nova could put an instance on a node, by the rule its Ironic driver reports to Placement
 * (_node_resources_unavailable): in `available`, out of maintenance, and with a power state it can
 * read. Recorded: services-ironic holds `available` nodes reading None, and Placement has each of
 * them all reserved. A retired node is on its way out, and Ironic will not make it available again.
 */
export function canOpenStackBareMetalNodeTakeAnInstance(data: {
  status?: string | null | undefined;
  adminState?: string | null | undefined;
  powerState?: string | null | undefined;
  isRetired?: boolean | null | undefined;
}): boolean {
  return (
    data.status === "available" &&
    !isOpenStackBareMetalNodeInMaintenance(data.adminState) &&
    Boolean(data.powerState) &&
    data.powerState !== "error" &&
    data.isRetired !== true
  );
}

/*
 * What Nova's Ironic driver calls a node, as a hypervisor and as a Placement provider: its UUID. No
 * other driver names a hypervisor that way (libvirt's is its host name, VMware's a domain and a
 * UUID), though a host could be called anything, so nothing reads this alone: see
 * OpenStackSnapshotScan. Linear, and on a short value anyway: a label is a host name.
 */
const UUID_GROUP_LENGTHS: ReadonlyArray<number> = [8, 4, 4, 4, 12];
const HEX_DIGITS: string = "0123456789abcdefABCDEF";

export function isOpenStackBareMetalNodeId(
  name: string | null | undefined,
): boolean {
  if (!name || name.length !== 36) {
    return false;
  }
  let at: number = 0;
  for (const [index, length] of UUID_GROUP_LENGTHS.entries()) {
    for (let digit: number = 0; digit < length; digit++, at++) {
      if (!HEX_DIGITS.includes(name.charAt(at))) {
        return false;
      }
    }
    if (index < UUID_GROUP_LENGTHS.length - 1) {
      if (name.charAt(at) !== "-") {
        return false;
      }
      at++;
    }
  }
  return true;
}

export function isOpenStackVolumeInError(
  status: string | null | undefined,
): boolean {
  return Boolean(status && OPENSTACK_VOLUME_ERROR_STATUSES.has(status));
}

export function isOpenStackStackFailed(
  status: string | null | undefined,
): boolean {
  return Boolean(status && OPENSTACK_STACK_FAILED_STATUSES.has(status));
}

export function isOpenStackStackStuck(data: {
  status?: string | null | undefined;
  stateChangedAt?: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (!data.status || !OPENSTACK_STACK_IN_PROGRESS_STATUSES.has(data.status)) {
    return false;
  }
  const minutes: number | null = minutesInState(data);
  return minutes !== null && minutes >= OPENSTACK_STACK_STUCK_MINUTES;
}

export function isOpenStackContainerClusterFailed(
  status: string | null | undefined,
): boolean {
  return Boolean(
    status && OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES.has(status),
  );
}

export function isOpenStackContainerClusterStuck(data: {
  status?: string | null | undefined;
  stateChangedAt?: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (
    !data.status ||
    !OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES.has(data.status)
  ) {
    return false;
  }
  const minutes: number | null = minutesInState(data);
  return (
    minutes !== null && minutes >= OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES
  );
}

// A share of a whole, or null when there is no whole to share.
export function percentOf(
  part: number | null | undefined,
  whole: number | null | undefined,
): number | null {
  if (
    part === null ||
    part === undefined ||
    whole === null ||
    whole === undefined ||
    !Number.isFinite(part) ||
    !Number.isFinite(whole) ||
    whole <= 0
  ) {
    return null;
  }
  return (part / whole) * 100;
}

/*
 * Whether a project is at its quota: at OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT or past
 * it. A limit of -1 means no limit, and a limit of 0 is a project that may hold none of
 * these on purpose, so neither is ever at anything. Compared without dividing, so 9 of
 * 10 is exactly on the line here and in the SQL that picks the same rows.
 */
export function isOpenStackQuotaAtLine(data: {
  used: number;
  limit: number;
}): boolean {
  return (
    data.limit > 0 &&
    data.used * 100 >= data.limit * OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT
  );
}

function numberFact(
  facts: JSONObject | null | undefined,
  key: string,
): number | null {
  const value: JSONValue | undefined = facts?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// How much of a network's addresses are taken, added up across its subnets.
export function getOpenStackNetworkIpPercent(
  facts: JSONObject | null | undefined,
): number | null {
  return percentOf(numberFact(facts, "ipsUsed"), numberFact(facts, "ipsTotal"));
}

export interface OpenStackL3AgentFact {
  host: string | null;
  isAlive: boolean;
  isAdminUp: boolean;
  haState: string | null;
}

/*
 * Which agents hold a router. Empty on a cloud with no such agents: OVN has none,
 * so a router there has nothing to be missing.
 */
export function getOpenStackRouterAgents(
  facts: JSONObject | null | undefined,
): Array<OpenStackL3AgentFact> {
  const agents: JSONValue | undefined = facts?.["l3Agents"];
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return [];
  }
  return Object.values(agents as JSONObject).map(
    (agent: JSONValue): OpenStackL3AgentFact => {
      const value: JSONObject = (agent as JSONObject) || {};
      return {
        host: (value["host"] as string) || null,
        isAlive: value["isAlive"] === true,
        isAdminUp: value["isAdminUp"] === true,
        haState: (value["haState"] as string) || null,
      };
    },
  );
}

import { JSONObject, JSONValue } from "../JSON";
import {
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_SERVICE_STATUS_DOWN,
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

/*
 * A service someone disabled is planned work, until it has been so long that
 * somebody probably forgot it.
 */
export const OPENSTACK_SERVICE_DISABLED_WARNING_DAYS: number = 7;

/*
 * What an operator set: Nova and Cinder say enabled or disabled, Neutron says up or
 * down. Nothing here is a failure, whichever word it is in.
 */
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
 * Nova names a service by its short host name and a hypervisor by its full one, and
 * Placement agrees with the hypervisor: `compute-01` and
 * `compute-01.example.internal` are one machine. Anything joining the two compares
 * this. An IP address has no short form, so it is left whole.
 */
export function getOpenStackShortHostName(
  hostName: string | null | undefined,
): string {
  const name: string = (hostName || "").trim();
  if (/^[0-9.]+$/.test(name) || name.includes(":")) {
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

export function isOpenStackVolumeInError(
  status: string | null | undefined,
): boolean {
  return Boolean(status && OPENSTACK_VOLUME_ERROR_STATUSES.has(status));
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

function numberFact(facts: JSONObject | null | undefined, key: string): number | null {
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

import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_IP_POOL_EXHAUSTED_PERCENT,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  OpenStackL3AgentFact,
  getOpenStackNetworkIpPercent,
  getOpenStackRouterAgents,
  getOpenStackShortHostName,
  isOpenStackAdminDisabled,
  isOpenStackFloatingIpAssociated,
  isOpenStackServiceDown,
  isSameOpenStackHost,
  minutesInState,
  percentOf,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_SERVICE_STATUS_UP,
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  OpenStackStatusReading,
  getOpenStackStatusReading,
} from "../../../Components/OpenStack/OpenStackStatus";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
  ResourceHealth,
} from "../../../Components/ResourcePart/ResourceAttention";
import {
  ResourcePartStatus,
  ResourcePartTone,
} from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  OpenIssueRecord,
  readSeriesLabel,
} from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import {
  OPENSTACK_REASON_INSTANCE_ERROR,
  OpenStackAssessment,
  OpenStackRouteFor,
  assessOpenStackResource,
  formatOpenStackDuration,
  getOpenStackAttentionItems,
  getOpenStackHealth,
} from "./OpenStackHealth";

/*
 * WHAT A PART OF AN OPENSTACK CLOUD IS, IN THE WORDS ITS PAGES USE.
 *
 * OpenStackHealth says what needs someone. This says what a part is: its state as a
 * list and its page draw it, what Placement has promised on a hypervisor and at what
 * ratio, which agents hold a router, whether a floating IP is in use, what a zone or an
 * aggregate adds up to, and which of the alert templates watch each kind of part.
 *
 * Three things hold everywhere here:
 *
 *  - It reads OpenStack's own words and the rules' lines, and draws none of its own.
 *  - What was not collected is said to be not collected. A hypervisor Nova lost keeps
 *    its last numbers, which are not current and never idle capacity; an instance's
 *    addresses are empty in the exporter's output; a pool's volumes are not in it at
 *    all. A page says so, and never reads any of them as zero or as nothing wrong.
 *  - A hypervisor's own name is the full one, a Service row's host the short one. Only
 *    isSameOpenStackHost joins the two.
 *
 * Words are English, marked with translationKey() and looked up in the reader's
 * language where they are drawn. React-free, so tests can read it.
 */

const REASON_LAST_KNOWN: string = translationKey(
  "nova-compute is down. Its numbers are last known",
);
const STATE_HAS_ROOM: string = translationKey("Has room");
const STATE_FILLING_UP: string = translationKey("Filling up");
const STATE_NEARLY_FULL: string = translationKey("Nearly full");

// Nova's own zone for its control services: never one anyone counts.
export const OPENSTACK_INTERNAL_ZONE: string = "internal";

/*
 * The recommended alerts that watch each kind of part, in the order a part's Alerts
 * card lists them. Each is one monitor on the cloud that fires for any part crossing
 * it. Some are by region rather than by part, because that is all the exporter counts
 * (a floating IP's), and the card says it watches the whole cloud.
 */
export const OPENSTACK_HYPERVISOR_ALERT_TEMPLATE_IDS: Array<string> = [
  "openstack-compute-service-down",
  "openstack-vcpu-allocation-high",
  "openstack-memory-allocation-high",
  "openstack-local-disk-allocation-high",
];

export const OPENSTACK_INSTANCE_ALERT_TEMPLATE_IDS: Array<string> = [
  "openstack-instances-in-error",
  "openstack-instance-stuck-building",
  "openstack-instance-stuck-transitioning",
  "openstack-instance-stuck-in-verify-resize",
];

export const OPENSTACK_NETWORK_ALERT_TEMPLATE_IDS: Array<string> = [
  "openstack-external-ip-pool-nearly-full",
  "openstack-network-out-of-ips",
];

export const OPENSTACK_ROUTER_ALERT_TEMPLATE_IDS: Array<string> = [
  "openstack-router-not-active",
  "openstack-router-without-active-agent",
  "openstack-router-with-two-active-agents",
];

export const OPENSTACK_FLOATING_IP_ALERT_TEMPLATE_IDS: Array<string> = [
  "openstack-floating-ip-not-active",
];

export const OPENSTACK_NETWORK_AGENT_ALERT_TEMPLATE_IDS: Array<string> = [
  "openstack-network-agent-down",
];

export const OPENSTACK_VOLUME_ALERT_TEMPLATE_IDS: Array<string> = [
  "openstack-volumes-in-error",
  "openstack-volume-stuck",
];

export const OPENSTACK_STORAGE_POOL_ALERT_TEMPLATE_IDS: Array<string> = [
  "openstack-storage-pool-warning",
  "openstack-storage-pool-critical",
];

function factsOf(row: OpenStackResource | null | undefined): JSONObject {
  return (row?.facts as JSONObject | undefined) || {};
}

function textFact(
  row: OpenStackResource | null | undefined,
  name: string,
): string {
  const value: JSONValue | undefined = factsOf(row)[name];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function numberFact(
  row: OpenStackResource | null | undefined,
  name: string,
): number | null {
  const value: JSONValue | undefined = factsOf(row)[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/*
 * ---------------------------------------------------------------------------
 * How rows name each other
 * ---------------------------------------------------------------------------
 *
 * Only UUIDs are unique across a cloud, so a hypervisor's, a flavor's and a pool's rows
 * carry their region in their external id (OpenStackSnapshotScan).
 */
function regional(regionName: string | null | undefined, id: string): string {
  return `${regionName || "default"}/${id}`;
}

export function getOpenStackHypervisorExternalId(
  regionName: string | null | undefined,
  hypervisorName: string,
): string {
  return regional(regionName, hypervisorName);
}

export function getOpenStackFlavorExternalId(
  regionName: string | null | undefined,
  flavorId: string,
): string {
  return regional(regionName, flavorId);
}

// Nova's own id for a flavor, without the region its row is keyed by.
export function getOpenStackFlavorId(
  row: Pick<OpenStackResource, "externalId" | "regionName">,
): string {
  const externalId: string = row.externalId || "";
  const prefix: string = `${row.regionName || "default"}/`;
  return externalId.startsWith(prefix)
    ? externalId.substring(prefix.length)
    : externalId;
}

// What a part goes by: its name, or the end of its id when OpenStack gave it none.
export function getOpenStackPartName(
  row: Pick<OpenStackResource, "name"> | null | undefined,
  externalId: string,
): string {
  return row?.name || externalId.substring(externalId.lastIndexOf("/") + 1);
}

/*
 * ---------------------------------------------------------------------------
 * A row's state: its word, its tone, and why
 * ---------------------------------------------------------------------------
 */
export interface OpenStackRowState {
  // English to look up, or OpenStack's own word to draw as written.
  label: string;
  isOpenStackWord: boolean;
  tone: ResourcePartTone;
  // The operator's words for why it is disabled, as written. Never looked up.
  writtenReason?: string | undefined;
  // What the rules say, at the alert templates' lines.
  reasons: Array<ResourceAttentionText>;
}

/*
 * A reason that says nothing the word beside it has not: "ERROR", "In ERROR". A stuck
 * part's says what the word beside it doesn't: "Stuck", "BUILD for 3h".
 */
function repeatsItsWord(reason: ResourceAttentionText, word: string): boolean {
  return (
    reason.text === OPENSTACK_REASON_INSTANCE_ERROR ||
    reason.values?.["status"] === word
  );
}

// What the rules say can only make a word read worse, never better.
function worseTone(
  tone: ResourcePartTone,
  assessment: OpenStackAssessment,
): ResourcePartTone {
  if (
    tone === "danger" ||
    assessment.severity === ResourceAttentionSeverity.Critical
  ) {
    return "danger";
  }
  return assessment.severity === ResourceAttentionSeverity.Warning
    ? "warning"
    : tone;
}

/*
 * A pool reports no state of its own, only how full it is, so that is its state. At the
 * storage pool templates' two lines.
 */
function getOpenStackStoragePoolReading(
  row: OpenStackResource,
): OpenStackStatusReading | null {
  const percent: number | null = percentOf(
    row.diskAllocatedBytes,
    row.diskCapacityBytes,
  );
  if (percent === null) {
    return null;
  }
  if (percent > OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT) {
    return { label: STATE_NEARLY_FULL, tone: "danger", isOpenStackWord: false };
  }
  if (percent > OPENSTACK_STORAGE_POOL_WARNING_PERCENT) {
    return { label: STATE_FILLING_UP, tone: "warning", isOpenStackWord: false };
  }
  return { label: STATE_HAS_ROOM, tone: "positive", isOpenStackWord: false };
}

/*
 * The state a list's row and a part's hero both show. Null for a row with nothing to
 * say: a hypervisor whose credential can't read Nova's services, say.
 */
export function getOpenStackRowState(
  row: OpenStackResource,
  now: Date,
): OpenStackRowState | null {
  const reading: OpenStackStatusReading | null =
    row.kind === OpenStackResourceKind.StoragePool
      ? getOpenStackStoragePoolReading(row)
      : getOpenStackStatusReading({
          kind: row.kind,
          status: row.status,
          adminState: row.adminState,
          disabledReason: row.disabledReason,
          isScrapeFailed: factsOf(row)["scrapeFailed"] === true,
          stateChangedAt: row.stateChangedAt,
          now,
        });

  if (!reading) {
    return null;
  }

  const assessment: OpenStackAssessment = assessOpenStackResource({ row, now });
  const reasons: Array<ResourceAttentionText> = assessment.reasons.filter(
    (reason: ResourceAttentionText): boolean => {
      return !repeatsItsWord(reason, reading.label);
    },
  );

  if (isOpenStackHypervisorLost(row)) {
    reasons.push({ text: REASON_LAST_KNOWN });
  }

  // How full a pool is, in a word and then in a number, is said once by its Used column.
  const isPool: boolean = row.kind === OpenStackResourceKind.StoragePool;

  return {
    label: reading.label,
    isOpenStackWord: reading.isOpenStackWord,
    tone: worseTone(reading.tone, assessment),
    writtenReason: reading.writtenReason,
    reasons: isPool ? [] : reasons,
  };
}

// The same state, as ResourcePartHero draws it.
export function getOpenStackPartStatus(
  row: OpenStackResource,
  now: Date,
): ResourcePartStatus | null {
  const state: OpenStackRowState | null = getOpenStackRowState(row, now);
  if (!state) {
    return null;
  }
  return state.isOpenStackWord
    ? {
        label: "{{status}}",
        values: { status: state.label },
        tone: state.tone,
      }
    : { label: state.label, tone: state.tone };
}

// How long a part has been in its state, as far as OneUptime has seen.
export function getOpenStackTimeInState(
  row: Pick<OpenStackResource, "stateChangedAt">,
  now: Date,
): string {
  const minutes: number | null = minutesInState({
    stateChangedAt: row.stateChangedAt,
    now,
  });
  return minutes === null ? "" : formatOpenStackDuration(minutes);
}

/*
 * ---------------------------------------------------------------------------
 * Hypervisors: what is promised, at what ratio, and when it is only last known
 * ---------------------------------------------------------------------------
 */

// Nova lost it. Its numbers keep arriving, as the last ones it had.
export function isOpenStackHypervisorLost(
  row: Pick<OpenStackResource, "kind" | "status" | "adminState">,
): boolean {
  return (
    row.kind === OpenStackResourceKind.Hypervisor &&
    isOpenStackServiceDown({ status: row.status, adminState: row.adminState })
  );
}

// Whether it can take instances: only this counts as room anywhere on these pages.
export function canOpenStackHypervisorGive(
  row: Pick<OpenStackResource, "status" | "adminState">,
): boolean {
  return (
    !isOpenStackServiceDown({
      status: row.status,
      adminState: row.adminState,
    }) && !isOpenStackAdminDisabled(row.adminState)
  );
}

export type OpenStackAllocationKey = "vcpu" | "memory" | "disk";

export interface OpenStackAllocationLine {
  key: OpenStackAllocationKey;
  // "vCPUs allocated": always allocated, never "CPU", because this is not load.
  title: string;
  taken: number | null;
  capacity: number | null;
  percent: number | null;
  // Placement's allocation ratio, from facts.allocationRatios. Null when Nova said.
  ratio: number | null;
  isOverLine: boolean;
  isLastKnown: boolean;
}

export const OPENSTACK_ALLOCATION_TITLES: Record<
  OpenStackAllocationKey,
  string
> = {
  vcpu: translationKey("vCPUs allocated"),
  memory: translationKey("Memory allocated"),
  disk: translationKey("Local disk allocated"),
};

export function getOpenStackAllocationLines(
  row: OpenStackResource,
): Array<OpenStackAllocationLine> {
  const ratios: JSONObject =
    (factsOf(row)["allocationRatios"] as JSONObject | undefined) || {};
  const isLastKnown: boolean = isOpenStackHypervisorLost(row);

  const line: (data: {
    key: OpenStackAllocationKey;
    taken: number | undefined;
    capacity: number | undefined;
    resource: string;
  }) => OpenStackAllocationLine = (data: {
    key: OpenStackAllocationKey;
    taken: number | undefined;
    capacity: number | undefined;
    resource: string;
  }): OpenStackAllocationLine => {
    const percent: number | null = percentOf(data.taken, data.capacity);
    const ratio: JSONValue | undefined = ratios[data.resource];
    return {
      key: data.key,
      title: OPENSTACK_ALLOCATION_TITLES[data.key],
      taken: data.taken ?? null,
      capacity: data.capacity ?? null,
      percent: percent,
      ratio: typeof ratio === "number" ? ratio : null,
      isOverLine:
        !isLastKnown &&
        percent !== null &&
        percent > OPENSTACK_ALLOCATION_WARNING_PERCENT,
      isLastKnown: isLastKnown,
    };
  };

  return [
    line({
      key: "vcpu",
      taken: row.vcpuAllocated,
      capacity: row.vcpuCapacity,
      resource: "VCPU",
    }),
    line({
      key: "memory",
      taken: row.memoryAllocatedBytes,
      capacity: row.memoryCapacityBytes,
      resource: "MEMORY_MB",
    }),
    line({
      key: "disk",
      taken: row.diskAllocatedBytes,
      capacity: row.diskCapacityBytes,
      resource: "DISK_GB",
    }),
  ];
}

// "16:1", as `openstack allocation candidate list` and every operator write it.
export function formatOpenStackAllocationRatio(ratio: number | null): string {
  if (ratio === null) {
    return "";
  }
  return `${Number.isInteger(ratio) ? ratio : ratio.toFixed(1)}:1`;
}

// A hypervisor's aggregates, as the exporter joins them: "gpu,ssd".
export function parseOpenStackAggregates(
  row: OpenStackResource | null | undefined,
): Array<string> {
  return textFact(row, "aggregates")
    .split(",")
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });
}

/*
 * ---------------------------------------------------------------------------
 * Availability zones and aggregates
 * ---------------------------------------------------------------------------
 *
 * Neither has a row of its own: a zone and an aggregate are what hypervisors say about
 * themselves. Hypervisors are few even on a large cloud, and the needs-attention read
 * brings them whole, so these add up on the page, through the same rules every list
 * reads, rather than through a second set of them in SQL.
 */
export type OpenStackHostGroupKind = "zone" | "aggregate";

export interface OpenStackHostGroup {
  kind: OpenStackHostGroupKind;
  // A zone's or an aggregate's name, unique within its region.
  name: string;
  regionName: string;
  // What its page is found by: `${regionName}/${name}`.
  id: string;
  hypervisors: Array<OpenStackResource>;
  total: number;
  up: number;
  lost: number;
  disabled: number;
  // What can be promised and has been, from the hypervisors that can give.
  vcpuAllocated: number;
  vcpuCapacity: number;
  memoryAllocatedBytes: number;
  memoryCapacityBytes: number;
  diskAllocatedBytes: number;
  diskCapacityBytes: number;
  // Last known for a hypervisor Nova lost, whose instances are still on it.
  instanceCount: number;
  health: ResourceHealth;
  attention: Array<ResourceAttentionItem>;
}

export function getOpenStackHostGroupId(
  regionName: string | null | undefined,
  name: string,
): string {
  return `${regionName || ""}/${name}`;
}

export function parseOpenStackHostGroupId(id: string): {
  regionName: string;
  name: string;
} {
  const slash: number = id.indexOf("/");
  return slash < 0
    ? { regionName: "", name: id }
    : { regionName: id.substring(0, slash), name: id.substring(slash + 1) };
}

export function getOpenStackHostGroupNames(
  row: OpenStackResource,
  kind: OpenStackHostGroupKind,
): Array<string> {
  if (kind === "aggregate") {
    return parseOpenStackAggregates(row);
  }
  const zone: string = row.availabilityZone || "";
  return zone && zone !== OPENSTACK_INTERNAL_ZONE ? [zone] : [];
}

/*
 * Each group's hypervisors, and what they add up to. `rows` is what the needs-attention
 * read brought: every hypervisor and service, and the instances, volumes and the rest
 * that may need someone, of which a group takes the ones on its hypervisors.
 */
export function getOpenStackHostGroups(data: {
  rows: Array<OpenStackResource>;
  kind: OpenStackHostGroupKind;
  now: Date;
  routeFor?: OpenStackRouteFor | undefined;
}): Array<OpenStackHostGroup> {
  const groups: Map<string, OpenStackHostGroup> = new Map();

  for (const row of data.rows) {
    if (row.kind !== OpenStackResourceKind.Hypervisor) {
      continue;
    }
    for (const name of getOpenStackHostGroupNames(row, data.kind)) {
      const id: string = getOpenStackHostGroupId(row.regionName, name);
      const group: OpenStackHostGroup = groups.get(id) || {
        kind: data.kind,
        name,
        regionName: row.regionName || "",
        id,
        hypervisors: [],
        total: 0,
        up: 0,
        lost: 0,
        disabled: 0,
        vcpuAllocated: 0,
        vcpuCapacity: 0,
        memoryAllocatedBytes: 0,
        memoryCapacityBytes: 0,
        diskAllocatedBytes: 0,
        diskCapacityBytes: 0,
        instanceCount: 0,
        health: "Healthy",
        attention: [],
      };
      group.hypervisors.push(row);
      group.total += 1;
      group.instanceCount += row.instanceCount || 0;
      if (isOpenStackAdminDisabled(row.adminState)) {
        group.disabled += 1;
      } else if (isOpenStackHypervisorLost(row)) {
        group.lost += 1;
      } else if (row.status === OPENSTACK_SERVICE_STATUS_UP) {
        group.up += 1;
      }
      if (canOpenStackHypervisorGive(row)) {
        group.vcpuAllocated += row.vcpuAllocated || 0;
        group.vcpuCapacity += row.vcpuCapacity || 0;
        group.memoryAllocatedBytes += row.memoryAllocatedBytes || 0;
        group.memoryCapacityBytes += row.memoryCapacityBytes || 0;
        group.diskAllocatedBytes += row.diskAllocatedBytes || 0;
        group.diskCapacityBytes += row.diskCapacityBytes || 0;
      }
      groups.set(id, group);
    }
  }

  for (const group of groups.values()) {
    const rows: Array<OpenStackResource> = getOpenStackRowsOfHostGroup(
      group,
      data.rows,
    );
    group.attention = getOpenStackAttentionItems({
      rows,
      now: data.now,
      routeFor: data.routeFor,
    });
    group.health = getOpenStackHealth(group.attention);
  }

  return Array.from(groups.values()).sort(
    (first: OpenStackHostGroup, second: OpenStackHostGroup): number => {
      return (
        first.regionName.localeCompare(second.regionName) ||
        first.name.localeCompare(second.name, undefined, { numeric: true })
      );
    },
  );
}

// A group's hypervisors, their nova-computes, and what may need someone on them.
export function getOpenStackRowsOfHostGroup(
  group: Pick<OpenStackHostGroup, "hypervisors" | "regionName">,
  rows: Array<OpenStackResource>,
): Array<OpenStackResource> {
  const hypervisorNames: Set<string> = new Set(
    group.hypervisors.map((row: OpenStackResource): string => {
      return row.hypervisorName || "";
    }),
  );
  const shortNames: Set<string> = new Set(
    group.hypervisors.map((row: OpenStackResource): string => {
      return getOpenStackShortHostName(row.hypervisorName);
    }),
  );

  return rows.filter((row: OpenStackResource): boolean => {
    if (row.regionName !== (group.regionName || undefined)) {
      return false;
    }
    if (row.kind === OpenStackResourceKind.Hypervisor) {
      return hypervisorNames.has(row.hypervisorName || "");
    }
    if (row.kind === OpenStackResourceKind.Instance) {
      return hypervisorNames.has(row.hypervisorName || "");
    }
    if (row.kind === OpenStackResourceKind.Service) {
      return (
        row.name === "nova-compute" &&
        shortNames.has(getOpenStackShortHostName(textFact(row, "host")))
      );
    }
    return false;
  });
}

/*
 * ---------------------------------------------------------------------------
 * Instances
 * ---------------------------------------------------------------------------
 */
export interface OpenStackInstanceAddresses {
  ipv4: string;
  ipv6: string;
  isKnown: boolean;
}

/*
 * The exporter's address labels are empty on a real cloud, whatever its code says, so an
 * empty one is not an instance with no address. A page says it is not collected.
 */
export function getOpenStackInstanceAddresses(
  row: OpenStackResource | null | undefined,
): OpenStackInstanceAddresses {
  const ipv4: string = textFact(row, "addressIpv4");
  const ipv6: string = textFact(row, "addressIpv6");
  return { ipv4, ipv6, isKnown: Boolean(ipv4 || ipv6) };
}

// An instance that failed before it was placed has no hypervisor. That is its story.
export function isOpenStackInstanceUnplaced(
  row: Pick<OpenStackResource, "kind" | "hypervisorName">,
): boolean {
  return (
    row.kind === OpenStackResourceKind.Instance && !row.hypervisorName
  );
}

/*
 * ---------------------------------------------------------------------------
 * Networks and subnets
 * ---------------------------------------------------------------------------
 */
export interface OpenStackSubnetAddresses {
  // The subnet's name, or its CIDR when it has none.
  name: string;
  cidr: string;
  ipVersion: string;
  used: number | null;
  total: number | null;
  /*
   * Null for IPv6: a /64 is 2^64 addresses, and no share of that says anything. The
   * alert templates read IPv4 alone for the same reason.
   */
  percent: number | null;
}

export function getOpenStackNetworkSubnets(
  row: OpenStackResource | null | undefined,
): Array<OpenStackSubnetAddresses> {
  const subnets: JSONValue | undefined = factsOf(row)["ipsBySubnet"];
  if (!subnets || typeof subnets !== "object" || Array.isArray(subnets)) {
    return [];
  }
  return Object.keys(subnets as JSONObject)
    .map((name: string): OpenStackSubnetAddresses => {
      const subnet: JSONObject =
        ((subnets as JSONObject)[name] as JSONObject) || {};
      const used: number | null =
        typeof subnet["used"] === "number" ? subnet["used"] : null;
      const total: number | null =
        typeof subnet["total"] === "number" ? subnet["total"] : null;
      const ipVersion: string =
        typeof subnet["ipVersion"] === "string" ? subnet["ipVersion"] : "";
      return {
        name,
        cidr: typeof subnet["cidr"] === "string" ? subnet["cidr"] : "",
        ipVersion,
        used,
        total,
        percent: ipVersion === "6" ? null : percentOf(used, total),
      };
    })
    .sort(
      (
        first: OpenStackSubnetAddresses,
        second: OpenStackSubnetAddresses,
      ): number => {
        return (
          first.ipVersion.localeCompare(second.ipVersion) ||
          first.name.localeCompare(second.name, undefined, { numeric: true })
        );
      },
    );
}

export function getOpenStackAddressesFree(
  row: OpenStackResource | null | undefined,
): number | null {
  const used: number | null = numberFact(row, "ipsUsed");
  const total: number | null = numberFact(row, "ipsTotal");
  return used === null || total === null ? null : Math.max(total - used, 0);
}

/*
 * The same two lines as the external pool templates, for a bar: only an external network
 * ever asks anyone for anything, and a tenant's own network filling up is theirs to see.
 */
export function getOpenStackAddressesTone(
  row: OpenStackResource,
): "positive" | "warning" | "danger" | undefined {
  const percent: number | null = getOpenStackNetworkIpPercent(factsOf(row));
  if (percent === null) {
    return undefined;
  }
  if (percent >= OPENSTACK_IP_POOL_EXHAUSTED_PERCENT) {
    return "danger";
  }
  return percent > OPENSTACK_IP_POOL_WARNING_PERCENT ? "warning" : "positive";
}

export function isOpenStackNetworkExternal(
  row: OpenStackResource | null | undefined,
): boolean {
  return factsOf(row)["isExternal"] === true;
}

export function isOpenStackNetworkShared(
  row: OpenStackResource | null | undefined,
): boolean {
  return factsOf(row)["isShared"] === true;
}

// The network's own subnet's numbers, read from its network's row by name, then CIDR.
export function getOpenStackSubnetAddresses(data: {
  subnet: OpenStackResource;
  network: OpenStackResource | null | undefined;
}): OpenStackSubnetAddresses | null {
  const cidr: string = textFact(data.subnet, "cidr");
  const name: string = data.subnet.name || "";
  return (
    getOpenStackNetworkSubnets(data.network).find(
      (subnet: OpenStackSubnetAddresses): boolean => {
        return (
          (Boolean(cidr) && subnet.cidr === cidr) ||
          (Boolean(name) && subnet.name === name)
        );
      },
    ) || null
  );
}

/*
 * ---------------------------------------------------------------------------
 * Routers and the agents that hold them
 * ---------------------------------------------------------------------------
 */
export type OpenStackNetworkBackend = "ml2-ovs" | "ovn" | "unknown";

/*
 * Read from what the agents list reports, never from a setting: an L3 agent says ML2/OVS,
 * an OVN agent says OVN, and a credential that can't list agents can't say. The names
 * differ by release ("ovn-controller", "OVN Controller agent", "neutron-ovn-agent").
 */
export function getOpenStackNetworkBackend(
  agentNames: ReadonlyArray<string | null | undefined>,
): OpenStackNetworkBackend {
  let isOvn: boolean = false;
  for (const name of agentNames) {
    const lower: string = (name || "").toLowerCase();
    if (lower.includes("l3-agent") || lower.includes("l3 agent")) {
      return "ml2-ovs";
    }
    if (lower.includes("ovn")) {
      isOvn = true;
    }
  }
  return isOvn ? "ovn" : "unknown";
}

export type OpenStackRouterAgentState =
  | "alive"
  | "none-alive"
  | "two-active"
  | "not-applicable"
  | "not-reported";

export interface OpenStackRouterAgentReading {
  state: OpenStackRouterAgentState;
  alive: number;
  total: number;
  // English, with these values: "1 of 2 alive".
  label: string;
  values?: Record<string, string> | undefined;
  tone: ResourcePartTone;
  // The host of the agent actively carrying it, on an HA router.
  activeHost: string | null;
}

const ROUTER_AGENTS_ALIVE: string = translationKey("{{alive}} of {{total}} alive");
const ROUTER_AGENTS_NOT_APPLICABLE: string = translationKey("Not applicable");
const ROUTER_AGENTS_NOT_REPORTED: string = translationKey("Not reported");

/*
 * Which agents hold a router. On OVN there are none and there is nothing to be missing,
 * so that reads Not applicable and never as a fault. An ML2/OVS router with no agent
 * reported, and a cloud whose agents can't be listed, read Not reported: the exporter
 * only names agents that hold a router, so saying more would be a guess.
 */
export function getOpenStackRouterAgentReading(data: {
  row: OpenStackResource;
  backend: OpenStackNetworkBackend;
}): OpenStackRouterAgentReading {
  const agents: Array<OpenStackL3AgentFact> = getOpenStackRouterAgents(
    factsOf(data.row),
  );

  if (agents.length === 0) {
    return {
      state: data.backend === "ovn" ? "not-applicable" : "not-reported",
      alive: 0,
      total: 0,
      label:
        data.backend === "ovn"
          ? ROUTER_AGENTS_NOT_APPLICABLE
          : ROUTER_AGENTS_NOT_REPORTED,
      tone: "neutral",
      activeHost: null,
    };
  }

  const alive: Array<OpenStackL3AgentFact> = agents.filter(
    (agent: OpenStackL3AgentFact): boolean => {
      return agent.isAlive && agent.isAdminUp;
    },
  );
  const active: Array<OpenStackL3AgentFact> = alive.filter(
    (agent: OpenStackL3AgentFact): boolean => {
      return agent.haState === "active";
    },
  );

  const state: OpenStackRouterAgentState =
    alive.length === 0
      ? "none-alive"
      : active.length > 1
        ? "two-active"
        : "alive";

  return {
    state,
    alive: alive.length,
    total: agents.length,
    label: ROUTER_AGENTS_ALIVE,
    values: { alive: `${alive.length}`, total: `${agents.length}` },
    tone: state === "alive" ? "positive" : "danger",
    activeHost: active[0]?.host || null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Floating IPs
 * ---------------------------------------------------------------------------
 */
export type OpenStackFloatingIpAssociation =
  | "associated"
  | "unassociated"
  | "associated-not-active";

export const OPENSTACK_FLOATING_IP_ASSOCIATION_WORDS: Record<
  OpenStackFloatingIpAssociation,
  string
> = {
  associated: translationKey("Associated"),
  unassociated: translationKey("Unassociated"),
  "associated-not-active": translationKey("Associated, not active"),
};

/*
 * The exporter has no port label, so what says an address is in use is the router it
 * goes through. Neutron says DOWN for a spare one, which is an address waiting and
 * nothing to look at.
 */
export function getOpenStackFloatingIpAssociation(
  row: OpenStackResource,
): OpenStackFloatingIpAssociation {
  if (!isOpenStackFloatingIpAssociated(factsOf(row))) {
    return "unassociated";
  }
  return row.status && row.status !== "ACTIVE"
    ? "associated-not-active"
    : "associated";
}

/*
 * ---------------------------------------------------------------------------
 * Why a part reads as it does, in a sentence
 * ---------------------------------------------------------------------------
 *
 * A pill says what is wrong, and a page says why it matters and where to look next. At the
 * same lines as the rules, because each of these only speaks when they do.
 */
const EXPLAIN_NETWORK_OUT: string = translationKey(
  "This pool has no addresses left, so new floating IPs and router gateways on it fail. Release floating IPs nobody uses, or add a subnet to it. openstack ip availability show says what each subnet holds.",
);
const EXPLAIN_NETWORK_FILLING: string = translationKey(
  "This pool is nearly out of addresses. Once it is, new floating IPs and router gateways on it fail. Release floating IPs nobody uses, or add a subnet to it.",
);
const EXPLAIN_ROUTER_NO_AGENT: string = translationKey(
  "No L3 agent holding this router is alive, so the networks behind it have no way out. Check the agents below and their logs. openstack network agent add router moves it to one that is alive, if none of them will come back.",
);
const EXPLAIN_ROUTER_TWO_ACTIVE: string = translationKey(
  "Two L3 agents are both active for this router, a split brain: its traffic can go to either, and some of it is lost. Check keepalived on the two hosts below, and the network between them.",
);
const EXPLAIN_ROUTER_NOT_ACTIVE: string = translationKey(
  "Neutron says this router should be active and it is not, so traffic through it may not be flowing. Check openstack router show, then the agents that hold it and their logs.",
);
const EXPLAIN_FLOATING_IP: string = translationKey(
  "This address is associated, through the router named here, and Neutron does not say it is ACTIVE. Traffic to it may not be arriving. Check the router, and the agent or OVN controller carrying it.",
);
const EXPLAIN_VOLUME_ERROR: string = translationKey(
  "Cinder says this volume failed. openstack volume show says what it recorded, and the logs of cinder-volume on its backend say why. A volume in error can't be attached, and its data may need restoring.",
);
const EXPLAIN_VOLUME_STUCK: string = translationKey(
  "This volume has been on its way to something else for longer than it should take. Check cinder-volume on its backend. openstack volume set --state can reset it, once you know nothing is still working on it.",
);
const EXPLAIN_INSTANCE_ERROR: string = translationKey(
  "Nova says this instance failed. openstack server show says what it recorded: No valid host means the scheduler found no room, and anything else usually names the host or the service that failed.",
);
const EXPLAIN_INSTANCE_UNPLACED: string = translationKey(
  "Nova never placed this instance on a hypervisor, so it failed before it reached one. That is usually the scheduler finding no room for its flavor, not a failing host.",
);
const EXPLAIN_INSTANCE_STUCK: string = translationKey(
  "This instance has been on its way to something else for longer than it should take. Check nova-compute on its hypervisor, then openstack server show. A resize waiting at VERIFY_RESIZE needs someone to confirm or revert it.",
);
const EXPLAIN_POOL_FULL: string = translationKey(
  "This pool is nearly full. Once Cinder's scheduler can't find room, new volumes fail with no valid host. Free space on its backend, or add capacity.",
);
const EXPLAIN_POOL_FILLING: string = translationKey(
  "This pool is filling up. Add capacity or free space before Cinder's scheduler runs out of room for new volumes.",
);
const EXPLAIN_IMAGE_STUCK: string = translationKey(
  "This image has been on its way to something else for longer than it should take, which is what a failed upload looks like. Nothing will move it on, and instances asking for it fail. Upload it again, or delete it.",
);

export function getOpenStackPartExplanation(
  row: OpenStackResource,
  now: Date,
): string | null {
  const assessment: OpenStackAssessment = assessOpenStackResource({ row, now });

  if (!assessment.severity) {
    return null;
  }

  switch (row.kind) {
    case OpenStackResourceKind.Network:
      return assessment.severity === ResourceAttentionSeverity.Critical
        ? EXPLAIN_NETWORK_OUT
        : EXPLAIN_NETWORK_FILLING;
    case OpenStackResourceKind.Router: {
      const reading: OpenStackRouterAgentReading =
        getOpenStackRouterAgentReading({ row, backend: "unknown" });
      if (reading.state === "none-alive") {
        return EXPLAIN_ROUTER_NO_AGENT;
      }
      return reading.state === "two-active"
        ? EXPLAIN_ROUTER_TWO_ACTIVE
        : EXPLAIN_ROUTER_NOT_ACTIVE;
    }
    case OpenStackResourceKind.FloatingIp:
      return EXPLAIN_FLOATING_IP;
    case OpenStackResourceKind.Volume:
      return row.status && row.status.startsWith("error")
        ? EXPLAIN_VOLUME_ERROR
        : EXPLAIN_VOLUME_STUCK;
    case OpenStackResourceKind.Instance:
      if (row.status !== "ERROR") {
        return EXPLAIN_INSTANCE_STUCK;
      }
      return isOpenStackInstanceUnplaced(row)
        ? EXPLAIN_INSTANCE_UNPLACED
        : EXPLAIN_INSTANCE_ERROR;
    case OpenStackResourceKind.StoragePool:
      return assessment.severity === ResourceAttentionSeverity.Critical
        ? EXPLAIN_POOL_FULL
        : EXPLAIN_POOL_FILLING;
    case OpenStackResourceKind.Image:
      return EXPLAIN_IMAGE_STUCK;
    default:
      return null;
  }
}

/*
 * ---------------------------------------------------------------------------
 * Whether an open incident or alert is about a part
 * ---------------------------------------------------------------------------
 *
 * A monitor of the cloud links what it opens to the cloud, and only the record's series
 * labels say which part crossed the line. Each template groups by these (see the
 * *_GROUP lists of OpenStackAlertTemplates). A template that only counts per region
 * says nothing about one part, so its record is nobody's here and stays on the cloud's
 * own Incidents and Alerts pages.
 */
function isSameRegion(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  row: Pick<OpenStackResource, "regionName">,
): boolean {
  const region: string | null = readSeriesLabel(
    record.seriesLabels,
    "openstack.region.name",
  );
  return !region || !row.regionName || region === row.regionName;
}

export function isOpenStackIssueAbout(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  row: OpenStackResource,
): boolean {
  const labels: JSONObject | null = record.seriesLabels;

  switch (row.kind) {
    case OpenStackResourceKind.Hypervisor: {
      const service: string | null = readSeriesLabel(labels, "service");
      // A worker's record is about this host only when the worker is its nova-compute.
      if (service && service !== "nova-compute") {
        return false;
      }
      return (
        isSameRegion(record, row) &&
        isSameOpenStackHost(
          readSeriesLabel(labels, "hostname"),
          row.hypervisorName,
        )
      );
    }
    case OpenStackResourceKind.Service:
      return (
        isSameRegion(record, row) &&
        readSeriesLabel(labels, "service") === row.name &&
        isSameOpenStackHost(
          readSeriesLabel(labels, "hostname"),
          textFact(row, "host"),
        )
      );
    case OpenStackResourceKind.Instance:
      return (
        Boolean(row.externalId) &&
        (readSeriesLabel(labels, "uuid") === row.externalId ||
          readSeriesLabel(labels, "id") === row.externalId)
      );
    case OpenStackResourceKind.Volume:
      return (
        Boolean(row.externalId) &&
        readSeriesLabel(labels, "id") === row.externalId
      );
    case OpenStackResourceKind.StoragePool:
      return (
        isSameRegion(record, row) &&
        Boolean(row.name) &&
        readSeriesLabel(labels, "name") === row.name
      );
    case OpenStackResourceKind.Network:
      return (
        Boolean(row.externalId) &&
        readSeriesLabel(labels, "network_id") === row.externalId
      );
    case OpenStackResourceKind.Router:
      return (
        Boolean(row.externalId) &&
        readSeriesLabel(labels, "router_id") === row.externalId
      );
    default:
      return false;
  }
}

// Whether a record is about any of a zone's or an aggregate's hypervisors.
export function isOpenStackIssueAboutHosts(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  hypervisors: Array<OpenStackResource>,
): boolean {
  return hypervisors.some((row: OpenStackResource): boolean => {
    return isOpenStackIssueAbout(record, row);
  });
}

/*
 * ---------------------------------------------------------------------------
 * When something fills up, at its recent growth
 * ---------------------------------------------------------------------------
 */
export interface OpenStackGrowthSample {
  time: number;
  used: number;
}

export type OpenStackForecast =
  // At capacity already.
  | { state: "full" }
  | { state: "days"; days: number }
  // Flat or shrinking: nothing to project.
  | { state: "not-growing" }
  // Too little of it to tell, which is what a new cloud says.
  | { state: "not-enough-history" };

const FORECAST_MINIMUM_SAMPLES: number = 3;
const FORECAST_MINIMUM_HOURS: number = 6;
const FORECAST_MAXIMUM_DAYS: number = 365;

/*
 * A straight line through what was used, against what there is: the same least-squares
 * fit as the Proxmox and Ceph forecasts. Past a year out it says it is not growing,
 * because nobody plans around a line that far off.
 */
export function getOpenStackForecast(data: {
  samples: Array<OpenStackGrowthSample>;
  capacity: number | null | undefined;
}): OpenStackForecast {
  const capacity: number | null | undefined = data.capacity;
  if (capacity === null || capacity === undefined || capacity <= 0) {
    return { state: "not-enough-history" };
  }

  const samples: Array<OpenStackGrowthSample> = data.samples
    .filter((sample: OpenStackGrowthSample): boolean => {
      return Number.isFinite(sample.time) && Number.isFinite(sample.used);
    })
    .sort((first: OpenStackGrowthSample, second: OpenStackGrowthSample) => {
      return first.time - second.time;
    });

  const newest: OpenStackGrowthSample | undefined = samples[samples.length - 1];

  if (newest && newest.used >= capacity) {
    return { state: "full" };
  }

  if (
    !newest ||
    samples.length < FORECAST_MINIMUM_SAMPLES ||
    newest.time - samples[0]!.time < FORECAST_MINIMUM_HOURS * 60 * 60 * 1000
  ) {
    return { state: "not-enough-history" };
  }

  const count: number = samples.length;
  let timeSum: number = 0;
  let usedSum: number = 0;
  for (const sample of samples) {
    timeSum += sample.time;
    usedSum += sample.used;
  }
  const meanTime: number = timeSum / count;
  const meanUsed: number = usedSum / count;

  let covariance: number = 0;
  let variance: number = 0;
  for (const sample of samples) {
    covariance += (sample.time - meanTime) * (sample.used - meanUsed);
    variance += (sample.time - meanTime) * (sample.time - meanTime);
  }

  const growthPerMs: number = variance > 0 ? covariance / variance : 0;
  if (growthPerMs <= 0) {
    return { state: "not-growing" };
  }

  const days: number =
    (capacity - newest.used) / (growthPerMs * 24 * 60 * 60 * 1000);

  return days > FORECAST_MAXIMUM_DAYS
    ? { state: "not-growing" }
    : { state: "days", days };
}

/*
 * ---------------------------------------------------------------------------
 * What an empty list means
 * ---------------------------------------------------------------------------
 */
export type OpenStackApiState = "up" | "down" | "not-reported";

export interface OpenStackEmptyWords {
  title: string;
  description: string;
}

// Which service's API answers for each kind's list.
export const OPENSTACK_SERVICE_OF_KIND: Partial<
  Record<OpenStackResourceKind, OpenStackServiceType>
> = {
  [OpenStackResourceKind.Hypervisor]: OpenStackServiceType.Compute,
  [OpenStackResourceKind.Instance]: OpenStackServiceType.Compute,
  [OpenStackResourceKind.Flavor]: OpenStackServiceType.Compute,
  [OpenStackResourceKind.Network]: OpenStackServiceType.Network,
  [OpenStackResourceKind.Subnet]: OpenStackServiceType.Network,
  [OpenStackResourceKind.Router]: OpenStackServiceType.Network,
  [OpenStackResourceKind.FloatingIp]: OpenStackServiceType.Network,
  [OpenStackResourceKind.Service]: OpenStackServiceType.Network,
  [OpenStackResourceKind.Volume]: OpenStackServiceType.Volume,
  [OpenStackResourceKind.StoragePool]: OpenStackServiceType.Volume,
  [OpenStackResourceKind.Snapshot]: OpenStackServiceType.Volume,
  [OpenStackResourceKind.Backup]: OpenStackServiceType.Volume,
  [OpenStackResourceKind.Image]: OpenStackServiceType.Image,
};

const NOT_ANSWERING: OpenStackEmptyWords = {
  title: translationKey("This service's API isn't answering"),
  description: translationKey(
    "Nothing could be read from it, so this list may fill up again once it answers. Check the service's API on the Services page.",
  ),
};

/*
 * Kinds a working cloud always has, once its service answers. An API that says up with
 * none of these is a credential that isn't allowed to list them, because that is the only
 * thing it can be. Every other kind can really be empty: a cloud with no routers is a
 * cloud with no routers.
 */
const CANNOT_LIST: Partial<Record<OpenStackResourceKind, OpenStackEmptyWords>> =
  {
    [OpenStackResourceKind.Hypervisor]: {
      title: translationKey("This credential can't list hypervisors"),
      description: translationKey(
        "Nova answers, and shows it no hypervisors. They take the Full view or Infrastructure only credential, because hypervisors and Placement are closed to a project's reader. Give the agent one of those, then run troubleshoot.sh on its machine to see what it can read.",
      ),
    },
    [OpenStackResourceKind.StoragePool]: {
      title: translationKey("This credential can't list storage pools"),
      description: translationKey(
        "Cinder answers, and shows it no pools. They take the Full view or Infrastructure only credential, because Cinder's scheduler is closed to a project's reader. Give the agent one of those, then run troubleshoot.sh on its machine to see what it can read.",
      ),
    },
    [OpenStackResourceKind.Service]: {
      title: translationKey("This credential can't list network agents"),
      description: translationKey(
        "Neutron answers, and shows it no agents. They take the Full view or Infrastructure only credential. Give the agent one of those, then run troubleshoot.sh on its machine to see what it can read.",
      ),
    },
  };

/*
 * What to say over an empty list, or null to leave it to the page's own words: nothing is
 * known yet, or the list really can be empty.
 */
export function getOpenStackEmptyWords(data: {
  kind: OpenStackResourceKind;
  api: OpenStackApiState;
}): OpenStackEmptyWords | null {
  if (data.api === "down") {
    return NOT_ANSWERING;
  }
  if (data.api === "up") {
    return CANNOT_LIST[data.kind] || null;
  }
  return null;
}

/*
 * Neutron and Cinder answer a limited credential with a 200 and only its own project's
 * rows, so a list can look whole and not be. A page can't always tell, because a cloud
 * with one project looks the same. So it only ever says "may", and only when more than one
 * project is known and every row is one project's.
 */
export function isOpenStackListPossiblyOneProject(data: {
  projectIdsInList: ReadonlyArray<string | null>;
  knownProjectCount: number;
}): boolean {
  const projects: Set<string> = new Set();
  for (const projectId of data.projectIdsInList) {
    if (projectId) {
      projects.add(projectId);
    }
  }
  return projects.size === 1 && data.knownProjectCount > 1;
}

/*
 * ---------------------------------------------------------------------------
 * Network agents
 * ---------------------------------------------------------------------------
 */
export function isOpenStackNetworkAgent(
  row: OpenStackResource,
): boolean {
  return (
    row.kind === OpenStackResourceKind.Service &&
    factsOf(row)["family"] === OpenStackServiceFamily.Network
  );
}

/*
 * A Neutron agent's row id, as the scan writes it: what a router's agent links to. Only the
 * host of each agent is on the router's row, and the binary is always the L3 agent's.
 */
export function getOpenStackL3AgentExternalId(
  regionName: string | null | undefined,
  host: string,
): string {
  return regional(
    regionName,
    `${OpenStackServiceFamily.Network}/${host}/neutron-l3-agent`,
  );
}

/*
 * Only an L3 agent holds routers, and only the exporter's l3_agent_of_router series says
 * which. A DHCP agent serves networks, and nothing the agent collects says which ones.
 */
export function isOpenStackL3Agent(
  row: Pick<OpenStackResource, "name">,
): boolean {
  const name: string = (row.name || "").toLowerCase();
  return name.includes("l3-agent") || name.includes("l3 agent");
}

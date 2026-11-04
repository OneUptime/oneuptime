import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  isOpenStackAdminDisabled,
  isOpenStackServiceDown,
  percentOf,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_SERVICE_TITLES,
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackProjectQuota,
  getOpenStackProjectQuotas,
} from "Common/Types/OpenStack/OpenStackQuota";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceHealth,
} from "../../../Components/ResourcePart/ResourceAttention";
import { readSeriesLabel } from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import {
  OpenStackAssessment,
  assessOpenStackService,
  getOpenStackAttentionItems,
  getOpenStackHealth,
  getOpenStackStoragePoolPercent,
} from "./OpenStackHealth";
import {
  OpenStackNetworkBackend,
  getOpenStackEmptyWords,
  getOpenStackNetworkBackend,
} from "./OpenStackPartFacts";

/*
 * THE CONTROL PLANE, AS A PERSON READS IT.
 *
 * What `openstack compute service list`, `network agent list`, `volume service list` and
 * `endpoint list` answer between them, grouped by OpenStack service and region with what
 * needs someone first. The Overview's cards and the Services page both read this, so they
 * cannot put things in different orders or count them differently, and it asks
 * OpenStackHealth what needs someone rather than deciding again.
 *
 * Two things it holds to:
 *
 *  - Nothing here is a verdict of its own. A worker's rank and a group's health come from
 *    the rules, whose lines are the alert templates'.
 *  - An API that is down has said nothing about its workers. The exporter reads them from
 *    that API, so they read as they last did, and a page has to say so.
 *
 * React-free, so tests can read it.
 */

// The order Keystone's catalog reads in, which a calm cloud's services keep.
export const OPENSTACK_CATALOG_ORDER: ReadonlyArray<string> = [
  OpenStackServiceType.Identity,
  OpenStackServiceType.Compute,
  OpenStackServiceType.Placement,
  OpenStackServiceType.Network,
  OpenStackServiceType.Volume,
  OpenStackServiceType.Image,
];

// Which API answers for each family of workers: the exporter reads them through it.
const SERVICE_OF_FAMILY: Record<string, OpenStackServiceType> = {
  [OpenStackServiceFamily.Compute]: OpenStackServiceType.Compute,
  [OpenStackServiceFamily.Network]: OpenStackServiceType.Network,
  [OpenStackServiceFamily.Volume]: OpenStackServiceType.Volume,
};

function factsOf(row: OpenStackResource | null | undefined): JSONObject {
  return (row?.facts as JSONObject | undefined) || {};
}

// "Compute (Nova)" for an API's row, whose name is its type in Keystone's catalog.
export function getOpenStackServiceTitle(
  service: string | null | undefined,
): string {
  return (
    OPENSTACK_SERVICE_TITLES[service as OpenStackServiceType] || service || ""
  );
}

// How a row reads in a list of everything: an API by its service, the rest by their name.
export function getOpenStackAttentionName(row: OpenStackResource): string {
  return row.kind === OpenStackResourceKind.Api
    ? getOpenStackServiceTitle(row.name)
    : row.name || "";
}

export function getOpenStackWorkerHost(row: OpenStackResource): string {
  const host: JSONValue | undefined = factsOf(row)["host"];
  return typeof host === "string" ? host : "";
}

/*
 * The machine a worker runs on. Cinder writes a cinder-volume's host with its backend
 * ("compute-01@lvmdriver-1"), and the machine is what comes before the @.
 */
export function getOpenStackWorkerMachine(row: OpenStackResource): string {
  const host: string = getOpenStackWorkerHost(row);
  const at: number = host.indexOf("@");
  return at > 0 ? host.substring(0, at) : host;
}

export function getOpenStackWorkerFamily(row: OpenStackResource): string {
  const family: JSONValue | undefined = factsOf(row)["family"];
  return typeof family === "string" ? family : "";
}

/*
 * How long collecting this API took, or null when nothing has said: only a cloud whose
 * collector reports its own scrapes does, and an agent older than this reading has not.
 */
export function getOpenStackCollectionSeconds(
  row: OpenStackResource | null | undefined,
): number | null {
  const seconds: JSONValue | undefined = factsOf(row)["collectionSeconds"];
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? seconds
    : null;
}

export function isOpenStackApiScrapeFailed(
  row: OpenStackResource | null | undefined,
): boolean {
  return factsOf(row)["scrapeFailed"] === true;
}

/*
 * Old records Neutron still lists for this agent beside the live one. On OVN a crash or a
 * change of system-id leaves them behind, and they read as stale rather than as an
 * outage: the agent is up (OpenStackSnapshotScan).
 */
export function getOpenStackStaleAgentIds(
  row: OpenStackResource,
): Array<string> {
  const ids: JSONValue | undefined = factsOf(row)["staleAgentIds"];
  return Array.isArray(ids)
    ? (ids as Array<JSONValue>).filter((id: JSONValue): id is string => {
        return typeof id === "string";
      })
    : [];
}

/*
 * What needs someone first in a list of workers: one that is down, then one disabled for
 * so long somebody probably forgot it, then one disabled on purpose, then the rest.
 */
export function getOpenStackWorkerRank(
  row: OpenStackResource,
  now: Date,
): number {
  if (
    isOpenStackServiceDown({ status: row.status, adminState: row.adminState })
  ) {
    return 0;
  }
  if (isOpenStackAdminDisabled(row.adminState)) {
    const assessment: OpenStackAssessment = assessOpenStackService({
      row,
      now,
    });
    return assessment.severity === ResourceAttentionSeverity.Warning ? 1 : 2;
  }
  return 3;
}

export function sortOpenStackWorkers(
  rows: Array<OpenStackResource>,
  now: Date,
): Array<OpenStackResource> {
  return [...rows].sort(
    (a: OpenStackResource, b: OpenStackResource): number => {
      return (
        getOpenStackWorkerRank(a, now) - getOpenStackWorkerRank(b, now) ||
        (a.name || "").localeCompare(b.name || "") ||
        getOpenStackWorkerHost(a).localeCompare(
          getOpenStackWorkerHost(b),
          undefined,
          { numeric: true, sensitivity: "base" },
        )
      );
    },
  );
}

export interface OpenStackWorkerCounts {
  total: number;
  up: number;
  // Enabled, and down. One someone disabled is planned work, whatever it says.
  down: number;
  disabled: number;
}

export function getOpenStackWorkerCounts(
  workers: Array<OpenStackResource>,
): OpenStackWorkerCounts {
  const counts: OpenStackWorkerCounts = {
    total: workers.length,
    up: 0,
    down: 0,
    disabled: 0,
  };
  for (const worker of workers) {
    if (isOpenStackAdminDisabled(worker.adminState)) {
      counts.disabled += 1;
    } else if (
      isOpenStackServiceDown({
        status: worker.status,
        adminState: worker.adminState,
      })
    ) {
      counts.down += 1;
    } else {
      counts.up += 1;
    }
  }
  return counts;
}

/*
 * One OpenStack service in one region: its API and its workers. Identity, Placement and
 * Glance have an API and nothing the exporter lists beneath it.
 */
export interface OpenStackServiceGroup {
  key: string;
  // Its type in Keystone's catalog: "compute".
  service: string;
  regionName: string | null;
  api: OpenStackResource | null;
  // What needs someone first.
  workers: Array<OpenStackResource>;
  counts: OpenStackWorkerCounts;
  items: Array<ResourceAttentionItem>;
  health: ResourceHealth;
  // Its API isn't answering, so what its workers say is what they last said.
  isLastKnown: boolean;
}

const HEALTH_RANK: Record<ResourceHealth, number> = {
  Unhealthy: 0,
  Degraded: 1,
  Healthy: 2,
};

function catalogRank(service: string): number {
  const index: number = OPENSTACK_CATALOG_ORDER.indexOf(service);
  return index === -1 ? OPENSTACK_CATALOG_ORDER.length : index;
}

// A group while its rows are gathered, before anything is worked out from them.
interface OpenStackServiceGroupRows {
  service: string;
  regionName: string | null;
  api: OpenStackResource | null;
  workers: Array<OpenStackResource>;
}

export function getOpenStackServiceGroups(data: {
  apis: Array<OpenStackResource>;
  workers: Array<OpenStackResource>;
  now: Date;
}): Array<OpenStackServiceGroup> {
  const groups: Map<string, OpenStackServiceGroupRows> = new Map();

  const groupOf: (
    service: string,
    regionName: string | null,
  ) => OpenStackServiceGroupRows = (
    service: string,
    regionName: string | null,
  ): OpenStackServiceGroupRows => {
    const key: string = `${regionName || ""}/${service}`;
    const found: OpenStackServiceGroupRows | undefined = groups.get(key);
    if (found) {
      return found;
    }
    const group: OpenStackServiceGroupRows = {
      service,
      regionName,
      api: null,
      workers: [],
    };
    groups.set(key, group);
    return group;
  };

  for (const api of data.apis) {
    if (api.name) {
      groupOf(api.name, api.regionName || null).api = api;
    }
  }

  for (const worker of data.workers) {
    const service: OpenStackServiceType | undefined =
      SERVICE_OF_FAMILY[getOpenStackWorkerFamily(worker)];
    if (service) {
      groupOf(service, worker.regionName || null).workers.push(worker);
    }
  }

  return Array.from(groups.entries())
    .map(
      ([key, group]: [
        string,
        OpenStackServiceGroupRows,
      ]): OpenStackServiceGroup => {
        const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
          rows: [...(group.api ? [group.api] : []), ...group.workers],
          now: data.now,
        });
        return {
          key,
          service: group.service,
          regionName: group.regionName,
          api: group.api,
          workers: sortOpenStackWorkers(group.workers, data.now),
          counts: getOpenStackWorkerCounts(group.workers),
          items,
          health: getOpenStackHealth(items),
          isLastKnown: group.api?.status === "down" && group.workers.length > 0,
        };
      },
    )
    .sort((a: OpenStackServiceGroup, b: OpenStackServiceGroup): number => {
      return (
        HEALTH_RANK[a.health] - HEALTH_RANK[b.health] ||
        // At one health, a whole API not answering before one worker of many.
        Number(b.api?.status === "down") - Number(a.api?.status === "down") ||
        catalogRank(a.service) - catalogRank(b.service) ||
        (a.regionName || "").localeCompare(b.regionName || "")
      );
    });
}

/*
 * ---------------------------------------------------------------------------
 * Which backend Neutron runs, as the Services page says it
 * ---------------------------------------------------------------------------
 *
 * Read from what the agents list reports, never from a setting. ML2/OVS has an agent on
 * every host, OVN a controller: neither has the other's agents to miss. What decides it
 * is what a router's page reads (getOpenStackNetworkBackend), so the two can't disagree,
 * and this adds the words to say it with.
 */
export const OPENSTACK_BACKEND_OVN: string = "OVN";
export const OPENSTACK_BACKEND_OVS: string = "ML2/OVS";
export const OPENSTACK_BACKEND_LINUX_BRIDGE: string = "ML2/Linux bridge";

export function getOpenStackNetworkBackendName(
  workers: Array<OpenStackResource>,
): string | null {
  const names: Array<string> = workers
    .filter((worker: OpenStackResource): boolean => {
      return (
        getOpenStackWorkerFamily(worker) === OpenStackServiceFamily.Network
      );
    })
    .map((worker: OpenStackResource): string => {
      return (worker.name || "").toLowerCase();
    });
  const hasAgent: (word: string) => boolean = (word: string): boolean => {
    return names.some((name: string): boolean => {
      return name.includes(word);
    });
  };

  const backend: OpenStackNetworkBackend = getOpenStackNetworkBackend(names);
  if (backend === "ovn") {
    return OPENSTACK_BACKEND_OVN;
  }
  if (hasAgent("openvswitch")) {
    return OPENSTACK_BACKEND_OVS;
  }
  if (hasAgent("linuxbridge")) {
    return OPENSTACK_BACKEND_LINUX_BRIDGE;
  }
  return backend === "ml2-ovs" ? OPENSTACK_BACKEND_OVS : null;
}

/*
 * ---------------------------------------------------------------------------
 * What this credential cannot see
 * ---------------------------------------------------------------------------
 *
 * A credential may not be allowed to list a kind. The exporter still reports its API as
 * up, with no rows of that kind. So for what a working cloud always has, an API that says
 * up and no rows means the credential, and a page must not say "0 hypervisors" or call
 * the cloud Healthy on the strength of what it could not read.
 */
const CANNOT_LIST_COMPUTE_SERVICES: string = translationKey(
  "This credential can't list compute services",
);

const CANNOT_LIST_VOLUME_SERVICES: string = translationKey(
  "This credential can't list volume services",
);

export interface OpenStackAccessGap {
  key: string;
  // English: "This credential can't list hypervisors".
  title: string;
  // The service whose API says up with nothing to show.
  service: string;
}

function isApiUp(
  apis: Array<OpenStackResource>,
  service: string,
  isListed: (regionName: string | null) => boolean,
): boolean {
  return apis.some((api: OpenStackResource): boolean => {
    return (
      api.name === service &&
      api.status === "up" &&
      !isListed(api.regionName || null)
    );
  });
}

export function getOpenStackAccessGaps(data: {
  apis: Array<OpenStackResource>;
  workers: Array<OpenStackResource>;
  // Left out by a page that says nothing about them.
  hypervisors?: Array<OpenStackResource> | undefined;
  /*
   * Whether a region holds any pool. Only pools past the rules' line are among the rows
   * that may need someone, so a page says this from the summary's capacity.
   */
  hasStoragePools?: boolean | undefined;
}): Array<OpenStackAccessGap> {
  const hasWorkers: (
    family: OpenStackServiceFamily,
  ) => (regionName: string | null) => boolean = (
    family: OpenStackServiceFamily,
  ): ((regionName: string | null) => boolean) => {
    return (regionName: string | null): boolean => {
      return data.workers.some((worker: OpenStackResource): boolean => {
        return (
          getOpenStackWorkerFamily(worker) === family &&
          (worker.regionName || null) === regionName
        );
      });
    };
  };

  const titleOf: (kind: OpenStackResourceKind) => string = (
    kind: OpenStackResourceKind,
  ): string => {
    return getOpenStackEmptyWords({ kind, api: "up" })?.title || "";
  };

  const gaps: Array<OpenStackAccessGap> = [];

  const hypervisors: Array<OpenStackResource> | undefined = data.hypervisors;
  if (
    hypervisors &&
    isApiUp(
      data.apis,
      OpenStackServiceType.Compute,
      (regionName: string | null): boolean => {
        return hypervisors.some((row: OpenStackResource): boolean => {
          return (row.regionName || null) === regionName;
        });
      },
    )
  ) {
    gaps.push({
      key: "hypervisors",
      title: titleOf(OpenStackResourceKind.Hypervisor),
      service: OpenStackServiceType.Compute,
    });
  }

  if (
    isApiUp(
      data.apis,
      OpenStackServiceType.Compute,
      hasWorkers(OpenStackServiceFamily.Compute),
    )
  ) {
    gaps.push({
      key: "compute-services",
      title: CANNOT_LIST_COMPUTE_SERVICES,
      service: OpenStackServiceType.Compute,
    });
  }

  if (
    isApiUp(
      data.apis,
      OpenStackServiceType.Network,
      hasWorkers(OpenStackServiceFamily.Network),
    )
  ) {
    gaps.push({
      key: "network-agents",
      title: titleOf(OpenStackResourceKind.Service),
      service: OpenStackServiceType.Network,
    });
  }

  if (
    isApiUp(
      data.apis,
      OpenStackServiceType.Volume,
      hasWorkers(OpenStackServiceFamily.Volume),
    )
  ) {
    gaps.push({
      key: "volume-services",
      title: CANNOT_LIST_VOLUME_SERVICES,
      service: OpenStackServiceType.Volume,
    });
  }

  if (
    data.hasStoragePools === false &&
    isApiUp(data.apis, OpenStackServiceType.Volume, (): boolean => {
      return false;
    })
  ) {
    gaps.push({
      key: "storage-pools",
      title: titleOf(OpenStackResourceKind.StoragePool),
      service: OpenStackServiceType.Volume,
    });
  }

  return gaps;
}

/*
 * ---------------------------------------------------------------------------
 * A service's own page
 * ---------------------------------------------------------------------------
 */

/*
 * What a service's address holds: an API's row is `region/type`, a worker's
 * `region/family/host/binary`. No worker's binary is one of the catalog's types, so the
 * end of the address says which: a region can hold a slash, and its start says nothing.
 */
export function isOpenStackApiExternalId(externalId: string): boolean {
  return OPENSTACK_CATALOG_ORDER.includes(
    externalId.substring(externalId.lastIndexOf("/") + 1),
  );
}

// The alert templates that watch each kind of worker, as the Recommendations list has them.
const API_DOWN_TEMPLATE_IDS: Record<string, string> = {
  [OpenStackServiceType.Identity]: "openstack-identity-api-down",
  [OpenStackServiceType.Compute]: "openstack-compute-api-down",
  [OpenStackServiceType.Placement]: "openstack-placement-api-down",
  [OpenStackServiceType.Network]: "openstack-network-api-down",
  [OpenStackServiceType.Volume]: "openstack-block-storage-api-down",
  [OpenStackServiceType.Image]: "openstack-image-api-down",
};

const SCHEDULER_OR_CONDUCTOR_TEMPLATE_IDS: Array<string> = [
  "openstack-scheduler-or-conductor-down",
  "openstack-every-scheduler-or-conductor-down",
];

export function getOpenStackWorkerAlertTemplateIds(
  row: OpenStackResource,
): Array<string> {
  switch (getOpenStackWorkerFamily(row)) {
    case OpenStackServiceFamily.Compute:
      return row.name === "nova-compute"
        ? ["openstack-compute-service-down"]
        : SCHEDULER_OR_CONDUCTOR_TEMPLATE_IDS;
    case OpenStackServiceFamily.Network:
      return ["openstack-network-agent-down"];
    case OpenStackServiceFamily.Volume:
      return ["openstack-block-storage-service-down"];
    default:
      return [];
  }
}

// An API's own alert, and those on the workers it answers for.
export function getOpenStackServiceAlertTemplateIds(
  service: string,
): Array<string> {
  const ownDown: string | undefined = API_DOWN_TEMPLATE_IDS[service];
  const own: Array<string> = ownDown ? [ownDown] : [];
  switch (service) {
    case OpenStackServiceType.Compute:
      return [
        ...own,
        "openstack-compute-service-down",
        ...SCHEDULER_OR_CONDUCTOR_TEMPLATE_IDS,
      ];
    case OpenStackServiceType.Network:
      return [...own, "openstack-network-agent-down"];
    case OpenStackServiceType.Volume:
      return [...own, "openstack-block-storage-service-down"];
    default:
      return own;
  }
}

/*
 * Whether an open incident or alert is about this API, or a worker it answers for. A
 * monitor of an API groups by region and the service it collected, a monitor of a worker
 * by its host and binary (OpenStackAlertTemplates), so each says it in its labels.
 */
export function isOpenStackIssueAboutService(data: {
  labels: JSONObject | null;
  service: string;
  regionName: string | null | undefined;
  workers: Array<OpenStackResource>;
}): boolean {
  const region: string | null = readSeriesLabel(
    data.labels,
    "openstack.region.name",
  );
  if (region && data.regionName && region !== data.regionName) {
    return false;
  }
  if (readSeriesLabel(data.labels, "openstack_service") === data.service) {
    return true;
  }
  const binary: string | null = readSeriesLabel(data.labels, "service");
  return Boolean(
    binary &&
      data.workers.some((worker: OpenStackResource): boolean => {
        return worker.name === binary;
      }),
  );
}

/*
 * ---------------------------------------------------------------------------
 * Regions
 * ---------------------------------------------------------------------------
 */

/*
 * Whether a row belongs to a region being read. A row with no region is Keystone's, and
 * belongs to all of them. A project belongs to no region, and its quotas each to one, so
 * a project at a quota in one region is that region's concern.
 */
export function isOpenStackRowInRegion(data: {
  row: OpenStackResource;
  regionName: string;
  now: Date;
}): boolean {
  const { row, regionName, now } = data;
  if (row.kind === OpenStackResourceKind.Project) {
    return getOpenStackProjectQuotas(factsOf(row), now).some(
      (quota: OpenStackProjectQuota): boolean => {
        return quota.isAtLine && quota.regionName === regionName;
      },
    );
  }
  return !row.regionName || row.regionName === regionName;
}

/*
 * ---------------------------------------------------------------------------
 * The Overview's tiles
 * ---------------------------------------------------------------------------
 */
export interface OpenStackHypervisorCounts {
  total: number;
  up: number;
  // Nova lost it: its numbers are last known, and it is no capacity anyone can use.
  lost: number;
  disabled: number;
}

export function getOpenStackHypervisorCounts(
  rows: Array<OpenStackResource>,
): OpenStackHypervisorCounts {
  const counts: OpenStackHypervisorCounts = {
    total: 0,
    up: 0,
    lost: 0,
    disabled: 0,
  };
  for (const row of rows) {
    if (row.kind !== OpenStackResourceKind.Hypervisor) {
      continue;
    }
    counts.total += 1;
    if (isOpenStackAdminDisabled(row.adminState)) {
      counts.disabled += 1;
    } else if (
      isOpenStackServiceDown({ status: row.status, adminState: row.adminState })
    ) {
      counts.lost += 1;
    } else {
      counts.up += 1;
    }
  }
  return counts;
}

export type OpenStackAllocationKind = "vcpu" | "memory" | "disk";

function allocationPercent(
  row: OpenStackResource,
  kind: OpenStackAllocationKind,
): number | null {
  switch (kind) {
    case "vcpu":
      return percentOf(row.vcpuAllocated, row.vcpuCapacity);
    case "memory":
      return percentOf(row.memoryAllocatedBytes, row.memoryCapacityBytes);
    default:
      return percentOf(row.diskAllocatedBytes, row.diskCapacityBytes);
  }
}

function canTakeInstances(row: OpenStackResource): boolean {
  return (
    row.kind === OpenStackResourceKind.Hypervisor &&
    !isOpenStackAdminDisabled(row.adminState) &&
    !isOpenStackServiceDown({ status: row.status, adminState: row.adminState })
  );
}

/*
 * Whether any host that can take instances is past what Placement allows, which is what
 * the rules warn about. A tile's bar reads this rather than the cloud's total, because a
 * cloud at 60% can hold a host with no room left.
 */
export function hasOpenStackHostPastAllocationLine(
  rows: Array<OpenStackResource>,
  kind: OpenStackAllocationKind,
): boolean {
  return rows.some((row: OpenStackResource): boolean => {
    const percent: number | null = canTakeInstances(row)
      ? allocationPercent(row, kind)
      : null;
    return percent !== null && percent > OPENSTACK_ALLOCATION_WARNING_PERCENT;
  });
}

export interface OpenStackBusyHypervisor {
  row: OpenStackResource;
  percent: number;
}

/*
 * The hosts with the most promised out of them. Not a lost one, whose numbers are last
 * known, nor a disabled one, which takes nothing new however full it reads.
 */
export function getOpenStackMostAllocatedHypervisors(data: {
  rows: Array<OpenStackResource>;
  kind: OpenStackAllocationKind;
  limit: number;
}): Array<OpenStackBusyHypervisor> {
  const busy: Array<OpenStackBusyHypervisor> = [];
  for (const row of data.rows) {
    if (canTakeInstances(row)) {
      const percent: number | null = allocationPercent(row, data.kind);
      if (percent !== null) {
        busy.push({ row, percent });
      }
    }
  }
  return busy
    .sort((a: OpenStackBusyHypervisor, b: OpenStackBusyHypervisor): number => {
      return (
        b.percent - a.percent ||
        (a.row.name || "").localeCompare(b.row.name || "")
      );
    })
    .slice(0, data.limit);
}

/*
 * The fullest pool among the rows that may need someone, which read every pool past the
 * rules' lower line and no other: null means no pool is past it.
 */
export function getOpenStackFullestPoolPercent(
  rows: Array<OpenStackResource>,
): number | null {
  let fullest: number | null = null;
  for (const row of rows) {
    if (row.kind === OpenStackResourceKind.StoragePool) {
      const percent: number | null = getOpenStackStoragePoolPercent(row);
      if (percent !== null && (fullest === null || percent > fullest)) {
        fullest = percent;
      }
    }
  }
  return fullest;
}

// The tile's bar, at the same lines the rules draw for one pool.
export function getOpenStackPoolTone(
  percent: number | null,
): "positive" | "warning" | "danger" {
  if (percent !== null && percent > OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT) {
    return "danger";
  }
  if (percent !== null && percent > OPENSTACK_STORAGE_POOL_WARNING_PERCENT) {
    return "warning";
  }
  return "positive";
}

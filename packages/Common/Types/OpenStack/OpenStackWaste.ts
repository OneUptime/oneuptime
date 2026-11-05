import { JSONObject } from "../JSON";
import { translationKey } from "../Translator";
import {
  OPENSTACK_HOST_FAILURE_RESOURCE_CLASSES,
  OPENSTACK_RESOURCE_DISK_GB,
  OPENSTACK_RESOURCE_MEMORY_MB,
  OPENSTACK_RESOURCE_VCPU,
  OpenStackCapacityHost,
  OpenStackInstancesOnHost,
  OpenStackInventory,
  getOpenStackFitOnHost,
  getOpenStackHostFailureHeadroom,
  getOpenStackInventoryCapacity,
} from "./OpenStackCapacity";
import {
  getOpenStackShortHostName,
  isOpenStackFloatingIpAssociated,
} from "./OpenStackHealthRules";
import {
  OpenStackPriceList,
  getOpenStackUsageCost,
} from "./OpenStackPriceList";
import {
  OPENSTACK_HOURS_IN_A_MONTH,
  OPENSTACK_INSTANCE_STATUS_SHUT_OFF,
  OpenStackProjectHolding,
  addOpenStackUsage,
  getEmptyOpenStackUsageQuantities,
} from "./OpenStackProjectUsage";

/*
 * WHAT COULD BE RECLAIMED.
 *
 * Six rules, each a recommendation with what it would free and the command that lists what it
 * found. Nothing here does anything: a person reads the list, runs the command and decides. So each
 * rule's first duty is never to name something in use. Whatever a rule can't be sure of isn't
 * named. A row with no date is never old, a row that doesn't say whether it's attached isn't
 * unattached, and a cloud that can't say which image an instance booted from has no unused images
 * as far as anyone here can tell, and the page says that instead.
 *
 * How long something has been so comes from the cloud's own clock where it reports one (a probe
 * does), because a cloud connected today may have held that volume for a year. Otherwise it's how
 * long OneUptime has seen it so, which can only ever say too little.
 */

export enum OpenStackWasteRuleId {
  UnattachedVolume = "unattached-volume",
  SpareFloatingIp = "spare-floating-ip",
  ShutOffInstance = "shut-off-instance",
  UnusedImage = "unused-image",
  OldSnapshot = "old-snapshot",
  MovableHost = "movable-host",
}

export const OPENSTACK_WASTE_VOLUME_DAYS: number = 30;
export const OPENSTACK_WASTE_FLOATING_IP_DAYS: number = 7;
export const OPENSTACK_WASTE_INSTANCE_DAYS: number = 30;
// An image younger than this was probably uploaded to be used, and just hasn't been yet.
export const OPENSTACK_WASTE_IMAGE_DAYS: number = 30;
export const OPENSTACK_WASTE_SNAPSHOT_DAYS: number = 90;
/*
 * A host this little of whose vCPUs and memory is promised, as a share of what Placement offers.
 * Allocated rather than busy, because that's what moving its instances has to find room for.
 */
export const OPENSTACK_WASTE_IDLE_HOST_ALLOCATED_PERCENT: number = 20;

// How many rows a rule reads, oldest first, and how many of those a page lists by name.
export const OPENSTACK_WASTE_ROWS_READ: number = 5000;
export const OPENSTACK_WASTE_ITEMS_KEPT: number = 50;

// How often the rules run: what they find moves in days, and a run reads several lists.
export const OPENSTACK_WASTE_EVERY_MINUTES: number = 60;

export interface OpenStackWasteRuleWords {
  title: string;
  description: string;
  // Lists what the rule is about. Only ever reads: a test holds every rule's to that.
  command: string;
}

export const OPENSTACK_WASTE_RULES: Readonly<
  Record<OpenStackWasteRuleId, OpenStackWasteRuleWords>
> = {
  [OpenStackWasteRuleId.UnattachedVolume]: {
    title: translationKey("Volumes attached to nothing"),
    description: translationKey(
      "Available for 30 days or more, with no instance attached. They hold their space on the backend until someone deletes them.",
    ),
    command: "openstack volume list --all-projects --status available --long",
  },
  [OpenStackWasteRuleId.SpareFloatingIp]: {
    title: translationKey("Floating IPs nothing is using"),
    description: translationKey(
      "Unassociated for 7 days or more. Each holds an address from the external pool that no one else can have.",
    ),
    command: "openstack floating ip list --status DOWN --long",
  },
  [OpenStackWasteRuleId.ShutOffInstance]: {
    title: translationKey("Instances shut off for a long time"),
    description: translationKey(
      "Shut off for 30 days or more. Nova keeps their vCPUs and memory set aside on the host the whole time. Shelving one gives them back and keeps its data.",
    ),
    command: "openstack server list --all-projects --status SHUTOFF --long",
  },
  [OpenStackWasteRuleId.UnusedImage]: {
    title: translationKey("Images nothing was booted from"),
    description: translationKey(
      "Private or shared, 30 days old or more, not protected, and no instance or volume here came from them. Public images are left out: they're what people boot from next.",
    ),
    command: "openstack image list --long",
  },
  [OpenStackWasteRuleId.OldSnapshot]: {
    title: translationKey("Old volume snapshots"),
    description: translationKey(
      "Made 90 days ago or more. A volume can't be deleted while it has snapshots, so these can hold more than their own space.",
    ),
    command: "openstack volume snapshot list --all-projects --long",
  },
  [OpenStackWasteRuleId.MovableHost]: {
    title: translationKey("Hypervisors that could be emptied"),
    description: translationKey(
      "Little of them is allocated, what they hold would fit on the others in their zone, and the zone could still lose a host afterwards. This says allocated, not how busy, and it can't see traits or anything else an instance needs of a host.",
    ),
    command: "openstack hypervisor list --long",
  },
};

export const OPENSTACK_WASTE_RULE_ORDER: ReadonlyArray<OpenStackWasteRuleId> = [
  OpenStackWasteRuleId.MovableHost,
  OpenStackWasteRuleId.ShutOffInstance,
  OpenStackWasteRuleId.UnattachedVolume,
  OpenStackWasteRuleId.OldSnapshot,
  OpenStackWasteRuleId.UnusedImage,
  OpenStackWasteRuleId.SpareFloatingIp,
];

// What's left to read a row by, since a rule asks only for these.
export interface OpenStackWasteRow {
  externalId: string;
  name?: string | null | undefined;
  regionName?: string | null | undefined;
  openStackProjectId?: string | null | undefined;
  status?: string | null | undefined;
  stateChangedAt?: Date | string | null | undefined;
  createdAt?: Date | string | null | undefined;
  diskCapacityBytes?: number | string | null | undefined;
  facts?: JSONObject | null | undefined;
}

export interface OpenStackWasteFrees {
  storageGb: number;
  floatingIps: number;
  vcpus: number;
  memoryGb: number;
  diskGb: number;
  hosts: number;
}

export interface OpenStackWasteItem {
  id: string;
  name: string | null;
  regionName: string | null;
  openStackProjectId: string | null;
  // When it became so, as far as anyone here can tell.
  since: string | null;
  frees: OpenStackWasteFrees;
  // A host's: what it holds now, which is what has to move first.
  instanceCount?: number | undefined;
  // A flavor or a volume type, for what a saving is worked out from.
  flavorId?: string | null | undefined;
  volumeType?: string | null | undefined;
}

export interface OpenStackWasteFinding {
  rule: OpenStackWasteRuleId;
  // Set when the rule can't be run on this cloud, and then it has found nothing: see the rule.
  cannotTell: OpenStackWasteCannotTell | null;
  count: number;
  // The rule read as many rows as it reads, so there are more than this.
  isPartial: boolean;
  frees: OpenStackWasteFrees;
  // At today's prices for a month, where a price is set.
  monthlyAmount: number | null;
  items: Array<OpenStackWasteItem>;
}

export type OpenStackWasteCannotTell =
  // The agent's series don't say which image an instance booted from.
  | "images-in-use-not-reported"
  // The agent's exporter has no series per snapshot.
  | "snapshots-not-reported";

export const OPENSTACK_WASTE_CANNOT_TELL_TEXT: Readonly<
  Record<OpenStackWasteCannotTell, string>
> = {
  "images-in-use-not-reported": translationKey(
    "Can't be told on this cloud. The OpenStack agent's series don't say which image an instance booted from, so an image in use would look unused. Connecting this cloud without an agent reads that from Nova.",
  ),
  "snapshots-not-reported": translationKey(
    "Can't be told on this cloud. The OpenStack agent's exporter reports how many snapshots there are, not which or how old. Connecting this cloud without an agent reads them from Cinder.",
  ),
};

const MS_IN_A_DAY: number = 24 * 60 * 60 * 1000;
const BYTES_IN_A_GB: number = 1024 * 1024 * 1024;
const MIB_IN_A_GB: number = 1024;
/*
 * A status first seen when the row was made says nothing of when it began, so what the cloud's own
 * clock says wins. A change seen later than this after the row was made was really seen.
 */
const FIRST_SIGHT_MS: number = 10 * 60 * 1000;

function noFrees(): OpenStackWasteFrees {
  return {
    storageGb: 0,
    floatingIps: 0,
    vcpus: 0,
    memoryGb: 0,
    diskGb: 0,
    hosts: 0,
  };
}

function toTime(
  value: Date | string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const time: number = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function factsOf(row: OpenStackWasteRow): JSONObject {
  return (row.facts as JSONObject) || {};
}

function gbOf(row: OpenStackWasteRow): number {
  const bytes: number = Number(row.diskCapacityBytes);
  return Number.isFinite(bytes) && bytes > 0 ? bytes / BYTES_IN_A_GB : 0;
}

/*
 * Since when a row has been in the state it's in. The cloud's `updated_at` moves on any change to
 * the part, so nothing can have happened to it since. It only moves too often, which says too
 * little rather than too much. A status OneUptime really saw change is later evidence than a cloud
 * clock that has stopped being reported (a cloud moved from a probe to an agent keeps the old one).
 */
export function getOpenStackWasteSince(row: OpenStackWasteRow): number | null {
  const stateChangedAt: number | null = toTime(row.stateChangedAt);
  const firstSeenAt: number | null = toTime(row.createdAt);
  const updatedAt: number | null = toTime(
    factsOf(row)["updatedAt"] as string | null | undefined,
  );

  if (updatedAt === null) {
    return stateChangedAt ?? firstSeenAt;
  }

  if (
    stateChangedAt !== null &&
    firstSeenAt !== null &&
    stateChangedAt - firstSeenAt > FIRST_SIGHT_MS
  ) {
    return Math.max(stateChangedAt, updatedAt);
  }

  return updatedAt;
}

function isOlderThan(data: {
  since: number | null;
  now: Date;
  days: number;
}): boolean {
  return (
    data.since !== null &&
    data.since <= data.now.getTime() &&
    data.now.getTime() - data.since >= data.days * MS_IN_A_DAY
  );
}

// Exactly `available`: attaching, detaching, backing up, in error or in use all say someone's at it.
export function isOpenStackVolumeWaste(data: {
  row: OpenStackWasteRow;
  now: Date;
}): boolean {
  const facts: JSONObject = factsOf(data.row);

  return (
    data.row.status === "available" &&
    "attachedToInstance" in facts &&
    !facts["attachedToInstance"] &&
    isOlderThan({
      since: getOpenStackWasteSince(data.row),
      now: data.now,
      days: OPENSTACK_WASTE_VOLUME_DAYS,
    })
  );
}

/*
 * Neutron's status alone won't do: an address on a port whose instance is off is DOWN and still
 * spoken for. In use means it has a router or a port (isOpenStackFloatingIpAssociated), and an
 * address reading ACTIVE with neither has lost a label, which isn't the same as not being used.
 */
export function isOpenStackFloatingIpWaste(data: {
  row: OpenStackWasteRow;
  now: Date;
}): boolean {
  const facts: JSONObject = factsOf(data.row);

  return (
    data.row.status !== "ACTIVE" &&
    "routerId" in facts &&
    !isOpenStackFloatingIpAssociated(facts) &&
    isOlderThan({
      since: getOpenStackWasteSince(data.row),
      now: data.now,
      days: OPENSTACK_WASTE_FLOATING_IP_DAYS,
    })
  );
}

export function isOpenStackInstanceWaste(data: {
  row: OpenStackWasteRow;
  now: Date;
}): boolean {
  return (
    data.row.status === OPENSTACK_INSTANCE_STATUS_SHUT_OFF &&
    isOlderThan({
      since: getOpenStackWasteSince(data.row),
      now: data.now,
      days: OPENSTACK_WASTE_INSTANCE_DAYS,
    })
  );
}

/*
 * What every instance and volume says it came from. Null when any instance doesn't say, which is the
 * agent's series, and then no image can be called unused. An instance saying nothing is different
 * from one saying none: a probe writes the fact either way, and none is one booted from a volume.
 */
export function getOpenStackImagesInUse(data: {
  instanceImageIds: ReadonlyArray<string | null>;
  volumeImageIds: ReadonlyArray<string | null>;
  instancesNotSaying: number;
}): Set<string> | null {
  if (data.instancesNotSaying > 0) {
    return null;
  }

  const used: Set<string> = new Set();

  for (const id of [...data.instanceImageIds, ...data.volumeImageIds]) {
    if (id) {
      used.add(id);
    }
  }

  return used;
}

function getOpenStackImageAge(row: OpenStackWasteRow): number | null {
  const createdAtSeconds: number = Number(factsOf(row)["createdAtSeconds"]);

  return Number.isFinite(createdAtSeconds) && createdAtSeconds > 0
    ? createdAtSeconds * 1000
    : toTime(row.createdAt);
}

export function isOpenStackImageWaste(data: {
  row: OpenStackWasteRow;
  imagesInUse: ReadonlySet<string> | null;
  now: Date;
}): boolean {
  const facts: JSONObject = factsOf(data.row);
  const visibility: unknown = facts["visibility"];

  return (
    data.imagesInUse !== null &&
    data.row.status === "active" &&
    (visibility === "private" || visibility === "shared") &&
    facts["isProtected"] !== true &&
    !data.imagesInUse.has(data.row.externalId) &&
    isOlderThan({
      since: getOpenStackImageAge(data.row),
      now: data.now,
      days: OPENSTACK_WASTE_IMAGE_DAYS,
    })
  );
}

function getOpenStackSnapshotAge(row: OpenStackWasteRow): number | null {
  return (
    toTime(factsOf(row)["createdAt"] as string | null | undefined) ??
    toTime(row.createdAt)
  );
}

export function isOpenStackSnapshotWaste(data: {
  row: OpenStackWasteRow;
  now: Date;
}): boolean {
  return (
    data.row.status === "available" &&
    isOlderThan({
      since: getOpenStackSnapshotAge(data.row),
      now: data.now,
      days: OPENSTACK_WASTE_SNAPSHOT_DAYS,
    })
  );
}

function getAllocatedPercent(
  inventory: OpenStackInventory | undefined,
): number {
  if (!inventory) {
    return 100;
  }
  const capacity: number = getOpenStackInventoryCapacity(inventory);
  return capacity > 0 ? (inventory.used / capacity) * 100 : 100;
}

function cloneHost(host: OpenStackCapacityHost): OpenStackCapacityHost {
  const inventories: Record<string, OpenStackInventory> = {};

  for (const resourceClass of Object.keys(host.inventories)) {
    inventories[resourceClass] = { ...host.inventories[resourceClass]! };
  }

  return { ...host, inventories };
}

function sameAggregates(
  first: ReadonlyArray<string>,
  second: ReadonlyArray<string>,
): boolean {
  return (
    first.length === second.length &&
    [...first].sort().join("\n") === [...second].sort().join("\n")
  );
}

export interface OpenStackMovableHostFlavor {
  regionName: string | null;
  flavorId: string;
  resources: Readonly<Record<string, number>>;
}

function placeOnOthers(data: {
  others: ReadonlyArray<OpenStackCapacityHost>;
  // Each instance's resources, largest first.
  instances: ReadonlyArray<Readonly<Record<string, number>>>;
}): boolean {
  for (const resources of data.instances) {
    const target: OpenStackCapacityHost | undefined = data.others.find(
      (other: OpenStackCapacityHost): boolean => {
        return (
          getOpenStackFitOnHost({
            inventories: other.inventories,
            resources,
          }).fit >= 1
        );
      },
    );

    if (!target) {
      return false;
    }

    for (const resourceClass of Object.keys(resources)) {
      const inventory: OpenStackInventory | undefined =
        target.inventories[resourceClass];
      if (inventory) {
        inventory.used += resources[resourceClass] || 0;
      }
    }
  }

  return true;
}

/*
 * Which hosts could be emptied together. A host is named only when:
 *
 *   - it's up, and so is every host in its zone: a zone already short a host, or with one taken out
 *     on purpose, is in no state to give up another;
 *   - little of it is allocated, and nothing on it is on its way anywhere;
 *   - every instance's flavor is known and its allocations add up, so what has to move is known;
 *   - those instances, largest first, each find a place on a host in the same zone and the same
 *     aggregates, so a flavor split across several hosts' spare room doesn't count as fitting;
 *   - the zone can still lose a host with this one gone (the check behind Reserved Headroom Gone).
 *
 * Hosts are taken emptiest first, each on what the ones before it left, so what's named can all be
 * done, and what it frees can be added up. Nothing's said of hosts in a zone the rows don't name.
 */
export function getOpenStackMovableHosts(data: {
  hosts: ReadonlyArray<OpenStackCapacityHost>;
  instancesOnHosts: ReadonlyArray<OpenStackInstancesOnHost>;
  flavors: ReadonlyArray<OpenStackMovableHostFlavor>;
}): Array<OpenStackWasteItem> {
  const flavors: Map<string, Readonly<Record<string, number>>> = new Map();

  for (const flavor of data.flavors) {
    flavors.set(
      `${flavor.regionName || ""}/${flavor.flavorId}`,
      flavor.resources,
    );
  }

  const instancesByHost: Map<
    string,
    Array<OpenStackInstancesOnHost>
  > = new Map();

  for (const row of data.instancesOnHosts) {
    // Nova's names for a host differ by who's asked: see isSameOpenStackHost.
    const key: string = `${row.regionName || ""}/${getOpenStackShortHostName(row.hypervisorName)}`;
    instancesByHost.set(key, [...(instancesByHost.get(key) || []), row]);
  }

  const zones: Map<string, Array<OpenStackCapacityHost>> = new Map();

  for (const host of data.hosts) {
    if (host.zone) {
      const key: string = `${host.regionName || ""}/${host.zone}`;
      zones.set(key, [...(zones.get(key) || []), cloneHost(host)]);
    }
  }

  const movable: Array<OpenStackWasteItem> = [];

  for (const hostsOfZone of zones.values()) {
    if (
      hostsOfZone.some((host: OpenStackCapacityHost): boolean => {
        return host.state !== "up";
      })
    ) {
      continue;
    }

    const isIdle: (host: OpenStackCapacityHost) => boolean = (
      host: OpenStackCapacityHost,
    ): boolean => {
      return (
        getAllocatedPercent(host.inventories[OPENSTACK_RESOURCE_VCPU]) <=
          OPENSTACK_WASTE_IDLE_HOST_ALLOCATED_PERCENT &&
        getAllocatedPercent(host.inventories[OPENSTACK_RESOURCE_MEMORY_MB]) <=
          OPENSTACK_WASTE_IDLE_HOST_ALLOCATED_PERCENT
      );
    };

    const candidates: Array<OpenStackCapacityHost> = hostsOfZone
      .filter(isIdle)
      .sort(
        (
          first: OpenStackCapacityHost,
          second: OpenStackCapacityHost,
        ): number => {
          return (
            getAllocatedPercent(first.inventories[OPENSTACK_RESOURCE_VCPU]) -
              getAllocatedPercent(
                second.inventories[OPENSTACK_RESOURCE_VCPU],
              ) || first.name.localeCompare(second.name)
          );
        },
      );

    let remaining: Array<OpenStackCapacityHost> = hostsOfZone;

    for (const candidate of candidates) {
      const rows: Array<OpenStackInstancesOnHost> =
        instancesByHost.get(
          `${candidate.regionName || ""}/${getOpenStackShortHostName(candidate.name)}`,
        ) || [];
      const isInFlux: boolean = rows.some(
        (row: OpenStackInstancesOnHost): boolean => {
          return row.movingCount > 0;
        },
      );
      const instances: Array<Readonly<Record<string, number>>> = [];
      let isKnown: boolean = true;

      for (const row of rows) {
        const resources: Readonly<Record<string, number>> | undefined =
          row.flavorId
            ? flavors.get(`${row.regionName || ""}/${row.flavorId}`)
            : undefined;
        if (!resources) {
          isKnown = false;
          break;
        }
        for (let index: number = 0; index < row.count; index++) {
          instances.push(resources);
        }
      }

      const counted: number = instances.length;

      /*
       * The host's own count, from Nova, beside the instances' rows: if they differ, something on
       * this host isn't accounted for, and "nothing else is here" can't be said of it.
       */
      if (
        isInFlux ||
        !isKnown ||
        counted !== candidate.instanceCount ||
        !isEveryAllocationExplained({ host: candidate, instances })
      ) {
        continue;
      }

      const others: Array<OpenStackCapacityHost> = remaining
        .filter((host: OpenStackCapacityHost): boolean => {
          return host.name !== candidate.name;
        })
        .map(cloneHost);
      const destinations: Array<OpenStackCapacityHost> = others.filter(
        (host: OpenStackCapacityHost): boolean => {
          return sameAggregates(host.aggregates, candidate.aggregates);
        },
      );
      const largestFirst: Array<Readonly<Record<string, number>>> = [
        ...instances,
      ].sort(
        (
          first: Readonly<Record<string, number>>,
          second: Readonly<Record<string, number>>,
        ): number => {
          return (
            (second[OPENSTACK_RESOURCE_MEMORY_MB] || 0) -
              (first[OPENSTACK_RESOURCE_MEMORY_MB] || 0) ||
            (second[OPENSTACK_RESOURCE_VCPU] || 0) -
              (first[OPENSTACK_RESOURCE_VCPU] || 0)
          );
        },
      );

      if (
        !placeOnOthers({ others: destinations, instances: largestFirst }) ||
        getOpenStackHostFailureHeadroom(others).state !== "can-lose-a-host"
      ) {
        continue;
      }

      remaining = others;

      const capacityOf: (resourceClass: string) => number = (
        resourceClass: string,
      ): number => {
        const inventory: OpenStackInventory | undefined =
          candidate.inventories[resourceClass];
        return inventory ? getOpenStackInventoryCapacity(inventory) : 0;
      };

      movable.push({
        id: candidate.name,
        name: candidate.name,
        regionName: candidate.regionName,
        openStackProjectId: null,
        since: null,
        instanceCount: candidate.instanceCount,
        frees: {
          ...noFrees(),
          hosts: 1,
          vcpus: capacityOf(OPENSTACK_RESOURCE_VCPU),
          memoryGb: capacityOf(OPENSTACK_RESOURCE_MEMORY_MB) / MIB_IN_A_GB,
          diskGb: capacityOf(OPENSTACK_RESOURCE_DISK_GB),
        },
      });
    }
  }

  return movable;
}

/*
 * Whether what Placement says this host has allocated is what its instances' flavors add up to. If
 * it's more, something else is holding room here (an orphaned allocation, a move), and moving these
 * instances wouldn't empty it. Boot-from-volume instances ask less disk than their flavor says, so
 * only the classes a host failure is judged on are held to it, and only for being under.
 */
function isEveryAllocationExplained(data: {
  host: OpenStackCapacityHost;
  instances: ReadonlyArray<Readonly<Record<string, number>>>;
}): boolean {
  for (const resourceClass of OPENSTACK_HOST_FAILURE_RESOURCE_CLASSES) {
    const inventory: OpenStackInventory | undefined =
      data.host.inventories[resourceClass];

    if (!inventory) {
      continue;
    }

    let expected: number = 0;

    for (const resources of data.instances) {
      expected += resources[resourceClass] || 0;
    }

    if (inventory.used > expected) {
      return false;
    }
  }

  return true;
}

export function addOpenStackWasteFrees(
  first: OpenStackWasteFrees,
  second: OpenStackWasteFrees,
): OpenStackWasteFrees {
  return {
    storageGb: first.storageGb + second.storageGb,
    floatingIps: first.floatingIps + second.floatingIps,
    vcpus: first.vcpus + second.vcpus,
    memoryGb: first.memoryGb + second.memoryGb,
    diskGb: first.diskGb + second.diskGb,
    hosts: first.hosts + second.hosts,
  };
}

// What's named by rows comes out the same way whichever rule found it.
export function toOpenStackWasteItem(data: {
  row: OpenStackWasteRow;
  since: number | null;
  frees: Partial<OpenStackWasteFrees>;
  flavorId?: string | null | undefined;
  volumeType?: string | null | undefined;
}): OpenStackWasteItem {
  return {
    id: data.row.externalId,
    name: data.row.name || null,
    regionName: data.row.regionName || null,
    openStackProjectId: data.row.openStackProjectId || null,
    since: data.since === null ? null : new Date(data.since).toISOString(),
    frees: { ...noFrees(), ...data.frees },
    flavorId: data.flavorId,
    volumeType: data.volumeType,
  };
}

export interface OpenStackWasteInput {
  volumes: ReadonlyArray<OpenStackWasteRow>;
  floatingIps: ReadonlyArray<OpenStackWasteRow>;
  instances: ReadonlyArray<OpenStackWasteRow>;
  images: ReadonlyArray<OpenStackWasteRow>;
  snapshots: ReadonlyArray<OpenStackWasteRow>;
  // What a shut-off instance's flavor gives it. Null for one the cloud no longer lists.
  flavorOf: (data: {
    regionName: string | null;
    flavorId: string | null;
  }) => OpenStackWasteFlavor | null;
  imagesInUse: ReadonlySet<string> | null;
  // Whether this cloud reports each snapshot at all: an agent's cloud reports a count.
  snapshotsAreReported: boolean;
  movableHosts: ReadonlyArray<OpenStackWasteItem>;
  priceList: OpenStackPriceList | null;
  now: Date;
}

export interface OpenStackWasteFlavor {
  name: string | null;
  vcpus: number;
  ramMib: number;
  diskGb: number;
}

function toFinding(data: {
  rule: OpenStackWasteRuleId;
  items: ReadonlyArray<OpenStackWasteItem>;
  rowsRead?: number | undefined;
  cannotTell?: OpenStackWasteCannotTell | undefined;
  // What holding one of these for a month comes to. Null when it has no price.
  monthlyAmountOf?: ((item: OpenStackWasteItem) => number | null) | undefined;
}): OpenStackWasteFinding {
  let frees: OpenStackWasteFrees = noFrees();
  let monthlyAmount: number | null = null;

  for (const item of data.items) {
    frees = addOpenStackWasteFrees(frees, item.frees);

    const amount: number | null = data.monthlyAmountOf
      ? data.monthlyAmountOf(item)
      : null;

    if (amount !== null) {
      monthlyAmount = (monthlyAmount || 0) + amount;
    }
  }

  return {
    rule: data.rule,
    cannotTell: data.cannotTell ?? null,
    count: data.items.length,
    isPartial: (data.rowsRead || 0) >= OPENSTACK_WASTE_ROWS_READ,
    frees,
    monthlyAmount:
      monthlyAmount === null ? null : Math.round(monthlyAmount * 100) / 100,
    items: data.items.slice(0, OPENSTACK_WASTE_ITEMS_KEPT),
  };
}

/*
 * What holding this for a month comes to, by the same sum as a project's cost. A price of zero is
 * no price, so a rule with none says what it frees and no amount.
 */
function getMonthlyAmount(data: {
  holding: Partial<OpenStackProjectHolding>;
  priceList: OpenStackPriceList | null;
}): number | null {
  if (!data.priceList) {
    return null;
  }

  return getOpenStackUsageCost({
    quantities: addOpenStackUsage({
      quantities: getEmptyOpenStackUsageQuantities(),
      holding: {
        openStackProjectId: "",
        flavors: [],
        volumeGbByType: {},
        floatingIps: 0,
        imageGb: 0,
        snapshotGb: 0,
        ...data.holding,
      },
      hours: OPENSTACK_HOURS_IN_A_MONTH,
    }),
    priceList: data.priceList,
  }).amount;
}

// Every rule over what was read, in the order a page lists them. The largest thing first.
export function getOpenStackWasteFindings(
  input: OpenStackWasteInput,
): Array<OpenStackWasteFinding> {
  const { now } = input;

  const volumes: Array<OpenStackWasteItem> = input.volumes
    .filter((row: OpenStackWasteRow): boolean => {
      return isOpenStackVolumeWaste({ row, now });
    })
    .map((row: OpenStackWasteRow): OpenStackWasteItem => {
      return toOpenStackWasteItem({
        row,
        since: getOpenStackWasteSince(row),
        frees: { storageGb: gbOf(row) },
        volumeType: (factsOf(row)["volumeType"] as string | undefined) || null,
      });
    });

  const floatingIps: Array<OpenStackWasteItem> = input.floatingIps
    .filter((row: OpenStackWasteRow): boolean => {
      return isOpenStackFloatingIpWaste({ row, now });
    })
    .map((row: OpenStackWasteRow): OpenStackWasteItem => {
      return toOpenStackWasteItem({
        row,
        since: getOpenStackWasteSince(row),
        frees: { floatingIps: 1 },
      });
    });

  const instances: Array<OpenStackWasteItem> = input.instances
    .filter((row: OpenStackWasteRow): boolean => {
      return isOpenStackInstanceWaste({ row, now });
    })
    .map((row: OpenStackWasteRow): OpenStackWasteItem => {
      const flavorId: string | null =
        (factsOf(row)["flavorId"] as string | undefined) || null;
      const flavor: OpenStackWasteFlavor | null = input.flavorOf({
        regionName: row.regionName || null,
        flavorId,
      });

      return toOpenStackWasteItem({
        row,
        since: getOpenStackWasteSince(row),
        frees: flavor
          ? {
              vcpus: flavor.vcpus,
              memoryGb: flavor.ramMib / MIB_IN_A_GB,
              diskGb: flavor.diskGb,
            }
          : {},
        flavorId,
      });
    });

  const images: Array<OpenStackWasteItem> = input.images
    .filter((row: OpenStackWasteRow): boolean => {
      return isOpenStackImageWaste({
        row,
        imagesInUse: input.imagesInUse,
        now,
      });
    })
    .map((row: OpenStackWasteRow): OpenStackWasteItem => {
      return toOpenStackWasteItem({
        row,
        since: getOpenStackImageAge(row),
        frees: { storageGb: gbOf(row) },
      });
    });

  const snapshots: Array<OpenStackWasteItem> = input.snapshots
    .filter((row: OpenStackWasteRow): boolean => {
      return isOpenStackSnapshotWaste({ row, now });
    })
    .map((row: OpenStackWasteRow): OpenStackWasteItem => {
      return toOpenStackWasteItem({
        row,
        since: getOpenStackSnapshotAge(row),
        frees: { storageGb: gbOf(row) },
      });
    });

  const findings: Record<OpenStackWasteRuleId, OpenStackWasteFinding> = {
    [OpenStackWasteRuleId.MovableHost]: toFinding({
      rule: OpenStackWasteRuleId.MovableHost,
      items: input.movableHosts,
    }),
    [OpenStackWasteRuleId.ShutOffInstance]: toFinding({
      rule: OpenStackWasteRuleId.ShutOffInstance,
      items: instances,
      rowsRead: input.instances.length,
      monthlyAmountOf: (item: OpenStackWasteItem): number | null => {
        const flavor: OpenStackWasteFlavor | null = input.flavorOf({
          regionName: item.regionName,
          flavorId: item.flavorId ?? null,
        });

        return flavor
          ? getMonthlyAmount({
              priceList: input.priceList,
              holding: {
                flavors: [
                  {
                    regionName: item.regionName,
                    flavorId: item.flavorId ?? null,
                    name: flavor.name,
                    vcpus: flavor.vcpus,
                    ramMib: flavor.ramMib,
                    running: 1,
                    shutOff: 0,
                  },
                ],
              },
            })
          : null;
      },
    }),
    [OpenStackWasteRuleId.UnattachedVolume]: toFinding({
      rule: OpenStackWasteRuleId.UnattachedVolume,
      items: volumes,
      rowsRead: input.volumes.length,
      monthlyAmountOf: (item: OpenStackWasteItem): number | null => {
        return getMonthlyAmount({
          priceList: input.priceList,
          holding: {
            volumeGbByType: { [item.volumeType || ""]: item.frees.storageGb },
          },
        });
      },
    }),
    [OpenStackWasteRuleId.OldSnapshot]: toFinding({
      rule: OpenStackWasteRuleId.OldSnapshot,
      items: snapshots,
      rowsRead: input.snapshots.length,
      cannotTell: input.snapshotsAreReported
        ? undefined
        : "snapshots-not-reported",
      monthlyAmountOf: (item: OpenStackWasteItem): number | null => {
        return getMonthlyAmount({
          priceList: input.priceList,
          holding: { snapshotGb: item.frees.storageGb },
        });
      },
    }),
    [OpenStackWasteRuleId.UnusedImage]: toFinding({
      rule: OpenStackWasteRuleId.UnusedImage,
      items: images,
      rowsRead: input.images.length,
      cannotTell:
        input.imagesInUse === null ? "images-in-use-not-reported" : undefined,
      monthlyAmountOf: (item: OpenStackWasteItem): number | null => {
        return getMonthlyAmount({
          priceList: input.priceList,
          holding: { imageGb: item.frees.storageGb },
        });
      },
    }),
    [OpenStackWasteRuleId.SpareFloatingIp]: toFinding({
      rule: OpenStackWasteRuleId.SpareFloatingIp,
      items: floatingIps,
      rowsRead: input.floatingIps.length,
      monthlyAmountOf: (): number | null => {
        return getMonthlyAmount({
          priceList: input.priceList,
          holding: { floatingIps: 1 },
        });
      },
    }),
  };

  return OPENSTACK_WASTE_RULE_ORDER.map(
    (rule: OpenStackWasteRuleId): OpenStackWasteFinding => {
      return findings[rule];
    },
  );
}

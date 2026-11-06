import { JSONObject, JSONValue } from "../JSON";
import {
  getOpenStackShortHostName,
  isOpenStackAdminDisabled,
  isOpenStackServiceDown,
  percentOf,
} from "./OpenStackHealthRules";

/*
 * HOW MANY MORE FIT.
 *
 * The question an OpenStack operator gets asked most, and Nova's free counts don't answer it:
 * allocation ratios, reservations and fragmentation all matter, so a cloud can have thousands of
 * vCPUs free and no room for one large instance. So everything here is what Placement would
 * decide, worked out host by host:
 *
 *   capacity = (total - reserved) * allocation_ratio, for each provider and resource class
 *   room for an instance = what it asks for fits inside capacity - used, in every class it asks
 *                          for, on one host, and each amount is one the inventory allows
 *
 * These are allocations: what has been promised, never what is busy. An idle instance holds all
 * of it.
 *
 * Everything here is pure, so pages, the probe, the server and the tests all read one answer, and
 * none of it knows about Nova's flavors beyond what they ask for: a resource class is only a name
 * here. A bare metal flavor asking for one CUSTOM_BAREMETAL_GOLD reads the same as any other.
 */

export const OPENSTACK_RESOURCE_VCPU: string = "VCPU";
export const OPENSTACK_RESOURCE_PCPU: string = "PCPU";
export const OPENSTACK_RESOURCE_MEMORY_MB: string = "MEMORY_MB";
export const OPENSTACK_RESOURCE_DISK_GB: string = "DISK_GB";

// What an instance can move onto another host with: a bare metal node's own class never can.
export const OPENSTACK_HOST_FAILURE_RESOURCE_CLASSES: ReadonlyArray<string> = [
  OPENSTACK_RESOURCE_VCPU,
  OPENSTACK_RESOURCE_PCPU,
  OPENSTACK_RESOURCE_MEMORY_MB,
  OPENSTACK_RESOURCE_DISK_GB,
];

/*
 * ---------------------------------------------------------------------------
 * One resource class on one provider
 * ---------------------------------------------------------------------------
 */
export interface OpenStackInventory {
  total: number;
  reserved: number;
  allocationRatio: number;
  // What is allocated.
  used: number;
  /*
   * Only the probe reads these. Nova sets min_unit and step_size to 1 and max_unit to total for
   * what it reports, on every recording, so that is what they are taken to be when not known.
   */
  minUnit?: number | undefined;
  maxUnit?: number | undefined;
  stepSize?: number | undefined;
}

export type OpenStackInventories = Record<string, OpenStackInventory>;

// What Placement will promise, whatever has been promised already.
export function getOpenStackInventoryCapacity(
  inventory: Pick<OpenStackInventory, "total" | "reserved" | "allocationRatio">,
): number {
  return Math.max(
    0,
    (inventory.total - inventory.reserved) * inventory.allocationRatio,
  );
}

/*
 * What is left to promise. Never below nothing: a ratio lowered under what is already allocated
 * leaves a host over its capacity, which has no room and no debt either.
 */
export function getOpenStackInventoryFree(
  inventory: Pick<
    OpenStackInventory,
    "total" | "reserved" | "allocationRatio" | "used"
  >,
): number {
  return Math.max(0, getOpenStackInventoryCapacity(inventory) - inventory.used);
}

// Whether one allocation of this size is one this inventory could ever take.
function canInventoryTakeAmount(
  inventory: OpenStackInventory,
  amount: number,
): boolean {
  const stepSize: number = inventory.stepSize || 1;

  return (
    amount <= (inventory.maxUnit ?? inventory.total) &&
    amount >= (inventory.minUnit ?? 1) &&
    amount % stepSize === 0
  );
}

export interface OpenStackFitOnHost {
  fit: number;
  // The class that stopped it, when something did: the lowest count of those asked for.
  limitedBy: string | null;
}

/*
 * How many instances of this size one host has room for. Each class asked for gives a count, and
 * the lowest is the answer, because an instance needs all of them on one host. A class the host
 * has no inventory of, or an amount past max_unit, is none at all.
 */
export function getOpenStackFitOnHost(data: {
  inventories: OpenStackInventories;
  resources: Readonly<Record<string, number>>;
}): OpenStackFitOnHost {
  let fit: number | null = null;
  let limitedBy: string | null = null;

  for (const resourceClass of Object.keys(data.resources)) {
    const amount: number = data.resources[resourceClass] as number;

    if (!(amount > 0)) {
      continue;
    }

    const inventory: OpenStackInventory | undefined =
      data.inventories[resourceClass];

    const count: number =
      inventory && canInventoryTakeAmount(inventory, amount)
        ? Math.floor(getOpenStackInventoryFree(inventory) / amount)
        : 0;

    if (fit === null || count < fit) {
      fit = count;
      limitedBy = resourceClass;
    }
  }

  return { fit: fit ?? 0, limitedBy: limitedBy };
}

/*
 * ---------------------------------------------------------------------------
 * What a flavor asks Placement for
 * ---------------------------------------------------------------------------
 */
export interface OpenStackFlavorRequest {
  resources: Record<string, number>;
  requiredTraits: Array<string>;
  forbiddenTraits: Array<string>;
}

function toAmount(value: unknown): number | null {
  const amount: number =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);

  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/*
 * What Nova asks Placement for an instance of this flavor booted from an image, as
 * nova.scheduler.utils.resources_from_request_spec works it out:
 *
 *  - VCPU, MEMORY_MB, and DISK_GB as root + ephemeral + swap rounded up to a GB.
 *  - hw:cpu_policy=dedicated asks for PCPU in place of VCPU.
 *  - hw:cpu_thread_policy is a trait: isolate forbids hyperthreading, require asks for it.
 *  - resources:<class>=<n> says what to ask for instead, and 0 asks for none. That is how a
 *    bare metal flavor reads: resources:CUSTOM_BAREMETAL_GOLD=1, resources:VCPU=0.
 *  - trait:<name>=required or forbidden, and a numbered group adds to the same request.
 *
 * Booted from a volume an instance asks for no root disk, and a flavor can't say that in advance:
 * this counts every instance as booted from an image, and a page says so.
 */
export function getOpenStackFlavorRequest(data: {
  vcpus: number | null | undefined;
  ramMib: number | null | undefined;
  diskGib: number | null | undefined;
  ephemeralGib?: number | null | undefined;
  swapMib?: number | null | undefined;
  extraSpecs?: JSONObject | null | undefined;
}): OpenStackFlavorRequest {
  const specs: JSONObject = data.extraSpecs || {};
  const vcpus: number = data.vcpus || 0;
  const isPinned: boolean = specs["hw:cpu_policy"] === "dedicated";

  const resources: Record<string, number> = {
    [isPinned ? OPENSTACK_RESOURCE_PCPU : OPENSTACK_RESOURCE_VCPU]: vcpus,
    [OPENSTACK_RESOURCE_MEMORY_MB]: data.ramMib || 0,
    [OPENSTACK_RESOURCE_DISK_GB]:
      (data.diskGib || 0) +
      (data.ephemeralGib || 0) +
      Math.ceil((data.swapMib || 0) / 1024),
  };

  if (isPinned && specs["hw:emulator_threads_policy"] === "isolate") {
    resources[OPENSTACK_RESOURCE_PCPU] = vcpus + 1;
  }

  const requiredTraits: Set<string> = new Set();
  const forbiddenTraits: Set<string> = new Set();

  if (specs["hw:cpu_thread_policy"] === "isolate") {
    forbiddenTraits.add("HW_CPU_HYPERTHREADING");
  } else if (specs["hw:cpu_thread_policy"] === "require") {
    requiredTraits.add("HW_CPU_HYPERTHREADING");
  }

  for (const key of Object.keys(specs)) {
    const colon: number = key.indexOf(":");
    if (colon < 0) {
      continue;
    }
    const prefix: string = key.substring(0, colon);
    const name: string = key.substring(colon + 1);
    const value: JSONValue | undefined = specs[key];

    if (!name) {
      continue;
    }

    if (isGroupPrefix(prefix, "resources")) {
      const amount: number | null = toAmount(value);
      if (amount !== null) {
        // A numbered group adds to what the flavor asks for, and resources:<class> replaces it.
        resources[name] =
          prefix === "resources" ? amount : (resources[name] || 0) + amount;
      }
    } else if (isGroupPrefix(prefix, "trait")) {
      if (value === "required") {
        requiredTraits.add(name);
      } else if (value === "forbidden") {
        forbiddenTraits.add(name);
      }
    }
  }

  for (const resourceClass of Object.keys(resources)) {
    if (!(resources[resourceClass]! > 0)) {
      delete resources[resourceClass];
    }
  }

  return {
    resources,
    requiredTraits: Array.from(requiredTraits).sort(),
    forbiddenTraits: Array.from(forbiddenTraits).sort(),
  };
}

// "resources", or "resources1", "resources_gpu": a request group's own suffix.
function isGroupPrefix(prefix: string, word: string): boolean {
  if (!prefix.startsWith(word)) {
    return false;
  }
  for (let index: number = word.length; index < prefix.length; index++) {
    const character: string = prefix.charAt(index);
    const isWordCharacter: boolean =
      character === "_" ||
      character === "-" ||
      (character >= "0" && character <= "9") ||
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z");
    if (!isWordCharacter) {
      return false;
    }
  }
  return true;
}

// "VCPU:1,MEMORY_MB:2048,DISK_GB:20", as a query names them and a label carries them.
export function toOpenStackResourcesQuery(
  resources: Readonly<Record<string, number>>,
): string {
  return Object.keys(resources)
    .filter((resourceClass: string): boolean => {
      return (resources[resourceClass] as number) > 0;
    })
    .sort()
    .map((resourceClass: string): string => {
      return `${resourceClass}:${resources[resourceClass]}`;
    })
    .join(",");
}

export function parseOpenStackResourcesQuery(
  text: string | null | undefined,
): Record<string, number> {
  const resources: Record<string, number> = {};

  for (const part of (text || "").split(",")) {
    const colon: number = part.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const amount: number | null = toAmount(part.substring(colon + 1));
    if (amount !== null && amount > 0) {
      resources[part.substring(0, colon).trim()] = amount;
    }
  }

  return resources;
}

/*
 * What the probe sends Placement for a request: one call per shape of flavor, so what two flavors
 * ask for alike is asked once. COMPUTE_STATUS_DISABLED is the trait Nova sets on a host someone
 * disabled, and its own scheduler forbids it too, so this asks what a boot would be told.
 */
export const OPENSTACK_COMPUTE_STATUS_DISABLED_TRAIT: string =
  "COMPUTE_STATUS_DISABLED";

export function getOpenStackCandidatesQuery(
  request: OpenStackFlavorRequest,
): Record<string, string> {
  return {
    resources: toOpenStackResourcesQuery(request.resources),
    required: [
      ...request.requiredTraits,
      ...request.forbiddenTraits.map((trait: string): string => {
        return `!${trait}`;
      }),
      `!${OPENSTACK_COMPUTE_STATUS_DISABLED_TRAIT}`,
    ].join(","),
  };
}

/*
 * ---------------------------------------------------------------------------
 * A host, and what it adds up to
 * ---------------------------------------------------------------------------
 */
export type OpenStackCapacityHostState = "up" | "lost" | "disabled";

export interface OpenStackCapacityHost {
  name: string;
  regionName: string | null;
  // Null when nothing has said, which is not Nova's zone "internal": that one is never a host's.
  zone: string | null;
  aggregates: ReadonlyArray<string>;
  state: OpenStackCapacityHostState;
  instanceCount: number;
  inventories: OpenStackInventories;
}

/*
 * A lost host's numbers keep arriving, as the last it had, and a disabled one takes nothing on.
 * Neither is capacity. Someone disabling a host is planned, so that reads first: a disabled host
 * that also stopped is still only someone's planned work.
 */
export function getOpenStackCapacityHostState(row: {
  status?: string | null | undefined;
  adminState?: string | null | undefined;
}): OpenStackCapacityHostState {
  if (isOpenStackAdminDisabled(row.adminState)) {
    return "disabled";
  }
  return isOpenStackServiceDown(row) ? "lost" : "up";
}

/*
 * What a hypervisor's row holds of Placement, one fact per number. A large scrape reaches ingest in
 * several batches, split anywhere, and facts merge key by key: so a reading that holds its total
 * but not yet its reserved must not replace one that held both. `seen` says which hour the
 * provider last reported the class, because a class a provider stops having (a reshape moves VGPUs
 * to a child, a host moved to PCPU) has no series left to say so. It is an hour and no finer, so a
 * row nothing has changed on is still not rewritten on every scrape.
 */
const INVENTORY_FACT_PREFIX: string = "inventory:";

export type OpenStackInventoryField =
  | "total"
  | "reserved"
  | "ratio"
  | "used"
  | "seen";

export function getOpenStackInventoryFactKey(
  resourceClass: string,
  field: OpenStackInventoryField,
): string {
  return `${INVENTORY_FACT_PREFIX}${resourceClass}:${field}`;
}

const HOUR_IN_MS: number = 60 * 60 * 1000;

export function getOpenStackInventorySeenHour(observedAt: Date): number {
  return Math.floor(observedAt.getTime() / HOUR_IN_MS);
}

export function readOpenStackInventories(
  facts: JSONObject | null | undefined,
): OpenStackInventories {
  const readings: Record<string, Partial<Record<string, number>>> = {};
  let newestSeen: number = 0;

  for (const key of Object.keys(facts || {})) {
    if (!key.startsWith(INVENTORY_FACT_PREFIX)) {
      continue;
    }

    const value: JSONValue | undefined = facts![key];
    const lastColon: number = key.lastIndexOf(":");

    if (
      typeof value !== "number" ||
      lastColon <= INVENTORY_FACT_PREFIX.length
    ) {
      continue;
    }

    const resourceClass: string = key.substring(
      INVENTORY_FACT_PREFIX.length,
      lastColon,
    );
    const field: string = key.substring(lastColon + 1);
    const reading: Partial<Record<string, number>> =
      readings[resourceClass] || {};

    reading[field] = value;
    readings[resourceClass] = reading;

    if (field === "seen" && value > newestSeen) {
      newestSeen = value;
    }
  }

  const inventories: OpenStackInventories = {};

  for (const resourceClass of Object.keys(readings)) {
    const reading: Partial<Record<string, number>> = readings[
      resourceClass
    ] as Partial<Record<string, number>>;

    // Half a reading is no reading: a used figure alone is a share of nothing.
    if (reading["total"] === undefined) {
      continue;
    }

    // Two hours of grace: the one it was last seen in may only just have ended.
    if (reading["seen"] !== undefined && newestSeen - reading["seen"] > 2) {
      continue;
    }

    inventories[resourceClass] = {
      total: reading["total"],
      reserved: reading["reserved"] ?? 0,
      allocationRatio: reading["ratio"] ?? 1,
      used: reading["used"] ?? 0,
    };
  }

  return inventories;
}

/*
 * ---------------------------------------------------------------------------
 * How many of a flavor fit, across hosts
 * ---------------------------------------------------------------------------
 */
export interface OpenStackFlavorFit {
  // Counted host by host, over the hosts that can give.
  fits: number;
  hostsWithRoom: number;
  // As if all of it were on one host: past `fits`, what is free is too spread out to use.
  fitsIfOnePool: number;
  // What the hosts someone disabled would add once enabled again, which is planned, not short.
  fitsOnDisabledHosts: number;
  // Whether any host could hold one at all, even empty. Lost and disabled hosts can.
  fitsOnAnEmptyHost: boolean;
  // Which class stops it on most hosts with no room. Null with room on every host.
  limitedBy: string | null;
  byZone: Record<string, number>;
  byAggregate: Record<string, number>;
}

function emptyInventoriesOf(host: OpenStackCapacityHost): OpenStackInventories {
  const empty: OpenStackInventories = {};
  for (const resourceClass of Object.keys(host.inventories)) {
    empty[resourceClass] = {
      ...(host.inventories[resourceClass] as OpenStackInventory),
      used: 0,
    };
  }
  return empty;
}

// A host's zone as these tables key it: a host nothing has placed in a zone is in "".
export function getOpenStackCapacityZoneKey(zone: string | null): string {
  return zone || "";
}

export function getOpenStackFlavorFit(data: {
  resources: Readonly<Record<string, number>>;
  hosts: ReadonlyArray<OpenStackCapacityHost>;
}): OpenStackFlavorFit {
  const result: OpenStackFlavorFit = {
    fits: 0,
    hostsWithRoom: 0,
    fitsIfOnePool: 0,
    fitsOnDisabledHosts: 0,
    fitsOnAnEmptyHost: false,
    limitedBy: null,
    byZone: {},
    byAggregate: {},
  };
  const freeByClass: Record<string, number> = {};
  const limitedBy: Record<string, number> = {};
  const classes: Array<string> = Object.keys(data.resources).filter(
    (resourceClass: string): boolean => {
      return (data.resources[resourceClass] as number) > 0;
    },
  );

  if (classes.length === 0) {
    return result;
  }

  for (const host of data.hosts) {
    if (
      !result.fitsOnAnEmptyHost &&
      getOpenStackFitOnHost({
        inventories: emptyInventoriesOf(host),
        resources: data.resources,
      }).fit > 0
    ) {
      result.fitsOnAnEmptyHost = true;
    }

    const onHost: OpenStackFitOnHost = getOpenStackFitOnHost({
      inventories: host.inventories,
      resources: data.resources,
    });

    if (host.state === "disabled") {
      result.fitsOnDisabledHosts += onHost.fit;
      continue;
    }

    if (host.state === "lost") {
      continue;
    }

    const zone: string = getOpenStackCapacityZoneKey(host.zone);
    result.byZone[zone] = (result.byZone[zone] || 0) + onHost.fit;

    for (const aggregate of host.aggregates) {
      result.byAggregate[aggregate] =
        (result.byAggregate[aggregate] || 0) + onHost.fit;
    }

    result.fits += onHost.fit;

    if (onHost.fit > 0) {
      result.hostsWithRoom += 1;
    } else if (onHost.limitedBy) {
      limitedBy[onHost.limitedBy] = (limitedBy[onHost.limitedBy] || 0) + 1;
    }

    for (const resourceClass of classes) {
      const inventory: OpenStackInventory | undefined =
        host.inventories[resourceClass];
      if (inventory) {
        freeByClass[resourceClass] =
          (freeByClass[resourceClass] || 0) +
          getOpenStackInventoryFree(inventory);
      }
    }
  }

  let fitsIfOnePool: number | null = null;
  for (const resourceClass of classes) {
    const count: number = Math.floor(
      (freeByClass[resourceClass] || 0) /
        (data.resources[resourceClass] as number),
    );
    fitsIfOnePool =
      fitsIfOnePool === null ? count : Math.min(fitsIfOnePool, count);
  }
  result.fitsIfOnePool = fitsIfOnePool ?? 0;

  let mostHosts: number = 0;
  for (const resourceClass of Object.keys(limitedBy).sort()) {
    if ((limitedBy[resourceClass] as number) > mostHosts) {
      mostHosts = limitedBy[resourceClass] as number;
      result.limitedBy = resourceClass;
    }
  }

  return result;
}

/*
 * ---------------------------------------------------------------------------
 * What a provider, a zone, an aggregate, a region and a cloud add up to
 * ---------------------------------------------------------------------------
 */
export type OpenStackCapacityScope = "cloud" | "region" | "zone" | "aggregate";

export interface OpenStackCapacityResource {
  resourceClass: string;
  // What Placement will promise and has promised, on the hosts that can give.
  capacity: number;
  used: number;
  free: number;
  percent: number | null;
  /*
   * What is held on hosts that can't give: lost and disabled ones. It isn't room, and those
   * instances exist, so a forecast counts them and a page's bar does not.
   */
  usedOnOtherHosts: number;
  // The hosts' own size, before any ratio.
  physical: number;
  // capacity / physical, and the lowest and highest ratio set on any of these hosts.
  allocationRatio: number | null;
  lowestRatio: number | null;
  highestRatio: number | null;
}

export interface OpenStackCapacityRollup {
  scope: OpenStackCapacityScope;
  // "" for the cloud, and for the hosts of a region that are in no zone.
  name: string;
  regionName: string | null;
  hostCount: number;
  lostHostCount: number;
  disabledHostCount: number;
  instanceCount: number;
  resources: Array<OpenStackCapacityResource>;
}

export function getOpenStackCapacityRollup(data: {
  scope: OpenStackCapacityScope;
  name: string;
  regionName: string | null;
  hosts: ReadonlyArray<OpenStackCapacityHost>;
}): OpenStackCapacityRollup {
  const byClass: Map<
    string,
    {
      capacity: number;
      used: number;
      free: number;
      usedOnOtherHosts: number;
      physical: number;
      lowestRatio: number | null;
      highestRatio: number | null;
    }
  > = new Map();

  const rollup: OpenStackCapacityRollup = {
    scope: data.scope,
    name: data.name,
    regionName: data.regionName,
    hostCount: data.hosts.length,
    lostHostCount: 0,
    disabledHostCount: 0,
    instanceCount: 0,
    resources: [],
  };

  for (const host of data.hosts) {
    rollup.instanceCount += host.instanceCount;

    if (host.state === "lost") {
      rollup.lostHostCount += 1;
    } else if (host.state === "disabled") {
      rollup.disabledHostCount += 1;
    }

    for (const resourceClass of Object.keys(host.inventories)) {
      const inventory: OpenStackInventory = host.inventories[
        resourceClass
      ] as OpenStackInventory;
      const totals: {
        capacity: number;
        used: number;
        free: number;
        usedOnOtherHosts: number;
        physical: number;
        lowestRatio: number | null;
        highestRatio: number | null;
      } = byClass.get(resourceClass) || {
        capacity: 0,
        used: 0,
        free: 0,
        usedOnOtherHosts: 0,
        physical: 0,
        lowestRatio: null,
        highestRatio: null,
      };

      if (host.state === "up") {
        totals.capacity += getOpenStackInventoryCapacity(inventory);
        totals.used += inventory.used;
        totals.free += getOpenStackInventoryFree(inventory);
        totals.physical += Math.max(0, inventory.total - inventory.reserved);
        totals.lowestRatio =
          totals.lowestRatio === null
            ? inventory.allocationRatio
            : Math.min(totals.lowestRatio, inventory.allocationRatio);
        totals.highestRatio =
          totals.highestRatio === null
            ? inventory.allocationRatio
            : Math.max(totals.highestRatio, inventory.allocationRatio);
      } else {
        totals.usedOnOtherHosts += inventory.used;
      }

      byClass.set(resourceClass, totals);
    }
  }

  rollup.resources = Array.from(byClass.keys())
    .sort(compareResourceClasses)
    .map((resourceClass: string): OpenStackCapacityResource => {
      const totals: {
        capacity: number;
        used: number;
        free: number;
        usedOnOtherHosts: number;
        physical: number;
        lowestRatio: number | null;
        highestRatio: number | null;
      } = byClass.get(resourceClass)!;

      return {
        resourceClass: resourceClass,
        capacity: totals.capacity,
        used: totals.used,
        free: totals.free,
        percent: percentOf(totals.used, totals.capacity),
        usedOnOtherHosts: totals.usedOnOtherHosts,
        physical: totals.physical,
        allocationRatio:
          totals.physical > 0 ? totals.capacity / totals.physical : null,
        lowestRatio: totals.lowestRatio,
        highestRatio: totals.highestRatio,
      };
    });

  return rollup;
}

const RESOURCE_CLASS_ORDER: ReadonlyArray<string> = [
  OPENSTACK_RESOURCE_VCPU,
  OPENSTACK_RESOURCE_PCPU,
  OPENSTACK_RESOURCE_MEMORY_MB,
  OPENSTACK_RESOURCE_DISK_GB,
];

// The classes every page knows first, then whatever else a cloud has, in order of name.
export function compareResourceClasses(first: string, second: string): number {
  const a: number = RESOURCE_CLASS_ORDER.indexOf(first);
  const b: number = RESOURCE_CLASS_ORDER.indexOf(second);

  if (a >= 0 && b >= 0) {
    return a - b;
  }
  if (a >= 0) {
    return -1;
  }
  if (b >= 0) {
    return 1;
  }
  return first.localeCompare(second);
}

/*
 * ---------------------------------------------------------------------------
 * Whether a zone can lose a host
 * ---------------------------------------------------------------------------
 */
export type OpenStackHostFailureState =
  | "can-lose-a-host"
  | "cannot-lose-a-host"
  // Fewer than two hosts: there was never anywhere for its instances to go.
  | "too-few-hosts"
  // Someone disabled a host here: planned work, which never pages, and says so on the page.
  | "host-disabled"
  // Nothing here says what these hosts hold.
  | "not-reported";

export interface OpenStackHostFailureResource {
  resourceClass: string;
  /*
   * Everything allocated here, on a lost host too: its instances exist, and want somewhere to go.
   */
  used: number;
  capacity: number;
  largestHost: string;
  largestHostCapacity: number;
  // What would be left with the largest host gone, and how far short of `used` that is.
  remaining: number;
  shortBy: number;
}

export interface OpenStackHostFailureHeadroom {
  state: OpenStackHostFailureState;
  runningHostCount: number;
  resources: Array<OpenStackHostFailureResource>;
}

/*
 * Whether these hosts could lose their largest and still fit what runs on them, as VMware's Host
 * failure asks of a cluster, and in the same way: what is allocated against what would be left.
 * The largest is the worst to lose, because what a host has allocated plus what it has free is its
 * capacity, whichever host it is. It compares amounts, not how they would fall across hosts, so it
 * says what must be true for an evacuation to work. A page says as much. Fragmentation is the
 * flavor table's to show.
 */
export function getOpenStackHostFailureHeadroom(
  hosts: ReadonlyArray<OpenStackCapacityHost>,
): OpenStackHostFailureHeadroom {
  const running: Array<OpenStackCapacityHost> = hosts.filter(
    (host: OpenStackCapacityHost): boolean => {
      return host.state === "up";
    },
  );
  const hasDisabled: boolean = hosts.some(
    (host: OpenStackCapacityHost): boolean => {
      return host.state === "disabled";
    },
  );

  const result: OpenStackHostFailureHeadroom = {
    state: "not-reported",
    runningHostCount: running.length,
    resources: [],
  };

  if (hosts.length < 2) {
    result.state = "too-few-hosts";
    return result;
  }

  for (const resourceClass of OPENSTACK_HOST_FAILURE_RESOURCE_CLASSES) {
    let used: number = 0;
    let capacity: number = 0;
    let largestHost: string = "";
    let largestHostCapacity: number = 0;
    let isHeld: boolean = false;

    for (const host of hosts) {
      const inventory: OpenStackInventory | undefined =
        host.inventories[resourceClass];
      if (!inventory) {
        continue;
      }
      isHeld = true;
      used += inventory.used;
      if (host.state !== "up") {
        continue;
      }
      const hostCapacity: number = getOpenStackInventoryCapacity(inventory);
      capacity += hostCapacity;
      if (hostCapacity > largestHostCapacity) {
        largestHostCapacity = hostCapacity;
        largestHost = host.name;
      }
    }

    if (!isHeld) {
      continue;
    }

    const remaining: number = capacity - largestHostCapacity;

    result.resources.push({
      resourceClass,
      used,
      capacity,
      largestHost,
      largestHostCapacity,
      remaining,
      shortBy: Math.max(0, used - remaining),
    });
  }

  if (result.resources.length === 0) {
    return result;
  }

  if (hasDisabled) {
    result.state = "host-disabled";
    return result;
  }

  result.state = result.resources.some(
    (resource: OpenStackHostFailureResource): boolean => {
      return resource.shortBy > 0;
    },
  )
    ? "cannot-lose-a-host"
    : "can-lose-a-host";

  return result;
}

/*
 * ---------------------------------------------------------------------------
 * What Placement says of a flavor
 * ---------------------------------------------------------------------------
 */
export interface OpenStackCandidateFit {
  // The provider at the root of a host's tree, which is what its name is on.
  rootProviderUuid: string;
  fit: number;
}

/*
 * How many instances each host has room for, from GET /allocation_candidates. One candidate per
 * way of placing one instance, and provider_summaries says what each provider holds and has
 * promised. So a count is the same sum as ever: how many times what the candidate asks of each
 * provider fits in what that provider has free, the lowest of them. It respects what inventories
 * can't: a host without a required trait is no candidate, and a nested provider can say a GPU is
 * on a child. A host with several ways of placing one (two NUMA nodes, say) takes the best of
 * them rather than their sum, which can only read low, and never promises what is not there.
 */
export function readOpenStackAllocationCandidates(
  body: JSONObject | null | undefined,
): Array<OpenStackCandidateFit> {
  const requests: JSONValue | undefined = body?.["allocation_requests"];
  const summaries: JSONObject =
    (body?.["provider_summaries"] as JSONObject | undefined) || {};

  if (!Array.isArray(requests)) {
    return [];
  }

  const best: Map<string, number> = new Map();

  for (const request of requests as Array<JSONObject>) {
    const allocations: JSONObject =
      (request?.["allocations"] as JSONObject | undefined) || {};
    let fit: number | null = null;
    let root: string | null = null;
    let isComputeRoot: boolean = false;

    for (const providerUuid of Object.keys(allocations)) {
      const summary: JSONObject =
        (summaries[providerUuid] as JSONObject | undefined) || {};
      const held: JSONObject =
        (summary["resources"] as JSONObject | undefined) || {};
      const asked: JSONObject =
        ((allocations[providerUuid] as JSONObject | undefined)?.[
          "resources"
        ] as JSONObject | undefined) || {};
      const providerRoot: string =
        typeof summary["root_provider_uuid"] === "string"
          ? (summary["root_provider_uuid"] as string)
          : providerUuid;

      for (const resourceClass of Object.keys(asked)) {
        const amount: number = Number(asked[resourceClass]);
        const reading: JSONObject =
          (held[resourceClass] as JSONObject | undefined) || {};
        const capacity: number = Number(reading["capacity"]);
        const used: number = Number(reading["used"]);

        if (!(amount > 0) || !Number.isFinite(capacity)) {
          continue;
        }

        const count: number = Math.floor(
          Math.max(0, capacity - (Number.isFinite(used) ? used : 0)) / amount,
        );
        fit = fit === null ? count : Math.min(fit, count);

        /*
         * A sharing provider can be in a candidate beside a host: the host is whichever holds
         * its CPU or memory, and otherwise the first of them.
         */
        const isComputeClass: boolean =
          resourceClass === OPENSTACK_RESOURCE_VCPU ||
          resourceClass === OPENSTACK_RESOURCE_PCPU ||
          resourceClass === OPENSTACK_RESOURCE_MEMORY_MB;

        if (root === null || (isComputeClass && !isComputeRoot)) {
          root = providerRoot;
          isComputeRoot = isComputeClass;
        }
      }
    }

    if (root !== null && fit !== null) {
      best.set(root, Math.max(best.get(root) ?? 0, fit));
    }
  }

  return Array.from(best.entries()).map(
    ([rootProviderUuid, fit]: [string, number]): OpenStackCandidateFit => {
      return { rootProviderUuid, fit };
    },
  );
}

// What a host is, to one of Placement's answers: its zone, its aggregates, and whether it counts.
export interface OpenStackCandidateHost {
  name: string;
  zone: string | null;
  aggregates: ReadonlyArray<string>;
  state: OpenStackCapacityHostState;
}

export interface OpenStackPlacementAnswer {
  fits: number;
  hostsWithRoom: number;
  // Placement answered with as many candidates as it was asked for: there may be more.
  isCapped: boolean;
  byZone: Record<string, number>;
  byAggregate: Record<string, number>;
}

/*
 * What an answer adds up to, host by host. Placement knows nothing of a nova-compute that stopped,
 * so it goes on offering a lost host, and only Nova's services can take that back out. It does
 * know one someone disabled (COMPUTE_STATUS_DISABLED), and that is left out here too in case it was
 * asked without the trait. A provider Nova doesn't list is no host of its own: it counts, under no
 * zone, because Placement says it would be offered.
 */
export function getOpenStackPlacementAnswer(data: {
  candidates: ReadonlyArray<OpenStackCandidateFit>;
  providerNames: ReadonlyMap<string, string>;
  hostsByShortName: ReadonlyMap<string, OpenStackCandidateHost>;
  candidateLimit: number;
  requestCount?: number | undefined;
}): OpenStackPlacementAnswer {
  const answer: OpenStackPlacementAnswer = {
    fits: 0,
    hostsWithRoom: 0,
    isCapped: (data.requestCount ?? 0) >= data.candidateLimit,
    byZone: {},
    byAggregate: {},
  };

  for (const candidate of data.candidates) {
    const name: string | undefined = data.providerNames.get(
      candidate.rootProviderUuid,
    );
    const host: OpenStackCandidateHost | undefined = name
      ? data.hostsByShortName.get(getOpenStackShortHostName(name))
      : undefined;

    if (host && host.state !== "up") {
      continue;
    }

    answer.fits += candidate.fit;

    if (candidate.fit > 0) {
      answer.hostsWithRoom += 1;
    }

    const zone: string = getOpenStackCapacityZoneKey(host?.zone || null);
    answer.byZone[zone] = (answer.byZone[zone] || 0) + candidate.fit;

    for (const aggregate of host?.aggregates || []) {
      answer.byAggregate[aggregate] =
        (answer.byAggregate[aggregate] || 0) + candidate.fit;
    }
  }

  return answer;
}

/*
 * ---------------------------------------------------------------------------
 * Allocation beside what hosts really use
 * ---------------------------------------------------------------------------
 */
export interface OpenStackHostRealUsage {
  // Each one's peak over the time read, as a share of the host's own threads or memory.
  cpuPercent: number | null;
  memoryPercent: number | null;
}

export interface OpenStackOvercommitReading {
  resourceClass: string;
  // The ratio set, across the hosts with a reading.
  allocationRatio: number | null;
  // What is really promised: allocated / the hosts' own size.
  allocatedRatio: number | null;
  // What the same hosts really use, on average at their peak, and the busiest one.
  realPercent: number;
  busiestPercent: number;
  hostsWithReading: number;
  hostCount: number;
  /*
   * The allocated ratio at which, at this load per instance, these hosts would reach `linePercent`.
   * Only a straight line from one reading, which a page says. Null when too few hosts report, or
   * they report nothing yet, because no answer is better than one from a host or two.
   */
  ratioAtLine: number | null;
  linePercent: number;
}

/*
 * Over half of a group's hosts have to report before anything is said of it: a figure read off a
 * few hosts says what those few are doing.
 */
const OVERCOMMIT_MINIMUM_HOST_SHARE: number = 0.5;

export function getOpenStackOvercommit(data: {
  hosts: ReadonlyArray<OpenStackCapacityHost>;
  realUsageByHost: ReadonlyMap<string, OpenStackHostRealUsage>;
  cpuLinePercent: number;
  memoryLinePercent: number;
}): Array<OpenStackOvercommitReading> {
  const running: Array<OpenStackCapacityHost> = data.hosts.filter(
    (host: OpenStackCapacityHost): boolean => {
      return host.state === "up";
    },
  );
  const readings: Array<OpenStackOvercommitReading> = [];

  const read: (
    resourceClass: string,
    linePercent: number,
    realOf: (usage: OpenStackHostRealUsage) => number | null,
  ) => void = (
    resourceClass: string,
    linePercent: number,
    realOf: (usage: OpenStackHostRealUsage) => number | null,
  ): void => {
    let hostsWithReading: number = 0;
    let realSum: number = 0;
    let busiest: number = 0;
    let used: number = 0;
    let physical: number = 0;
    let capacity: number = 0;
    let hostCount: number = 0;

    for (const host of running) {
      const inventory: OpenStackInventory | undefined =
        host.inventories[resourceClass];
      if (!inventory) {
        continue;
      }
      hostCount += 1;
      const usage: OpenStackHostRealUsage | undefined =
        data.realUsageByHost.get(getOpenStackShortHostName(host.name));
      const real: number | null = usage ? realOf(usage) : null;
      if (real === null || !Number.isFinite(real)) {
        continue;
      }
      hostsWithReading += 1;
      realSum += real;
      busiest = Math.max(busiest, real);
      used += inventory.used;
      physical += Math.max(0, inventory.total - inventory.reserved);
      capacity += getOpenStackInventoryCapacity(inventory);
    }

    if (
      hostsWithReading === 0 ||
      hostsWithReading < hostCount * OVERCOMMIT_MINIMUM_HOST_SHARE
    ) {
      return;
    }

    const realPercent: number = realSum / hostsWithReading;
    const allocatedRatio: number | null = physical > 0 ? used / physical : null;

    readings.push({
      resourceClass,
      allocationRatio: physical > 0 ? capacity / physical : null,
      allocatedRatio,
      realPercent,
      busiestPercent: busiest,
      hostsWithReading,
      hostCount,
      ratioAtLine:
        allocatedRatio !== null && allocatedRatio > 0 && realPercent > 0
          ? (allocatedRatio * linePercent) / realPercent
          : null,
      linePercent,
    });
  };

  read(
    OPENSTACK_RESOURCE_VCPU,
    data.cpuLinePercent,
    (usage: OpenStackHostRealUsage): number | null => {
      return usage.cpuPercent;
    },
  );
  read(
    OPENSTACK_RESOURCE_MEMORY_MB,
    data.memoryLinePercent,
    (usage: OpenStackHostRealUsage): number | null => {
      return usage.memoryPercent;
    },
  );

  return readings;
}

/*
 * ---------------------------------------------------------------------------
 * Allocations that no instance explains
 * ---------------------------------------------------------------------------
 */
export interface OpenStackInstancesOnHost {
  regionName: string | null;
  hypervisorName: string;
  // Null when the row doesn't say, and then this host can't be judged.
  flavorId: string | null;
  count: number;
  // Those on their way somewhere: a move holds its allocations under the migration's own id.
  movingCount: number;
}

export interface OpenStackHostAllocationMismatch {
  regionName: string | null;
  hypervisorName: string;
  // What Placement holds beyond what the host's instances explain. Below zero is the other way.
  vcpuExcess: number;
  memoryMbExcess: number;
  instanceCount: number;
}

/*
 * Whether what Placement holds on a host is what its instances' flavors add up to. More than that
 * is what an orphaned allocation looks like: a delete or a move that failed part way, leaving room
 * nobody can use, and only nova-manage placement audit will find them. Less is an instance Nova put
 * there without an allocation, which heal_allocations mends.
 *
 * vCPUs and memory only. Disk can't be judged, because an instance booted from a volume holds none
 * of what its flavor says, and a flavor can't say which. A host is left unjudged when anything on
 * it is moving, or an instance's flavor isn't one the cloud still lists: no finding on a guess.
 * VCPU and PCPU are added together on both sides, because an agent's cloud can't read the extra
 * specs that say a flavor is pinned, and the two together say the same either way.
 */
export function getOpenStackAllocationMismatches(data: {
  hosts: ReadonlyArray<OpenStackCapacityHost>;
  instances: ReadonlyArray<OpenStackInstancesOnHost>;
  flavorResources: ReadonlyMap<string, Readonly<Record<string, number>>>;
}): Array<OpenStackHostAllocationMismatch> {
  const hostKey: (regionName: string | null, name: string) => string = (
    regionName: string | null,
    name: string,
  ): string => {
    return `${regionName || ""}/${getOpenStackShortHostName(name)}`;
  };

  const expected: Map<
    string,
    { vcpu: number; memoryMb: number; count: number; canJudge: boolean }
  > = new Map();

  for (const row of data.instances) {
    const key: string = hostKey(row.regionName, row.hypervisorName);
    const totals: {
      vcpu: number;
      memoryMb: number;
      count: number;
      canJudge: boolean;
    } = expected.get(key) || {
      vcpu: 0,
      memoryMb: 0,
      count: 0,
      canJudge: true,
    };
    const flavor: Readonly<Record<string, number>> | undefined = row.flavorId
      ? data.flavorResources.get(`${row.regionName || ""}/${row.flavorId}`)
      : undefined;

    totals.count += row.count;

    if (!flavor || row.movingCount > 0) {
      totals.canJudge = false;
    } else {
      totals.vcpu +=
        (flavor[OPENSTACK_RESOURCE_VCPU] || 0) * row.count +
        (flavor[OPENSTACK_RESOURCE_PCPU] || 0) * row.count;
      totals.memoryMb +=
        (flavor[OPENSTACK_RESOURCE_MEMORY_MB] || 0) * row.count;
    }

    expected.set(key, totals);
  }

  const mismatches: Array<OpenStackHostAllocationMismatch> = [];

  for (const host of data.hosts) {
    const vcpu: OpenStackInventory | undefined =
      host.inventories[OPENSTACK_RESOURCE_VCPU];
    const pcpu: OpenStackInventory | undefined =
      host.inventories[OPENSTACK_RESOURCE_PCPU];
    const memory: OpenStackInventory | undefined =
      host.inventories[OPENSTACK_RESOURCE_MEMORY_MB];

    if (!vcpu && !pcpu && !memory) {
      continue;
    }

    const totals:
      | { vcpu: number; memoryMb: number; count: number; canJudge: boolean }
      | undefined = expected.get(hostKey(host.regionName, host.name));

    if (totals && !totals.canJudge) {
      continue;
    }

    const vcpuExcess: number =
      (vcpu?.used || 0) + (pcpu?.used || 0) - (totals?.vcpu || 0);
    const memoryMbExcess: number =
      (memory?.used || 0) - (totals?.memoryMb || 0);

    if (vcpuExcess !== 0 || memoryMbExcess !== 0) {
      mismatches.push({
        regionName: host.regionName,
        hypervisorName: host.name,
        vcpuExcess,
        memoryMbExcess,
        instanceCount: totals?.count || 0,
      });
    }
  }

  return mismatches;
}

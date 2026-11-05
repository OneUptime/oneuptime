import { JSONObject, JSONValue } from "../JSON";
import {
  OPENSTACK_ALLOCATION_MISMATCH_MINUTES,
  OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS,
  percentOf,
} from "./OpenStackHealthRules";
import {
  OPENSTACK_RESOURCE_DISK_GB,
  OPENSTACK_RESOURCE_MEMORY_MB,
  OPENSTACK_RESOURCE_PCPU,
  OPENSTACK_RESOURCE_VCPU,
  OpenStackCapacityHost,
  OpenStackCapacityResource,
  OpenStackCapacityRollup,
  OpenStackFlavorFit,
  OpenStackFlavorRequest,
  OpenStackHostAllocationMismatch,
  OpenStackHostFailureHeadroom,
  OpenStackOvercommitReading,
  OpenStackPlacementAnswer,
  getOpenStackCapacityHostState,
  getOpenStackCapacityRollup,
  getOpenStackCapacityZoneKey,
  getOpenStackFlavorFit,
  getOpenStackFlavorRequest,
  getOpenStackHostFailureHeadroom,
  parseOpenStackResourcesQuery,
  readOpenStackInventories,
} from "./OpenStackCapacity";
import { OpenStackForecast } from "./OpenStackForecast";

/*
 * WHAT THE CAPACITY PAGE READS, ALL OF IT, IN ONE ROW.
 *
 * A large cloud's capacity takes every hypervisor and flavor to work out, and the page should not
 * have to. So a worker works it out every couple of minutes from the rows the inventory holds,
 * and keeps the answer on the cloud. A page, a CSV export and an alert all read that one answer,
 * however large the cloud is, and a table can never hold more than this says it holds.
 *
 * Pure, so what it says can be tested on recordings, and JSON all the way down, because that is
 * how it is kept.
 */

// The most of each a snapshot holds, however many a cloud has. A page says how many it left out.
export const OPENSTACK_CAPACITY_FLAVOR_LIMIT: number = 200;
export const OPENSTACK_CAPACITY_AGGREGATE_LIMIT: number = 100;
export const OPENSTACK_CAPACITY_HOST_LIST_LIMIT: number = 50;
export const OPENSTACK_CAPACITY_MISMATCH_LIMIT: number = 100;

/*
 * What Placement last said of a flavor is what the page says, for as long as this. A probe asks
 * about a few flavors each collection and repeats the last answer in between, so this is well past
 * how long a round takes. Past it the probe has stopped asking, and inventories are what is left.
 */
export const OPENSTACK_PLACEMENT_ANSWER_TRUSTED_MINUTES: number = 6 * 60;

// How often the slow parts of a snapshot are read again: each is a read of its own.
export const OPENSTACK_CAPACITY_FORECAST_EVERY_MINUTES: number = 30;
export const OPENSTACK_CAPACITY_MISMATCH_EVERY_MINUTES: number = 15;

/*
 * What a forecast reads. A week, so a day's and a week's own rise and fall average out, and a day
 * at least before it says anything: six hours of a cloud being built reads as a cloud about to fill.
 */
export const OPENSTACK_CAPACITY_FORECAST_WINDOW_HOURS: number = 7 * 24;
export const OPENSTACK_CAPACITY_FORECAST_MINIMUM_HOURS: number = 24;

export type OpenStackFlavorFitSource = "placement" | "inventories";

export interface OpenStackCapacityFlavor {
  id: string;
  name: string;
  regionName: string | null;
  request: OpenStackFlavorRequest;
  isPublic: boolean | null;
  isDisabled: boolean;
  instanceCount: number;
  placementAnswer: (OpenStackPlacementAnswer & { askedAt: string }) | null;
}

export interface OpenStackCapacityFlavorRow {
  id: string;
  name: string;
  regionName: string | null;
  resources: Record<string, number>;
  hasRequiredTraits: boolean;
  isPublic: boolean | null;
  instanceCount: number;
  // Room for this many more, host by host, from whichever `source` says.
  fits: number;
  // Placement answered with as many as it was asked for, so `fits` is a floor.
  isAtLeast: boolean;
  source: OpenStackFlavorFitSource;
  askedAt: string | null;
  hostsWithRoom: number;
  // As if everything free were on one host. Past `fits`, what's free is too spread out to use.
  fitsIfOnePool: number;
  // No host could hold one, even empty: a flavor nothing here was ever able to place.
  isTooLargeForEveryHost: boolean;
  // None fit, and a host someone disabled has room: planned work, not a shortage.
  isOnlyOnDisabledHosts: boolean;
  limitedBy: string | null;
  byZone: Record<string, number>;
  byAggregate: Record<string, number>;
}

export type OpenStackCapacityPoolKind = "external-ip-pool" | "storage-pool";

// The two things that fill up with no resource class of their own.
export const OPENSTACK_CAPACITY_RESOURCE_IPV4: string = "IPV4_ADDRESS";
export const OPENSTACK_CAPACITY_RESOURCE_STORAGE_BYTES: string =
  "STORAGE_BYTES";

export interface OpenStackCapacityPool {
  kind: OpenStackCapacityPoolKind;
  // The network's ID or the pool's name: what its page is found by.
  id: string;
  name: string;
  regionName: string | null;
  used: number;
  capacity: number;
  percent: number | null;
}

export interface OpenStackCapacityZone extends OpenStackCapacityRollup {
  headroom: OpenStackHostFailureHeadroom;
  overcommit: Array<OpenStackOvercommitReading>;
}

export type OpenStackCapacityForecastScope = "zone" | OpenStackCapacityPoolKind;

export interface OpenStackCapacityForecastRow {
  scope: OpenStackCapacityForecastScope;
  // A zone's name, a network's or a pool's.
  name: string;
  // A network's ID or a pool's name, where the row has a page. "" for a zone.
  id: string;
  regionName: string | null;
  resourceClass: string;
  forecast: OpenStackForecast;
}

export interface OpenStackCapacityMismatchRow
  extends OpenStackHostAllocationMismatch {
  // When this was first seen to disagree, which is what says it is no passing moment.
  since: string;
}

export interface OpenStackCapacityHostNotCounted {
  name: string;
  regionName: string | null;
  zone: string | null;
  state: "lost" | "disabled";
  instanceCount: number;
}

export interface OpenStackCapacitySnapshot {
  generatedAt: string;
  cloud: OpenStackCapacityRollup;
  regions: Array<OpenStackCapacityRollup>;
  zones: Array<OpenStackCapacityZone>;
  aggregates: Array<OpenStackCapacityRollup>;
  aggregatesLeftOut: number;
  flavors: Array<OpenStackCapacityFlavorRow>;
  flavorsLeftOut: number;
  pools: Array<OpenStackCapacityPool>;
  forecasts: Array<OpenStackCapacityForecastRow>;
  forecastsReadAt: string | null;
  mismatches: Array<OpenStackCapacityMismatchRow>;
  mismatchesCheckedAt: string | null;
  hostsNotCounted: Array<OpenStackCapacityHostNotCounted>;
  hostsNotCountedLeftOut: number;
}

/*
 * ---------------------------------------------------------------------------
 * Reading the inventory's rows
 * ---------------------------------------------------------------------------
 */
function factsOf(row: { facts?: JSONObject | null | undefined }): JSONObject {
  return row.facts || {};
}

function textFact(facts: JSONObject, name: string): string {
  const value: JSONValue | undefined = facts[name];
  return typeof value === "string" ? value : "";
}

export interface OpenStackCapacityHostSourceRow {
  hypervisorName?: string | null | undefined;
  name?: string | null | undefined;
  regionName?: string | null | undefined;
  availabilityZone?: string | null | undefined;
  status?: string | null | undefined;
  adminState?: string | null | undefined;
  instanceCount?: number | null | undefined;
  facts?: JSONObject | null | undefined;
}

export function readOpenStackCapacityHost(
  row: OpenStackCapacityHostSourceRow,
): OpenStackCapacityHost {
  const facts: JSONObject = factsOf(row);

  return {
    name: row.hypervisorName || row.name || "",
    regionName: row.regionName || null,
    zone: row.availabilityZone || null,
    aggregates: textFact(facts, "aggregates")
      .split(",")
      .map((name: string): string => {
        return name.trim();
      })
      .filter((name: string): boolean => {
        return name.length > 0;
      }),
    state: getOpenStackCapacityHostState(row),
    instanceCount: row.instanceCount || 0,
    inventories: readOpenStackInventories(facts),
  };
}

const BYTES_PER_MIB: number = 1024 * 1024;
const BYTES_PER_GIB: number = 1024 * 1024 * 1024;

function toNumberOrNull(value: unknown): number | null {
  const parsed: number =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function readOpenStackPlacementAnswer(
  facts: JSONObject,
): (OpenStackPlacementAnswer & { askedAt: string }) | null {
  const answer: JSONValue | undefined = facts["placementAnswer"];

  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return null;
  }

  const value: JSONObject = answer as JSONObject;
  const askedAt: JSONValue | undefined = value["askedAt"];
  const fits: number | null = toNumberOrNull(value["fits"]);

  if (typeof askedAt !== "string" || fits === null) {
    return null;
  }

  return {
    askedAt,
    fits,
    hostsWithRoom: toNumberOrNull(value["hostsWithRoom"]) ?? 0,
    isCapped: value["isCapped"] === true,
    byZone: (value["byZone"] as Record<string, number> | undefined) || {},
    byAggregate:
      (value["byAggregate"] as Record<string, number> | undefined) || {},
  };
}

/*
 * What a Flavor row asks Placement for. The probe works it out from Nova's own answer, extra specs
 * and all, and says so in its row. The agent's exporter only says vCPUs, RAM and disk, so that is
 * all it can ask for, and a page says the agent's count can't see traits.
 */
export interface OpenStackCapacityFlavorSourceRow {
  externalId?: string | null | undefined;
  name?: string | null | undefined;
  regionName?: string | null | undefined;
  vcpuCapacity?: number | string | null | undefined;
  memoryCapacityBytes?: number | string | null | undefined;
  diskCapacityBytes?: number | string | null | undefined;
  facts?: JSONObject | null | undefined;
}

export function readOpenStackCapacityFlavor(data: {
  row: OpenStackCapacityFlavorSourceRow;
  instanceCount: number;
}): OpenStackCapacityFlavor {
  const { row } = data;
  const facts: JSONObject = factsOf(row);
  const prefix: string = `${row.regionName || "default"}/`;
  const externalId: string = row.externalId || "";
  const id: string = externalId.startsWith(prefix)
    ? externalId.substring(prefix.length)
    : externalId;

  const resources: Record<string, number> = parseOpenStackResourcesQuery(
    textFact(facts, "placementResources"),
  );
  const toTraits: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return text
      .split(",")
      .map((trait: string): string => {
        return trait.trim();
      })
      .filter((trait: string): boolean => {
        return trait.length > 0;
      });
  };

  const memory: number | null = toNumberOrNull(row.memoryCapacityBytes);
  const disk: number | null = toNumberOrNull(row.diskCapacityBytes);

  const request: OpenStackFlavorRequest =
    Object.keys(resources).length > 0
      ? {
          resources,
          requiredTraits: toTraits(textFact(facts, "placementRequired")),
          forbiddenTraits: toTraits(textFact(facts, "placementForbidden")),
        }
      : getOpenStackFlavorRequest({
          vcpus: toNumberOrNull(row.vcpuCapacity),
          ramMib: memory === null ? null : memory / BYTES_PER_MIB,
          diskGib: disk === null ? null : disk / BYTES_PER_GIB,
        });

  return {
    id,
    name: row.name || id,
    regionName: row.regionName || null,
    request,
    isPublic: typeof facts["isPublic"] === "boolean" ? facts["isPublic"] : null,
    isDisabled: facts["isDisabled"] === true,
    instanceCount: data.instanceCount,
    placementAnswer: readOpenStackPlacementAnswer(facts),
  };
}

/*
 * ---------------------------------------------------------------------------
 * One flavor's row
 * ---------------------------------------------------------------------------
 */
function isAnswerTrusted(
  answer: { askedAt: string } | null,
  now: Date,
): boolean {
  if (!answer) {
    return false;
  }
  const askedAt: number = new Date(answer.askedAt).getTime();
  return (
    Number.isFinite(askedAt) &&
    now.getTime() - askedAt <=
      OPENSTACK_PLACEMENT_ANSWER_TRUSTED_MINUTES * 60_000
  );
}

export function getOpenStackCapacityFlavorRow(data: {
  flavor: OpenStackCapacityFlavor;
  // This flavor's region's hosts: a flavor's ID only means something in its own.
  hosts: ReadonlyArray<OpenStackCapacityHost>;
  now: Date;
}): OpenStackCapacityFlavorRow {
  const { flavor } = data;
  const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
    resources: flavor.request.resources,
    hosts: data.hosts,
  });
  const answer: (OpenStackPlacementAnswer & { askedAt: string }) | null =
    isAnswerTrusted(flavor.placementAnswer, data.now)
      ? flavor.placementAnswer
      : null;

  const fits: number = answer ? answer.fits : fit.fits;

  return {
    id: flavor.id,
    name: flavor.name,
    regionName: flavor.regionName,
    resources: flavor.request.resources,
    hasRequiredTraits:
      flavor.request.requiredTraits.length > 0 ||
      flavor.request.forbiddenTraits.length > 0,
    isPublic: flavor.isPublic,
    instanceCount: flavor.instanceCount,
    fits,
    isAtLeast: Boolean(answer?.isCapped),
    source: answer ? "placement" : "inventories",
    askedAt: answer?.askedAt || null,
    hostsWithRoom: answer ? answer.hostsWithRoom : fit.hostsWithRoom,
    fitsIfOnePool: fit.fitsIfOnePool,
    // An answer that found room outranks a sum that found none: it knows more.
    isTooLargeForEveryHost: !fit.fitsOnAnEmptyHost && fits === 0,
    isOnlyOnDisabledHosts: fits === 0 && fit.fitsOnDisabledHosts > 0,
    limitedBy: fits > 0 ? null : fit.limitedBy,
    byZone: answer ? answer.byZone : fit.byZone,
    byAggregate: answer ? answer.byAggregate : fit.byAggregate,
  };
}

/*
 * ---------------------------------------------------------------------------
 * The whole cloud
 * ---------------------------------------------------------------------------
 */

// What people run first, then what they can ask for, then the rest. Flavor names are free text.
function compareFlavors(
  first: OpenStackCapacityFlavor,
  second: OpenStackCapacityFlavor,
): number {
  return (
    second.instanceCount - first.instanceCount ||
    Number(second.isPublic === true) - Number(first.isPublic === true) ||
    (first.regionName || "").localeCompare(second.regionName || "") ||
    first.name.localeCompare(second.name, undefined, { numeric: true })
  );
}

function regionKey(regionName: string | null): string {
  return regionName || "";
}

function compareRollups(
  first: OpenStackCapacityRollup,
  second: OpenStackCapacityRollup,
): number {
  return (
    (first.regionName || "").localeCompare(second.regionName || "") ||
    first.name.localeCompare(second.name, undefined, { numeric: true })
  );
}

export function buildOpenStackCapacitySnapshot(data: {
  hosts: ReadonlyArray<OpenStackCapacityHost>;
  flavors: ReadonlyArray<OpenStackCapacityFlavor>;
  pools: ReadonlyArray<OpenStackCapacityPool>;
  // Worked out on their own, less often than this runs. See the two *_EVERY_MINUTES.
  forecasts?: ReadonlyArray<OpenStackCapacityForecastRow> | undefined;
  forecastsReadAt?: string | null | undefined;
  mismatches?: ReadonlyArray<OpenStackCapacityMismatchRow> | undefined;
  mismatchesCheckedAt?: string | null | undefined;
  // What a zone's hosts really use, where anything says.
  overcommitOf?:
    | ((
        hosts: ReadonlyArray<OpenStackCapacityHost>,
      ) => Array<OpenStackOvercommitReading>)
    | undefined;
  now: Date;
}): OpenStackCapacitySnapshot {
  const hostsByRegion: Map<string, Array<OpenStackCapacityHost>> = new Map();

  const byGroup: Map<
    string,
    {
      regionName: string | null;
      name: string;
      hosts: Array<OpenStackCapacityHost>;
    }
  > = new Map();
  const byAggregate: Map<
    string,
    {
      regionName: string | null;
      name: string;
      hosts: Array<OpenStackCapacityHost>;
    }
  > = new Map();

  const add: (
    groups: Map<
      string,
      {
        regionName: string | null;
        name: string;
        hosts: Array<OpenStackCapacityHost>;
      }
    >,
    name: string,
    host: OpenStackCapacityHost,
  ) => void = (
    groups: Map<
      string,
      {
        regionName: string | null;
        name: string;
        hosts: Array<OpenStackCapacityHost>;
      }
    >,
    name: string,
    host: OpenStackCapacityHost,
  ): void => {
    const key: string = `${regionKey(host.regionName)}/${name}`;
    const group: {
      regionName: string | null;
      name: string;
      hosts: Array<OpenStackCapacityHost>;
    } = groups.get(key) || { regionName: host.regionName, name, hosts: [] };
    group.hosts.push(host);
    groups.set(key, group);
  };

  const hostsNotCounted: Array<OpenStackCapacityHostNotCounted> = [];

  for (const host of data.hosts) {
    const key: string = regionKey(host.regionName);
    const hosts: Array<OpenStackCapacityHost> = hostsByRegion.get(key) || [];
    hosts.push(host);
    hostsByRegion.set(key, hosts);

    add(byGroup, getOpenStackCapacityZoneKey(host.zone), host);

    for (const aggregate of host.aggregates) {
      add(byAggregate, aggregate, host);
    }

    if (host.state !== "up") {
      hostsNotCounted.push({
        name: host.name,
        regionName: host.regionName,
        zone: host.zone,
        state: host.state,
        instanceCount: host.instanceCount,
      });
    }
  }

  const aggregates: Array<OpenStackCapacityRollup> = Array.from(
    byAggregate.values(),
  )
    .map(
      (group: {
        regionName: string | null;
        name: string;
        hosts: Array<OpenStackCapacityHost>;
      }): OpenStackCapacityRollup => {
        return getOpenStackCapacityRollup({
          scope: "aggregate",
          name: group.name,
          regionName: group.regionName,
          hosts: group.hosts,
        });
      },
    )
    .sort(compareRollups);

  const flavors: Array<OpenStackCapacityFlavor> = data.flavors
    .filter((flavor: OpenStackCapacityFlavor): boolean => {
      return (
        !flavor.isDisabled && Object.keys(flavor.request.resources).length > 0
      );
    })
    .sort(compareFlavors);

  const shownFlavors: Array<OpenStackCapacityFlavor> = flavors.slice(
    0,
    OPENSTACK_CAPACITY_FLAVOR_LIMIT,
  );

  return {
    generatedAt: data.now.toISOString(),
    cloud: getOpenStackCapacityRollup({
      scope: "cloud",
      name: "",
      regionName: null,
      hosts: data.hosts,
    }),
    regions: Array.from(hostsByRegion.entries())
      .map(
        ([key, hosts]: [
          string,
          Array<OpenStackCapacityHost>,
        ]): OpenStackCapacityRollup => {
          return getOpenStackCapacityRollup({
            scope: "region",
            name: key,
            regionName: hosts[0]!.regionName,
            hosts,
          });
        },
      )
      .sort(compareRollups),
    zones: Array.from(byGroup.values())
      .map(
        (group: {
          regionName: string | null;
          name: string;
          hosts: Array<OpenStackCapacityHost>;
        }): OpenStackCapacityZone => {
          return {
            ...getOpenStackCapacityRollup({
              scope: "zone",
              name: group.name,
              regionName: group.regionName,
              hosts: group.hosts,
            }),
            headroom: getOpenStackHostFailureHeadroom(group.hosts),
            overcommit: data.overcommitOf ? data.overcommitOf(group.hosts) : [],
          };
        },
      )
      .sort(compareRollups),
    aggregates: aggregates.slice(0, OPENSTACK_CAPACITY_AGGREGATE_LIMIT),
    aggregatesLeftOut: Math.max(
      0,
      aggregates.length - OPENSTACK_CAPACITY_AGGREGATE_LIMIT,
    ),
    flavors: shownFlavors.map(
      (flavor: OpenStackCapacityFlavor): OpenStackCapacityFlavorRow => {
        return getOpenStackCapacityFlavorRow({
          flavor,
          hosts: hostsByRegion.get(regionKey(flavor.regionName)) || [],
          now: data.now,
        });
      },
    ),
    flavorsLeftOut: flavors.length - shownFlavors.length,
    pools: [...data.pools],
    forecasts: [...(data.forecasts || [])],
    forecastsReadAt: data.forecastsReadAt ?? null,
    mismatches: [...(data.mismatches || [])],
    mismatchesCheckedAt: data.mismatchesCheckedAt ?? null,
    hostsNotCounted: hostsNotCounted.slice(
      0,
      OPENSTACK_CAPACITY_HOST_LIST_LIMIT,
    ),
    hostsNotCountedLeftOut: Math.max(
      0,
      hostsNotCounted.length - OPENSTACK_CAPACITY_HOST_LIST_LIMIT,
    ),
  };
}

/*
 * A storage pool, from its row, and an external network's IPv4 addresses, from its. Only an
 * external one: a tenant's network filling up is theirs to see, as on every other page.
 */
export interface OpenStackCapacityPoolSourceRow {
  name?: string | null | undefined;
  regionName?: string | null | undefined;
  diskCapacityBytes?: number | string | null | undefined;
  diskAllocatedBytes?: number | string | null | undefined;
}

export function readOpenStackCapacityStoragePool(
  row: OpenStackCapacityPoolSourceRow,
): OpenStackCapacityPool | null {
  const capacity: number | null = toNumberOrNull(row.diskCapacityBytes);
  const used: number | null = toNumberOrNull(row.diskAllocatedBytes);

  if (!row.name || capacity === null || used === null || capacity <= 0) {
    return null;
  }

  return {
    kind: "storage-pool",
    id: row.name,
    name: row.name,
    regionName: row.regionName || null,
    used,
    capacity,
    percent: percentOf(used, capacity),
  };
}

export interface OpenStackCapacityNetworkSourceRow {
  externalId?: string | null | undefined;
  name?: string | null | undefined;
  regionName?: string | null | undefined;
  facts?: JSONObject | null | undefined;
}

export function readOpenStackCapacityExternalNetwork(
  row: OpenStackCapacityNetworkSourceRow,
): OpenStackCapacityPool | null {
  const facts: JSONObject = factsOf(row);
  const used: number | null = toNumberOrNull(facts["ipsUsed"]);
  const capacity: number | null = toNumberOrNull(facts["ipsTotal"]);

  if (
    facts["isExternal"] !== true ||
    !row.externalId ||
    used === null ||
    capacity === null ||
    capacity <= 0
  ) {
    return null;
  }

  return {
    kind: "external-ip-pool",
    id: row.externalId,
    name: row.name || row.externalId,
    regionName: row.regionName || null,
    used,
    capacity,
    percent: percentOf(used, capacity),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Allocations that disagree for long enough to be a finding
 * ---------------------------------------------------------------------------
 *
 * Each read says what disagrees now. A host that went on disagreeing keeps the time it was first
 * seen, and one that stopped is forgotten, so what a page shows is only what has lasted.
 */
export function carryOpenStackAllocationMismatches(data: {
  found: ReadonlyArray<OpenStackHostAllocationMismatch>;
  previous: ReadonlyArray<OpenStackCapacityMismatchRow>;
  now: Date;
}): Array<OpenStackCapacityMismatchRow> {
  const keyOf: (row: OpenStackHostAllocationMismatch) => string = (
    row: OpenStackHostAllocationMismatch,
  ): string => {
    return `${row.regionName || ""}/${row.hypervisorName}`;
  };
  const since: Map<string, string> = new Map(
    data.previous.map((row: OpenStackCapacityMismatchRow): [string, string] => {
      return [keyOf(row), row.since];
    }),
  );

  return data.found
    .map(
      (row: OpenStackHostAllocationMismatch): OpenStackCapacityMismatchRow => {
        return {
          ...row,
          since: since.get(keyOf(row)) || data.now.toISOString(),
        };
      },
    )
    .sort(
      (
        first: OpenStackCapacityMismatchRow,
        second: OpenStackCapacityMismatchRow,
      ): number => {
        return (
          Math.max(second.vcpuExcess, 0) - Math.max(first.vcpuExcess, 0) ||
          Math.max(second.memoryMbExcess, 0) -
            Math.max(first.memoryMbExcess, 0) ||
          first.hypervisorName.localeCompare(second.hypervisorName)
        );
      },
    )
    .slice(0, OPENSTACK_CAPACITY_MISMATCH_LIMIT);
}

export function isOpenStackAllocationMismatchLasting(
  row: Pick<OpenStackCapacityMismatchRow, "since">,
  now: Date,
): boolean {
  const since: number = new Date(row.since).getTime();

  return (
    Number.isFinite(since) &&
    now.getTime() - since >= OPENSTACK_ALLOCATION_MISMATCH_MINUTES * 60_000
  );
}

/*
 * ---------------------------------------------------------------------------
 * What is short, soonest first
 * ---------------------------------------------------------------------------
 */
export type OpenStackCapacityShortageKind =
  | "flavor-cannot-be-placed"
  | "headroom-gone"
  | "full"
  | "fills-up"
  | "allocations-disagree";

export interface OpenStackCapacityShortage {
  kind: OpenStackCapacityShortageKind;
  // What it is about: a flavor, a zone, a pool or a host.
  name: string;
  id: string;
  regionName: string | null;
  // In how many days it is short. Zero is now.
  days: number;
  // Whether this is at the line the alert templates draw.
  isUrgent: boolean;
  scope?: OpenStackCapacityForecastScope | undefined;
  resourceClass?: string | undefined;
  // The flavor's own numbers: how many would fit if what's free were on one host.
  fitsIfOnePool?: number | undefined;
  flavorInUse?: number | undefined;
  // The zone's numbers: which class is furthest short of surviving a host.
  shortBy?: number | undefined;
  vcpuExcess?: number | undefined;
  memoryMbExcess?: number | undefined;
  since?: string | undefined;
}

/*
 * Past this far out a forecast is on a table, not on a list of what's short. A quarter is about as
 * far ahead as a capacity plan looks, and a straight line is not to be trusted further.
 */
export const OPENSTACK_CAPACITY_SHORTAGE_HORIZON_DAYS: number = 90;

const SHORTAGE_ORDER: ReadonlyArray<OpenStackCapacityShortageKind> = [
  "flavor-cannot-be-placed",
  "full",
  "headroom-gone",
  "fills-up",
  "allocations-disagree",
];

export function getOpenStackCapacityShortages(data: {
  snapshot: OpenStackCapacitySnapshot;
  regionName: string | null;
  now: Date;
}): Array<OpenStackCapacityShortage> {
  const inRegion: (regionName: string | null) => boolean = (
    regionName: string | null,
  ): boolean => {
    return !data.regionName || regionName === data.regionName;
  };

  const shortages: Array<OpenStackCapacityShortage> = [];

  for (const flavor of data.snapshot.flavors) {
    if (
      inRegion(flavor.regionName) &&
      flavor.fits === 0 &&
      !flavor.isTooLargeForEveryHost &&
      !flavor.isOnlyOnDisabledHosts &&
      isOpenStackFlavorOffered(flavor)
    ) {
      shortages.push({
        kind: "flavor-cannot-be-placed",
        name: flavor.name,
        id: flavor.id,
        regionName: flavor.regionName,
        days: 0,
        isUrgent: true,
        resourceClass: flavor.limitedBy || undefined,
        fitsIfOnePool: flavor.fitsIfOnePool,
        flavorInUse: flavor.instanceCount,
      });
    }
  }

  for (const zone of data.snapshot.zones) {
    if (
      inRegion(zone.regionName) &&
      zone.headroom.state === "cannot-lose-a-host"
    ) {
      const worst:
        | OpenStackHostFailureHeadroom["resources"][number]
        | undefined = zone.headroom.resources.find(
        (
          resource: OpenStackHostFailureHeadroom["resources"][number],
        ): boolean => {
          return resource.shortBy > 0;
        },
      );
      shortages.push({
        kind: "headroom-gone",
        name: zone.name,
        id: zone.name,
        regionName: zone.regionName,
        days: 0,
        isUrgent: true,
        resourceClass: worst?.resourceClass,
        shortBy: worst?.shortBy,
      });
    }
  }

  for (const row of data.snapshot.forecasts) {
    if (!inRegion(row.regionName)) {
      continue;
    }

    if (row.forecast.state === "full") {
      shortages.push({
        kind: "full",
        name: row.name,
        id: row.id,
        regionName: row.regionName,
        days: 0,
        isUrgent: true,
        scope: row.scope,
        resourceClass: row.resourceClass,
      });
    } else if (
      row.forecast.state === "days" &&
      row.forecast.days <= OPENSTACK_CAPACITY_SHORTAGE_HORIZON_DAYS
    ) {
      shortages.push({
        kind: "fills-up",
        name: row.name,
        id: row.id,
        regionName: row.regionName,
        days: row.forecast.days,
        isUrgent: row.forecast.days < OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS,
        scope: row.scope,
        resourceClass: row.resourceClass,
      });
    }
  }

  for (const row of data.snapshot.mismatches) {
    if (
      inRegion(row.regionName) &&
      (row.vcpuExcess > 0 || row.memoryMbExcess > 0) &&
      isOpenStackAllocationMismatchLasting(row, data.now)
    ) {
      shortages.push({
        kind: "allocations-disagree",
        name: row.hypervisorName,
        id: row.hypervisorName,
        regionName: row.regionName,
        // It holds capacity now, and nothing here is going to run out because of it today.
        days: OPENSTACK_CAPACITY_SHORTAGE_HORIZON_DAYS,
        isUrgent: false,
        vcpuExcess: row.vcpuExcess,
        memoryMbExcess: row.memoryMbExcess,
        since: row.since,
      });
    }
  }

  return shortages.sort(
    (
      first: OpenStackCapacityShortage,
      second: OpenStackCapacityShortage,
    ): number => {
      return (
        first.days - second.days ||
        SHORTAGE_ORDER.indexOf(first.kind) -
          SHORTAGE_ORDER.indexOf(second.kind) ||
        first.name.localeCompare(second.name, undefined, { numeric: true })
      );
    },
  );
}

/*
 * Whether anyone can ask for it: public, or a private one someone runs. Nobody can be stopped by a
 * private flavor nobody has been given.
 */
export function isOpenStackFlavorOffered(
  flavor: Pick<OpenStackCapacityFlavorRow, "isPublic" | "instanceCount">,
): boolean {
  return flavor.isPublic !== false || flavor.instanceCount > 0;
}

/*
 * "Room for 340 m1.small, and 0 m1.xlarge": the most-run flavor with room, and the largest one
 * that fits nowhere, in the page's first line. Null with no flavors to speak of.
 */
export function getOpenStackCapacityHeadline(data: {
  snapshot: OpenStackCapacitySnapshot;
  regionName: string | null;
}): {
  hasRoom: { name: string; fits: number; isAtLeast: boolean } | null;
  noRoom: { name: string } | null;
} | null {
  const offered: Array<OpenStackCapacityFlavorRow> =
    data.snapshot.flavors.filter(
      (flavor: OpenStackCapacityFlavorRow): boolean => {
        return (
          (!data.regionName || flavor.regionName === data.regionName) &&
          isOpenStackFlavorOffered(flavor) &&
          !flavor.isTooLargeForEveryHost
        );
      },
    );

  if (offered.length === 0) {
    return null;
  }

  // In the order of what people run most, which the snapshot is already in.
  const hasRoom: OpenStackCapacityFlavorRow | undefined = offered.find(
    (flavor: OpenStackCapacityFlavorRow): boolean => {
      return flavor.fits > 0;
    },
  );
  const noRoom: OpenStackCapacityFlavorRow | undefined = offered.find(
    (flavor: OpenStackCapacityFlavorRow): boolean => {
      return flavor.fits === 0;
    },
  );

  return {
    hasRoom: hasRoom
      ? { name: hasRoom.name, fits: hasRoom.fits, isAtLeast: hasRoom.isAtLeast }
      : null,
    noRoom: noRoom ? { name: noRoom.name } : null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * What a zone's resources are called, in a forecast and a CSV
 * ---------------------------------------------------------------------------
 */
export function getOpenStackCapacityResourceOf(
  rollup: Pick<OpenStackCapacityRollup, "resources">,
  resourceClass: string,
): OpenStackCapacityResource | null {
  return (
    rollup.resources.find((resource: OpenStackCapacityResource): boolean => {
      return resource.resourceClass === resourceClass;
    }) || null
  );
}

// The classes a page has a column for, in that order. Anything else has a line of its own.
export const OPENSTACK_CAPACITY_MAIN_CLASSES: ReadonlyArray<string> = [
  OPENSTACK_RESOURCE_VCPU,
  OPENSTACK_RESOURCE_PCPU,
  OPENSTACK_RESOURCE_MEMORY_MB,
  OPENSTACK_RESOURCE_DISK_GB,
];

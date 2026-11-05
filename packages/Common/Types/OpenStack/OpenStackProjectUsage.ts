import { addUtcDays, startOfUtcDay } from "../Cloud/CloudCost";
import { JSONObject } from "../JSON";

/*
 * WHO USED WHAT, FROM INVENTORY.
 *
 * The cloud's inventory says what each project holds right now: which instances of which flavor,
 * how many gigabytes of which volume type, how many floating IPs. Usage over time is that reading
 * multiplied by the time since the last one, added up. No per-instance series is read or written,
 * so this works the same on a cloud that keeps none of them, and costs the same however many
 * samples a metric store holds: one read of the inventory every quarter of an hour.
 *
 * What that gives up, and the page and the docs say so:
 *
 *   - Time moves in steps of one reading. An instance that lived less than a quarter of an hour may
 *     never be seen, and a change is counted from the first reading that shows it.
 *   - A part still counts until the inventory lets go of it, up to the stale window after it went
 *     (OpenStackResourceService.deleteStaleForCloud).
 *   - Hours OneUptime wasn't reading aren't guessed at. A gap longer than an hour counts one hour
 *     and the rest is kept as hours not counted, which the page shows beside the figures.
 *
 * Quantities are kept per flavor as instance-hours, beside what that flavor gave an instance. A
 * flavor's size can't change in Nova, so vCPU-hours and memory-hours follow from them, and a resize
 * is simply hours moving from one flavor to another. An instance holds its flavor from when it's
 * placed until it's deleted, so one shut off still counts, on its own line, because Nova keeps
 * what it holds. One never placed holds nothing, and neither does one shelved off its host.
 */

export const OPENSTACK_USAGE_EVERY_MINUTES: number = 15;

// A gap longer than this isn't a late reading. It's hours nobody was reading.
export const OPENSTACK_USAGE_LONGEST_INTERVAL_MINUTES: number = 60;

// Long enough to hold this month and all of last month, day by day.
export const OPENSTACK_USAGE_DAY_ROWS_KEPT_DAYS: number = 62;
export const OPENSTACK_USAGE_MONTH_ROWS_KEPT_MONTHS: number = 13;

// What "a month" means when a price per hour is said per month: a year's hours over twelve.
export const OPENSTACK_HOURS_IN_A_MONTH: number = 730;

export const OPENSTACK_INSTANCE_STATUS_SHUT_OFF: string = "SHUTOFF";

// Off every host, whatever its row last said of where it ran.
export const OPENSTACK_USAGE_INSTANCE_STATUSES_HOLDING_NOTHING: ReadonlyArray<string> =
  ["SHELVED_OFFLOADED", "DELETED"];

/*
 * A volume or a snapshot in error or still being made has no space behind it on the whole, and an
 * image holds its bytes only once it's active.
 */
export const OPENSTACK_USAGE_STORAGE_STATUSES_HOLDING_NOTHING: ReadonlyArray<string> =
  ["error", "creating"];
export const OPENSTACK_USAGE_IMAGE_STATUS_HOLDING: string = "active";

const MS_IN_AN_HOUR: number = 60 * 60 * 1000;
const MIB_IN_A_GB: number = 1024;
const BYTES_IN_A_MIB: number = 1024 * 1024;
const BYTES_IN_A_GB: number = 1024 * 1024 * 1024;

// Instance-hours of one flavor. Keyed by region and id, because a flavor's id is its region's own.
export interface OpenStackFlavorUsage {
  regionName: string | null;
  flavorId: string | null;
  name: string | null;
  // Null when the cloud no longer lists this flavor, so what it gave isn't known.
  vcpus: number | null;
  ramMib: number | null;
  runningHours: number;
  shutOffHours: number;
}

export interface OpenStackUsageQuantities {
  flavors: Record<string, OpenStackFlavorUsage>;
  volumeGbHoursByType: Record<string, number>;
  floatingIpHours: number;
  imageGbHours: number;
  snapshotGbHours: number;
}

export interface OpenStackUsageTotals {
  instanceHours: number;
  shutOffInstanceHours: number;
  // Instance-hours of a flavor the cloud no longer lists, which vCPU-hours can't count.
  unknownFlavorHours: number;
  vcpuHours: number;
  memoryGbHours: number;
  volumeGbHours: number;
  floatingIpHours: number;
  imageGbHours: number;
  snapshotGbHours: number;
}

// One flavor a project holds right now.
export interface OpenStackFlavorHolding {
  regionName: string | null;
  flavorId: string | null;
  name: string | null;
  vcpus: number | null;
  ramMib: number | null;
  running: number;
  shutOff: number;
}

// Everything one project holds right now.
export interface OpenStackProjectHolding {
  openStackProjectId: string;
  flavors: Array<OpenStackFlavorHolding>;
  volumeGbByType: Record<string, number>;
  floatingIps: number;
  imageGb: number;
  snapshotGb: number;
}

// What the inventory's grouped reads answer: see OpenStackResourceService.getUsageRows.
export interface OpenStackUsageInstanceGroup {
  openStackProjectId: string | null;
  regionName: string | null;
  flavorId: string | null;
  status: string | null;
  count: number;
}

export interface OpenStackUsageFlavorRow {
  regionName: string | null;
  // The flavor's own id, without its region.
  flavorId: string;
  name: string | null;
  vcpus: number | null;
  memoryBytes: number | null;
}

export interface OpenStackUsageStorageGroup {
  openStackProjectId: string | null;
  // A volume's type. Nothing for what has none.
  type?: string | null | undefined;
  bytes: number;
}

export interface OpenStackUsageCountGroup {
  openStackProjectId: string | null;
  count: number;
}

export interface OpenStackUsageRows {
  instances: ReadonlyArray<OpenStackUsageInstanceGroup>;
  flavors: ReadonlyArray<OpenStackUsageFlavorRow>;
  volumes: ReadonlyArray<OpenStackUsageStorageGroup>;
  floatingIps: ReadonlyArray<OpenStackUsageCountGroup>;
  images: ReadonlyArray<OpenStackUsageStorageGroup>;
  snapshots: ReadonlyArray<OpenStackUsageStorageGroup>;
}

export function getOpenStackFlavorUsageKey(data: {
  regionName: string | null;
  flavorId: string | null;
}): string {
  return `${data.regionName || ""}/${data.flavorId || ""}`;
}

// A flavor's row in the inventory holds the flavor's id after its region: see `regional` in the scan.
export function readOpenStackUsageFlavorId(data: {
  externalId: string;
  regionName: string | null;
}): string {
  const prefix: string = data.regionName ? `${data.regionName}/` : "";
  return prefix && data.externalId.startsWith(prefix)
    ? data.externalId.substring(prefix.length)
    : data.externalId;
}

export function getEmptyOpenStackUsageQuantities(): OpenStackUsageQuantities {
  return {
    flavors: {},
    volumeGbHoursByType: {},
    floatingIpHours: 0,
    imageGbHours: 0,
    snapshotGbHours: 0,
  };
}

function toFiniteNumber(value: unknown): number {
  const number: number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/*
 * Six decimals of an hour is under four thousandths of a second, so a reading's rounding can't add
 * up to anything anyone reads, and a year's rows don't carry seventeen digits of float noise each.
 */
export function roundOpenStackUsage(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

// What a stored row says, whatever it says: a damaged row is no usage, not a page that won't draw.
export function readOpenStackUsageQuantities(
  value: unknown,
): OpenStackUsageQuantities {
  const quantities: OpenStackUsageQuantities =
    getEmptyOpenStackUsageQuantities();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return quantities;
  }

  const record: JSONObject = value as JSONObject;
  const flavors: unknown = record["flavors"];

  if (flavors && typeof flavors === "object" && !Array.isArray(flavors)) {
    for (const key of Object.keys(flavors)) {
      const flavor: Record<string, unknown> | undefined = (
        flavors as Record<string, Record<string, unknown>>
      )[key];

      if (!flavor || typeof flavor !== "object") {
        continue;
      }

      quantities.flavors[key] = {
        regionName:
          typeof flavor["regionName"] === "string"
            ? flavor["regionName"]
            : null,
        flavorId:
          typeof flavor["flavorId"] === "string" ? flavor["flavorId"] : null,
        name: typeof flavor["name"] === "string" ? flavor["name"] : null,
        vcpus: toNumberOrNull(flavor["vcpus"]),
        ramMib: toNumberOrNull(flavor["ramMib"]),
        runningHours: toFiniteNumber(flavor["runningHours"]),
        shutOffHours: toFiniteNumber(flavor["shutOffHours"]),
      };
    }
  }

  const types: unknown = record["volumeGbHoursByType"];

  if (types && typeof types === "object" && !Array.isArray(types)) {
    for (const type of Object.keys(types)) {
      quantities.volumeGbHoursByType[type] = toFiniteNumber(
        (types as Record<string, unknown>)[type],
      );
    }
  }

  quantities.floatingIpHours = toFiniteNumber(record["floatingIpHours"]);
  quantities.imageGbHours = toFiniteNumber(record["imageGbHours"]);
  quantities.snapshotGbHours = toFiniteNumber(record["snapshotGbHours"]);

  return quantities;
}

/*
 * What each project holds now, from the inventory's grouped reads. A row that names no project is
 * no project's, so it's left out, and an instance not placed on any host never reached this read.
 */
export function getOpenStackProjectHoldings(
  rows: OpenStackUsageRows,
): Array<OpenStackProjectHolding> {
  const flavors: Map<string, OpenStackUsageFlavorRow> = new Map();

  for (const flavor of rows.flavors) {
    flavors.set(
      getOpenStackFlavorUsageKey({
        regionName: flavor.regionName,
        flavorId: flavor.flavorId,
      }),
      flavor,
    );
  }

  const holdings: Map<string, OpenStackProjectHolding> = new Map();

  const holdingOf: (id: string) => OpenStackProjectHolding = (
    id: string,
  ): OpenStackProjectHolding => {
    let holding: OpenStackProjectHolding | undefined = holdings.get(id);
    if (!holding) {
      holding = {
        openStackProjectId: id,
        flavors: [],
        volumeGbByType: {},
        floatingIps: 0,
        imageGb: 0,
        snapshotGb: 0,
      };
      holdings.set(id, holding);
    }
    return holding;
  };

  for (const group of rows.instances) {
    if (!group.openStackProjectId || group.count <= 0) {
      continue;
    }

    const holding: OpenStackProjectHolding = holdingOf(
      group.openStackProjectId,
    );
    const flavor: OpenStackUsageFlavorRow | undefined = flavors.get(
      getOpenStackFlavorUsageKey({
        regionName: group.regionName,
        flavorId: group.flavorId,
      }),
    );
    let line: OpenStackFlavorHolding | undefined = holding.flavors.find(
      (entry: OpenStackFlavorHolding): boolean => {
        return (
          entry.regionName === group.regionName &&
          entry.flavorId === group.flavorId
        );
      },
    );

    if (!line) {
      line = {
        regionName: group.regionName,
        flavorId: group.flavorId,
        name: flavor?.name ?? null,
        vcpus: flavor?.vcpus ?? null,
        ramMib:
          flavor && flavor.memoryBytes !== null
            ? flavor.memoryBytes / BYTES_IN_A_MIB
            : null,
        running: 0,
        shutOff: 0,
      };
      holding.flavors.push(line);
    }

    if (group.status === OPENSTACK_INSTANCE_STATUS_SHUT_OFF) {
      line.shutOff += group.count;
    } else {
      line.running += group.count;
    }
  }

  for (const group of rows.volumes) {
    if (group.openStackProjectId && group.bytes > 0) {
      const holding: OpenStackProjectHolding = holdingOf(
        group.openStackProjectId,
      );
      const type: string = group.type || "";
      holding.volumeGbByType[type] =
        (holding.volumeGbByType[type] || 0) + group.bytes / BYTES_IN_A_GB;
    }
  }

  for (const group of rows.floatingIps) {
    if (group.openStackProjectId && group.count > 0) {
      holdingOf(group.openStackProjectId).floatingIps += group.count;
    }
  }

  for (const group of rows.images) {
    if (group.openStackProjectId && group.bytes > 0) {
      holdingOf(group.openStackProjectId).imageGb +=
        group.bytes / BYTES_IN_A_GB;
    }
  }

  for (const group of rows.snapshots) {
    if (group.openStackProjectId && group.bytes > 0) {
      holdingOf(group.openStackProjectId).snapshotGb +=
        group.bytes / BYTES_IN_A_GB;
    }
  }

  return Array.from(holdings.values());
}

// A project's quantities with these hours of what it holds added. The quantities are left as they were.
export function addOpenStackUsage(data: {
  quantities: OpenStackUsageQuantities;
  holding: OpenStackProjectHolding;
  hours: number;
}): OpenStackUsageQuantities {
  const { holding, hours } = data;
  const next: OpenStackUsageQuantities = {
    flavors: { ...data.quantities.flavors },
    volumeGbHoursByType: { ...data.quantities.volumeGbHoursByType },
    floatingIpHours: roundOpenStackUsage(
      data.quantities.floatingIpHours + holding.floatingIps * hours,
    ),
    imageGbHours: roundOpenStackUsage(
      data.quantities.imageGbHours + holding.imageGb * hours,
    ),
    snapshotGbHours: roundOpenStackUsage(
      data.quantities.snapshotGbHours + holding.snapshotGb * hours,
    ),
  };

  for (const flavor of holding.flavors) {
    const key: string = getOpenStackFlavorUsageKey(flavor);
    const known: OpenStackFlavorUsage | undefined = next.flavors[key];

    next.flavors[key] = {
      regionName: flavor.regionName,
      flavorId: flavor.flavorId,
      // A flavor that has since been deleted keeps what it was last known to give.
      name: flavor.name ?? known?.name ?? null,
      vcpus: flavor.vcpus ?? known?.vcpus ?? null,
      ramMib: flavor.ramMib ?? known?.ramMib ?? null,
      runningHours: roundOpenStackUsage(
        (known?.runningHours || 0) + flavor.running * hours,
      ),
      shutOffHours: roundOpenStackUsage(
        (known?.shutOffHours || 0) + flavor.shutOff * hours,
      ),
    };
  }

  for (const type of Object.keys(holding.volumeGbByType)) {
    next.volumeGbHoursByType[type] = roundOpenStackUsage(
      (next.volumeGbHoursByType[type] || 0) +
        (holding.volumeGbByType[type] || 0) * hours,
    );
  }

  return next;
}

// Quantities as one, as a whole cloud's add up from its projects'.
export function sumOpenStackUsageQuantities(
  all: Iterable<OpenStackUsageQuantities>,
): OpenStackUsageQuantities {
  const sum: OpenStackUsageQuantities = getEmptyOpenStackUsageQuantities();

  for (const quantities of all) {
    for (const key of Object.keys(quantities.flavors)) {
      const flavor: OpenStackFlavorUsage = quantities.flavors[key]!;
      const known: OpenStackFlavorUsage | undefined = sum.flavors[key];
      sum.flavors[key] = {
        regionName: flavor.regionName,
        flavorId: flavor.flavorId,
        name: known?.name ?? flavor.name,
        vcpus: known?.vcpus ?? flavor.vcpus,
        ramMib: known?.ramMib ?? flavor.ramMib,
        runningHours: roundOpenStackUsage(
          (known?.runningHours || 0) + flavor.runningHours,
        ),
        shutOffHours: roundOpenStackUsage(
          (known?.shutOffHours || 0) + flavor.shutOffHours,
        ),
      };
    }

    for (const type of Object.keys(quantities.volumeGbHoursByType)) {
      sum.volumeGbHoursByType[type] = roundOpenStackUsage(
        (sum.volumeGbHoursByType[type] || 0) +
          (quantities.volumeGbHoursByType[type] || 0),
      );
    }

    sum.floatingIpHours = roundOpenStackUsage(
      sum.floatingIpHours + quantities.floatingIpHours,
    );
    sum.imageGbHours = roundOpenStackUsage(
      sum.imageGbHours + quantities.imageGbHours,
    );
    sum.snapshotGbHours = roundOpenStackUsage(
      sum.snapshotGbHours + quantities.snapshotGbHours,
    );
  }

  return sum;
}

export function getOpenStackUsageTotals(
  quantities: OpenStackUsageQuantities,
): OpenStackUsageTotals {
  let instanceHours: number = 0;
  let shutOffInstanceHours: number = 0;
  let unknownFlavorHours: number = 0;
  let vcpuHours: number = 0;
  let memoryGbHours: number = 0;
  let volumeGbHours: number = 0;

  for (const flavor of Object.values(quantities.flavors)) {
    const hours: number = flavor.runningHours + flavor.shutOffHours;

    instanceHours += hours;
    shutOffInstanceHours += flavor.shutOffHours;

    if (flavor.vcpus === null || flavor.ramMib === null) {
      unknownFlavorHours += hours;
    }

    vcpuHours += hours * (flavor.vcpus || 0);
    memoryGbHours += hours * ((flavor.ramMib || 0) / MIB_IN_A_GB);
  }

  for (const hours of Object.values(quantities.volumeGbHoursByType)) {
    volumeGbHours += hours;
  }

  return {
    instanceHours: roundOpenStackUsage(instanceHours),
    shutOffInstanceHours: roundOpenStackUsage(shutOffInstanceHours),
    unknownFlavorHours: roundOpenStackUsage(unknownFlavorHours),
    vcpuHours: roundOpenStackUsage(vcpuHours),
    memoryGbHours: roundOpenStackUsage(memoryGbHours),
    volumeGbHours: roundOpenStackUsage(volumeGbHours),
    floatingIpHours: roundOpenStackUsage(quantities.floatingIpHours),
    imageGbHours: roundOpenStackUsage(quantities.imageGbHours),
    snapshotGbHours: roundOpenStackUsage(quantities.snapshotGbHours),
  };
}

export function hasOpenStackUsage(
  quantities: OpenStackUsageQuantities,
): boolean {
  const totals: OpenStackUsageTotals = getOpenStackUsageTotals(quantities);

  return (
    totals.instanceHours > 0 ||
    totals.volumeGbHours > 0 ||
    totals.floatingIpHours > 0 ||
    totals.imageGbHours > 0 ||
    totals.snapshotGbHours > 0
  );
}

/*
 * One stretch of counted time, all inside one day. `endsDay` says this stretch runs to midnight, so
 * the day it's in is finished and its figures can be kept.
 */
export interface OpenStackUsageSlice {
  // "2026-11".
  month: string;
  // "2026-11-05".
  day: string;
  hours: number;
  endsDay: boolean;
}

export interface OpenStackUsageInterval {
  slices: Array<OpenStackUsageSlice>;
  // Hours since the last reading that weren't counted, because nobody was reading.
  notCountedHours: number;
  /*
   * The day of the last reading, when this reading is in a later one and nothing counted runs to
   * that day's midnight: a long gap can do that, and that day's figures are as finished as they'll get.
   */
  closesDay: string | null;
}

export function toOpenStackUsageDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toOpenStackUsageMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/*
 * What time a reading counts for: since the last reading, split at each midnight in UTC so a day's
 * and a month's figures hold that day's and that month's hours exactly. A first reading has no time
 * behind it to count, a clock that went back counts nothing, and a gap counts only its last hour.
 */
export function getOpenStackUsageInterval(data: {
  lastReadAt: Date | null;
  now: Date;
}): OpenStackUsageInterval {
  const { lastReadAt, now } = data;

  if (!lastReadAt || now.getTime() <= lastReadAt.getTime()) {
    return { slices: [], notCountedHours: 0, closesDay: null };
  }

  const longest: number = OPENSTACK_USAGE_LONGEST_INTERVAL_MINUTES * 60 * 1000;
  const elapsed: number = now.getTime() - lastReadAt.getTime();
  const from: Date =
    elapsed > longest ? new Date(now.getTime() - longest) : lastReadAt;
  const slices: Array<OpenStackUsageSlice> = [];
  let start: Date = from;

  while (start.getTime() < now.getTime()) {
    const midnight: Date = addUtcDays(startOfUtcDay(start), 1);
    const end: Date = midnight.getTime() <= now.getTime() ? midnight : now;

    slices.push({
      month: toOpenStackUsageMonth(start),
      day: toOpenStackUsageDay(start),
      hours: (end.getTime() - start.getTime()) / MS_IN_AN_HOUR,
      endsDay: end.getTime() === midnight.getTime(),
    });
    start = end;
  }

  const lastReadDay: string = toOpenStackUsageDay(lastReadAt);
  const isClosedByASlice: boolean = slices.some(
    (slice: OpenStackUsageSlice): boolean => {
      return slice.endsDay && slice.day === lastReadDay;
    },
  );

  return {
    slices,
    notCountedHours:
      (elapsed - (now.getTime() - from.getTime())) / MS_IN_AN_HOUR,
    closesDay:
      lastReadDay !== toOpenStackUsageDay(now) && !isClosedByASlice
        ? lastReadDay
        : null,
  };
}

export interface OpenStackAppliedReading {
  months: Map<string, Map<string, OpenStackUsageQuantities>>;
  // Each finished day's rows, as each project's month stood at the end of it.
  closedDays: Map<string, Map<string, OpenStackUsageQuantities>>;
  countedHoursByMonth: Map<string, number>;
}

/*
 * What a reading adds. Each stretch of time adds what's held now to the month it falls in, and a
 * stretch that runs to midnight finishes its day: the day's rows hold every project's month as it
 * stood at that moment. A long gap ends a day with nothing counted up to its midnight, so that day
 * is finished as it stood before anything new was added.
 */
export function applyOpenStackUsageReading(data: {
  months: ReadonlyMap<string, ReadonlyMap<string, OpenStackUsageQuantities>>;
  holdings: ReadonlyArray<OpenStackProjectHolding>;
  interval: OpenStackUsageInterval;
}): OpenStackAppliedReading {
  const months: Map<string, Map<string, OpenStackUsageQuantities>> = new Map();

  for (const [month, rows] of data.months) {
    months.set(month, new Map(rows));
  }

  const closedDays: Map<string, Map<string, OpenStackUsageQuantities>> =
    new Map();
  const countedHoursByMonth: Map<string, number> = new Map();

  if (data.interval.closesDay) {
    const month: string = data.interval.closesDay.slice(0, 7);
    closedDays.set(
      data.interval.closesDay,
      new Map(months.get(month) || new Map()),
    );
  }

  for (const slice of data.interval.slices) {
    let rows: Map<string, OpenStackUsageQuantities> | undefined = months.get(
      slice.month,
    );

    if (!rows) {
      rows = new Map();
      months.set(slice.month, rows);
    }

    for (const holding of data.holdings) {
      rows.set(
        holding.openStackProjectId,
        addOpenStackUsage({
          quantities:
            rows.get(holding.openStackProjectId) ||
            getEmptyOpenStackUsageQuantities(),
          holding,
          hours: slice.hours,
        }),
      );
    }

    countedHoursByMonth.set(
      slice.month,
      (countedHoursByMonth.get(slice.month) || 0) + slice.hours,
    );

    if (slice.endsDay) {
      closedDays.set(slice.day, new Map(rows));
    }
  }

  return { months, closedDays, countedHoursByMonth };
}

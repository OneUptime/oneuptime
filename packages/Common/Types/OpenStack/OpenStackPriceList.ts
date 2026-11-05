import { translationKey } from "../Translator";
import {
  OpenStackFlavorUsage,
  OpenStackUsageQuantities,
  roundOpenStackUsage,
} from "./OpenStackProjectUsage";

/*
 * WHAT A CLOUD'S OPERATOR SAYS THINGS COST.
 *
 * Optional, one currency, per hour, and every number is the operator's own. Usage works without any
 * of it. A price of zero means no price has been set, never that something is free, so what has no
 * price is said to have none, and a total of what is priced is never passed off as the whole cloud.
 * These are estimates to think with. Nothing here is an amount anyone is asked for.
 *
 * Today's price list applies to the whole of every period read, last month's too, so a price
 * changed today doesn't read as a project's usage moving.
 */

export const OPENSTACK_PRICE_LIST_DEFAULT_CURRENCY: string = "USD";

export interface OpenStackPriceList {
  currency: string;
  vcpuHour: number;
  memoryGbHour: number;
  volumeGbHour: number;
  floatingIpHour: number;
  imageGbHour: number;
  snapshotGbHour: number;
  // Per instance-hour, by the flavor's name, because its id is different in each region.
  flavorHour: Record<string, number>;
  // Per GB-hour, by the volume type's name. A type with none of its own costs volumeGbHour.
  volumeTypeGbHour: Record<string, number>;
  // Shut-off instances hold what they were given, so they count unless the operator says otherwise.
  leaveOutShutOff: boolean;
}

export enum OpenStackCostLineKind {
  Flavor = "flavor",
  Vcpu = "vcpu",
  Memory = "memory",
  Volume = "volume",
  FloatingIp = "floatingIp",
  Image = "image",
  Snapshot = "snapshot",
}

export const OPENSTACK_COST_LINE_TITLES: Readonly<
  Record<OpenStackCostLineKind, string>
> = {
  [OpenStackCostLineKind.Flavor]: translationKey("Flavor"),
  [OpenStackCostLineKind.Vcpu]: translationKey("vCPUs"),
  [OpenStackCostLineKind.Memory]: translationKey("Memory"),
  [OpenStackCostLineKind.Volume]: translationKey("Volumes"),
  [OpenStackCostLineKind.FloatingIp]: translationKey("Floating IPs"),
  [OpenStackCostLineKind.Image]: translationKey("Images"),
  [OpenStackCostLineKind.Snapshot]: translationKey("Snapshots"),
};

export const OPENSTACK_COST_LINE_UNITS: Readonly<
  Record<OpenStackCostLineKind, string>
> = {
  [OpenStackCostLineKind.Flavor]: "instance-hours",
  [OpenStackCostLineKind.Vcpu]: "vCPU-hours",
  [OpenStackCostLineKind.Memory]: "GB-hours",
  [OpenStackCostLineKind.Volume]: "GB-hours",
  [OpenStackCostLineKind.FloatingIp]: "IP-hours",
  [OpenStackCostLineKind.Image]: "GB-hours",
  [OpenStackCostLineKind.Snapshot]: "GB-hours",
};

// One thing a project used, and what it comes to at the price set for it, if one is.
export interface OpenStackCostLine {
  kind: OpenStackCostLineKind;
  // A flavor's or a volume type's name, when the line is of one.
  name: string | null;
  regionName: string | null;
  quantity: number;
  unitPrice: number | null;
  amount: number | null;
}

export interface OpenStackUsageCost {
  /*
   * What the priced lines come to. Null when nothing used has a price, which says "no price" and
   * never "free". Nothing used at all under a price list comes to nothing, which is the truth.
   */
  amount: number | null;
  lines: Array<OpenStackCostLine>;
  // Lines something was used on that have no price, so the amount isn't all of it.
  unpricedLineCount: number;
}

function readPrice(value: unknown): number {
  const price: number = Number(value);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

function readPrices(value: unknown): Record<string, number> {
  const prices: Record<string, number> = {};

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const name of Object.keys(value)) {
      const price: number = readPrice((value as Record<string, unknown>)[name]);
      if (name && price > 0) {
        prices[name] = price;
      }
    }
  }

  return prices;
}

export function isOpenStackCurrency(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim());
}

/*
 * What a stored price list says, or null when it sets no price at all, because a list of zeros is
 * no price list. Prices below zero are no price, and a currency that isn't one reads as the default.
 */
export function readOpenStackPriceList(
  value: unknown,
): OpenStackPriceList | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const list: OpenStackPriceList = {
    currency: isOpenStackCurrency(record["currency"])
      ? (record["currency"] as string).trim().toUpperCase()
      : OPENSTACK_PRICE_LIST_DEFAULT_CURRENCY,
    vcpuHour: readPrice(record["vcpuHour"]),
    memoryGbHour: readPrice(record["memoryGbHour"]),
    volumeGbHour: readPrice(record["volumeGbHour"]),
    floatingIpHour: readPrice(record["floatingIpHour"]),
    imageGbHour: readPrice(record["imageGbHour"]),
    snapshotGbHour: readPrice(record["snapshotGbHour"]),
    flavorHour: readPrices(record["flavorHour"]),
    volumeTypeGbHour: readPrices(record["volumeTypeGbHour"]),
    leaveOutShutOff: record["leaveOutShutOff"] === true,
  };

  const hasAnyPrice: boolean =
    list.vcpuHour > 0 ||
    list.memoryGbHour > 0 ||
    list.volumeGbHour > 0 ||
    list.floatingIpHour > 0 ||
    list.imageGbHour > 0 ||
    list.snapshotGbHour > 0 ||
    Object.keys(list.flavorHour).length > 0 ||
    Object.keys(list.volumeTypeGbHour).length > 0;

  return hasAnyPrice ? list : null;
}

function priced(data: {
  kind: OpenStackCostLineKind;
  name?: string | null | undefined;
  regionName?: string | null | undefined;
  quantity: number;
  price: number;
}): OpenStackCostLine {
  return {
    kind: data.kind,
    name: data.name ?? null,
    regionName: data.regionName ?? null,
    quantity: roundOpenStackUsage(data.quantity),
    unitPrice: data.price > 0 ? data.price : null,
    amount: data.price > 0 ? data.quantity * data.price : null,
  };
}

function getFlavorLines(data: {
  flavor: OpenStackFlavorUsage;
  list: OpenStackPriceList | null;
}): Array<OpenStackCostLine> {
  const { flavor, list } = data;
  const hours: number =
    flavor.runningHours + (list?.leaveOutShutOff ? 0 : flavor.shutOffHours);

  if (hours <= 0) {
    return [];
  }

  const flavorPrice: number = flavor.name
    ? list?.flavorHour[flavor.name] || 0
    : 0;

  // A flavor's own price is the whole of it. Its vCPUs and memory aren't priced on top.
  if (flavorPrice > 0) {
    return [
      priced({
        kind: OpenStackCostLineKind.Flavor,
        name: flavor.name,
        regionName: flavor.regionName,
        quantity: hours,
        price: flavorPrice,
      }),
    ];
  }

  // A flavor the cloud no longer lists can't be split into vCPUs and memory, so all it has is hours.
  if (flavor.vcpus === null || flavor.ramMib === null) {
    return [
      priced({
        kind: OpenStackCostLineKind.Flavor,
        name: flavor.name,
        regionName: flavor.regionName,
        quantity: hours,
        price: 0,
      }),
    ];
  }

  return [
    priced({
      kind: OpenStackCostLineKind.Vcpu,
      name: flavor.name,
      regionName: flavor.regionName,
      quantity: hours * flavor.vcpus,
      price: list?.vcpuHour || 0,
    }),
    priced({
      kind: OpenStackCostLineKind.Memory,
      name: flavor.name,
      regionName: flavor.regionName,
      quantity: hours * (flavor.ramMib / 1024),
      price: list?.memoryGbHour || 0,
    }),
  ];
}

/*
 * What usage comes to at a price list, line by line. With no list, the lines are still there, each
 * with no price, because they're what a CSV of usage is made of.
 */
export function getOpenStackUsageCost(data: {
  quantities: OpenStackUsageQuantities;
  priceList: OpenStackPriceList | null;
}): OpenStackUsageCost {
  const { quantities, priceList } = data;
  const lines: Array<OpenStackCostLine> = [];

  for (const flavor of Object.values(quantities.flavors)) {
    lines.push(...getFlavorLines({ flavor, list: priceList }));
  }

  for (const type of Object.keys(quantities.volumeGbHoursByType)) {
    lines.push(
      priced({
        kind: OpenStackCostLineKind.Volume,
        name: type,
        quantity: quantities.volumeGbHoursByType[type] || 0,
        price:
          priceList?.volumeTypeGbHour[type] || priceList?.volumeGbHour || 0,
      }),
    );
  }

  lines.push(
    priced({
      kind: OpenStackCostLineKind.FloatingIp,
      quantity: quantities.floatingIpHours,
      price: priceList?.floatingIpHour || 0,
    }),
    priced({
      kind: OpenStackCostLineKind.Image,
      quantity: quantities.imageGbHours,
      price: priceList?.imageGbHour || 0,
    }),
    priced({
      kind: OpenStackCostLineKind.Snapshot,
      quantity: quantities.snapshotGbHours,
      price: priceList?.snapshotGbHour || 0,
    }),
  );

  const used: Array<OpenStackCostLine> = lines.filter(
    (line: OpenStackCostLine): boolean => {
      return line.quantity > 0;
    },
  );
  const withAPrice: Array<OpenStackCostLine> = used.filter(
    (line: OpenStackCostLine): boolean => {
      return line.amount !== null;
    },
  );
  const sum: number = withAPrice.reduce(
    (total: number, line: OpenStackCostLine): number => {
      return total + (line.amount || 0);
    },
    0,
  );

  return {
    amount:
      !priceList || (used.length > 0 && withAPrice.length === 0)
        ? null
        : Math.round(sum * 10000) / 10000,
    lines: used,
    unpricedLineCount: used.length - withAPrice.length,
  };
}

/*
 * The words a budget or a total says money in. Left to the caller to round, because what a table
 * shows and what a sum adds up from differ.
 */
export function getOpenStackUnpricedSummary(cost: OpenStackUsageCost): {
  isPartial: boolean;
  isUnpriced: boolean;
} {
  return {
    isPartial: cost.amount !== null && cost.unpricedLineCount > 0,
    isUnpriced: cost.amount === null,
  };
}

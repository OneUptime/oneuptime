import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_RESOURCE_DISK_GB,
  OPENSTACK_RESOURCE_MEMORY_MB,
  OPENSTACK_RESOURCE_PCPU,
  OPENSTACK_RESOURCE_VCPU,
  OpenStackCapacityResource,
  OpenStackCapacityRollup,
} from "Common/Types/OpenStack/OpenStackCapacity";
import {
  OPENSTACK_CAPACITY_RESOURCE_IPV4,
  OPENSTACK_CAPACITY_RESOURCE_STORAGE_BYTES,
  OpenStackBareMetalCapacityRow,
  OpenStackCapacityFlavorRow,
  OpenStackCapacityForecastRow,
  OpenStackCapacityPool,
  OpenStackCapacitySnapshot,
  OpenStackCapacityZone,
} from "Common/Types/OpenStack/OpenStackCapacitySnapshot";
import { OpenStackForecast } from "Common/Types/OpenStack/OpenStackForecast";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";
import { getReaderNumberLocale } from "Common/Types/DateLanguage";
import { formatOpenStackBytes } from "./OpenStackFigures";

/*
 * WHAT THE CAPACITY PAGE SAYS OF A SNAPSHOT.
 *
 * One read of one row, however large the cloud: everything here narrows what that row holds, and
 * nothing asks for anything more. React-free, so tests can read it.
 */

export const OPENSTACK_CAPACITY_RESOURCE_TITLES: Readonly<
  Record<string, string>
> = {
  [OPENSTACK_RESOURCE_VCPU]: translationKey("vCPUs"),
  [OPENSTACK_RESOURCE_PCPU]: translationKey("Pinned CPUs"),
  [OPENSTACK_RESOURCE_MEMORY_MB]: translationKey("Memory"),
  [OPENSTACK_RESOURCE_DISK_GB]: translationKey("Local disk"),
  [OPENSTACK_CAPACITY_RESOURCE_IPV4]: translationKey("IPv4 addresses"),
  [OPENSTACK_CAPACITY_RESOURCE_STORAGE_BYTES]: translationKey("Storage"),
};

// A class Placement knows and this page doesn't, such as a bare metal node's, reads as its name.
export function getOpenStackCapacityResourceTitle(
  resourceClass: string,
): string {
  return OPENSTACK_CAPACITY_RESOURCE_TITLES[resourceClass] || resourceClass;
}

/*
 * An amount of a class, in what a person calls it, in the reader's digits ("۶٫۰ TiB", issue
 * #7191). Placement counts memory in MB and disk in GB.
 */
export function formatOpenStackCapacityAmount(
  resourceClass: string,
  amount: number,
): string {
  switch (resourceClass) {
    case OPENSTACK_RESOURCE_MEMORY_MB:
      return formatOpenStackBytes(amount * 1024 * 1024);
    case OPENSTACK_RESOURCE_DISK_GB:
      return formatOpenStackBytes(amount * 1024 * 1024 * 1024);
    case OPENSTACK_CAPACITY_RESOURCE_STORAGE_BYTES:
      return formatOpenStackBytes(amount);
    default:
      return Math.round(amount).toLocaleString(getReaderNumberLocale());
  }
}

export function formatOpenStackRatio(ratio: number | null): string {
  if (ratio === null) {
    return "";
  }
  return `${Number.isInteger(ratio) ? ratio : ratio.toFixed(1)}:1`;
}

// The ratio a set of hosts run at: one number when they agree, and the range when they don't.
export function formatOpenStackRatioRange(
  resource: Pick<OpenStackCapacityResource, "lowestRatio" | "highestRatio">,
): string {
  if (resource.lowestRatio === null || resource.highestRatio === null) {
    return "";
  }
  return resource.lowestRatio === resource.highestRatio
    ? formatOpenStackRatio(resource.lowestRatio)
    : `${formatOpenStackRatio(resource.lowestRatio)} to ${formatOpenStackRatio(resource.highestRatio)}`;
}

/*
 * The one read of the page. Null when no worker has been through yet, which is a cloud too new to
 * have an answer rather than one with no capacity.
 */
export async function fetchOpenStackCapacitySnapshot(
  openStackCloudId: ObjectID,
): Promise<OpenStackCapacitySnapshot | null> {
  const cloud: OpenStackCloud | null = await ModelAPI.getItem<OpenStackCloud>({
    modelType: OpenStackCloud,
    id: openStackCloudId,
    select: { capacitySnapshot: true },
  });

  return (
    (cloud?.capacitySnapshot as unknown as
      | OpenStackCapacitySnapshot
      | undefined) || null
  );
}

function isInRegion(
  row: { regionName: string | null },
  region: string | null,
): boolean {
  return !region || row.regionName === region;
}

export interface OpenStackCapacityView {
  overall: OpenStackCapacityRollup | null;
  zones: Array<OpenStackCapacityZone>;
  aggregates: Array<OpenStackCapacityRollup>;
  flavors: Array<OpenStackCapacityFlavorRow>;
  pools: Array<OpenStackCapacityPool>;
  forecasts: Array<OpenStackCapacityForecastRow>;
  bareMetalClasses: Array<OpenStackBareMetalCapacityRow>;
}

// What a snapshot says of the region being read, or of the whole cloud.
export function getOpenStackCapacityView(data: {
  snapshot: OpenStackCapacitySnapshot;
  region: string | null;
}): OpenStackCapacityView {
  const { snapshot, region } = data;

  return {
    overall: region
      ? snapshot.regions.find((row: OpenStackCapacityRollup): boolean => {
          return row.regionName === region;
        }) || null
      : snapshot.cloud,
    zones: snapshot.zones.filter((row: OpenStackCapacityZone): boolean => {
      return isInRegion(row, region);
    }),
    aggregates: snapshot.aggregates.filter(
      (row: OpenStackCapacityRollup): boolean => {
        return isInRegion(row, region);
      },
    ),
    flavors: snapshot.flavors.filter(
      (row: OpenStackCapacityFlavorRow): boolean => {
        return isInRegion(row, region);
      },
    ),
    bareMetalClasses: (snapshot.bareMetalClasses || []).filter(
      (row: OpenStackBareMetalCapacityRow): boolean => {
        return isInRegion(row, region);
      },
    ),
    pools: snapshot.pools.filter((row: OpenStackCapacityPool): boolean => {
      return isInRegion(row, region);
    }),
    forecasts: sortOpenStackCapacityForecasts(
      snapshot.forecasts.filter(
        (row: OpenStackCapacityForecastRow): boolean => {
          return isInRegion(row, region);
        },
      ),
    ),
  };
}

// Soonest first, and what can't be told last: nothing on it is sooner than what can.
const FORECAST_STATE_ORDER: Readonly<
  Record<OpenStackForecast["state"], number>
> = {
  full: 0,
  days: 1,
  "not-growing": 2,
  "not-enough-history": 3,
};

export function sortOpenStackCapacityForecasts(
  rows: ReadonlyArray<OpenStackCapacityForecastRow>,
): Array<OpenStackCapacityForecastRow> {
  return [...rows].sort(
    (
      first: OpenStackCapacityForecastRow,
      second: OpenStackCapacityForecastRow,
    ): number => {
      const days: (row: OpenStackCapacityForecastRow) => number = (
        row: OpenStackCapacityForecastRow,
      ): number => {
        return row.forecast.state === "days" ? row.forecast.days : 0;
      };

      return (
        FORECAST_STATE_ORDER[first.forecast.state] -
          FORECAST_STATE_ORDER[second.forecast.state] ||
        days(first) - days(second) ||
        first.name.localeCompare(second.name, undefined, { numeric: true }) ||
        first.resourceClass.localeCompare(second.resourceClass)
      );
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * CSV
 * ---------------------------------------------------------------------------
 */
function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  /*
   * A flavor's or a zone's name is whatever someone typed, and a CSV goes to a spreadsheet, which
   * runs what starts with "=". A number is left alone, because a "-" can be one.
   */
  return typeof value === "string"
    ? TableColumnsToCsv.escapeCsvValue(
        TableColumnsToCsv.sanitizeForCsvInjection(value),
      )
    : String(value);
}

function csvRow(
  cells: ReadonlyArray<string | number | boolean | null>,
): string {
  return cells.map(csvCell).join(",");
}

function forecastCell(forecast: OpenStackForecast): string {
  switch (forecast.state) {
    case "full":
      return "Full now";
    case "days":
      return `${Math.max(1, Math.round(forecast.days))} days`;
    case "not-growing":
      return "Not growing";
    default:
      return "Not enough history";
  }
}

/*
 * One file, with each table under a line that says what it is, in Placement's own units so a
 * spreadsheet can add them up. Everything says allocated, as the page does: it is what has been
 * promised, and none of it is load.
 */
export function getOpenStackCapacityCsv(data: {
  snapshot: OpenStackCapacitySnapshot;
  region: string | null;
}): string {
  const view: OpenStackCapacityView = getOpenStackCapacityView(data);
  const lines: Array<string> = [];

  lines.push(`Generated at,${csvCell(data.snapshot.generatedAt)}`);
  lines.push("");
  lines.push("Flavors");
  lines.push(
    csvRow([
      "Region",
      "Flavor",
      "Asks for",
      "Room for",
      "At least",
      "Hosts with room",
      "If it were one pool",
      "Too large for every host",
      "Instances running",
      "Counted from",
      "Asked Placement at",
    ]),
  );
  for (const flavor of view.flavors) {
    lines.push(
      csvRow([
        flavor.regionName,
        flavor.name,
        Object.keys(flavor.resources)
          .sort()
          .map((resourceClass: string): string => {
            return `${resourceClass}:${flavor.resources[resourceClass]}`;
          })
          .join(" "),
        flavor.fits,
        flavor.isAtLeast,
        flavor.hostsWithRoom,
        flavor.fitsIfOnePool,
        flavor.isTooLargeForEveryHost,
        flavor.instanceCount,
        flavor.source,
        flavor.askedAt,
      ]),
    );
  }
  lines.push("");
  lines.push("Flavors by zone and aggregate");
  lines.push(csvRow(["Region", "Flavor", "Group", "Room for"]));
  for (const flavor of view.flavors) {
    for (const zone of Object.keys(flavor.byZone).sort()) {
      lines.push(
        csvRow([flavor.regionName, flavor.name, zone, flavor.byZone[zone]!]),
      );
    }
    for (const aggregate of Object.keys(flavor.byAggregate).sort()) {
      lines.push(
        csvRow([
          flavor.regionName,
          flavor.name,
          aggregate,
          flavor.byAggregate[aggregate]!,
        ]),
      );
    }
  }
  lines.push("");
  lines.push("Allocated, by zone and aggregate");
  lines.push(
    csvRow([
      "Region",
      "Kind",
      "Name",
      "Hosts",
      "Lost hosts",
      "Disabled hosts",
      "Resource class",
      "Allocated",
      "Capacity",
      "Allocated percent",
      "Allocated on hosts not counted",
      "Lowest ratio",
      "Highest ratio",
    ]),
  );
  for (const rollup of [...view.zones, ...view.aggregates]) {
    for (const resource of rollup.resources) {
      lines.push(
        csvRow([
          rollup.regionName,
          rollup.scope,
          rollup.name,
          rollup.hostCount,
          rollup.lostHostCount,
          rollup.disabledHostCount,
          resource.resourceClass,
          resource.used,
          resource.capacity,
          resource.percent === null
            ? null
            : Math.round(resource.percent * 10) / 10,
          resource.usedOnOtherHosts,
          resource.lowestRatio,
          resource.highestRatio,
        ]),
      );
    }
  }
  lines.push("");
  lines.push("When things fill up");
  lines.push(
    csvRow(["Region", "Kind", "Name", "Resource class", "Days until full"]),
  );
  for (const row of view.forecasts) {
    lines.push(
      csvRow([
        row.regionName,
        row.scope,
        row.name,
        row.resourceClass,
        forecastCell(row.forecast),
      ]),
    );
  }

  return `${lines.join("\n")}\n`;
}

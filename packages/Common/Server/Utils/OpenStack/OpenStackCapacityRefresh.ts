import OneUptimeDate from "../../../Types/Date";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Dictionary from "../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackCapacityHost,
  OpenStackHostAllocationMismatch,
  OpenStackHostRealUsage,
  OpenStackInstancesOnHost,
  OpenStackOvercommitReading,
  getOpenStackAllocationMismatches,
  getOpenStackOvercommit,
} from "../../../Types/OpenStack/OpenStackCapacity";
import {
  OPENSTACK_CAPACITY_ALLOCATED_SERIES,
  OPENSTACK_CAPACITY_ID_LABEL,
  OPENSTACK_CAPACITY_NAME_LABEL,
  OPENSTACK_CAPACITY_RESOURCE_LABEL,
  OPENSTACK_CAPACITY_SCOPE_LABEL,
  OPENSTACK_CAPACITY_SERIES_LABELS,
  OpenStackCapacitySeriesRow,
  buildOpenStackCapacityResourceMetrics,
  getOpenStackCapacitySeriesKey,
  getOpenStackCapacitySeriesRows,
} from "../../../Types/OpenStack/OpenStackCapacitySeries";
import {
  OPENSTACK_CAPACITY_FORECAST_EVERY_MINUTES,
  OPENSTACK_CAPACITY_FORECAST_MINIMUM_HOURS,
  OPENSTACK_CAPACITY_FORECAST_WINDOW_HOURS,
  OPENSTACK_CAPACITY_MISMATCH_EVERY_MINUTES,
  OpenStackCapacityFlavor,
  OpenStackCapacityFlavorSourceRow,
  OpenStackCapacityForecastRow,
  OpenStackCapacityHostSourceRow,
  OpenStackCapacityMismatchRow,
  OpenStackCapacityNetworkSourceRow,
  OpenStackCapacityPool,
  OpenStackCapacityPoolSourceRow,
  OpenStackCapacitySnapshot,
  OpenStackCapacityZone,
  buildOpenStackCapacitySnapshot,
  carryOpenStackAllocationMismatches,
  readOpenStackCapacityExternalNetwork,
  readOpenStackCapacityFlavor,
  readOpenStackCapacityHost,
  readOpenStackCapacityStoragePool,
} from "../../../Types/OpenStack/OpenStackCapacitySnapshot";
import {
  OpenStackForecast,
  OpenStackGrowthSample,
  getOpenStackForecast,
} from "../../../Types/OpenStack/OpenStackForecast";
import {
  OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
  OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
  getOpenStackShortHostName,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OpenStackHypervisorMetric,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import MetricService from "../../Services/MetricService";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import OpenStackResourceService, {
  OpenStackCapacityRows,
} from "../../Services/OpenStackResourceService";
import logger from "../Logger";

/*
 * ONE CLOUD'S CAPACITY, WORKED OUT AND KEPT.
 *
 * What the Capacity page and the capacity alerts read, from the inventory's rows, on a worker so
 * no page or batch of ingest ever waits for it. The rows are one read a run. What takes more goes
 * less often and is kept from run to run: instances by host, which on a large cloud is a read of
 * every instance's row, and the metric store's history. Each part that can't be read leaves what
 * was last known, so a slow metric store doesn't cost a page its flavors.
 */

const MINUTE_IN_MS: number = 60 * 1000;

// The most rows of a week's history one read holds: a thing that fills up an hour, for a week.
const FORECAST_READ_ROW_LIMIT: number = 50000;

// Real usage is read over a day, so a host's peak is its day's, not this moment's.
const REAL_USAGE_WINDOW_HOURS: number = 24;
const REAL_USAGE_READ_ROW_LIMIT: number = 20000;

function isDue(
  lastAt: string | null | undefined,
  everyMinutes: number,
  now: Date,
): boolean {
  if (!lastAt) {
    return true;
  }
  const last: number = new Date(lastAt).getTime();
  return (
    !Number.isFinite(last) || now.getTime() - last >= everyMinutes * MINUTE_IN_MS
  );
}

/*
 * A week of what was allocated, one point an hour per thing that fills up, grouped by the labels it
 * was written with, and one forecast per thing the snapshot says fills up. Nothing written yet is a
 * new cloud, which says it hasn't enough history. Allocated is against today's capacity, because a
 * host taken away is the line moving, not growth.
 */
export function getOpenStackCapacityForecasts(data: {
  rows: ReadonlyArray<OpenStackCapacitySeriesRow>;
  historyByKey: ReadonlyMap<string, Array<OpenStackGrowthSample>>;
}): Array<OpenStackCapacityForecastRow> {
  return data.rows.map(
    (row: OpenStackCapacitySeriesRow): OpenStackCapacityForecastRow => {
      const forecast: OpenStackForecast =
        row.capacity <= 0 && row.allocated > 0
          ? { state: "full" }
          : getOpenStackForecast({
              samples: data.historyByKey.get(row.key) || [],
              capacity: row.capacity,
              minimumHours: OPENSTACK_CAPACITY_FORECAST_MINIMUM_HOURS,
            });

      return {
        scope: row.scope,
        name: row.name,
        id: row.id,
        regionName: row.regionName,
        resourceClass: row.resourceClass,
        forecast,
      };
    },
  );
}

export function readOpenStackCapacityHistory(
  points: ReadonlyArray<AggregateModel>,
): Map<string, Array<OpenStackGrowthSample>> {
  const history: Map<string, Array<OpenStackGrowthSample>> = new Map();

  for (const point of points) {
    const attributes: Dictionary<unknown> =
      ((point as unknown as JSONObject)["attributes"] as
        | Dictionary<unknown>
        | undefined) || {};
    const label: (name: string) => string | null = (
      name: string,
    ): string | null => {
      const value: unknown = attributes[name];
      return typeof value === "string" ? value : null;
    };
    const key: string = getOpenStackCapacitySeriesKey({
      regionName: label("openstack.region.name"),
      scope: label(OPENSTACK_CAPACITY_SCOPE_LABEL),
      name: label(OPENSTACK_CAPACITY_NAME_LABEL),
      id: label(OPENSTACK_CAPACITY_ID_LABEL),
      resourceClass: label(OPENSTACK_CAPACITY_RESOURCE_LABEL),
    });
    const time: number = new Date(point.timestamp).getTime();
    const used: number = Number(point.value);

    if (Number.isFinite(time) && Number.isFinite(used)) {
      const samples: Array<OpenStackGrowthSample> = history.get(key) || [];
      samples.push({ time, used });
      history.set(key, samples);
    }
  }

  return history;
}

export interface OpenStackCapacityRefreshResult {
  snapshot: OpenStackCapacitySnapshot;
  resourceMetrics: JSONArray;
}

export default class OpenStackCapacityRefresh {
  public static async refresh(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    cloudName: string;
    previous: OpenStackCapacitySnapshot | null;
    now: Date;
  }): Promise<OpenStackCapacityRefreshResult> {
    const { projectId, openStackCloudId, previous, now } = data;

    const rows: OpenStackCapacityRows =
      await OpenStackResourceService.getCapacityRows({
        projectId,
        openStackCloudId,
      });

    const hosts: Array<OpenStackCapacityHost> = rows.hypervisors.map(
      (row: JSONObject): OpenStackCapacityHost => {
        return readOpenStackCapacityHost(
          row as unknown as OpenStackCapacityHostSourceRow,
        );
      },
    );

    const instances: Array<OpenStackInstancesOnHost> | null = isDue(
      previous?.mismatchesCheckedAt,
      OPENSTACK_CAPACITY_MISMATCH_EVERY_MINUTES,
      now,
    )
      ? await this.readInstancesOnHosts({ projectId, openStackCloudId })
      : null;

    const instancesOfFlavor: Map<string, number> = new Map();

    if (instances) {
      for (const row of instances) {
        const key: string = `${row.regionName || ""}/${row.flavorId || ""}`;
        instancesOfFlavor.set(
          key,
          (instancesOfFlavor.get(key) || 0) + row.count,
        );
      }
    } else {
      // Between reads of every instance, what was last counted is near enough to rank flavors by.
      for (const flavor of previous?.flavors || []) {
        instancesOfFlavor.set(
          `${flavor.regionName || ""}/${flavor.id}`,
          flavor.instanceCount,
        );
      }
    }

    const flavors: Array<OpenStackCapacityFlavor> = rows.flavors.map(
      (row: JSONObject): OpenStackCapacityFlavor => {
        const flavor: OpenStackCapacityFlavor = readOpenStackCapacityFlavor({
          row: row as unknown as OpenStackCapacityFlavorSourceRow,
          instanceCount: 0,
        });
        flavor.instanceCount =
          instancesOfFlavor.get(`${flavor.regionName || ""}/${flavor.id}`) || 0;
        return flavor;
      },
    );

    const pools: Array<OpenStackCapacityPool> = [];
    for (const row of rows.storagePools) {
      const pool: OpenStackCapacityPool | null =
        readOpenStackCapacityStoragePool(
          row as unknown as OpenStackCapacityPoolSourceRow,
        );
      if (pool) {
        pools.push(pool);
      }
    }
    for (const row of rows.externalNetworks) {
      const pool: OpenStackCapacityPool | null =
        readOpenStackCapacityExternalNetwork(
          row as unknown as OpenStackCapacityNetworkSourceRow,
        );
      if (pool) {
        pools.push(pool);
      }
    }

    const mismatchPart: {
      mismatches: Array<OpenStackCapacityMismatchRow>;
      checkedAt: string | null;
    } = this.getMismatches({ hosts, flavors, instances, previous, now });

    const realUsage: {
      usage: Map<string, OpenStackHostRealUsage> | null;
      isDue: boolean;
    } = await this.readRealUsage({ projectId, cloudName: data.cloudName, previous, now });

    const previousOvercommit: Map<string, Array<OpenStackOvercommitReading>> =
      new Map(
        (previous?.zones || []).map(
          (zone: OpenStackCapacityZone): [string, Array<OpenStackOvercommitReading>] => {
            return [`${zone.regionName || ""}/${zone.name}`, zone.overcommit];
          },
        ),
      );

    let snapshot: OpenStackCapacitySnapshot = buildOpenStackCapacitySnapshot({
      hosts,
      flavors,
      pools,
      mismatches: mismatchPart.mismatches,
      mismatchesCheckedAt: mismatchPart.checkedAt,
      forecasts: previous?.forecasts,
      forecastsReadAt: previous?.forecastsReadAt,
      overcommitOf: (
        zoneHosts: ReadonlyArray<OpenStackCapacityHost>,
      ): Array<OpenStackOvercommitReading> => {
        if (realUsage.usage) {
          return getOpenStackOvercommit({
            hosts: zoneHosts,
            realUsageByHost: realUsage.usage,
            cpuLinePercent: OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
            memoryLinePercent: OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
          });
        }
        const first: OpenStackCapacityHost | undefined = zoneHosts[0];
        return first
          ? previousOvercommit.get(
              `${first.regionName || ""}/${first.zone || ""}`,
            ) || []
          : [];
      },
      now,
    });

    if (
      isDue(
        previous?.forecastsReadAt,
        OPENSTACK_CAPACITY_FORECAST_EVERY_MINUTES,
        now,
      )
    ) {
      snapshot = await this.withForecasts({
        projectId,
        cloudName: data.cloudName,
        snapshot,
        now,
      });
    }

    return {
      snapshot,
      resourceMetrics: buildOpenStackCapacityResourceMetrics({
        cloudName: data.cloudName,
        now,
        snapshot,
      }),
    };
  }

  /*
   * Instances by host and flavor are a read of every instance's row, so a large cloud pays for it
   * every quarter of an hour rather than every run, and what disagrees is only a finding once it
   * has gone on disagreeing longer than that anyway. A read that fails leaves what was last known.
   */
  private static async readInstancesOnHosts(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<Array<OpenStackInstancesOnHost> | null> {
    try {
      return await OpenStackResourceService.getInstancesOnHosts(data);
    } catch (err) {
      logger.warn(
        `OpenStack cloud ${data.openStackCloudId.toString()}: its instances by host could not be read: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private static getMismatches(data: {
    hosts: ReadonlyArray<OpenStackCapacityHost>;
    flavors: ReadonlyArray<OpenStackCapacityFlavor>;
    instances: ReadonlyArray<OpenStackInstancesOnHost> | null;
    previous: OpenStackCapacitySnapshot | null;
    now: Date;
  }): {
    mismatches: Array<OpenStackCapacityMismatchRow>;
    checkedAt: string | null;
  } {
    const { previous, now } = data;

    if (!data.instances) {
      return {
        mismatches: previous?.mismatches || [],
        checkedAt: previous?.mismatchesCheckedAt || null,
      };
    }

    const flavorResources: Map<string, Readonly<Record<string, number>>> =
      new Map();

    for (const flavor of data.flavors) {
      flavorResources.set(
        `${flavor.regionName || ""}/${flavor.id}`,
        flavor.request.resources,
      );
    }

    const found: Array<OpenStackHostAllocationMismatch> =
      getOpenStackAllocationMismatches({
        hosts: data.hosts,
        flavorResources,
        instances: data.instances,
      });

    return {
      mismatches: carryOpenStackAllocationMismatches({
        found,
        previous: previous?.mismatches || [],
        now,
      }),
      checkedAt: now.toISOString(),
    };
  }

  private static async withForecasts(data: {
    projectId: ObjectID;
    cloudName: string;
    snapshot: OpenStackCapacitySnapshot;
    now: Date;
  }): Promise<OpenStackCapacitySnapshot> {
    const endDate: Date = data.now;
    const startDate: Date = OneUptimeDate.addRemoveHours(
      endDate,
      -OPENSTACK_CAPACITY_FORECAST_WINDOW_HOURS,
    );

    try {
      const result: AggregatedResult = await this.readGrouped({
        projectId: data.projectId,
        cloudName: data.cloudName,
        metricName: OPENSTACK_CAPACITY_ALLOCATED_SERIES,
        startDate,
        endDate,
        aggregationInterval: AggregationInterval.Hour,
        limit: FORECAST_READ_ROW_LIMIT,
        groupByAttributeKeys: [
          "openstack.region.name",
          ...OPENSTACK_CAPACITY_SERIES_LABELS,
        ],
      });

      return {
        ...data.snapshot,
        forecasts: getOpenStackCapacityForecasts({
          rows: getOpenStackCapacitySeriesRows(data.snapshot),
          historyByKey: readOpenStackCapacityHistory(result.data || []),
        }),
        forecastsReadAt: data.now.toISOString(),
      };
    } catch (err) {
      logger.warn(
        `OpenStack cloud ${data.cloudName}: its capacity history could not be read, so its forecasts stay as they were: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return data.snapshot;
    }
  }

  /*
   * What hypervisors really use, on the forecast's schedule: a day's peak moves slowly and this is
   * a metric store read. Only from what libvirt's or Ceilometer's exporter reports (#5735). A
   * cloud with neither has nothing to compare, and its page says what to add.
   */
  private static async readRealUsage(data: {
    projectId: ObjectID;
    cloudName: string;
    previous: OpenStackCapacitySnapshot | null;
    now: Date;
  }): Promise<{
    usage: Map<string, OpenStackHostRealUsage> | null;
    isDue: boolean;
  }> {
    if (
      !isDue(
        data.previous?.forecastsReadAt,
        OPENSTACK_CAPACITY_FORECAST_EVERY_MINUTES,
        data.now,
      )
    ) {
      return { usage: null, isDue: false };
    }

    const endDate: Date = data.now;
    const startDate: Date = OneUptimeDate.addRemoveHours(
      endDate,
      -REAL_USAGE_WINDOW_HOURS,
    );

    const read: (metricName: string) => Promise<Map<string, number>> = async (
      metricName: string,
    ): Promise<Map<string, number>> => {
      const result: AggregatedResult = await this.readGrouped({
        projectId: data.projectId,
        cloudName: data.cloudName,
        metricName,
        startDate,
        endDate,
        aggregationInterval: AggregationInterval.Total,
        limit: REAL_USAGE_READ_ROW_LIMIT,
        groupByAttributeKeys: [OPENSTACK_HYPERVISOR_ATTRIBUTE],
      });

      const values: Map<string, number> = new Map();

      for (const point of result.data || []) {
        const attributes: Dictionary<unknown> =
          ((point as unknown as JSONObject)["attributes"] as
            | Dictionary<unknown>
            | undefined) || {};
        const host: unknown = attributes[OPENSTACK_HYPERVISOR_ATTRIBUTE];
        const value: number = Number(point.value);

        if (typeof host === "string" && Number.isFinite(value)) {
          values.set(getOpenStackShortHostName(host), value);
        }
      }

      return values;
    };

    try {
      const cpu: Map<string, number> = await read(
        OpenStackHypervisorMetric.InstancesCpuUtilization,
      );
      const memory: Map<string, number> = await read(
        OpenStackHypervisorMetric.InstancesMemoryUtilization,
      );

      const usage: Map<string, OpenStackHostRealUsage> = new Map();

      for (const host of new Set([...cpu.keys(), ...memory.keys()])) {
        usage.set(host, {
          cpuPercent: cpu.get(host) ?? null,
          memoryPercent: memory.get(host) ?? null,
        });
      }

      return { usage, isDue: true };
    } catch (err) {
      logger.warn(
        `OpenStack cloud ${data.cloudName}: what its hosts really use could not be read: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { usage: null, isDue: true };
    }
  }

  private static async readGrouped(data: {
    projectId: ObjectID;
    cloudName: string;
    metricName: string;
    startDate: Date;
    endDate: Date;
    aggregationInterval: AggregationInterval;
    limit: number;
    groupByAttributeKeys: Array<string>;
  }): Promise<AggregatedResult> {
    return await MetricService.aggregateBy({
      query: {
        projectId: data.projectId,
        time: new InBetween<Date>(data.startDate, data.endDate),
        name: data.metricName,
        attributes: {
          [OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE]: data.cloudName,
        },
      } as never,
      aggregationType: AggregationType.Max,
      aggregationInterval: data.aggregationInterval,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: data.startDate,
      endTimestamp: data.endDate,
      limit: data.limit,
      skip: 0,
      groupByAttributeKeys: data.groupByAttributeKeys,
      props: { isRoot: true },
    });
  }

  public static async save(data: {
    openStackCloudId: ObjectID;
    snapshot: OpenStackCapacitySnapshot;
  }): Promise<void> {
    await OpenStackCloudService.updateOneById({
      id: data.openStackCloudId,
      data: {
        capacitySnapshot: data.snapshot as unknown as JSONObject,
      } as never,
      props: { isRoot: true, ignoreHooks: true },
    });
  }
}

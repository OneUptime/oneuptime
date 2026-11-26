import { OpenMetricsSample } from "./OpenMetricsText";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { XcpNgPoolSummary } from "Common/Types/XcpNg/XcpNgProbeCollection";
import {
  XCP_NG_POOL_ID_ATTRIBUTE,
  XCP_NG_POOL_NAME_ATTRIBUTE,
  XcpNgLabel,
  XcpNgSeries,
  XcpNgTelemetryUtil,
} from "Common/Types/XcpNg/XcpNgTelemetry";

/*
 * The XCP-ng Agent's collector pipeline (agents/XcpNgAgent/
 * otel-collector-config.yaml), in code: what a probe sends OneUptime for
 * one read of a Xen Orchestra (or of a pool's XAPI, whose series are built
 * as Xen Orchestra's plugin builds them), so nothing downstream - the
 * normalizer, the snapshot scan, the pages, monitors and templates - can
 * tell a pool read by a probe from one read by the agent.
 *
 *   prometheus receiver      every sample a gauge datapoint, its HELP the
 *                            description, `prometheus.type` in metadata,
 *                            its timestamp (seconds) as the time - or the
 *                            moment of the read for one served without, as
 *                            xcp_pool_connected is; server.address,
 *                            server.port and url.scheme on the resource.
 *                            A series served without a timestamp that is
 *                            gone from the next read is marked stale
 *                            (flags 1, no value), as the receiver does.
 *   filter/xcp-ng-only       only xcp_* series.
 *   transform/xcp-ng-rates   the eight rates Xen Orchestra types `counter`
 *                            stay gauges, their values as served; any other
 *                            counter is a cumulative, monotonic sum.
 *   groupbyattrs + resource  one resource per (pool_id, pool_name), those
 *                            labels moved to xcp_ng.pool.id and
 *                            xcp_ng.pool.name (no name for an empty one).
 *   filter/xcp-ng-pool-only  a series with no pool_id (the IPMI host power)
 *                            is dropped.
 *
 * The server, not the probe, stamps xen_orchestra.name (the connection's
 * name), and the probe never claims to be the agent: no
 * oneuptime.agent.version. Everything comes out in one order - resources
 * by pool, metrics by name, datapoints by their attributes, attributes by
 * key - the order the agent's recorded output is kept in, so the two can be
 * held equal by a test.
 */

export const XCP_NG_PROBE_SCOPE_NAME: string = "oneuptime-probe-xcp-ng";

// A series' identity across reads: its name and its labels, sorted.
export function getSeriesKey(sample: {
  name: string;
  labels: Array<[string, string]>;
}): string {
  const labels: Array<[string, string]> = [...sample.labels].sort(
    (left: [string, string], right: [string, string]): number => {
      return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
    },
  );

  return JSON.stringify([sample.name, labels]);
}

export interface XcpNgOtlpBuildInput {
  samples: Array<OpenMetricsSample>;
  // When the read was made, in milliseconds.
  scrapeTimeMs: number;
  // What was read: server.address and server.port, as the receiver stamps them.
  target: { host: string; port: number };
  scopeVersion: string;
  /*
   * The series served without a timestamp at the previous read of this
   * connection, by series key: one that is gone now is marked stale.
   */
  previousUntimedSeries?: Map<string, OpenMetricsSample> | undefined;
  /*
   * When each counter (other than the eight rates) was first read, by
   * series key: its start time. Written to as new ones are read.
   */
  counterStartTimes?: Map<string, number> | undefined;
}

export interface XcpNgOtlpBuildResult {
  resourceMetrics: JSONArray;
  resourceCount: number;
  datapointCount: number;
  // Every pool a resource was made for, lower case, sorted.
  poolIds: Array<string>;
  // The series served without a timestamp now, for the next read.
  untimedSeries: Map<string, OpenMetricsSample>;
  // What was left out, by why.
  droppedNotXcpCount: number;
  droppedWithoutPoolCount: number;
  droppedNotFiniteCount: number;
}

interface BuiltDatapoint {
  attributes: Array<JSONObject>;
  attributesKey: string;
  timeUnixNano: string;
  startTimeUnixNano?: string | undefined;
  value: number | null;
  isStale: boolean;
}

interface BuiltMetric {
  name: string;
  description: string;
  prometheusType: string;
  isSum: boolean;
  datapoints: Array<BuiltDatapoint>;
}

interface BuiltResource {
  poolId: string;
  poolName: string;
  metrics: Map<string, BuiltMetric>;
}

const POOL_LABELS: ReadonlySet<string> = new Set<string>([
  XcpNgLabel.PoolId,
  XcpNgLabel.PoolName,
]);

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function byText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Milliseconds as OTLP's nanoseconds, written as text (as OTLP/JSON does).
export function toUnixNanoText(milliseconds: number): string {
  const whole: number = Math.round(milliseconds);
  return whole === 0 ? "0" : `${whole}000000`;
}

function readLabel(
  labels: Array<[string, string]>,
  name: string,
): string | undefined {
  for (const [key, value] of labels) {
    if (key === name) {
      return value;
    }
  }
  return undefined;
}

export default class XcpNgOtlpBuilder {
  public static build(input: XcpNgOtlpBuildInput): XcpNgOtlpBuildResult {
    const result: XcpNgOtlpBuildResult = {
      resourceMetrics: [],
      resourceCount: 0,
      datapointCount: 0,
      poolIds: [],
      untimedSeries: new Map(),
      droppedNotXcpCount: 0,
      droppedWithoutPoolCount: 0,
      droppedNotFiniteCount: 0,
    };

    const resources: Map<string, BuiltResource> = new Map();
    const scrapeTime: string = toUnixNanoText(input.scrapeTimeMs);
    const counterStartTimes: Map<string, number> =
      input.counterStartTimes || new Map();

    const add: (sample: OpenMetricsSample, isStale: boolean) => void = (
      sample: OpenMetricsSample,
      isStale: boolean,
    ): void => {
      const poolId: string | undefined = readLabel(
        sample.labels,
        XcpNgLabel.PoolId,
      );

      if (!poolId) {
        result.droppedWithoutPoolCount++;
        return;
      }

      const poolName: string =
        readLabel(sample.labels, XcpNgLabel.PoolName) || "";
      const resourceKey: string = JSON.stringify([poolId, poolName]);

      let resource: BuiltResource | undefined = resources.get(resourceKey);

      if (!resource) {
        resource = { poolId: poolId, poolName: poolName, metrics: new Map() };
        resources.set(resourceKey, resource);
      }

      const isRate: boolean = XcpNgTelemetryUtil.isRateTypedAsCounter(
        sample.name,
      );
      const isSum: boolean = sample.type === "counter" && !isRate;

      let metric: BuiltMetric | undefined = resource.metrics.get(sample.name);

      if (!metric) {
        metric = {
          name: sample.name,
          description: sample.help,
          prometheusType: sample.type,
          isSum: isSum,
          datapoints: [],
        };
        resource.metrics.set(sample.name, metric);
      }

      const attributes: Array<JSONObject> = sample.labels
        .filter(([key, value]: [string, string]): boolean => {
          // An empty label is no label, as Prometheus reads it.
          return !POOL_LABELS.has(key) && value !== "";
        })
        .sort((left: [string, string], right: [string, string]): number => {
          return byText(left[0], right[0]);
        })
        .map(([key, value]: [string, string]): JSONObject => {
          return stringAttribute(key, value);
        });

      const datapoint: BuiltDatapoint = {
        attributes: attributes,
        attributesKey: JSON.stringify(
          attributes.map((attribute: JSONObject) => {
            return [attribute["key"], attribute["value"]];
          }),
        ),
        timeUnixNano:
          isStale || sample.timestampSeconds === null
            ? scrapeTime
            : toUnixNanoText(sample.timestampSeconds * 1000),
        value: isStale ? null : sample.value,
        isStale: isStale,
      };

      if (isSum && !isStale) {
        const seriesKey: string = getSeriesKey(sample);
        let startTime: number | undefined = counterStartTimes.get(seriesKey);

        if (startTime === undefined) {
          startTime = input.scrapeTimeMs;
          counterStartTimes.set(seriesKey, startTime);
        }

        datapoint.startTimeUnixNano = toUnixNanoText(startTime);
      }

      metric.datapoints.push(datapoint);
    };

    for (const sample of input.samples) {
      if (!sample.name.startsWith("xcp_")) {
        result.droppedNotXcpCount++;
        continue;
      }

      if (!Number.isFinite(sample.value)) {
        /*
         * Xen Orchestra's plugin never serves one (it leaves out a NaN or
         * an infinite reading); OTLP/JSON could not carry it either.
         */
        result.droppedNotFiniteCount++;
        continue;
      }

      if (sample.timestampSeconds === null) {
        result.untimedSeries.set(getSeriesKey(sample), sample);
      }

      add(sample, false);
    }

    // The series served without a timestamp last time and gone now.
    for (const [key, previous] of input.previousUntimedSeries || new Map()) {
      if (!result.untimedSeries.has(key) && previous.name.startsWith("xcp_")) {
        add(previous, true);
      }
    }

    const ordered: Array<BuiltResource> = Array.from(resources.values()).sort(
      (left: BuiltResource, right: BuiltResource): number => {
        return (
          byText(left.poolId, right.poolId) ||
          byText(left.poolName, right.poolName)
        );
      },
    );

    const poolIds: Set<string> = new Set();

    for (const resource of ordered) {
      const resourceAttributes: Array<JSONObject> = [
        stringAttribute("server.address", input.target.host),
        stringAttribute("server.port", String(input.target.port)),
        stringAttribute("url.scheme", "https"),
        stringAttribute(XCP_NG_POOL_ID_ATTRIBUTE, resource.poolId),
      ];

      if (resource.poolName) {
        resourceAttributes.push(
          stringAttribute(XCP_NG_POOL_NAME_ATTRIBUTE, resource.poolName),
        );
      }

      resourceAttributes.sort((left: JSONObject, right: JSONObject): number => {
        return byText(String(left["key"]), String(right["key"]));
      });

      const metrics: JSONArray = Array.from(resource.metrics.values())
        .sort((left: BuiltMetric, right: BuiltMetric): number => {
          return byText(left.name, right.name);
        })
        .map((metric: BuiltMetric): JSONObject => {
          return XcpNgOtlpBuilder.emitMetric(metric);
        });

      for (const metric of resource.metrics.values()) {
        result.datapointCount += metric.datapoints.length;
      }

      result.resourceMetrics.push({
        resource: {
          attributes: resourceAttributes,
        },
        scopeMetrics: [
          {
            scope: {
              name: XCP_NG_PROBE_SCOPE_NAME,
              version: input.scopeVersion,
            },
            metrics: metrics,
          },
        ],
      });

      poolIds.add(XcpNgTelemetryUtil.normalizePoolIdentifier(resource.poolId));
    }

    result.resourceCount = result.resourceMetrics.length;
    result.poolIds = Array.from(poolIds).sort(byText);

    return result;
  }

  private static emitMetric(metric: BuiltMetric): JSONObject {
    const dataPoints: JSONArray = [...metric.datapoints]
      .sort((left: BuiltDatapoint, right: BuiltDatapoint): number => {
        return byText(left.attributesKey, right.attributesKey);
      })
      .map((datapoint: BuiltDatapoint): JSONObject => {
        const emitted: JSONObject = {};

        if (datapoint.attributes.length > 0) {
          emitted["attributes"] = datapoint.attributes;
        }

        if (datapoint.startTimeUnixNano) {
          emitted["startTimeUnixNano"] = datapoint.startTimeUnixNano;
        }

        emitted["timeUnixNano"] = datapoint.timeUnixNano;

        if (datapoint.isStale) {
          // NO_RECORDED_VALUE: the series is gone.
          emitted["flags"] = 1;
        } else {
          emitted["asDouble"] = datapoint.value as number;
        }

        return emitted;
      });

    const emitted: JSONObject = {
      name: metric.name,
    };

    if (metric.description) {
      emitted["description"] = metric.description;
    }

    if (metric.isSum) {
      emitted["sum"] = {
        dataPoints: dataPoints,
        // AGGREGATION_TEMPORALITY_CUMULATIVE
        aggregationTemporality: 2,
        isMonotonic: true,
      };
    } else {
      emitted["gauge"] = {
        dataPoints: dataPoints,
      };
    }

    emitted["metadata"] = [
      stringAttribute("prometheus.type", metric.prometheusType),
    ];

    return emitted;
  }

  /*
   * What a read saw of each pool: its name and how many hosts, VMs and
   * storage repositories it reports, from the same series the inventory is
   * built from. A name that is the pool's own UUID (Xen Orchestra sends that
   * while it has not loaded the pool) is no name.
   */
  public static summarizePools(
    samples: Array<OpenMetricsSample>,
  ): Array<XcpNgPoolSummary> {
    interface PoolCounts {
      poolName: string;
      hosts: Map<string, boolean>;
      vms: Map<string, boolean>;
      srs: Set<string>;
    }

    const pools: Map<string, PoolCounts> = new Map();

    for (const sample of samples) {
      if (!sample.name.startsWith("xcp_")) {
        continue;
      }

      const rawPoolId: string | undefined = readLabel(
        sample.labels,
        XcpNgLabel.PoolId,
      );

      if (!rawPoolId) {
        continue;
      }

      const poolId: string =
        XcpNgTelemetryUtil.normalizePoolIdentifier(rawPoolId);
      let pool: PoolCounts | undefined = pools.get(poolId);

      if (!pool) {
        pool = { poolName: "", hosts: new Map(), vms: new Map(), srs: new Set() };
        pools.set(poolId, pool);
      }

      const poolName: string = (
        readLabel(sample.labels, XcpNgLabel.PoolName) || ""
      ).trim();

      if (
        poolName &&
        !pool.poolName &&
        XcpNgTelemetryUtil.normalizePoolIdentifier(poolName) !== poolId
      ) {
        pool.poolName = poolName;
      }

      const uuid: string = (
        readLabel(sample.labels, XcpNgLabel.Uuid) || ""
      ).toLowerCase();
      const powerState: string =
        readLabel(sample.labels, XcpNgLabel.PowerState) || "";

      if (sample.name === XcpNgSeries.HostStatus && uuid) {
        pool.hosts.set(
          uuid,
          (pool.hosts.get(uuid) || false) || powerState === "Running",
        );
      } else if (sample.name === XcpNgSeries.VmStatus && uuid) {
        pool.vms.set(
          uuid,
          (pool.vms.get(uuid) || false) || powerState === "Running",
        );
      } else if (sample.name === XcpNgSeries.SrPhysicalSizeBytes) {
        const srUuid: string = (
          readLabel(sample.labels, XcpNgLabel.SrUuid) || ""
        ).toLowerCase();

        if (srUuid) {
          pool.srs.add(srUuid);
        }
      }
    }

    return Array.from(pools.entries())
      .sort((left: [string, PoolCounts], right: [string, PoolCounts]) => {
        return byText(left[0], right[0]);
      })
      .map(([poolId, pool]: [string, PoolCounts]): XcpNgPoolSummary => {
        const summary: XcpNgPoolSummary = {
          poolId: poolId,
          hostCount: pool.hosts.size,
          runningHostCount: Array.from(pool.hosts.values()).filter(
            (isRunning: boolean) => {
              return isRunning;
            },
          ).length,
          vmCount: pool.vms.size,
          runningVmCount: Array.from(pool.vms.values()).filter(
            (isRunning: boolean) => {
              return isRunning;
            },
          ).length,
          storageRepositoryCount: pool.srs.size,
        };

        if (pool.poolName) {
          summary.poolName = pool.poolName;
        }

        return summary;
      });
  }
}

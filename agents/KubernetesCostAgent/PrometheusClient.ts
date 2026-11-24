import { peakKey } from "./AllocationMapper";
import { COST_PROMETHEUS_CADVISOR_JOB, COST_PROMETHEUS_URL } from "./Config";
import {
  CostPrometheus,
  CostPrometheusSource,
  promqlString,
  redactUrl,
} from "./EnginePrometheus";
import Logger from "./Logger";
import {
  PrometheusQuery,
  PrometheusVectorSample,
  queryPrometheus,
} from "./PrometheusQuery";
import { KubernetesCostMemoryPeaksSource } from "./Types";

/*
 * Per-container memory peaks, read from the cluster's cAdvisor scrape.
 *
 * Why this exists at all: the Allocation API reports ramByteUsageAverage —
 * an average over the whole window. Sizing a memory request off an average
 * is how you get OOMKills, because the burst that actually kills a container
 * vanishes into an hourly mean. The peak has to come from the raw
 * time series.
 *
 * Only MEMORY is fetched here, deliberately. CPU's equivalent would need
 * `rate(container_cpu_usage_seconds_total[5m])` evaluated as a subquery
 * across every container in the cluster, which is dramatically more
 * expensive than reading a gauge — enough to time out or OOM the bundled
 * Prometheus at its default 500m/1Gi. It is also not worth it: overshooting
 * a CPU request throttles a container, while overshooting memory kills it,
 * so CPU recommendations are safely derived from the hourly averages already
 * stored in ClickHouse. Memory is the only place the average is inadequate.
 *
 * Which Prometheus, which job and which cluster's series is the source's to
 * say (EnginePrometheus.CostPrometheusTarget, #9777): the one
 * cost.engine.prometheusUrl names, the chart's bundled one, or the one the
 * cluster's own engine reads.
 */

// A peak query reads an hour of every container: give it time.
const PEAK_QUERY_TIMEOUT_MS: number = 120000;

/*
 * COST_PROMETHEUS_URL as it is, and nothing looked for: what the client
 * reads when it is given no source.
 */
export const configuredPrometheusSource: () => CostPrometheusSource =
  (): CostPrometheusSource => {
    const prometheus: CostPrometheus | null = COST_PROMETHEUS_URL
      ? {
          url: COST_PROMETHEUS_URL,
          origin: "configured",
          source: "COST_PROMETHEUS_URL",
          cadvisorJob: COST_PROMETHEUS_CADVISOR_JOB,
          cluster: null,
          note: "",
        }
      : null;

    return {
      current: (): CostPrometheus | null => {
        return prometheus;
      },
      reason: (): string => {
        return "";
      },
      refreshIfDue: (): Promise<void> => {
        return Promise.resolve();
      },
    };
  };

// The peaks query for a window of this many seconds, in that Prometheus.
export const memoryPeakQuery: (
  prometheus: CostPrometheus,
  windowSeconds: number,
) => string = (prometheus: CostPrometheus, windowSeconds: number): string => {
  /*
   * container!="" drops the pod sandbox series and the node/system cgroup
   * rollups, which would otherwise dwarf every real container.
   * container!="POD" additionally drops the infra container that older
   * dockershim clusters still label that way.
   *
   * `max by` rather than `sum by`: a container lives on one node, and
   * summing would double-count during the moments a restarted container's
   * old and new cgroup series overlap.
   */
  const selectors: Array<string> = [
    `job=${promqlString(prometheus.cadvisorJob)}`,
    'container!=""',
    'container!="POD"',
  ];

  if (prometheus.cluster) {
    selectors.push(
      `${prometheus.cluster.label}=${promqlString(prometheus.cluster.value)}`,
    );
  }

  return (
    `max by (namespace, pod, container) (` +
    `max_over_time(` +
    `container_memory_working_set_bytes{${selectors.join(",")}}` +
    `[${windowSeconds}s]))`
  );
};

export class PrometheusClient {
  private readonly source: CostPrometheusSource;
  private readonly query: PrometheusQuery;

  public constructor(source?: CostPrometheusSource, query?: PrometheusQuery) {
    this.source = source || configuredPrometheusSource();
    this.query = query || queryPrometheus;
  }

  public isEnabled(): boolean {
    return Boolean(this.source.current());
  }

  /*
   * Where the peaks come from now (#9970): the Prometheus the cluster's own
   * engine reads, the chart's bundled one, cost.engine.prometheusUrl, or ""
   * for none. The shipment says it, so the page that advises stopping the
   * bundled engine can say when that stops the peaks too.
   */
  public memoryPeaksFrom(): KubernetesCostMemoryPeaksSource {
    return this.source.current()?.origin || "";
  }

  /**
   * Peak working-set bytes per container over one closed window, keyed by
   * peakKey(). Returns an empty map — never throws — when there is no
   * Prometheus, it is unreachable, or it has no data for the window: peaks
   * are an enrichment, and a window's spend must ship without them.
   */
  public async fetchMemoryPeaks(data: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Map<string, number>> {
    const peaks: Map<string, number> = new Map<string, number>();

    try {
      // Which Prometheus, looked for again first when it is time.
      await this.source.refreshIfDue();
    } catch (err: unknown) {
      Logger.debug("could not look for the Prometheus to read peaks from", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const prometheus: CostPrometheus | null = this.source.current();

    if (!prometheus) {
      return peaks;
    }

    const windowSeconds: number = Math.max(
      1,
      Math.round(
        (data.windowEnd.getTime() - data.windowStart.getTime()) / 1000,
      ),
    );

    try {
      /*
       * Evaluated AT the window end so the range selector covers exactly the
       * window just closed, instead of the last hour of wall-clock — the
       * poller runs a couple of minutes late by design
       * (ENGINE_SETTLE_SECONDS).
       */
      const samples: Array<PrometheusVectorSample> = await this.query(
        prometheus.url,
        memoryPeakQuery(prometheus, windowSeconds),
        { time: data.windowEnd, timeoutMs: PEAK_QUERY_TIMEOUT_MS },
      );

      for (const sample of samples) {
        if (sample.value < 0) {
          continue;
        }

        const namespace: string = sample.metric["namespace"] || "";
        const podName: string = sample.metric["pod"] || "";
        const containerName: string = sample.metric["container"] || "";

        if (!namespace || !podName || !containerName) {
          continue;
        }

        peaks.set(peakKey({ namespace, podName, containerName }), sample.value);
      }

      Logger.debug("fetched container memory peaks", {
        containers: peaks.size,
      });
    } catch (err: unknown) {
      /*
       * Swallowed on purpose. A missing peak costs a memory recommendation;
       * a thrown error here would block the poller's checkpoint and stall the
       * whole cost pipeline over an enrichment.
       */
      Logger.warn("the memory peak query failed; shipping without peaks", {
        costPrometheusUrl: redactUrl(prometheus.url),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return peaks;
  }
}

import { URL } from "url";
import { peakKey } from "./AllocationMapper";
import { COST_PROMETHEUS_CADVISOR_JOB, COST_PROMETHEUS_URL } from "./Config";
import { httpGetJson, HttpResult } from "./HttpClient";
import Logger from "./Logger";
import { PrometheusInstantQueryResponse, PrometheusSample } from "./Types";

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
 */

export class PrometheusClient {
  public isEnabled(): boolean {
    return Boolean(COST_PROMETHEUS_URL);
  }

  /**
   * Peak working-set bytes per container over one closed window, keyed by
   * peakKey(). Returns an empty map — never throws — when Prometheus is
   * unconfigured, unreachable, or has no data for the window: peaks are an
   * enrichment, and a window's spend must ship without them.
   */
  public async fetchMemoryPeaks(data: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Map<string, number>> {
    const peaks: Map<string, number> = new Map<string, number>();

    if (!this.isEnabled()) {
      return peaks;
    }

    const windowSeconds: number = Math.max(
      1,
      Math.round(
        (data.windowEnd.getTime() - data.windowStart.getTime()) / 1000,
      ),
    );

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
    const query: string =
      `max by (namespace, pod, container) (` +
      `max_over_time(` +
      `container_memory_working_set_bytes{job="${COST_PROMETHEUS_CADVISOR_JOB}",container!="",container!="POD"}` +
      `[${windowSeconds}s]))`;

    const url: URL = new URL(`${COST_PROMETHEUS_URL}/api/v1/query`);
    url.searchParams.set("query", query);
    /*
     * Evaluate AT the window end so the range selector covers exactly the
     * window just closed, instead of the last hour of wall-clock — the
     * poller runs a couple of minutes late by design (ENGINE_SETTLE_SECONDS).
     */
    url.searchParams.set(
      "time",
      String(Math.floor(data.windowEnd.getTime() / 1000)),
    );

    try {
      const result: HttpResult = await httpGetJson(url);

      if (result.statusCode < 200 || result.statusCode >= 300) {
        Logger.warn("prometheus rejected the peak query; shipping without it", {
          statusCode: result.statusCode,
          body: result.body.slice(0, 300),
        });
        return peaks;
      }

      const parsed: PrometheusInstantQueryResponse = JSON.parse(
        result.body,
      ) as PrometheusInstantQueryResponse;

      /*
       * Prometheus answers 200 with status:"error" for a bad query, so the
       * status code alone is not enough.
       */
      if (parsed.status !== "success" || !parsed.data?.result) {
        Logger.warn("prometheus returned no usable peak data", {
          status: parsed.status,
          error: parsed.error,
        });
        return peaks;
      }

      for (const sample of parsed.data.result) {
        const value: number | null = this.sampleValue(sample);
        if (value === null) {
          continue;
        }

        const namespace: string = sample.metric?.namespace || "";
        const podName: string = sample.metric?.pod || "";
        const containerName: string = sample.metric?.container || "";

        if (!namespace || !podName || !containerName) {
          continue;
        }

        peaks.set(peakKey({ namespace, podName, containerName }), value);
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
      const message: string = err instanceof Error ? err.message : String(err);
      Logger.warn("prometheus peak query failed; shipping without peaks", {
        error: message,
      });
    }

    return peaks;
  }

  private sampleValue(sample: PrometheusSample): number | null {
    // Instant-vector samples are [unixSeconds, "<value as string>"].
    const raw: string | undefined = sample.value?.[1];
    if (raw === undefined) {
      return null;
    }

    const value: number = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }

    return value;
  }
}

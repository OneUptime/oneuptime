import * as http from "http";
import {
  HEALTH_MAX_POLL_FAILURES,
  HEALTH_PORT,
  HEALTH_STALE_WINDOWS,
  LOOKBACK_WINDOWS,
  WINDOW_SECONDS,
} from "./Config";
import {
  CostPrometheus,
  CostPrometheusSource,
  redactUrl,
} from "./EnginePrometheus";
import Logger from "./Logger";
import { Poller } from "./Poller";
import { Shipper } from "./Shipper";
import {
  CostEngineSource,
  EngineMetricsSource,
  HealthReport,
  KubernetesCostEngineInfo,
  PollerStatus,
  ShipperStatus,
} from "./Types";

/*
 * Is the cost pipeline actually working?
 *
 * The honest answer needs the poller and the shipper together. Asking the
 * shipper alone is how a real outage stayed invisible: the bundled OpenCost
 * could not write /var/configs, its Allocation API never answered, the
 * poller retried the same window forever (by design — see Poller.tick), and
 * because a failed fetch never reaches the shipper, the shipper had nothing
 * to complain about. /healthz answered 200 the whole time and the pod
 * stayed Ready.
 *
 * The three signals below are ordered fast-to-slow. Only the first is a
 * quick trigger, and it needs real consecutive errors — silence alone is
 * never enough to fail an agent, because a healthy cost agent is silent
 * most of the time:
 *
 *   1. The poll has thrown HEALTH_MAX_POLL_FAILURES ticks in a row. This is
 *      the reported outage, caught in ~15 minutes at the defaults.
 *   2. No window has completed in HEALTH_STALE_WINDOWS windows. Catches a
 *      stall that is not throwing — a wedged timer, a starved event loop,
 *      settle/clock math that never lets a window come due.
 *   3. Nothing has ever shipped, well past the point where something should
 *      have. Catches the engine that answers 200 with an empty allocation
 *      set forever: windows drain, signal 2 stays happy, no data lands.
 *
 * Signals 2 and 3 are measured from process start, which IS the grace
 * period: a freshly started agent waiting for its first closed hourly
 * window trips neither. Signal 3's grace additionally clears LOOKBACK_WINDOWS,
 * because on a fresh install those windows predate the cost engine and
 * legitimately come back empty — "no rows yet" is the expected state for
 * the first few windows of every install, so it must never be the thing
 * that trips first.
 */

const minutesSince: (fromMs: number, nowMs: number) => number = (
  fromMs: number,
  nowMs: number,
): number => {
  return Math.max(0, Math.round((nowMs - fromMs) / 60000));
};

export const assessHealth: (args: {
  poller: PollerStatus;
  shipper: ShipperStatus;
  nowMs: number;
}) => HealthReport = (args: {
  poller: PollerStatus;
  shipper: ShipperStatus;
  nowMs: number;
}): HealthReport => {
  const windowMs: number = WINDOW_SECONDS * 1000;
  const staleMs: number = HEALTH_STALE_WINDOWS * windowMs;
  const firstShipGraceMs: number =
    (LOOKBACK_WINDOWS + HEALTH_STALE_WINDOWS) * windowMs;

  const upForMs: number = Math.max(0, args.nowMs - args.poller.startedAtMs);
  const reasons: Array<string> = [];

  // 1. The poll loop is erroring every tick.
  if (args.poller.consecutivePollFailures >= HEALTH_MAX_POLL_FAILURES) {
    reasons.push(
      `the cost engine poll has failed ${args.poller.consecutivePollFailures} consecutive ticks (last error: ${args.poller.lastPollError || "unknown"})`,
    );
  }

  /*
   * 2. Progress has stalled. A ship counts as progress on its own so a
   * mid-window success is not overlooked, though in practice the window
   * that contained it completes moments later.
   */
  const lastProgressMs: number = Math.max(
    args.poller.lastWindowCompletedAtMs,
    args.shipper.lastShipOkAtMs,
  );
  if (lastProgressMs === 0) {
    if (upForMs > staleMs) {
      reasons.push(
        `no cost window has completed in the ${minutesSince(args.poller.startedAtMs, args.nowMs)} minutes since startup`,
      );
    }
  } else if (args.nowMs - lastProgressMs > staleMs) {
    reasons.push(
      `the last cost window completed ${minutesSince(lastProgressMs, args.nowMs)} minutes ago`,
    );
  }

  // 3. Windows are draining but no data has ever reached OneUptime.
  if (args.shipper.lastShipOkAtMs === 0 && upForMs > firstShipGraceMs) {
    /*
     * Name the likely culprit, but only one the facts support: an engine
     * answering with nothing is a different fault from a poll that never
     * got that far, and when the poll is the broken part the reasons above
     * already say so.
     */
    let detail: string = "";
    if (args.shipper.lastShipError) {
      detail = ` (last ship error: ${args.shipper.lastShipError})`;
    } else if (args.poller.windowsCompleted > 0) {
      detail = ` (the engine answered ${args.poller.windowsCompleted} windows, all with no allocations)`;
    }

    reasons.push(
      `no cost allocations have ever shipped in the ${minutesSince(args.poller.startedAtMs, args.nowMs)} minutes since startup${detail}`,
    );
  }

  return {
    healthy: reasons.length === 0,
    status: reasons.length === 0 ? "ok" : "degraded",
    reasons,
    lastPollError: args.poller.lastPollError,
    lastShipError: args.shipper.lastShipError,
    windowsCompleted: args.poller.windowsCompleted,
    uptimeSeconds: Math.round(upForMs / 1000),
  };
};

/*
 * Three routes, deliberately:
 *
 *   /healthz (and /) — readiness. Degraded answers 503, so a pod whose cost
 *     pipeline is dead reads 0/1 Ready instead of silently green.
 *   /livez — liveness. 200 for as long as the process is up, because
 *     restarting the agent cannot fix an engine that is down, and a restart
 *     loop would both hide the diagnostic in /healthz and lose the poller's
 *     in-memory checkpoint every time.
 *   /scrape-targets — where the engine in use serves its price metrics, in
 *     the JSON Prometheus' http_sd reads (EngineMetrics): the collector's
 *     cost-engine job asks here when cost.engine.url is auto or a URL
 *     (#9776). An empty list until the agent has found them. Always 200,
 *     whatever the readiness: the price metrics do not wait on the
 *     allocations.
 *
 * The JSON keys status / lastPollError / lastShipError are parsed by the
 * chart's troubleshoot.sh — keep them.
 */
/*
 * Where the memory peaks come from (#9777), for /healthz: the Prometheus in
 * use, without anything secret in its address, or why there is none.
 */
export const describeCostPrometheus: (
  source: CostPrometheusSource | undefined,
) => {
  costPrometheusUrl?: string;
  costPrometheus?: {
    origin: string;
    source: string;
    cadvisorJob: string;
    cluster?: { label: string; value: string };
    note?: string;
  };
  costPrometheusError?: string;
} = (
  source: CostPrometheusSource | undefined,
): {
  costPrometheusUrl?: string;
  costPrometheus?: {
    origin: string;
    source: string;
    cadvisorJob: string;
    cluster?: { label: string; value: string };
    note?: string;
  };
  costPrometheusError?: string;
} => {
  if (!source) {
    return {};
  }

  const prometheus: CostPrometheus | null = source.current();

  if (!prometheus) {
    const reason: string = source.reason();
    return reason ? { costPrometheusError: reason } : {};
  }

  return {
    costPrometheusUrl: redactUrl(prometheus.url),
    costPrometheus: {
      origin: prometheus.origin,
      source: prometheus.source,
      cadvisorJob: prometheus.cadvisorJob,
      ...(prometheus.cluster ? { cluster: prometheus.cluster } : {}),
      ...(prometheus.note ? { note: prometheus.note } : {}),
    },
  };
};

export const startHealthServer: (args: {
  poller: Poller;
  shipper: Shipper;
  engine?: CostEngineSource | undefined;
  metrics?: EngineMetricsSource | undefined;
  prometheus?: CostPrometheusSource | undefined;
}) => http.Server = (args: {
  poller: Poller;
  shipper: Shipper;
  engine?: CostEngineSource | undefined;
  metrics?: EngineMetricsSource | undefined;
  prometheus?: CostPrometheusSource | undefined;
}): http.Server => {
  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      if (req.url === "/livez") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "alive" }));
        return;
      }

      if (req.url === "/scrape-targets") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(args.metrics ? args.metrics.targetGroups() : []),
        );
        return;
      }

      if (req.url === "/" || req.url === "/healthz") {
        const report: HealthReport = assessHealth({
          poller: args.poller.status(),
          shipper: args.shipper.status(),
          nowMs: Date.now(),
        });
        res.writeHead(report.healthy ? 200 : 503, {
          "Content-Type": "application/json",
        });

        /*
         * Which engine the agent reads, and where its prices come from, so
         * `kubectl port-forward` to /healthz answers "which engine?".
         */
        const costEngine: KubernetesCostEngineInfo | undefined =
          args.engine && typeof args.engine.describe === "function"
            ? args.engine.describe()
            : undefined;
        const costEngineUrl: string | undefined =
          args.engine && typeof args.engine.engineUrl === "function"
            ? args.engine.engineUrl()
            : undefined;

        // Where its price metrics are scraped, or why they are not.
        const costEngineMetricsUrl: string | null = args.metrics
          ? args.metrics.url()
          : null;
        const costEngineMetricsError: string = args.metrics
          ? args.metrics.reason()
          : "";

        // Where the memory peaks are read, or why they are not (#9777).
        const prometheus: {
          costPrometheusUrl?: string;
          costPrometheus?: unknown;
          costPrometheusError?: string;
        } = describeCostPrometheus(args.prometheus);

        res.end(
          /*
           * The engine first: troubleshoot.sh reads only the start of a
           * long answer, and the reasons can run long.
           */
          JSON.stringify({
            ...(costEngineUrl ? { costEngineUrl } : {}),
            ...(costEngineMetricsUrl ? { costEngineMetricsUrl } : {}),
            ...(prometheus.costPrometheusUrl
              ? { costPrometheusUrl: prometheus.costPrometheusUrl }
              : {}),
            ...(costEngine ? { costEngine } : {}),
            ...report,
            ...(prometheus.costPrometheus
              ? { costPrometheus: prometheus.costPrometheus }
              : {}),
            ...(costEngineMetricsError ? { costEngineMetricsError } : {}),
            ...(prometheus.costPrometheusError
              ? { costPrometheusError: prometheus.costPrometheusError }
              : {}),
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    },
  );
  server.listen(HEALTH_PORT, (): void => {
    Logger.info("health server listening", { port: HEALTH_PORT });
  });
  return server;
};

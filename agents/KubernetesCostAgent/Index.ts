import * as http from "http";
import Logger from "./Logger";
import { CostEngineResolver } from "./CostEngineResolver";
import { EngineMetricsTarget, MetricsEngine } from "./EngineMetrics";
import { CostPrometheusTarget, PrometheusEngine } from "./EnginePrometheus";
import { getConfigMap, listPods, listServices } from "./KubernetesApi";
import { Poller } from "./Poller";
import { PrometheusClient } from "./PrometheusClient";
import { Shipper } from "./Shipper";
import { startHealthServer } from "./Health";
import {
  CLUSTER_NAME,
  COST_ENGINE_URL,
  COST_PROMETHEUS_BUNDLED,
  COST_PROMETHEUS_CADVISOR_JOB,
  COST_PROMETHEUS_URL,
  IS_COST_PROMETHEUS_CADVISOR_JOB_SET,
  ONEUPTIME_URL,
} from "./Config";

const main: () => Promise<void> = async (): Promise<void> => {
  Logger.info("starting kubernetes-cost-agent", {
    cluster: CLUSTER_NAME,
    oneuptimeUrl: ONEUPTIME_URL,
    costEngineUrl: COST_ENGINE_URL,
  });

  /*
   * Which engine to read: the one cost.engine.url names, the cluster's own
   * when it runs one, or the chart's bundled OpenCost (CostEngineResolver).
   */
  const engine: CostEngineResolver = CostEngineResolver.fromConfig();
  Logger.info("cost engine mode", { mode: engine.mode() });

  /*
   * Where that engine serves its price metrics (#9776), for the collector,
   * which asks for them at /scrape-targets when cost.engine.url is auto or a
   * URL.
   */
  const metrics: EngineMetricsTarget = new EngineMetricsTarget({
    engine: (): MetricsEngine | null => {
      return engine.metricsEngine();
    },
    listServices: listServices,
  });

  /*
   * Which Prometheus the memory peaks are read from (#9777): the one
   * cost.engine.prometheusUrl names, the chart's bundled one for the bundled
   * engine, or the one the cluster's own engine reads.
   */
  const prometheus: CostPrometheusTarget = new CostPrometheusTarget({
    prometheusUrl: COST_PROMETHEUS_URL,
    prometheusUrlIsBundled: COST_PROMETHEUS_BUNDLED,
    configuredJob: IS_COST_PROMETHEUS_CADVISOR_JOB_SET
      ? COST_PROMETHEUS_CADVISOR_JOB
      : null,
    engine: (): PrometheusEngine | null => {
      return engine.prometheusEngine();
    },
    kubernetes: { listServices, listPods, getConfigMap },
  });

  const shipper: Shipper = new Shipper();
  const poller: Poller = new Poller(
    engine,
    shipper,
    new PrometheusClient(prometheus),
  );
  const healthServer: http.Server = startHealthServer({
    poller,
    shipper,
    engine,
    metrics,
    prometheus,
  });

  poller.start();
  metrics.start();
  prometheus.start();

  const shutdown: (signal: string) => void = (signal: string): void => {
    Logger.info("received shutdown signal; stopping", { signal });
    poller.stop();
    metrics.stop();
    prometheus.stop();
    healthServer.close((): void => {
      process.exit(0);
    });
    // Force exit if healthServer.close hangs.
    setTimeout((): void => {
      process.exit(0);
    }, 5000).unref();
  };

  process.on("SIGTERM", (): void => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", (): void => {
    shutdown("SIGINT");
  });
  process.on("unhandledRejection", (reason: unknown): void => {
    Logger.error("unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
};

main().catch((err: unknown): void => {
  Logger.error("fatal startup error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});

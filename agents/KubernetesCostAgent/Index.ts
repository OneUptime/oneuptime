import * as http from "http";
import Logger from "./Logger";
import { CostEngineResolver } from "./CostEngineResolver";
import { EngineMetricsTarget, MetricsEngine } from "./EngineMetrics";
import { listServices } from "./KubernetesApi";
import { Poller } from "./Poller";
import { Shipper } from "./Shipper";
import { startHealthServer } from "./Health";
import { CLUSTER_NAME, COST_ENGINE_URL, ONEUPTIME_URL } from "./Config";

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

  const shipper: Shipper = new Shipper();
  const poller: Poller = new Poller(engine, shipper);
  const healthServer: http.Server = startHealthServer({
    poller,
    shipper,
    engine,
    metrics,
  });

  poller.start();
  metrics.start();

  const shutdown: (signal: string) => void = (signal: string): void => {
    Logger.info("received shutdown signal; stopping", { signal });
    poller.stop();
    metrics.stop();
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

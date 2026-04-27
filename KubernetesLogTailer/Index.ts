import * as http from "http";
import * as k8s from "@kubernetes/client-node";
import Logger from "./Logger";
import OTLPBatcher from "./OTLPBatcher";
import { PodWatcher } from "./PodWatcher";
import { startHealthServer } from "./Health";
import { CLUSTER_NAME, ONEUPTIME_URL } from "./Config";

const main: () => Promise<void> = async (): Promise<void> => {
  Logger.info("starting kubernetes-log-tailer", {
    cluster: CLUSTER_NAME,
    oneuptimeUrl: ONEUPTIME_URL,
  });

  const kubeConfig: k8s.KubeConfig = new k8s.KubeConfig();
  kubeConfig.loadFromDefault();

  const batcher: OTLPBatcher = new OTLPBatcher();
  const watcher: PodWatcher = new PodWatcher(kubeConfig, batcher);
  const healthServer: http.Server = startHealthServer({ batcher, watcher });

  await watcher.start();

  const shutdown: (signal: string) => Promise<void> = async (
    signal: string,
  ): Promise<void> => {
    Logger.info("received shutdown signal; draining", { signal });
    try {
      await watcher.stop();
      await batcher.stop();
    } catch (err: unknown) {
      Logger.error("error during shutdown", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    healthServer.close((): void => {
      process.exit(0);
    });
    // Force exit if healthServer.close hangs.
    setTimeout((): void => {
      process.exit(0);
    }, 5000).unref();
  };

  process.on("SIGTERM", (): void => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", (): void => {
    void shutdown("SIGINT");
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

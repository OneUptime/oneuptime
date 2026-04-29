import {
  PORT,
  PROBE_INGRESS_PORT,
  PROBE_MONITORING_WORKERS,
  PROBE_MONITOR_FETCH_LIMIT,
  PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
  PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS,
  PROBE_MONITOR_RETRY_LIMIT,
} from "./Config";
import AliveJob from "./Jobs/Alive";
import FetchMonitorList from "./Jobs/Monitor/FetchList";
import FetchMonitorTestList from "./Jobs/Monitor/FetchMonitorTest";
import Register from "./Services/Register";
import MetricsAPI from "./API/Metrics";
import IncomingRequestIngressAPI from "./API/IncomingRequestIngress";
import ProxyConfig from "./Utils/ProxyConfig";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Profiling from "Common/Server/Utils/Profiling";
import Express, {
  ExpressApplication,
  ExpressJson,
  ExpressRaw,
  ExpressUrlEncoded,
  createExpressApp,
} from "Common/Server/Utils/Express";
import "ejs";

const APP_NAME: string = "probe";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // Initialize proxy configuration first, before any HTTP requests
    ProxyConfig.configure();

    // Log proxy status
    if (ProxyConfig.isProxyConfigured()) {
      logger.info("Proxy configuration:");

      const httpProxy: string | null = ProxyConfig.getHttpProxyUrl();
      const httpsProxy: string | null = ProxyConfig.getHttpsProxyUrl();

      if (httpProxy) {
        logger.info(`  HTTP proxy: ${httpProxy}`);
      }

      if (httpsProxy) {
        logger.info(`  HTTPS proxy: ${httpsProxy}`);
      }
    }

    // Initialize telemetry
    Telemetry.init({
      serviceName: APP_NAME,
    });

    // Initialize profiling (opt-in via ENABLE_PROFILING env var)
    Profiling.init({
      serviceName: APP_NAME,
    });

    logger.info(
      `Probe Service - Monitoring workers: ${PROBE_MONITORING_WORKERS}, Monitor fetch limit: ${PROBE_MONITOR_FETCH_LIMIT}, Script timeout: ${PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS}ms / ${PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS}ms, Retry limit: ${PROBE_MONITOR_RETRY_LIMIT}`,
    );

    // init the app
    await App.init({
      appName: APP_NAME,
      port: PORT, // some random port to start the server. Since this is the probe, it doesn't need to be exposed.
      isFrontendApp: false,
      statusOptions: {
        liveCheck: async () => {},
        readyCheck: async () => {},
      },
    });

    // Add metrics API routes
    const app: ExpressApplication = Express.getExpressApp();
    app.use("/metrics", MetricsAPI);

    // add default routes
    await App.addDefaultRoutes();

    /*
     * Optional ingress listener for IncomingRequest (heartbeat) monitors.
     * Runs on a dedicated port so it can be exposed to a private network
     * without also exposing the probe's status/metrics endpoints.
     */
    if (PROBE_INGRESS_PORT !== null && PROBE_INGRESS_PORT.toNumber() > 0) {
      const ingressPortNumber: number = PROBE_INGRESS_PORT.toNumber();
      const ingressApp: ExpressApplication = createExpressApp();
      ingressApp.use(ExpressJson({ limit: "50mb" }));
      ingressApp.use(ExpressUrlEncoded({ extended: true, limit: "50mb" }));
      ingressApp.use(ExpressRaw({ type: "application/octet-stream" }));
      ingressApp.use(IncomingRequestIngressAPI);

      ingressApp.listen(ingressPortNumber, () => {
        logger.info(
          `Probe ingress listener started on port ${ingressPortNumber} (heartbeat / incoming-request endpoints)`,
        );
      });
    }

    try {
      // Register this probe.
      await Register.registerProbe();

      logger.debug("Probe registered");

      AliveJob();
      FetchMonitorList();
      FetchMonitorTestList();

      await Register.reportIfOffline();
    } catch (err) {
      logger.error("Register probe failed");
      logger.error(err);
      throw err;
    }
  } catch (err) {
    logger.error("App Init Failed:");
    logger.error(err);
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err);
  logger.error("Exiting node process");
  process.exit(1);
});

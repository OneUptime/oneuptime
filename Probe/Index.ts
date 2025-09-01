import {
  PORT,
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
import ProxyConfig from "./Utils/ProxyConfig";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import "ejs";

const APP_NAME: string = "probe";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // Initialize proxy configuration first, before any HTTP requests
    ProxyConfig.configure();

    // Log proxy status
    if (ProxyConfig.isProxyConfigured()) {
      logger.info("Proxy configuration:");

      const httpProxy = ProxyConfig.getHttpProxyUrl();
      const httpsProxy = ProxyConfig.getHttpsProxyUrl();

      if (httpProxy) {
        logger.info(`  HTTP proxy: ${httpProxy}`);
      }

      if (httpsProxy) {
        logger.info(`  HTTPS proxy: ${httpsProxy}`);
      }

      logger.info("Proxy will be used for all HTTP/HTTPS requests");
    }

    // Initialize telemetry
    Telemetry.init({
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

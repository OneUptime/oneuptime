import {
  HOSTNAME,
  PROBE_INGEST_URL,
  PROBE_DESCRIPTION,
  PROBE_ID,
  PROBE_KEY,
  PROBE_NAME,
} from "../Config";
import OnlineCheck from "../Utils/OnlineCheck";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ProbeStatusReport from "Common/Types/Probe/ProbeStatusReport";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import {
  HasRegisterProbeKey,
  RegisterProbeKey,
} from "Common/Server/EnvironmentConfig";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import logger from "Common/Server/Utils/Logger";
import ProxyConfig from "../Utils/ProxyConfig";

export default class Register {
  public static async isPingMonitoringEnabled(): Promise<boolean> {
    // check cache
    const pingMonitoring: string | null = LocalCache.getString(
      "PROBE",
      "PING_MONITORING",
    );

    if (pingMonitoring) {
      return pingMonitoring === "PING";
    }

    return true;
  }

  public static async reportIfOffline(): Promise<void> {
    const pingMonitoringCheck: boolean =
      await OnlineCheck.canProbeMonitorPingMonitors();
    const websiteMonitoringCheck: boolean =
      await OnlineCheck.canProbeMonitorWebsiteMonitors();
    const portMonitoringCheck: boolean =
      await OnlineCheck.canProbeMonitorPortMonitors();

    if (!pingMonitoringCheck && websiteMonitoringCheck) {
      // probe is online but ping monitoring is blocked by the cloud provider. Fallback to port monitoring.
      logger.warn(
        "Ping monitoring is disabled on this machine. Ping/ICMP checks are usually disabled by cloud providers (Azure, AWS, GCP, etc.). If you need ICMP checks, please use a different provider or use port checks.",
      );

      LocalCache.setString("PROBE", "PING_MONITORING", "PORT");
    }

    if (!pingMonitoringCheck || !websiteMonitoringCheck) {
      // Send an email to the admin.

      if (!pingMonitoringCheck) {
        logger.error("Ping monitoring is disabled");
      }

      if (!websiteMonitoringCheck) {
        logger.error("Website monitoring is disabled");
      }

      // Send an email to the admin.

      const stausReport: ProbeStatusReport = {
        isPingCheckOffline: !pingMonitoringCheck,
        isWebsiteCheckOffline: !websiteMonitoringCheck,
        isPortCheckOffline: !portMonitoringCheck,
        hostname: HOSTNAME,
      };

      const statusReportUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/probe/status-report/offline");

      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: statusReportUrl,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          statusReport: stausReport as any,
        },
        headers: {},
        options: { ...ProxyConfig.getRequestProxyAgents(statusReportUrl) },
      });
    }
  }

  public static async registerProbe(): Promise<void> {
    // register probe with 5 retry and 15 seocnd interval between each retry.

    let currentRetry: number = 0;

    const maxRetry: number = 10;

    const retryIntervalInSeconds: number = 30;

    while (currentRetry < maxRetry) {
      try {
        logger.debug(`Registering probe. Attempt: ${currentRetry + 1}`);
        await Register._registerProbe();
        logger.debug(`Probe registered successfully.`);
        break;
      } catch (error) {
        logger.error(
          `Failed to register probe. Retrying after ${retryIntervalInSeconds} seconds...`,
        );
        logger.error(error);
        currentRetry++;
        await Sleep.sleep(retryIntervalInSeconds * 1000);
      }
    }
  }

  private static async _registerProbe(): Promise<void> {
    if (HasRegisterProbeKey) {
      const probeRegistrationUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/register");

      logger.debug("Registering Probe...");
      logger.debug("Sending request to: " + probeRegistrationUrl.toString());

      const result: HTTPResponse<JSONObject> = await API.post({
        url: probeRegistrationUrl,
        data: {
          probeKey: PROBE_KEY,
          probeName: PROBE_NAME,
          probeDescription: PROBE_DESCRIPTION,
          registerProbeKey: RegisterProbeKey.toString(),
        },
        options: {
          ...ProxyConfig.getRequestProxyAgents(probeRegistrationUrl),
        },
      });

      if (result.isSuccess()) {
        logger.debug("Probe Registered");
        logger.debug(result.data);

        const probeId: string = result.data["_id"] as string;

        LocalCache.setString("PROBE", "PROBE_ID", probeId as string);
      }
    } else {
      // validate probe.
      if (!PROBE_ID) {
        logger.error("PROBE_ID or REGISTER_PROBE_KEY should be set");
        return process.exit();
      }

      const aliveUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/alive");

      await API.post({
        url: aliveUrl,
        data: {
          probeKey: PROBE_KEY.toString(),
          probeId: PROBE_ID.toString(),
        },
        options: { ...ProxyConfig.getRequestProxyAgents(aliveUrl) },
      });

      LocalCache.setString("PROBE", "PROBE_ID", PROBE_ID.toString() as string);
    }

    logger.debug(
      `Probe ID: ${LocalCache.getString("PROBE", "PROBE_ID") || "Unknown"}`,
    );
  }
}

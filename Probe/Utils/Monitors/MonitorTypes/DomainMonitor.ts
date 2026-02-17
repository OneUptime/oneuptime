import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import Sleep from "Common/Types/Sleep";
import MonitorStepDomainMonitor from "Common/Types/Monitor/MonitorStepDomainMonitor";
import DomainMonitorResponse from "Common/Types/Monitor/DomainMonitor/DomainMonitorResponse";
import whoisJson from "whois-json";

export interface DomainQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
}

export default class DomainMonitorUtil {
  public static async query(
    config: MonitorStepDomainMonitor,
    options?: DomainQueryOptions,
  ): Promise<DomainMonitorResponse | null> {
    if (!options) {
      options = {};
    }

    if (options?.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    logger.debug(
      `Domain Query: ${options?.monitorId?.toString()} ${config.domainName} - Retry: ${options?.currentRetryCount}`,
    );

    const startTime: [number, number] = process.hrtime();

    try {
      const result: any = await whoisJson(config.domainName);

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      // Parse WHOIS response
      const whoisData: any = Array.isArray(result) ? result[0] : result;

      const nameServers: Array<string> = DomainMonitorUtil.parseNameServers(
        whoisData?.nameServer || whoisData?.nameServers,
      );

      const domainStatus: Array<string> = DomainMonitorUtil.parseDomainStatus(
        whoisData?.domainStatus || whoisData?.status,
      );

      logger.debug(
        `Domain Query success: ${options?.monitorId?.toString()} ${config.domainName} - Response Time: ${responseTimeInMs}ms`,
      );

      return {
        isOnline: true,
        responseTimeInMs: responseTimeInMs,
        failureCause: "",
        domainName: config.domainName,
        registrar:
          whoisData?.registrar || whoisData?.registrarName || undefined,
        registrarUrl:
          whoisData?.registrarUrl ||
          whoisData?.registrarURL ||
          whoisData?.referralUrl ||
          undefined,
        createdDate:
          whoisData?.creationDate ||
          whoisData?.createdDate ||
          whoisData?.created ||
          undefined,
        updatedDate:
          whoisData?.updatedDate ||
          whoisData?.lastUpdated ||
          whoisData?.changed ||
          undefined,
        expiresDate:
          whoisData?.registrarRegistrationExpirationDate ||
          whoisData?.registryExpiryDate ||
          whoisData?.expirationDate ||
          whoisData?.expiresDate ||
          whoisData?.expires ||
          whoisData?.expiryDate ||
          undefined,
        nameServers: nameServers.length > 0 ? nameServers : undefined,
        dnssec: whoisData?.dnssec || whoisData?.DNSSEC || undefined,
        domainStatus: domainStatus.length > 0 ? domainStatus : undefined,
      };
    } catch (err: unknown) {
      logger.debug(
        `Domain Query error: ${options?.monitorId?.toString()} ${config.domainName}`,
      );
      logger.debug(err);

      if (!options) {
        options = {};
      }

      if (!options.currentRetryCount) {
        options.currentRetryCount = 0;
      }

      if (options.currentRetryCount < (options.retry || config.retries || 3)) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await DomainMonitorUtil.query(config, options);
      }

      // Check if the probe is online
      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `DomainMonitor - Probe is not online. Cannot query ${options?.monitorId?.toString()} ${config.domainName} - ERROR: ${err}`,
          );
          return null;
        }
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      // Check if timeout
      const isTimeout: boolean =
        (err as Error).message?.toLowerCase().includes("timeout") ||
        (err as Error).message?.toLowerCase().includes("timed out") ||
        (err as Error).message?.toLowerCase().includes("etimeout");

      if (isTimeout) {
        return {
          isOnline: false,
          isTimeout: true,
          responseTimeInMs: responseTimeInMs,
          failureCause:
            "Request was tried " +
            options.currentRetryCount +
            " times and it timed out.",
          domainName: config.domainName,
        };
      }

      return {
        isOnline: false,
        isTimeout: false,
        responseTimeInMs: responseTimeInMs,
        failureCause: (err as Error).message || (err as Error).toString(),
        domainName: config.domainName,
      };
    }
  }

  private static parseNameServers(
    value: string | Array<string> | undefined,
  ): Array<string> {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.map((ns: string) => {
        return ns.trim().toLowerCase();
      });
    }

    if (typeof value === "string") {
      return value
        .split(/[\s,]+/)
        .map((ns: string) => {
          return ns.trim().toLowerCase();
        })
        .filter((ns: string) => {
          return ns.length > 0;
        });
    }

    return [];
  }

  private static parseDomainStatus(
    value: string | Array<string> | undefined,
  ): Array<string> {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.map((status: string) => {
        return status.trim();
      });
    }

    if (typeof value === "string") {
      return value
        .split(/[\n,]+/)
        .map((status: string) => {
          return status.trim();
        })
        .filter((status: string) => {
          return status.length > 0;
        });
    }

    return [];
  }
}

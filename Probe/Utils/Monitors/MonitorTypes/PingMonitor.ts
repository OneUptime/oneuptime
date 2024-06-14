import OnlineCheck from "../../OnlineCheck";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import UnableToReachServer from "Common/Types/Exception/UnableToReachServer";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Sleep from "Common/Types/Sleep";
import logger from "CommonServer/Utils/Logger";
import ping from "ping";

// TODO - make sure it  work for the IPV6
export interface PingResponse {
  isOnline: boolean;
  responseTimeInMS?: PositiveNumber | undefined;
  failureCause: string;
}

export interface PingOptions {
  timeout?: PositiveNumber;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
}

export default class PingMonitor {
  public static async ping(
    host: Hostname | IPv4 | IPv6 | URL,
    pingOptions?: PingOptions,
  ): Promise<PingResponse | null> {
    if (!pingOptions) {
      pingOptions = {};
    }

    if (pingOptions?.currentRetryCount === undefined) {
      pingOptions.currentRetryCount = 1;
    }

    let hostAddress: string = "";
    if (host instanceof Hostname) {
      hostAddress = host.hostname;

      if (host.port) {
        throw new BadDataException("Port is not supported for ping monitor");
      }
    } else if (host instanceof URL) {
      hostAddress = host.hostname.hostname;
    } else {
      hostAddress = host.toString();
    }

    logger.debug(
      `Pinging host: ${pingOptions?.monitorId?.toString()}  ${hostAddress} - Retry: ${
        pingOptions?.currentRetryCount
      }`,
    );

    try {
      const res: ping.PingResponse = await ping.promise.probe(hostAddress, {
        timeout: Math.ceil((pingOptions?.timeout?.toNumber() || 5000) / 1000),
      });

      logger.debug(
        `Pinging host ${pingOptions?.monitorId?.toString()} ${hostAddress} success: `,
      );
      logger.debug(res);

      if (!res.alive) {
        throw new UnableToReachServer(
          `Unable to reach host ${hostAddress}. Monitor ID: ${pingOptions?.monitorId?.toString()}`,
        );
      }

      const responseTime: PositiveNumber | undefined = res.time
        ? new PositiveNumber(Math.ceil(res.time as any))
        : undefined;

      // if response time is greater than 10 seconds then give it one more try

      if (
        responseTime?.toNumber() &&
        responseTime.toNumber() > 10000 &&
        pingOptions.currentRetryCount < (pingOptions.retry || 5)
      ) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(host, pingOptions);
      }

      return {
        isOnline: res.alive,
        responseTimeInMS: responseTime,
        failureCause: "",
      };
    } catch (err: unknown) {
      logger.debug(
        `Pinging host ${pingOptions?.monitorId?.toString()} ${hostAddress} error: `,
      );
      logger.debug(err);

      if (!pingOptions) {
        pingOptions = {};
      }

      if (!pingOptions.currentRetryCount) {
        pingOptions.currentRetryCount = 0;
      }

      if (pingOptions.currentRetryCount < (pingOptions.retry || 5)) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(host, pingOptions);
      }

      // check if timeout exceeded and if yes, return null
      if (
        (err as any).toString().includes("timeout") &&
        (err as any).toString().includes("exceeded")
      ) {
        logger.debug(
          `Ping Monitor - Timeout exceeded ${pingOptions.monitorId?.toString()} ${host.toString()} - ERROR: ${err}`,
        );

        return {
          isOnline: false,
          failureCause: "Timeout exceeded",
        };
      }

      // check if the probe is online.
      if (!pingOptions.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorPingMonitors())) {
          logger.error(
            `PingMonitor Monitor - Probe is not online. Cannot ping ${pingOptions?.monitorId?.toString()} ${host.toString()} - ERROR: ${err}`,
          );
          return null;
        }
      }

      return {
        isOnline: false,
        failureCause: (err as any).toString(),
      };
    }
  }
}

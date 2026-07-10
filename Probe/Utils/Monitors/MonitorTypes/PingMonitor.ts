import OnlineCheck from "../../OnlineCheck";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import UnableToReachServer from "Common/Types/Exception/UnableToReachServer";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import ObjectID from "Common/Types/ObjectID";
import PingMonitorResponse from "Common/Types/Monitor/PingMonitor/PingMonitorResponse";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import logger from "Common/Server/Utils/Logger";
import ping from "ping";

/*
 * Echo requests sent per check. Multiple packets turn a reachability probe
 * into a measurement: packet loss %, jitter, and min/avg/max RTT.
 */
export const PING_PACKET_COUNT: number = 5;

// TODO - make sure it works for the IPV6
export interface PingResponse {
  isOnline: boolean;
  responseTimeInMS?: PositiveNumber | undefined;
  failureCause: string;
  isTimeout?: boolean | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
  pingResponse?: PingMonitorResponse | undefined;
}

export interface PingOptions {
  timeout?: PositiveNumber;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
}

export default class PingMonitor {
  /*
   * Builds packet-level statistics from the ping library result. The library
   * parses the OS ping summary into strings (min/max/avg/stddev/packetLoss,
   * "unknown" when unavailable) and collects per-packet RTTs in `times`, so
   * every stat is recomputed from `times` when the parsed value is missing.
   */
  public static getPacketStatistics(
    res: ping.PingResponse,
  ): PingMonitorResponse {
    const times: Array<number> = (res.times || []).filter((time: number) => {
      return typeof time === "number" && isFinite(time);
    });

    const parseStat: (value: string | undefined) => number | undefined = (
      value: string | undefined,
    ) => {
      const parsed: number = parseFloat(value as string);
      return isFinite(parsed) ? parsed : undefined;
    };

    const packetsReceived: number = times.length;
    const packetLossPercent: number =
      parseStat(res.packetLoss) ??
      ((PING_PACKET_COUNT - packetsReceived) / PING_PACKET_COUNT) * 100;

    const avg: number | undefined =
      parseStat(res.avg) ??
      (times.length > 0
        ? times.reduce((sum: number, time: number) => {
            return sum + time;
          }, 0) / times.length
        : undefined);

    let jitter: number | undefined = parseStat(res.stddev);

    if (jitter === undefined && times.length > 0 && avg !== undefined) {
      const variance: number =
        times.reduce((sum: number, time: number) => {
          return sum + Math.pow(time - avg, 2);
        }, 0) / times.length;
      jitter = Math.sqrt(variance);
    }

    return {
      packetsSent: PING_PACKET_COUNT,
      packetsReceived: packetsReceived,
      packetLossPercent: Math.round(packetLossPercent * 100) / 100,
      minRoundTripTimeInMs:
        parseStat(res.min) ??
        (times.length > 0 ? Math.min(...times) : undefined),
      maxRoundTripTimeInMs:
        parseStat(res.max) ??
        (times.length > 0 ? Math.max(...times) : undefined),
      avgRoundTripTimeInMs: avg,
      jitterInMs:
        jitter !== undefined ? Math.round(jitter * 100) / 100 : undefined,
    };
  }

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

    if (!pingOptions.attempts) {
      pingOptions.attempts = [];
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

    const attemptedAt: Date = new Date();
    try {
      const res: ping.PingResponse = await ping.promise.probe(hostAddress, {
        timeout: Math.ceil((pingOptions?.timeout?.toNumber() || 5000) / 1000),
        min_reply: PING_PACKET_COUNT, // maps to -c on Linux/macOS and -n on Windows
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

      const packetStatistics: PingMonitorResponse =
        this.getPacketStatistics(res);

      /*
       * Prefer the average RTT across all packets over the first packet's
       * RTT — it is the more honest single number for a multi-packet check.
       */
      const rttForResponse: number | undefined =
        packetStatistics.avgRoundTripTimeInMs ??
        (res.time !== "unknown" && res.time !== undefined
          ? (res.time as number)
          : undefined);

      const responseTime: PositiveNumber | undefined =
        rttForResponse !== undefined
          ? new PositiveNumber(Math.ceil(rttForResponse))
          : undefined;
      const responseReceivedAt: Date = new Date();

      pingOptions.attempts!.push({
        attemptNumber: pingOptions.currentRetryCount,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: responseTime?.toNumber(),
        isOnline: true,
      });

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
        probeAttempts: pingOptions.attempts,
        totalAttempts: pingOptions.attempts!.length,
        pingResponse: packetStatistics,
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

      if (!pingOptions.attempts) {
        pingOptions.attempts = [];
      }

      const responseReceivedAt: Date = new Date();
      pingOptions.attempts.push({
        attemptNumber: pingOptions.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: responseReceivedAt.getTime() - attemptedAt.getTime(),
        isOnline: false,
        failureCause: (err as any).toString(),
      });

      if (pingOptions.currentRetryCount < (pingOptions.retry || 5)) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(host, pingOptions);
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

      // check if timeout exceeded and if yes, return null
      if (
        (err as any).toString().includes("timeout") &&
        (err as any).toString().includes("exceeded")
      ) {
        logger.debug(
          `Ping Monitor - Timeout exceeded ${pingOptions.monitorId?.toString()} ${host.toString()} - ERROR: ${err}`,
        );

        return {
          isOnline: true,
          isTimeout: true,
          failureCause:
            "Request was tried " +
            pingOptions.currentRetryCount +
            " times and it timed out.",
          probeAttempts: pingOptions.attempts,
          totalAttempts: pingOptions.attempts.length,
        };
      }

      // if AggregateError is thrown, it means that the request failed
      if ((err as any).toString().includes("AggregateError")) {
        return {
          isOnline: false,
          isTimeout: false,
          failureCause:
            "Request failed with AggregateError (all connection attempts failed). " +
            (err as any).toString(),
          probeAttempts: pingOptions.attempts,
          totalAttempts: pingOptions.attempts.length,
        };
      }

      return {
        isTimeout: false,
        isOnline: false,
        failureCause: (err as any).toString(),
        probeAttempts: pingOptions.attempts,
        totalAttempts: pingOptions.attempts.length,
      };
    }
  }
}

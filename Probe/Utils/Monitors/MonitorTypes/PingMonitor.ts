import OnlineCheck from "../../OnlineCheck";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import UnableToReachServer from "Common/Types/Exception/UnableToReachServer";
import IP from "Common/Types/IP/IP";
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

/*
 * Echo requests per device-reachability check (checkReachability below).
 * Two, not five: a fleet poll runs this once per device per cycle beside
 * the SNMP walk, so the check has to be cheap — two packets are enough to
 * survive one dropped echo, which is what distinguishes "down" from "lossy".
 */
export const DEVICE_REACHABILITY_PACKET_COUNT: number = 2;

// One retry: a second full probe when the first sees no reply at all.
export const DEVICE_REACHABILITY_RETRIES: number = 1;

// Per-reply wait when the caller gives none; matches the SNMP step default.
export const DEVICE_REACHABILITY_DEFAULT_TIMEOUT_IN_MS: number = 5000;

/*
 * Substrings in ping's output that mean pinging ITSELF is broken (no ICMP
 * privileges, no binary) rather than that the host is down. The `ping`
 * library does not reject in that case — it resolves alive=false with the
 * OS error in `output` — so without this a probe container that lost
 * NET_RAW would report its whole fleet as down with no hint why. The list
 * mirrors SubnetScanner.PING_INFRA_FAILURE_MARKERS.
 */
const PING_INFRA_FAILURE_MARKERS: Array<string> = [
  "operation not permitted",
  "permission denied",
  "must be superuser",
  "lacks privilege",
  "socket:",
  "not found",
  "no such file",
  "cannot open",
];

/*
 * The verdict of one device-reachability check. Never null: the caller
 * (the network-device poll job) reports every claimed device to the server,
 * and "no verdict" would leave the device on its previous one.
 */
export interface DeviceReachabilityCheck {
  isOnline: boolean;
  avgRttMs: number | null;
  packetLossPercent: number | null;
  failureCause: string;
}

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
   *
   * `packetsSent` is how many echoes the caller asked for; it only matters
   * for the loss fallback, so ping() leaves it at its own PING_PACKET_COUNT
   * and the two-packet device check passes its own.
   */
  public static getPacketStatistics(
    res: ping.PingResponse,
    packetsSent: number = PING_PACKET_COUNT,
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
      ((packetsSent - packetsReceived) / packetsSent) * 100;

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
      packetsSent: packetsSent,
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

  /*
   * Reachability check for probe-polled network devices — the ping half of
   * the ping-first device poll (Probe/Jobs/NetworkDevice/FetchList.ts).
   *
   * Deliberately NOT a wrapper around ping() below, because ping() is built
   * for Ping MONITORS and three of its choices are wrong for a device poll:
   *
   *   - When a host fails, ping() asks OnlineCheck whether the probe itself
   *     is online and returns null if not. For a monitor, null is "no
   *     verdict" and the server keeps the previous status — correct there.
   *     For a device poll a missing verdict is a bug: the job must report
   *     every claimed device, and a device it stays silent about is left on
   *     whatever it was last recorded as. This never calls OnlineCheck and
   *     never returns null.
   *   - ping() sends five packets and retries up to five times with a
   *     one-second sleep in between. This runs once per device per cycle,
   *     in parallel with the SNMP walk, across a whole fleet: two packets
   *     and one retry keep a dead device from costing half a minute while
   *     still tolerating a single dropped echo.
   *   - ping() reports a timeout as isOnline: true ("slow, not down"). A
   *     device that answers no echo within its wait is unreachable.
   *
   * Never throws. An unroutable host, a missing ping binary, no ICMP
   * privileges — every failure comes back as isOnline false with the cause,
   * because the caller's job is to report the outcome, not recover from it.
   */
  public static async checkReachability(data: {
    host: Hostname | IPv4 | IPv6;
    timeoutMs?: number | undefined;
    packetCount?: number | undefined;
    retries?: number | undefined;
  }): Promise<DeviceReachabilityCheck> {
    const packetCount: number = Math.max(
      1,
      Math.floor(data.packetCount ?? DEVICE_REACHABILITY_PACKET_COUNT),
    );
    const retries: number = Math.max(
      0,
      Math.floor(data.retries ?? DEVICE_REACHABILITY_RETRIES),
    );
    // The ping library takes whole seconds; never let a small ms value round to 0 (= the library default).
    const timeoutInSeconds: number = Math.max(
      1,
      Math.ceil(
        (data.timeoutMs || DEVICE_REACHABILITY_DEFAULT_TIMEOUT_IN_MS) / 1000,
      ),
    );

    let hostAddress: string;
    let isIPv6Target: boolean;

    try {
      const target: { hostAddress: string; isIPv6Target: boolean } =
        this.getReachabilityTarget(data.host);
      hostAddress = target.hostAddress;
      isIPv6Target = target.isIPv6Target;
    } catch (err: unknown) {
      return {
        isOnline: false,
        avgRttMs: null,
        packetLossPercent: null,
        failureCause: (err as Error).message || String(err),
      };
    }

    const config: ping.PingConfig = this.getReachabilityPingConfig({
      isIPv6Target: isIPv6Target,
      packetCount: packetCount,
      timeoutInSeconds: timeoutInSeconds,
      platform: process.platform,
    });

    let lastFailure: DeviceReachabilityCheck = {
      isOnline: false,
      avgRttMs: null,
      packetLossPercent: null,
      failureCause: `No ICMP echo reply from ${hostAddress}`,
    };

    /*
     * No sleep between attempts: ping itself already spaces its packets a
     * second apart and holds each for the full wait, so the retry is
     * naturally several seconds after the first packet went out.
     */
    for (let attempt: number = 1; attempt <= retries + 1; attempt++) {
      try {
        /*
         * A fresh copy per attempt: the library mutates the config it is
         * handed (it fills defaults in place), so reusing one object across
         * attempts would make the second probe run on the first's residue.
         */
        const res: ping.PingResponse = await ping.promise.probe(hostAddress, {
          ...config,
        });

        const stats: PingMonitorResponse = this.getPacketStatistics(
          res,
          packetCount,
        );

        if (res.alive) {
          return {
            isOnline: true,
            avgRttMs: stats.avgRoundTripTimeInMs ?? null,
            packetLossPercent: stats.packetLossPercent,
            failureCause: "",
          };
        }

        lastFailure = {
          isOnline: false,
          avgRttMs: stats.avgRoundTripTimeInMs ?? null,
          packetLossPercent: stats.packetLossPercent,
          failureCause: this.describeDeadHost(hostAddress, packetCount, res),
        };

        logger.debug(
          `Device reachability check ${hostAddress} attempt ${attempt}/${retries + 1}: no reply (${lastFailure.failureCause})`,
        );
      } catch (err: unknown) {
        lastFailure = {
          isOnline: false,
          avgRttMs: null,
          packetLossPercent: null,
          failureCause: (err as Error).message || String(err),
        };

        logger.debug(
          `Device reachability check ${hostAddress} attempt ${attempt}/${retries + 1} failed: ${lastFailure.failureCause}`,
        );
      }
    }

    return lastFailure;
  }

  /*
   * The `ping` library config for one reachability probe. Exposed (rather
   * than inlined) so the platform quirks below can be pinned in tests for
   * every platform, not just the one the tests happen to run on.
   *
   * The deadline caps the whole ping process: the last echo goes out at
   * (packetCount - 1) seconds and may be held for the per-reply wait, so
   * that bound plus a second of slack is when a silent host stops costing
   * time. Without it a stalled resolver or a black-holed route could hold
   * the process well past the reply wait.
   */
  public static getReachabilityPingConfig(data: {
    isIPv6Target: boolean;
    packetCount: number;
    timeoutInSeconds: number;
    platform: NodeJS.Platform;
  }): ping.PingConfig {
    const config: ping.PingConfig = {
      min_reply: data.packetCount, // maps to -c on Linux/macOS and -n on Windows
      v6: data.isIPv6Target,
    };

    /*
     * macOS ping6 has neither a per-reply wait nor a deadline flag, and the
     * library throws on `timeout` rather than dropping it — which would turn
     * every IPv6 device polled from a macOS probe (a developer machine;
     * production probes run in a Linux container) into a false Down. Such a
     * probe runs on the packet count alone.
     */
    if (data.isIPv6Target && data.platform === "darwin") {
      return config;
    }

    config.timeout = data.timeoutInSeconds;

    // Windows ping has no deadline flag and the library throws on it.
    if (data.platform !== "win32") {
      config.deadline = data.timeoutInSeconds + data.packetCount;
    }

    return config;
  }

  /*
   * The address string ping gets, and whether it needs the IPv6 binary.
   * Hostname.isValid accepts an unbracketed IPv6 literal, so a Hostname can
   * carry one too; the library's own auto-detection covers that case, but
   * being explicit means the config is the same whichever type arrived.
   */
  private static getReachabilityTarget(host: Hostname | IPv4 | IPv6): {
    hostAddress: string;
    isIPv6Target: boolean;
  } {
    if (host instanceof IP) {
      return { hostAddress: host.toString(), isIPv6Target: host.isIPv6() };
    }

    const hostAddress: string = host.hostname;

    if (!hostAddress) {
      throw new BadDataException("Ping target has no hostname");
    }

    return {
      hostAddress: hostAddress,
      isIPv6Target: IP.isIP(hostAddress) && IP.fromString(hostAddress).isIPv6(),
    };
  }

  /*
   * Why an alive=false result is a failure. Usually "no reply"; when the
   * output says pinging itself is broken (see PING_INFRA_FAILURE_MARKERS),
   * that is the cause the operator needs to see on every affected device.
   */
  private static describeDeadHost(
    hostAddress: string,
    packetCount: number,
    res: ping.PingResponse,
  ): string {
    const output: string = (res.output || "").trim();
    const lowerOutput: string = output.toLowerCase();

    for (const marker of PING_INFRA_FAILURE_MARKERS) {
      if (lowerOutput.includes(marker)) {
        return `ICMP ping is not usable on this probe: ${output.substring(0, 200)}`;
      }
    }

    return `No ICMP echo reply from ${hostAddress} (${packetCount} sent)`;
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
        /*
         * The host we were ASKED to check did not answer. That is the check
         * succeeding, not the probe failing, so it must not become an Issue in
         * our own telemetry.
         *
         * asUserError() rather than the EXTERNAL_FAULT log attribute because
         * this value is THROWN: it propagates up to Monitor.probeMonitorStep's
         * broad catch, which turns it into { isOnline: false, failureCause }
         * and logs it there. Tagging the value at the leaf is what lets that
         * broad catch stay loud for everything else it sees — a TypeError from
         * our own handler code still resolves to code-fault.
         *
         * The tag is AUTHORITATIVE, so it survives the probe-check
         * unit-of-work promotion that would otherwise force it back to
         * code-fault (there is no HTTP request behind a probe check). See
         * Common/Server/Utils/Telemetry/ErrorClassResolver.ts.
         */
        throw new UnableToReachServer(
          `Unable to reach host ${hostAddress}. Monitor ID: ${pingOptions?.monitorId?.toString()}`,
        ).asUserError();
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

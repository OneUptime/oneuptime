import OnlineCheck from "../../OnlineCheck";
import MonitorRetry from "../MonitorRetry";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import UnableToReachServer from "Common/Types/Exception/UnableToReachServer";
import IP from "Common/Types/IP/IP";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import ObjectID from "Common/Types/ObjectID";
import PingMonitorResponse from "Common/Types/Monitor/PingMonitor/PingMonitorResponse";
import {
  NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT,
  NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS,
  NetworkDeviceDiagnosticPingResult,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import HostAddressUtil from "Common/Utils/HostAddressUtil";
import logger from "Common/Server/Utils/Logger";
import ping from "ping";

/*
 * `timeout: false` is how the ping library is told there is to be no
 * per-reply wait at all — see getPingConfig. @types/ping types the field as
 * `number | undefined` because it only describes the happy path, and
 * undefined means "fill in your default", which is NOT the same thing.
 */
export type PingProbeConfig = Omit<ping.PingConfig, "timeout"> & {
  timeout?: number | false | undefined;
};

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
 * Retries for ping() when the caller passes no retry option: five attempts,
 * the same as before retries were counted after the first attempt.
 */
const DEFAULT_PING_RETRIES_WHEN_UNSET: number = 4;

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
 * Substrings that mean the PROBE has no route to the address at all — the
 * kernel refused before a packet went out — rather than that the target
 * ignored the echo. The distinction is invisible in the result the library
 * returns (`alive: false` either way, with the reason only in `output`), and
 * it is the whole difference between "your BGP peer is down" and "the machine
 * this probe runs on has no IPv6".
 *
 * That second case is the common one, because a probe container on a default
 * Docker bridge has IPv4 egress and no IPv6 egress: `ping6 2001:518:2800:9::2`
 * comes straight back with "connect: Network is unreachable" while every IPv4
 * monitor beside it keeps working. Reporting that as a plain "no reply" is
 * what makes an IPv6 monitor look like it cannot be made to work.
 *
 * Deliberately NOT here: "destination host unreachable" and "destination net
 * unreachable". Those are ICMP errors a ROUTER sent back about the target,
 * which is a real outage and belongs in the no-reply case.
 */
const PING_NO_ROUTE_MARKERS: Array<string> = [
  "network is unreachable",
  "no route to host",
  "address family not supported",
  "unreachable host",
];

// Substrings that mean the name never resolved, so nothing was pinged.
const PING_NAME_RESOLUTION_MARKERS: Array<string> = [
  "name or service not known",
  "temporary failure in name resolution",
  "nodename nor servname provided",
  "unknown host",
  "cannot resolve",
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

/*
 * The result of one Ping-monitor check. IPv6 destinations go down the same
 * path: getPingTarget below strips URL brackets and states the family, and
 * getPingConfig keeps the per-platform ping6 quirks out of it.
 */
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
   *   - ping() sends five packets and, by default, tries up to five times
   *     with a one-second sleep in between. This runs once per device per cycle,
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
        this.getPingTarget(data.host);
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

    const config: PingProbeConfig = this.getReachabilityPingConfig({
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
        } as ping.PingConfig);

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
   * The `ping` library config for one probe, with every platform quirk in one
   * place. Exposed (rather than inlined) so those quirks can be pinned in
   * tests for every platform, not just the one the tests happen to run on.
   *
   * `useDeadline` caps the whole ping process: the last echo goes out at
   * (packetCount - 1) seconds and may be held for the per-reply wait, so that
   * bound plus a second of slack is when a silent host stops costing time.
   * The device-reachability poll wants that bound because it runs across a
   * fleet; the Ping MONITOR path does not set it, so that a monitor's IPv4
   * argv is exactly what it has always been.
   */
  public static getPingConfig(data: {
    isIPv6Target: boolean;
    packetCount: number;
    timeoutInSeconds: number;
    platform: NodeJS.Platform;
    useDeadline: boolean;
  }): PingProbeConfig {
    const config: PingProbeConfig = {
      min_reply: data.packetCount, // maps to -c on Linux/macOS and -n on Windows
      v6: data.isIPv6Target,
    };

    /*
     * macOS (and FreeBSD) ping6 has neither a per-reply wait nor a deadline
     * flag, and the library THROWS on `timeout` for a v6 target rather than
     * dropping it. Every IPv6 check from such a probe would otherwise die
     * instantly with "There is no timeout option on ping6" and be reported as
     * a real outage.
     *
     * `timeout: false` is what disables it. LEAVING IT OUT DOES NOT: the
     * library fills unset keys from its own defaults first
     * (lib/builder/mac.js fills timeout=2) and only then checks whether to
     * throw, so an omitted timeout lands on the throw exactly like a set one.
     * That is why this branch used to be a no-op — the config it returned
     * looked right and still threw.
     *
     * A deadline is no good either: it maps to `-t` there, which is the
     * traffic class on macOS ping6, not a deadline. The packet count is the
     * only bound such a probe gets.
     */
    if (
      data.isIPv6Target &&
      PingMonitor.isPingSixWithoutTimeout(data.platform)
    ) {
      config.timeout = false;
      return config;
    }

    config.timeout = data.timeoutInSeconds;

    // Windows ping has no deadline flag and the library throws on it.
    if (data.useDeadline && data.platform !== "win32") {
      config.deadline = data.timeoutInSeconds + data.packetCount;
    }

    return config;
  }

  /*
   * Kept as the device-poll's own entry point: a deadline is right there and
   * wrong for a monitor.
   */
  public static getReachabilityPingConfig(data: {
    isIPv6Target: boolean;
    packetCount: number;
    timeoutInSeconds: number;
    platform: NodeJS.Platform;
  }): PingProbeConfig {
    return PingMonitor.getPingConfig({ ...data, useDeadline: true });
  }

  /*
   * Platforms where the library shells out to a separate `ping6` that has no
   * -W. These are exactly the platforms its own factory treats as "macOS"
   * (lib/builder/factory.js isMacOS), because that is the builder whose
   * timeout handling throws.
   */
  private static isPingSixWithoutTimeout(platform: NodeJS.Platform): boolean {
    return platform === "darwin" || platform === "freebsd";
  }

  /*
   * The address string ping gets, and whether it needs the IPv6 binary.
   *
   * Two things have to happen here and nowhere else. A Hostname or a URL can
   * carry an IPv6 literal in its URL-authority spelling, "[2001:db8::1]", and
   * the brackets are URL syntax rather than part of the address — handed to
   * ping they become a hostname to resolve, and the check fails with
   * "unknown host" against an address that is right there in the string. And
   * the family has to be stated rather than left to the library's
   * net.isIPv6() sniff, so a bracketed literal still reaches the v6 binary.
   */
  public static getPingTarget(host: Hostname | IPv4 | IPv6 | URL): {
    hostAddress: string;
    isIPv6Target: boolean;
  } {
    let rawHost: string;

    if (host instanceof IP) {
      rawHost = host.toString();
    } else if (host instanceof URL) {
      rawHost = host.hostname.hostname;
    } else {
      rawHost = host.hostname;
    }

    const hostAddress: string = HostAddressUtil.stripBrackets(rawHost || "");

    if (!hostAddress) {
      throw new BadDataException("Ping target has no hostname");
    }

    return {
      hostAddress: hostAddress,
      isIPv6Target: HostAddressUtil.isIPv6(hostAddress),
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

    const hasMarker: (markers: Array<string>) => boolean = (
      markers: Array<string>,
    ): boolean => {
      return markers.some((marker: string) => {
        return lowerOutput.includes(marker);
      });
    };

    if (hasMarker(PING_INFRA_FAILURE_MARKERS)) {
      return `ICMP ping is not usable on this probe: ${output.substring(0, 200)}`;
    }

    if (hasMarker(PING_NO_ROUTE_MARKERS)) {
      /*
       * The probe could not even send. Say which side that is, because the
       * alternative reading — "the peer is down" — sends the operator to
       * look at a router that is answering perfectly well.
       */
      const ipv6Hint: string = HostAddressUtil.isIPv6(hostAddress)
        ? " This probe has no IPv6 route; a probe needs IPv6 connectivity to monitor an IPv6 destination."
        : "";

      return `This probe has no route to ${hostAddress}: ${output.substring(0, 200)}.${ipv6Hint}`;
    }

    if (hasMarker(PING_NAME_RESOLUTION_MARKERS)) {
      return `This probe could not resolve ${hostAddress}: ${output.substring(0, 200)}`;
    }

    return `No ICMP echo reply from ${hostAddress} (${packetCount} sent)`;
  }

  /*
   * One-shot ping for an on-demand device diagnostic (issue #3745): the
   * "Ping" button on the topology map and the device page, run by
   * Probe/Jobs/NetworkDevice/FetchDiagnostics.ts. A person is watching a
   * spinner, so this answers ONCE, promptly, with the full packet statistics.
   *
   * Not ping() below. That is the Ping-MONITOR path, and three of its
   * choices are wrong for a diagnostic: it retries up to five times with a
   * one-second sleep in between (a dead device would take most of a minute
   * to be called dead); when the host fails it asks OnlineCheck whether the
   * probe itself is online and returns null if not (for a monitor, null is
   * "no verdict, keep the previous status" — for a diagnostic it would leave
   * the dashboard waiting until its own timeout); and it reports a timeout
   * as isOnline true ("slow, not down"), which is the opposite of what the
   * person clicked the button to learn.
   *
   * Not checkReachability() above either. That is the fleet-poll check,
   * tuned to be cheap because it runs once per device per cycle: two
   * packets, one retry, and only the average RTT and the loss survive. A
   * diagnostic sends the Ping monitor's five packets and keeps the whole
   * PingMonitorResponse — min/max/jitter are exactly what somebody is
   * looking for when a device is "reachable but flaky".
   *
   * Never throws and never returns null: the job reports every claimed
   * diagnostic, and a device that answered no echo is a COMPLETED ping
   * (isOnline false, 100% loss, the statistics still attached), not a
   * failed diagnostic. pingResponse is undefined only when ping itself
   * could not run (the library threw, the target is unusable), with the
   * cause in failureCause.
   */
  public static async runDiagnosticPing(data: {
    host: Hostname | IPv4 | IPv6;
    packetCount?: number | undefined;
    timeoutMs?: number | undefined;
  }): Promise<NetworkDeviceDiagnosticPingResult> {
    /*
     * The job's numbers arrive as JSON from the server, so a missing or
     * malformed value falls back to the shared default rather than becoming
     * NaN in a shell argument.
     */
    const packetCount: number = Math.max(
      1,
      Math.floor(
        Number.isFinite(data.packetCount)
          ? (data.packetCount as number)
          : NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT,
      ),
    );
    // The ping library takes whole seconds; never let a small ms value round to 0 (= the library default).
    const timeoutInSeconds: number = Math.max(
      1,
      Math.ceil(
        (data.timeoutMs || NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS) / 1000,
      ),
    );

    let hostAddress: string;
    let isIPv6Target: boolean;

    try {
      const target: { hostAddress: string; isIPv6Target: boolean } =
        this.getPingTarget(data.host);
      hostAddress = target.hostAddress;
      isIPv6Target = target.isIPv6Target;
    } catch (err: unknown) {
      return {
        isOnline: false,
        failureCause: (err as Error).message || String(err),
        pingResponse: undefined,
      };
    }

    const config: PingProbeConfig = this.getReachabilityPingConfig({
      isIPv6Target: isIPv6Target,
      packetCount: packetCount,
      timeoutInSeconds: timeoutInSeconds,
      platform: process.platform,
    });

    try {
      // A fresh copy: the library fills defaults into the object it is handed.
      const res: ping.PingResponse = await ping.promise.probe(hostAddress, {
        ...config,
      } as ping.PingConfig);

      const stats: PingMonitorResponse = this.getPacketStatistics(
        res,
        packetCount,
      );

      logger.debug(
        `Diagnostic ping ${hostAddress}: ${res.alive ? "alive" : "no reply"} (${stats.packetsReceived}/${stats.packetsSent} received)`,
      );

      return {
        isOnline: res.alive,
        failureCause: res.alive
          ? ""
          : this.describeDeadHost(hostAddress, packetCount, res),
        pingResponse: stats,
      };
    } catch (err: unknown) {
      const failureCause: string = (err as Error).message || String(err);

      logger.debug(`Diagnostic ping ${hostAddress} failed: ${failureCause}`);

      return {
        isOnline: false,
        failureCause: failureCause,
        pingResponse: undefined,
      };
    }
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

    if (host instanceof Hostname && host.port) {
      throw new BadDataException("Port is not supported for ping monitor");
    }

    /*
     * Brackets stripped and the address family decided HERE rather than left
     * to the library's own net.isIPv6() sniff of the string, so that an IPv6
     * destination reaches the v6 binary whichever spelling it arrived in and
     * whichever of the four accepted types carried it.
     */
    const target: { hostAddress: string; isIPv6Target: boolean } =
      this.getPingTarget(host);
    const hostAddress: string = target.hostAddress;

    logger.debug(
      `Pinging host: ${pingOptions?.monitorId?.toString()}  ${hostAddress} - Retry: ${
        pingOptions?.currentRetryCount
      }`,
    );

    const attemptedAt: Date = new Date();
    try {
      const config: PingProbeConfig = this.getPingConfig({
        isIPv6Target: target.isIPv6Target,
        packetCount: PING_PACKET_COUNT, // maps to -c on Linux/macOS and -n on Windows
        timeoutInSeconds: Math.ceil(
          (pingOptions?.timeout?.toNumber() || 5000) / 1000,
        ),
        platform: process.platform,
        /*
         * No deadline: the monitor path has never set one, and the IPv4 argv
         * has to stay exactly what it has always been.
         */
        useDeadline: false,
      });

      // A fresh copy: the library fills its defaults into the object it is handed.
      const res: ping.PingResponse = await ping.promise.probe(hostAddress, {
        ...config,
      } as ping.PingConfig);

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
          `Unable to reach host ${hostAddress}. ${this.describeDeadHost(
            hostAddress,
            PING_PACKET_COUNT,
            res,
          )} Monitor ID: ${pingOptions?.monitorId?.toString()}`,
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
        MonitorRetry.canRetry({
          attemptNumber: pingOptions.currentRetryCount,
          retries: pingOptions.retry,
          defaultRetries: DEFAULT_PING_RETRIES_WHEN_UNSET,
        })
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

      if (
        MonitorRetry.canRetry({
          attemptNumber: pingOptions.currentRetryCount,
          retries: pingOptions.retry,
          defaultRetries: DEFAULT_PING_RETRIES_WHEN_UNSET,
        })
      ) {
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

import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import IP from "Common/Types/IP/IP";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import HostAddressUtil from "Common/Utils/HostAddressUtil";
import IpCanonicalUtil from "Common/Utils/IpCanonicalUtil";
import logger from "Common/Server/Utils/Logger";
import NetworkPathTrace, {
  DNSLookupResult,
  TraceRoute,
  TraceRouteHop,
} from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import dns from "dns";
import { promisify } from "util";
import { execFile } from "child_process";

const execFileAsync: (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);
const dnsResolve4: (hostname: string) => Promise<string[]> = promisify(
  dns.resolve4,
);
const dnsResolve6: (hostname: string) => Promise<string[]> = promisify(
  dns.resolve6,
);

export interface NetworkPathMonitorOptions {
  timeout?: number; // Overall timeout in milliseconds
  maxHops?: number; // Maximum number of hops for traceroute
}

export default class NetworkPathMonitor {
  /**
   * Performs a complete network path diagnosis including DNS lookup and traceroute
   */
  public static async trace(
    destination: URL | Hostname | IPv4 | IPv6 | string,
    options?: NetworkPathMonitorOptions,
  ): Promise<NetworkPathTrace> {
    const timeout: number = options?.timeout || 30000; // 30 second default timeout
    const maxHops: number = options?.maxHops || 30;

    /*
     * IP FIRST, and the BASE class at that. IPv4/IPv6 are subclasses, and a
     * monitor destination is never one of them: MonitorStep.fromJSON rebuilds
     * it with `new IP(...)`, which is an instanceof NEITHER. Every Ping/IP
     * monitor therefore fell through to the string branch and handed an
     * OBJECT to execFile and to the resolver, which rejected it with
     * ERR_INVALID_ARG_TYPE into a catch that logged and moved on — so the
     * traceroute attached to a failed check was always empty.
     *
     * Brackets come off for the same reason they do in PortMonitor: they are
     * URL syntax, and traceroute would treat "[2001:db8::1]" as a name.
     */
    let hostAddress: string = "";

    if (destination instanceof IP) {
      hostAddress = destination.toString();
    } else if (destination instanceof URL) {
      hostAddress = destination.hostname.hostname;
    } else if (destination instanceof Hostname) {
      hostAddress = destination.hostname;
    } else {
      hostAddress = String(destination ?? "");
    }

    hostAddress = HostAddressUtil.stripBrackets(hostAddress);

    const result: NetworkPathTrace = {
      timestamp: new Date(),
    };

    try {
      // Perform DNS lookup first (if it's not already an IP)
      if (!this.isIPAddress(hostAddress)) {
        result.dnsLookup = await this.performDNSLookup(hostAddress, timeout);
      }

      // Perform traceroute
      result.traceRoute = await this.performTraceroute(
        hostAddress,
        maxHops,
        timeout,
      );
    } catch (err) {
      logger.error(`NetworkPathMonitor trace error for ${hostAddress}: ${err}`);
    }

    return result;
  }

  /**
   * Checks if a string is an IP address
   *
   * Uses the project's real validator rather than a local "simplified" IPv6
   * pattern. The pattern this replaces only accepted the fully-expanded
   * eight-group form, a bare "::", and forms ENDING in a hex group, so it
   * said no to "::1", "2001:db8::" and "::ffff:192.0.2.1" — all of which are
   * addresses. Two things then went wrong at once for such a destination:
   * trace() decided it was a NAME and sent it to the resolver, and
   * isValidDestination() fell through to a hostname pattern with no ":" in
   * its character class and refused to run traceroute at all.
   */
  private static isIPAddress(address: string): boolean {
    const bare: string = HostAddressUtil.stripBrackets(address || "");

    return Boolean(bare) && IP.isIP(bare);
  }

  // True when the destination is an IPv6 literal, so it needs the v6 tooling.
  private static isIPv6Address(address: string): boolean {
    return HostAddressUtil.isIPv6(address || "");
  }

  /**
   * Validates that a destination string is a safe hostname or IP address
   */
  private static isValidDestination(destination: string): boolean {
    if (!destination || destination.length === 0 || destination.length > 253) {
      return false;
    }

    // Allow valid IP addresses
    if (this.isIPAddress(destination)) {
      return true;
    }

    // Validate as hostname: only alphanumeric, hyphens, and dots allowed
    const hostnamePattern: RegExp =
      /^[a-zA-Z0-9]([a-zA-Z0-9\-.]*[a-zA-Z0-9])?$/;
    return hostnamePattern.test(destination);
  }

  /**
   * Performs DNS lookup for a hostname
   */
  private static async performDNSLookup(
    hostname: string,
    timeout: number,
  ): Promise<DNSLookupResult> {
    const startTime: [number, number] = process.hrtime();

    const result: DNSLookupResult = {
      hostName: hostname,
      resolvedAddresses: [],
      resolvedInMS: 0,
      isSuccess: false,
      errorMessage: undefined,
    };

    try {
      const timeoutPromise: Promise<never> = new Promise(
        (
          _resolve: (value: never) => void,
          reject: (reason?: Error) => void,
        ) => {
          setTimeout(() => {
            return reject(new Error("DNS lookup timed out"));
          }, timeout);
        },
      );

      /*
       * A AND AAAA. This used to be dns.resolve(), which is resolve4 — so a
       * host that only publishes AAAA records (exactly the case somebody
       * diagnosing an IPv6 endpoint is in) came back as "resolved to
       * nothing", and the panel said the name was broken when it was fine.
       *
       * allSettled, not all: one family missing is normal, and only BOTH
       * failing means the name did not resolve. The rejection reported is
       * the A one, which is what a mixed estate expects to read.
       */
      const lookupPromise: Promise<string[]> = Promise.allSettled([
        dnsResolve4(hostname),
        dnsResolve6(hostname),
      ]).then((settled: Array<PromiseSettledResult<string[]>>) => {
        const resolved: string[] = settled.flatMap(
          (entry: PromiseSettledResult<string[]>) => {
            return entry.status === "fulfilled" ? entry.value : [];
          },
        );

        if (resolved.length === 0) {
          for (const entry of settled) {
            if (entry.status === "rejected") {
              throw entry.reason as Error;
            }
          }

          throw new Error(`No A or AAAA records for ${hostname}`);
        }

        return resolved;
      });

      const addresses: string[] = await Promise.race([
        lookupPromise,
        timeoutPromise,
      ]);

      const endTime: [number, number] = process.hrtime(startTime);
      result.resolvedInMS = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );
      result.resolvedAddresses = addresses;
      result.isSuccess = true;

      logger.debug(
        `DNS lookup for ${hostname} resolved to: ${addresses.join(", ")}`,
      );
    } catch (err) {
      const endTime: [number, number] = process.hrtime(startTime);
      result.resolvedInMS = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );
      result.isSuccess = false;
      result.errorMessage = (err as Error).message;

      logger.debug(`DNS lookup for ${hostname} failed: ${result.errorMessage}`);
    }

    return result;
  }

  /**
   * Performs traceroute to a destination
   */
  private static async performTraceroute(
    destination: string,
    maxHops: number,
    timeout: number,
  ): Promise<TraceRoute> {
    const result: TraceRoute = {
      hops: [],
      destinationAddress: destination,
      destinationHostName: undefined,
      isComplete: false,
      totalHops: 0,
      failedHop: undefined,
      failureMessage: undefined,
    };

    try {
      // Validate destination to prevent command injection
      if (!this.isValidDestination(destination)) {
        throw new Error(
          `Invalid destination: ${destination}. Must be a valid hostname or IP address.`,
        );
      }

      // Use the appropriate traceroute command based on OS
      const isMac: boolean = process.platform === "darwin";
      const isWindows: boolean = process.platform === "win32";
      const isIPv6: boolean = this.isIPv6Address(destination);

      /*
       * The IPv6 tooling is NAMED DIFFERENTLY on every platform, and picking
       * wrong does not degrade, it fails outright:
       *
       *   - macOS ships traceroute6 as a separate IPv4-only/IPv6-only pair.
       *     Plain `traceroute 2001:db8::1` there answers "unknown host", and
       *     `traceroute -6` is not even a flag it accepts.
       *   - Linux's traceroute auto-selects the family, but -6 is accepted
       *     and states the intent rather than relying on that.
       *   - Windows tracert takes -6.
       */
      let cmd: string;
      let args: string[];
      if (isWindows) {
        cmd = "tracert";
        args = [
          ...(isIPv6 ? ["-6"] : []),
          "-h",
          maxHops.toString(),
          "-w",
          (Math.ceil(timeout / 1000) * 1000).toString(),
          destination,
        ];
      } else if (isMac) {
        cmd = isIPv6 ? "traceroute6" : "traceroute";
        args = ["-m", maxHops.toString(), "-w", "3", destination];
      } else {
        // Linux
        cmd = "traceroute";
        args = [
          ...(isIPv6 ? ["-6"] : []),
          "-m",
          maxHops.toString(),
          "-w",
          "3",
          destination,
        ];
      }

      const timeoutPromise: Promise<never> = new Promise(
        (
          _resolve: (value: never) => void,
          reject: (reason?: Error) => void,
        ) => {
          setTimeout(() => {
            return reject(new Error("Traceroute timed out"));
          }, timeout);
        },
      );

      const tracePromise: Promise<{ stdout: string; stderr: string }> =
        execFileAsync(cmd, args);

      const { stdout } = await Promise.race([tracePromise, timeoutPromise]);

      result.hops = this.parseTracerouteOutput(stdout, isWindows);
      result.totalHops = result.hops.length;

      // Check if we reached the destination
      if (result.hops.length > 0) {
        const lastHop: TraceRouteHop | undefined =
          result.hops[result.hops.length - 1];
        if (lastHop && !lastHop.isTimeout) {
          /*
           * Check if the last hop matches the destination.
           *
           * Compared as ADDRESSES, not as strings: one IPv6 host has many
           * textual spellings, and traceroute prints its own. A trace that
           * asked for "2001:db8:0:0:0:0:0:1" and ended on "2001:db8::1" is
           * complete, but string equality called it incomplete and the UI
           * showed a path that never arrived. IPv4 has one spelling, so it
           * never noticed.
           */
          if (
            (lastHop.address &&
              IpCanonicalUtil.areSameIpAddress(lastHop.address, destination)) ||
            lastHop.address === destination ||
            lastHop.hostName === destination
          ) {
            result.isComplete = true;
            result.destinationHostName = lastHop.hostName;
          }
        }

        // Find the first failed hop
        for (const hop of result.hops) {
          if (hop.isTimeout) {
            result.failedHop = hop.hopNumber;
            result.failureMessage = `Hop ${hop.hopNumber} timed out`;
            break;
          }
        }
      }

      logger.debug(
        `Traceroute to ${destination} completed with ${result.totalHops} hops`,
      );
    } catch (err) {
      result.failureMessage = (err as Error).message;
      logger.debug(
        `Traceroute to ${destination} failed: ${result.failureMessage}`,
      );
    }

    return result;
  }

  /**
   * Parses traceroute output into structured hop data
   */
  private static parseTracerouteOutput(
    output: string,
    isWindows: boolean,
  ): Array<TraceRouteHop> {
    const hops: Array<TraceRouteHop> = [];
    const lines: string[] = output.split("\n");

    for (const line of lines) {
      const hop: TraceRouteHop | undefined = isWindows
        ? this.parseWindowsTracerouteLine(line)
        : this.parseUnixTracerouteLine(line);

      if (hop) {
        hops.push(hop);
      }
    }

    return hops;
  }

  /**
   * Parses a single line of Unix/macOS traceroute output
   * Format: " 1  router.local (192.168.1.1)  1.234 ms  1.567 ms  1.890 ms"
   * Or: " 2  * * *"
   */
  private static parseUnixTracerouteLine(
    line: string,
  ): TraceRouteHop | undefined {
    const trimmedLine: string = line.trim();

    // Skip empty lines and header lines
    if (
      !trimmedLine ||
      trimmedLine.startsWith("traceroute") ||
      trimmedLine.startsWith("Tracing")
    ) {
      return undefined;
    }

    // Match hop number at the beginning
    const hopMatch: RegExpMatchArray | null = trimmedLine.match(/^\s*(\d+)\s+/);
    if (!hopMatch) {
      return undefined;
    }

    const hopNumber: number = parseInt(hopMatch[1] || "0", 10);
    if (hopNumber === 0) {
      return undefined;
    }

    // Check for timeout (all asterisks)
    if (
      trimmedLine.includes("* * *") ||
      trimmedLine.match(/^\s*\d+\s+\*\s*$/)
    ) {
      return {
        hopNumber,
        address: undefined,
        hostName: undefined,
        roundTripTimeInMS: undefined,
        isTimeout: true,
      };
    }

    /*
     * Try to extract hostname and IP
     * Pattern: hostname (ip) time ms
     */
    const hostIPMatch: RegExpMatchArray | null = trimmedLine.match(
      /^\s*\d+\s+([^\s(]+)\s+\(([^)]+)\)\s+/,
    );
    // Pattern: ip time ms (no hostname)
    const ipOnlyMatch: RegExpMatchArray | null = trimmedLine.match(
      /^\s*\d+\s+([0-9.]+|[0-9a-fA-F:]+)\s+/,
    );

    /*
     * Pattern: hostname time ms, with no address in parentheses at all.
     * macOS traceroute6 prints hops this way ("1  localhost  0.263 ms"),
     * where the IPv4 traceroute beside it prints "localhost (127.0.0.1)".
     * Without this the hop matched neither pattern above and was dropped, so
     * an IPv6 path diagnosis from a macOS probe came back with zero hops and
     * nothing saying why.
     */
    const hostNameOnlyMatch: RegExpMatchArray | null = trimmedLine.match(
      /^\s*\d+\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s+/,
    );

    let hostName: string | undefined;
    let address: string | undefined;

    if (hostIPMatch) {
      hostName = hostIPMatch[1];
      address = hostIPMatch[2];
    } else if (ipOnlyMatch) {
      address = ipOnlyMatch[1];
    } else if (hostNameOnlyMatch) {
      hostName = hostNameOnlyMatch[1];
    }

    // Extract RTT (first time value)
    const rttMatch: RegExpMatchArray | null =
      trimmedLine.match(/(\d+\.?\d*)\s*ms/);
    const roundTripTimeInMS: number | undefined = rttMatch
      ? parseFloat(rttMatch[1] || "0")
      : undefined;

    if (!address && !hostName) {
      return undefined;
    }

    return {
      hopNumber,
      address,
      hostName,
      roundTripTimeInMS,
      isTimeout: false,
    };
  }

  /**
   * Parses a single line of Windows tracert output
   * Format: "  1     1 ms     1 ms     1 ms  192.168.1.1"
   * Or: "  2     *        *        *     Request timed out."
   */
  private static parseWindowsTracerouteLine(
    line: string,
  ): TraceRouteHop | undefined {
    const trimmedLine: string = line.trim();

    // Skip empty lines and header lines
    if (
      !trimmedLine ||
      trimmedLine.startsWith("Tracing") ||
      trimmedLine.includes("over a maximum")
    ) {
      return undefined;
    }

    // Match hop number at the beginning
    const hopMatch: RegExpMatchArray | null = trimmedLine.match(/^\s*(\d+)\s+/);
    if (!hopMatch) {
      return undefined;
    }

    const hopNumber: number = parseInt(hopMatch[1] || "0", 10);
    if (hopNumber === 0) {
      return undefined;
    }

    // Check for timeout
    if (
      trimmedLine.includes("Request timed out") ||
      trimmedLine.match(/\*\s+\*\s+\*/)
    ) {
      return {
        hopNumber,
        address: undefined,
        hostName: undefined,
        roundTripTimeInMS: undefined,
        isTimeout: true,
      };
    }

    // Extract RTT (first time value)
    const rttMatch: RegExpMatchArray | null = trimmedLine.match(/(\d+)\s*ms/);
    const roundTripTimeInMS: number | undefined = rttMatch
      ? parseFloat(rttMatch[1] || "0")
      : undefined;

    /*
     * Extract the destination of the hop. When tracert resolved a name it
     * prints "host.example.com [1.2.3.4]" - TWO whitespace-separated tokens,
     * so the trailing token on its own is just "[1.2.3.4]". Match the pair
     * first; falling through to the last token would store the brackets as
     * the address and lose the hostname entirely.
     */
    const hostAndAddressMatch: RegExpMatchArray | null = trimmedLine.match(
      /\s([^\s[\]]+)\s+\[([^\]\s]+)\]\s*$/,
    );

    let hostName: string | undefined;
    let finalAddress: string | undefined;

    if (hostAndAddressMatch) {
      hostName = hostAndAddressMatch[1];
      finalAddress = hostAndAddressMatch[2];
    } else {
      // tracert -d, or a hop that did not resolve: a bare address.
      const addressMatch: RegExpMatchArray | null =
        trimmedLine.match(/\s+([^\s]+)\s*$/);

      finalAddress = addressMatch ? addressMatch[1] : undefined;
    }

    if (!finalAddress) {
      return undefined;
    }

    return {
      hopNumber,
      address: finalAddress,
      hostName,
      roundTripTimeInMS,
      isTimeout: false,
    };
  }
}

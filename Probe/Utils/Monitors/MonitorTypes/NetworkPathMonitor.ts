import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import logger from "Common/Server/Utils/Logger";
import NetworkPathTrace, {
  DNSLookupResult,
  TraceRoute,
  TraceRouteHop,
} from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import dns from "dns";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync: (command: string) => Promise<{ stdout: string; stderr: string }> = promisify(exec);
const dnsResolve: (hostname: string) => Promise<string[]> = promisify(dns.resolve);

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

    let hostAddress: string = "";
    
    if (destination instanceof URL) {
      hostAddress = destination.hostname.hostname;
    } else if (destination instanceof Hostname) {
      hostAddress = destination.hostname;
    } else if (destination instanceof IPv4 || destination instanceof IPv6) {
      hostAddress = destination.toString();
    } else {
      hostAddress = destination;
    }

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
   */
  private static isIPAddress(address: string): boolean {
    // IPv4 pattern
    const ipv4Pattern: RegExp = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 pattern (simplified)
    const ipv6Pattern: RegExp = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^([0-9a-fA-F]{1,4}:)*:([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/;

    return ipv4Pattern.test(address) || ipv6Pattern.test(address);
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
      const timeoutPromise: Promise<never> = new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("DNS lookup timed out")), timeout);
      });

      const lookupPromise: Promise<string[]> = dnsResolve(hostname);

      const addresses: string[] = await Promise.race([lookupPromise, timeoutPromise]);
      
      const endTime: [number, number] = process.hrtime(startTime);
      result.resolvedInMS = Math.ceil((endTime[0] * 1000000000 + endTime[1]) / 1000000);
      result.resolvedAddresses = addresses;
      result.isSuccess = true;

      logger.debug(`DNS lookup for ${hostname} resolved to: ${addresses.join(", ")}`);
    } catch (err) {
      const endTime: [number, number] = process.hrtime(startTime);
      result.resolvedInMS = Math.ceil((endTime[0] * 1000000000 + endTime[1]) / 1000000);
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
      // Use the appropriate traceroute command based on OS
      const isMac: boolean = process.platform === "darwin";
      const isWindows: boolean = process.platform === "win32";

      let command: string;
      if (isWindows) {
        command = `tracert -h ${maxHops} -w ${Math.ceil(timeout / 1000) * 1000} ${destination}`;
      } else if (isMac) {
        command = `traceroute -m ${maxHops} -w 3 ${destination}`;
      } else {
        // Linux
        command = `traceroute -m ${maxHops} -w 3 ${destination}`;
      }

      const timeoutPromise: Promise<never> = new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("Traceroute timed out")), timeout);
      });

      const tracePromise: Promise<{ stdout: string; stderr: string }> = execAsync(command);

      const { stdout } = await Promise.race([tracePromise, timeoutPromise]);

      result.hops = this.parseTracerouteOutput(stdout, isWindows);
      result.totalHops = result.hops.length;

      // Check if we reached the destination
      if (result.hops.length > 0) {
        const lastHop: TraceRouteHop | undefined = result.hops[result.hops.length - 1];
        if (lastHop && !lastHop.isTimeout) {
          // Check if the last hop matches the destination
          if (lastHop.address === destination || lastHop.hostName === destination) {
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

      logger.debug(`Traceroute to ${destination} completed with ${result.totalHops} hops`);
    } catch (err) {
      result.failureMessage = (err as Error).message;
      logger.debug(`Traceroute to ${destination} failed: ${result.failureMessage}`);
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
  private static parseUnixTracerouteLine(line: string): TraceRouteHop | undefined {
    const trimmedLine: string = line.trim();
    
    // Skip empty lines and header lines
    if (!trimmedLine || trimmedLine.startsWith("traceroute") || trimmedLine.startsWith("Tracing")) {
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
    if (trimmedLine.includes("* * *") || trimmedLine.match(/^\s*\d+\s+\*\s*$/)) {
      return {
        hopNumber,
        address: undefined,
        hostName: undefined,
        roundTripTimeInMS: undefined,
        isTimeout: true,
      };
    }

    // Try to extract hostname and IP
    // Pattern: hostname (ip) time ms
    const hostIPMatch: RegExpMatchArray | null = trimmedLine.match(/^\s*\d+\s+([^\s(]+)\s+\(([^)]+)\)\s+/);
    // Pattern: ip time ms (no hostname)
    const ipOnlyMatch: RegExpMatchArray | null = trimmedLine.match(/^\s*\d+\s+([0-9.]+|[0-9a-fA-F:]+)\s+/);

    let hostName: string | undefined;
    let address: string | undefined;

    if (hostIPMatch) {
      hostName = hostIPMatch[1];
      address = hostIPMatch[2];
    } else if (ipOnlyMatch) {
      address = ipOnlyMatch[1];
    }

    // Extract RTT (first time value)
    const rttMatch: RegExpMatchArray | null = trimmedLine.match(/(\d+\.?\d*)\s*ms/);
    const roundTripTimeInMS: number | undefined = rttMatch ? parseFloat(rttMatch[1] || "0") : undefined;

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
  private static parseWindowsTracerouteLine(line: string): TraceRouteHop | undefined {
    const trimmedLine: string = line.trim();

    // Skip empty lines and header lines
    if (!trimmedLine || trimmedLine.startsWith("Tracing") || trimmedLine.includes("over a maximum")) {
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
    if (trimmedLine.includes("Request timed out") || trimmedLine.match(/\*\s+\*\s+\*/)) {
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
    const roundTripTimeInMS: number | undefined = rttMatch ? parseFloat(rttMatch[1] || "0") : undefined;

    // Extract IP address or hostname at the end
    const addressMatch: RegExpMatchArray | null = trimmedLine.match(/\s+([^\s]+)\s*$/);
    const address: string | undefined = addressMatch ? addressMatch[1] : undefined;

    if (!address) {
      return undefined;
    }

    // Check if it's a hostname with IP in brackets
    const hostIPMatch: RegExpMatchArray | null = address.match(/^([^\[]+)\s*\[([^\]]+)\]$/);
    let hostName: string | undefined;
    let finalAddress: string | undefined = address;

    if (hostIPMatch) {
      hostName = hostIPMatch[1];
      finalAddress = hostIPMatch[2];
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

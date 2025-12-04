/**
 * Represents a single hop in a network traceroute
 */
export interface TraceRouteHop {
  hopNumber: number;
  address: string | undefined; // IP address of the hop, undefined if the hop timed out
  hostName: string | undefined; // Hostname of the hop if DNS lookup succeeded
  roundTripTimeInMS: number | undefined; // RTT in milliseconds, undefined if timed out
  isTimeout: boolean;
}

/**
 * Represents the result of a traceroute operation
 */
export interface TraceRoute {
  hops: Array<TraceRouteHop>;
  destinationAddress: string;
  destinationHostName: string | undefined;
  isComplete: boolean; // Whether the traceroute reached the destination
  totalHops: number;
  failedHop: number | undefined; // The hop number where the route failed, if any
  failureMessage: string | undefined; // Failure message at the failed hop
}

/**
 * Represents DNS resolution information
 */
export interface DNSLookupResult {
  hostName: string;
  resolvedAddresses: Array<string>; // List of resolved IP addresses
  resolvedInMS: number; // Time taken for DNS resolution
  isSuccess: boolean;
  errorMessage: string | undefined;
}

/**
 * Complete network path diagnosis result combining DNS and traceroute
 */
export default interface NetworkPathTrace {
  dnsLookup?: DNSLookupResult | undefined;
  traceRoute?: TraceRoute | undefined;
  timestamp: Date;
}

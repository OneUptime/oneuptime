import SnmpMonitor from "../Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import { SnmpVersionUtil } from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import logger from "Common/Server/Utils/Logger";
import ping from "ping";

export interface DiscoveredHost {
  ipAddress: string;
  sysName?: string | undefined;
  sysDescr?: string | undefined;
}

export interface SubnetScanConfig {
  cidr: string;
  snmpVersion?: string | undefined;
  snmpCommunityString?: string | undefined;
  snmpV3Auth?: SnmpV3Auth | undefined;
  snmpPort?: number | undefined;
}

export interface SubnetScanResult {
  discoveredHosts: Array<DiscoveredHost>;
  scannedHostCount: number;
  /*
   * Hosts that answered the ICMP pre-sweep. undefined when the pre-sweep
   * could not run (e.g. no ping binary / ICMP privileges) and every host was
   * SNMP-probed directly, so a partial count is never reported as a real one.
   */
  respondedToPingCount?: number | undefined;
}

// Sweeping the whole subnet at once would exhaust sockets; probe in waves.
const CONCURRENCY: number = 32;
// Guard against someone entering a /8 — an IPv4 sweep that size is abuse.
const MAX_HOSTS: number = 4096;
/*
 * ICMP pre-sweep timeout. The `ping` library takes seconds (it maps this to
 * the OS ping's reply-wait flag). Kept short: this is a reachability gate,
 * not a latency measurement — SNMP's own 2s timeout per dead host is exactly
 * the cost the pre-sweep exists to avoid.
 */
const PING_TIMEOUT_IN_SECONDS: number = 1;

export default class SubnetScanner {
  public static async scan(
    config: SubnetScanConfig,
  ): Promise<SubnetScanResult> {
    /*
     * Reject oversized subnets by prefix BEFORE expanding. expandCidr()
     * materializes one string per host, so validating after expansion would
     * let a /8 allocate ~16M strings (OOM) before the limit is ever checked.
     */
    const expectedHostCount: number = SubnetScanner.countHosts(config.cidr);

    if (expectedHostCount === 0) {
      throw new Error("Invalid or empty CIDR: " + config.cidr);
    }

    if (expectedHostCount > MAX_HOSTS) {
      throw new Error(
        "CIDR " +
          config.cidr +
          " expands to " +
          expectedHostCount +
          " hosts, exceeding the " +
          MAX_HOSTS +
          "-host scan limit. Use a smaller subnet.",
      );
    }

    const hosts: Array<string> = SubnetScanner.expandCidr(config.cidr);

    if (hosts.length === 0) {
      throw new Error("Invalid or empty CIDR: " + config.cidr);
    }

    const discoveredHosts: Array<DiscoveredHost> = [];
    let cursor: number = 0;

    /*
     * ICMP pre-sweep state, shared across workers. Best-effort: the first
     * infrastructure failure (ping binary missing, ICMP socket privileges —
     * an error, not a clean "host down") flips the flag and every remaining
     * host is SNMP-probed directly, exactly as before the pre-sweep existed.
     */
    let isPingSweepAvailable: boolean = true;
    let respondedToPingCount: number = 0;

    const worker: () => Promise<void> = async (): Promise<void> => {
      while (cursor < hosts.length) {
        const host: string = hosts[cursor++]!;

        if (isPingSweepAvailable) {
          let isAliveByPing: boolean = false;

          try {
            isAliveByPing = await SubnetScanner.isHostAliveByPing(host);
          } catch (pingErr) {
            /*
             * A rejection means pinging itself failed (a dead host resolves
             * cleanly with alive=false). Disable the pre-sweep for the rest
             * of the scan and fall through to SNMP for this host too.
             */
            isPingSweepAvailable = false;
            logger.warn(
              "Discovery ICMP pre-sweep unavailable (" +
                pingErr +
                "). Falling back to SNMP-probing every host.",
            );
          }

          if (isPingSweepAvailable) {
            if (!isAliveByPing) {
              // Host did not answer ICMP — skip the 2s SNMP timeout.
              continue;
            }
            respondedToPingCount++;
          }
        }

        const snmpConfig: MonitorStepSnmpMonitor = {
          /*
           * Parse, don't cast: the stored version is the dropdown key
           * ("V1"/"V2c"/"V3") while SnmpMonitor branches on the enum value
           * ("1"/"2c"/"3"). A bare cast leaves "V3" unequal to SnmpVersion.V3,
           * so the session would silently downgrade to v2c. parse() normalizes
           * both spellings (and defaults to V2c when unset).
           */
          snmpVersion: SnmpVersionUtil.parse(config.snmpVersion),
          hostname: host,
          port: config.snmpPort || 161,
          communityString: config.snmpCommunityString || "public",
          snmpV3Auth: config.snmpV3Auth,
          oids: [],
          timeout: 2000,
          retries: 0,
        };

        try {
          const systemInfo: {
            sysDescr?: string | undefined;
            sysName?: string | undefined;
          } | null = await SnmpMonitor.probeSystemInfo(snmpConfig);

          if (systemInfo) {
            discoveredHosts.push({
              ipAddress: host,
              sysName: systemInfo.sysName,
              sysDescr: systemInfo.sysDescr,
            });
          }
        } catch (err) {
          logger.debug("Discovery probe error for " + host + ": " + err);
        }
      }
    };

    const workers: Array<Promise<void>> = [];
    for (let i: number = 0; i < Math.min(CONCURRENCY, hosts.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    discoveredHosts.sort((a: DiscoveredHost, b: DiscoveredHost) => {
      return (
        SubnetScanner.ipToLong(a.ipAddress) -
        SubnetScanner.ipToLong(b.ipAddress)
      );
    });

    return {
      discoveredHosts: discoveredHosts,
      // Full sweep size — hosts skipped by the ICMP gate still count as scanned.
      scannedHostCount: hosts.length,
      /*
       * Only meaningful when the pre-sweep ran for the whole scan. If it was
       * disabled partway through, the count covers an unknown subset of the
       * subnet, so report nothing rather than a misleading number.
       */
      respondedToPingCount: isPingSweepAvailable
        ? respondedToPingCount
        : undefined,
    };
  }

  /*
   * Substrings that mark a ping FAILURE rather than a down host. When the
   * probe lacks ICMP privileges (or the ping binary is missing) the `ping`
   * library does not reject — it resolves alive=false with the OS error in
   * `output`. If we trusted alive=false here, a privilege problem would look
   * like "every host is down" and silently skip the whole subnet. Detecting
   * these markers lets the caller fall back to SNMP-probing every host.
   */
  private static readonly PING_INFRA_FAILURE_MARKERS: Array<string> = [
    "operation not permitted",
    "permission denied",
    "must be superuser",
    "lacks privilege",
    "socket:", // "ping: socket: ..." — a socket-level (privilege) failure
    "not found", // binary missing on PATH
    "no such file",
    "cannot open",
  ];

  /*
   * One ICMP echo with a short reply-wait, via the same `ping` library the
   * Ping monitor uses (PingMonitor.ts). Resolves false for a host that is
   * simply down; throws when pinging itself is broken (no binary, missing
   * ICMP privileges) so callers can tell the two apart — the library reports
   * that case as alive=false with the error text in `output`, not a
   * rejection.
   */
  public static async isHostAliveByPing(host: string): Promise<boolean> {
    const res: ping.PingResponse = await ping.promise.probe(host, {
      timeout: PING_TIMEOUT_IN_SECONDS,
      min_reply: 1, // maps to -c on Linux/macOS and -n on Windows
    });

    if (res.alive) {
      return true;
    }

    const output: string = (res.output || "").toLowerCase();
    for (const marker of SubnetScanner.PING_INFRA_FAILURE_MARKERS) {
      if (output.includes(marker)) {
        throw new Error(`ICMP ping is not usable: ${res.output?.trim()}`);
      }
    }

    return false;
  }

  /*
   * Returns how many usable host addresses a CIDR expands to, computed from
   * the prefix alone (no allocation). Returns 0 for a malformed CIDR. Mirrors
   * expandCidr's rule: /31 and /32 count every address, larger blocks exclude
   * the network and broadcast addresses.
   */
  public static countHosts(cidr: string): number {
    const match: RegExpMatchArray | null = cidr
      .trim()
      .match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);

    if (!match) {
      return 0;
    }

    const prefix: number = parseInt(match[2]!, 10);
    if (prefix < 0 || prefix > 32) {
      return 0;
    }

    if (isNaN(SubnetScanner.ipToLong(match[1]!))) {
      return 0;
    }

    const blockSize: number = Math.pow(2, 32 - prefix);
    return blockSize <= 2 ? blockSize : blockSize - 2;
  }

  /*
   * Expands an IPv4 CIDR into its usable host addresses. For prefixes /31
   * and shorter, the network and broadcast addresses are excluded.
   */
  public static expandCidr(cidr: string): Array<string> {
    const match: RegExpMatchArray | null = cidr
      .trim()
      .match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);

    if (!match) {
      return [];
    }

    const baseIp: string = match[1]!;
    const prefix: number = parseInt(match[2]!, 10);

    if (prefix < 0 || prefix > 32) {
      return [];
    }

    const baseLong: number = SubnetScanner.ipToLong(baseIp);
    if (isNaN(baseLong)) {
      return [];
    }

    const hostBits: number = 32 - prefix;
    const blockSize: number = Math.pow(2, hostBits);
    const networkLong: number = baseLong & (0xffffffff << hostBits);

    const hosts: Array<string> = [];

    if (blockSize <= 2) {
      // /31 and /32: every address is usable.
      for (let i: number = 0; i < blockSize; i++) {
        hosts.push(SubnetScanner.longToIp(networkLong + i));
      }
      return hosts;
    }

    // Skip network (first) and broadcast (last).
    for (let i: number = 1; i < blockSize - 1; i++) {
      hosts.push(SubnetScanner.longToIp(networkLong + i));
    }
    return hosts;
  }

  private static ipToLong(ip: string): number {
    const parts: Array<string> = ip.split(".");
    if (parts.length !== 4) {
      return NaN;
    }
    let long: number = 0;
    for (const part of parts) {
      const octet: number = parseInt(part, 10);
      if (isNaN(octet) || octet < 0 || octet > 255) {
        return NaN;
      }
      long = long * 256 + octet;
    }
    return long >>> 0;
  }

  private static longToIp(long: number): string {
    return (
      ((long >>> 24) & 0xff) +
      "." +
      ((long >>> 16) & 0xff) +
      "." +
      ((long >>> 8) & 0xff) +
      "." +
      (long & 0xff)
    );
  }
}

import SnmpMonitor from "../Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import { SnmpVersionUtil } from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import logger from "Common/Server/Utils/Logger";
import ping from "ping";

export interface DiscoveredHost {
  ipAddress: string;
  sysName?: string | undefined;
  sysDescr?: string | undefined;
  /*
   * True when the host answered SNMP (sysName/sysDescr then come from its
   * system group). False for hosts that answered the ICMP pre-sweep but not
   * SNMP — recorded rather than discarded so unmanaged gear (printers,
   * cameras, POS terminals) still surfaces in discovery results.
   */
  snmpReachable: boolean;
}

export interface SubnetScanConfig {
  /*
   * The address space to sweep, in either notation ScanTargetUtil accepts:
   * CIDR ("192.168.1.0/24") or octet range ("10.16-22.0-255.51-66"). Named
   * `cidr` to match the NetworkDeviceDiscoveryScan column it is read from.
   */
  cidr: string;
  snmpVersion?: string | undefined;
  snmpCommunityString?: string | undefined;
  snmpV3Auth?: SnmpV3Auth | undefined;
  snmpPort?: number | undefined;
}

export interface SubnetScanResult {
  /*
   * Every host the sweep found alive: SNMP responders (snmpReachable true)
   * and, when the ICMP pre-sweep ran, ping-only hosts (snmpReachable
   * false). Callers reporting "answered SNMP" counts must filter.
   */
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
     * Validate syntax AND size BEFORE expanding. expandTarget() materializes
     * one string per host, so validating after expansion would let a /8
     * allocate ~16M strings (OOM) before the limit is ever checked.
     *
     * The server already rejects a bad target at write time using this same
     * validator (NetworkDeviceDiscoveryScanService), so reaching this throw
     * means the row predates that check or was written out of band. Either
     * way the message ends up on the scan as its failure reason.
     */
    const validationError: string | null = ScanTargetUtil.getValidationError(
      config.cidr,
    );

    if (validationError) {
      throw new Error(validationError);
    }

    const hosts: Array<string> = SubnetScanner.expandTarget(config.cidr);

    if (hosts.length === 0) {
      throw new Error("Scan target expands to no addresses: " + config.cidr);
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

        /*
         * Per-host, so a host confirmed alive by ICMP stays known-alive
         * even if the pre-sweep breaks for a later host on this worker.
         */
        let isAliveByPing: boolean = false;

        if (isPingSweepAvailable) {
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

        let systemInfo: {
          sysDescr?: string | undefined;
          sysName?: string | undefined;
        } | null = null;

        try {
          systemInfo = await SnmpMonitor.probeSystemInfo(snmpConfig);
        } catch (err) {
          logger.debug("Discovery probe error for " + host + ": " + err);
        }

        if (systemInfo) {
          discoveredHosts.push({
            ipAddress: host,
            sysName: systemInfo.sysName,
            sysDescr: systemInfo.sysDescr,
            snmpReachable: true,
          });
        } else if (isAliveByPing) {
          /*
           * Answered ICMP but not SNMP: a real host without (readable)
           * SNMP. Record it instead of discarding it — the scan's job is
           * to surface what is on the subnet, not only what is manageable.
           */
          discoveredHosts.push({
            ipAddress: host,
            snmpReachable: false,
          });
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
   * How many addresses a scan target expands to, computed arithmetically with
   * no allocation. Returns 0 for a malformed target. Accepts either notation:
   * CIDR ("192.168.1.0/24"), where /31 and /32 count every address and larger
   * blocks exclude the network and broadcast addresses; or an octet range
   * ("10.16-22.0-255.51-66"), where every enumerated address counts.
   */
  public static countHosts(target: string): number {
    return ScanTargetUtil.countHosts(target);
  }

  /*
   * Expands a scan target into the addresses to probe, in ascending order.
   * Empty for a malformed target. Callers must gate on countHosts() (or
   * ScanTargetUtil.getValidationError()) first — see scan() above.
   */
  public static expandTarget(target: string): Array<string> {
    return ScanTargetUtil.expand(target);
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
}

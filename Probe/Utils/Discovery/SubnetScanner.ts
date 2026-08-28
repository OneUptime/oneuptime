import SnmpMonitor from "../Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import logger from "Common/Server/Utils/Logger";
import ping from "ping";

export interface DiscoveredHost {
  ipAddress: string;
  sysName?: string | undefined;
  sysDescr?: string | undefined;
  /*
   * The rest of the SNMP system group. probeSystemInfo reads all six
   * scalars in the same single GET that fetches sysName/sysDescr, so
   * carrying them costs zero extra network traffic — and sysObjectId is
   * the vendor's registered enterprise OID, the canonical fingerprint
   * vendor-based auto-import conditions and OID-template suggestions key
   * on. All optional: ping-only hosts have none, and older scan rows
   * stored before these fields existed never carry them.
   */
  sysObjectId?: string | undefined;
  sysLocation?: string | undefined;
  sysContact?: string | undefined;
  sysUpTimeSeconds?: number | undefined;
  /*
   * True when the host answered SNMP (sysName/sysDescr then come from its
   * system group). False for hosts that answered the ICMP pre-sweep but not
   * SNMP — recorded rather than discarded so unmanaged gear (printers,
   * cameras, POS terminals) still surfaces in discovery results.
   */
  snmpReachable: boolean;
  /*
   * The id of the SNMP config that answered this host, when one did. Absent
   * for ping-only hosts, which no config found.
   *
   * A scan can carry several credential sets, so this is what lets the import
   * path build the device with the credentials that ACTUALLY work for it
   * rather than with the scan's first set — see
   * SnmpScanConfigUtil.resolveForHost. It travels to the server on the result
   * payload and is stored on the discovered-host record.
   */
  snmpConfigId?: string | undefined;
}

/*
 * One credential set the sweep tries, already parsed into the shape the SNMP
 * layer wants.
 *
 * Parsed by the CALLER (FetchScans.buildProbeSnmpConfigs) rather than here,
 * because a credential that cannot be parsed has to fail the whole scan with a
 * sentence the operator can read — not once per host inside the sweep's
 * per-host error handling, where it would report as a subnet that answered
 * nothing.
 */
export interface SubnetScanSnmpConfig {
  /*
   * Stamped onto every host this config finds, so the import path can look
   * the credentials back up. Opaque to the scanner.
   */
  id: string;
  /*
   * Short, NON-SECRET description used only in log lines and in the scan's
   * status message. Never contains a community string or a key — see
   * SnmpScanConfigUtil.getConfigLabel, which builds it.
   */
  label: string;
  snmpVersion: SnmpVersion;
  communityString: string;
  snmpV3Auth?: SnmpV3Auth | undefined;
  port: number;
}

export interface SubnetScanConfig {
  /*
   * The address space to sweep, in either notation ScanTargetUtil accepts:
   * CIDR ("192.168.1.0/24") or octet range ("10.16-22.0-255.51-66"). Named
   * `cidr` to match the NetworkDeviceDiscoveryScan column it is read from.
   */
  cidr: string;
  /*
   * The credential sets to try against each host, in the operator's declared
   * order. Never empty — SnmpScanConfigUtil.resolve() synthesizes one from a
   * legacy scan's flattened columns — and scan() refuses an empty list rather
   * than sweeping a subnet with nothing to ask it.
   */
  snmpConfigs: Array<SubnetScanSnmpConfig>;
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
   * The distinct UDP ports the sweep probed, ascending, so the summary can
   * name them. Usually one; a list when the scan's configs disagree — an
   * estate with an agent on 1161 beside the default 161 is a real shape.
   */
  scannedPorts: Array<number>;
  /*
   * How many hosts each config answered, keyed by config id. Zero-valued
   * entries are present for configs that answered nothing, because "this
   * credential found nobody" is exactly what the operator needs told.
   */
  responderCountByConfigId: Record<string, number>;
  /*
   * Hosts that answered the ICMP pre-sweep. undefined when the pre-sweep
   * could not run (e.g. no ping binary / ICMP privileges) and every host was
   * SNMP-probed directly, so a partial count is never reported as a real one.
   */
  respondedToPingCount?: number | undefined;
  /*
   * Hosts that NO config could authenticate to, and whose failure was
   * something OTHER than a timeout — an authentication failure, an unknown v3
   * user, a refused port, no route.
   *
   * A timeout is the ordinary "nothing at this address" answer and is not
   * counted; everything else is evidence the operator can act on, and used
   * to be swallowed by a debug-level log inside a sweep that then reported
   * a clean zero.
   *
   * Counted per HOST, not per attempt: with several configs a single
   * mis-credentialed device produces one failure per config, and multiplying
   * the count by the length of the credential list would make a subnet look
   * several times worse than it is.
   */
  snmpErrorHostCount: number;
  /*
   * The most frequent of those errors, verbatim, so the scan can say
   * "0 answered SNMP ... most common error: Authentication failure" instead
   * of leaving the operator to guess between a wrong credential, a blocked
   * port and an empty subnet.
   */
  mostCommonSnmpError?: string | undefined;
  /*
   * How many ICMP-silent hosts were SNMP-probed anyway because the pre-sweep
   * produced no SNMP responders at all. Non-zero means the sweep hit the
   * ICMP-filtered-subnet path described in scan().
   */
  icmpFilteredFallbackHostCount: number;
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

/*
 * How much of an SNMP error message is kept for the scan's status summary.
 * See describeSnmpError — the summary lands in a varchar(500) column, so the
 * quoted error has to leave room for the rest of the sentence.
 */
const SNMP_ERROR_EXCERPT_LENGTH: number = 120;

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

    const snmpConfigs: Array<SubnetScanSnmpConfig> = config.snmpConfigs || [];

    /*
     * Refused rather than defaulted. Sweeping with an invented credential
     * would report a subnet as empty on the strength of a guess nobody made,
     * and the caller — which resolves the list from the scan row and always
     * produces at least one entry — reaching here means the row is broken in
     * a way the operator has to see.
     */
    if (snmpConfigs.length === 0) {
      throw new Error(
        "This scan has no SNMP configuration to try. Open the scan and add at least one SNMP config.",
      );
    }

    const hosts: Array<string> = SubnetScanner.expandTarget(config.cidr);

    if (hosts.length === 0) {
      throw new Error("Scan target expands to no addresses: " + config.cidr);
    }

    /*
     * ICMP pre-sweep state. Best-effort: the first infrastructure failure
     * (ping binary missing, ICMP socket privileges — an error, not a clean
     * "host down") flips the flag and every host is SNMP-probed directly,
     * exactly as before the pre-sweep existed.
     */
    let isPingSweepAvailable: boolean = true;
    const pingAliveHosts: Set<string> = new Set<string>();

    // Phase 1 — ICMP pre-sweep across the whole target.
    await SubnetScanner.runConcurrently(
      hosts,
      async (host: string): Promise<void> => {
        if (!isPingSweepAvailable) {
          return;
        }

        try {
          if (await SubnetScanner.isHostAliveByPing(host)) {
            pingAliveHosts.add(host);
          }
        } catch (pingErr) {
          /*
           * A rejection means pinging itself failed (a dead host resolves
           * cleanly with alive=false). Disable the pre-sweep for the rest of
           * the scan; hosts already confirmed alive stay known-alive.
           */
          isPingSweepAvailable = false;
          logger.warn(
            "Discovery ICMP pre-sweep unavailable (" +
              pingErr +
              "). Falling back to SNMP-probing every host.",
          );
        }
      },
    );

    // Phase 2 — SNMP probe, plus the phase 3 fallback below.
    const discoveredHosts: Array<DiscoveredHost> = [];
    const probedHosts: Set<string> = new Set<string>();
    const snmpErrorCounts: Map<string, number> = new Map<string, number>();
    /*
     * Successes per config, doubling as the adaptive ordering's input (see
     * orderConfigsBySuccess) and as the per-config responder counts the
     * status message reports. Seeded at zero for every config so a credential
     * that found nothing is still named.
     */
    const successCountByConfigId: Map<string, number> = new Map<
      string,
      number
    >();

    for (const snmpConfig of snmpConfigs) {
      successCountByConfigId.set(snmpConfig.id, 0);
    }

    let snmpResponderCount: number = 0;
    let snmpErrorHostCount: number = 0;

    const probeHost: (host: string) => Promise<void> = async (
      host: string,
    ): Promise<void> => {
      probedHosts.add(host);

      /*
       * Try the credential sets IN SERIES and stop at the first that answers.
       *
       * Serial, not parallel, on purpose. Firing every config at once would
       * cut the latency for a silent host but would also put a failed
       * authentication attempt on the wire against every real device for
       * every credential the scan carries — which is both rude to production
       * gear and, on kit configured to lock a v3 user out after N failures,
       * actively harmful. Stopping at the first success also means a host
       * that answers costs exactly what it cost before this list existed.
       *
       * The ORDER is adaptive: whichever configs have answered most so far in
       * this sweep are tried first. On a subnet that is mostly one credential
       * — the common case even when it is mixed — that collapses the cost of
       * a badly-ordered list from N timeouts per host back to roughly one.
       */
      const orderedConfigs: Array<SubnetScanSnmpConfig> =
        SubnetScanner.orderConfigsBySuccess(
          snmpConfigs,
          successCountByConfigId,
        );

      /*
       * Distinct non-timeout errors this host produced, across all configs.
       * A Set because a device that rejects three community strings reports
       * "Authentication failure" three times and is ONE mis-credentialed
       * host, not three.
       */
      const hostErrors: Set<string> = new Set<string>();

      for (const snmpConfig of orderedConfigs) {
        const attempt: {
          systemInfo: SnmpSystemInfo | null;
          error?: string | undefined;
        } = await SubnetScanner.probeHostWithConfig(host, snmpConfig);

        if (attempt.systemInfo) {
          snmpResponderCount++;
          successCountByConfigId.set(
            snmpConfig.id,
            (successCountByConfigId.get(snmpConfig.id) || 0) + 1,
          );

          discoveredHosts.push({
            ipAddress: host,
            sysName: attempt.systemInfo.sysName,
            sysDescr: attempt.systemInfo.sysDescr,
            sysObjectId: attempt.systemInfo.sysObjectId,
            sysLocation: attempt.systemInfo.sysLocation,
            sysContact: attempt.systemInfo.sysContact,
            sysUpTimeSeconds: attempt.systemInfo.sysUpTimeSeconds,
            snmpReachable: true,
            snmpConfigId: snmpConfig.id,
          });

          return;
        }

        if (attempt.error) {
          hostErrors.add(attempt.error);
        }
      }

      // No config answered.
      if (hostErrors.size > 0) {
        snmpErrorHostCount++;

        for (const message of hostErrors) {
          snmpErrorCounts.set(message, (snmpErrorCounts.get(message) || 0) + 1);
        }
      }

      if (pingAliveHosts.has(host)) {
        /*
         * Answered ICMP but not SNMP: a real host without (readable) SNMP.
         * Record it instead of discarding it — the scan's job is to surface
         * what is on the subnet, not only what is manageable. Hosts that never
         * answered ICMP are NOT recorded: without that evidence "no SNMP
         * answer" cannot be told apart from "no host", and every dead address
         * would become a phantom endpoint.
         */
        discoveredHosts.push({
          ipAddress: host,
          snmpReachable: false,
        });
      }
    };

    const firstPassHosts: Array<string> = isPingSweepAvailable
      ? hosts.filter((host: string) => {
          return pingAliveHosts.has(host);
        })
      : hosts;

    await SubnetScanner.runConcurrently(firstPassHosts, probeHost);

    /*
     * Phase 3 — the ICMP gate must never be able to silence a subnet.
     *
     * Skipping SNMP for ICMP-silent hosts is only an optimisation, and it is
     * wrong exactly where it matters most: management VLANs behind a firewall
     * routinely drop echo while permitting UDP/161 from the NMS, and Windows
     * hosts block echo by default. On such a segment every host looks dead,
     * every SNMP probe is skipped, and the scan reports a confident "0 of 254"
     * that is indistinguishable from an empty subnet — while an adjacent VLAN
     * that happens to permit echo scans perfectly.
     *
     * So when the gated pass finds NO SNMP responder at all, re-probe the
     * hosts it skipped. The cost lands only on scans that would otherwise have
     * returned nothing, and it buys back the entire ICMP-filtered case.
     */
    let icmpFilteredFallbackHostCount: number = 0;

    if (isPingSweepAvailable && snmpResponderCount === 0) {
      const skippedHosts: Array<string> = hosts.filter((host: string) => {
        return !probedHosts.has(host);
      });

      if (skippedHosts.length > 0) {
        icmpFilteredFallbackHostCount = skippedHosts.length;
        logger.warn(
          `Discovery sweep of ${config.cidr} found no SNMP responder among the ${firstPassHosts.length} host(s) that answered ICMP. Re-probing the ${skippedHosts.length} ICMP-silent host(s) over SNMP in case ICMP is filtered on this network.`,
        );
        await SubnetScanner.runConcurrently(skippedHosts, probeHost);
      }
    }

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
      scannedPorts: SubnetScanner.getScannedPorts(snmpConfigs),
      responderCountByConfigId: Object.fromEntries(successCountByConfigId),
      /*
       * Only meaningful when the pre-sweep ran for the whole scan. If it was
       * disabled partway through, the count covers an unknown subset of the
       * subnet, so report nothing rather than a misleading number.
       */
      respondedToPingCount: isPingSweepAvailable
        ? pingAliveHosts.size
        : undefined,
      snmpErrorHostCount: snmpErrorHostCount,
      mostCommonSnmpError: SubnetScanner.getMostCommonError(snmpErrorCounts),
      icmpFilteredFallbackHostCount: icmpFilteredFallbackHostCount,
    };
  }

  /*
   * One host, one credential set. Returns the system group if the device
   * answered, or the reason it did not when that reason is worth reporting.
   *
   * Split out of probeHost so the per-config loop stays readable, and so the
   * "an error escaped as a throw rather than through the callback" case is
   * handled in exactly one place for every config.
   */
  private static async probeHostWithConfig(
    host: string,
    snmpConfig: SubnetScanSnmpConfig,
  ): Promise<{
    systemInfo: SnmpSystemInfo | null;
    error?: string | undefined;
  }> {
    const monitorConfig: MonitorStepSnmpMonitor = {
      /*
       * Already parsed by the caller: the stored version is the dropdown key
       * ("V1"/"V2c"/"V3") while SnmpMonitor branches on the enum value
       * ("1"/"2c"/"3"). A bare cast leaves "V3" unequal to SnmpVersion.V3, so
       * the session would silently downgrade to v2c.
       */
      snmpVersion: snmpConfig.snmpVersion,
      hostname: host,
      port: snmpConfig.port,
      communityString: snmpConfig.communityString,
      snmpV3Auth: snmpConfig.snmpV3Auth,
      oids: [],
      timeout: 2000,
      retries: 0,
    };

    /*
     * Anything the SNMP layer failed with that is NOT a timeout. A timeout
     * is the ordinary answer for an empty address; an auth failure, an
     * unknown v3 user, a refused port or an unreachable network is a
     * diagnosis, and reporting nothing but "0 found" for a whole subnet of
     * them is what makes this class of misconfiguration unfindable.
     *
     * Held on an object rather than in a bare `let` so the assignment made
     * inside the callback below is not erased by control-flow narrowing.
     */
    const probeFailure: { message?: string | undefined } = {};

    try {
      const systemInfo: SnmpSystemInfo | null =
        await SnmpMonitor.probeSystemInfo(
          monitorConfig,
          (probeError: unknown) => {
            probeFailure.message = SubnetScanner.describeSnmpError(probeError);
          },
        );

      if (systemInfo) {
        return { systemInfo: systemInfo };
      }
    } catch (err) {
      logger.debug(
        `Discovery probe error for ${host} with ${snmpConfig.label}: ${err}`,
      );
      probeFailure.message = SubnetScanner.describeSnmpError(err);
    }

    return { systemInfo: null, error: probeFailure.message };
  }

  /*
   * The order to try credential sets in for the NEXT host: the ones that have
   * already answered most often in this sweep first, ties broken by the
   * operator's declared order.
   *
   * Exported through the class (and unit-tested directly) because it is the
   * one piece of the multi-credential sweep whose behaviour is not obvious
   * from the call site, and because it must be a PURE function of the two
   * inputs — the sweep calls it once per host from 32 concurrent workers, and
   * anything stateful in here would make the sweep order depend on scheduling.
   *
   * It cannot change WHAT is found: every config is still tried until one
   * answers, so ordering only decides how many timeouts are paid on the way.
   * That is why a race on the success counters is harmless — a worker reading
   * a slightly stale count picks a slightly worse order, nothing more.
   */
  public static orderConfigsBySuccess(
    configs: Array<SubnetScanSnmpConfig>,
    successCountByConfigId: Map<string, number>,
  ): Array<SubnetScanSnmpConfig> {
    const declaredIndexById: Map<string, number> = new Map<string, number>();

    configs.forEach((config: SubnetScanSnmpConfig, index: number) => {
      declaredIndexById.set(config.id, index);
    });

    return [...configs].sort(
      (a: SubnetScanSnmpConfig, b: SubnetScanSnmpConfig) => {
        const successDifference: number =
          (successCountByConfigId.get(b.id) || 0) -
          (successCountByConfigId.get(a.id) || 0);

        if (successDifference !== 0) {
          return successDifference;
        }

        /*
         * Declared order, read from a map rather than relying on Array.sort
         * being stable for the ids: two configs can legitimately share a
         * label, and this keeps the tie-break defined by position.
         */
        return (
          (declaredIndexById.get(a.id) ?? 0) -
          (declaredIndexById.get(b.id) ?? 0)
        );
      },
    );
  }

  /*
   * The distinct ports the sweep touches, ascending. Distinct because the
   * common case is that every config uses 161 and the summary should say
   * "port 161", not "ports 161, 161, 161".
   */
  private static getScannedPorts(
    configs: Array<SubnetScanSnmpConfig>,
  ): Array<number> {
    const ports: Set<number> = new Set<number>();

    for (const config of configs) {
      ports.add(config.port || 161);
    }

    return [...ports].sort((a: number, b: number) => {
      return a - b;
    });
  }

  /*
   * Runs `work` over `items` with at most CONCURRENCY in flight. Sweeping a
   * whole subnet at once would exhaust sockets (and, for the ICMP pass, fork a
   * ping process per address), so probe in waves.
   */
  private static async runConcurrently(
    items: Array<string>,
    work: (item: string) => Promise<void>,
  ): Promise<void> {
    let cursor: number = 0;

    const worker: () => Promise<void> = async (): Promise<void> => {
      while (cursor < items.length) {
        await work(items[cursor++]!);
      }
    };

    const workers: Array<Promise<void>> = [];
    for (let i: number = 0; i < Math.min(CONCURRENCY, items.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }

  /*
   * Turns an SNMP probe failure into a line worth showing the operator, or
   * undefined when it carries no information.
   *
   * Timeouts are dropped: in a subnet sweep most addresses are empty and
   * answer nothing, so counting those would drown the signal. What survives —
   * "Authentication failure", "Unknown user name", "Unsupported security
   * level", EHOSTUNREACH, ECONNREFUSED — each means the probe got somewhere
   * and was turned away, which is precisely what a scan reporting zero hosts
   * needs to say.
   */
  private static describeSnmpError(error: unknown): string | undefined {
    const message: string = (
      (error as Error | undefined)?.message || String(error ?? "")
    ).trim();

    if (!message) {
      return undefined;
    }

    const lowerCased: string = message.toLowerCase();
    if (lowerCased.includes("timeout") || lowerCased.includes("timed out")) {
      return undefined;
    }

    /*
     * Bounded: this is quoted into the scan's statusMessage, which is a
     * varchar(500). The interesting part of every SNMP error ("Authentication
     * failure", "Unknown user name", "connect ECONNREFUSED 10.0.0.1:161") is
     * at the front, so a head excerpt loses nothing that matters.
     */
    return message.length > SNMP_ERROR_EXCERPT_LENGTH
      ? message.substring(0, SNMP_ERROR_EXCERPT_LENGTH)
      : message;
  }

  private static getMostCommonError(
    errorCounts: Map<string, number>,
  ): string | undefined {
    let mostCommon: string | undefined = undefined;
    let highestCount: number = 0;

    for (const [message, count] of errorCounts) {
      if (count > highestCount) {
        mostCommon = message;
        highestCount = count;
      }
    }

    return mostCommon;
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

import SnmpMonitor from "../Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import ReverseDnsResolver, { ReverseDnsResolution } from "./ReverseDnsResolver";
import logger from "Common/Server/Utils/Logger";
import ping from "ping";

export interface DiscoveredHost {
  ipAddress: string;
  sysName?: string | undefined;
  sysDescr?: string | undefined;
  /*
   * The host's reverse-DNS (PTR) name, when it has one (OneUptime issue
   * #3529).
   *
   * Resolved after the sweep, for the discovered addresses only, and always
   * best-effort: absent means the address has no PTR record, the answer was
   * not usable as a name (ReverseDnsNameUtil decides), or this probe has no
   * working resolver. Absent on every result stored before this field existed
   * and by every older probe, which is why nothing downstream may require it.
   *
   * It NAMES the host; it does not address it. The device a discovered host
   * imports as still carries the IP in `hostname`, because that is the
   * registered-host dedup key and because a name that stops resolving must
   * not stop a device being polled.
   */
  dnsHostname?: string | undefined;
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
   * for ping-only hosts and for every host of an ICMP-only sweep, which no
   * config found.
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
   * Whether to ask each live host for its SNMP system group, or stop at the
   * ping that found it (OneUptime issue #3445). Read off the scan row through
   * ScanModeUtil, so an ABSENT column reads as "yes" — the sweep this probe ran
   * before the column existed.
   *
   * Undefined here means the same thing, for callers that build a config by
   * hand: only an explicit false turns SNMP off.
   */
  isSnmpEnabled?: boolean | undefined;
  /*
   * The credential sets to try against each host, in the operator's declared
   * order, stopping at the first that answers (OneUptime issue #3458).
   *
   * Never empty for an SNMP scan — SnmpScanConfigUtil.resolve() synthesizes one
   * from a legacy scan's flattened columns — and scan() refuses an empty list
   * rather than sweeping a subnet with nothing to ask it. An ICMP-ONLY scan is
   * the one case where empty is correct and expected: it asks no host for SNMP
   * at all, so it carries no credentials.
   */
  snmpConfigs?: Array<SubnetScanSnmpConfig> | undefined;
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
   * name them. Usually one; a list when the scan's credential sets disagree —
   * an estate with an agent on 1161 beside the default 161 is a real shape.
   *
   * EMPTY on an ICMP-only sweep, which dials no port at all — naming 161 there
   * would point the operator at a firewall rule for traffic that was never
   * sent. (This replaced a single optional `scannedPort`, whose undefined said
   * the same thing.)
   */
  scannedPorts: Array<number>;
  /*
   * How many hosts each credential set answered, keyed by config id.
   * Zero-valued entries are present for sets that answered nothing, because
   * "this credential found nobody" is exactly what the operator needs told —
   * it is either wrong or aimed at gear that is not on this range, and either
   * way it costs every silent address another timeout on every run.
   *
   * Empty on an ICMP-only sweep: no credential was tried, which is a different
   * statement from "every credential found nobody".
   */
  responderCountByConfigId: Record<string, number>;
  /*
   * Hosts that answered the ICMP pre-sweep. undefined when the pre-sweep
   * could not run (e.g. no ping binary / ICMP privileges) and every host was
   * SNMP-probed directly, so a partial count is never reported as a real one.
   */
  respondedToPingCount?: number | undefined;
  /*
   * Hosts that NO credential set could authenticate to, and whose failure was
   * something OTHER than a timeout — an authentication failure, an unknown v3
   * user, a refused port, no route.
   *
   * A timeout is the ordinary "nothing at this address" answer and is not
   * counted; everything else is evidence the operator can act on, and used
   * to be swallowed by a debug-level log inside a sweep that then reported
   * a clean zero.
   *
   * Counted per HOST, not per attempt: with several credential sets a single
   * mis-credentialed device produces one failure per set, and multiplying the
   * count by the length of the list would make a subnet look several times
   * worse than it is.
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
  /*
   * True when this sweep asked no host for SNMP at all.
   *
   * Reported rather than re-derived by the caller from the config, because
   * every SNMP number above is zero in that mode for a completely different
   * reason than "the credentials were wrong", and the status message has to
   * tell those two zeroes apart.
   *
   * OPTIONAL, and absent means the SNMP sweep — the same rule the scan column
   * itself is read by (ScanModeUtil). A result built before this field existed,
   * in a test fixture or by an older code path, describes a sweep that did
   * probe SNMP, and must keep reading that way.
   */
  isIcmpOnlySweep?: boolean | undefined;
  /*
   * True when the ICMP pre-sweep broke partway through an ICMP-ONLY sweep, so
   * an unknown part of the range was never checked. The hosts reported are the
   * ones confirmed before it broke — worth keeping, but never worth presenting
   * as a complete answer.
   */
  isIcmpSweepIncomplete?: boolean | undefined;
  /*
   * How many discovered hosts came back with a usable reverse-DNS name
   * (OneUptime issue #3529).
   *
   * NOT set by scan(). The reverse-DNS pass deliberately runs OUTSIDE the
   * sweep — see attachReverseDnsHostnames and FetchScans.scanWithDeadline —
   * so this is stamped onto the result afterwards by whoever ran that pass.
   *
   * Absent therefore means "the enrichment has not run on this result", which
   * is a different statement from zero ("it ran and named nobody"). Nothing
   * branches on it; it is here so the probe log can report what the pass
   * achieved without re-walking the hosts.
   */
  reverseDnsResolvedCount?: number | undefined;
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

    const hosts: Array<string> = SubnetScanner.expandTarget(config.cidr);

    if (hosts.length === 0) {
      throw new Error("Scan target expands to no addresses: " + config.cidr);
    }

    /*
     * Only an EXPLICIT false turns SNMP off — see ScanModeUtil. A config
     * assembled without the field describes the sweep this probe ran before
     * ICMP-only scans existed, and that sweep did SNMP.
     */
    const isSnmpEnabled: boolean = config.isSnmpEnabled !== false;

    const snmpConfigs: Array<SubnetScanSnmpConfig> = config.snmpConfigs || [];

    /*
     * Refused rather than defaulted — but only for a scan that actually does
     * SNMP. Sweeping with an invented credential would report a subnet as empty
     * on the strength of a guess nobody made, and the caller (which resolves
     * the list from the scan row and always produces at least one entry for an
     * SNMP scan) reaching here means the row is broken in a way the operator
     * has to see.
     *
     * An ICMP-only scan carries no credentials BY DESIGN, so an empty list is
     * the correct input there and must not fail the sweep.
     */
    if (isSnmpEnabled && snmpConfigs.length === 0) {
      throw new Error(
        "This scan has no SNMP configuration to try. Open the scan and add at least one SNMP config, or turn Check SNMP off to run it as a ping sweep.",
      );
    }

    /*
     * ICMP pre-sweep state. Best-effort: the first infrastructure failure
     * (ping binary missing, ICMP socket privileges — an error, not a clean
     * "host down") flips the flag and every host is SNMP-probed directly,
     * exactly as before the pre-sweep existed.
     *
     * "Best-effort" holds only while SNMP is the real probe. An ICMP-only sweep
     * has nothing to fall back TO, so the flag is fatal there — see the guard
     * after phase 1.
     */
    let isPingSweepAvailable: boolean = true;
    /*
     * Why the pre-sweep stopped, kept for the operator and truncated the way
     * SNMP errors are: isHostAliveByPing throws with the OS ping's untrimmed,
     * often multi-line stderr, and this ends up quoted inside a varchar(500).
     * Only the FIRST failure is kept — they are all the same failure.
     */
    let pingFailureReason: string = "";
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
          pingFailureReason =
            pingFailureReason ||
            String(pingErr).substring(0, SNMP_ERROR_EXCERPT_LENGTH);
          logger.warn(
            "Discovery ICMP pre-sweep unavailable (" +
              pingErr +
              "). " +
              (isSnmpEnabled
                ? "Falling back to SNMP-probing every host."
                : "This scan checks ICMP only, so it has nothing to fall back to and will be reported as failed."),
          );
        }
      },
    );

    /*
     * An ICMP-only sweep ends here: the ping IS the probe, so the hosts that
     * answered it are the whole result.
     *
     * Recorded with snmpReachable FALSE rather than undefined. The flag means
     * "this host was asked for SNMP and did not answer" everywhere else, and an
     * ICMP-only host is in exactly that position from the importer's point of
     * view — it has no system group, no vendor OID and no credentials, so it
     * must import as a monitor-backed device (DiscoveryImportEligibility).
     * Undefined would read as a legacy SNMP responder and import as an
     * SNMP-polled device that could never be polled.
     */
    if (!isSnmpEnabled) {
      /*
       * No fallback exists in this mode, so an unusable ping is a failed scan
       * rather than a clean zero. Reporting "0 of 254 answered" for a probe
       * that never sent a single echo is the exact false negative the ICMP
       * pre-sweep's own privilege detection was added to prevent — it would
       * read as "this subnet is empty", and the one fact that explains it (this
       * container cannot open an ICMP socket) would live only in a probe log.
       */
      if (!isPingSweepAvailable && pingAliveHosts.size === 0) {
        throw new Error(
          "This scan checks ICMP only, but this probe could not send ICMP echo requests at all, so it has no way to find anything. " +
            "The probe needs the ping binary and the NET_RAW capability - OneUptime's own compose file and Helm chart grant both, so this usually means a hardened runtime dropped the capability, or a custom probe image left iputils-ping out. " +
            "Create the scan with Check SNMP on if this probe cannot be given ICMP. " +
            "Ping reported: " +
            (pingFailureReason || "unknown error"),
        );
      }

      const pingOnlyHosts: Array<DiscoveredHost> = hosts
        .filter((host: string) => {
          return pingAliveHosts.has(host);
        })
        .map((host: string) => {
          /*
           * Byte-identical to the ping-only record phase 2 writes below, so
           * the whole import path works unchanged: the flag is what makes
           * DiscoveryImportEligibility hand these hosts to the Monitor
           * method, and DiscoveredDeviceBuilder returns before it touches a
           * credential. Undefined would read as a legacy SNMP responder and
           * import an SNMP-polled device that could never be polled.
           */
          return {
            ipAddress: host,
            snmpReachable: false,
          };
        });

      /*
       * Already in ascending order: `hosts` comes out of expandTarget sorted
       * and this filter preserves that, unlike the SNMP path below where
       * hosts are appended in completion order and have to be sorted.
       */
      return {
        discoveredHosts: pingOnlyHosts,
        scannedHostCount: hosts.length,
        // No port was dialled, and an empty list is the only honest answer.
        scannedPorts: [],
        /*
         * Not "every credential found nobody" — no credential was TRIED. An
         * entry per config here would invite the status message to name
         * credentials this sweep never used.
         */
        responderCountByConfigId: {},
        respondedToPingCount: pingAliveHosts.size,
        snmpErrorHostCount: 0,
        mostCommonSnmpError: undefined,
        icmpFilteredFallbackHostCount: 0,
        isIcmpOnlySweep: true,
        /*
         * The pre-sweep broke, but not before confirming hosts. Those are real
         * and worth reporting; the range they came from is not complete, and
         * the status message has to say so rather than let a partial tally
         * read as the whole subnet.
         */
        isIcmpSweepIncomplete: !isPingSweepAvailable,
      };
    }

    // Phase 2 — SNMP probe, plus the phase 3 fallback below.
    const discoveredHosts: Array<DiscoveredHost> = [];
    const probedHosts: Set<string> = new Set<string>();
    const snmpErrorCounts: Map<string, number> = new Map<string, number>();
    /*
     * Successes per credential set, doubling as the adaptive ordering's input
     * (see orderConfigsBySuccess) and as the per-config responder counts the
     * status message reports. Seeded at zero for every set so a credential that
     * found nothing is still named.
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
       * Serial, not parallel, on purpose. Firing every set at once would cut
       * the latency for a silent host but would also put a failed
       * authentication attempt on the wire against every real device for every
       * credential the scan carries — which is both rude to production gear
       * and, on kit configured to lock a v3 user out after N failures, actively
       * harmful. Stopping at the first success also means a host that answers
       * costs exactly what it cost before this list existed.
       *
       * The ORDER is adaptive: whichever sets have answered most so far in this
       * sweep are tried first. On a subnet that is mostly one credential — the
       * common case even when it is mixed — that collapses the cost of a
       * badly-ordered list from N timeouts per host back to roughly one.
       */
      const orderedConfigs: Array<SubnetScanSnmpConfig> =
        SubnetScanner.orderConfigsBySuccess(
          snmpConfigs,
          successCountByConfigId,
        );

      /*
       * Distinct non-timeout errors this host produced, across all sets. A Set
       * because a device that rejects three community strings reports
       * "Authentication failure" three times and is ONE mis-credentialed host,
       * not three.
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

      // No credential set answered.
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

    /*
     * `!isSnmpEnabled` is unreachable here — the ICMP-only branch above
     * returned — and is stated anyway because of what this fallback does if it
     * ever is reached: it SNMP-probes every remaining address in the range,
     * with community "public" over v2c (probeHost defaults both). On a scan
     * that asked for no SNMP that would be an unauthenticated sweep of a
     * customer subnet, and it cannot be undone after the fact.
     */
    if (isSnmpEnabled && isPingSweepAvailable && snmpResponderCount === 0) {
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
   * handled in exactly one place for every set.
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
   * Public (and unit-tested directly) because it is the one piece of the
   * multi-credential sweep whose behaviour is not obvious from the call site,
   * and because it must be a PURE function of the two inputs — the sweep calls
   * it once per host from 32 concurrent workers, and anything stateful in here
   * would make the sweep order depend on scheduling.
   *
   * It cannot change WHAT is found: every set is still tried until one answers,
   * so ordering only decides how many timeouts are paid on the way. That is why
   * a race on the success counters is harmless — a worker reading a slightly
   * stale count picks a slightly worse order, nothing more.
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
         * being stable for the ids: two sets can legitimately share a label,
         * and this keeps the tie-break defined by position.
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
   * common case is that every set uses 161 and the summary should say
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
   * Stamps `dnsHostname` onto every host that has a usable PTR record, in
   * place, and answers how many got one (OneUptime issue #3529).
   *
   * DELIBERATELY NOT CALLED BY scan(), and that is the whole point of it
   * being a separate public method.
   *
   * The sweep runs inside a deadline race (FetchScans.scanWithDeadline): if
   * scan() has not SETTLED by PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS, the race
   * rejects and runScan reports the scan Failed with no hosts at all. An
   * enrichment inside scan() spends that same budget, so a sweep that had
   * already found forty hosts could be thrown away entirely because looking
   * up their names took the run past the line — the enrichment destroying the
   * very result it was meant to improve. The 60s cap on the pass bounds how
   * much it can add; it cannot stop that addition being the straw.
   *
   * So the lookups happen AFTER the race has settled, on a result that is
   * already final and already safe. Nothing this method does can be
   * cancelled, discarded or blamed on the sweep.
   *
   * Mutates rather than returning a new list because it is handed the exact
   * array the caller already holds, after ordering, filtering and every count
   * are decided — there is nothing left for it to disturb.
   *
   * NEVER throws. A sweep that found twelve hosts found twelve hosts whether
   * or not any of them can be named; the only visible consequence of total
   * failure is a warning in the probe log (ReverseDnsResolver) and hosts
   * named by address, which is exactly the behaviour that predates this.
   */
  public static async attachReverseDnsHostnames(
    hosts: Array<DiscoveredHost>,
  ): Promise<number> {
    if (hosts.length === 0) {
      return 0;
    }

    try {
      const resolution: ReverseDnsResolution =
        await SubnetScanner.resolveReverseDnsHostnames(
          hosts.map((host: DiscoveredHost) => {
            return host.ipAddress;
          }),
        );

      let resolvedCount: number = 0;

      for (const host of hosts) {
        const dnsHostname: string | undefined =
          resolution.hostnameByIpAddress.get(host.ipAddress);

        if (dnsHostname) {
          host.dnsHostname = dnsHostname;
          resolvedCount++;
        }
      }

      logger.debug(
        `Discovery reverse DNS named ${resolvedCount} of ${hosts.length} discovered host(s).`,
      );

      return resolvedCount;
    } catch (err) {
      /*
       * Unreachable by design — resolveHostnames swallows every per-address
       * failure itself — and caught anyway, because the ONE thing this
       * enrichment must never do is lose a completed sweep's results on the
       * way out of it.
       */
      logger.warn(
        `Discovery reverse DNS enrichment failed; discovered hosts will be named by IP address. ${err}`,
      );

      return 0;
    }
  }

  /*
   * The lookup pass, as a seam.
   *
   * Public and static for the same reason isHostAliveByPing is: it is the
   * only part of the sweep that talks to the outside world on this path, and
   * every scanner test spies on it rather than standing up a resolver. The
   * resolver's own behaviour — timeouts, the failure budget, which answers
   * are usable — is tested directly against ReverseDnsResolver.
   */
  public static async resolveReverseDnsHostnames(
    ipAddresses: Array<string>,
  ): Promise<ReverseDnsResolution> {
    return await new ReverseDnsResolver().resolveHostnames(ipAddresses);
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

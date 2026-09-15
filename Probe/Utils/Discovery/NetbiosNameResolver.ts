import {
  chooseNetbiosName,
  encodeNbstatQuery,
  NbstatResponse,
  parseNbstatResponse,
  toNbstatTransactionId,
} from "./NetbiosNbstatCodec";
import CidrMatchUtil from "Common/Utils/NetworkSite/CidrMatchUtil";
import logger from "Common/Server/Utils/Logger";
import crypto from "crypto";
import dgram from "dgram";
import net from "net";

/*
 * NetBIOS names for discovered hosts that have neither an SNMP sysName nor a
 * PTR record (OneUptime issue #3677).
 *
 * The reported symptom: "Review Discovered Devices" listing 10.18.167.31-36 as
 * bare addresses, on an estate where those machines are ordinary Windows
 * hosts with no reverse DNS and no SNMP agent. Every other naming source the
 * probe has was already exhausted for them.
 *
 * WHY NetBIOS NBSTAT, and why nothing else was built:
 *
 *   - It is unicast UDP to port 137 of the address itself, so it crosses
 *     routers. mDNS is link-local multicast (and responders may ignore
 *     off-link unicast queries), and ARP only sees the probe's own segment.
 *   - It needs no capability. The query goes out from an ephemeral port, so
 *     the probe's `cap_drop: ALL` container (no NET_BIND_SERVICE) and its
 *     Kubernetes pod network — no hostNetwork — are both fine. mDNS
 *     multicast and ARP would work on neither.
 *
 * WHY it is opt-in, private-only and never run by a global probe: it sends a
 * datagram to UDP 137 of every host that gets this far, and NBSTAT sweeps are
 * a classic reconnaissance signature that IDS rules on PCI networks flag. An
 * operator has to ask for it per scan (NetworkDeviceDiscoveryScan
 * .isNetbiosLookupEnabled), FetchScans refuses it on a probe holding a
 * REGISTER_PROBE_KEY, and THIS file refuses every address outside the private
 * and CGNAT ranges no matter who asked — see isNetbiosQueryAddressAllowed.
 *
 * Only hosts still unnamed after SNMP and reverse DNS are ever passed in
 * (SubnetScanner.attachNetbiosNames), so on an estate with working DNS this
 * sends nothing at all.
 */

// RFC 1002: the NetBIOS name service port, where NBSTAT requests are answered.
export const NETBIOS_NAME_SERVICE_PORT: number = 137;

/*
 * How long to keep listening after the LAST query of a pass. A NetBIOS stack
 * that is going to answer answers in milliseconds; this is generous enough for
 * a congested WAN link and short enough that a subnet of silent hosts costs
 * seconds, not minutes.
 */
export const DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS: number = 1500;

/*
 * Spacing between queries: about 100 per second. Firing two thousand datagrams
 * at once would overrun the kernel's socket buffers on the way out, drop
 * replies on the way back, and look exactly like the burst an IDS is tuned
 * to catch. Paced, the same two thousand take twenty seconds.
 */
export const DEFAULT_NETBIOS_SEND_INTERVAL_IN_MS: number = 10;

/*
 * Wall-clock ceiling on the whole lookup, retries included.
 *
 * This runs after the sweep has already won its deadline race, and nothing
 * bounds it but itself (see FetchScans.scanWithDeadline). The scan's
 * scheduler slot stays occupied and its final upload waits until it returns,
 * so a name — a nicety — must never be what keeps a finished scan In
 * Progress. Half a minute is enough for one paced pass over the host cap plus
 * the listening window.
 */
export const DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS: number = 30 * 1000;

/*
 * Hosts asked per scan. Beyond this the lookup cannot finish one pass inside
 * the budget at the default pacing anyway, and the operator is told in the
 * probe log how many were left out rather than having them silently truncated
 * by the budget in address order.
 */
export const DEFAULT_NETBIOS_MAX_HOSTS: number = 2000;

/*
 * One retry pass, for the hosts that did not answer the first. UDP is lossy
 * and a single dropped datagram in either direction would otherwise leave a
 * perfectly answerable host named by address. More than one retry buys very
 * little against a host that is simply not running NetBIOS.
 */
export const DEFAULT_NETBIOS_RETRY_PASSES: number = 1;

/*
 * Receive buffer asked of the kernel. Two thousand replies of up to ~600
 * bytes can arrive faster than the event loop drains them while it is busy
 * with the sweep's upload; the default buffer on Linux is a few hundred KiB.
 * Best-effort: a kernel that refuses it keeps its default and the lookup
 * carries on.
 */
export const NETBIOS_RECEIVE_BUFFER_SIZE_IN_BYTES: number = 1024 * 1024;

/*
 * The only address space a NetBIOS query may ever be sent to:
 *
 *   10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16  RFC 1918 private space
 *   100.64.0.0/10                               RFC 6598 shared/CGNAT space,
 *                                               common on carrier-routed and
 *                                               overlay estates
 *
 * Deliberately NOT here, and refused even though an operator's scan target can
 * cover them:
 *
 *   - Public addresses. Sending NBSTAT to the internet is reconnaissance of
 *     somebody else's network, whatever the scan target says.
 *   - 127.0.0.0/8 loopback. Nothing on the probe's own host is a discovered
 *     device worth naming, and a local port-137 listener is not ours to poke.
 *   - 169.254.0.0/16 link-local, which holds the cloud metadata endpoint. The
 *     probe's own SSRF tiers forbid it in every deployment
 *     (Common/Server/Utils/SSRFProtection.ts) and this stays consistent.
 */
export const NETBIOS_QUERY_ALLOWED_RANGES: ReadonlyArray<string> = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

/**
 * True when a NetBIOS query may be sent to this address: a canonical IPv4
 * literal inside one of NETBIOS_QUERY_ALLOWED_RANGES.
 *
 * Pure, exported and applied inside the resolver rather than by its caller,
 * so the guarantee does not depend on every future caller remembering it.
 * `net.isIPv4` is checked first because it refuses the forms a looser parser
 * would accept (leading zeros, surrounding whitespace, IPv6-mapped v4); an
 * address that is not in the exact form the sweep reports is not one this
 * probe discovered.
 */
export function isNetbiosQueryAddressAllowed(ipAddress: unknown): boolean {
  if (typeof ipAddress !== "string" || !net.isIPv4(ipAddress)) {
    return false;
  }

  return NETBIOS_QUERY_ALLOWED_RANGES.some((cidr: string) => {
    return CidrMatchUtil.ipInCidr(ipAddress, cidr);
  });
}

export interface NetbiosRemoteInfo {
  address: string;
  port: number;
}

/*
 * The slice of dgram.Socket this file uses, so the tests can hand in an
 * EventEmitter and never open a real socket. `setRecvBufferSize` is optional
 * because it is best-effort anyway.
 */
export interface DgramSocketLike {
  on(
    event: "message",
    listener: (message: Buffer, remote: NetbiosRemoteInfo) => void,
  ): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  bind(port: number, callback: () => void): unknown;
  send(
    message: Buffer,
    port: number,
    address: string,
    callback: (error: Error | null) => void,
  ): void;
  close(): unknown;
  setRecvBufferSize?(size: number): void;
}

export type NetbiosSocketFactory = () => DgramSocketLike;
export type NetbiosSleepFunction = (durationInMs: number) => Promise<void>;
export type NetbiosNowFunction = () => number;
export type NetbiosAddressPolicy = (ipAddress: string) => boolean;

const defaultSocketFactory: NetbiosSocketFactory = (): DgramSocketLike => {
  return dgram.createSocket("udp4");
};

/*
 * Unref'd so a listening window that ends early — every host answered — does
 * not leave a timer holding the probe's event loop open for the rest of it.
 * The socket itself keeps the loop alive for as long as the lookup needs it.
 */
const defaultSleep: NetbiosSleepFunction = (
  durationInMs: number,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      resolve,
      Math.max(0, durationInMs),
    );
    timer.unref?.();
  });
};

/*
 * Unpredictable on purpose. A reply is accepted only from the queried address
 * and port with a matching id, and an off-path host trying to plant a name
 * would have to guess both this and the ephemeral source port.
 */
const defaultTransactionId: () => number = (): number => {
  return crypto.randomInt(0, 0x10000);
};

export interface NetbiosNameResolution {
  /*
   * Names keyed by the address asked, already normalised and lower-cased.
   * Addresses with no usable name are ABSENT, never mapped to undefined.
   */
  nameByIpAddress: Map<string, string>;
  // Distinct addresses at least one query was handed to the socket for.
  queriedCount: number;
  /*
   * Distinct addresses never queried, for any reason: not an allowed private
   * IPv4 address, over the host cap, or not reached before the budget ran
   * out or the socket failed. queriedCount + skippedCount is the number of
   * distinct inputs.
   */
  skippedCount: number;
  /*
   * True when the wall-clock budget ended the lookup while hosts were still
   * waiting to be asked or to answer. The names found before it did are real
   * and are returned.
   */
  isTimeBudgetExhausted: boolean;
  // True when more eligible addresses were passed in than maxHosts allows.
  isHostCapReached: boolean;
  /*
   * Why the socket could not be used — it could not be created or bound, or
   * it emitted 'error' mid-lookup. Undefined on a lookup whose socket worked,
   * however few hosts answered: silence from a host is the ordinary outcome,
   * not a failure. A single host's failed send is not reported here either;
   * it closes out that host only.
   */
  failureReason?: string | undefined;
}

// Long enough to name the failure, short enough for one log line.
const FAILURE_REASON_EXCERPT_LENGTH: number = 200;

function describeError(error: unknown): string {
  const message: string = (
    (error as Error | undefined)?.message || String(error ?? "")
  ).trim();

  const described: string = message || "unknown socket error";

  return described.length > FAILURE_REASON_EXCERPT_LENGTH
    ? described.substring(0, FAILURE_REASON_EXCERPT_LENGTH)
    : described;
}

interface HostQueryState {
  ipAddress: string;
  /*
   * ONE id per host, reused by its retry. A reply to the first pass that
   * arrives during the second is still a correct answer to the same question,
   * and accepting it saves the host a second datagram.
   */
  transactionId: number;
  query: Buffer;
  hasQueried: boolean;
  // A matched, parseable NBSTAT reply arrived, whether or not it held a name.
  hasResponded: boolean;
  hasSendFailed: boolean;
}

/*
 * Mutable state shared between the send loop and the socket's listeners. Held
 * on one object rather than in bare `let`s because it is written from event
 * callbacks, where control-flow narrowing on a local would hide the writes.
 */
interface LookupRun {
  hostStates: Map<string, HostQueryState>;
  // Hosts neither answered nor closed out by a failed send.
  outstandingCount: number;
  socketError?: Error | undefined;
  isBound: boolean;
  // Set once resolveNames has returned; late events are then ignored.
  isFinished: boolean;
  // Ends the current wait early, when there is one.
  wake?: (() => void) | undefined;
  sendFailureCount: number;
  firstSendFailure?: string | undefined;
}

export default class NetbiosNameResolver {
  private createSocket: NetbiosSocketFactory;
  private port: number;
  private perHostTimeoutInMs: number;
  private sendIntervalInMs: number;
  private totalBudgetInMs: number;
  private maxHosts: number;
  private retryPasses: number;
  private now: NetbiosNowFunction;
  private sleep: NetbiosSleepFunction;
  private randomTransactionId: () => number;
  private isAddressAllowed: NetbiosAddressPolicy;

  public constructor(options?: {
    createSocket?: NetbiosSocketFactory | undefined;
    // The port queries go to and replies must come from. 137 in production.
    port?: number | undefined;
    perHostTimeoutInMs?: number | undefined;
    sendIntervalInMs?: number | undefined;
    totalBudgetInMs?: number | undefined;
    maxHosts?: number | undefined;
    retryPasses?: number | undefined;
    // Injectable so budgets and pacing are testable without waiting on them.
    now?: NetbiosNowFunction | undefined;
    sleep?: NetbiosSleepFunction | undefined;
    randomTransactionId?: (() => number) | undefined;
    /*
     * Injectable ONLY so a single end-to-end test can talk to a responder on
     * 127.0.0.1, which the real policy refuses. Production code never passes
     * it; the default is isNetbiosQueryAddressAllowed.
     */
    isAddressAllowed?: NetbiosAddressPolicy | undefined;
  }) {
    this.createSocket = options?.createSocket ?? defaultSocketFactory;
    this.port = options?.port ?? NETBIOS_NAME_SERVICE_PORT;
    this.perHostTimeoutInMs = Math.max(
      0,
      options?.perHostTimeoutInMs ?? DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS,
    );
    this.sendIntervalInMs = Math.max(
      0,
      options?.sendIntervalInMs ?? DEFAULT_NETBIOS_SEND_INTERVAL_IN_MS,
    );
    this.totalBudgetInMs = Math.max(
      1,
      options?.totalBudgetInMs ?? DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
    );
    this.maxHosts = Math.max(
      1,
      Math.floor(options?.maxHosts ?? DEFAULT_NETBIOS_MAX_HOSTS),
    );
    this.retryPasses = Math.max(
      0,
      Math.floor(options?.retryPasses ?? DEFAULT_NETBIOS_RETRY_PASSES),
    );
    this.now = options?.now ?? Date.now;
    this.sleep = options?.sleep ?? defaultSleep;
    this.randomTransactionId =
      options?.randomTransactionId ?? defaultTransactionId;
    this.isAddressAllowed =
      options?.isAddressAllowed ?? isNetbiosQueryAddressAllowed;
  }

  /**
   * NetBIOS names for as many of these addresses as answer with one.
   *
   * NEVER rejects. This is an enrichment on a sweep that has already
   * succeeded: a socket that cannot be opened, a host that never answers, a
   * reply full of garbage and a budget that runs out all resolve to "no name
   * for that address", with whatever names were already found kept.
   */
  public async resolveNames(
    ipAddresses: Array<string>,
  ): Promise<NetbiosNameResolution> {
    const nameByIpAddress: Map<string, string> = new Map<string, string>();

    /*
     * De-duplicated first, so an address the sweep reported twice is asked
     * once and counted once.
     */
    const uniqueAddresses: Array<unknown> = Array.isArray(ipAddresses)
      ? [...new Set<unknown>(ipAddresses)]
      : [];

    const eligibleAddresses: Array<string> = uniqueAddresses.filter(
      (ipAddress: unknown): ipAddress is string => {
        return this.isAllowed(ipAddress);
      },
    );

    const isHostCapReached: boolean = eligibleAddresses.length > this.maxHosts;

    const targetAddresses: Array<string> = isHostCapReached
      ? eligibleAddresses.slice(0, this.maxHosts)
      : eligibleAddresses;

    if (isHostCapReached) {
      logger.warn(
        `Discovery NetBIOS lookups are capped at ${this.maxHosts} host(s) per scan; ${eligibleAddresses.length} unnamed host(s) were eligible, so ${eligibleAddresses.length - this.maxHosts} will keep being named by IP address. The sweep itself is unaffected.`,
      );
    }

    const run: LookupRun = {
      hostStates: new Map<string, HostQueryState>(),
      outstandingCount: 0,
      isBound: false,
      isFinished: false,
      sendFailureCount: 0,
    };

    const buildResult: (extra: {
      isTimeBudgetExhausted: boolean;
      failureReason?: string | undefined;
    }) => NetbiosNameResolution = (extra: {
      isTimeBudgetExhausted: boolean;
      failureReason?: string | undefined;
    }): NetbiosNameResolution => {
      let queriedCount: number = 0;

      for (const state of run.hostStates.values()) {
        if (state.hasQueried) {
          queriedCount++;
        }
      }

      return {
        nameByIpAddress: nameByIpAddress,
        queriedCount: queriedCount,
        skippedCount: uniqueAddresses.length - queriedCount,
        isTimeBudgetExhausted: extra.isTimeBudgetExhausted,
        isHostCapReached: isHostCapReached,
        failureReason: extra.failureReason,
      };
    };

    /*
     * Nothing to ask means no socket at all — not one that is opened, bound
     * and closed again. A scan whose hosts all have names, or whose unnamed
     * hosts are all public, must leave no trace on the network.
     */
    if (targetAddresses.length === 0) {
      return buildResult({ isTimeBudgetExhausted: false });
    }

    const deadline: number = this.now() + this.totalBudgetInMs;

    for (const ipAddress of targetAddresses) {
      const transactionId: number = toNbstatTransactionId(
        this.nextTransactionId(),
      );

      run.hostStates.set(ipAddress, {
        ipAddress: ipAddress,
        transactionId: transactionId,
        query: encodeNbstatQuery(transactionId),
        hasQueried: false,
        hasResponded: false,
        hasSendFailed: false,
      });
    }

    run.outstandingCount = run.hostStates.size;

    let socket: DgramSocketLike | undefined = undefined;
    let isTimeBudgetExhausted: boolean = false;

    try {
      socket = this.createSocket();

      /*
       * The 'error' listener goes on FIRST, before anything can fail. An
       * EventEmitter with no 'error' listener THROWS the error, and from a
       * socket that means an uncaught exception that ends the probe.
       */
      socket.on("error", (error: Error) => {
        if (run.isFinished) {
          return;
        }

        run.socketError =
          run.socketError ||
          (error instanceof Error ? error : new Error(describeError(error)));
        run.wake?.();
      });

      socket.on("message", (message: Buffer, remote: NetbiosRemoteInfo) => {
        /*
         * Wrapped because a throw out of this listener is a throw out of the
         * socket's emit — an uncaught exception, from a datagram the scanned
         * network chose. The parser never throws; this does not rely on it.
         */
        try {
          this.acceptReply(run, nameByIpAddress, message, remote);
        } catch (err) {
          logger.debug(`Discovery NetBIOS reply ignored: ${err}`);
        }
      });

      await this.bindSocket(socket, run, deadline);

      if (run.socketError) {
        return this.endWithSocketFailure(run, nameByIpAddress, buildResult);
      }

      if (!run.isBound) {
        logger.warn(
          `Discovery NetBIOS lookups did not start: the probe's UDP socket did not bind within ${this.totalBudgetInMs}ms. Hosts will keep being named by IP address. The sweep itself is unaffected.`,
        );

        return buildResult({
          isTimeBudgetExhausted: true,
          failureReason: "The UDP socket did not bind in time.",
        });
      }

      this.enlargeReceiveBuffer(socket);

      isTimeBudgetExhausted = await this.runPasses(socket, run, deadline);

      if (run.socketError) {
        return this.endWithSocketFailure(run, nameByIpAddress, buildResult);
      }

      if (isTimeBudgetExhausted) {
        const result: NetbiosNameResolution = buildResult({
          isTimeBudgetExhausted: true,
        });

        logger.warn(
          `Discovery NetBIOS lookups exceeded their ${this.totalBudgetInMs}ms budget after naming ${nameByIpAddress.size} host(s): ${result.queriedCount} of ${run.hostStates.size} host(s) were queried. The rest will keep being named by IP address. The sweep itself is unaffected.`,
        );

        return result;
      }

      return buildResult({ isTimeBudgetExhausted: false });
    } catch (err) {
      /*
       * createSocket or bind threw synchronously. Nothing past the guards
       * above is expected to throw; caught regardless, because this runs on
       * the way to a finished scan's upload.
       */
      run.socketError = run.socketError || new Error(describeError(err));

      return this.endWithSocketFailure(run, nameByIpAddress, buildResult);
    } finally {
      run.isFinished = true;
      run.wake = undefined;

      if (run.sendFailureCount > 0) {
        logger.debug(
          `Discovery NetBIOS: ${run.sendFailureCount} query send(s) failed and those host(s) were not retried. First error: ${run.firstSendFailure || "unknown"}`,
        );
      }

      logger.debug(
        `Discovery NetBIOS named ${nameByIpAddress.size} of ${run.hostStates.size} queried host(s).`,
      );

      /*
       * Closed on EVERY path — success, budget, socket error, a throw. A
       * socket left open would keep the probe's event loop alive and its
       * ephemeral port bound for the life of the process, once per scan.
       */
      if (socket) {
        try {
          socket.close();
        } catch {
          // Already closed (for example by the error that ended the run).
        }
      }
    }
  }

  private isAllowed(ipAddress: unknown): boolean {
    if (typeof ipAddress !== "string") {
      return false;
    }

    try {
      return this.isAddressAllowed(ipAddress) === true;
    } catch {
      // A policy that cannot decide has not allowed anything.
      return false;
    }
  }

  private nextTransactionId(): number {
    try {
      return this.randomTransactionId();
    } catch {
      return 0;
    }
  }

  private endWithSocketFailure(
    run: LookupRun,
    nameByIpAddress: Map<string, string>,
    buildResult: (extra: {
      isTimeBudgetExhausted: boolean;
      failureReason?: string | undefined;
    }) => NetbiosNameResolution,
  ): NetbiosNameResolution {
    const failureReason: string = describeError(run.socketError);

    logger.warn(
      `Discovery NetBIOS lookups stopped because the probe's UDP socket failed: ${failureReason}. ${nameByIpAddress.size} host(s) named before that keep their names; the rest will keep being named by IP address. The sweep itself is unaffected.`,
    );

    return buildResult({
      isTimeBudgetExhausted: false,
      failureReason: failureReason,
    });
  }

  /*
   * Binds to port 0 — an EPHEMERAL port the kernel picks — and NEVER to 137.
   * Binding a port below 1024 needs NET_BIND_SERVICE, which the probe
   * container drops, and a probe host that runs its own NetBIOS stack owns 137
   * already. Windows and Samba reply to the query's source port, so nothing is
   * lost.
   *
   * Resolves when the socket is bound, when it emits 'error', or when the
   * budget runs out — whichever is first — so a bind that never completes
   * cannot hold a finished scan hostage.
   */
  private async bindSocket(
    socket: DgramSocketLike,
    run: LookupRun,
    deadline: number,
  ): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      let isSettled: boolean = false;

      const finish: () => void = (): void => {
        if (!isSettled) {
          isSettled = true;
          run.wake = undefined;
          resolve();
        }
      };

      run.wake = finish;

      try {
        socket.bind(0, () => {
          run.isBound = true;
          finish();
        });
      } catch (err) {
        run.socketError = run.socketError || new Error(describeError(err));
        finish();
        return;
      }

      if (!isSettled) {
        this.sleep(Math.max(0, deadline - this.now())).then(finish, finish);
      }
    });
  }

  private enlargeReceiveBuffer(socket: DgramSocketLike): void {
    try {
      socket.setRecvBufferSize?.(NETBIOS_RECEIVE_BUFFER_SIZE_IN_BYTES);
    } catch (err) {
      /*
       * macOS refuses sizes above kern.ipc.maxsockbuf, and a hardened kernel
       * may refuse any change. The default buffer still works for all but the
       * largest lookups.
       */
      logger.debug(
        `Discovery NetBIOS could not enlarge its receive buffer; continuing with the default. ${err}`,
      );
    }
  }

  /*
   * The query passes: paced sends to every host still outstanding, then a
   * listening window, then the same again for whoever did not answer.
   * Answers whether the wall-clock budget cut the lookup short.
   */
  private async runPasses(
    socket: DgramSocketLike,
    run: LookupRun,
    deadline: number,
  ): Promise<boolean> {
    for (let pass: number = 0; pass <= this.retryPasses; pass++) {
      /*
       * Retry passes ask ONLY the hosts that have not answered. A host whose
       * send failed is closed out rather than retried: the failure was local
       * (no route, a firewall's EPERM, a refused address) and repeating it
       * spends budget the other hosts could use.
       */
      const passTargets: Array<HostQueryState> = [
        ...run.hostStates.values(),
      ].filter((state: HostQueryState) => {
        return !state.hasResponded && !state.hasSendFailed;
      });

      if (passTargets.length === 0) {
        return false;
      }

      for (let index: number = 0; index < passTargets.length; index++) {
        if (index > 0 && this.sendIntervalInMs > 0) {
          await this.sleep(this.sendIntervalInMs);
        }

        if (run.socketError) {
          return false;
        }

        if (this.now() >= deadline) {
          return true;
        }

        const state: HostQueryState = passTargets[index]!;

        // A late answer to the previous pass may have landed while pacing.
        if (state.hasResponded || state.hasSendFailed) {
          continue;
        }

        this.sendQuery(socket, run, state);
      }

      /*
       * EARLY STOP: every host has answered (or failed to be asked), so there
       * is nothing to listen for. On an estate of well-behaved Windows hosts
       * this is what keeps the lookup from costing a flat second and a half
       * per pass for nothing.
       */
      if (run.outstandingCount === 0) {
        return false;
      }

      const remainingBudgetInMs: number = deadline - this.now();

      if (remainingBudgetInMs <= 0) {
        return true;
      }

      const waitInMs: number = Math.min(
        this.perHostTimeoutInMs,
        remainingBudgetInMs,
      );

      await this.waitForReplies(run, waitInMs);

      if (run.socketError || run.outstandingCount === 0) {
        return false;
      }

      // The budget, not the listening window, ended this wait.
      if (waitInMs < this.perHostTimeoutInMs) {
        return true;
      }
    }

    return false;
  }

  private sendQuery(
    socket: DgramSocketLike,
    run: LookupRun,
    state: HostQueryState,
  ): void {
    state.hasQueried = true;

    try {
      socket.send(
        state.query,
        this.port,
        state.ipAddress,
        (error: Error | null) => {
          if (error) {
            this.closeOutAfterSendFailure(run, state, error);
          }
        },
      );
    } catch (err) {
      this.closeOutAfterSendFailure(run, state, err);
    }
  }

  /*
   * A failed send affects THAT host only. It stops being outstanding — so it
   * cannot hold the listening window open — and is not retried.
   */
  private closeOutAfterSendFailure(
    run: LookupRun,
    state: HostQueryState,
    error: unknown,
  ): void {
    if (run.isFinished || state.hasResponded || state.hasSendFailed) {
      return;
    }

    state.hasSendFailed = true;
    run.outstandingCount--;
    run.sendFailureCount++;
    run.firstSendFailure = run.firstSendFailure || describeError(error);

    if (run.outstandingCount === 0) {
      run.wake?.();
    }
  }

  /*
   * One datagram off the socket. Accepted ONLY when every one of these holds,
   * because each rules out a different way to plant a name:
   *
   *   - it comes from an address this lookup queried (a reply from anywhere
   *     else names nothing we asked about);
   *   - from the NetBIOS port itself (a reply from a random port on the right
   *     host is not the name service answering);
   *   - with that host's transaction id (a stale or forged reply);
   *   - and it parses as a successful NBSTAT response.
   *
   * Such a reply marks the host ANSWERED even when its table holds no usable
   * name — only groups, say, or junk that fails normalisation. Asking again
   * would get the same table back, so it is not retried and does not keep the
   * listening window open; it simply gets no entry in the map. A name enters
   * the map only when chooseNetbiosName returns one.
   */
  private acceptReply(
    run: LookupRun,
    nameByIpAddress: Map<string, string>,
    message: Buffer,
    remote: NetbiosRemoteInfo,
  ): void {
    if (run.isFinished || !remote || typeof remote.address !== "string") {
      return;
    }

    if (remote.port !== this.port) {
      return;
    }

    const state: HostQueryState | undefined = run.hostStates.get(
      remote.address,
    );

    if (!state || !state.hasQueried || state.hasResponded) {
      return;
    }

    const response: NbstatResponse | null = parseNbstatResponse(message);

    if (!response || response.transactionId !== state.transactionId) {
      return;
    }

    if (!state.hasSendFailed) {
      run.outstandingCount--;
    }

    state.hasResponded = true;

    const name: string | undefined = chooseNetbiosName(response.names);

    if (name) {
      nameByIpAddress.set(state.ipAddress, name);
    }

    if (run.outstandingCount === 0) {
      run.wake?.();
    }
  }

  // Resolves after `waitInMs`, or as soon as run.wake() is called.
  private async waitForReplies(
    run: LookupRun,
    waitInMs: number,
  ): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      let isSettled: boolean = false;

      const finish: () => void = (): void => {
        if (!isSettled) {
          isSettled = true;
          run.wake = undefined;
          resolve();
        }
      };

      run.wake = finish;
      this.sleep(waitInMs).then(finish, finish);
    });
  }
}

import OnlineCheck from "../../OnlineCheck";
import MonitorRetry from "../MonitorRetry";
import ProbeDnsLookup from "../ProbeDnsLookup";
import NtpPacket, {
  NtpReplyCheck,
  NtpReplyFacts,
  NtpServerReply,
} from "./NtpMonitor/NtpPacket";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import IP from "Common/Types/IP/IP";
import NtpMonitorResponse from "Common/Types/Monitor/NtpMonitor/NtpMonitorResponse";
import NtpMonitorUtil, {
  DEFAULT_NTP_PORT,
  DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS,
} from "Common/Types/Monitor/NtpMonitor/NtpMonitorUtil";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "Common/Types/Probe/RequestFailedDetails";
import Sleep from "Common/Types/Sleep";
import HostAddressUtil from "Common/Utils/HostAddressUtil";
import ProbeNetworkFailureUtil, {
  ProbeNetworkFailure,
  ProbeNetworkOperation,
} from "Common/Utils/ProbeNetworkFailureUtil";
import logger from "Common/Server/Utils/Logger";
import dgram from "dgram";
import dns from "dns";
import net from "net";

/*
 * The NTP check: one SNTP client request (RFC 4330 / RFC 5905, mode 3) from
 * an ephemeral port to the server's UDP port, and the reply read for its
 * stratum, leap indicator, reference and clock offset.
 *
 * A reply is anything that is the server's answer to THIS request (see
 * NtpPacket.checkServerReply) - including a kiss-o'-death or an
 * unsynchronized server, which answer but serve no good time. Those are
 * reported as answered and never retried: the server has spoken, and asking
 * again a second later is exactly what a RATE kiss tells a client not to do.
 * Only silence and errors are retried.
 *
 * Like the Port check, this does not go through the egress guard: it learns
 * whether a host answers NTP and the header of its reply, nothing more, and
 * a probe on a private network is how internal time servers get watched.
 */

export interface NtpQueryOptions {
  // Per attempt, in milliseconds: the DNS lookup and the exchange together.
  timeout?: number | undefined;
  // Retries after the first attempt. undefined: DEFAULT_RETRIES_WHEN_UNSET.
  retry?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
}

// Four attempts, like the other probe checks when nobody set a number.
const DEFAULT_RETRIES_WHEN_UNSET: number = 3;

/*
 * Between a failed attempt and the next. Together with the attempt's own
 * timeout it keeps retries at least two seconds apart, which is ntpd's
 * default minimum spacing between a client's packets ("discard minimum").
 */
const PAUSE_BETWEEN_ATTEMPTS_IN_MS: number = 1000;

// Error codes that mean this probe could not send, not that the server is down.
const PROBE_SIDE_ERROR_CODES: Array<string> = [
  "EADDRNOTAVAIL",
  "EAFNOSUPPORT",
  "ENETUNREACH",
];

const DNS_ERROR_CODES: Array<string> = ["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"];

interface ResolvedAddress {
  address: string;
  family: number;
}

interface NtpExchange {
  facts: NtpReplyFacts;
  responseTimeInMs: number;
  serverAddress: string;
  dnsLookupInMs: number | undefined;
}

/*
 * Why one attempt got no answer. failureCause is the sentence an operator
 * reads; code is the OS error, when there was one.
 */
export class NtpAttemptError extends Error {
  public failureCause: string;
  public code: string | undefined;
  public isTimeout: boolean;
  public requestFailedDetails: RequestFailedDetails;

  public constructor(data: {
    failureCause: string;
    code?: string | undefined;
    isTimeout?: boolean | undefined;
    requestFailedDetails: RequestFailedDetails;
  }) {
    super(data.failureCause);
    this.name = "NtpAttemptError";
    this.failureCause = data.failureCause;
    this.code = data.code;
    this.isTimeout = Boolean(data.isTimeout);
    this.requestFailedDetails = data.requestFailedDetails;
  }
}

const elapsedMs: (startedAtNs: bigint) => number = (
  startedAtNs: bigint,
): number => {
  return Number(process.hrtime.bigint() - startedAtNs) / 1000000;
};

const roundMs: (value: number) => number = (value: number): number => {
  return Math.round(value * 1000) / 1000;
};

const formatSeconds: (ms: number) => string = (ms: number): string => {
  const seconds: number = Math.round((ms / 1000) * 10) / 10;

  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
};

const getErrorCode: (error: unknown) => string | undefined = (
  error: unknown,
): string | undefined => {
  const code: unknown = (error as { code?: unknown } | undefined)?.code;

  return typeof code === "string" ? code : undefined;
};

export default class NtpMonitor {
  /*
   * Queries the server, retrying silence and errors, and returns what was
   * found - or null when the server did not answer and this probe has lost
   * its own network (OnlineCheck), so it cannot blame the server.
   */
  public static async query(data: {
    host: Hostname | IP | URL;
    port?: Port | number | undefined;
    options?: NtpQueryOptions | undefined;
  }): Promise<NtpMonitorResponse | null> {
    const options: NtpQueryOptions = data.options || {};
    const target: { host: string; port: number } = NtpMonitor.getTarget({
      host: data.host,
      port: data.port,
    });

    const timeoutInMs: number =
      options.timeout && options.timeout > 0
        ? options.timeout
        : DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS;

    const attempts: Array<ProbeAttempt> = [];

    for (let attemptNumber: number = 1; ; attemptNumber++) {
      const attemptedAt: Date = new Date();
      const attemptStartedAtNs: bigint = process.hrtime.bigint();

      logger.debug(
        `NTP query: ${options.monitorId?.toString()} ${target.host}:${target.port} - attempt ${attemptNumber}`,
      );

      try {
        const exchange: NtpExchange = await NtpMonitor.exchange({
          host: target.host,
          port: target.port,
          timeoutInMs: timeoutInMs,
        });

        attempts.push({
          attemptNumber: attemptNumber,
          attemptedAt: attemptedAt,
          responseReceivedAt: new Date(),
          responseTimeInMs: roundMs(exchange.responseTimeInMs),
          isOnline: true,
        });

        return NtpMonitor.toAnsweredResponse({
          exchange: exchange,
          port: target.port,
          attempts: attempts,
        });
      } catch (error: unknown) {
        const attemptError: NtpAttemptError = NtpMonitor.toAttemptError({
          error: error,
          host: target.host,
          port: target.port,
          timeoutInMs: timeoutInMs,
        });

        logger.debug(
          `NTP query failed: ${options.monitorId?.toString()} ${target.host}:${target.port} - ${attemptError.failureCause}`,
        );

        attempts.push({
          attemptNumber: attemptNumber,
          attemptedAt: attemptedAt,
          responseReceivedAt: new Date(),
          responseTimeInMs: roundMs(elapsedMs(attemptStartedAtNs)),
          isOnline: false,
          failureCause: attemptError.failureCause,
        });

        if (
          MonitorRetry.canRetry({
            attemptNumber: attemptNumber,
            retries: options.retry,
            defaultRetries: DEFAULT_RETRIES_WHEN_UNSET,
          })
        ) {
          await Sleep.sleep(PAUSE_BETWEEN_ATTEMPTS_IN_MS);
          continue;
        }

        /*
         * A probe that has lost its own network fails every check at once.
         * Report nothing rather than blame the time server for it.
         */
        if (!options.isOnlineCheckRequest) {
          if (!(await OnlineCheck.canProbeMonitorPortMonitors())) {
            logger.error(
              `NtpMonitor - Probe is not online. Cannot query ${options.monitorId?.toString()} ${target.host}:${target.port} - ERROR: ${attemptError.failureCause}`,
            );
            return null;
          }
        }

        return {
          isOnline: false,
          isSynchronized: false,
          responseTimeInMs: 0,
          failureCause: NtpMonitor.withAttemptCount(
            attemptError.failureCause,
            attempts.length,
          ),
          isTimeout: attemptError.isTimeout,
          requestFailedDetails: attemptError.requestFailedDetails,
          port: target.port,
          probeAttempts: attempts,
          totalAttempts: attempts.length,
        };
      }
    }
  }

  /*
   * Where the request goes. A port typed into the host ("ntp.example.com:1123")
   * wins, then the step's port, then 123. IPv6 brackets are URL syntax, not
   * part of the address, so they are dropped before the socket sees them.
   */
  public static getTarget(data: {
    host: Hostname | IP | URL;
    port?: Port | number | undefined;
  }): { host: string; port: number } {
    let rawHost: string = "";
    let port: number | undefined = undefined;

    if (data.host instanceof Hostname) {
      rawHost = data.host.hostname;
      port = data.host.port?.toNumber();
    } else if (data.host instanceof URL) {
      rawHost = data.host.hostname.hostname;
      port = data.host.hostname.port?.toNumber();
    } else {
      rawHost = data.host.toString();
    }

    if (!port) {
      port =
        data.port instanceof Port
          ? data.port.toNumber()
          : data.port || undefined;
    }

    return {
      host: HostAddressUtil.stripBrackets(rawHost),
      port: port && port > 0 && port <= 65535 ? port : DEFAULT_NTP_PORT,
    };
  }

  /*
   * One attempt: resolve the host, send one request, and wait for its reply
   * until the attempt's deadline. The deadline covers the lookup and the
   * exchange together.
   *
   * A name with addresses of both families is tried on its first address;
   * if that one cannot even leave this probe (an IPv6 address on a probe
   * without IPv6), the first address of the other family is tried before
   * the attempt is given up - the same fallback a TCP check gets from Node.
   */
  public static async exchange(data: {
    host: string;
    port: number;
    timeoutInMs: number;
  }): Promise<NtpExchange> {
    const startedAtNs: bigint = process.hrtime.bigint();
    const isIpAddress: boolean = net.isIP(data.host) !== 0;

    let addresses: Array<ResolvedAddress> = [];
    let dnsLookupInMs: number | undefined = undefined;

    if (isIpAddress) {
      addresses = [{ address: data.host, family: net.isIP(data.host) }];
    } else {
      addresses = await NtpMonitor.withDeadline({
        promise: NtpMonitor.lookup(data.host),
        timeoutInMs: data.timeoutInMs,
        onTimeout: (): Error => {
          return NtpMonitor.timeoutError({
            host: data.host,
            port: data.port,
            timeoutInMs: data.timeoutInMs,
            ignoredReplies: [],
            duringLookup: true,
          });
        },
      });

      dnsLookupInMs = roundMs(elapsedMs(startedAtNs));
    }

    const candidates: Array<ResolvedAddress> =
      NtpMonitor.getCandidates(addresses);

    let lastError: unknown = undefined;

    for (const candidate of candidates) {
      const remainingMs: number = data.timeoutInMs - elapsedMs(startedAtNs);

      if (remainingMs <= 0) {
        break;
      }

      try {
        const result: {
          facts: NtpReplyFacts;
          responseTimeInMs: number;
        } = await NtpMonitor.exchangeWithAddress({
          address: candidate,
          host: data.host,
          port: data.port,
          timeoutInMs: remainingMs,
          fullTimeoutInMs: data.timeoutInMs,
        });

        return {
          facts: result.facts,
          responseTimeInMs: result.responseTimeInMs,
          serverAddress: candidate.address,
          dnsLookupInMs: dnsLookupInMs,
        };
      } catch (error: unknown) {
        lastError = error;

        const code: string | undefined = getErrorCode(error);

        // Only a failure to send falls over to the other family.
        if (!code || !PROBE_SIDE_ERROR_CODES.includes(code)) {
          throw error;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw NtpMonitor.timeoutError({
      host: data.host,
      port: data.port,
      timeoutInMs: data.timeoutInMs,
      ignoredReplies: [],
      duringLookup: false,
    });
  }

  /*
   * The addresses to try, in order: the resolver's first, then the first of
   * the other family, if there is one.
   */
  public static getCandidates(
    addresses: Array<ResolvedAddress>,
  ): Array<ResolvedAddress> {
    const first: ResolvedAddress | undefined = addresses[0];

    if (!first) {
      return [];
    }

    const otherFamily: ResolvedAddress | undefined = addresses.find(
      (address: ResolvedAddress): boolean => {
        return address.family !== first.family;
      },
    );

    return otherFamily ? [first, otherFamily] : [first];
  }

  private static lookup(host: string): Promise<Array<ResolvedAddress>> {
    return new Promise(
      (
        resolve: (addresses: Array<ResolvedAddress>) => void,
        reject: (error: Error) => void,
      ): void => {
        ProbeDnsLookup.lookupWithoutAddrConfig(
          host,
          { all: true },
          (
            error: NodeJS.ErrnoException | null,
            result: string | Array<dns.LookupAddress>,
          ): void => {
            if (error) {
              reject(error);
              return;
            }

            const addresses: Array<ResolvedAddress> = (
              Array.isArray(result) ? result : []
            ).map((entry: dns.LookupAddress): ResolvedAddress => {
              return { address: entry.address, family: entry.family };
            });

            if (addresses.length === 0) {
              const notFound: NodeJS.ErrnoException = new Error(
                `getaddrinfo ENOTFOUND ${host}`,
              );
              notFound.code = "ENOTFOUND";
              reject(notFound);
              return;
            }

            resolve(addresses);
          },
        );
      },
    );
  }

  private static exchangeWithAddress(data: {
    address: ResolvedAddress;
    host: string;
    port: number;
    timeoutInMs: number;
    fullTimeoutInMs: number;
  }): Promise<{ facts: NtpReplyFacts; responseTimeInMs: number }> {
    return new Promise(
      (
        resolve: (result: {
          facts: NtpReplyFacts;
          responseTimeInMs: number;
        }) => void,
        reject: (error: Error) => void,
      ): void => {
        const socket: dgram.Socket = dgram.createSocket({
          type: data.address.family === 6 ? "udp6" : "udp4",
        });

        const transmitNonce: Buffer = NtpPacket.createTransmitNonce();
        const request: Buffer = NtpPacket.createClientRequest(transmitNonce);
        const ignoredReplies: Array<string> = [];

        let requestSentAtUnixMs: number | undefined = undefined;
        let requestSentAtNs: bigint | undefined = undefined;
        let hasSettled: boolean = false;
        let deadlineTimer: NodeJS.Timeout | undefined = undefined;

        const finish: () => void = (): void => {
          if (deadlineTimer) {
            clearTimeout(deadlineTimer);
            deadlineTimer = undefined;
          }

          socket.removeAllListeners();
          // A late ICMP error after close must not become an unhandled event.
          socket.on("error", (): void => {});

          try {
            socket.close();
          } catch {
            // Already closed.
          }
        };

        const fail: (error: Error) => void = (error: Error): void => {
          if (hasSettled) {
            return;
          }

          hasSettled = true;
          finish();
          reject(error);
        };

        const succeed: (result: {
          facts: NtpReplyFacts;
          responseTimeInMs: number;
        }) => void = (result: {
          facts: NtpReplyFacts;
          responseTimeInMs: number;
        }): void => {
          if (hasSettled) {
            return;
          }

          hasSettled = true;
          finish();
          resolve(result);
        };

        deadlineTimer = setTimeout((): void => {
          fail(
            NtpMonitor.timeoutError({
              host: data.host,
              port: data.port,
              timeoutInMs: data.fullTimeoutInMs,
              ignoredReplies: ignoredReplies,
              duringLookup: false,
            }),
          );
        }, data.timeoutInMs);

        socket.on("error", (error: Error): void => {
          fail(error);
        });

        socket.on("message", (packet: Buffer): void => {
          if (
            hasSettled ||
            requestSentAtNs === undefined ||
            requestSentAtUnixMs === undefined
          ) {
            return;
          }

          const replyReceivedAtNs: bigint = process.hrtime.bigint();

          const check: NtpReplyCheck = NtpPacket.checkServerReply({
            packet: packet,
            transmitNonce: transmitNonce,
          });

          if (!check.isValid) {
            // Not this request's reply: keep waiting for the real one.
            ignoredReplies.push(check.reason);
            return;
          }

          const reply: NtpServerReply = check.reply;

          /*
           * T4 is T1 plus the monotonic time the exchange took, so a step of
           * the probe's wall clock between the two cannot bend the result.
           */
          const responseTimeInMs: number =
            Number(replyReceivedAtNs - requestSentAtNs) / 1000000;

          succeed({
            facts: NtpPacket.readReply({
              reply: reply,
              transmitNonce: transmitNonce,
              requestSentAtUnixMs: requestSentAtUnixMs,
              replyReceivedAtUnixMs: requestSentAtUnixMs + responseTimeInMs,
            }),
            responseTimeInMs: responseTimeInMs,
          });
        });

        /*
         * A connected socket: the kernel then delivers only datagrams from
         * the server's address and port, and reports an ICMP "port
         * unreachable" as ECONNREFUSED instead of leaving the probe to wait
         * out its timeout.
         */
        try {
          /*
           * Node hands a failed connect to this callback as its argument
           * (and emits no 'error'), although the type declares none.
           */
          socket.connect(data.port, data.address.address, (error?: Error) => {
            if (hasSettled) {
              return;
            }

            if (error) {
              fail(error);
              return;
            }

            requestSentAtUnixMs = Date.now();
            requestSentAtNs = process.hrtime.bigint();

            socket.send(request, (error: Error | null): void => {
              if (error) {
                fail(error);
              }
            });
          });
        } catch (error: unknown) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  }

  private static async withDeadline<T>(data: {
    promise: Promise<T>;
    timeoutInMs: number;
    onTimeout: () => Error;
  }): Promise<T> {
    let timer: NodeJS.Timeout | undefined = undefined;

    try {
      return await Promise.race([
        data.promise,
        new Promise<T>(
          (_resolve: (value: T) => void, reject: (error: Error) => void) => {
            timer = setTimeout((): void => {
              reject(data.onTimeout());
            }, data.timeoutInMs);
          },
        ),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private static timeoutError(data: {
    host: string;
    port: number;
    timeoutInMs: number;
    ignoredReplies: Array<string>;
    duringLookup: boolean;
  }): NtpAttemptError {
    const target: string = HostAddressUtil.formatHostAndPort({
      host: data.host,
      port: data.port,
    });

    if (data.duringLookup) {
      return new NtpAttemptError({
        failureCause: `Looking up ${data.host} did not finish within ${formatSeconds(data.timeoutInMs)}.`,
        isTimeout: true,
        requestFailedDetails: {
          failedPhase: RequestFailedPhase.DNSResolution,
          errorCode: "TIMEOUT",
          errorDescription:
            "The DNS lookup of the NTP server did not finish before the timeout.",
        },
      });
    }

    let failureCause: string = `No NTP reply from ${target} within ${formatSeconds(data.timeoutInMs)}.`;

    if (data.ignoredReplies.length > 0) {
      failureCause += ` The probe ignored ${data.ignoredReplies.length === 1 ? "a packet" : `${data.ignoredReplies.length} packets`} that did not answer its request: ${data.ignoredReplies[0]}.`;
    }

    return new NtpAttemptError({
      failureCause: failureCause,
      isTimeout: true,
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.RequestTimeout,
        errorCode: "TIMEOUT",
        errorDescription:
          "The request was sent, but no NTP reply came back before the timeout. A firewall dropping UDP port 123, a server that is down, or a server that only answers some networks all look like this.",
      },
    });
  }

  // Any error from an attempt, as the NtpAttemptError the operator reads.
  public static toAttemptError(data: {
    error: unknown;
    host: string;
    port: number;
    timeoutInMs: number;
  }): NtpAttemptError {
    if (data.error instanceof NtpAttemptError) {
      return data.error;
    }

    const code: string | undefined = getErrorCode(data.error);
    const rawErrorMessage: string =
      data.error instanceof Error ? data.error.message : String(data.error);
    const target: string = HostAddressUtil.formatHostAndPort({
      host: data.host,
      port: data.port,
    });

    if (code && DNS_ERROR_CODES.includes(code)) {
      return new NtpAttemptError({
        failureCause: `Could not resolve ${data.host} (${code}).`,
        code: code,
        requestFailedDetails: {
          failedPhase: RequestFailedPhase.DNSResolution,
          errorCode: code,
          errorDescription:
            "The NTP server's name did not resolve to an address, so no request was sent.",
          rawErrorMessage: rawErrorMessage,
        },
      });
    }

    if (code === "ECONNREFUSED") {
      return new NtpAttemptError({
        failureCause: `${target} refused the request: nothing is listening for NTP on UDP port ${data.port} there (ICMP port unreachable).`,
        code: code,
        requestFailedDetails: {
          failedPhase: RequestFailedPhase.NetworkError,
          errorCode: code,
          errorDescription:
            "The host is reachable, but answered that no service listens on this UDP port: the NTP daemon is stopped, or listens on another port.",
          rawErrorMessage: rawErrorMessage,
        },
      });
    }

    /*
     * connect() on a datagram socket is a route lookup in this probe's own
     * kernel, like ping's, so these errors are certainly the probe's.
     */
    const probeNetworkFailure: ProbeNetworkFailure | null =
      ProbeNetworkFailureUtil.classifyError({
        error: data.error,
        operation: ProbeNetworkOperation.PingOrTraceroute,
      });

    if (probeNetworkFailure) {
      return new NtpAttemptError({
        failureCause: ProbeNetworkFailureUtil.describe({
          host: data.host,
          failure: probeNetworkFailure,
        }),
        code: code,
        requestFailedDetails: {
          failedPhase: RequestFailedPhase.NetworkError,
          errorCode: code,
          errorDescription:
            "The probe could not send the request from its own side, so the NTP server was never contacted. The failure is on the probe, not on the server.",
          rawErrorMessage: rawErrorMessage,
        },
      });
    }

    return new NtpAttemptError({
      failureCause: `The NTP request to ${target} failed: ${rawErrorMessage}${code && !rawErrorMessage.includes(code) ? ` (${code})` : ""}.`,
      code: code,
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.NetworkError,
        errorCode: code,
        errorDescription: "The NTP check failed because of a network error.",
        rawErrorMessage: rawErrorMessage,
      },
    });
  }

  private static toAnsweredResponse(data: {
    exchange: NtpExchange;
    port: number;
    attempts: Array<ProbeAttempt>;
  }): NtpMonitorResponse {
    const facts: NtpReplyFacts = data.exchange.facts;

    const response: NtpMonitorResponse = {
      isOnline: true,
      isSynchronized: facts.isSynchronized,
      responseTimeInMs: roundMs(data.exchange.responseTimeInMs),
      failureCause: "",
      isTimeout: false,
      serverAddress: data.exchange.serverAddress,
      port: data.port,
      dnsLookupInMs: data.exchange.dnsLookupInMs,
      version: facts.version,
      leapIndicator: facts.leapIndicator,
      stratum: facts.stratum,
      kissCode: facts.kissCode,
      referenceId: facts.referenceId || undefined,
      pollIntervalInSeconds: facts.pollIntervalInSeconds,
      precisionInMs: facts.precisionInMs,
      rootDelayInMs:
        facts.rootDelayInMs === undefined
          ? undefined
          : roundMs(facts.rootDelayInMs),
      rootDispersionInMs:
        facts.rootDispersionInMs === undefined
          ? undefined
          : roundMs(facts.rootDispersionInMs),
      referenceTime: facts.referenceTime,
      serverTime: facts.serverTime,
      clockOffsetInMs:
        facts.clockOffsetInMs === undefined
          ? undefined
          : roundMs(facts.clockOffsetInMs),
      roundTripDelayInMs:
        facts.roundTripDelayInMs === undefined
          ? undefined
          : roundMs(facts.roundTripDelayInMs),
      probeAttempts: data.attempts,
      totalAttempts: data.attempts.length,
    };

    response.failureCause = NtpMonitorUtil.describeWhyNotSynchronized(
      response,
      facts.hasUsableTime,
    );

    return response;
  }

  private static withAttemptCount(
    failureCause: string,
    attemptCount: number,
  ): string {
    if (attemptCount <= 1) {
      return failureCause;
    }

    return `${failureCause} Tried ${attemptCount} times.`;
  }
}

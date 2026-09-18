import HttpPhaseTimings from "Common/Types/Monitor/HttpPhaseTimings";
import http from "http";
import https from "https";
import net from "net";

/*
 * Records HTTP(S) phase timings by listening to socket events on the first
 * connection an agent opens: 'lookup' (DNS), 'connect' (TCP), 'secureConnect'
 * (TLS), and the first 'data' chunk (time to first byte). Download time is
 * derived by the caller as total minus the instrumented phases.
 *
 * Only the first socket is instrumented — redirects open new connections
 * whose phases would overwrite the numbers users care about (the initial
 * connection to the monitored target).
 */
export class HttpTimingCollector {
  private startedAt: number | undefined;
  private dnsDoneAt: number | undefined;
  private connectDoneAt: number | undefined;
  private secureDoneAt: number | undefined;
  private firstByteAt: number | undefined;
  private isAttached: boolean = false;

  private static nowInMs(): number {
    const hrtime: [number, number] = process.hrtime();
    return hrtime[0] * 1000 + hrtime[1] / 1000000;
  }

  public reset(): void {
    this.startedAt = undefined;
    this.dnsDoneAt = undefined;
    this.connectDoneAt = undefined;
    this.secureDoneAt = undefined;
    this.firstByteAt = undefined;
    this.isAttached = false;
  }

  /*
   * Monitor egress validation resolves the target before an Agent creates a
   * socket. Record that guarded lookup explicitly so it remains part of the
   * DNS phase instead of being misattributed to response download time.
   */
  public startDnsLookup(): void {
    if (this.startedAt === undefined) {
      this.startedAt = HttpTimingCollector.nowInMs();
    }
  }

  public finishDnsLookup(): void {
    if (this.startedAt !== undefined && this.dnsDoneAt === undefined) {
      this.dnsDoneAt = HttpTimingCollector.nowInMs();
    }
  }

  public attach(socket: net.Socket): void {
    if (this.isAttached) {
      return;
    }

    this.isAttached = true;
    if (this.startedAt === undefined) {
      this.startedAt = HttpTimingCollector.nowInMs();
    }

    socket.once("lookup", () => {
      if (this.dnsDoneAt === undefined) {
        this.dnsDoneAt = HttpTimingCollector.nowInMs();
      }
    });

    socket.once("connect", () => {
      this.connectDoneAt = HttpTimingCollector.nowInMs();
    });

    socket.once("secureConnect", () => {
      this.secureDoneAt = HttpTimingCollector.nowInMs();
    });

    socket.once("data", () => {
      this.firstByteAt = HttpTimingCollector.nowInMs();
    });
  }

  public getTimings(totalTimeInMs?: number | undefined): HttpPhaseTimings {
    const timings: HttpPhaseTimings = {};

    if (this.startedAt === undefined) {
      return timings;
    }

    const round: (value: number) => number = (value: number) => {
      return Math.max(0, Math.round(value * 100) / 100);
    };

    if (this.dnsDoneAt !== undefined) {
      timings.dnsLookupInMs = round(this.dnsDoneAt - this.startedAt);
    }

    if (this.connectDoneAt !== undefined) {
      timings.tcpConnectInMs = round(
        this.connectDoneAt - (this.dnsDoneAt ?? this.startedAt),
      );
    }

    if (this.secureDoneAt !== undefined && this.connectDoneAt !== undefined) {
      timings.tlsHandshakeInMs = round(this.secureDoneAt - this.connectDoneAt);
    }

    const readyAt: number | undefined = this.secureDoneAt ?? this.connectDoneAt;

    if (this.firstByteAt !== undefined && readyAt !== undefined) {
      timings.timeToFirstByteInMs = round(this.firstByteAt - readyAt);
    }

    if (
      totalTimeInMs !== undefined &&
      this.firstByteAt !== undefined &&
      this.startedAt !== undefined
    ) {
      timings.downloadInMs = round(
        totalTimeInMs - (this.firstByteAt - this.startedAt),
      );
    }

    return timings;
  }
}

export interface TimedAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

export class HttpTimingAgents {
  /*
   * Wraps fresh keep-alive-free agents so every request opens a new socket
   * the collector can instrument. `createConnection` is a documented
   * override point on http.Agent; @types/node does not declare it, hence
   * the casts.
   */
  public static create(
    collector: HttpTimingCollector,
    httpsAgentOptions?: https.AgentOptions | undefined,
    httpAgentOptions?: http.AgentOptions | undefined,
  ): TimedAgents {
    const httpAgent: http.Agent = new http.Agent({
      ...(httpAgentOptions || {}),
      keepAlive: false,
    });
    const httpsAgent: https.Agent = new https.Agent({
      ...(httpsAgentOptions || {}),
      /*
       * After the spread, not before it. A pooled connection skips DNS, TCP
       * and TLS altogether, so a caller whose options happened to carry
       * keepAlive would silently switch off the instrumentation this class
       * exists to provide — and the check would report a suspiciously fast
       * phase breakdown rather than an error. Callers pass TLS settings here
       * (self-signed certificates, client certs); the socket lifecycle is not
       * theirs to choose.
       */
      keepAlive: false,
    });

    for (const agent of [httpAgent, httpsAgent]) {
      const originalCreateConnection: (
        options: unknown,
        callback?: unknown,
      ) => net.Socket = (agent as any).createConnection.bind(agent);

      (agent as any).createConnection = (
        options: unknown,
        callback?: unknown,
      ): net.Socket => {
        const socket: net.Socket = originalCreateConnection(options, callback);
        collector.attach(socket);
        return socket;
      };
    }

    return { httpAgent, httpsAgent };
  }
}

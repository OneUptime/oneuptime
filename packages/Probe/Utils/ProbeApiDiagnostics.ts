import {
  HTTPS_PROXY_URL,
  HTTP_PROXY_URL,
  NO_PROXY,
  PROBE_API_REQUEST_TIMEOUT_IN_MS,
  PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS,
  PROBE_INGEST_URL,
} from "../Config";
import ProxyConfig, { ProxyAgents } from "./ProxyConfig";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API, { RequestOutcome } from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import dns from "dns";
import net from "net";
import os from "os";
import tls from "tls";
import { URL as NodeURL } from "url";

/*
 * Everything in this file exists to answer one support question that the
 * probe could not answer before: "the probe says
 * `timeout of 45000ms exceeded` — timed out WHERE?".
 *
 * An axios timeout is the same string whether the probe never got a socket,
 * never completed the TCP handshake, never finished the TLS handshake, or
 * connected fine and the server simply never wrote a byte back. Those are
 * four completely different tickets — firewall, proxy, TLS interception,
 * overloaded server — and the probe used to dump a 200-line axios object
 * that distinguishes none of them.
 *
 * So on every failed control-plane request the probe now prints:
 *   - which phase the request was stuck in, read off the real socket,
 *   - how long it ACTUALLY took vs the deadline it was given (a big overrun
 *     means this probe's event loop was blocked, not that the network was),
 *   - whether a proxy was in play for that URL,
 *   - the probe's own health (event-loop stalls, memory, in-flight requests),
 *   - how long it has been since anything reached the server at all,
 * and, once failures start repeating, a staged DNS → TCP → TLS → HTTP
 * connectivity test against the same server so the break point is named
 * outright.
 */

export enum ProbeRequestStallPhase {
  // The request never got a TCP socket from the agent / proxy at all.
  SocketAssignment = "SocketAssignment",
  // A socket was created but the TCP handshake never completed.
  TcpConnect = "TcpConnect",
  // TCP connected, but TLS never finished negotiating.
  TlsHandshake = "TlsHandshake",
  // Connected, but the request body was never fully written out.
  RequestSend = "RequestSend",
  // Request sent in full; the server never sent a single byte back.
  WaitingForServerResponse = "WaitingForServerResponse",
  // Response headers arrived; the body never finished.
  ResponseBody = "ResponseBody",
  // The socket state did not survive the failure (nothing to read).
  Unknown = "Unknown",
}

const STALL_PHASE_EXPLANATION: Record<ProbeRequestStallPhase, string> = {
  [ProbeRequestStallPhase.SocketAssignment]:
    "The request never got a TCP socket. Nothing left this machine. Either the HTTP agent's socket pool was saturated by other in-flight requests (see probeProcess.inFlightRequestCount below), or — when a proxy is configured — the proxy never completed the CONNECT tunnel. Check the proxy first if one is listed under `proxy` below.",
  [ProbeRequestStallPhase.TcpConnect]:
    "A socket was opened but the TCP handshake never completed: this machine sent SYN and nothing came back. That is a dropped-packet signature — a firewall, security appliance or NAT/routing problem between this probe and the OneUptime server, or a server that is not listening on that port. Confirm with the connectivity self-test below (`tcpConnect`).",
  [ProbeRequestStallPhase.TlsHandshake]:
    "TCP connected but the TLS handshake never completed. Usually a TLS-inspecting middlebox, a server under so much load that it accepts connections it cannot service, or a protocol/cipher mismatch. The connectivity self-test below (`tlsHandshake`) reproduces this in isolation.",
  [ProbeRequestStallPhase.RequestSend]:
    "The connection was established but the request body was never fully written to the socket. The far end stopped reading (its receive window closed), which points at a stalled proxy or load balancer rather than at this probe.",
  [ProbeRequestStallPhase.WaitingForServerResponse]:
    "The request was delivered in full and the server never sent back a single byte before the deadline. This probe's network path is FINE — the request is sitting on the OneUptime server, its load balancer or its reverse proxy. Look at the server-side logs for this route at the timestamp below, and at server database/queue latency.",
  [ProbeRequestStallPhase.ResponseBody]:
    "Response headers arrived but the body never completed. The server started answering and then stalled part-way — usually a backend that is streaming a slow query result, or a proxy that dropped the connection mid-response.",
  [ProbeRequestStallPhase.Unknown]:
    "The socket state could not be read off this failure, so the stall point is unknown. The connectivity self-test below is the next thing to read.",
};

interface InFlightRequest {
  url: string;
  startedAtInMs: number;
}

/*
 * Sampling interval for the event-loop drift check. Anything the probe does
 * synchronously for longer than this (a big subnet sweep, a synthetic
 * monitor script, JSON.parse of a huge payload) shows up as drift — and a
 * blocked event loop makes axios report a timeout that never actually
 * elapsed on the wire.
 */
const EVENT_LOOP_SAMPLE_INTERVAL_IN_MS: number = 1000;
const EVENT_LOOP_SAMPLE_WINDOW: number = 60;
const EVENT_LOOP_DRIFT_WARN_THRESHOLD_IN_MS: number = 2000;

// Consecutive transport failures before the staged self-test is worth running.
const SELF_TEST_FAILURE_THRESHOLD: number = 3;
// ...and how often it may run, so a fully offline probe does not spam its log.
const SELF_TEST_MIN_INTERVAL_IN_MS: number = 5 * 60 * 1000;

const SELF_TEST_STAGE_TIMEOUT_IN_MS: number = 10000;

// An options object built but never fetched would otherwise leak an entry.
const IN_FLIGHT_ENTRY_MAX_AGE_IN_MS: number = 10 * 60 * 1000;

export default class ProbeApiDiagnostics {
  private static inFlightRequests: Map<number, InFlightRequest> = new Map();
  private static nextInFlightRequestId: number = 1;

  private static consecutiveFailureCount: number = 0;
  private static lastSuccessfulContactAtInMs: number | null = null;
  private static lastFailureAtInMs: number | null = null;
  private static failureCountByRoute: Map<string, number> = new Map();

  private static eventLoopDriftSamplesInMs: Array<number> = [];
  private static eventLoopSampler: NodeJS.Timeout | null = null;

  private static lastSelfTestAtInMs: number | null = null;
  private static isSelfTestRunning: boolean = false;

  // Exported for tests: wipes every counter this module accumulates.
  public static reset(): void {
    this.inFlightRequests.clear();
    this.nextInFlightRequestId = 1;
    this.consecutiveFailureCount = 0;
    this.lastSuccessfulContactAtInMs = null;
    this.lastFailureAtInMs = null;
    this.failureCountByRoute.clear();
    this.eventLoopDriftSamplesInMs = [];
    this.lastSelfTestAtInMs = null;
    this.isSelfTestRunning = false;
  }

  /*
   * Starts the event-loop drift sampler. Unref'd, so it never keeps the
   * process alive on its own.
   */
  public static startProcessMonitor(): void {
    if (this.eventLoopSampler) {
      return;
    }

    let lastTickAtInMs: number = Date.now();

    this.eventLoopSampler = setInterval((): void => {
      const nowInMs: number = Date.now();
      const driftInMs: number = Math.max(
        0,
        nowInMs - lastTickAtInMs - EVENT_LOOP_SAMPLE_INTERVAL_IN_MS,
      );
      lastTickAtInMs = nowInMs;

      this.eventLoopDriftSamplesInMs.push(driftInMs);

      if (this.eventLoopDriftSamplesInMs.length > EVENT_LOOP_SAMPLE_WINDOW) {
        this.eventLoopDriftSamplesInMs.shift();
      }

      if (driftInMs >= EVENT_LOOP_DRIFT_WARN_THRESHOLD_IN_MS) {
        logger.warn(
          `Probe event loop was blocked for ${driftInMs}ms. While it is blocked no HTTP response can be read and no timer can fire, so requests to the OneUptime server can report a timeout that never elapsed on the network.`,
        );
      }
    }, EVENT_LOOP_SAMPLE_INTERVAL_IN_MS);

    this.eventLoopSampler.unref();
  }

  public static stopProcessMonitor(): void {
    if (!this.eventLoopSampler) {
      return;
    }

    clearInterval(this.eventLoopSampler);
    this.eventLoopSampler = null;
  }

  /*
   * Called as the request options are built — i.e. immediately before the
   * fetch — so the probe knows what is in flight when a later request
   * fails. Returns the id to hand back to onRequestComplete.
   */
  public static beginRequest(url: URL): number {
    const id: number = this.nextInFlightRequestId++;

    this.pruneStaleInFlightRequests();

    this.inFlightRequests.set(id, {
      url: url.toString(),
      startedAtInMs: Date.now(),
    });

    return id;
  }

  public static onRequestComplete(
    inFlightRequestId: number,
    outcome: RequestOutcome,
  ): void {
    this.inFlightRequests.delete(inFlightRequestId);

    /*
     * A 4xx/5xx still proves the whole network path works, so it counts as
     * contact with the server: only a transport failure resets the streak.
     */
    if (outcome.statusCode !== undefined) {
      this.recordServerContact();
      this.logSlowSuccess(outcome);
      return;
    }

    this.recordTransportFailure(outcome);
  }

  private static logSlowSuccess(outcome: RequestOutcome): void {
    if (outcome.elapsedInMs < PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS) {
      return;
    }

    /*
     * Slow-but-successful requests are the leading indicator of the failure
     * this whole file is about: the server gets slower, then crosses the
     * request deadline, then the probe is marked Disconnected. Logging them
     * gives support a trend instead of a cliff.
     */
    logger.warn(
      `Slow request to the OneUptime server: ${outcome.method} ${outcome.url} took ${outcome.elapsedInMs}ms (status ${outcome.statusCode}, deadline ${
        outcome.timeoutInMs ?? PROBE_API_REQUEST_TIMEOUT_IN_MS
      }ms). Requests that cross the deadline are what mark this probe Disconnected.`,
    );
  }

  private static recordServerContact(): void {
    this.consecutiveFailureCount = 0;
    this.lastSuccessfulContactAtInMs = Date.now();
  }

  private static recordTransportFailure(outcome: RequestOutcome): void {
    this.consecutiveFailureCount++;
    this.lastFailureAtInMs = Date.now();

    const route: string = ProbeApiDiagnostics.getRouteFromUrl(outcome.url);

    this.failureCountByRoute.set(
      route,
      (this.failureCountByRoute.get(route) || 0) + 1,
    );

    const report: JSONObject = this.buildFailureReport(outcome);

    logger.error(
      `Request to the OneUptime server FAILED: ${outcome.method} ${outcome.url} after ${outcome.elapsedInMs}ms — ${
        outcome.error?.message || "unknown error"
      }`,
    );
    logger.error(JSON.stringify(report, null, 2));

    this.maybeRunConnectivitySelfTest();
  }

  public static buildFailureReport(outcome: RequestOutcome): JSONObject {
    const connection: JSONObject = this.getConnectionSnapshot(
      outcome.axiosError,
    );

    const stallPhase: ProbeRequestStallPhase = this.getStallPhase(
      outcome,
      connection,
    );

    const deadlineInMs: number =
      outcome.timeoutInMs ?? PROBE_API_REQUEST_TIMEOUT_IN_MS;

    /*
     * How late the client-side deadline fired. axios starts its timer when
     * the request is created, so an overrun means this process could not run
     * the timer callback on time — the probe was blocked, and the network may
     * be blameless.
     */
    const deadlineOverrunInMs: number = Math.max(
      0,
      outcome.elapsedInMs - deadlineInMs,
    );

    const report: JSONObject = {
      request: {
        method: outcome.method,
        url: outcome.url,
        attempts: outcome.attempts,
        elapsedInMs: outcome.elapsedInMs,
        deadlineInMs: deadlineInMs,
        deadlineOverrunInMs: deadlineOverrunInMs,
        failedAt: new Date().toISOString(),
      },
      error: {
        message: outcome.error?.message || "",
        code: (outcome.axiosError as any)?.code || null,
      },
      stalledAt: stallPhase,
      whatThisMeans: STALL_PHASE_EXPLANATION[stallPhase],
      connection: connection,
      proxy: this.getProxySnapshot(outcome.url),
      probeProcess: this.getProcessSnapshot(),
      serverContact: this.getServerContactSnapshot(),
    };

    if (deadlineOverrunInMs > 1000) {
      report["alsoNote"] =
        `The ${deadlineInMs}ms deadline fired ${deadlineOverrunInMs}ms late. Node.js could not run its own timer on time, which means this probe process was blocked (busy event loop) or the machine was suspended/throttled. Check probeProcess.eventLoopMaxDriftInMs below before blaming the network.`;
    }

    return report;
  }

  /*
   * Reads the real socket off the failed request. This is the part that
   * turns "timeout" into a phase: bytesRead === 0 on a connected TLS socket
   * is a server-side stall, no socket at all is a client-side one.
   */
  public static getConnectionSnapshot(axiosError: unknown): JSONObject {
    const clientRequest: any = this.getClientRequest(axiosError);

    if (!clientRequest) {
      /*
       * No ClientRequest to read — an error raised before axios ever built
       * one, or a non-axios failure. Distinguished from "a request was made
       * and got no socket": the latter is a real finding, this is an absence
       * of evidence and must not be reported as one.
       */
      return {
        requestObjectAvailable: false,
        socketAssigned: false,
        detail: "No request object to inspect.",
      };
    }

    const socket: any = clientRequest.socket || null;

    const snapshot: JSONObject = {
      requestObjectAvailable: true,
      socketAssigned: Boolean(socket),
      responseHeadersReceived: Boolean(clientRequest.res),
      redirectCount: this.readNumber(
        (axiosError as any)?.request?._redirectCount,
      ),
      requestBodyLengthInBytes: this.readNumber(
        (axiosError as any)?.request?._requestBodyLength,
      ),
    };

    if (clientRequest.res && clientRequest.res.statusCode) {
      snapshot["responseStatusCode"] = clientRequest.res.statusCode;
    }

    if (!socket) {
      return snapshot;
    }

    /*
     * Node clears a socket's address fields once its handle is gone, and
     * axios destroys the socket as it raises the timeout — so these are
     * present for an error that surfaced with the socket still open, and
     * absent otherwise. Reported only when real: a hardcoded null next to
     * "remoteAddress" reads as "we could not resolve the host", which is a
     * different and much more alarming claim.
     */
    if (socket.remoteAddress) {
      snapshot["remoteAddress"] = socket.remoteAddress;
      snapshot["remotePort"] = this.readNumber(socket.remotePort);
    }

    if (socket.localAddress) {
      snapshot["localAddress"] = socket.localAddress;
      snapshot["localPort"] = this.readNumber(socket.localPort);
    }

    snapshot["tcpHandshakeStillPending"] = Boolean(socket.connecting);
    snapshot["socketReused"] = Boolean(clientRequest.reusedSocket);
    snapshot["bytesWrittenToServer"] = this.readNumber(socket.bytesWritten);
    snapshot["bytesReadFromServer"] = this.readNumber(socket.bytesRead);
    snapshot["socketReadyState"] = socket.readyState || null;
    snapshot["socketDestroyed"] = Boolean(socket.destroyed);

    if (typeof socket.getProtocol === "function") {
      const negotiatedProtocol: string | null = socket.getProtocol() || null;

      const tlsSnapshot: JSONObject = {
        negotiated: Boolean(negotiatedProtocol),
        protocol: negotiatedProtocol,
        authorized: Boolean(socket.authorized),
      };

      if (socket.authorizationError) {
        tlsSnapshot["authorizationError"] = String(socket.authorizationError);
      }

      if (typeof socket.getCipher === "function") {
        tlsSnapshot["cipher"] = socket.getCipher()?.name || null;
      }

      snapshot["tls"] = tlsSnapshot;
    }

    return snapshot;
  }

  private static getStallPhase(
    outcome: RequestOutcome,
    connection: JSONObject,
  ): ProbeRequestStallPhase {
    // A response arrived, so this was not a stall at all.
    if (outcome.statusCode !== undefined) {
      return ProbeRequestStallPhase.Unknown;
    }

    if (connection["requestObjectAvailable"] !== true) {
      return ProbeRequestStallPhase.Unknown;
    }

    if (connection["socketAssigned"] !== true) {
      return ProbeRequestStallPhase.SocketAssignment;
    }

    if (connection["tcpHandshakeStillPending"] === true) {
      return ProbeRequestStallPhase.TcpConnect;
    }

    const tlsSnapshot: JSONObject | undefined = connection["tls"] as
      | JSONObject
      | undefined;

    if (tlsSnapshot && tlsSnapshot["negotiated"] !== true) {
      return ProbeRequestStallPhase.TlsHandshake;
    }

    if (connection["responseHeadersReceived"] === true) {
      return ProbeRequestStallPhase.ResponseBody;
    }

    const bytesWritten: unknown = connection["bytesWrittenToServer"];
    const bytesRead: unknown = connection["bytesReadFromServer"];

    if (typeof bytesRead !== "number" || typeof bytesWritten !== "number") {
      return ProbeRequestStallPhase.Unknown;
    }

    if (bytesWritten === 0) {
      return ProbeRequestStallPhase.RequestSend;
    }

    if (bytesRead === 0) {
      return ProbeRequestStallPhase.WaitingForServerResponse;
    }

    return ProbeRequestStallPhase.ResponseBody;
  }

  private static getClientRequest(axiosError: unknown): any | null {
    try {
      const request: any = (axiosError as any)?.request;

      if (!request) {
        return null;
      }

      /*
       * axios routes through follow-redirects, whose RedirectableRequest
       * wraps the ClientRequest that actually owns the socket.
       */
      return request._currentRequest || request;
    } catch {
      return null;
    }
  }

  public static getProxySnapshot(targetUrl: string): JSONObject {
    const isProxyConfigured: boolean = ProxyConfig.isProxyConfigured();

    const snapshot: JSONObject = {
      configured: isProxyConfigured,
    };

    if (!isProxyConfigured) {
      return snapshot;
    }

    const agents: Readonly<ProxyAgents> =
      ProxyConfig.getRequestProxyAgents(targetUrl);

    snapshot["usedForThisRequest"] = Object.keys(agents).length > 0;
    snapshot["httpProxyUrl"] = this.redactCredentials(HTTP_PROXY_URL);
    snapshot["httpsProxyUrl"] = this.redactCredentials(HTTPS_PROXY_URL);
    snapshot["noProxy"] = NO_PROXY;

    return snapshot;
  }

  public static getProcessSnapshot(): JSONObject {
    const memory: NodeJS.MemoryUsage = process.memoryUsage();

    const toMb: (bytes: number) => number = (bytes: number): number => {
      return Math.round(bytes / 1024 / 1024);
    };

    const inFlight: Array<JSONObject> = [];

    for (const request of this.inFlightRequests.values()) {
      inFlight.push({
        url: request.url,
        inFlightForMs: Date.now() - request.startedAtInMs,
      });
    }

    const snapshot: JSONObject = {
      eventLoopMaxDriftInMs: this.getMaxEventLoopDriftInMs(),
      inFlightRequestCount: inFlight.length,
      inFlightRequests: inFlight,
      rssInMb: toMb(memory.rss),
      heapUsedInMb: toMb(memory.heapUsed),
      heapTotalInMb: toMb(memory.heapTotal),
      freeSystemMemoryInMb: toMb(os.freemem()),
      uptimeInSeconds: Math.round(process.uptime()),
    };

    /*
     * getActiveResourcesInfo lands in Node 17.3; on anything older the probe
     * simply reports one fewer field rather than crashing its own error path.
     */
    const getActiveResourcesInfo: unknown = (process as any)
      .getActiveResourcesInfo;

    if (typeof getActiveResourcesInfo === "function") {
      try {
        snapshot["activeHandleCount"] = (
          getActiveResourcesInfo.call(process) as Array<string>
        ).length;
      } catch {
        // Best effort only.
      }
    }

    return snapshot;
  }

  private static getMaxEventLoopDriftInMs(): number {
    if (this.eventLoopDriftSamplesInMs.length === 0) {
      return 0;
    }

    return Math.max(...this.eventLoopDriftSamplesInMs);
  }

  public static getServerContactSnapshot(): JSONObject {
    const failuresByRoute: JSONObject = {};

    for (const [route, count] of this.failureCountByRoute.entries()) {
      failuresByRoute[route] = count;
    }

    return {
      consecutiveFailures: this.consecutiveFailureCount,
      lastSuccessfulContactAt: this.lastSuccessfulContactAtInMs
        ? new Date(this.lastSuccessfulContactAtInMs).toISOString()
        : "never since this probe started",
      secondsSinceLastSuccessfulContact: this.lastSuccessfulContactAtInMs
        ? Math.round((Date.now() - this.lastSuccessfulContactAtInMs) / 1000)
        : null,
      lastFailureAt: this.lastFailureAtInMs
        ? new Date(this.lastFailureAtInMs).toISOString()
        : null,
      failuresByRoute: failuresByRoute,
    };
  }

  private static pruneStaleInFlightRequests(): void {
    const nowInMs: number = Date.now();

    for (const [id, request] of this.inFlightRequests.entries()) {
      if (nowInMs - request.startedAtInMs > IN_FLIGHT_ENTRY_MAX_AGE_IN_MS) {
        this.inFlightRequests.delete(id);
      }
    }
  }

  private static getRouteFromUrl(url: string): string {
    try {
      return new NodeURL(url).pathname;
    } catch {
      return url;
    }
  }

  private static redactCredentials(proxyUrl: string | null): string | null {
    if (!proxyUrl) {
      return null;
    }

    try {
      const parsed: NodeURL = new NodeURL(proxyUrl);

      if (parsed.username || parsed.password) {
        parsed.username = "***";
        parsed.password = "***";
      }

      return parsed.toString();
    } catch {
      return "unparseable proxy url";
    }
  }

  private static readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  /*
   * Runs the staged self-test once failures start repeating, rate-limited so
   * a probe that is genuinely offline logs one block every few minutes
   * instead of one per failed request.
   */
  public static maybeRunConnectivitySelfTest(): void {
    if (this.consecutiveFailureCount < SELF_TEST_FAILURE_THRESHOLD) {
      return;
    }

    if (this.isSelfTestRunning) {
      return;
    }

    if (
      this.lastSelfTestAtInMs !== null &&
      Date.now() - this.lastSelfTestAtInMs < SELF_TEST_MIN_INTERVAL_IN_MS
    ) {
      return;
    }

    this.lastSelfTestAtInMs = Date.now();
    this.isSelfTestRunning = true;

    this.runConnectivitySelfTest()
      .then((result: JSONObject): void => {
        logger.error(
          `Connectivity self-test against ${PROBE_INGEST_URL.toString()} (run after ${this.consecutiveFailureCount} consecutive failures):`,
        );
        logger.error(JSON.stringify(result, null, 2));
      })
      .catch((err: unknown): void => {
        logger.error("Connectivity self-test could not be completed");
        logger.error(err);
      })
      .finally((): void => {
        this.isSelfTestRunning = false;
      });
  }

  /*
   * Walks the connection up one layer at a time against the same server the
   * failing request used. The first stage that fails IS the answer, and each
   * stage is timed so "works but takes 9 seconds" is visible too.
   */
  public static async runConnectivitySelfTest(): Promise<JSONObject> {
    const ingestUrl: string = PROBE_INGEST_URL.toString();

    let parsedUrl: NodeURL;

    try {
      parsedUrl = new NodeURL(ingestUrl);
    } catch {
      return { error: `Could not parse PROBE_INGEST_URL: ${ingestUrl}` };
    }

    const isHttps: boolean = parsedUrl.protocol === "https:";
    const serverHost: string = parsedUrl.hostname;
    const serverPort: number = parsedUrl.port
      ? Number(parsedUrl.port)
      : isHttps
        ? 443
        : 80;

    const proxyAgents: Readonly<ProxyAgents> =
      ProxyConfig.getRequestProxyAgents(ingestUrl);
    const isProxied: boolean = Object.keys(proxyAgents).length > 0;

    /*
     * With a proxy in the path, a direct socket to the OneUptime server
     * proves nothing (the probe never opens one) — the hop that matters is
     * the one to the proxy, so that is what gets tested.
     */
    const proxyUrl: string | null = isProxied
      ? HTTPS_PROXY_URL || HTTP_PROXY_URL
      : null;

    let tcpTarget: { host: string; port: number } = {
      host: serverHost,
      port: serverPort,
    };

    if (proxyUrl) {
      try {
        const parsedProxy: NodeURL = new NodeURL(proxyUrl);
        tcpTarget = {
          host: parsedProxy.hostname,
          port: parsedProxy.port
            ? Number(parsedProxy.port)
            : parsedProxy.protocol === "https:"
              ? 443
              : 80,
        };
      } catch {
        // Fall through to testing the server directly.
      }
    }

    const testedHopNote: string = proxyUrl
      ? " (the proxy — with one configured the probe never connects to the server directly)"
      : "";

    const tcpConnect: JSONObject = await this.testTcpConnect(
      tcpTarget.host,
      tcpTarget.port,
    );

    const result: JSONObject = {
      target: ingestUrl,
      throughProxy: isProxied,
      testedHop: `${tcpTarget.host}:${tcpTarget.port}${testedHopNote}`,
      dnsResolution: await this.testDnsResolution(tcpTarget.host),
      tcpConnect: tcpConnect,
    };

    /*
     * TLS is only meaningful end-to-end when the probe speaks it directly;
     * through a CONNECT tunnel the handshake belongs to the proxy hop.
     */
    if (isHttps && !isProxied) {
      /*
       * Attempting TLS on a hop that would not even connect burns another
       * stage timeout to report the same fact twice — and worse, its "TCP
       * connects but TLS never finishes" reading would contradict the stage
       * above it.
       */
      result["tlsHandshake"] =
        tcpConnect["ok"] === true
          ? await this.testTlsHandshake(serverHost, serverPort)
          : {
              ok: false,
              skipped:
                "Not attempted: the TCP stage above never connected, so there is nothing to negotiate TLS over.",
            };
    }

    result["httpRequest"] = await this.testHttpRequest(parsedUrl);

    return result;
  }

  private static async testDnsResolution(
    hostname: string,
  ): Promise<JSONObject> {
    const startedAtInMs: number = Date.now();

    /*
     * An IP literal has nothing to resolve; saying so is clearer than a
     * lookup that trivially "passes".
     */
    if (net.isIP(hostname) !== 0) {
      return {
        ok: true,
        skipped: "Host is an IP literal, so there is no DNS step.",
      };
    }

    try {
      const addresses: Array<dns.LookupAddress> = await dns.promises.lookup(
        hostname,
        { all: true },
      );

      return {
        ok: true,
        elapsedInMs: Date.now() - startedAtInMs,
        hostname: hostname,
        addresses: addresses.map((address: dns.LookupAddress): string => {
          return `${address.address} (IPv${address.family})`;
        }),
        systemResolvers: dns.getServers(),
      };
    } catch (err) {
      return {
        ok: false,
        elapsedInMs: Date.now() - startedAtInMs,
        hostname: hostname,
        error: (err as Error).message || String(err),
        systemResolvers: dns.getServers(),
        meaning:
          "This machine cannot resolve the OneUptime server's hostname. Nothing else can work until DNS does.",
      };
    }
  }

  private static testTcpConnect(
    host: string,
    port: number,
  ): Promise<JSONObject> {
    return new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
      const startedAtInMs: number = Date.now();

      const socket: net.Socket = new net.Socket();

      const settle: (value: JSONObject) => void = (value: JSONObject): void => {
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(SELF_TEST_STAGE_TIMEOUT_IN_MS);

      socket.once("connect", (): void => {
        settle({
          ok: true,
          elapsedInMs: Date.now() - startedAtInMs,
          target: `${host}:${port}`,
          connectedTo: socket.remoteAddress || null,
          localPort: socket.localPort ?? null,
        });
      });

      socket.once("timeout", (): void => {
        settle({
          ok: false,
          elapsedInMs: Date.now() - startedAtInMs,
          target: `${host}:${port}`,
          error: `No TCP handshake within ${SELF_TEST_STAGE_TIMEOUT_IN_MS}ms`,
          meaning:
            "SYN packets are leaving this machine and nothing is coming back — a firewall or security appliance is dropping them silently, or the host is unreachable.",
        });
      });

      socket.once("error", (err: Error): void => {
        settle({
          ok: false,
          elapsedInMs: Date.now() - startedAtInMs,
          target: `${host}:${port}`,
          error: err.message,
        });
      });

      socket.connect(port, host);
    });
  }

  private static testTlsHandshake(
    host: string,
    port: number,
  ): Promise<JSONObject> {
    return new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
      const startedAtInMs: number = Date.now();

      const socket: tls.TLSSocket = tls.connect({
        host: host,
        port: port,
        // SNI with an IP literal is disallowed by RFC 6066 and Node warns.
        ...(net.isIP(host) === 0 ? { servername: host } : {}),
        timeout: SELF_TEST_STAGE_TIMEOUT_IN_MS,
      });

      const settle: (value: JSONObject) => void = (value: JSONObject): void => {
        socket.destroy();
        resolve(value);
      };

      socket.once("secureConnect", (): void => {
        const certificate: tls.PeerCertificate = socket.getPeerCertificate();

        settle({
          ok: true,
          elapsedInMs: Date.now() - startedAtInMs,
          protocol: socket.getProtocol(),
          cipher: socket.getCipher()?.name || null,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError
            ? String(socket.authorizationError)
            : null,
          certificate: {
            subject: certificate?.subject?.CN || null,
            issuer: certificate?.issuer?.CN || null,
            validFrom: certificate?.valid_from || null,
            validTo: certificate?.valid_to || null,
          },
        });
      });

      socket.once("timeout", (): void => {
        settle({
          ok: false,
          elapsedInMs: Date.now() - startedAtInMs,
          error: `TLS handshake did not complete within ${SELF_TEST_STAGE_TIMEOUT_IN_MS}ms`,
          meaning:
            "TCP connects but TLS never finishes. A TLS-inspecting middlebox in the path is the usual cause.",
        });
      });

      socket.once("error", (err: Error): void => {
        settle({
          ok: false,
          elapsedInMs: Date.now() - startedAtInMs,
          error: err.message,
        });
      });
    });
  }

  /*
   * The last stage: a real, unauthenticated HTTP round trip over the same
   * path (proxy included) the probe's control-plane requests take. Any
   * status code is a pass — it proves the far end answers HTTP; only a
   * transport failure here is a finding.
   */
  private static async testHttpRequest(
    parsedUrl: NodeURL,
  ): Promise<JSONObject> {
    const statusUrl: URL = URL.fromString(
      `${parsedUrl.protocol}//${parsedUrl.host}/status`,
    );

    const startedAtInMs: number = Date.now();

    try {
      const response: { statusCode: number } = await API.get<JSONObject>({
        url: statusUrl,
        options: {
          ...ProxyConfig.getRequestProxyAgents(statusUrl),
          timeout: SELF_TEST_STAGE_TIMEOUT_IN_MS,
        },
      });

      return {
        ok: true,
        url: statusUrl.toString(),
        elapsedInMs: Date.now() - startedAtInMs,
        statusCode: response.statusCode,
      };
    } catch (err) {
      return {
        ok: false,
        url: statusUrl.toString(),
        elapsedInMs: Date.now() - startedAtInMs,
        error: (err as Error).message || String(err),
        meaning:
          "The lower layers may be fine but no HTTP response came back. If DNS/TCP/TLS above all passed, the OneUptime server or whatever sits in front of it is not answering.",
      };
    }
  }

  /*
   * One block, printed at startup, that captures everything support
   * otherwise has to ask for: which server, which deadline, which proxy,
   * which Node/OS, and whether TLS verification has been tampered with.
   */
  public static logStartupEnvironment(): void {
    const environment: JSONObject = {
      probeIngestUrl: PROBE_INGEST_URL.toString(),
      apiRequestDeadlineInMs: PROBE_API_REQUEST_TIMEOUT_IN_MS,
      slowRequestWarningThresholdInMs: PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS,
      proxy: this.getProxySnapshot(PROBE_INGEST_URL.toString()),
      host: {
        hostname: os.hostname(),
        platform: `${os.platform()} ${os.release()}`,
        arch: os.arch(),
        cpuCount: os.cpus().length,
        totalMemoryInMb: Math.round(os.totalmem() / 1024 / 1024),
        nodeVersion: process.version,
      },
      tls: {
        nodeExtraCaCerts: process.env["NODE_EXTRA_CA_CERTS"] || null,
        certificateVerificationDisabled:
          process.env["NODE_TLS_REJECT_UNAUTHORIZED"] === "0",
      },
      systemResolvers: dns.getServers(),
    };

    logger.info("Probe environment (include this when reporting an issue):");
    logger.info(JSON.stringify(environment, null, 2));
  }
}

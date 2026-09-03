import {
  PROBE_ALLOW_PRIVATE_NETWORK_MONITORS,
  PROBE_PRIVATE_NETWORK_HINT,
} from "../../Config";
import { HttpTimingAgents, HttpTimingCollector } from "../HttpTimingAgents";
import ProxyConfig from "../ProxyConfig";
import DataSourceEgressGuard, {
  EgressLookupFunction,
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import Headers from "Common/Types/API/Headers";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import { JSONObject } from "Common/Types/JSON";
import { HTTPResponseBodyBudget } from "Common/Utils/HTTPResponseBodyReader";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import http from "http";
import https from "https";
import net from "net";

/*
 * Monitor response bodies are stored and shown back to the project. Leaving
 * Axios's default of "unlimited" here lets a tenant-selected endpoint exhaust
 * a shared global probe before the per-step timeout gets a chance to help.
 */
export const HTTP_MONITOR_MAX_RESPONSE_BYTES: number = 512 * 1024;

/*
 * Request bodies are authored by the monitor owner rather than downloaded
 * from an untrusted server. Keep the established 10 MiB compatibility limit
 * separate from the tighter response cap so large API checks still work.
 */
export const HTTP_MONITOR_MAX_REQUEST_BYTES: number = 10 * 1024 * 1024;

/*
 * Axios/follow-redirects normally allows 21 hops. Ten is enough for real-world
 * canonicalisation chains while putting a firm ceiling on validation, DNS and
 * connection work controlled by a monitor author.
 */
export const HTTP_MONITOR_MAX_REDIRECTS: number = 10;

export class HttpMonitorExecutionContext {
  private readonly abortController: AbortController = new AbortController();
  private readonly deadlineInMs: number;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  public readonly responseBodyBudget: HTTPResponseBodyBudget;

  public constructor(
    timeoutInMs: number,
    maximumResponseBytes: number = HTTP_MONITOR_MAX_RESPONSE_BYTES,
  ) {
    const safeTimeoutInMs: number = Math.max(1, timeoutInMs);
    this.deadlineInMs = Date.now() + safeTimeoutInMs;
    this.responseBodyBudget = new HTTPResponseBodyBudget(maximumResponseBytes);
    this.deadlineTimer = setTimeout(() => {
      this.abortController.abort();
    }, safeTimeoutInMs);
  }

  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public remainingTimeoutInMs(): number {
    const remainingInMs: number = this.deadlineInMs - Date.now();

    if (remainingInMs <= 0 || this.signal.aborted) {
      this.abortController.abort();
      throw this.timeoutException();
    }

    return Math.max(1, remainingInMs);
  }

  public canWait(waitInMs: number): boolean {
    return !this.signal.aborted && Date.now() + waitInMs < this.deadlineInMs;
  }

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    this.remainingTimeoutInMs();

    let abortListener: (() => void) | undefined;
    const aborted: Promise<never> = new Promise(
      (_resolve: (value: never) => void, reject: (error: Error) => void) => {
        abortListener = (): void => {
          reject(this.timeoutException());
        };
        this.signal.addEventListener("abort", abortListener, { once: true });
      },
    );

    try {
      return await Promise.race([operation(), aborted]);
    } catch (error) {
      if (this.signal.aborted) {
        throw this.timeoutException();
      }
      throw error;
    } finally {
      if (abortListener) {
        this.signal.removeEventListener("abort", abortListener);
      }
    }
  }

  public async sleep(waitInMs: number): Promise<void> {
    if (!this.canWait(waitInMs)) {
      throw this.timeoutException();
    }

    await this.run(async (): Promise<void> => {
      await new Promise<void>(
        (resolve: () => void, reject: (error: Error) => void) => {
          const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
            this.signal.removeEventListener("abort", onAbort);
            resolve();
          }, waitInMs);
          const onAbort: () => void = (): void => {
            clearTimeout(timer);
            reject(this.timeoutException());
          };
          this.signal.addEventListener("abort", onAbort, { once: true });
        },
      );
    });
  }

  public dispose(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = undefined;
    }
  }

  private timeoutException(): TimeoutException {
    return new TimeoutException("Monitor target request timeout exceeded.");
  }
}

export interface MonitorTlsOptions {
  allowSelfSignedCertificates?: boolean | undefined;
  tlsClientCertificate?: string | undefined;
  tlsClientKey?: string | undefined;
  tlsClientKeyPassphrase?: string | undefined;
}

export interface PreparedHttpMonitorRequest {
  url: URL;
  dispatchUrl: string;
  headers: Headers;
  httpAgent?: http.Agent | undefined;
  httpsAgent?: https.Agent | undefined;
  doNotFollowRedirects: true;
  disableProxy: true;
  maxContentLength: number;
  maxBodyLength: number;
}

export interface RedirectRequest {
  url: string;
  method: HTTPMethod;
  headers: Headers;
  body?: JSONObject | undefined;
  crossesOrigin?: true | undefined;
}

type HttpProxyRequest = Parameters<
  HttpProxyAgent<string>["setRequestProps"]
>[0];
type HttpProxyConnectOptions = Parameters<
  HttpProxyAgent<string>["setRequestProps"]
>[1];
type HttpsProxyRequest = Parameters<HttpsProxyAgent<string>["connect"]>[0];
type HttpsProxyConnectOptions = Parameters<
  HttpsProxyAgent<string>["connect"]
>[1];

/*
 * http-proxy-agent derives the absolute request URI from the Host header.
 * That is normally correct, but a destination-pinned request deliberately
 * keeps the ORIGINAL Host header while its absolute URI must name the
 * validated IP. Temporarily substituting the pinned authority while the
 * agent builds the request line gives the proxy an IP (no second DNS lookup)
 * and restores the hostname before bytes are sent to the target.
 */
export class PinnedHttpProxyAgent extends HttpProxyAgent<string> {
  private readonly pinnedAuthority: string;

  public constructor(proxyUrl: string, pinnedAuthority: string) {
    super(proxyUrl);
    this.pinnedAuthority = pinnedAuthority;
  }

  public override setRequestProps(
    request: HttpProxyRequest,
    options: HttpProxyConnectOptions,
  ): void {
    const originalHost: string | number | string[] | undefined =
      request.getHeader("host");

    /*
     * http-proxy-agent normally resolves request.path against a base URL.
     * An origin-form path beginning with "//" is a network-path reference to
     * WHATWG URL, so resolving it would replace the validated authority (for
     * example, "//169.254.169.254"). Build the absolute proxy target by
     * concatenating the pinned origin and the path first; super then sees an
     * already-absolute URL whose authority cannot be reinterpreted.
     */
    const protocol: string = options.secureEndpoint ? "https:" : "http:";
    const originFormPath: string = request.path.startsWith("/")
      ? request.path
      : `/${request.path}`;
    request.path = `${protocol}//${this.pinnedAuthority}${originFormPath}`;

    request.setHeader("host", this.pinnedAuthority);
    super.setRequestProps(request, options);

    if (originalHost === undefined) {
      request.removeHeader("host");
    } else {
      request.setHeader("host", originalHost);
    }
  }
}

/*
 * HTTPS proxying uses CONNECT. The request URL contains the validated IP so
 * CONNECT cannot be DNS-rebound by the proxy, while TLS still needs the
 * original hostname for SNI and certificate verification.
 */
export class PinnedHttpsProxyAgent extends HttpsProxyAgent<string> {
  private readonly targetServername: string;
  private readonly targetTlsOptions: https.AgentOptions;

  public constructor(
    proxyUrl: string,
    targetServername: string,
    tlsOptions: https.AgentOptions,
  ) {
    /*
     * Constructor options configure TLS to an HTTPS proxy, not TLS through
     * the CONNECT tunnel. Never send the monitor's client certificate to the
     * proxy; merge those options into the target-side connection below.
     */
    super(proxyUrl);
    this.targetServername = targetServername;
    this.targetTlsOptions = tlsOptions;
  }

  public override connect(
    request: HttpsProxyRequest,
    options: HttpsProxyConnectOptions,
  ): ReturnType<HttpsProxyAgent<string>["connect"]> {
    const targetOptions: HttpsProxyConnectOptions = {
      ...options,
      ...this.targetTlsOptions,
      servername: this.targetServername,
    } as HttpsProxyConnectOptions;

    return super.connect(request, targetOptions);
  }
}

export default class HttpMonitorRequest {
  /*
   * Prepare exactly ONE network hop. Callers invoke this again for retries,
   * HEAD->GET fallbacks and every redirect; no agent is reused across a URL
   * chosen by a remote response.
   */
  public static async prepare(
    rawUrl: string | URL,
    options: {
      headers?: Headers | undefined;
      tls?: MonitorTlsOptions | undefined;
      timingCollector?: HttpTimingCollector | undefined;
    } = {},
  ): Promise<PreparedHttpMonitorRequest> {
    const urlString: string = rawUrl.toString();

    let shouldTimeDnsLookup: boolean = false;
    try {
      const candidateUrl: globalThis.URL = new globalThis.URL(urlString);
      shouldTimeDnsLookup =
        net.isIP(candidateUrl.hostname.replace(/^\[|\]$/g, "")) === 0;
    } catch {
      // The egress guard below owns the user-facing malformed-URL error.
    }

    if (shouldTimeDnsLookup) {
      options.timingCollector?.startDnsLookup();
    }

    let validated: {
      url: globalThis.URL;
      addresses: Array<ResolvedAddress>;
    };
    try {
      validated = await DataSourceEgressGuard.assertUrlAllowed(urlString, {
        blockPrivateAddresses: !PROBE_ALLOW_PRIVATE_NETWORK_MONITORS,
        targetLabel: "Monitor target",
        privateNetworkHint: PROBE_PRIVATE_NETWORK_HINT,
        includeResolvedAddressInError: false,
      });
    } finally {
      if (shouldTimeDnsLookup) {
        options.timingCollector?.finishDnsLookup();
      }
    }

    const requestHeaders: Headers = { ...(options.headers || {}) };
    const tlsOptions: https.AgentOptions = this.getTlsAgentOptions(options.tls);
    const pinnedLookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookup(validated.addresses);

    const isHttps: boolean = validated.url.protocol === "https:";
    const configuredProxyAgent: http.Agent | null = isHttps
      ? ProxyConfig.getHttpsProxyAgent(urlString)
      : ProxyConfig.getHttpProxyAgent(urlString);

    if (configuredProxyAgent) {
      const proxyUrl: string | null = isHttps
        ? ProxyConfig.getHttpsProxyUrl()
        : ProxyConfig.getHttpProxyUrl();

      if (!proxyUrl) {
        throw new BadDataException(
          "Monitor target proxy configuration is incomplete.",
        );
      }

      const pinnedAddress: ResolvedAddress = validated.addresses[0]!;
      const pinnedUrl: globalThis.URL = new globalThis.URL(
        validated.url.toString(),
      );
      pinnedUrl.hostname =
        pinnedAddress.family === 6
          ? `[${pinnedAddress.address}]`
          : pinnedAddress.address;

      /*
       * Preserve virtual hosting and HTTPS certificate identity. The proxy
       * routes by the pinned absolute URI / CONNECT address, not this header.
       */
      if (!this.hasHeader(requestHeaders, "host")) {
        requestHeaders["Host"] = validated.url.host;
      }

      if (isHttps) {
        return {
          url: URL.fromStringLenient(pinnedUrl.toString()),
          dispatchUrl: pinnedUrl.href,
          headers: requestHeaders,
          httpsAgent: new PinnedHttpsProxyAgent(
            proxyUrl,
            validated.url.hostname.replace(/^\[|\]$/g, ""),
            tlsOptions,
          ) as unknown as https.Agent,
          doNotFollowRedirects: true,
          disableProxy: true,
          maxContentLength: HTTP_MONITOR_MAX_RESPONSE_BYTES,
          maxBodyLength: HTTP_MONITOR_MAX_REQUEST_BYTES,
        };
      }

      return {
        url: URL.fromStringLenient(pinnedUrl.toString()),
        dispatchUrl: pinnedUrl.href,
        headers: requestHeaders,
        httpAgent: new PinnedHttpProxyAgent(
          proxyUrl,
          pinnedUrl.host,
        ) as unknown as http.Agent,
        doNotFollowRedirects: true,
        disableProxy: true,
        maxContentLength: HTTP_MONITOR_MAX_RESPONSE_BYTES,
        maxBodyLength: HTTP_MONITOR_MAX_REQUEST_BYTES,
      };
    }

    if (options.timingCollector) {
      const agents: { httpAgent: http.Agent; httpsAgent: https.Agent } =
        HttpTimingAgents.create(
          options.timingCollector,
          {
            ...tlsOptions,
            lookup: pinnedLookup as never,
          },
          { lookup: pinnedLookup as never },
        );

      return {
        url: URL.fromStringLenient(validated.url.toString()),
        dispatchUrl: validated.url.href,
        headers: requestHeaders,
        ...agents,
        doNotFollowRedirects: true,
        disableProxy: true,
        maxContentLength: HTTP_MONITOR_MAX_RESPONSE_BYTES,
        maxBodyLength: HTTP_MONITOR_MAX_REQUEST_BYTES,
      };
    }

    const agents: { httpAgent: http.Agent; httpsAgent: https.Agent } = {
      httpAgent: new http.Agent({ lookup: pinnedLookup as never }),
      httpsAgent: new https.Agent({
        ...tlsOptions,
        lookup: pinnedLookup as never,
      }),
    };

    return {
      url: URL.fromStringLenient(validated.url.toString()),
      dispatchUrl: validated.url.href,
      headers: requestHeaders,
      ...agents,
      doNotFollowRedirects: true,
      disableProxy: true,
      maxContentLength: HTTP_MONITOR_MAX_RESPONSE_BYTES,
      maxBodyLength: HTTP_MONITOR_MAX_REQUEST_BYTES,
    };
  }

  public static getRedirectRequest(data: {
    currentUrl: string | URL;
    statusCode: number;
    responseHeaders: Headers;
    currentMethod: HTTPMethod;
    requestHeaders?: Headers | undefined;
    requestBody?: JSONObject | undefined;
    redirectsFollowed: number;
  }): RedirectRequest | null {
    if (![301, 302, 303, 307, 308].includes(data.statusCode)) {
      return null;
    }

    const location: string | undefined = this.getHeader(
      data.responseHeaders,
      "location",
    );
    if (!location) {
      return null;
    }

    if (data.redirectsFollowed >= HTTP_MONITOR_MAX_REDIRECTS) {
      throw new BadDataException(
        `Monitor target exceeded ${HTTP_MONITOR_MAX_REDIRECTS} redirects.`,
      );
    }

    let redirectUrl: globalThis.URL;
    try {
      redirectUrl = new globalThis.URL(location, data.currentUrl.toString());
    } catch {
      throw new BadDataException(
        "Monitor target returned an invalid redirect URL.",
      );
    }

    let method: HTTPMethod = data.currentMethod;
    let body: JSONObject | undefined = data.requestBody;
    let rewroteToGet: boolean = false;

    if (
      (data.statusCode === 303 &&
        data.currentMethod !== HTTPMethod.GET &&
        data.currentMethod !== HTTPMethod.HEAD) ||
      ((data.statusCode === 301 || data.statusCode === 302) &&
        data.currentMethod === HTTPMethod.POST)
    ) {
      method = HTTPMethod.GET;
      body = undefined;
      rewroteToGet = true;
    }

    const currentUrl: globalThis.URL = new globalThis.URL(
      data.currentUrl.toString(),
    );
    const crossesOrigin: boolean = currentUrl.origin !== redirectUrl.origin;

    /*
     * Apply the standard 301/302 POST and 303 method rewrite before deciding
     * whether a cross-origin redirect is safe. Once rewritten to a bodyless
     * GET, an ordinary HTTP-to-HTTPS or canonical-host redirect can continue
     * without replaying the caller's method, body, headers or TLS identity.
     * Methods and bodies that survive the rewrite still fail closed.
     */
    if (
      crossesOrigin &&
      (body !== undefined ||
        ![HTTPMethod.GET, HTTPMethod.HEAD].includes(method))
    ) {
      throw new BadDataException(
        "Monitor target returned an unsafe cross-origin redirect for a request with a method or body that cannot be forwarded.",
      );
    }

    const headers: Headers = crossesOrigin
      ? {}
      : { ...(data.requestHeaders || {}) };

    /* A Host override for one authority must never be carried to another. */
    this.deleteHeader(headers, "host");

    if (rewroteToGet) {
      this.deleteHeader(headers, "content-length");
      this.deleteHeader(headers, "content-type");
    }

    return {
      url: redirectUrl.toString(),
      method: method,
      headers: headers,
      ...(body === undefined ? {} : { body: body }),
      ...(crossesOrigin ? { crossesOrigin: true as const } : {}),
    };
  }

  private static getTlsAgentOptions(
    tlsOptions?: MonitorTlsOptions | undefined,
  ): https.AgentOptions {
    const options: https.AgentOptions = {};

    if (tlsOptions?.allowSelfSignedCertificates) {
      options.rejectUnauthorized = false;
    }

    const certificate: string | undefined =
      tlsOptions?.tlsClientCertificate?.trim() || undefined;
    const key: string | undefined =
      tlsOptions?.tlsClientKey?.trim() || undefined;

    if (certificate && key) {
      options.cert = certificate;
      options.key = key;
      if (tlsOptions?.tlsClientKeyPassphrase) {
        options.passphrase = tlsOptions.tlsClientKeyPassphrase;
      }
    }

    return options;
  }

  private static hasHeader(headers: Headers, wantedName: string): boolean {
    return Object.keys(headers).some((name: string) => {
      return name.toLowerCase() === wantedName.toLowerCase();
    });
  }

  private static getHeader(
    headers: Headers,
    wantedName: string,
  ): string | undefined {
    const name: string | undefined = Object.keys(headers).find(
      (headerName: string) => {
        return headerName.toLowerCase() === wantedName.toLowerCase();
      },
    );

    return name ? headers[name] : undefined;
  }

  private static deleteHeader(headers: Headers, wantedName: string): void {
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === wantedName.toLowerCase()) {
        delete headers[name];
      }
    }
  }
}

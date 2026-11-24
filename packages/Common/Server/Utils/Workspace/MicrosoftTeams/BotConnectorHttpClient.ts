import {
  toHttpHeadersLike,
  type CompatResponse,
  type RequestPolicy,
  type WebResourceLike,
} from "@azure/core-http-compat";
import {
  createDefaultHttpClient,
  createHttpHeaders,
  createPipelineRequest,
  type HttpClient,
  type PipelineRequest,
  type PipelineRequestOptions,
  type PipelineResponse,
} from "@azure/core-rest-pipeline";
import { OutboundProxyRefusal } from "../../OutboundFetch";
import OutboundProxyAgents from "../../OutboundProxyAgents";

/*
 * THE TEAMS BOT'S REPLIES, SENT ON THE OUTBOUND PROXY'S ROUTE (issue
 * #10763).
 *
 * Everything the bot sends to Teams - a reply, a proactive message, a card
 * updated or removed, a conversation started, the members or the team it
 * reads - goes to the Bot Connector (https://smba.trafficmanager.net/...)
 * through the SDK's ConnectorClient and TeamsConnectorClient, which send
 * with @azure/core-rest-pipeline. That pipeline has a proxy policy of its
 * own, and it decides its route its own way, not OneUptime's
 * (OutboundProxy.getProxyFor), checked against
 * @typespec/ts-http-runtime 0.3.8 under @azure/core-rest-pipeline 1.25.0:
 *
 *   - HTTPS_PROXY, then ALL_PROXY, then HTTP_PROXY, whatever the request's
 *     scheme, where OneUptime takes the proxy of its scheme;
 *   - NO_PROXY read once, when the first client is made, split on commas
 *     alone, and matched by the exact host name or a ".suffix": no CIDR
 *     range, no port, no "*", no upper case, no IPv6 address, no loopback
 *     of another spelling;
 *   - a tunnel the proxy refuses comes back from its proxy agent
 *     (https-proxy-agent 7) as if the Bot Connector had answered 403 or
 *     407 itself.
 *
 * It decodes a percent-encoded user name and password (https-proxy-agent
 * and http-proxy-agent 7 call decodeURIComponent on both), so #10442's bug
 * was not this one's. Its proxy is still not OneUptime's.
 *
 * So the SDK's clients are handed this as their HttpClient, through the
 * ConnectorClientOptions the bot's authentication is made with
 * (BotFrameworkRouting): every request goes out on the agent
 * OutboundProxyAgents routes its URL on (the proxy getProxyFor decides,
 * its user name and password decoded, or directly), whatever agent the
 * pipeline's proxy policy put on it, and is sent by core-rest-pipeline's
 * own Node client, so the bodies, the timeouts, the streamed answers and
 * the decompression are what they always were. A request redirected is
 * routed again here, for where it goes next; the pipeline follows a
 * redirect only to the same origin.
 *
 * A tunnel the proxy refuses, and a 407 to a request it forwards, fail as
 * an OutboundProxyRefusal: where the request was going and what the proxy
 * answered, never the proxy (Node's own words name it). A proxy setting
 * this server cannot use fails before anything is sent, in words that name
 * no password.
 *
 * The SDK's ServiceClientContext takes an HttpClient of the older
 * core-http shape (a RequestPolicy, sent a WebResourceLike) and converts
 * it (@azure/core-http-compat's convertHttpClient): what it hands this is
 * a view of the pipeline's own request, and the request handed back with
 * the answer (`request`) has to be that same view.
 */
export default class BotConnectorHttpClient implements RequestPolicy {
  private http: HttpClient | null = null;

  public async sendRequest(
    webResource: WebResourceLike,
  ): Promise<CompatResponse> {
    const url: URL = new URL(webResource.url);
    const destination: string = OutboundProxyRefusal.destinationOf(url);
    const proxy: URL | null = OutboundProxyAgents.getProxyFor(url);
    const request: PipelineRequest = createPipelineRequest(
      BotConnectorHttpClient.toRequestOptions(webResource, url),
    );

    /*
     * Set on the request itself: createPipelineRequest takes an agent in
     * its options' type and leaves it out (ts-http-runtime 0.3.8).
     */
    request.agent = OutboundProxyAgents.getSharedAgentFor(url);

    let response: PipelineResponse;

    try {
      response = await this.getHttpClient().sendRequest(request);
    } catch (error) {
      throw OutboundProxyRefusal.fromTunnelError(error, destination) || error;
    }

    // A request the proxy forwards (http) is refused with a 407 answer.
    if (proxy && url.protocol === "http:" && response.status === 407) {
      throw new OutboundProxyRefusal({
        destination: destination,
        statusCode: response.status,
      });
    }

    return {
      ...response,
      request: webResource,
      headers: toHttpHeadersLike(response.headers),
    };
  }

  // core-rest-pipeline's own Node client, made the first time it is needed.
  private getHttpClient(): HttpClient {
    if (!this.http) {
      this.http = createDefaultHttpClient();
    }

    return this.http;
  }

  /*
   * The pipeline's request, as its view gives it. The view does not carry
   * allowInsecureConnection: the client allows http exactly when its
   * endpoint is http, and every request it sends (a redirect too) is on its
   * endpoint's origin, so the URL's scheme says it.
   */
  private static toRequestOptions(
    webResource: WebResourceLike,
    url: URL,
  ): PipelineRequestOptions {
    const options: PipelineRequestOptions = {
      url: webResource.url,
      method: webResource.method,
      headers: createHttpHeaders(
        webResource.headers.toJson({ preserveCase: true }),
      ),
      allowInsecureConnection: url.protocol === "http:",
    };

    if (webResource.body !== undefined) {
      options.body = webResource.body;
    }

    if (webResource.timeout !== undefined) {
      options.timeout = webResource.timeout;
    }

    if (webResource.abortSignal !== undefined) {
      options.abortSignal = webResource.abortSignal;
    }

    if (webResource.withCredentials !== undefined) {
      options.withCredentials = webResource.withCredentials;
    }

    if (webResource.requestId !== undefined) {
      options.requestId = webResource.requestId;
    }

    if (webResource.streamResponseStatusCodes !== undefined) {
      options.streamResponseStatusCodes = webResource.streamResponseStatusCodes;
    }

    if (webResource.onUploadProgress !== undefined) {
      options.onUploadProgress = webResource.onUploadProgress;
    }

    if (webResource.onDownloadProgress !== undefined) {
      options.onDownloadProgress = webResource.onDownloadProgress;
    }

    if (webResource.requestOverrides !== undefined) {
      options.requestOverrides = webResource.requestOverrides;
    }

    return options;
  }
}

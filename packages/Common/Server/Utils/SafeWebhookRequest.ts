import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../Types/API/HTTPMethod";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Headers from "../../Types/API/Headers";
import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import APIException from "../../Types/Exception/ApiException";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import API, { RequestOptions } from "../../Utils/API";
import ResponseTooLarge from "../../Utils/ResponseTooLarge";
import DataSourceEgressGuard, {
  PinnedAgents,
  TargetTlsOptions,
} from "./DataSource/EgressGuard";
import SSRFProtection, {
  ValidatedWebhookTarget,
  WebhookTargetValidationOptions,
} from "./SSRFProtection";

/*
 * A WEBHOOK SENT TO THE ADDRESS ITS URL CHECK APPROVED, AND NOWHERE ELSE
 * (issue #6611).
 *
 * Every webhook OneUptime's server sends to a URL somebody typed - a status
 * page subscriber's, a project's or a person's webhook, the SMS and call
 * gateway, a custom channel, a workflow's API and Zabbix steps, an
 * OpenStack project notice, a call to a Mattermost server - goes through
 * here (WebhookSendersPinnedGuard holds every one to it), so each keeps
 * these rules. Other outbound connections a project member chooses - data
 * sources, LLM providers, SMTP and the like - are checked by
 * DataSource/EgressGuard instead, whose pinned agents these are too
 * (DataSourceEgressGuard.createPinnedAgents): one implementation of the
 * pin, and of the proxy rule below, for every pinned HTTP request.
 *
 *   - The URL is checked (SSRFProtection.validateAndResolveWebhookTarget)
 *     with the policy its caller passes, unchanged: whether a private
 *     address may be reached (the instance's ALLOW_PRIVATE_NETWORK_WEBHOOKS
 *     and PRIVATE_NETWORK_WEBHOOK_ALLOWLIST, for a caller that is eligible),
 *     what a refusal says, and whether it may say what DNS answered.
 *
 *   - The socket dials an address that check approved, and no other. The
 *     check resolves the name once; the agents here answer every later
 *     lookup of that name from what it approved (a pinned lookup), so a name
 *     that resolves somewhere else a moment later - DNS rebinding - is never
 *     dialled. TLS still checks the certificate against the name in the URL.
 *     The request goes out on exactly the URL that was checked (WHATWG's
 *     reading of it), so no second parser can pick another host.
 *
 *   - No redirect is followed: a 3xx would name a host the check never saw.
 *     It comes back as the answer it is.
 *
 *   - Outbound proxies keep working. A server that sends through an
 *     outbound proxy - HTTPS_PROXY, HTTP_PROXY or ALL_PROXY in its
 *     environment, apart from the hosts in NO_PROXY - sends webhooks through
 *     it too, decided as axios decides for every other request. The agents
 *     go through the proxy themselves, through Node's own proxy support, and
 *     axios's proxy is off: axios sent the proxy's user name and password
 *     percent-encoded, so a proxy whose password holds an @ or a : refused
 *     every webhook with 407 (#10442). The agents may look up the proxy's
 *     own name for that (the operator wrote it); every other name but the
 *     webhook's is refused (DataSourceEgressGuard.createPinnedLookupForTarget).
 *     Through a proxy it is the proxy that looks the webhook's name up and
 *     connects, so the address it lands on is the proxy's to police: the
 *     URL is still checked first and no redirect is followed, and the docs
 *     (self-hosted/private-network-access) ask the operator to refuse
 *     private and link-local destinations on the proxy.
 *     Pinning through the proxy instead - asking it to CONNECT to the
 *     approved address - would break proxies that allow destinations by
 *     name, and a hostname is what an egress proxy's rules are written in.
 *
 *   - The webhook's certificate is checked as every request's is, unless
 *     its caller says otherwise for that request alone (tls: a workflow API
 *     step's or a playbook's Send Webhook's Allow self-signed certificates
 *     or CA certificate, #10440). The setting goes on that request's https
 *     agent only, so on the connection to the webhook only, inside a
 *     proxy's tunnel too: never on an https:// proxy's own connection,
 *     never on another request.
 *
 *   - It is sent with Node's http adapter, the only one that uses the
 *     agents, and the agents are thrown away once the request is over.
 *
 *   - A total timeout, when the caller gives one, is a hard one: no new
 *     attempt starts that it cannot pay for (API's own budget), and an
 *     attempt still in flight when it runs out is aborted and its socket
 *     closed, so a server that trickles its answer cannot hold one open.
 *
 *   - No answer is read whole that is larger than the caller reads
 *     (maxContentLength): WEBHOOK_MAX_RESPONSE_BYTES unless it says
 *     otherwise, so no sender reads an answer of any size, as the workflow
 *     API steps, Update Zabbix Problem and a Mattermost server's calls once
 *     did (issue #8875). A larger answer fails, unread, as a
 *     WebhookAnswerTooLargeException that says so.
 *
 * The Mattermost workflow step (Mattermost/MattermostWebhook) reads every
 * answer as text itself, so it sends with axios directly; it pins the same
 * way, with the same SSRFProtection call and pinned agents, and uses no
 * proxy at all (PinnedAgentOptions.direct). The Custom JavaScript sandbox
 * (VM/VMRunner) pins its own axios bridge.
 */

export type WebhookTarget = ValidatedWebhookTarget;

export interface WebhookSendOptions {
  // POST unless said otherwise.
  method?: HTTPMethod | undefined;
  data?: JSONObject | JSONArray | undefined;
  headers?: Headers | undefined;
  // Added to the query of the URL that was checked; the host never changes.
  params?: Dictionary<string> | undefined;
  // How long one attempt may wait for the server to answer.
  timeout?: number | undefined;
  /*
   * How long every attempt and every wait between them may take together.
   * A hard limit: an attempt still in flight when it runs out is aborted.
   */
  totalTimeoutInMs?: number | undefined;
  retries?: number | undefined;
  exponentialBackoff?: boolean | undefined;
  retryOnlyOnRetryableErrors?: boolean | undefined;
  /*
   * The most of an answer read, in bytes. WEBHOOK_MAX_RESPONSE_BYTES when
   * not given; a larger answer throws WebhookAnswerTooLargeException.
   */
  maxContentLength?: number | undefined;
  maxBodyLength?: number | undefined;
  /*
   * How the webhook's certificate is checked, for this request alone: not
   * at all (rejectUnauthorized: false), or against these CAs only (ca).
   * Unset, it is checked as every request's is. It reaches the connection
   * to the webhook only, never an outbound proxy's own connection.
   */
  tls?: TargetTlsOptions | undefined;
}

export interface WebhookRequestOptions extends WebhookSendOptions {
  /*
   * The rule the URL is held to, passed to SSRFProtection unchanged. Absent
   * is the strict rule: public addresses only.
   */
  validation?: WebhookTargetValidationOptions | undefined;
}

export type WebhookPostOptions = Omit<WebhookRequestOptions, "method" | "data">;

/*
 * The most of an answer a request reads (maxContentLength) unless its
 * caller reads more. A notification webhook's sender only wants the
 * status, and at most a short excerpt for a log; without a limit an
 * endpoint - a status page sign-up's is anyone's to choose - could stream
 * a body until the worker runs out of memory. An answer this large is no
 * webhook's: it fails, unread.
 */
export const WEBHOOK_MAX_RESPONSE_BYTES: number = 1024 * 1024;

/*
 * A request whose answer was larger than it reads (maxContentLength): the
 * answer was not read, and asking again gets the same one. Its message says
 * so in a sentence - "The answer was larger than 10 MB, so it was not
 * read." - in place of axios's "maxContentLength size of 10485760
 * exceeded", and names nothing of the URL.
 */
export class WebhookAnswerTooLargeException extends APIException {
  // The most of an answer the request read, in bytes.
  public readonly maxContentLength: number;

  public constructor(maxContentLength: number, error?: Error) {
    super(ResponseTooLarge.getMessage(maxContentLength), error);
    this.maxContentLength = maxContentLength;
  }

  /*
   * The same sentence, naming whose answer it was: "Zabbix's answer was
   * larger than 1 MB, so it was not read."
   */
  public describe(subject: string): string {
    return ResponseTooLarge.getMessage(this.maxContentLength, subject);
  }
}

// A scheme as SSRFProtection reads one off the raw URL: letters, then ":/".
const SCHEME_PREFIX: RegExp = /^\s*[a-z][a-z0-9+.-]*:\//i;

export default class SafeWebhookRequest {
  /*
   * Checks the URL against the caller's policy and answers the URL as it
   * will be sent and the addresses the check approved. Throws the guard's
   * BadDataException, whose message says why, when it may not be reached.
   */
  public static async resolveTarget(
    url: string | URL,
    validation?: WebhookTargetValidationOptions | undefined,
  ): Promise<WebhookTarget> {
    return await SSRFProtection.validateAndResolveWebhookTarget(
      SafeWebhookRequest.getUrlToCheck(url),
      validation,
    );
  }

  // Checks the URL, then sends one request to what the check approved.
  public static async request<T extends JSONObject | JSONArray = JSONObject>(
    url: string | URL,
    options: WebhookRequestOptions = {},
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const target: WebhookTarget = await SafeWebhookRequest.resolveTarget(
      url,
      options.validation,
    );

    return await SafeWebhookRequest.send<T>(target, options);
  }

  // A JSON POST: request() with the method and the body said.
  public static async post<T extends JSONObject | JSONArray = JSONObject>(
    url: string | URL,
    data: JSONObject | JSONArray,
    options: WebhookPostOptions = {},
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await SafeWebhookRequest.request<T>(url, {
      ...options,
      method: HTTPMethod.POST,
      data: data,
    });
  }

  /*
   * Sends one request - API's retries included - to a target resolveTarget
   * approved, on its own agents. What the server answers comes back as API
   * answers it; what API throws is thrown.
   */
  public static async send<T extends JSONObject | JSONArray = JSONObject>(
    target: WebhookTarget,
    options: WebhookSendOptions = {},
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const agents: PinnedAgents = SafeWebhookRequest.createPinnedAgents(
      target,
      options.tls,
    );

    const requestOptions: RequestOptions = {
      doNotFollowRedirects: true,
      useNodeHttpAdapter: true,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      // The agents go through the outbound proxy themselves.
      disableProxy: true,
      /*
       * Exactly the URL that was checked: API sends this one (its query
       * parameters added), never a re-reading of it by another parser.
       */
      dispatchUrl: target.url.href,
    };

    if (options.timeout !== undefined) {
      requestOptions.timeout = options.timeout;
    }

    /*
     * API's own budget starts no attempt it cannot pay for; the deadline
     * aborts the one in flight when the budget runs out.
     */
    const deadline: AbortController | null =
      options.totalTimeoutInMs !== undefined ? new AbortController() : null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    if (deadline && options.totalTimeoutInMs !== undefined) {
      requestOptions.totalTimeoutInMs = options.totalTimeoutInMs;
      requestOptions.signal = deadline.signal;
      deadlineTimer = setTimeout(
        () => {
          deadline.abort();
        },
        Math.max(1, options.totalTimeoutInMs),
      );
    }

    if (options.retries !== undefined) {
      requestOptions.retries = options.retries;
    }

    if (options.exponentialBackoff !== undefined) {
      requestOptions.exponentialBackoff = options.exponentialBackoff;
    }

    if (options.retryOnlyOnRetryableErrors !== undefined) {
      requestOptions.retryOnlyOnRetryableErrors =
        options.retryOnlyOnRetryableErrors;
    }

    // Never an answer of any size: the caller's limit, or a webhook's.
    const maxContentLength: number =
      options.maxContentLength ?? WEBHOOK_MAX_RESPONSE_BYTES;
    requestOptions.maxContentLength = maxContentLength;

    if (options.maxBodyLength !== undefined) {
      requestOptions.maxBodyLength = options.maxBodyLength;
    }

    const request: {
      url: URL;
      data?: JSONObject | JSONArray;
      headers?: Headers;
      params?: Dictionary<string>;
      options: RequestOptions;
    } = {
      // What API reports the request as; it is sent to dispatchUrl.
      url: URL.fromStringLenient(target.url.href),
      options: requestOptions,
    };

    if (options.data !== undefined) {
      request.data = options.data;
    }

    if (options.headers !== undefined) {
      request.headers = options.headers;
    }

    // Only the query changes, so the host the socket dials is still the approved one.
    if (options.params !== undefined) {
      request.params = options.params;
    }

    try {
      switch (options.method || HTTPMethod.POST) {
        case HTTPMethod.GET:
          return await API.get<T>(request);
        case HTTPMethod.POST:
          return await API.post<T>(request);
        case HTTPMethod.PUT:
          return await API.put<T>(request);
        case HTTPMethod.PATCH:
          return await API.patch<T>(request);
        case HTTPMethod.DELETE:
          return await API.delete<T>(request);
        default:
          throw new BadDataException(
            `A webhook is not sent with ${options.method}.`,
          );
      }
    } catch (error) {
      if (deadline?.signal.aborted && options.totalTimeoutInMs !== undefined) {
        throw new APIException(
          SafeWebhookRequest.getDeadlineMessage(options.totalTimeoutInMs),
          error instanceof Error ? error : undefined,
        );
      }

      if (ResponseTooLarge.isError(error)) {
        throw new WebhookAnswerTooLargeException(
          maxContentLength,
          error instanceof Error ? error : undefined,
        );
      }

      throw error;
    } finally {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }

      agents.httpAgent.destroy();
      agents.httpsAgent.destroy();
    }
  }

  // Why a request its total timeout gave up on failed. Quotes nothing of the URL.
  public static getDeadlineMessage(totalTimeoutInMs: number): string {
    const seconds: number = Math.max(1, Math.round(totalTimeoutInMs / 1000));

    return `The webhook did not answer within ${seconds} second${seconds === 1 ? "" : "s"}, so the request was given up.`;
  }

  /*
   * An http and an https agent that dial only what the target was approved
   * for, and an outbound proxy the operator configured: the egress guard's
   * pinned agents (DataSourceEgressGuard.createPinnedAgents), the one
   * implementation every pinned HTTP request of the server uses. `tls` is
   * how the webhook's certificate is checked, for this request alone.
   */
  public static createPinnedAgents(
    target: WebhookTarget,
    tls?: TargetTlsOptions | undefined,
  ): PinnedAgents {
    return DataSourceEgressGuard.createPinnedAgents(target, { tls });
  }

  /*
   * The text the check reads. A URL with no scheme ("hooks.example.com/x")
   * is read as OneUptime's parser has always read it, as https, so the URL
   * that is checked and sent is the one a request to it always went to.
   * Anything with a scheme is checked exactly as written: the check refuses
   * any scheme but http and https off the raw text.
   */
  private static getUrlToCheck(url: string | URL): string {
    const text: string = url.toString();

    if (SCHEME_PREFIX.test(text)) {
      return text;
    }

    try {
      return URL.fromString(text.trim()).toString();
    } catch {
      // Left for the check to refuse, in its own words.
      return text;
    }
  }
}

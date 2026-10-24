import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Sleep from "../../../../Types/Sleep";
import DataSourceEgressGuard, {
  EgressGuardOptions,
  PinnedAgents,
} from "../../DataSource/EgressGuard";
import { redactLogString } from "../../LogRedaction";
import OutboundUserAgent from "../../OutboundUserAgent";
import axios, { AxiosResponse } from "axios";

/*
 * THE ONLY WAY OneUptime's SERVER TALKS TO A GIT SERVER A PERSON NAMED.
 *
 * A GitLab, Forgejo, Gitea or plain Git server is an address a project
 * member typed, so every request to one goes through OneUptime's egress
 * guard, as every other address a project member chooses does
 * (Server/Utils/DataSource/EgressGuard):
 *
 *  - never loopback, link-local (the 169.254.169.254 cloud metadata
 *    address), reserved or multicast addresses, on any installation;
 *  - never a private network address on OneUptime Cloud: a Git server only
 *    a private network reaches is reached by a Runner of the project's own
 *    on that network, never by OneUptime's server. A self-hosted OneUptime
 *    may reach one on its own network, unless its operator set
 *    DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES;
 *  - the host is resolved and checked before every request, and the socket
 *    dials exactly the addresses that were checked (no DNS rebinding);
 *  - no redirects, so a checked host cannot send the request elsewhere;
 *  - plain http only where private addresses are allowed: OneUptime Cloud
 *    sends a token over https only;
 *  - answers are capped in size and every request in time.
 *
 * The transport is injected - the guarded one below in production, a fake
 * Git server in tests - and the clients that use it (ForgejoApi, GitLabApi,
 * GitSmartHttp) never see a socket.
 */

export type CodeHostHttpMethod = "GET" | "POST" | "PUT" | "PATCH";

export interface CodeHostHttpRequest {
  method: CodeHostHttpMethod;
  url: string;
  headers: Dictionary<string>;
  // A JSON body, already serialised.
  body?: string | undefined;
  timeoutInMs: number;
}

export interface CodeHostHttpResponse {
  statusCode: number;
  bodyText: string;
  // Parsed JSON, or undefined when the body is not JSON.
  bodyJson: unknown;
  // Lowercased header names.
  headers: Dictionary<string>;
}

export type CodeHostTransport = (
  request: CodeHostHttpRequest,
) => Promise<CodeHostHttpResponse>;

export enum CodeHostHttpErrorKind {
  // The token was refused (401).
  Unauthorized = "Unauthorized",
  // The token may not do this (403).
  Forbidden = "Forbidden",
  NotFound = "NotFound",
  // It is there already (409).
  Conflict = "Conflict",
  // The server kept failing, or could not be reached.
  Unavailable = "Unavailable",
  // Too many requests: the server asked OneUptime to slow down.
  RateLimited = "RateLimited",
  // The server refused the request for another reason (4xx).
  Rejected = "Rejected",
  // The answer was not what the server's API documents.
  BadResponse = "BadResponse",
  /*
   * OneUptime may not reach the address at all: the egress guard refused
   * it (a private address on OneUptime Cloud, loopback, link-local), or it
   * is not an address.
   */
  NotAllowed = "NotAllowed",
}

export class CodeHostHttpError extends BadDataException {
  public kind: CodeHostHttpErrorKind;
  public statusCode: number | null;

  public constructor(data: {
    kind: CodeHostHttpErrorKind;
    message: string;
    statusCode?: number | null | undefined;
  }) {
    super(data.message);
    this.kind = data.kind;
    this.statusCode = data.statusCode ?? null;
  }

  // Whether the server said the credentials are no good - not a hiccup.
  public isCredentialRefusal(): boolean {
    return this.kind === CodeHostHttpErrorKind.Unauthorized;
  }
}

// A request to a Git server: one answer, within this.
export const CODE_HOST_REQUEST_TIMEOUT_MS: number = 20 * 1000;

/*
 * The largest answer read: a page of a repository's tree or one file of it
 * (an inlined file of 1 MB is about 1.4 MB of base64).
 */
export const CODE_HOST_MAX_RESPONSE_BYTES: number = 8 * 1024 * 1024;

// A request body: a pull request's description is the largest one sent.
export const CODE_HOST_MAX_REQUEST_BYTES: number = 1024 * 1024;

// Tries of a request that failed for the server's own reasons (5xx, no answer).
export const CODE_HOST_MAX_FAILURE_RETRIES: number = 2;

const MAX_MESSAGE_EXCERPT_LENGTH: number = 300;

const WHITESPACE_RUN: RegExp = /\s+/g;

export default class CodeHostHttp {
  /*
   * Whether a Git server may be named by an http address, rather than only
   * https: where private addresses are allowed (a self-hosted OneUptime),
   * never on OneUptime Cloud, which sends tokens over https only.
   */
  public static isHttpAllowed(): boolean {
    return !DataSourceEgressGuard.shouldBlockPrivateAddresses();
  }

  /*
   * The transport the server uses: every request checked by the egress
   * guard and pinned to the addresses it checked, no redirects, answers
   * capped. `egressOptions` is a test seam, forwarded to the guard.
   */
  public static createTransport(options?: {
    egressOptions?: EgressGuardOptions | undefined;
    maxResponseBytes?: number | undefined;
    /*
     * Whether http is allowed, where the caller decides rather than the
     * deployment (a Runner: a global one never, a project's own on its own
     * network yes). Undefined: isHttpAllowed().
     */
    allowHttp?: boolean | undefined;
  }): CodeHostTransport {
    return async (
      request: CodeHostHttpRequest,
    ): Promise<CodeHostHttpResponse> => {
      let url: URL;

      try {
        url = new URL(request.url);
      } catch {
        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.NotAllowed,
          message: "That is not a web address.",
        });
      }

      const allowHttp: boolean =
        options?.allowHttp ?? CodeHostHttp.isHttpAllowed();

      if (
        url.protocol !== "https:" &&
        !(url.protocol === "http:" && allowHttp)
      ) {
        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.NotAllowed,
          message:
            "OneUptime reaches Git servers over https only. Use the server's https address.",
        });
      }

      if (url.username || url.password) {
        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.NotAllowed,
          message:
            "A Git server's address cannot carry a username or password.",
        });
      }

      let pinned: { url: URL } & PinnedAgents;

      try {
        pinned = await DataSourceEgressGuard.assertUrlAllowedAndPin(
          url.toString(),
          {
            targetLabel: "Git server",
            privateNetworkHint:
              " A Git server on a private network is reached by one of your own Runners on that network: connect it as a Git repository and pick that Runner for it.",
            ...(options?.egressOptions || {}),
          },
        );
      } catch (error) {
        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.NotAllowed,
          message:
            error instanceof Error && error.message
              ? error.message
              : `OneUptime cannot reach ${url.host}.`,
        });
      }

      try {
        return await CodeHostHttp.send({
          url: pinned.url,
          request,
          agents: {
            httpAgent: pinned.httpAgent,
            httpsAgent: pinned.httpsAgent,
          },
          maxResponseBytes:
            options?.maxResponseBytes || CODE_HOST_MAX_RESPONSE_BYTES,
        });
      } finally {
        pinned.httpAgent.destroy();
        pinned.httpsAgent.destroy();
      }
    };
  }

  /*
   * A transport with no egress guard: only for a fake Git server a test
   * runs on 127.0.0.1, which the guard refuses on every installation.
   */
  public static createUnguardedTransportForTests(options?: {
    maxResponseBytes?: number | undefined;
  }): CodeHostTransport {
    return async (
      request: CodeHostHttpRequest,
    ): Promise<CodeHostHttpResponse> => {
      return await CodeHostHttp.send({
        url: new URL(request.url),
        request,
        maxResponseBytes:
          options?.maxResponseBytes || CODE_HOST_MAX_RESPONSE_BYTES,
      });
    };
  }

  // One request with the rules every transport keeps, its answer as is.
  private static async send(data: {
    url: URL;
    request: CodeHostHttpRequest;
    agents?: PinnedAgents | undefined;
    maxResponseBytes: number;
  }): Promise<CodeHostHttpResponse> {
    let response: AxiosResponse<string>;

    try {
      response = await axios.request<string>({
        // Only Node's http adapter uses the pinned agents.
        adapter: "http",
        method: data.request.method,
        url: data.url.toString(),
        headers: OutboundUserAgent.withDefault(data.request.headers),
        ...(data.request.body !== undefined ? { data: data.request.body } : {}),
        timeout: data.request.timeoutInMs,
        maxRedirects: 0,
        proxy: false,
        maxContentLength: data.maxResponseBytes,
        maxBodyLength: CODE_HOST_MAX_REQUEST_BYTES,
        responseType: "text",
        transformResponse: [
          (body: string): string => {
            return body;
          },
        ],
        // Every answer is read here: a refusal and a redirect too.
        validateStatus: (): boolean => {
          return true;
        },
        ...(data.agents
          ? {
              httpAgent: data.agents.httpAgent,
              httpsAgent: data.agents.httpsAgent,
            }
          : {}),
      });
    } catch (error) {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Unavailable,
        message: CodeHostHttp.describeTransportError(error, data.url),
      });
    }

    const bodyText: string =
      typeof response.data === "string" ? response.data : "";
    let bodyJson: unknown = undefined;

    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      bodyJson = undefined;
    }

    const headers: Dictionary<string> = {};

    for (const key of Object.keys(response.headers || {})) {
      const value: unknown = (response.headers as Record<string, unknown>)[key];

      if (value !== undefined && value !== null) {
        headers[key.toLowerCase()] = String(value);
      }
    }

    return {
      statusCode: response.status,
      bodyText,
      bodyJson,
      headers,
    };
  }

  // Why no answer came back, in words that quote nothing but the host.
  public static describeTransportError(error: unknown, url: URL): string {
    const code: string =
      axios.isAxiosError(error) && error.code
        ? error.code
        : (error as NodeJS.ErrnoException | undefined)?.code ?? "";
    const message: string =
      error instanceof Error ? (error.message || "").toLowerCase() : "";

    if (
      code === "ECONNABORTED" ||
      code === "ETIMEDOUT" ||
      message.includes("timeout")
    ) {
      return `${url.host} did not answer in time. Try again in a moment.`;
    }

    if (
      code === "ERR_FR_MAX_BODY_LENGTH_EXCEEDED" ||
      message.includes("maxcontentlength")
    ) {
      return `${url.host} answered with more than OneUptime reads at once.`;
    }

    if (code === "ECONNREFUSED") {
      return `${url.host} refused the connection. Check the address and that the server is running.`;
    }

    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return `${url.host} could not be found. Check the address.`;
    }

    if (
      code === "CERT_HAS_EXPIRED" ||
      code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      code === "SELF_SIGNED_CERT_IN_CHAIN" ||
      code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      code === "ERR_TLS_CERT_ALTNAME_INVALID"
    ) {
      return `${url.host}'s certificate is not trusted (${code}). OneUptime only talks to a Git server whose certificate it can verify.`;
    }

    return `${url.host} could not be reached${code ? ` (${code})` : ""}.`;
  }

  /*
   * A message with every secret cut out, redacted for logs, and short: what
   * a Git server said is shown to people and stored on runs.
   */
  public static clean(text: string, secrets: Array<string>): string {
    let cleaned: string = String(text || "");

    for (const secret of secrets) {
      if (secret && secret.length >= 4) {
        cleaned = cleaned.split(secret).join("[REDACTED]");
      }
    }

    cleaned = redactLogString(cleaned).replace(WHITESPACE_RUN, " ").trim();

    return cleaned.length > MAX_MESSAGE_EXCERPT_LENGTH
      ? `${cleaned.slice(0, MAX_MESSAGE_EXCERPT_LENGTH)}…`
      : cleaned;
  }

  // Waits between retries of a request the server failed for itself.
  public static async backOff(retry: number): Promise<void> {
    await Sleep.sleep(Math.min(500 * Math.pow(2, retry), 4000));
  }
}

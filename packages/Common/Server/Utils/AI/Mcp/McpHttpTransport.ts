import http from "http";
import https from "https";
import { Readable } from "stream";
import DataSourceEgressGuard, {
  EgressGuardOptions,
  PinnedAgents,
} from "../../DataSource/EgressGuard";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../Types/Exception/EgressGuardException";
import { ExternalMcpServerFailureKind } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import McpClientError from "./McpClientError";

/*
 * HOW OneUptime REACHES AN EXTERNAL MCP SERVER over HTTP.
 *
 * The MCP client (McpClient) speaks JSON-RPC through this one interface:
 * send a request, get the status and headers back, then read the body as
 * text, chunk by chunk - an event stream can stay open for minutes. The
 * client never opens a socket itself.
 *
 * The one used in production, GuardedMcpHttpTransport, is the only way a
 * request to a server a project chose leaves OneUptime:
 *
 *   - the address goes through the egress guard first (DataSourceEgressGuard),
 *     and the addresses it checked are PINNED into the socket's lookup, so
 *     the address that was checked is the address that is dialed - no
 *     DNS-rebind window. Loopback, link-local (the cloud metadata address)
 *     and the other always-blocked ranges are refused everywhere; private
 *     ranges are refused on OneUptime Cloud and allowed on a self-hosted
 *     OneUptime, as for every other target a project member types;
 *   - a redirect is never followed: an answer in the 3xx range is a
 *     failure, so a checked server cannot bounce OneUptime somewhere else;
 *   - the body is cut off at `maxResponseBytes`: reading more fails the
 *     request, so a server cannot fill a worker's memory;
 *   - every request can be aborted (`signal`), which the client does when a
 *     call runs out of time.
 *
 * Tests hand the client a transport of their own that reaches a fake MCP
 * server on the loopback address, which the guard would refuse.
 */

export interface McpHttpRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
  signal: AbortSignal;
  // The most the body may hold, in bytes.
  maxResponseBytes: number;
}

export interface McpHttpResponse {
  status: number;
  // Response headers, names in lower case.
  headers: Record<string, string>;
  /*
   * The body as text, chunk by chunk. Throws McpClientError (TooLarge) once
   * more than maxResponseBytes arrived, and ends when the server closes it.
   */
  readChunks(): AsyncIterable<string>;
  // Stops reading and closes the connection. Safe to call more than once.
  close(): void;
}

export interface McpHttpTransport {
  send(request: McpHttpRequest): Promise<McpHttpResponse>;
}

/*
 * Reads a Node response stream as an McpHttpResponse: UTF-8 text, at most
 * maxResponseBytes, then `onClose` once the connection is done with.
 */
export function toMcpHttpResponse(data: {
  response: http.IncomingMessage;
  maxResponseBytes: number;
  onClose?: (() => void) | undefined;
}): McpHttpResponse {
  const { response, maxResponseBytes } = data;
  let isClosed: boolean = false;

  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) {
      continue;
    }

    headers[name.toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : String(value);
  }

  const close: () => void = (): void => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    response.destroy();
    data.onClose?.();
  };

  response.setEncoding("utf8");

  return {
    status: response.statusCode || 0,
    headers,
    close,
    readChunks: async function* (): AsyncIterable<string> {
      let receivedBytes: number = 0;

      try {
        for await (const chunk of response as Readable) {
          const text: string = String(chunk);

          receivedBytes += Buffer.byteLength(text, "utf8");

          if (receivedBytes > maxResponseBytes) {
            throw new McpClientError({
              kind: ExternalMcpServerFailureKind.TooLarge,
              message: `The server sent more than ${Math.round(
                maxResponseBytes / 1024,
              )} KB in one answer, more than OneUptime reads.`,
            });
          }

          yield text;
        }
      } finally {
        close();
      }
    },
  };
}

// What the egress guard refused, as the client reports it.
export function getEgressFailure(error: unknown): McpClientError | null {
  if (!(error instanceof EgressGuardException)) {
    return null;
  }

  return new McpClientError({
    kind:
      error.reason === EgressFailureReason.AddressBlocked
        ? ExternalMcpServerFailureKind.AddressNotAllowed
        : error.reason === EgressFailureReason.InvalidTarget
          ? ExternalMcpServerFailureKind.NotAnMcpServer
          : ExternalMcpServerFailureKind.Unreachable,
    message: error.message,
  });
}

// What a failed socket says, in a sentence for people.
export function describeConnectionError(error: unknown): McpClientError {
  if (error instanceof McpClientError) {
    return error;
  }

  const code: string =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  const message: string = error instanceof Error ? error.message : String(error);

  if (code === "ABORT_ERR" || (error as Error)?.name === "AbortError") {
    return new McpClientError({
      kind: ExternalMcpServerFailureKind.TimedOut,
      message: "The server did not answer in time.",
    });
  }

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new McpClientError({
      kind: ExternalMcpServerFailureKind.Unreachable,
      message: "The server's host name could not be found.",
    });
  }

  if (code === "ECONNREFUSED") {
    return new McpClientError({
      kind: ExternalMcpServerFailureKind.Unreachable,
      message: "The server refused the connection.",
    });
  }

  if (code === "ECONNRESET" || code === "EPIPE") {
    return new McpClientError({
      kind: ExternalMcpServerFailureKind.Unreachable,
      message: "The server closed the connection.",
    });
  }

  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return new McpClientError({
      kind: ExternalMcpServerFailureKind.TimedOut,
      message: "The connection to the server timed out.",
    });
  }

  if (
    code.startsWith("ERR_TLS") ||
    code.startsWith("CERT_") ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  ) {
    return new McpClientError({
      kind: ExternalMcpServerFailureKind.Unreachable,
      message: `The server's TLS certificate was not accepted (${code}).`,
    });
  }

  return new McpClientError({
    kind: ExternalMcpServerFailureKind.Unreachable,
    message: `Could not reach the server: ${message}`,
  });
}

/*
 * Sends one request over Node's HTTP client through the given agents and
 * answers with the response as an McpHttpResponse - refusing a redirect,
 * and holding the body to the request's size limit. The agents are
 * destroyed once the response is done with (or the request failed).
 */
export async function sendNodeHttpRequest(data: {
  url: URL;
  request: McpHttpRequest;
  agents: PinnedAgents;
}): Promise<McpHttpResponse> {
  const { request } = data;

  const destroyAgents: () => void = (): void => {
    data.agents.httpAgent.destroy();
    data.agents.httpsAgent.destroy();
  };

  const isHttps: boolean = data.url.protocol === "https:";
  const pinned: { url: URL } & PinnedAgents = {
    url: data.url,
    ...data.agents,
  };

  return await new Promise<McpHttpResponse>(
      (
        resolve: (response: McpHttpResponse) => void,
        reject: (error: Error) => void,
      ) => {
        let isSettled: boolean = false;

        const fail: (error: unknown) => void = (error: unknown): void => {
          if (isSettled) {
            return;
          }

          isSettled = true;
          destroyAgents();
          reject(describeConnectionError(error));
        };

        const options: http.RequestOptions = {
          method: request.method,
          headers: {
            ...request.headers,
            ...(request.body !== undefined
              ? {
                  "Content-Length": String(
                    Buffer.byteLength(request.body, "utf8"),
                  ),
                }
              : {}),
          },
          agent: isHttps ? pinned.httpsAgent : pinned.httpAgent,
          signal: request.signal,
        };

        const clientRequest: http.ClientRequest = (
          isHttps ? https : http
        ).request(
          pinned.url,
          options,
          (response: http.IncomingMessage): void => {
            if (isSettled) {
              response.destroy();
              return;
            }

            isSettled = true;

            const status: number = response.statusCode || 0;

            // A redirect is never followed: the server must answer itself.
            if (status >= 300 && status < 400) {
              response.destroy();
              destroyAgents();
              reject(
                new McpClientError({
                  kind: ExternalMcpServerFailureKind.NotAnMcpServer,
                  message: `The server answered with a redirect (HTTP ${status}). Use the address it redirects to as the URL.`,
                  status,
                }),
              );
              return;
            }

            resolve(
              toMcpHttpResponse({
                response,
                maxResponseBytes: request.maxResponseBytes,
                onClose: destroyAgents,
              }),
            );
          },
        );

        clientRequest.on("error", fail);

        if (request.body !== undefined) {
          clientRequest.write(request.body, "utf8");
        }

        clientRequest.end();
      },
    );
}

export default class GuardedMcpHttpTransport implements McpHttpTransport {
  private readonly egressOptions: EgressGuardOptions;

  public constructor(options?: { egressOptions?: EgressGuardOptions }) {
    this.egressOptions = {
      targetLabel: "MCP server",
      ...(options?.egressOptions || {}),
    };
  }

  public async send(request: McpHttpRequest): Promise<McpHttpResponse> {
    let pinned: { url: URL } & PinnedAgents;

    try {
      pinned = await DataSourceEgressGuard.assertUrlAllowedAndPin(
        request.url,
        this.egressOptions,
      );
    } catch (error) {
      throw getEgressFailure(error) || describeConnectionError(error);
    }

    return await sendNodeHttpRequest({
      url: pinned.url,
      request,
      agents: { httpAgent: pinned.httpAgent, httpsAgent: pinned.httpsAgent },
    });
  }
}

import http from "http";
import net from "net";
import type { ReadableStreamReadResult } from "stream/web";

/*
 * How the Cloud AI agent talks HTTP: one request in, one answer (or a
 * CloudTransportError) out, through a function tests replace with a fake.
 *
 * Two roads, chosen by the URL:
 *
 *   - https:// (the cloud's APIs: AWS, Azure Resource Manager, Google
 *     Cloud): Node's fetch. It honours the egress proxy the agent switched
 *     on for reaching OneUptime (Proxy.ts), so an agent in a network that
 *     reaches the internet only through a proxy reaches its cloud's APIs
 *     the same way; TLS stays end to end through a CONNECT tunnel.
 *   - http:// (the credential and metadata endpoints: the ECS container
 *     credentials and task metadata, the Container Apps identity endpoint,
 *     Azure's IMDS, Google's metadata server): node's http module over a
 *     connection of its own, NEVER a proxy — a proxy would answer from its
 *     own host (handing out the proxy's credentials) and would see the
 *     tokens in the clear. They are link-local or loopback addresses, which
 *     only the platform the agent runs on answers.
 *
 * Both: no redirect is ever followed, the whole call is bounded by
 * timeoutInMs, and the answer is read up to maxResponseBytes (anything
 * beyond is dropped and `truncated` says so).
 */

export type CloudHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// One request exactly as it is sent.
export interface CloudHttpRequest {
  method: CloudHttpMethod;
  // Absolute, query string included.
  url: string;
  headers: Record<string, string>;
  // null: no body.
  body: string | null;
  timeoutInMs: number;
  maxResponseBytes: number;
}

export interface CloudHttpResponse {
  status: number;
  // Header names lowercased.
  headers: Record<string, string>;
  // At most maxResponseBytes of the body, as UTF-8.
  body: string;
  truncated: boolean;
}

/*
 * Why a call got no answer:
 *   connect  no connection (refused, unresolvable, unreachable, TLS): the
 *            request was never sent;
 *   timeout  no (complete) answer in time: it may have been sent;
 *   reset    the connection failed after the request went out.
 */
export type CloudTransportFailureKind = "connect" | "timeout" | "reset";

export class CloudTransportError extends Error {
  public readonly kind: CloudTransportFailureKind;
  public readonly code: string | null;

  public constructor(data: {
    kind: CloudTransportFailureKind;
    message: string;
    code?: string | null | undefined;
  }) {
    super(data.message);
    this.name = "CloudTransportError";
    this.kind = data.kind;
    this.code = data.code ?? null;
  }

  // The request may have reached the API (and a change may have landed).
  public get mayHaveBeenSent(): boolean {
    return this.kind !== "connect";
  }
}

export type CloudTransport = (
  request: CloudHttpRequest,
) => Promise<CloudHttpResponse>;

// Sends one request within the caller's budget (CloudCommandRun.send, or a probe's).
export type CloudSender = (
  request: Omit<CloudHttpRequest, "timeoutInMs" | "maxResponseBytes">,
) => Promise<CloudHttpResponse>;

// fetch's options (the DOM's RequestInit, which the agent's lint does not know by name).
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

// The most of an answer the agent reads (lists of revisions, versions, ...).
export const MAX_CLOUD_RESPONSE_BYTES: number = 4 * 1024 * 1024;

// A whole number written as text (Google Cloud writes int64s so).
const INTEGER_TEXT_PATTERN: RegExp = /^-?[0-9]{1,15}$/;

// Error codes that mean the request certainly never left the agent.
const NOT_SENT_CODES: ReadonlyArray<string> = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_INVALID_URL",
  "ERR_INVALID_HTTP_TOKEN",
  "ERR_INVALID_CHAR",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
];

function errorCode(err: unknown): string | null {
  const code: unknown =
    err && typeof err === "object"
      ? (err as Record<string, unknown>)["code"]
      : undefined;

  return typeof code === "string" && code ? code : null;
}

export function describeCloudError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// fetch reports every failure as "fetch failed": the reason is on its cause.
function fetchFailureCause(err: unknown): {
  code: string | null;
  text: string;
} {
  const cause: unknown =
    err && typeof err === "object"
      ? (err as Record<string, unknown>)["cause"]
      : undefined;
  const code: string | null = errorCode(cause) || errorCode(err);
  const causeText: string =
    cause instanceof Error ? cause.message : describeCloudError(err);

  return {
    code,
    text:
      code && !causeText.includes(code) ? `${code}: ${causeText}` : causeText,
  };
}

function isNotSentCode(code: string | null): boolean {
  return Boolean(
    code &&
      (NOT_SENT_CODES.includes(code) ||
        code.startsWith("ERR_TLS_") ||
        code.startsWith("ERR_SSL_") ||
        code.startsWith("CERT_")),
  );
}

function readHeaders(headers: Headers): Record<string, string> {
  const read: Record<string, string> = {};

  headers.forEach((value: string, name: string): void => {
    read[name.toLowerCase()] = value;
  });

  return read;
}

// The body of a fetch answer, up to maxBytes.
async function readFetchBody(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) {
    return { body: "", truncated: false };
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const chunks: Array<Buffer> = [];
  let received: number = 0;

  for (;;) {
    const read: ReadableStreamReadResult<Uint8Array> = await reader.read();

    if (read.done) {
      break;
    }

    const chunk: Buffer = Buffer.from(read.value);
    const room: number = Math.max(0, maxBytes - received);

    if (chunk.length > room) {
      chunks.push(chunk.subarray(0, room));
      await reader.cancel().catch((): void => {
        // The answer is cut anyway.
      });

      return { body: Buffer.concat(chunks).toString("utf8"), truncated: true };
    }

    chunks.push(chunk);
    received += chunk.length;
  }

  return { body: Buffer.concat(chunks).toString("utf8"), truncated: false };
}

/*
 * An https:// call through fetch (and so through the egress proxy when one
 * is configured). Redirects are returned as they are, never followed.
 */
export async function fetchTransport(
  request: CloudHttpRequest,
): Promise<CloudHttpResponse> {
  const controller: AbortController = new AbortController();
  let timedOut: boolean = false;
  const timer: ReturnType<typeof setTimeout> = setTimeout(
    (): void => {
      timedOut = true;
      controller.abort();
    },
    Math.max(1, Math.floor(request.timeoutInMs)),
  );

  try {
    let response: Response;

    try {
      const init: FetchInit = {
        method: request.method,
        headers: request.headers,
        redirect: "manual",
        signal: controller.signal,
      };

      if (request.body !== null) {
        init.body = request.body;
      }

      response = await fetch(request.url, init);
    } catch (err: unknown) {
      const cause: { code: string | null; text: string } =
        fetchFailureCause(err);

      if (timedOut) {
        throw new CloudTransportError({
          kind: "timeout",
          message: `no answer within ${request.timeoutInMs}ms`,
          code: cause.code,
        });
      }

      throw new CloudTransportError({
        kind: isNotSentCode(cause.code) ? "connect" : "reset",
        message: cause.text,
        code: cause.code,
      });
    }

    try {
      const read: { body: string; truncated: boolean } = await readFetchBody(
        response,
        request.maxResponseBytes,
      );

      return {
        status: response.status,
        headers: readHeaders(response.headers),
        body: read.body,
        truncated: read.truncated,
      };
    } catch (err: unknown) {
      throw new CloudTransportError({
        kind: timedOut ? "timeout" : "reset",
        message: timedOut
          ? `no complete answer within ${request.timeoutInMs}ms`
          : fetchFailureCause(err).text,
        code: errorCode(err),
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

/*
 * An http:// call to a credential or metadata endpoint: node's http module
 * over a connection of its own (never the global agent, which the proxy
 * support may have pointed at the egress proxy).
 */
export function directHttpTransport(
  request: CloudHttpRequest,
): Promise<CloudHttpResponse> {
  return new Promise<CloudHttpResponse>(
    (
      resolve: (value: CloudHttpResponse) => void,
      reject: (reason: CloudTransportError) => void,
    ): void => {
      const agent: http.Agent = new http.Agent({
        keepAlive: false,
        maxSockets: 1,
      });
      let settled: boolean = false;
      let connected: boolean = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let clientRequest: http.ClientRequest | null = null;

      const settle: (outcome: () => void) => void = (
        outcome: () => void,
      ): void => {
        if (settled) {
          return;
        }

        settled = true;

        if (timer) {
          clearTimeout(timer);
        }

        outcome();
        agent.destroy();
      };

      const fail: (kind: CloudTransportFailureKind, err: unknown) => void = (
        kind: CloudTransportFailureKind,
        err: unknown,
      ): void => {
        settle((): void => {
          reject(
            new CloudTransportError({
              kind,
              message: describeCloudError(err),
              code: errorCode(err),
            }),
          );
        });

        clientRequest?.destroy();
      };

      let url: URL;

      try {
        url = new URL(request.url);
      } catch (err: unknown) {
        fail("connect", err);
        return;
      }

      try {
        clientRequest = http.request(
          {
            method: request.method,
            hostname: url.hostname.replace(/^\[|\]$/g, ""),
            port: url.port || 80,
            path: `${url.pathname}${url.search}`,
            headers: request.headers,
            agent,
          },
          (response: http.IncomingMessage): void => {
            const chunks: Array<Buffer> = [];
            let received: number = 0;

            const done: (truncated: boolean) => void = (
              truncated: boolean,
            ): void => {
              settle((): void => {
                const headers: Record<string, string> = {};

                for (const [name, value] of Object.entries(response.headers)) {
                  if (typeof value === "string") {
                    headers[name.toLowerCase()] = value;
                  } else if (Array.isArray(value)) {
                    headers[name.toLowerCase()] = value.join(", ");
                  }
                }

                resolve({
                  status: response.statusCode || 0,
                  headers,
                  body: Buffer.concat(chunks).toString("utf8"),
                  truncated,
                });
              });
            };

            response.on("data", (chunk: Buffer): void => {
              if (settled) {
                return;
              }

              const room: number = Math.max(
                0,
                request.maxResponseBytes - received,
              );

              if (chunk.length > room) {
                chunks.push(chunk.subarray(0, room));
                received += room;
                done(true);
                response.destroy();
                clientRequest?.destroy();
                return;
              }

              chunks.push(chunk);
              received += chunk.length;
            });

            response.on("end", (): void => {
              done(false);
            });

            response.on("error", (err: Error): void => {
              fail("reset", err);
            });

            response.on("close", (): void => {
              if (!settled) {
                fail(
                  "reset",
                  new Error(
                    "the connection closed before the whole answer arrived",
                  ),
                );
              }
            });
          },
        );
      } catch (err: unknown) {
        // Invalid options (a header Node refuses): nothing was sent.
        fail("connect", err);
        return;
      }

      clientRequest.on("socket", (socket: net.Socket): void => {
        socket.once("connect", (): void => {
          connected = true;
        });
      });

      clientRequest.on("error", (err: Error): void => {
        fail(connected ? "reset" : "connect", err);
      });

      timer = setTimeout(
        (): void => {
          fail(
            connected ? "timeout" : "connect",
            new Error(
              connected
                ? `no answer within ${request.timeoutInMs}ms`
                : `no connection within ${request.timeoutInMs}ms`,
            ),
          );
        },
        Math.max(1, Math.floor(request.timeoutInMs)),
      );

      clientRequest.end(request.body === null ? undefined : request.body);
    },
  );
}

// The real transport: fetch for the cloud's APIs, a direct connection for metadata.
export function cloudTransport(
  request: CloudHttpRequest,
): Promise<CloudHttpResponse> {
  return request.url.startsWith("http://")
    ? directHttpTransport(request)
    : fetchTransport(request);
}

// ---- Reading answers -----------------------------------------------------------

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The answer's JSON, or null when it is not JSON (or was cut).
export function parseJsonBody(response: CloudHttpResponse): unknown {
  if (response.truncated || !response.body.trim()) {
    return null;
  }

  try {
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}

export function readString(
  object: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value: unknown = object ? object[key] : undefined;
  return typeof value === "string" ? value : null;
}

// A whole number (or a string of digits, as Google Cloud writes int64s), else null.
export function readInteger(
  object: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value: unknown = object ? object[key] : undefined;

  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && INTEGER_TEXT_PATTERN.test(value)) {
    return parseInt(value, 10);
  }

  return null;
}

export function readObject(
  object: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  const value: unknown = object ? object[key] : undefined;
  return isPlainObject(value) ? value : null;
}

export function readArray(
  object: Record<string, unknown> | null | undefined,
  key: string,
): Array<unknown> {
  const value: unknown = object ? object[key] : undefined;
  return Array.isArray(value) ? value : [];
}

// The longest text from an API quoted in a message.
export const MAX_CLOUD_MESSAGE_CHARS: number = 500;

export function shortenCloudText(text: string): string {
  const flat: string = text.replace(/\s+/g, " ").trim();

  return flat.length > MAX_CLOUD_MESSAGE_CHARS
    ? `${flat.slice(0, MAX_CLOUD_MESSAGE_CHARS)}...`
    : flat;
}

// Hosts the direct (proxy-free) road may reach over plain http.
const LOOPBACK_HOSTS: ReadonlyArray<string> = ["localhost", "::1", "[::1]"];

/*
 * Whether an http:// endpoint is one only the platform answers: a loopback
 * address (the Container Apps identity endpoint, a sidecar) or a
 * link-local one (169.254.169.254, the ECS endpoints, metadata.google
 * .internal resolves there too).
 */
export function isPlatformHost(host: string): boolean {
  const bare: string = host.replace(/^\[|\]$/g, "").toLowerCase();

  if (LOOPBACK_HOSTS.includes(bare) || bare === "metadata.google.internal") {
    return true;
  }

  if (net.isIPv4(bare)) {
    return bare.startsWith("127.") || bare.startsWith("169.254.");
  }

  if (net.isIPv6(bare)) {
    return (
      bare === "::1" || bare.startsWith("fe80:") || bare === "fd00:ec2::23"
    );
  }

  return false;
}

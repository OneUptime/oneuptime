import http from "http";
import https from "https";
import { Readable } from "stream";
import DataSourceEgressGuard, {
  EgressGuardOptions,
} from "Common/Server/Utils/DataSource/EgressGuard";
import OutboundUserAgent from "Common/Server/Utils/OutboundUserAgent";
import Dictionary from "Common/Types/Dictionary";
import EgressGuardException, {
  EgressFailureReason,
} from "Common/Types/Exception/EgressGuardException";
import { BackupStorageError } from "./BackupStorage";

/*
 * How the backup storage clients talk HTTP: one request, its body a
 * buffer (a part of a backup, a manifest) or nothing, its answer a stream
 * the caller reads or throws away - so a backup of any size is read back
 * without ever being held in memory.
 *
 * In production every socket's address goes through the egress guard
 * (createGuardedLookup: the address checked is the address dialed), no
 * redirect is followed, and a socket that sends nothing for the idle
 * timeout is closed. Tests hand the clients a transport of their own.
 */

export type BackupHttpMethod = "GET" | "PUT" | "POST" | "DELETE" | "HEAD";

export interface BackupHttpRequest {
  method: BackupHttpMethod;
  url: string;
  headers: Dictionary<string>;
  body?: Buffer | undefined;
  // How long the connection may stay silent before it counts as dead.
  idleTimeoutInMs?: number | undefined;
}

export interface BackupHttpResponse {
  statusCode: number;
  // Lowercased names.
  headers: Dictionary<string>;
  // Must be read to its end or destroyed.
  body: Readable;
}

export type BackupHttpTransport = (
  request: BackupHttpRequest,
) => Promise<BackupHttpResponse>;

// A request that has sent or received nothing for this long is dead.
export const BACKUP_HTTP_IDLE_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

// The most a response the clients read whole (an error, a listing) may hold.
export const BACKUP_HTTP_MAX_TEXT_RESPONSE_IN_BYTES: number = 8 * 1024 * 1024;

function lowerHeaders(
  headers: http.IncomingHttpHeaders,
): Dictionary<string> {
  const lowered: Dictionary<string> = {};

  for (const name of Object.keys(headers)) {
    const value: string | Array<string> | undefined = headers[name];

    if (value === undefined) {
      continue;
    }

    lowered[name.toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : String(value);
  }

  return lowered;
}

/*
 * The production transport: node's http/https with the egress guard's
 * lookup on every socket, keep-alive between requests to one storage, and
 * the idle timeout. A refused address throws an EgressGuardException,
 * which the clients turn into a sentence (describeTransportError).
 */
export function createGuardedBackupTransport(
  egressOptions: EgressGuardOptions,
): BackupHttpTransport {
  const lookup: ReturnType<typeof DataSourceEgressGuard.createGuardedLookup> =
    DataSourceEgressGuard.createGuardedLookup(egressOptions);
  const httpAgent: http.Agent = new http.Agent({
    keepAlive: true,
    lookup: lookup as never,
  });
  const httpsAgent: https.Agent = new https.Agent({
    keepAlive: true,
    lookup: lookup as never,
  });

  return (request: BackupHttpRequest): Promise<BackupHttpResponse> => {
    return new Promise<BackupHttpResponse>(
      (resolve: (value: BackupHttpResponse) => void, reject: (error: unknown) => void) => {
        let url: URL;

        try {
          url = new URL(request.url);
        } catch {
          reject(new BackupStorageError(`${request.url} is not an address.`, {
            retryable: false,
          }));
          return;
        }

        const isHttps: boolean = url.protocol === "https:";
        const headers: Dictionary<string> = OutboundUserAgent.withDefault({
          ...request.headers,
        });

        if (request.body !== undefined) {
          headers["Content-Length"] = String(request.body.length);
        }

        const client: typeof https | typeof http = isHttps ? https : http;
        const outgoing: http.ClientRequest = client.request(
          {
            method: request.method,
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            headers,
            agent: isHttps ? httpsAgent : httpAgent,
          },
          (incoming: http.IncomingMessage) => {
            incoming.setTimeout(
              request.idleTimeoutInMs || BACKUP_HTTP_IDLE_TIMEOUT_IN_MS,
              () => {
                incoming.destroy(
                  new Error("the storage stopped sending in the middle of an answer"),
                );
              },
            );

            resolve({
              statusCode: incoming.statusCode || 0,
              headers: lowerHeaders(incoming.headers),
              body: incoming,
            });
          },
        );

        outgoing.setTimeout(
          request.idleTimeoutInMs || BACKUP_HTTP_IDLE_TIMEOUT_IN_MS,
          () => {
            outgoing.destroy(new Error("the storage did not answer in time"));
          },
        );

        outgoing.on("error", (error: Error) => {
          reject(error);
        });

        if (request.body !== undefined) {
          outgoing.end(request.body);
        } else {
          outgoing.end();
        }
      },
    );
  };
}

// An answer read whole, up to a limit; a longer one is cut there.
export async function readResponseText(
  response: BackupHttpResponse,
  maxBytes: number = BACKUP_HTTP_MAX_TEXT_RESPONSE_IN_BYTES,
): Promise<string> {
  const chunks: Array<Buffer> = [];
  let size: number = 0;

  for await (const chunk of response.body) {
    const buffer: Buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);

    if (size + buffer.length > maxBytes) {
      chunks.push(buffer.subarray(0, Math.max(0, maxBytes - size)));
      response.body.destroy();
      break;
    }

    chunks.push(buffer);
    size += buffer.length;
  }

  return Buffer.concat(chunks).toString("utf8");
}

// An answer read whole into bytes, up to a limit (a manifest).
export async function readResponseBytes(
  response: BackupHttpResponse,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Array<Buffer> = [];
  let size: number = 0;

  for await (const chunk of response.body) {
    const buffer: Buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    size += buffer.length;

    if (size > maxBytes) {
      response.body.destroy();
      throw new BackupStorageError(
        `The file is larger than the ${maxBytes} bytes OneUptime reads of it.`,
        { retryable: false },
      );
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

// Throws an answer's body away, so its socket goes back to the pool.
export function discardResponse(response: BackupHttpResponse): void {
  response.body.resume();
}

/*
 * An error's own words, without a closing full stop (the sentence adds its
 * own). Read by shape: an error node's own http code made can come from
 * another realm than this module's.
 */
export function errorText(error: unknown): string {
  const message: unknown =
    error && typeof error === "object"
      ? (error as { message?: unknown }).message
      : undefined;
  let text: string =
    typeof message === "string" && message ? message : String(error);

  text = text.trim();

  while (text.endsWith(".")) {
    text = text.slice(0, -1);
  }

  return text;
}

/*
 * What went wrong when there was no answer at all: the egress policy
 * refused the address (a setting to change), or the storage could not be
 * reached or stopped answering (worth another try).
 */
export function describeTransportError(data: {
  error: unknown;
  serviceTitle: string;
  hint?: string | undefined;
}): BackupStorageError {
  if (data.error instanceof BackupStorageError) {
    return data.error;
  }

  if (data.error instanceof EgressGuardException) {
    const isUnreachable: boolean =
      data.error.reason === EgressFailureReason.Unreachable ||
      data.error.reason === EgressFailureReason.ResolutionFailed;

    return new BackupStorageError(data.error.message, {
      retryable: isUnreachable,
    });
  }

  return new BackupStorageError(
    `Could not reach ${data.serviceTitle}: ${errorText(data.error)}.${
      data.hint ? ` ${data.hint}` : ""
    }`,
    { retryable: true },
  );
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const RETRY_DELAYS_IN_MS: Array<number> = [1000, 4000, 15000];

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

/*
 * One request, tried again after a short wait when what failed is worth
 * another try (no answer, a 5xx, a 429) - three more times at most. The
 * attempt builds its request itself (a signature names its time).
 */
export async function withRetries<T>(data: {
  attempt: () => Promise<T>;
  delaysInMs?: Array<number> | undefined;
}): Promise<T> {
  const delays: Array<number> = data.delaysInMs || RETRY_DELAYS_IN_MS;
  let lastError: unknown = null;

  for (let index: number = 0; index <= delays.length; index++) {
    try {
      return await data.attempt();
    } catch (error) {
      lastError = error;

      const retryable: boolean =
        error instanceof BackupStorageError ? error.retryable : false;

      if (!retryable || index === delays.length) {
        throw error;
      }

      await sleep(delays[index] || 0);
    }
  }

  throw lastError;
}

import Dictionary from "../../../../Types/Dictionary";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../Types/Exception/EgressGuardException";
import {
  EXTERNAL_CALENDAR_FETCH_TIMEOUT_IN_MS,
  EXTERNAL_CALENDAR_MAX_BYTES,
  EXTERNAL_CALENDAR_MAX_REDIRECTS,
  ExternalCalendarReadError,
} from "../../../../Types/ScheduledMaintenance/ExternalCalendar";
import DataSourceEgressGuard, {
  PinnedAgents,
} from "../../DataSource/EgressGuard";
import OutboundUserAgent from "../../OutboundUserAgent";
import http from "http";
import https from "https";
import zlib from "zlib";

/*
 * Reads a calendar link: one GET, and the redirects it answers with.
 *
 * A link is chosen by a project member and can point anywhere, so every
 * request goes through OneUptime's egress guard (DataSourceEgressGuard), as
 * the Data Source connectors' and the threat-intel feeds' do: the host is
 * resolved and checked BEFORE a socket opens, and the socket is PINNED to
 * the addresses that were checked, so DNS cannot answer differently a
 * moment later. On OneUptime Cloud that keeps every private and internal
 * address out of reach; a self-hosted OneUptime may read a calendar on its
 * own network (an Exchange server on 10.0.0.0/8), as it may a data source,
 * and never loopback or a cloud metadata address.
 *
 * A redirect is not left to the HTTP client: its Location is checked and
 * pinned like the first address, at most EXTERNAL_CALENDAR_MAX_REDIRECTS
 * times. The body may be no larger than EXTERNAL_CALENDAR_MAX_BYTES once
 * decompressed - the read stops when it passes it - and the whole read,
 * redirects included, no longer than EXTERNAL_CALENDAR_FETCH_TIMEOUT_IN_MS:
 * a server that answers a byte at a time is cut off all the same.
 *
 * What failed is answered as one of ExternalCalendarReadError, never with
 * the link or what the server said: the link can be a secret, and the
 * answer is shown to every reader of the project.
 */

export interface ExternalCalendarHttpRequest {
  url: string;
  headers: Dictionary<string>;
  agents: PinnedAgents;
  maxBytes: number;
  signal: AbortSignal;
}

export interface ExternalCalendarHttpResponse {
  statusCode: number;
  // Lowercased names.
  headers: Dictionary<string>;
  body: string;
}

// The request itself: the real one below, a fixture in tests.
export type ExternalCalendarTransport = (
  request: ExternalCalendarHttpRequest,
) => Promise<ExternalCalendarHttpResponse>;

// The address check: DataSourceEgressGuard's, or a fixture in tests.
export type ExternalCalendarAddressGuard = (
  url: string,
) => Promise<{ url: URL } & PinnedAgents>;

export enum ExternalCalendarTransportErrorKind {
  TooLarge = "TooLarge",
  Timeout = "Timeout",
  Unreachable = "Unreachable",
}

// A transport's way of saying why there is no response at all.
export class ExternalCalendarTransportError extends Error {
  public readonly kind: ExternalCalendarTransportErrorKind;

  public constructor(kind: ExternalCalendarTransportErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

export type ExternalCalendarFetchResult =
  | { ok: true; body: string }
  | {
      ok: false;
      error: ExternalCalendarReadError;
      // The HTTP status, for an error the server answered with.
      httpStatus: number | null;
    };

export interface ExternalCalendarFetchOptions {
  transport?: ExternalCalendarTransport | undefined;
  guard?: ExternalCalendarAddressGuard | undefined;
  timeoutInMs?: number | undefined;
  maxBytes?: number | undefined;
}

export const EXTERNAL_CALENDAR_ACCEPT_HEADER: string =
  "text/calendar, text/plain;q=0.9, */*;q=0.1";

// What the guard calls the target in the messages it logs.
const TARGET_LABEL: string = "Calendar link";

const REDIRECT_STATUSES: ReadonlyArray<number> = [301, 302, 303, 307, 308];

function failed(
  error: ExternalCalendarReadError,
  httpStatus: number | null = null,
): ExternalCalendarFetchResult {
  return { ok: false, error: error, httpStatus: httpStatus };
}

export default class ExternalCalendarFetch {
  public static readonly defaultGuard: ExternalCalendarAddressGuard = async (
    url: string,
  ): Promise<{ url: URL } & PinnedAgents> => {
    const pinned: { url: URL } & PinnedAgents =
      await DataSourceEgressGuard.assertUrlAllowedAndPin(url, {
        targetLabel: TARGET_LABEL,
      });

    return {
      url: pinned.url,
      httpAgent: pinned.httpAgent,
      httpsAgent: pinned.httpsAgent,
    };
  };

  /*
   * The real request: Node's own http client over the pinned agents - the
   * same in every environment it runs in - following no redirect itself,
   * its body cut off past maxBytes as it is decompressed, and stopped when
   * the signal fires.
   */
  public static readonly defaultTransport: ExternalCalendarTransport = (
    request: ExternalCalendarHttpRequest,
  ): Promise<ExternalCalendarHttpResponse> => {
    return new Promise<ExternalCalendarHttpResponse>(
      (
        resolve: (response: ExternalCalendarHttpResponse) => void,
        reject: (error: ExternalCalendarTransportError) => void,
      ) => {
        const url: URL = new URL(request.url);
        const isHttps: boolean = url.protocol === "https:";
        let isSettled: boolean = false;

        const clientRequest: http.ClientRequest = (
          isHttps ? https : http
        ).request(url, {
          method: "GET",
          headers: {
            ...request.headers,
            "Accept-Encoding": "gzip, deflate, br",
          },
          agent: isHttps ? request.agents.httpsAgent : request.agents.httpAgent,
        });

        const onAbort: () => void = (): void => {
          fail(ExternalCalendarTransportErrorKind.Timeout);
        };

        const fail: (kind: ExternalCalendarTransportErrorKind) => void = (
          kind: ExternalCalendarTransportErrorKind,
        ): void => {
          if (isSettled) {
            return;
          }

          isSettled = true;
          request.signal.removeEventListener("abort", onAbort);
          clientRequest.destroy();
          reject(new ExternalCalendarTransportError(kind));
        };

        const finish: (response: ExternalCalendarHttpResponse) => void = (
          response: ExternalCalendarHttpResponse,
        ): void => {
          if (isSettled) {
            return;
          }

          isSettled = true;
          request.signal.removeEventListener("abort", onAbort);
          resolve(response);
        };

        if (request.signal.aborted) {
          onAbort();
          return;
        }

        request.signal.addEventListener("abort", onAbort);

        clientRequest.on("response", (response: http.IncomingMessage) => {
          const statusCode: number = response.statusCode || 0;
          const headers: Dictionary<string> = {};

          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
              headers[name.toLowerCase()] = Array.isArray(value)
                ? value.join(", ")
                : String(value);
            }
          }

          // A redirect's or an error's body is never read.
          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            finish({ statusCode: statusCode, headers: headers, body: "" });
            return;
          }

          const encoding: string = (headers["content-encoding"] || "")
            .trim()
            .toLowerCase();

          let body: NodeJS.ReadableStream = response;

          if (encoding === "gzip" || encoding === "x-gzip") {
            body = response.pipe(zlib.createGunzip());
          } else if (encoding === "deflate") {
            body = response.pipe(zlib.createInflate());
          } else if (encoding === "br") {
            body = response.pipe(zlib.createBrotliDecompress());
          }

          const chunks: Array<Buffer> = [];
          let size: number = 0;

          body.on("data", (chunk: Buffer) => {
            size += chunk.length;

            // Counted once decompressed: a small compressed bomb is still too large.
            if (size > request.maxBytes) {
              fail(ExternalCalendarTransportErrorKind.TooLarge);
              response.destroy();
              return;
            }

            chunks.push(chunk);
          });

          body.on("end", () => {
            finish({
              statusCode: statusCode,
              headers: headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });

          body.on("error", () => {
            fail(ExternalCalendarTransportErrorKind.Unreachable);
          });
        });

        clientRequest.on("error", () => {
          fail(
            request.signal.aborted
              ? ExternalCalendarTransportErrorKind.Timeout
              : ExternalCalendarTransportErrorKind.Unreachable,
          );
        });

        clientRequest.end();
      },
    );
  };

  // What an error a transport threw means for a calendar read.
  public static toTransportError(
    error: unknown,
    signal: AbortSignal,
  ): ExternalCalendarTransportError {
    if (error instanceof ExternalCalendarTransportError) {
      return error;
    }

    const code: string =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code || "")
        : "";

    const message: string =
      error instanceof Error ? error.message.toLowerCase() : "";

    if (message.includes("maxcontentlength")) {
      return new ExternalCalendarTransportError(
        ExternalCalendarTransportErrorKind.TooLarge,
      );
    }

    if (
      signal.aborted ||
      code === "ECONNABORTED" ||
      code === "ETIMEDOUT" ||
      code === "ERR_CANCELED" ||
      code === "ABORT_ERR"
    ) {
      return new ExternalCalendarTransportError(
        ExternalCalendarTransportErrorKind.Timeout,
      );
    }

    return new ExternalCalendarTransportError(
      ExternalCalendarTransportErrorKind.Unreachable,
    );
  }

  // What a refusal of the egress guard means for a calendar read.
  public static fromGuardError(error: unknown): ExternalCalendarReadError {
    if (
      error instanceof EgressGuardException &&
      (error.reason === EgressFailureReason.AddressBlocked ||
        error.reason === EgressFailureReason.InvalidTarget)
    ) {
      return ExternalCalendarReadError.NotAllowed;
    }

    /*
     * A refusal whose detail the guard keeps back (OneUptime Cloud) says
     * only that the address could not be reached: a link to an internal
     * name and a link to a name that does not exist read the same.
     */
    return ExternalCalendarReadError.Unreachable;
  }

  public static async fetch(
    link: string,
    options?: ExternalCalendarFetchOptions,
  ): Promise<ExternalCalendarFetchResult> {
    const transport: ExternalCalendarTransport =
      options?.transport || this.defaultTransport;
    const guard: ExternalCalendarAddressGuard =
      options?.guard || this.defaultGuard;
    const maxBytes: number = options?.maxBytes ?? EXTERNAL_CALENDAR_MAX_BYTES;

    // One deadline for the whole read, redirects included.
    const controller: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      controller.abort();
    }, options?.timeoutInMs ?? EXTERNAL_CALENDAR_FETCH_TIMEOUT_IN_MS);

    try {
      let current: string = link;

      for (
        let redirects: number = 0;
        redirects <= EXTERNAL_CALENDAR_MAX_REDIRECTS;
        redirects++
      ) {
        let pinned: { url: URL } & PinnedAgents;

        try {
          pinned = await guard(current);
        } catch (error) {
          return failed(this.fromGuardError(error));
        }

        let response: ExternalCalendarHttpResponse;

        try {
          if (controller.signal.aborted) {
            throw new ExternalCalendarTransportError(
              ExternalCalendarTransportErrorKind.Timeout,
            );
          }

          response = await transport({
            url: pinned.url.toString(),
            headers: OutboundUserAgent.withDefault({
              Accept: EXTERNAL_CALENDAR_ACCEPT_HEADER,
            }),
            agents: {
              httpAgent: pinned.httpAgent,
              httpsAgent: pinned.httpsAgent,
            },
            maxBytes: maxBytes,
            signal: controller.signal,
          });
        } catch (error) {
          const transportError: ExternalCalendarTransportError =
            this.toTransportError(error, controller.signal);

          if (
            transportError.kind === ExternalCalendarTransportErrorKind.TooLarge
          ) {
            return failed(ExternalCalendarReadError.TooLarge);
          }

          if (
            transportError.kind === ExternalCalendarTransportErrorKind.Timeout
          ) {
            return failed(ExternalCalendarReadError.Timeout);
          }

          return failed(ExternalCalendarReadError.Unreachable);
        } finally {
          this.destroyAgents(pinned);
        }

        if (REDIRECT_STATUSES.includes(response.statusCode)) {
          const next: string | null = this.getRedirectTarget(
            current,
            response.headers["location"],
          );

          if (!next) {
            return failed(
              ExternalCalendarReadError.ServerError,
              response.statusCode,
            );
          }

          current = next;
          continue;
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (response.body.length > maxBytes) {
            return failed(ExternalCalendarReadError.TooLarge);
          }

          return { ok: true, body: response.body };
        }

        if (response.statusCode === 401 || response.statusCode === 403) {
          return failed(
            ExternalCalendarReadError.AccessDenied,
            response.statusCode,
          );
        }

        if (response.statusCode === 404 || response.statusCode === 410) {
          return failed(
            ExternalCalendarReadError.NotFound,
            response.statusCode,
          );
        }

        return failed(
          ExternalCalendarReadError.ServerError,
          response.statusCode,
        );
      }

      return failed(ExternalCalendarReadError.TooManyRedirects);
    } finally {
      clearTimeout(timer);
    }
  }

  /*
   * Where a redirect points, read against the address that answered: only
   * http(s), and never with credentials of its own.
   */
  public static getRedirectTarget(
    from: string,
    location: string | undefined,
  ): string | null {
    if (!location) {
      return null;
    }

    let target: URL;

    try {
      target = new URL(location.trim(), from);
    } catch {
      return null;
    }

    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return null;
    }

    if (target.username || target.password) {
      return null;
    }

    target.hash = "";

    return target.toString();
  }

  private static destroyAgents(agents: PinnedAgents): void {
    agents.httpAgent.destroy();
    agents.httpsAgent.destroy();
  }
}

import { OpenStackVerifyingAgent } from "./OpenStackTls";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";
import OpenStackAuthUrl from "Common/Utils/OpenStack/OpenStackAuthUrl";
import http from "http";
import https from "https";

/*
 * What every call to a cloud goes through.
 *
 * A transport is one function, so a test can answer it from a recording, and the real
 * one holds the rules no request may get around:
 *
 *   - HTTPS only. A plain http URL, which a catalog can well hold (DevStack's and
 *     Kolla's defaults), is refused before anything is written, because the request
 *     would carry a token. The one exception carries none: a storage server's /recon,
 *     which only ever speaks plain HTTP (isSwiftReconRequest);
 *   - each host's addresses are checked once, by `resolve`, against the addresses a
 *     probe never connects to, and its socket is pinned to them;
 *   - each request is on a socket whose certificate passed before the request was
 *     written;
 *   - each request has a deadline, and an answer larger than OpenStack ever sends is
 *     cut off rather than read into memory;
 *   - redirects are not followed, because a token would follow them.
 */

export interface OpenStackHttpRequest {
  method: "GET" | "POST" | "DELETE";
  // An absolute https URL.
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
  timeoutInMs: number;
}

export interface OpenStackHttpResponse {
  status: number;
  headers: Record<string, string | Array<string> | undefined>;
  body: string;
}

export type OpenStackTransport = (
  request: OpenStackHttpRequest,
) => Promise<OpenStackHttpResponse>;

export interface OpenStackTransportHandle {
  transport: OpenStackTransport;
  close: () => void;
}

/*
 * Swift's storage servers say how they are at /recon, on their own port, in plain HTTP and with no login,
 * recorded. So a read of it can't be held to the rule above, and needn't be: nothing in it is a secret. This
 * lets through only a GET under /recon with no token on it, whichever way the request was built.
 */
export function isSwiftReconRequest(request: OpenStackHttpRequest): boolean {
  let url: globalThis.URL;

  try {
    url = new globalThis.URL(request.url);
  } catch {
    return false;
  }

  return (
    url.protocol === "http:" &&
    request.method === "GET" &&
    !request.body &&
    url.pathname.startsWith("/recon/") &&
    !Object.keys(request.headers).some((name: string): boolean => {
      return name.toLowerCase() === "x-auth-token";
    })
  );
}

export class OpenStackResponseTooLargeError extends Error {
  public constructor(url: string, maxBytes: number) {
    super(
      `${hostOf(url)} answered with more than ${Math.round(maxBytes / (1024 * 1024))} MiB.`,
    );
    this.name = "OpenStackResponseTooLargeError";
  }
}

export class OpenStackRequestTimeoutError extends Error {
  public readonly code: string = "ETIMEDOUT";
  public readonly url: string;

  public constructor(url: string, timeoutInMs: number) {
    super(
      `${hostOf(url)} did not answer within ${Math.round(timeoutInMs / 1000)} seconds.`,
    );
    this.name = "OpenStackRequestTimeoutError";
    this.url = url;
  }
}

// A URL the probe will not speak to, whatever else it could do.
export class OpenStackEndpointRefusedError extends Error {
  public readonly kind: "insecure" | "forbidden" | "invalid";

  public constructor(data: {
    kind: "insecure" | "forbidden" | "invalid";
    message: string;
  }) {
    super(data.message);
    this.name = "OpenStackEndpointRefusedError";
    this.kind = data.kind;
  }
}

function hostOf(url: string): string {
  try {
    return new globalThis.URL(url).host;
  } catch {
    return "The API";
  }
}

/*
 * The real transport. One verifying agent per host, made the first time the host is
 * asked for and only after its addresses passed.
 */
export function createOpenStackTransport(data: {
  trustedFingerprints: ReadonlyArray<string>;
  resolve: (url: string) => Promise<Array<string>>;
  connectTimeoutInMs: number;
  maxResponseBytes: number;
  // What each new connection's certificate is, for whoever wants to know when it expires.
  onCertificate?:
    | ((certificate: OpenStackPresentedCertificate) => void)
    | undefined;
}): OpenStackTransportHandle {
  const agents: Map<string, Promise<OpenStackVerifyingAgent>> = new Map();

  const agentFor: (url: globalThis.URL) => Promise<OpenStackVerifyingAgent> = (
    url: globalThis.URL,
  ): Promise<OpenStackVerifyingAgent> => {
    const key: string = url.host.toLowerCase();
    let agent: Promise<OpenStackVerifyingAgent> | undefined = agents.get(key);

    if (!agent) {
      let host: string = url.hostname.toLowerCase();

      if (host.startsWith("[") && host.endsWith("]")) {
        host = host.slice(1, -1);
      }

      agent = data
        .resolve(url.origin)
        .then((pinnedAddresses: Array<string>): OpenStackVerifyingAgent => {
          return new OpenStackVerifyingAgent({
            host: host,
            port: url.port ? Number.parseInt(url.port, 10) : 443,
            pinnedAddresses: pinnedAddresses,
            trustedFingerprints: data.trustedFingerprints,
            connectTimeoutInMs: data.connectTimeoutInMs,
            onCertificate: data.onCertificate,
          });
        });

      /*
       * Kept when it fails too, so a host that will not resolve is asked once per
       * collection rather than once per request.
       */
      agents.set(key, agent);
    }

    return agent;
  };

  const transport: OpenStackTransport = async (
    request: OpenStackHttpRequest,
  ): Promise<OpenStackHttpResponse> => {
    if (isSwiftReconRequest(request)) {
      const url: globalThis.URL = new globalThis.URL(request.url);
      // Checked as any other host's are, and pinned to what was checked.
      const pinnedAddresses: Array<string> = await data.resolve(url.origin);

      return await send({
        request: request,
        url: url,
        pinnedAddress: pinnedAddresses[0],
        maxResponseBytes: data.maxResponseBytes,
      });
    }

    const refusal: ReturnType<typeof OpenStackAuthUrl.getCatalogUrlRefusal> =
      OpenStackAuthUrl.getCatalogUrlRefusal(request.url);

    if (refusal) {
      throw new OpenStackEndpointRefusedError({
        kind: refusal.code,
        message: refusal.message,
      });
    }

    const url: globalThis.URL = new globalThis.URL(request.url);
    const agent: OpenStackVerifyingAgent = await agentFor(url);

    return await send({
      request: request,
      url: url,
      agent: agent,
      maxResponseBytes: data.maxResponseBytes,
    });
  };

  return {
    transport: transport,
    close: (): void => {
      for (const agent of agents.values()) {
        agent
          .then((resolved: OpenStackVerifyingAgent) => {
            resolved.destroy();
          })
          .catch(() => {
            // Nothing was opened for a host that did not resolve.
          });
      }

      agents.clear();
    },
  };
}

function send(data: {
  request: OpenStackHttpRequest;
  url: globalThis.URL;
  // A verified HTTPS socket's, or for plain HTTP the one address it may connect to.
  agent?: https.Agent | undefined;
  pinnedAddress?: string | undefined;
  maxResponseBytes: number;
}): Promise<OpenStackHttpResponse> {
  return new Promise<OpenStackHttpResponse>(
    (
      resolve: (response: OpenStackHttpResponse) => void,
      reject: (error: Error) => void,
    ) => {
      const { request, url } = data;
      const body: Buffer | undefined =
        request.body === undefined ? undefined : Buffer.from(request.body);

      const headers: Record<string, string | number> = {
        ...request.headers,
        Host: url.host,
        // Never compressed: the size limit below has to mean what it says.
        "Accept-Encoding": "identity",
      };

      if (body) {
        headers["Content-Length"] = body.length;
      }

      let isSettled: boolean = false;

      const settle: (
        error: Error | null,
        response?: OpenStackHttpResponse,
      ) => void = (
        error: Error | null,
        response?: OpenStackHttpResponse,
      ): void => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearTimeout(timer);

        if (error) {
          reject(error);
        } else {
          resolve(response!);
        }
      };

      const isPlain: boolean = url.protocol === "http:";
      const clientRequest: http.ClientRequest = (
        isPlain ? http.request : https.request
      )(
        {
          host: isPlain
            ? data.pinnedAddress
            : url.hostname.startsWith("[")
              ? url.hostname.slice(1, -1)
              : url.hostname,
          port: url.port ? Number.parseInt(url.port, 10) : isPlain ? 80 : 443,
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers: headers,
          agent: data.agent,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          let size: number = 0;

          response.on("data", (chunk: Buffer) => {
            size += chunk.length;

            if (size > data.maxResponseBytes) {
              response.destroy();
              clientRequest.destroy();
              settle(
                new OpenStackResponseTooLargeError(
                  request.url,
                  data.maxResponseBytes,
                ),
              );
              return;
            }

            chunks.push(chunk);
          });

          response.on("end", () => {
            settle(null, {
              status: response.statusCode || 0,
              headers: response.headers as Record<
                string,
                string | Array<string> | undefined
              >,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });

          response.on("error", (error: Error) => {
            settle(error);
          });
        },
      );

      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        clientRequest.destroy();
        settle(
          new OpenStackRequestTimeoutError(request.url, request.timeoutInMs),
        );
      }, request.timeoutInMs);

      clientRequest.on("error", (error: Error) => {
        settle(error);
      });

      if (body) {
        clientRequest.write(body);
      }

      clientRequest.end();
    },
  );
}

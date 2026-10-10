import {
  VSphereHttpRequest,
  VSphereHttpResponse,
  VSphereTransport,
} from "./VSphereSoapClient";
import http from "http";
import https from "https";

/*
 * The real transport of VSphereSoapClient: HTTPS through a
 * VSphereVerifyingAgent, so every request travels on a socket whose
 * certificate passed before the request was written. Each request has a
 * deadline, and an answer larger than vSphere ever sends is cut off rather
 * than read into memory.
 */

export class VSphereResponseTooLargeError extends Error {
  public constructor(maxBytes: number) {
    super(
      `vSphere's answer is larger than ${Math.round(maxBytes / (1024 * 1024))} MiB.`,
    );
    this.name = "VSphereResponseTooLargeError";
  }
}

export class VSphereRequestTimeoutError extends Error {
  public readonly code: string = "ETIMEDOUT";

  public constructor(path: string, timeoutInMs: number) {
    super(
      `vSphere did not answer ${path} within ${Math.round(timeoutInMs / 1000)} seconds.`,
    );
    this.name = "VSphereRequestTimeoutError";
  }
}

export function createVSphereTransport(data: {
  host: string;
  port: number;
  agent: https.Agent;
  requestTimeoutInMs: number;
  maxResponseBytes: number;
}): VSphereTransport {
  return (request: VSphereHttpRequest): Promise<VSphereHttpResponse> => {
    return new Promise<VSphereHttpResponse>(
      (
        resolve: (response: VSphereHttpResponse) => void,
        reject: (error: Error) => void,
      ) => {
        const body: Buffer | undefined =
          request.body === undefined ? undefined : Buffer.from(request.body);

        const headers: Record<string, string | number> = {
          ...request.headers,
          Host: data.port === 443 ? data.host : `${data.host}:${data.port}`,
        };

        if (body) {
          headers["Content-Length"] = body.length;
        }

        let isSettled: boolean = false;

        const settle: (
          error: Error | null,
          response?: VSphereHttpResponse,
        ) => void = (
          error: Error | null,
          response?: VSphereHttpResponse,
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

        const clientRequest: http.ClientRequest = https.request(
          {
            host: data.host,
            port: data.port,
            method: request.method,
            path: request.path,
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
                settle(new VSphereResponseTooLargeError(data.maxResponseBytes));
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
            new VSphereRequestTimeoutError(
              request.path,
              data.requestTimeoutInMs,
            ),
          );
        }, data.requestTimeoutInMs);

        clientRequest.on("error", (error: Error) => {
          settle(error);
        });

        if (body) {
          clientRequest.write(body);
        }

        clientRequest.end();
      },
    );
  };
}

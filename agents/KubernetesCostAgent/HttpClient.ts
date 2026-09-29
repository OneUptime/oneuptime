import { URL } from "url";
import * as http from "http";
import * as https from "https";

const REQUEST_TIMEOUT_MS: number = 120000;

export interface HttpResult {
  statusCode: number;
  body: string;
}

const request: (options: {
  method: "GET" | "POST";
  url: URL;
  headers?: Record<string, string>;
  body?: Buffer | undefined;
}) => Promise<HttpResult> = (options: {
  method: "GET" | "POST";
  url: URL;
  headers?: Record<string, string>;
  body?: Buffer | undefined;
}): Promise<HttpResult> => {
  const transport: typeof http | typeof https =
    options.url.protocol === "https:" ? https : http;

  return new Promise(
    (
      resolve: (result: HttpResult) => void,
      reject: (err: Error) => void,
    ): void => {
      const req: http.ClientRequest = transport.request(
        {
          method: options.method,
          hostname: options.url.hostname,
          port:
            options.url.port || (options.url.protocol === "https:" ? 443 : 80),
          path: options.url.pathname + options.url.search,
          headers: {
            ...(options.body
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": options.body.length,
                }
              : {}),
            ...(options.headers || {}),
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res: http.IncomingMessage): void => {
          const chunks: Array<Buffer> = [];
          res.on("data", (chunk: Buffer): void => {
            chunks.push(chunk);
          });
          res.on("end", (): void => {
            resolve({
              statusCode: res.statusCode || 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      req.on("timeout", (): void => {
        req.destroy(
          new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`),
        );
      });
      req.on("error", (err: Error): void => {
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    },
  );
};

export const httpGetJson: (
  url: URL,
  headers?: Record<string, string>,
) => Promise<HttpResult> = (
  url: URL,
  headers?: Record<string, string>,
): Promise<HttpResult> => {
  return request({ method: "GET", url, headers: headers || {} });
};

export const httpPostJson: (
  url: URL,
  body: unknown,
  headers?: Record<string, string>,
) => Promise<HttpResult> = (
  url: URL,
  body: unknown,
  headers?: Record<string, string>,
): Promise<HttpResult> => {
  return request({
    method: "POST",
    url,
    headers: headers || {},
    body: Buffer.from(JSON.stringify(body), "utf8"),
  });
};

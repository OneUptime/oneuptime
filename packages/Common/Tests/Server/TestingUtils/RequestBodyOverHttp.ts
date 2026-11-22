import { ExpressApplication } from "../../../Server/Utils/Express";
import { execFile } from "child_process";
import express from "express";
import http from "http";
import { AddressInfo, Socket } from "net";
import timers from "timers";

/*
 * REQUEST BODIES OVER A REAL SOCKET, SENT BY REAL CLIENTS, AND WHAT THE
 * SERVER READ OFF THE CONNECTION FOR EACH (#10598, #10643, #10644).
 *
 * An app - StartServer's own, with the routes under test mounted on it - is
 * served on a port of its own, and each request is sent on a connection of
 * its own: by Node's http client, on a connection it asks to keep or to
 * close (the probe and the CLI send with it), or by fetch in a Node process
 * of its own (an OpenTelemetry exporter in Node; jsdom has no fetch). What
 * the server read off the connection by the time it closed it - the answer,
 * and anything after it - is what a client could make it read.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const KIB: number = 1024;
export const MIB: number = 1024 * 1024;

// A socket read or two: what a refused body may cost past where it was refused.
export const READ_OR_TWO: number = 512 * KIB;

export type Connection = "keep-alive" | "close";

export const CONNECTIONS: ReadonlyArray<Connection> = ["keep-alive", "close"];

// The header each request is told apart by.
const TAG_HEADER: string = "x-body-test";

export interface BodyAnswer {
  status: number | null;
  // The answer's Connection header.
  connection: string | null;
  text: string;
  // The answer as JSON, when it is: a JSON body, or an event stream's data.
  json: unknown;
  // What the client was told when the server closed under its body.
  clientError: string | null;
}

export interface SentRequest {
  // The request's tag: what readInAll is asked with.
  tag: string;
  answer: BodyAnswer;
}

export interface BodyServer {
  port: number;
  // All the server read off a request's connection, once it closed it.
  readInAll: (tag: string) => Promise<number>;
  close: () => Promise<void>;
}

export interface BodyRequest {
  path: string;
  method?: string | undefined;
  headers: Record<string, string>;
  // Default keep-alive.
  connection?: Connection | undefined;
  // Default false: a Content-Length.
  chunked?: boolean | undefined;
  // The body as it is sent; or `bytes` of `fill`.
  body?: Buffer | undefined;
  bytes?: number | undefined;
  fill?: number | undefined;
}

// The JSON of an answer's text: JSON itself, or the data of an event stream.
export const readAnswerJson: (text: string) => unknown = (
  text: string,
): unknown => {
  const dataLine: string | undefined = text
    .split(/\r?\n/)
    .find((line: string): boolean => {
      return line.startsWith("data:");
    });

  try {
    return JSON.parse(dataLine ? dataLine.slice("data:".length) : text);
  } catch {
    return null;
  }
};

let count: number = 0;

const nextTag: () => string = (): string => {
  count++;
  return `body-${process.pid}-${count}`;
};

// Serves `app` on a port of its own, counting what is read off each connection.
export const startBodyServer: (
  app: ExpressApplication,
) => Promise<BodyServer> = async (
  app: ExpressApplication,
): Promise<BodyServer> => {
  const closed: Map<string, Promise<number>> = new Map();

  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const tag: string = String(req.headers[TAG_HEADER] || "");
      const socket: Socket = req.socket;

      if (tag && !closed.has(tag)) {
        closed.set(
          tag,
          new Promise<number>((resolve: (bytes: number) => void) => {
            socket.once("close", () => {
              resolve(socket.bytesRead);
            });
          }),
        );
      }

      app(req as express.Request, res as express.Response);
    },
  );

  server.keepAliveTimeout = 60000;

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    readInAll: (tag: string): Promise<number> => {
      const read: Promise<number> | undefined = closed.get(tag);

      if (!read) {
        throw new Error(`No request was tagged ${tag}.`);
      }

      return read;
    },
    close: async (): Promise<void> => {
      server.closeAllConnections();

      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
};

/*
 * Sends a body with Node's http client, 64 KiB at a time as the socket takes
 * it, with a Content-Length or chunked, until it is all sent or the server
 * has answered and closed. The connection is the request's own.
 */
export const sendOverHttp: (
  server: BodyServer,
  request: BodyRequest,
) => Promise<SentRequest> = (
  server: BodyServer,
  request: BodyRequest,
): Promise<SentRequest> => {
  const tag: string = nextTag();
  const agent: http.Agent = new http.Agent({
    keepAlive: (request.connection || "keep-alive") === "keep-alive",
  });
  const body: Buffer | null = request.body || null;
  const total: number = body ? body.length : request.bytes || 0;

  return new Promise<SentRequest>((resolve: (sent: SentRequest) => void) => {
    const answer: BodyAnswer = {
      status: null,
      connection: null,
      text: "",
      json: null,
      clientError: null,
    };
    let isDone: boolean = false;

    const finish: () => void = (): void => {
      if (isDone) {
        return;
      }

      isDone = true;
      agent.destroy();
      resolve({ tag: tag, answer: answer });
    };

    const headers: Record<string, string> = {
      ...request.headers,
      [TAG_HEADER]: tag,
    };

    if (!request.chunked) {
      headers["content-length"] = String(total);
    }

    const outgoing: http.ClientRequest = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        path: request.path,
        method: request.method || "POST",
        agent: agent,
        headers: headers,
      },
      (response: http.IncomingMessage) => {
        const chunks: Array<Buffer> = [];

        answer.status = response.statusCode || 0;
        answer.connection = response.headers["connection"] || null;

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          answer.text = Buffer.concat(
            chunks as unknown as Array<Uint8Array>,
          ).toString("utf8");
          answer.json = readAnswerJson(answer.text);
          finish();
        });
      },
    );

    outgoing.on("error", (err: NodeJS.ErrnoException) => {
      answer.clientError = err.code || err.message;

      // The answer may still be on its way: it is what is checked.
      timers.setTimeout(finish, 1000);
    });

    const piece: Buffer = Buffer.alloc(64 * KIB, request.fill ?? 0x20);
    let offset: number = 0;

    const write: () => void = (): void => {
      while (offset < total && !isDone && answer.clientError === null) {
        const next: Buffer = body
          ? body.subarray(offset, offset + piece.length)
          : piece.subarray(0, Math.min(piece.length, total - offset));

        offset += next.length;

        if (!outgoing.write(next)) {
          outgoing.once("drain", write);
          return;
        }
      }

      if (offset >= total) {
        outgoing.end();
      }
    };

    write();
  });
};

/*
 * Sends `bytes` of `fill` with fetch, as a stream, in a Node process of its
 * own: chunked, or with the Content-Length its headers give.
 */
export const sendWithFetch: (
  server: BodyServer,
  request: {
    path: string;
    headers: Record<string, string>;
    bytes: number;
    fill?: number | undefined;
  },
) => Promise<SentRequest> = (
  server: BodyServer,
  request: {
    path: string;
    headers: Record<string, string>;
    bytes: number;
    fill?: number | undefined;
  },
): Promise<SentRequest> => {
  const tag: string = nextTag();
  const script: string = `
    const [url, headersJson, bytesText, fillText] = process.argv.slice(1);
    const total = Number(bytesText);
    const piece = new Uint8Array(64 * 1024).fill(Number(fillText));
    let offset = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (offset >= total) { controller.close(); return; }
        const size = Math.min(piece.length, total - offset);
        offset += size;
        controller.enqueue(piece.subarray(0, size));
      },
    });
    fetch(url, { method: "POST", headers: JSON.parse(headersJson), body, duplex: "half" })
      .then(async (res) => {
        const text = await res.text();
        process.stdout.write(JSON.stringify({ status: res.status, connection: res.headers.get("connection"), text }));
      })
      .catch((err) => {
        process.stdout.write(JSON.stringify({ error: String((err.cause && (err.cause.code || err.cause.message)) || err.message) }));
      });
  `;

  return new Promise<SentRequest>((resolve: (sent: SentRequest) => void) => {
    execFile(
      process.execPath,
      [
        "-e",
        script,
        `http://127.0.0.1:${server.port}${request.path}`,
        JSON.stringify({ ...request.headers, [TAG_HEADER]: tag }),
        String(request.bytes),
        String(request.fill ?? 0x20),
      ],
      { timeout: 60000 },
      (_error: Error | null, stdout: string) => {
        const seen: {
          status?: number;
          connection?: string | null;
          text?: string;
          error?: string;
        } = JSON.parse(stdout || "{}");

        resolve({
          tag: tag,
          answer: {
            status: seen.status ?? null,
            connection: seen.connection ?? null,
            text: seen.text || "",
            json: readAnswerJson(seen.text || ""),
            clientError: seen.error ?? null,
          },
        });
      },
    );
  });
};

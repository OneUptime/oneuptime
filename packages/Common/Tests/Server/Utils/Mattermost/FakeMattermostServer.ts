import http from "http";
import https from "https";
import net from "net";

/*
 * A Mattermost server as its incoming webhooks look from outside, on
 * 127.0.0.1: it takes a POST, keeps what it was sent, and answers the way
 * Mattermost does - "ok" as text/plain, or an AppError as JSON - unless a
 * test asks it to answer otherwise: a redirect, a proxy's HTML page, nothing
 * at all, or a dropped connection.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface ReceivedRequest {
  method: string;
  // The request target as it arrived: a path, or a whole URL at a proxy.
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface FakeMattermostAnswer {
  status: number;
  body?: string | undefined;
  headers?: Record<string, string> | undefined;
  // Wait this long before answering. Infinity never answers.
  delayInMs?: number | undefined;
  // Close the connection instead of answering.
  hangUp?: boolean | undefined;
}

export interface FakeMattermostServerOptions {
  // How to answer each request. Mattermost's own "ok" when not given.
  answer?: ((request: ReceivedRequest) => FakeMattermostAnswer) | undefined;
  // Serve over TLS with this certificate.
  tls?: { key: string; cert: string } | undefined;
}

export interface FakeMattermostServer {
  port: number;
  requests: Array<ReceivedRequest>;
  close: () => Promise<void>;
}

// What Mattermost answers to a webhook it took.
export const MATTERMOST_OK: FakeMattermostAnswer = {
  status: 200,
  body: "ok",
  headers: { "Content-Type": "text/plain" },
};

// An error as Mattermost's API writes every one (model.AppError).
export const mattermostAppError: (
  status: number,
  id: string,
  message: string,
) => FakeMattermostAnswer = (
  status: number,
  id: string,
  message: string,
): FakeMattermostAnswer => {
  return {
    status: status,
    body: JSON.stringify({
      id: id,
      message: message,
      detailed_error: "",
      request_id: "x6p4gmyd5tn3ixe1w9ygkkfdia",
      status_code: status,
    }),
    headers: { "Content-Type": "application/json" },
  };
};

export const startFakeMattermostServer: (
  options?: FakeMattermostServerOptions,
) => Promise<FakeMattermostServer> = async (
  options: FakeMattermostServerOptions = {},
): Promise<FakeMattermostServer> => {
  const requests: Array<ReceivedRequest> = [];
  const sockets: Set<net.Socket> = new Set<net.Socket>();
  const timers: Set<NodeJS.Timeout> = new Set<NodeJS.Timeout>();

  const onRequest: http.RequestListener = (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    const chunks: Array<Buffer> = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      const received: ReceivedRequest = {
        method: request.method || "",
        url: request.url || "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };

      requests.push(received);

      const answer: FakeMattermostAnswer = options.answer
        ? options.answer(received)
        : MATTERMOST_OK;

      const send: () => void = (): void => {
        if (answer.hangUp) {
          request.socket.destroy();
          return;
        }

        response.writeHead(answer.status, answer.headers || {});
        response.end(answer.body || "");
      };

      if (answer.delayInMs === Infinity) {
        return;
      }

      if (answer.delayInMs) {
        const timer: NodeJS.Timeout = setTimeout(() => {
          timers.delete(timer);
          send();
        }, answer.delayInMs);
        timers.add(timer);
        return;
      }

      send();
    });
  };

  const server: http.Server | https.Server = options.tls
    ? https.createServer(
        { key: options.tls.key, cert: options.tls.cert },
        onRequest,
      )
    : http.createServer(onRequest);

  const connectionEvent: string = options.tls
    ? "secureConnection"
    : "connection";

  server.on(connectionEvent, (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  // A TLS handshake the client gives up on is not this server's error.
  server.on("tlsClientError", () => {
    return undefined;
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (server.address() as net.AddressInfo).port;

  return {
    port: port,
    requests: requests,
    close: async (): Promise<void> => {
      for (const timer of timers) {
        clearTimeout(timer);
      }

      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
};

/*
 * A port on 127.0.0.1 that nothing listens on: one the system just handed
 * out, and that its server gave back.
 */
export const getClosedPort: () => Promise<number> =
  async (): Promise<number> => {
    const server: net.Server = net.createServer();

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const port: number = (server.address() as net.AddressInfo).port;

    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });

    return port;
  };

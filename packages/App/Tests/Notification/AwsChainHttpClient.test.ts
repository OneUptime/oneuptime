import {
  AwsChainHttpError,
  AwsChainHttpResponse,
  MAX_ANSWER_LENGTH,
  defaultAwsChainHttpClient,
} from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

/*
 * THE HTTP CLIENT THE SERVER'S AWS CREDENTIALS ARE ASKED FOR WITH (#7000):
 * STS, the ECS and EKS Pod Identity agents and the EC2 metadata service are
 * each asked through it (Common/Server/Utils/Aws/AwsDefaultCredentialChain,
 * whose own tests drive every source through this seam). Driven here with
 * Node's real fetch - Common's jest runs in jsdom, which has none - against a
 * local server: any answer comes back as it is, a long or endless one is cut
 * at 64 KB without waiting for its end, no answer in time is a timeout, a
 * redirect is never followed (the next host would get the request's token),
 * and a refused connection says so by its code.
 */

describe("the HTTP client each source is asked with", () => {
  let server: http.Server;
  let origin: string;

  // Every request the server got: its path and its Authorization header.
  const asked: Array<{ path: string; authorization: string | null }> = [];

  beforeAll(async () => {
    server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        asked.push({
          path: request.url || "",
          authorization: request.headers["authorization"] || null,
        });

        if (request.url === "/slow") {
          // Never answers in time.
          const late: ReturnType<typeof setTimeout> = setTimeout(() => {
            response.end("late");
          }, 2000);

          response.on("close", () => {
            clearTimeout(late);
          });
          return;
        }

        if (request.url === "/endless") {
          // An answer that never ends: it is cut, not waited for.
          response.writeHead(200, { "Content-Type": "text/plain" });

          const writer: ReturnType<typeof setInterval> = setInterval(() => {
            response.write("y".repeat(16 * 1024));
          }, 5);

          response.on("close", () => {
            clearInterval(writer);
          });
          return;
        }

        if (request.url === "/redirect") {
          // Sends the client on to a page that would answer.
          response.writeHead(302, { Location: `${origin}/elsewhere` });
          response.end();
          return;
        }

        if (request.url === "/huge") {
          response.writeHead(200, { "Content-Type": "text/plain" });
          response.end("x".repeat(MAX_ANSWER_LENGTH + 100));
          return;
        }

        const chunks: Array<Buffer> = [];

        request.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        request.on("end", () => {
          response.writeHead(418, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              method: request.method,
              token: request.headers["x-aws-ec2-metadata-token"] || null,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        });
      },
    );

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  test("any answer comes back as it is, its status and its text", async () => {
    const answer: AwsChainHttpResponse = await defaultAwsChainHttpClient({
      method: "PUT",
      url: `${origin}/echo`,
      headers: { "X-aws-ec2-metadata-token": "abc" },
      body: "payload",
      timeoutMs: 2000,
    });

    expect(answer.status).toBe(418);
    expect(JSON.parse(answer.bodyText)).toEqual({
      method: "PUT",
      token: "abc",
      body: "payload",
    });
  });

  test("an answer longer than 64 KB is cut there", async () => {
    const answer: AwsChainHttpResponse = await defaultAwsChainHttpClient({
      method: "GET",
      url: `${origin}/huge`,
      headers: {},
      timeoutMs: 2000,
    });

    expect(answer.bodyText).toHaveLength(MAX_ANSWER_LENGTH);
  });

  test("an answer that never ends is cut at 64 KB, not waited for", async () => {
    const answer: AwsChainHttpResponse = await defaultAwsChainHttpClient({
      method: "GET",
      url: `${origin}/endless`,
      headers: {},
      timeoutMs: 3000,
    });

    expect(answer.status).toBe(200);
    expect(answer.bodyText).toHaveLength(MAX_ANSWER_LENGTH);
    expect(answer.bodyText).toBe("y".repeat(MAX_ANSWER_LENGTH));
  });

  test("no answer in the time given is a timeout", async () => {
    const failure: unknown = await defaultAwsChainHttpClient({
      method: "GET",
      url: `${origin}/slow`,
      headers: {},
      timeoutMs: 100,
    }).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(AwsChainHttpError);
    expect((failure as AwsChainHttpError).isTimeout).toBe(true);
    expect((failure as AwsChainHttpError).message).toBe(
      "timed out after 100 milliseconds",
    );
  });

  test("a redirect is never followed: the next host would get the request's token", async () => {
    const failure: unknown = await defaultAwsChainHttpClient({
      method: "GET",
      url: `${origin}/redirect`,
      headers: { Authorization: "secret-token" },
      timeoutMs: 2000,
    }).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(AwsChainHttpError);
    expect((failure as AwsChainHttpError).isTimeout).toBe(false);

    // The page it was sent on to was never asked, so never got the token.
    expect(
      asked.map((request: { path: string }) => {
        return request.path;
      }),
    ).not.toContain("/elsewhere");
    expect(asked).toContainEqual({
      path: "/redirect",
      authorization: "secret-token",
    });
  });

  test("a refused connection says why, by its code", async () => {
    const closed: http.Server = http.createServer();

    await new Promise<void>((resolve: () => void) => {
      closed.listen(0, "127.0.0.1", resolve);
    });

    const port: number = (closed.address() as AddressInfo).port;

    await new Promise<void>((resolve: () => void) => {
      closed.close(() => {
        resolve();
      });
    });

    const failure: unknown = await defaultAwsChainHttpClient({
      method: "GET",
      url: `http://127.0.0.1:${port}/`,
      headers: {},
      timeoutMs: 2000,
    }).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(AwsChainHttpError);
    expect((failure as AwsChainHttpError).isTimeout).toBe(false);
    expect((failure as AwsChainHttpError).message).toBe("ECONNREFUSED");
  });
});

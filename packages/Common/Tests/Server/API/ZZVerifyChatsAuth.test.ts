import { beforeAll, describe, expect, test } from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

jest.mock("../../../Server/Services/WorkspaceProjectAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      getProjectAuth: jest.fn(async () => {
        return {
          miscData: {
            availableChats: {
              "19:chat-abc": {
                id: "19:chat-abc",
                name: "Jane Doe",
                chatType: "personal",
                addedAt: "2026-07-01T00:00:00.000Z",
              },
              "19:chat-def": {
                id: "19:chat-def",
                name: "Alice, Bob + 2 more",
                chatType: "group",
                addedAt: "2026-07-02T00:00:00.000Z",
              },
            },
          },
        };
      }),
    },
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      updateLastActive: jest.fn(async () => {
        return undefined;
      }),
      getCurrentPlan: jest.fn(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      }),
      getRequireSsoForLogin: jest.fn(async () => {
        return true;
      }),
    },
  };
});

interface HttpProbeResult {
  status: number;
  body: unknown;
}

/*
 * The jest test environment is jsdom, which does not expose a global fetch, so
 * this probe talks to the server with Node's http client. Everything runs
 * inside the caller's try/finally so the server is always closed - a leaked
 * listener keeps the event loop alive and hangs the whole `jest` run at exit.
 */
type HttpGetJsonFunction = (data: {
  port: number;
  path: string;
  headers: http.OutgoingHttpHeaders;
}) => Promise<HttpProbeResult>;

const httpGetJson: HttpGetJsonFunction = (data: {
  port: number;
  path: string;
  headers: http.OutgoingHttpHeaders;
}): Promise<HttpProbeResult> => {
  return new Promise<HttpProbeResult>(
    (
      resolve: (result: HttpProbeResult) => void,
      reject: (error: Error) => void,
    ) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: "GET",
          headers: data.headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");

            let parsed: unknown = null;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              parsed = raw;
            }

            resolve({
              status: response.statusCode || 0,
              body: parsed,
            });
          });
        },
      );

      request.on("error", (error: Error) => {
        return reject(error);
      });

      request.end();
    },
  );
};

describe("ANON ACCESS PROBE /microsoft-teams/chats", () => {
  let MicrosoftTeamsAPI: any = undefined;

  /*
   * Loading MicrosoftTeamsAPI pulls in a large module graph. Done inside the
   * test, that load counted against the probe's 30s budget and timed the test
   * out on a busy machine even though the route answered correctly. The load
   * gets its own, generous budget here so the test's timeout measures only the
   * HTTP round trip it is about.
   */
  beforeAll(async () => {
    MicrosoftTeamsAPI = (await import("../../../Server/API/MicrosoftTeamsAPI"))
      .default;
  }, 600000);

  test("unauthenticated GET with only a tenantid header", async () => {
    const app: express.Express = express();
    app.use("/api", new MicrosoftTeamsAPI().getRouter());

    const server: http.Server = http.createServer(app);
    await new Promise<void>((resolve: () => void) => {
      server.listen(0, resolve);
    });

    try {
      const port: number = (server.address() as AddressInfo).port;

      const result: HttpProbeResult = await httpGetJson({
        port,
        path: "/api/microsoft-teams/chats",
        headers: {
          tenantid: "6f4e4b2c-1111-4c2a-9e3d-abcdefabcdef",
        },
      });

      /*
       * The hardening in this branch requires an authenticated project member:
       * getUserMiddleware admits unauthenticated requests as Public, so the
       * route must reject one carrying only a tenantid header. A 200 here would
       * mean the captured chat list leaks to anonymous callers - the exact
       * regression this probe guards against.
       *
       * Pinned to exactly 401 (it used to accept any 4xx, and was a 422). A
       * request with only a tenantid header is what a signed-in user's browser
       * sends once the access-token cookie has expired, and the dashboard
       * refreshes the session and resends on a 401 and on nothing else.
       */
      expect(result.status).toBe(401);
      expect((result.body as { message?: string }).message).toBe(
        "Authentication required. Please log in to access this resource.",
      );

      const serializedBody: string = JSON.stringify(result.body);
      expect(serializedBody).not.toContain("Jane Doe");
      expect(serializedBody).not.toContain("19:chat-abc");
      expect(serializedBody).not.toContain("19:chat-def");
    } finally {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          return resolve();
        });
      });
    }
  }, 30000);
});

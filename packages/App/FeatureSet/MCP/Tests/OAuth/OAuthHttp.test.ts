/**
 * OAuth HTTP plumbing tests.
 *
 * The handful of rules every back-channel endpoint follows: nothing is
 * cacheable, parameters are read once and never from a repeated value, and a
 * failure is always an OAuth error document - the one that was thrown, or
 * `server_error` with the cause kept out of the response.
 *
 * Most of it runs through a real Express app over HTTP, because what matters
 * is what ends up on the wire.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  jest,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import McpOAuthError, { McpOAuthErrorCode } from "../../OAuth/McpOAuthError";
import OAuthHttp, {
  OAuthHandler,
  OAuthParameters,
} from "../../OAuth/OAuthHttp";
import {
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressUrlEncoded,
  createExpressApp,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";

const UNEXPECTED_ERROR_DESCRIPTION: string =
  "The authorization server encountered an unexpected error.";

const SECRET_CAUSE: string =
  "connect ECONNREFUSED 10.0.0.5:5432 password=hunter2";

function fakeRequest(data: {
  method: string;
  query?: unknown;
  body?: unknown;
}): ExpressRequest {
  return data as unknown as ExpressRequest;
}

interface WireResponse {
  status: number;
  headers: Headers;
  text: string;
  json: any;
}

async function readResponse(response: Response): Promise<WireResponse> {
  const text: string = await response.text();
  let json: any = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: response.status, headers: response.headers, text, json };
}

describe("OAuthHttp", () => {
  describe("getParameters", () => {
    it("reads the query of a GET", () => {
      expect(
        OAuthHttp.getParameters(
          fakeRequest({
            method: "GET",
            query: { client_id: "abc", state: "xyz" },
            body: { client_id: "from-body" },
          }),
        ),
      ).toEqual({ client_id: "abc", state: "xyz" });
    });

    it("reads the body of a POST, never its query", () => {
      expect(
        OAuthHttp.getParameters(
          fakeRequest({
            method: "POST",
            query: { grant_type: "from-query", code: "from-query" },
            body: { grant_type: "authorization_code" },
          }),
        ),
      ).toEqual({ grant_type: "authorization_code" });
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a string", "grant_type=authorization_code"],
      ["a number", 7],
      ["a boolean", true],
      ["an array", [{ grant_type: "authorization_code" }]],
    ])(
      "reads a POST body that is %s as no parameters at all",
      (_name: string, body: unknown) => {
        expect(
          OAuthHttp.getParameters(fakeRequest({ method: "POST", body })),
        ).toEqual({});
      },
    );

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["an array", ["client_id"]],
      ["a string", "client_id=abc"],
    ])(
      "reads a GET query that is %s as no parameters at all",
      (_name: string, query: unknown) => {
        expect(
          OAuthHttp.getParameters(fakeRequest({ method: "GET", query })),
        ).toEqual({});
      },
    );
  });

  describe("getString", () => {
    const parameters: OAuthParameters = {
      code: "abc",
      empty: "",
      repeated: ["first", "second"],
      number: 5,
      flag: true,
      object: { nested: "value" },
      nothing: null,
    };

    it("returns a parameter that appears once", () => {
      expect(OAuthHttp.getString(parameters, "code")).toBe("abc");
    });

    it("keeps the value exactly as it was sent", () => {
      expect(OAuthHttp.getString({ state: "  padded  " }, "state")).toBe(
        "  padded  ",
      );
    });

    it("treats a repeated parameter as absent, so there is never a question of which was used", () => {
      expect(OAuthHttp.getString(parameters, "repeated")).toBeUndefined();
    });

    it.each(["empty", "number", "flag", "object", "nothing", "missing"])(
      "is undefined for the %s parameter",
      (name: string) => {
        expect(OAuthHttp.getString(parameters, name)).toBeUndefined();
      },
    );
  });

  describe("over HTTP", () => {
    let server: http.Server;
    let baseUrl: string = "";
    let handler: OAuthHandler = async (): Promise<void> => {};

    beforeAll(async () => {
      const app: ReturnType<typeof createExpressApp> = createExpressApp();

      app.get("/no-store", (_req: ExpressRequest, res: ExpressResponse) => {
        OAuthHttp.setNoStore(res);
        res.status(200).send("ok");
      });

      app.get("/cors", (_req: ExpressRequest, res: ExpressResponse) => {
        OAuthHttp.setCorsHeaders(res);
        res.status(200).send("ok");
      });

      app.get("/json", (_req: ExpressRequest, res: ExpressResponse) => {
        OAuthHttp.sendJson(res, 201, { client_id: "abc", nested: [1, 2] });
      });

      app.post(
        "/parameters",
        ExpressUrlEncoded({ extended: false }),
        ExpressJson(),
        (req: ExpressRequest, res: ExpressResponse) => {
          const parameters: OAuthParameters = OAuthHttp.getParameters(req);

          res.status(200).json({
            parameters,
            code: OAuthHttp.getString(parameters, "code") ?? null,
          });
        },
      );

      app.get("/parameters", (req: ExpressRequest, res: ExpressResponse) => {
        const parameters: OAuthParameters = OAuthHttp.getParameters(req);

        res.status(200).json({
          parameters,
          code: OAuthHttp.getString(parameters, "code") ?? null,
        });
      });

      // The handler under test is swapped in per test.
      app.all(
        "/handled",
        OAuthHttp.handle(
          "test endpoint",
          async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
            await handler(req, res);
          },
        ),
      );

      await new Promise<void>((resolve: () => void) => {
        server = http.createServer(app);
        server.listen(0, "127.0.0.1", () => {
          baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    });

    beforeEach(() => {
      (logger.error as unknown as jest.Mock).mockClear();
      handler = async (): Promise<void> => {};
    });

    it("setNoStore forbids storing the response", async () => {
      const response: WireResponse = await readResponse(
        await fetch(`${baseUrl}/no-store`),
      );

      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
    });

    it("setCorsHeaders opens the endpoint to any origin, without credentials", async () => {
      const response: WireResponse = await readResponse(
        await fetch(`${baseUrl}/cors`, {
          headers: { Origin: "https://app.example" },
        }),
      );

      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-methods")).toBe(
        "GET, POST, OPTIONS",
      );
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Content-Type, Accept, Authorization, mcp-protocol-version",
      );
      // "*" with credentials is what would make an open endpoint dangerous.
      expect(
        response.headers.get("access-control-allow-credentials"),
      ).toBeNull();
    });

    it("sendJson sends the status and the body, uncacheable", async () => {
      const response: WireResponse = await readResponse(
        await fetch(`${baseUrl}/json`),
      );

      expect(response.status).toBe(201);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.json).toEqual({ client_id: "abc", nested: [1, 2] });
    });

    it("reads a form body the way a token request arrives", async () => {
      const response: WireResponse = await readResponse(
        await fetch(`${baseUrl}/parameters?code=from-query`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=authorization_code&code=abc%20def&state=a%2Bb",
        }),
      );

      expect(response.json.parameters).toEqual({
        grant_type: "authorization_code",
        code: "abc def",
        state: "a+b",
      });
      expect(response.json.code).toBe("abc def");
    });

    it("treats a parameter repeated in a form body as absent", async () => {
      const response: WireResponse = await readResponse(
        await fetch(`${baseUrl}/parameters`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "code=first&code=second",
        }),
      );

      expect(response.json.parameters.code).toEqual(["first", "second"]);
      expect(response.json.code).toBeNull();
    });

    it("treats a parameter repeated in a query as absent", async () => {
      const response: WireResponse = await readResponse(
        await fetch(`${baseUrl}/parameters?code=first&code=second&state=s`),
      );

      expect(response.json.parameters.state).toBe("s");
      expect(response.json.code).toBeNull();
    });

    it("reads a JSON array body as no parameters", async () => {
      const response: WireResponse = await readResponse(
        await fetch(`${baseUrl}/parameters`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ code: "abc" }]),
        }),
      );

      expect(response.json.parameters).toEqual({});
      expect(response.json.code).toBeNull();
    });

    describe("sendError", () => {
      it("answers with the error's status and body, uncacheable", async () => {
        handler = async (
          _req: ExpressRequest,
          res: ExpressResponse,
        ): Promise<void> => {
          OAuthHttp.sendError(
            res,
            new McpOAuthError(
              McpOAuthErrorCode.InvalidGrant,
              "The authorization code is invalid, expired or has already been used.",
            ),
          );
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(response.status).toBe(400);
        expect(response.json).toEqual({
          error: "invalid_grant",
          error_description:
            "The authorization code is invalid, expired or has already been used.",
        });
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("pragma")).toBe("no-cache");
        expect(response.headers.get("www-authenticate")).toBeNull();
      });

      it("sends WWW-Authenticate when the error carries a challenge", async () => {
        handler = async (
          _req: ExpressRequest,
          res: ExpressResponse,
        ): Promise<void> => {
          OAuthHttp.sendError(
            res,
            new McpOAuthError(
              McpOAuthErrorCode.InvalidClient,
              "Client authentication failed.",
              { challenge: 'Basic realm="OneUptime MCP", charset="UTF-8"' },
            ),
          );
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toBe(
          'Basic realm="OneUptime MCP", charset="UTF-8"',
        );
        expect(response.json).toEqual({
          error: "invalid_client",
          error_description: "Client authentication failed.",
        });
      });

      it("sends no WWW-Authenticate for a 401 that carries no challenge", async () => {
        handler = async (
          _req: ExpressRequest,
          res: ExpressResponse,
        ): Promise<void> => {
          OAuthHttp.sendError(
            res,
            new McpOAuthError(
              McpOAuthErrorCode.InvalidClient,
              "client_id is required.",
            ),
          );
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toBeNull();
      });

      it.each([
        [McpOAuthErrorCode.ServerError, 500],
        [McpOAuthErrorCode.TemporarilyUnavailable, 503],
        [McpOAuthErrorCode.TooManyRequests, 429],
        [McpOAuthErrorCode.InvalidClientMetadata, 400],
      ])(
        "answers %s with %i",
        async (code: McpOAuthErrorCode, statusCode: number) => {
          handler = async (
            _req: ExpressRequest,
            res: ExpressResponse,
          ): Promise<void> => {
            OAuthHttp.sendError(res, new McpOAuthError(code, "A description."));
          };

          const response: WireResponse = await readResponse(
            await fetch(`${baseUrl}/handled`, { method: "POST" }),
          );

          expect(response.status).toBe(statusCode);
          expect(response.json.error).toBe(code);
        },
      );
    });

    describe("handle", () => {
      it("leaves a handler that answers alone", async () => {
        handler = async (
          _req: ExpressRequest,
          res: ExpressResponse,
        ): Promise<void> => {
          OAuthHttp.sendJson(res, 200, { access_token: "x" });
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(response.status).toBe(200);
        expect(response.json).toEqual({ access_token: "x" });
        expect(logger.error).not.toHaveBeenCalled();
      });

      it("turns a thrown OAuth error into its error document", async () => {
        handler = async (): Promise<void> => {
          throw new McpOAuthError(
            McpOAuthErrorCode.UnsupportedGrantType,
            'grant_type must be "authorization_code" or "refresh_token".',
          );
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(response.status).toBe(400);
        expect(response.json).toEqual({
          error: "unsupported_grant_type",
          error_description:
            'grant_type must be "authorization_code" or "refresh_token".',
        });
        expect(response.headers.get("cache-control")).toBe("no-store");
        // An expected refusal is not an error worth a log line.
        expect(logger.error).not.toHaveBeenCalled();
      });

      it("passes a thrown error's challenge on as a header", async () => {
        handler = async (): Promise<void> => {
          throw new McpOAuthError(
            McpOAuthErrorCode.InvalidClient,
            "Client authentication failed.",
            { challenge: 'Basic realm="OneUptime MCP", charset="UTF-8"' },
          );
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toBe(
          'Basic realm="OneUptime MCP", charset="UTF-8"',
        );
      });

      it("answers server_error for anything unexpected, with none of the cause", async () => {
        handler = async (): Promise<void> => {
          throw new Error(SECRET_CAUSE);
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(response.status).toBe(500);
        expect(response.json).toEqual({
          error: "server_error",
          error_description: UNEXPECTED_ERROR_DESCRIPTION,
        });
        expect(response.text).not.toContain("ECONNREFUSED");
        expect(response.text).not.toContain("10.0.0.5");
        expect(response.text).not.toContain("hunter2");
        expect(response.text).not.toContain("at ");
        expect(response.headers.get("cache-control")).toBe("no-store");
      });

      it("puts the cause of an unexpected failure in the log instead", async () => {
        const cause: Error = new Error(SECRET_CAUSE);

        handler = async (): Promise<void> => {
          throw cause;
        };

        await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(logger.error).toHaveBeenCalledWith(
          "MCP OAuth: test endpoint failed.",
        );
        expect(logger.error).toHaveBeenCalledWith(cause);
      });

      it.each([
        ["a string", "just a string"],
        ["null", null],
        ["undefined", undefined],
        [
          "an object that only looks like an OAuth error",
          { code: "invalid_grant", description: "fake" },
        ],
      ])(
        "answers server_error when what was thrown is %s",
        async (_name: string, thrown: unknown) => {
          handler = async (): Promise<void> => {
            throw thrown;
          };

          const response: WireResponse = await readResponse(
            await fetch(`${baseUrl}/handled`, { method: "POST" }),
          );

          expect(response.status).toBe(500);
          expect(response.json).toEqual({
            error: "server_error",
            error_description: UNEXPECTED_ERROR_DESCRIPTION,
          });
        },
      );

      it("answers server_error for a handler that throws before its first await", async () => {
        handler = (): Promise<void> => {
          throw new Error(SECRET_CAUSE);
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(response.status).toBe(500);
        expect(response.json.error).toBe("server_error");
      });

      it("writes nothing more when the handler fails after it has answered", async () => {
        handler = async (
          _req: ExpressRequest,
          res: ExpressResponse,
        ): Promise<void> => {
          OAuthHttp.sendJson(res, 200, { access_token: "already-sent" });
          throw new Error(SECRET_CAUSE);
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        // The first answer stands; the failure only reaches the log.
        expect(response.status).toBe(200);
        expect(response.json).toEqual({ access_token: "already-sent" });
        expect(logger.error).toHaveBeenCalledWith(
          "MCP OAuth: test endpoint failed after responding.",
        );
      });

      it("writes nothing more when an OAuth error is thrown after the answer", async () => {
        handler = async (
          _req: ExpressRequest,
          res: ExpressResponse,
        ): Promise<void> => {
          OAuthHttp.sendJson(res, 200, { ok: true });
          throw new McpOAuthError(McpOAuthErrorCode.InvalidGrant, "too late");
        };

        const response: WireResponse = await readResponse(
          await fetch(`${baseUrl}/handled`, { method: "POST" }),
        );

        expect(response.status).toBe(200);
        expect(response.json).toEqual({ ok: true });
      });
    });
  });

  describe("handle, in isolation", () => {
    it("never rejects, whatever the handler does", async () => {
      const sent: Array<unknown> = [];
      const res: ExpressResponse = {
        headersSent: false,
        setHeader: (): void => {},
        status: (): unknown => {
          return {
            json: (body: unknown): void => {
              sent.push(body);
            },
          };
        },
      } as unknown as ExpressResponse;

      const wrapped: OAuthHandler = OAuthHttp.handle(
        "isolated",
        async (): Promise<void> => {
          throw new Error("boom");
        },
      );

      await expect(
        wrapped(fakeRequest({ method: "POST" }), res),
      ).resolves.toBeUndefined();
      expect(sent).toEqual([
        {
          error: "server_error",
          error_description: UNEXPECTED_ERROR_DESCRIPTION,
        },
      ]);
    });
  });
});

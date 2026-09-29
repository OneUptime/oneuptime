import OAuth2TokenClient, {
  OAUTH2_TOKEN_RESPONSE_MAX_BYTES,
  OAuth2TokenRequestConfig,
  OAuth2TokenResult,
} from "../../../../Server/Utils/Workflow/OAuth2TokenClient";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "../../../../Server/Utils/DataSource/EgressGuard";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
} from "../../../../Types/Workflow/WorkflowVariableOAuth";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The token client over real sockets, against a loopback identity provider
 * that implements the two grants the way RFC 6749 describes them - including
 * refresh token rotation, where the refresh token that was just used stops
 * working.
 *
 * The production transport runs unchanged: axios, the form encoding, the
 * status handling, the redirect refusal and the response-size cap. Only the
 * egress guard's address check is replaced, because it refuses loopback in
 * every configuration - which is the point of it, and is itself tested at the
 * bottom of this file. The replacement still pins the connection the way the
 * real guard does: the token URL uses the made-up host idp.test, and the
 * pinned lookup is the only thing that can turn that into 127.0.0.1.
 */

/*
 * Common's suites run under jsdom, where jest resolves axios to its browser
 * build - whose `http` adapter is a placeholder. The token client names the
 * Node adapter explicitly (production runs in Node), so give it the Node build,
 * the way VMRunnerSsrf.test.ts does.
 */
jest.mock("axios", () => {
  return jest.requireActual("axios/dist/node/axios.cjs");
});

const CLIENT_ID: string = "workflow-client";
const CLIENT_SECRET: string = "c1ient+secret/with=reserved chars~";

interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  form: Record<string, string>;
}

interface IdentityProvider {
  requests: Array<RecordedRequest>;
  currentRefreshToken: string;
  issued: number;
  port: number;
}

const idp: IdentityProvider = {
  requests: [],
  currentRefreshToken: "refresh-0",
  issued: 0,
  port: 0,
};

let server: Server;

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/*
 * Client authentication the way RFC 6749 section 2.3.1 has it: Basic with the
 * form-encoded id and secret, or client_id/client_secret in the body. Never
 * both.
 */
function authenticateClient(
  req: IncomingMessage,
  form: Record<string, string>,
): boolean {
  const authorization: string | undefined = req.headers["authorization"];

  if (authorization) {
    if (form["client_secret"]) {
      return false;
    }

    const decoded: string = Buffer.from(
      authorization.replace(/^Basic /, ""),
      "base64",
    ).toString("utf8");
    const separator: number = decoded.indexOf(":");
    const id: string = decodeURIComponent(decoded.substring(0, separator));
    const secret: string = decodeURIComponent(decoded.substring(separator + 1));

    return id === CLIENT_ID && secret === CLIENT_SECRET;
  }

  return (
    form["client_id"] === CLIENT_ID && form["client_secret"] === CLIENT_SECRET
  );
}

function handleToken(
  req: IncomingMessage,
  res: ServerResponse,
  form: Record<string, string>,
): void {
  if (req.headers["content-type"] !== "application/x-www-form-urlencoded") {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }

  if (form["grant_type"] === "client_credentials") {
    if (!authenticateClient(req, form)) {
      sendJson(res, 401, {
        error: "invalid_client",
        error_description: "Client authentication failed.",
      });
      return;
    }

    idp.issued++;
    sendJson(res, 200, {
      access_token: `cc-access-${idp.issued}`,
      token_type: "Bearer",
      expires_in: 3600,
      scope: form["scope"] || "default",
    });
    return;
  }

  if (form["grant_type"] === "refresh_token") {
    // A public client is allowed: client_id only, no secret anywhere.
    const isPublicClient: boolean =
      !req.headers["authorization"] &&
      !form["client_secret"] &&
      form["client_id"] === CLIENT_ID;

    if (!isPublicClient && !authenticateClient(req, form)) {
      sendJson(res, 401, { error: "invalid_client" });
      return;
    }

    if (form["refresh_token"] !== idp.currentRefreshToken) {
      sendJson(res, 400, {
        error: "invalid_grant",
        error_description: "Refresh token is invalid or was already used.",
      });
      return;
    }

    idp.issued++;
    // Rotation: the token just used stops working.
    idp.currentRefreshToken = `refresh-${idp.issued}`;

    sendJson(res, 200, {
      access_token: `rt-access-${idp.issued}`,
      token_type: "Bearer",
      expires_in: "1800",
      refresh_token: idp.currentRefreshToken,
    });
    return;
  }

  sendJson(res, 400, { error: "unsupported_grant_type" });
}

beforeAll(async () => {
  server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw: string = "";

    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });

    req.on("end", () => {
      const form: Record<string, string> = {};

      for (const [key, value] of new URLSearchParams(raw).entries()) {
        form[key] = value;
      }

      const path: string = (req.url || "").split("?")[0] || "";

      idp.requests.push({
        method: req.method || "",
        path,
        headers: req.headers,
        form,
      });

      if (path === "/token") {
        handleToken(req, res, form);
        return;
      }

      if (path === "/moved") {
        res.writeHead(302, { Location: "/token" });
        res.end();
        return;
      }

      if (path === "/huge") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: "x".repeat(OAUTH2_TOKEN_RESPONSE_MAX_BYTES + 10),
          }),
        );
        return;
      }

      if (path === "/slow") {
        setTimeout(() => {
          sendJson(res, 200, { access_token: "too-late" });
        }, 3000);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html><body><h1>Not Found</h1></body></html>");
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  idp.port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

function tokenUrl(path: string = "/token"): string {
  return `http://idp.test:${idp.port}${path}`;
}

function pinToLoopback(): void {
  jest
    .spyOn(DataSourceEgressGuard, "assertUrlAllowedAndPin")
    .mockImplementation(async (urlString: string) => {
      const addresses: Array<ResolvedAddress> = [
        { address: "127.0.0.1", family: 4 },
      ];

      return {
        url: new URL(urlString),
        addresses,
        ...DataSourceEgressGuard.createPinnedAgents(addresses),
      };
    });
}

describe("OAuth2TokenClient against a loopback identity provider", () => {
  beforeEach(() => {
    idp.requests = [];
    idp.currentRefreshToken = "refresh-0";
    idp.issued = 0;
    pinToLoopback();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function clientCredentials(
    overrides?: Partial<OAuth2TokenRequestConfig>,
  ): OAuth2TokenRequestConfig {
    return {
      grantType: OAuth2GrantType.ClientCredentials,
      tokenUrl: tokenUrl(),
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      ...overrides,
    };
  }

  test("client credentials with a Basic header, secret with reserved characters", async () => {
    const before: number = Date.now();

    const result: OAuth2TokenResult = await OAuth2TokenClient.requestToken(
      clientCredentials({
        scope: "api.read api.write",
        additionalParameters: { audience: "https://api.example.com" },
      }),
    );

    expect(result.accessToken).toBe("cc-access-1");
    expect(result.tokenType).toBe("Bearer");
    expect(result.scope).toBe("api.read api.write");
    expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(
      before + 3600 * 1000,
    );

    expect(idp.requests).toHaveLength(1);

    const request: RecordedRequest = idp.requests[0]!;

    expect(request.method).toBe("POST");
    expect(request.headers["accept"]).toBe("application/json");
    expect(request.headers["user-agent"]).toMatch(/^OneUptime/);
    expect(request.form).toEqual({
      grant_type: "client_credentials",
      scope: "api.read api.write",
      audience: "https://api.example.com",
    });
  });

  test("client credentials in the request body", async () => {
    const result: OAuth2TokenResult = await OAuth2TokenClient.requestToken(
      clientCredentials({
        clientAuthenticationMethod:
          OAuth2ClientAuthenticationMethod.RequestBody,
      }),
    );

    expect(result.accessToken).toBe("cc-access-1");
    expect(idp.requests[0]!.headers["authorization"]).toBeUndefined();
    expect(idp.requests[0]!.form["client_secret"]).toBe(CLIENT_SECRET);
  });

  test("a wrong secret comes back as the provider's invalid_client", async () => {
    await expect(
      OAuth2TokenClient.requestToken(
        clientCredentials({ clientSecret: "wrong" }),
      ),
    ).rejects.toThrow(
      "The token endpoint refused the request (HTTP 401): invalid_client - Client authentication failed.",
    );
  });

  /*
   * Rotation end to end: each exchange returns the next refresh token, and the
   * one just used is dead. A caller that kept the first refresh token would
   * fail on the second refresh - which is why the result carries the new one.
   */
  test("refresh token rotation: the new refresh token works, the used one does not", async () => {
    const first: OAuth2TokenResult = await OAuth2TokenClient.requestToken({
      grantType: OAuth2GrantType.RefreshToken,
      tokenUrl: tokenUrl(),
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      refreshToken: "refresh-0",
    });

    expect(first.accessToken).toBe("rt-access-1");
    expect(first.refreshToken).toBe("refresh-1");
    // expires_in arrived as the string "1800".
    expect(first.expiresAt).not.toBeNull();

    const second: OAuth2TokenResult = await OAuth2TokenClient.requestToken({
      grantType: OAuth2GrantType.RefreshToken,
      tokenUrl: tokenUrl(),
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      refreshToken: first.refreshToken!,
    });

    expect(second.accessToken).toBe("rt-access-2");

    await expect(
      OAuth2TokenClient.requestToken({
        grantType: OAuth2GrantType.RefreshToken,
        tokenUrl: tokenUrl(),
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: "refresh-0",
      }),
    ).rejects.toThrow("Update Credentials");
  });

  test("a public client refreshes with client_id alone", async () => {
    const result: OAuth2TokenResult = await OAuth2TokenClient.requestToken({
      grantType: OAuth2GrantType.RefreshToken,
      tokenUrl: tokenUrl(),
      clientId: CLIENT_ID,
      refreshToken: "refresh-0",
    });

    expect(result.accessToken).toBe("rt-access-1");
    expect(idp.requests[0]!.headers["authorization"]).toBeUndefined();
    expect(idp.requests[0]!.form).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-0",
      client_id: CLIENT_ID,
    });
  });

  /*
   * The pinned agents only cover the host that was validated. Following the
   * 302 would send the client secret somewhere nobody checked, so the redirect
   * is the answer and only one request is ever made.
   */
  test("does not follow a redirect", async () => {
    await expect(
      OAuth2TokenClient.requestToken(
        clientCredentials({ tokenUrl: tokenUrl("/moved") }),
      ),
    ).rejects.toThrow("redirect (HTTP 302) to /token");

    expect(idp.requests).toHaveLength(1);
    expect(idp.requests[0]!.path).toBe("/moved");
  });

  test("quotes a 404 page as text", async () => {
    await expect(
      OAuth2TokenClient.requestToken(
        clientCredentials({ tokenUrl: tokenUrl("/nope") }),
      ),
    ).rejects.toThrow("The token endpoint answered HTTP 404: Not Found.");
  });

  test("refuses a response larger than a token response can be", async () => {
    await expect(
      OAuth2TokenClient.requestToken(
        clientCredentials({ tokenUrl: tokenUrl("/huge") }),
      ),
    ).rejects.toThrow(
      "Could not reach the token endpoint: its response was larger than a token response can be.",
    );
  });

  test("gives up on an endpoint that does not answer in time", async () => {
    await expect(
      OAuth2TokenClient.requestToken(
        clientCredentials({ tokenUrl: tokenUrl("/slow") }),
        { timeoutInMs: 500 },
      ),
    ).rejects.toThrow(
      "Could not reach the token endpoint: it did not answer within 1 seconds.",
    );
  });
});

describe("OAuth2TokenClient's real egress guard", () => {
  beforeEach(() => {
    idp.requests = [];
  });

  /*
   * Without the stub above, a token URL on loopback - or the cloud metadata
   * address - is refused before a socket is opened, so the client secret never
   * leaves the process.
   */
  test.each([
    [
      "loopback",
      () => {
        return `http://127.0.0.1:${idp.port}/token`;
      },
    ],
    [
      "cloud metadata",
      () => {
        return "http://169.254.169.254/latest/meta-data/iam";
      },
    ],
  ])(
    "refuses a token URL on %s and sends nothing",
    async (_label: string, url: () => string) => {
      await expect(
        OAuth2TokenClient.requestToken({
          grantType: OAuth2GrantType.ClientCredentials,
          tokenUrl: url(),
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
        }),
      ).rejects.toThrow(
        /Could not reach the token endpoint: OAuth token URL host .* is not allowed/,
      );

      expect(idp.requests).toHaveLength(0);
    },
  );

  test("refuses a scheme that is not http or https", async () => {
    await expect(
      OAuth2TokenClient.requestToken({
        grantType: OAuth2GrantType.ClientCredentials,
        tokenUrl: "file:///etc/passwd",
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      }),
    ).rejects.toThrow("OAuth token URL URL must use http or https");
  });
});

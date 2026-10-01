/**
 * Dynamic client registration over HTTP (POST /mcp/oauth/register).
 *
 * The endpoint is open to anyone who can reach it, so these tests are mostly
 * about how little a registration is allowed to be worth: what is stored,
 * what is refused, and what happens when the write cannot be rate limited.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  /*
   * Only the logger itself is silenced. The module's other exports stay real:
   * the API's error responder calls one of them on every refusal.
   */
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
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

import OAuthTestHarness, {
  APP_404_MARKER,
  HttpResult,
} from "./Helpers/OAuthTestHarness";
import { StoreRow } from "./Helpers/InMemoryOAuthStore";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import ObjectID from "Common/Types/ObjectID";

const REGISTER_PATH: string = "/mcp/oauth/register";

describe("POST /mcp/oauth/register", () => {
  let harness: OAuthTestHarness;

  beforeAll(async () => {
    harness = await OAuthTestHarness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(() => {
    harness.reset();
  });

  function register(body: unknown): Promise<HttpResult> {
    return harness.request(REGISTER_PATH, { json: body });
  }

  describe("a public client", () => {
    it("is answered 201 with a client id and exactly what was registered", async () => {
      const before: number = Math.floor(Date.now() / 1000);

      const response: HttpResult = await register({
        client_name: "Claude Code",
        client_uri: "https://claude.ai/code",
        redirect_uris: [
          "http://localhost:8765/callback",
          "https://claude.ai/api/mcp/auth_callback",
        ],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });

      expect(response.status).toBe(201);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      expect(ObjectID.isValidUUID(response.json.client_id)).toBe(true);
      expect(response.json.client_id_issued_at).toBeGreaterThanOrEqual(before);
      expect(response.json.client_id_issued_at).toBeLessThanOrEqual(
        Math.floor(Date.now() / 1000) + 1,
      );

      expect(response.json.client_name).toBe("Claude Code");
      expect(response.json.client_uri).toBe("https://claude.ai/code");
      expect(response.json.redirect_uris).toEqual([
        "http://localhost:8765/callback",
        "https://claude.ai/api/mcp/auth_callback",
      ]);
      expect(response.json.token_endpoint_auth_method).toBe("none");
      expect(response.json.grant_types).toEqual([
        "authorization_code",
        "refresh_token",
      ]);
      expect(response.json.response_types).toEqual(["code"]);
    });

    it("is never issued a secret", async () => {
      const response: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });

      expect(response.status).toBe(201);
      expect("client_secret" in response.json).toBe(false);
      expect("client_secret_expires_at" in response.json).toBe(false);

      const row: StoreRow = harness.store.requireRow(
        "client",
        response.json.client_id,
      );

      expect(row["clientSecretHash"]).toBeUndefined();
      expect(row["tokenEndpointAuthMethod"]).toBe("none");
    });

    it("gets a generic name when it sends none", async () => {
      const response: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });

      expect(response.json.client_name).toBe("MCP Client");
      expect("client_uri" in response.json).toBe(false);
    });

    it("is told the one flow it was given, whatever it listed", async () => {
      const response: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "client_credentials", "implicit"],
        response_types: ["code", "token"],
      });

      expect(response.status).toBe(201);
      expect(response.json.grant_types).toEqual([
        "authorization_code",
        "refresh_token",
      ]);
      expect(response.json.response_types).toEqual(["code"]);
    });

    it("stores the name, the redirect URIs and when it was last seen - nothing else it sent", async () => {
      const response: HttpResult = await register({
        client_name: "Some Client",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
        logo_uri: "https://client.example/logo.png",
        contacts: ["someone@client.example"],
        software_id: "abc",
        jwks: { keys: [] },
        scope: "mcp:read mcp:write",
      });

      const row: StoreRow = harness.store.requireRow(
        "client",
        response.json.client_id,
      );

      expect(Object.keys(row).sort()).toEqual(
        [
          "_id",
          "clientName",
          "createdAt",
          "lastUsedAt",
          "redirectUris",
          "tokenEndpointAuthMethod",
          "updatedAt",
        ].sort(),
      );
      expect(row["clientName"]).toBe("Some Client");
      expect(row["redirectUris"]).toEqual(["https://client.example/callback"]);
      expect(row["lastUsedAt"]).toBeInstanceOf(Date);

      // And none of it is echoed back as though it had been accepted.
      expect("logo_uri" in response.json).toBe(false);
      expect("contacts" in response.json).toBe(false);
      expect("jwks" in response.json).toBe(false);
    });

    it("gives every registration its own client id", async () => {
      const body: Record<string, unknown> = {
        client_name: "Same Client",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      };

      const first: HttpResult = await register(body);
      const second: HttpResult = await register(body);

      expect(first.json.client_id).not.toBe(second.json.client_id);
      expect(harness.store.count("client")).toBe(2);
    });
  });

  describe("a confidential client", () => {
    it.each([["client_secret_post"], ["client_secret_basic"]])(
      "that asks for %s is issued a secret that does not expire",
      async (method: string) => {
        const response: HttpResult = await register({
          redirect_uris: ["https://client.example/callback"],
          token_endpoint_auth_method: method,
        });

        expect(response.status).toBe(201);
        expect(response.json.token_endpoint_auth_method).toBe(method);
        expect(
          McpOAuthSecret.isValidClientSecretShape(response.json.client_secret),
        ).toBe(true);
        expect(response.json.client_secret_expires_at).toBe(0);
      },
    );

    it("is what a client becomes when it does not say (RFC 7591's default)", async () => {
      const response: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
      });

      expect(response.status).toBe(201);
      expect(response.json.token_endpoint_auth_method).toBe(
        "client_secret_basic",
      );
      expect(typeof response.json.client_secret).toBe("string");
    });

    it("has only the digest of its secret stored", async () => {
      const response: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "client_secret_post",
      });

      const secret: string = response.json.client_secret;
      const row: StoreRow = harness.store.requireRow(
        "client",
        response.json.client_id,
      );

      expect(row["clientSecretHash"]).toBe(McpOAuthSecret.hash(secret));
      expect(JSON.stringify(row)).not.toContain(secret);
    });
  });

  describe("metadata that is refused", () => {
    async function expectRefused(
      body: unknown,
      error: string,
    ): Promise<HttpResult> {
      const response: HttpResult = await register(body);

      expect(response.status).toBe(400);
      expect(response.json.error).toBe(error);
      expect(typeof response.json.error_description).toBe("string");
      expect(response.json.error_description.length).toBeGreaterThan(0);
      expect(harness.store.count("client")).toBe(0);

      return response;
    }

    it("no redirect URIs at all", async () => {
      await expectRefused({ client_name: "x" }, "invalid_redirect_uri");
      await expectRefused({ redirect_uris: [] }, "invalid_redirect_uri");
      await expectRefused(
        { redirect_uris: "https://client.example/callback" },
        "invalid_redirect_uri",
      );
    });

    it.each([
      ["plain http to another host", "http://client.example/callback"],
      ["a javascript: URI", "javascript:alert(1)"],
      ["a data: URI", "data:text/html,<script>alert(1)</script>"],
      ["a fragment", "https://client.example/callback#frag"],
      ["credentials in the URL", "https://user:pass@client.example/callback"],
      ["a relative path", "/callback"],
      ["whitespace", "https://client.example/call back"],
    ])("a redirect URI with %s", async (_label: string, uri: string) => {
      await expectRefused(
        { redirect_uris: ["https://client.example/ok", uri] },
        "invalid_redirect_uri",
      );
    });

    it("more redirect URIs than a client may register", async () => {
      const redirectUris: Array<string> = [];

      for (let index: number = 0; index < 11; index++) {
        redirectUris.push(`https://client.example/callback/${index}`);
      }

      await expectRefused(
        { redirect_uris: redirectUris },
        "invalid_redirect_uri",
      );
    });

    it("an authentication method this server does not offer", async () => {
      const response: HttpResult = await expectRefused(
        {
          redirect_uris: ["https://client.example/callback"],
          token_endpoint_auth_method: "private_key_jwt",
        },
        "invalid_client_metadata",
      );

      // The description says what IS offered.
      expect(response.json.error_description).toContain("none");
      expect(response.json.error_description).toContain("client_secret_post");
    });

    it("grant or response types that leave out the one flow there is", async () => {
      await expectRefused(
        {
          redirect_uris: ["https://client.example/callback"],
          grant_types: ["client_credentials"],
        },
        "invalid_client_metadata",
      );
      await expectRefused(
        {
          redirect_uris: ["https://client.example/callback"],
          response_types: ["token"],
        },
        "invalid_client_metadata",
      );
    });

    it("a body that is JSON but not an object", async () => {
      await expectRefused(
        [{ redirect_uris: ["https://client.example/callback"] }],
        "invalid_client_metadata",
      );
    });

    it("a form body, which is not how a client registers: nothing in it is read", async () => {
      // The JSON parser ignores it, so the request reads as empty metadata.
      const response: HttpResult = await harness.request(REGISTER_PATH, {
        form: { redirect_uris: "https://client.example/callback" },
      });

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_redirect_uri");
      expect(harness.store.count("client")).toBe(0);
    });

    it("no body at all", async () => {
      const response: HttpResult = await harness.request(REGISTER_PATH, {
        method: "POST",
      });

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_redirect_uri");
      expect(harness.store.count("client")).toBe(0);
    });
  });

  describe("a body the server will not parse", () => {
    it("malformed JSON is refused and nothing is written", async () => {
      const response: HttpResult = await harness.request(REGISTER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"redirect_uris": [',
      });

      expect(response.status).toBe(400);
      expect(harness.store.count("client")).toBe(0);
    });

    it("more than 64 KB is refused before it is parsed", async () => {
      const response: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
        client_name: "x".repeat(70 * 1024),
      });

      expect(response.status).toBe(413);
      expect(harness.store.count("client")).toBe(0);
    });

    it("just under the cap is still read", async () => {
      const response: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
        padding: "x".repeat(60 * 1024),
      });

      expect(response.status).toBe(201);
    });
  });

  describe("what a name may contain", () => {
    it("is cut to 100 characters and stripped of control and bidi characters", async () => {
      const rightToLeftOverride: string = String.fromCodePoint(0x202e);
      const zeroWidthSpace: string = String.fromCodePoint(0x200b);

      const response: HttpResult = await register({
        client_name: `Good${rightToLeftOverride}Client${zeroWidthSpace}\n\tName ${"y".repeat(200)}`,
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });

      expect(response.status).toBe(201);

      const name: string = response.json.client_name;

      expect(name.length).toBeLessThanOrEqual(100);
      expect(name.startsWith("Good Client Name ")).toBe(true);
      expect(name).not.toContain(rightToLeftOverride);
      expect(name).not.toContain(zeroWidthSpace);
      expect(name).not.toContain("\n");
    });

    it("is cut by character, so an emoji at the hundredth place is kept whole or dropped - never split", async () => {
      const rocket: string = String.fromCodePoint(0x1f680);

      const kept: HttpResult = await register({
        client_name: `${"a".repeat(99)}${rocket}${"z".repeat(20)}`,
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });
      const dropped: HttpResult = await register({
        client_name: `${"a".repeat(100)}${rocket}`,
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });

      expect(kept.json.client_name).toBe(`${"a".repeat(99)}${rocket}`);
      expect(dropped.json.client_name).toBe("a".repeat(100));

      for (const response of [kept, dropped]) {
        const name: string = response.json.client_name;

        expect(Array.from(name).length).toBeLessThanOrEqual(100);
        // Well-formed text: no half of a surrogate pair left behind.
        expect(encodeURIComponent(name).length).toBeGreaterThan(0);
        expect(
          harness.store.requireRow("client", response.json.client_id)[
            "clientName"
          ],
        ).toBe(name);
      }
    });

    it("drops a home page that is not https rather than refusing the client", async () => {
      const response: HttpResult = await register({
        client_uri: "javascript:alert(1)",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });

      expect(response.status).toBe(201);
      expect("client_uri" in response.json).toBe(false);
      expect(
        harness.store.requireRow("client", response.json.client_id)[
          "clientUri"
        ],
      ).toBeUndefined();
    });
  });

  describe("response headers", () => {
    it("may never be cached, success or failure", async () => {
      const success: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });
      const failure: HttpResult = await register({});

      for (const response of [success, failure]) {
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("pragma")).toBe("no-cache");
      }
    });

    it("can be read by a browser-based client on any origin", async () => {
      const response: HttpResult = await harness.request(REGISTER_PATH, {
        json: {
          redirect_uris: ["https://client.example/callback"],
          token_endpoint_auth_method: "none",
        },
        headers: { Origin: "https://inspector.example" },
      });

      expect(response.status).toBe(201);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("answers the preflight a browser sends first", async () => {
      const response: HttpResult = await harness.request(REGISTER_PATH, {
        method: "OPTIONS",
        headers: {
          Origin: "https://inspector.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-methods")).toContain(
        "POST",
      );
      expect(
        (
          response.headers.get("access-control-allow-headers") || ""
        ).toLowerCase(),
      ).toContain("content-type");
    });

    it("is only a POST", async () => {
      const response: HttpResult = await harness.request(REGISTER_PATH);

      expect(response.status).toBe(404);
      expect(response.json.marker).toBe(APP_404_MARKER);
    });
  });

  describe("rate limiting", () => {
    const VALID_BODY: Record<string, unknown> = {
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "none",
    };

    it("allows the sixtieth registration in a window and refuses the sixty-first", async () => {
      harness.prefillRateLimit("register", 59);

      const sixtieth: HttpResult = await register(VALID_BODY);
      const sixtyFirst: HttpResult = await register(VALID_BODY);

      expect(sixtieth.status).toBe(201);

      expect(sixtyFirst.status).toBe(429);
      expect(sixtyFirst.json).toEqual({
        error: "too_many_requests",
        error_description: "Too many requests. Please try again later.",
      });

      const retryAfter: number = Number(sixtyFirst.headers.get("retry-after"));

      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);
      expect(sixtyFirst.headers.get("cache-control")).toBe("no-store");

      // The refused request wrote nothing.
      expect(harness.store.count("client")).toBe(1);
    });

    it("counts against the registration bucket, per caller address, with an expiry", async () => {
      await register(VALID_BODY);

      const keys: Array<string> = harness.rateLimitKeys();

      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^mcpoauth:rl:register:127\.0\.0\.1:\d+$/);

      // Two windows: a key must outlive the window it counts.
      expect(harness.redisExpiries).toEqual([
        { key: keys[0], seconds: 2 * 15 * 60 },
      ]);
    });

    it("sets the expiry once, not on every request (a sliding window would never reset)", async () => {
      await register(VALID_BODY);
      await register(VALID_BODY);
      await register(VALID_BODY);

      expect(harness.redisExpiries).toHaveLength(1);
    });

    it("refuses a registration it cannot count: no Redis, no anonymous write", async () => {
      harness.setRedisAvailable(false);

      const response: HttpResult = await register(VALID_BODY);

      expect(response.status).toBe(503);
      expect(response.json.error).toBe("temporarily_unavailable");
      expect(harness.store.count("client")).toBe(0);
    });

    it("refuses it too when Redis is there but the counter fails", async () => {
      harness.setRedisFailing(true);

      const response: HttpResult = await register(VALID_BODY);

      expect(response.status).toBe(503);
      expect(response.json.error).toBe("temporarily_unavailable");
      expect(harness.store.count("client")).toBe(0);
    });

    it("is not spent by a request that is refused before it gets there", async () => {
      harness.setOAuthEnabled(false);

      await register(VALID_BODY);

      expect(harness.rateLimitKeys()).toHaveLength(0);
    });
  });

  describe("when OAuth is switched off", () => {
    it("is the app's ordinary 404 and writes nothing", async () => {
      harness.setOAuthEnabled(false);

      const response: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });

      expect(response.status).toBe(404);
      expect(response.json.marker).toBe(APP_404_MARKER);
      expect(harness.store.count("client")).toBe(0);
    });
  });

  describe("when the database fails", () => {
    it("answers server_error and says nothing about why", async () => {
      harness.store.intercept("client", "create", (): void => {
        throw new Error(
          'relation "McpOAuthClient" does not exist at 10.0.0.5:5432',
        );
      });

      const response: HttpResult = await register({
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });

      expect(response.status).toBe(500);
      expect(response.json).toEqual({
        error: "server_error",
        error_description:
          "The authorization server encountered an unexpected error.",
      });
      expect(response.text).not.toContain("McpOAuthClient");
      expect(response.text).not.toContain("10.0.0.5");
    });
  });
});

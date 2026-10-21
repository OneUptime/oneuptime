/**
 * Client authentication tests.
 *
 * "Which client is this, and has it proved it?" - asked at the token and
 * revocation endpoints. A public client proves nothing and is held to PKCE
 * instead; a confidential one has to present its secret, in the body or as
 * HTTP Basic, and every way of getting that wrong has a pinned answer -
 * because a client signs its user out on `invalid_client`, and must not be
 * told that for a failure that is not its identity's.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

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

import ClientAuthentication, {
  BASIC_CHALLENGE,
} from "../../OAuth/ClientAuthentication";
import {
  McpOAuthClientKind,
  ResolvedMcpOAuthClient,
} from "../../OAuth/ClientMetadata";
import ClientResolver from "../../OAuth/ClientResolver";
import McpOAuthError, { McpOAuthErrorCode } from "../../OAuth/McpOAuthError";
import { OAuthParameters } from "../../OAuth/OAuthHttp";
import { ExpressRequest } from "Common/Server/Utils/Express";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import McpOAuthClientAuthMethod from "Common/Types/Mcp/McpOAuthClientAuthMethod";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";

const CLIENT_ID: string = "8b2f6d1e-5c1a-4f0b-9f3e-2d7a6c4b1e90";
const OTHER_CLIENT_ID: string = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DOCUMENT_CLIENT_ID: string = "https://client.example/oauth/metadata.json";

const CLIENT_SECRET: string = McpOAuthSecret.mintClientSecret();
const OTHER_SECRET: string = McpOAuthSecret.mintClientSecret();

const AUTHENTICATION_FAILED: string = "Client authentication failed.";
const INVALID_BASIC: string =
  "The Authorization header is not valid HTTP Basic client credentials.";

function publicClient(
  overrides?: Partial<ResolvedMcpOAuthClient>,
): ResolvedMcpOAuthClient {
  return {
    clientId: CLIENT_ID,
    kind: McpOAuthClientKind.Registered,
    clientName: "Public Client",
    redirectUris: ["http://127.0.0.1/callback"],
    tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
    ...overrides,
  };
}

function confidentialClient(
  overrides?: Partial<ResolvedMcpOAuthClient>,
): ResolvedMcpOAuthClient {
  return {
    clientId: CLIENT_ID,
    kind: McpOAuthClientKind.Registered,
    clientName: "Confidential Client",
    redirectUris: ["https://client.example/callback"],
    tokenEndpointAuthMethod: McpOAuthClientAuthMethod.ClientSecretBasic,
    clientSecretHash: McpOAuthSecret.hash(CLIENT_SECRET),
    ...overrides,
  };
}

function request(authorization?: unknown): ExpressRequest {
  return {
    headers: authorization === undefined ? {} : { authorization },
  } as unknown as ExpressRequest;
}

// RFC 6749 section 2.3.1: each half is form-urlencoded before it is joined.
function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function basicOf(raw: string): string {
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function basic(clientId: string, clientSecret: string): string {
  return basicOf(`${formEncode(clientId)}:${formEncode(clientSecret)}`);
}

async function captureError(promise: Promise<unknown>): Promise<McpOAuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof McpOAuthError) {
      return err;
    }

    throw err;
  }

  throw new Error("Expected authentication to be refused.");
}

function authenticate(
  authorization: unknown,
  parameters: OAuthParameters,
): Promise<ResolvedMcpOAuthClient> {
  return ClientAuthentication.authenticate(request(authorization), parameters);
}

describe("ClientAuthentication", () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest.spyOn(
      ClientResolver,
      "resolve",
    ) as unknown as jest.SpyInstance;
    resolveSpy.mockResolvedValue(publicClient());
  });

  afterEach(() => {
    resolveSpy.mockRestore();
  });

  it("exports the challenge a failed Basic attempt is answered with", () => {
    expect(BASIC_CHALLENGE).toBe(
      'Basic realm="OneUptime MCP", charset="UTF-8"',
    );
  });

  describe("a public client", () => {
    it("is identified by the client_id in the body, with nothing to prove", async () => {
      const client: ResolvedMcpOAuthClient = await authenticate(undefined, {
        client_id: CLIENT_ID,
      });

      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(resolveSpy).toHaveBeenCalledWith(CLIENT_ID);
      expect(client).toEqual(publicClient());
    });

    it("is identified by a metadata document URL", async () => {
      resolveSpy.mockResolvedValue(
        publicClient({
          clientId: DOCUMENT_CLIENT_ID,
          kind: McpOAuthClientKind.MetadataDocument,
        }),
      );

      const client: ResolvedMcpOAuthClient = await authenticate(undefined, {
        client_id: DOCUMENT_CLIENT_ID,
      });

      expect(resolveSpy).toHaveBeenCalledWith(DOCUMENT_CLIENT_ID);
      expect(client.clientId).toBe(DOCUMENT_CLIENT_ID);
    });

    it("is not asked for a secret, and one it sends anyway changes nothing", async () => {
      await expect(
        authenticate(undefined, {
          client_id: CLIENT_ID,
          client_secret: "whatever",
        }),
      ).resolves.toEqual(publicClient());
    });

    it("may name itself with HTTP Basic and an empty password", async () => {
      await expect(authenticate(basic(CLIENT_ID, ""), {})).resolves.toEqual(
        publicClient(),
      );
      expect(resolveSpy).toHaveBeenCalledWith(CLIENT_ID);
    });

    it("is not affected by a Bearer token on the request", async () => {
      // A Bearer header here is simply not client authentication.
      await expect(
        authenticate("Bearer oumcp_at_something", { client_id: CLIENT_ID }),
      ).resolves.toEqual(publicClient());
    });
  });

  describe("a confidential client", () => {
    beforeEach(() => {
      resolveSpy.mockResolvedValue(confidentialClient());
    });

    it("authenticates with its secret in the body", async () => {
      await expect(
        authenticate(undefined, {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      ).resolves.toEqual(confidentialClient());
    });

    it("authenticates with HTTP Basic", async () => {
      await expect(
        authenticate(basic(CLIENT_ID, CLIENT_SECRET), {}),
      ).resolves.toEqual(confidentialClient());
      expect(resolveSpy).toHaveBeenCalledWith(CLIENT_ID);
    });

    it.each(["basic", "BASIC", "bAsIc"])(
      "accepts the %s scheme in any letter case",
      async (scheme: string) => {
        const header: string = basic(CLIENT_ID, CLIENT_SECRET).replace(
          "Basic",
          scheme,
        );

        await expect(authenticate(header, {})).resolves.toEqual(
          confidentialClient(),
        );
      },
    );

    it("accepts extra spaces between the scheme and the credentials", async () => {
      const header: string = basic(CLIENT_ID, CLIENT_SECRET).replace(
        "Basic ",
        "Basic    ",
      );

      await expect(authenticate(header, {})).resolves.toEqual(
        confidentialClient(),
      );
    });

    it("accepts HTTP Basic together with the same client_id in the body", async () => {
      await expect(
        authenticate(basic(CLIENT_ID, CLIENT_SECRET), { client_id: CLIENT_ID }),
      ).resolves.toEqual(confidentialClient());
    });

    it("accepts either transport, whichever of the two the client registered", async () => {
      resolveSpy.mockResolvedValue(
        confidentialClient({
          tokenEndpointAuthMethod: McpOAuthClientAuthMethod.ClientSecretPost,
        }),
      );

      await expect(
        authenticate(basic(CLIENT_ID, CLIENT_SECRET), {}),
      ).resolves.toMatchObject({ clientId: CLIENT_ID });
      await expect(
        authenticate(undefined, {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      ).resolves.toMatchObject({ clientId: CLIENT_ID });
    });

    it.each([
      ["another client's secret", OTHER_SECRET],
      [
        "a secret that differs in its last character",
        `${CLIENT_SECRET.slice(0, -1)}${CLIENT_SECRET.endsWith("A") ? "B" : "A"}`,
      ],
      ["the secret with a space after it", `${CLIENT_SECRET} `],
      ["the secret in upper case", CLIENT_SECRET.toUpperCase()],
      ["the stored hash itself", McpOAuthSecret.hash(CLIENT_SECRET)],
      ["a made-up password", "correct horse battery staple"],
      ["the right prefix and too short a body", "oumcp_cs_short"],
      ["an access token", McpOAuthSecret.mint(McpOAuthTokenType.AccessToken)],
    ])(
      "is refused in the body with %s",
      async (_name: string, clientSecret: string) => {
        const error: McpOAuthError = await captureError(
          authenticate(undefined, {
            client_id: CLIENT_ID,
            client_secret: clientSecret,
          }),
        );

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
        expect(error.getStatusCode()).toBe(401);
        expect(error.description).toBe(AUTHENTICATION_FAILED);
        // Body authentication: no scheme was attempted, so none is named.
        expect(error.challenge).toBeUndefined();
      },
    );

    it.each([
      ["another client's secret", OTHER_SECRET],
      ["a made-up password", "correct horse battery staple"],
      ["an empty password", ""],
    ])(
      "is refused over HTTP Basic with %s, and told which scheme failed",
      async (_name: string, clientSecret: string) => {
        const error: McpOAuthError = await captureError(
          authenticate(basic(CLIENT_ID, clientSecret), {}),
        );

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
        expect(error.getStatusCode()).toBe(401);
        expect(error.description).toBe(AUTHENTICATION_FAILED);
        expect(error.challenge).toBe(BASIC_CHALLENGE);
      },
    );

    it("is refused with no secret at all", async () => {
      const error: McpOAuthError = await captureError(
        authenticate(undefined, { client_id: CLIENT_ID }),
      );

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
      expect(error.description).toBe(AUTHENTICATION_FAILED);
      expect(error.challenge).toBeUndefined();
    });

    it.each([
      ["repeated", [CLIENT_SECRET, CLIENT_SECRET]],
      ["a number", 12345],
      ["an object", { secret: CLIENT_SECRET }],
      ["empty", ""],
    ])(
      "is refused when client_secret is %s",
      async (_name: string, clientSecret: unknown) => {
        const error: McpOAuthError = await captureError(
          authenticate(undefined, {
            client_id: CLIENT_ID,
            client_secret: clientSecret,
          }),
        );

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
        expect(error.description).toBe(AUTHENTICATION_FAILED);
      },
    );

    it("is refused, whatever it presents, when its registration holds no secret digest", async () => {
      // Fail closed: nothing to compare against is not a match.
      const broken: ResolvedMcpOAuthClient = confidentialClient();

      delete broken.clientSecretHash;
      resolveSpy.mockResolvedValue(broken);

      const error: McpOAuthError = await captureError(
        authenticate(undefined, {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      );

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
      expect(error.description).toBe(AUTHENTICATION_FAILED);
    });

    it("is refused when its registration holds an empty digest", async () => {
      resolveSpy.mockResolvedValue(
        confidentialClient({ clientSecretHash: "" }),
      );

      const error: McpOAuthError = await captureError(
        authenticate(basic(CLIENT_ID, CLIENT_SECRET), {}),
      );

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
      expect(error.challenge).toBe(BASIC_CHALLENGE);
    });
  });

  describe("HTTP Basic credentials", () => {
    it("form-decodes the client id: percent escapes", async () => {
      resolveSpy.mockResolvedValue(
        publicClient({
          clientId: DOCUMENT_CLIENT_ID,
          kind: McpOAuthClientKind.MetadataDocument,
        }),
      );

      // "https%3A%2F%2Fclient.example%2Foauth%2Fmetadata.json:"
      const header: string = basic(DOCUMENT_CLIENT_ID, "");

      expect(
        Buffer.from(header.slice("Basic ".length), "base64").toString("utf8"),
      ).toContain("https%3A%2F%2F");

      await authenticate(header, {});

      expect(resolveSpy).toHaveBeenCalledWith(DOCUMENT_CLIENT_ID);
    });

    it("form-decodes the client id: a plus sign is a space", async () => {
      resolveSpy.mockResolvedValue(null);

      await captureError(authenticate(basicOf("my+client+id:secret"), {}));

      expect(resolveSpy).toHaveBeenCalledWith("my client id");
    });

    it("splits at the first colon, so the secret may contain one", async () => {
      resolveSpy.mockResolvedValue(null);

      await captureError(authenticate(basicOf("abc:x:y:z"), {}));

      expect(resolveSpy).toHaveBeenCalledWith("abc");
    });

    it("form-decodes the secret before comparing it", async () => {
      resolveSpy.mockResolvedValue(confidentialClient());

      // Every character of the secret percent-encoded.
      const encodedSecret: string = Array.from(CLIENT_SECRET)
        .map((character: string): string => {
          return `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`;
        })
        .join("");

      await expect(
        authenticate(basicOf(`${CLIENT_ID}:${encodedSecret}`), {}),
      ).resolves.toEqual(confidentialClient());
    });

    it.each([
      ["characters outside base64", "Basic !!!not-base64!!!"],
      ["base64url characters", "Basic YWJj-_8="],
      ["nothing after the scheme", "Basic "],
      ["no colon", basicOf("just-a-client-id")],
      ["nothing before the colon", basicOf(":secret-without-an-id")],
      ["a client id that is not valid percent-encoding", basicOf("%zz:secret")],
      [
        "a secret that is not valid percent-encoding",
        basicOf(`${CLIENT_ID}:%e0%a4%a`),
      ],
    ])(
      "refuses a header with %s, without looking anything up",
      async (_name: string, header: string) => {
        const error: McpOAuthError = await captureError(
          authenticate(header, { client_id: CLIENT_ID }),
        );

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
        expect(error.getStatusCode()).toBe(401);
        expect(error.description).toBe(INVALID_BASIC);
        expect(error.challenge).toBe(BASIC_CHALLENGE);
        expect(resolveSpy).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["the scheme with nothing after it", "Basic"],
      ["a Bearer token", "Bearer abc.def.ghi"],
      ["another scheme", "Digest username=abc"],
      ["a bare token", CLIENT_SECRET],
      ["an empty header", ""],
      [
        "a repeated header",
        [basic(OTHER_CLIENT_ID, CLIENT_SECRET), "Bearer x"],
      ],
    ])(
      "does not read %s as client credentials",
      async (_name: string, header: unknown) => {
        await expect(
          authenticate(header, { client_id: CLIENT_ID }),
        ).resolves.toEqual(publicClient());

        // The body's client, not anything out of the header.
        expect(resolveSpy).toHaveBeenCalledWith(CLIENT_ID);
      },
    );
  });

  describe("a request that authenticates two ways, or names two clients", () => {
    beforeEach(() => {
      resolveSpy.mockResolvedValue(confidentialClient());
    });

    it("is invalid_request when the secret is in the header and in the body", async () => {
      const error: McpOAuthError = await captureError(
        authenticate(basic(CLIENT_ID, CLIENT_SECRET), {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      );

      expect(error.code).toBe(McpOAuthErrorCode.InvalidRequest);
      expect(error.getStatusCode()).toBe(400);
      expect(error.description).toBe(
        "Send client credentials either in the Authorization header or in the request body, not both.",
      );
      expect(error.challenge).toBeUndefined();
      expect(resolveSpy).not.toHaveBeenCalled();
    });

    it("is invalid_request when the header and the body name different clients", async () => {
      const error: McpOAuthError = await captureError(
        authenticate(basic(CLIENT_ID, CLIENT_SECRET), {
          client_id: OTHER_CLIENT_ID,
        }),
      );

      expect(error.code).toBe(McpOAuthErrorCode.InvalidRequest);
      expect(error.description).toBe(
        "The client_id in the request body does not match the Authorization header.",
      );
      expect(resolveSpy).not.toHaveBeenCalled();
    });

    it("never authenticates the body's client with the header's secret", async () => {
      // OTHER_CLIENT_ID in the body, the real client's valid credentials in the header.
      await expect(
        authenticate(basic(CLIENT_ID, CLIENT_SECRET), {
          client_id: OTHER_CLIENT_ID,
        }),
      ).rejects.toBeInstanceOf(McpOAuthError);
      expect(resolveSpy).not.toHaveBeenCalledWith(OTHER_CLIENT_ID);
    });
  });

  describe("a client that cannot be identified", () => {
    it.each([
      ["missing", {}],
      ["empty", { client_id: "" }],
      ["repeated", { client_id: [CLIENT_ID, OTHER_CLIENT_ID] }],
      ["a number", { client_id: 42 }],
    ])(
      "is invalid_client when client_id is %s",
      async (_name: string, parameters: OAuthParameters) => {
        const error: McpOAuthError = await captureError(
          authenticate(undefined, parameters),
        );

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
        expect(error.description).toBe("client_id is required.");
        expect(error.challenge).toBeUndefined();
        expect(resolveSpy).not.toHaveBeenCalled();
      },
    );

    it("is invalid_client for a client nobody knows", async () => {
      resolveSpy.mockResolvedValue(null);

      const error: McpOAuthError = await captureError(
        authenticate(undefined, { client_id: CLIENT_ID }),
      );

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
      expect(error.getStatusCode()).toBe(401);
      expect(error.description).toBe(
        "Unknown client. Register the client again, then restart authorization.",
      );
      expect(error.challenge).toBeUndefined();
    });

    it("names the Basic scheme when an unknown client used it", async () => {
      resolveSpy.mockResolvedValue(null);

      const error: McpOAuthError = await captureError(
        authenticate(basic(CLIENT_ID, CLIENT_SECRET), {}),
      );

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
      expect(error.challenge).toBe(BASIC_CHALLENGE);
    });

    it("says try again, not invalid_client, when a metadata document cannot be read right now", async () => {
      /*
       * `invalid_client` makes a client throw its tokens away. This server
       * being unable to fetch the document is not the client's identity
       * failing.
       */
      const unavailable: McpOAuthError = new McpOAuthError(
        McpOAuthErrorCode.TemporarilyUnavailable,
        "The client metadata document could not be retrieved (HTTP 503).",
      );

      resolveSpy.mockRejectedValue(unavailable);

      const error: McpOAuthError = await captureError(
        authenticate(undefined, { client_id: DOCUMENT_CLIENT_ID }),
      );

      expect(error).toBe(unavailable);
      expect(error.code).toBe(McpOAuthErrorCode.TemporarilyUnavailable);
      expect(error.getStatusCode()).toBe(503);
    });

    it("is invalid_client, with the reason, when the metadata document is not valid", async () => {
      resolveSpy.mockRejectedValue(
        new McpOAuthError(
          McpOAuthErrorCode.InvalidClientMetadata,
          "The client metadata document's client_id does not match the URL it was fetched from.",
        ),
      );

      const error: McpOAuthError = await captureError(
        authenticate(undefined, { client_id: DOCUMENT_CLIENT_ID }),
      );

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClient);
      expect(error.getStatusCode()).toBe(401);
      expect(error.description).toBe(
        "The client metadata document's client_id does not match the URL it was fetched from.",
      );
    });

    /*
     * `invalid_client` is a verdict on the client, and the MCP SDK acts on
     * it by throwing away its registration and its tokens. A lookup that
     * could not be MADE says nothing about the client, so it must never be
     * turned into that verdict: the failure goes up as it is, and the
     * endpoint answers `server_error` (OAuthHttp.handle), which a client
     * simply retries.
     */
    it.each([
      ["in the request body", undefined],
      ["as HTTP Basic", "basic"],
    ])(
      "is not a verdict on the client when the lookup itself fails (client id %s)",
      async (_name: string, scheme: string | undefined) => {
        const cause: Error = new Error("connect ECONNREFUSED 10.0.0.5:5432");

        resolveSpy.mockRejectedValue(cause);

        const attempt: Promise<unknown> = scheme
          ? authenticate(basic(CLIENT_ID, CLIENT_SECRET), {})
          : authenticate(undefined, { client_id: CLIENT_ID });

        let thrown: unknown;

        try {
          await attempt;
        } catch (err) {
          thrown = err;
        }

        // The very error, untouched: nothing dressed it up as invalid_client.
        expect(thrown).toBe(cause);
        expect(thrown).not.toBeInstanceOf(McpOAuthError);
      },
    );
  });

  describe("when the Basic challenge is sent", () => {
    it("is sent for every invalid_client a client earned with HTTP Basic", async () => {
      const failures: Array<McpOAuthError> = [];

      resolveSpy.mockResolvedValue(null);
      failures.push(
        await captureError(authenticate(basic(CLIENT_ID, CLIENT_SECRET), {})),
      );

      resolveSpy.mockResolvedValue(confidentialClient());
      failures.push(
        await captureError(authenticate(basic(CLIENT_ID, OTHER_SECRET), {})),
      );

      resolveSpy.mockRejectedValue(
        new McpOAuthError(McpOAuthErrorCode.InvalidClientMetadata, "mismatch"),
      );
      failures.push(
        await captureError(authenticate(basic(CLIENT_ID, CLIENT_SECRET), {})),
      );

      failures.push(await captureError(authenticate("Basic ???", {})));

      expect(failures).toHaveLength(4);

      for (const failure of failures) {
        expect(failure.code).toBe(McpOAuthErrorCode.InvalidClient);
        expect(failure.challenge).toBe(BASIC_CHALLENGE);
      }
    });

    it("is never sent to a client that did not use HTTP Basic", async () => {
      const failures: Array<McpOAuthError> = [];

      failures.push(await captureError(authenticate(undefined, {})));

      resolveSpy.mockResolvedValue(null);
      failures.push(
        await captureError(authenticate(undefined, { client_id: CLIENT_ID })),
      );

      resolveSpy.mockResolvedValue(confidentialClient());
      failures.push(
        await captureError(
          authenticate("Bearer something", {
            client_id: CLIENT_ID,
            client_secret: OTHER_SECRET,
          }),
        ),
      );

      resolveSpy.mockRejectedValue(
        new McpOAuthError(McpOAuthErrorCode.InvalidClientMetadata, "mismatch"),
      );
      failures.push(
        await captureError(authenticate(undefined, { client_id: CLIENT_ID })),
      );

      expect(failures).toHaveLength(4);

      for (const failure of failures) {
        expect(failure.code).toBe(McpOAuthErrorCode.InvalidClient);
        expect(failure.challenge).toBeUndefined();
      }
    });

    it("is not sent with a 503, which is not an authentication failure", async () => {
      resolveSpy.mockRejectedValue(
        new McpOAuthError(
          McpOAuthErrorCode.TemporarilyUnavailable,
          "The client metadata document could not be retrieved.",
        ),
      );

      const error: McpOAuthError = await captureError(
        authenticate(basic(DOCUMENT_CLIENT_ID, ""), {}),
      );

      expect(error.code).toBe(McpOAuthErrorCode.TemporarilyUnavailable);
      expect(error.challenge).toBeUndefined();
    });
  });
});

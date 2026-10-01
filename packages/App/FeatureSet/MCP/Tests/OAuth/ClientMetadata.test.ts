/**
 * Client metadata tests.
 *
 * A registration is an anonymous write and a metadata document is fetched
 * from an address a stranger chose, so what is believed of either is decided
 * here. These pin what is kept, what is cleaned, and what refuses the whole
 * thing - and that the two sources end up in the same shape.
 */

import { describe, it, expect } from "@jest/globals";
import ClientMetadata, {
  DEFAULT_CLIENT_NAME,
  MAX_CLIENT_NAME_LENGTH,
  MAX_CLIENT_URI_LENGTH,
  MAX_REDIRECT_URIS,
  McpOAuthClientKind,
  McpOAuthClientMetadata,
} from "../../OAuth/ClientMetadata";
import McpOAuthError, { McpOAuthErrorCode } from "../../OAuth/McpOAuthError";
import {
  CLAUDE,
  CLAUDE_CODE,
  REAL_WORLD_CLIENTS,
  RealWorldClientFixture,
  VS_CODE,
} from "./RealWorldClientFixtures";
import McpOAuthClientAuthMethod from "Common/Types/Mcp/McpOAuthClientAuthMethod";

const REDIRECT_URI: string = "https://client.example/callback";
const CLIENT_ID_URL: string = "https://client.example/oauth/metadata.json";

// The first half of a character outside the Basic Multilingual Plane.
function endsWithHalfACharacter(value: string): boolean {
  const lastUnit: number = value.charCodeAt(value.length - 1);

  return lastUnit >= 0xd800 && lastUnit <= 0xdbff;
}

function captureError(action: () => unknown): McpOAuthError {
  try {
    action();
  } catch (err) {
    if (err instanceof McpOAuthError) {
      return err;
    }

    throw err;
  }

  throw new Error("Expected an McpOAuthError to be thrown.");
}

function register(body: Record<string, unknown>): McpOAuthClientMetadata {
  return ClientMetadata.parseRegistrationRequest({
    redirect_uris: [REDIRECT_URI],
    ...body,
  });
}

function nameOf(clientName: unknown): string {
  return register({ client_name: clientName }).clientName;
}

function char(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

describe("ClientMetadata", () => {
  it("names the two kinds of client the way a ticket stores them", () => {
    // These strings ride inside signed tickets; changing one orphans them.
    expect(McpOAuthClientKind.Registered).toBe("registered");
    expect(McpOAuthClientKind.MetadataDocument).toBe("metadata-document");
  });

  describe("parseRegistrationRequest", () => {
    it("parses a minimal registration with the RFC 7591 defaults", () => {
      const metadata: McpOAuthClientMetadata =
        ClientMetadata.parseRegistrationRequest({
          redirect_uris: [REDIRECT_URI],
        });

      expect(metadata).toEqual({
        clientName: "MCP Client",
        redirectUris: [REDIRECT_URI],
        tokenEndpointAuthMethod: McpOAuthClientAuthMethod.ClientSecretBasic,
      });
      expect(DEFAULT_CLIENT_NAME).toBe("MCP Client");
    });

    it("defaults an omitted token_endpoint_auth_method to client_secret_basic, not none", () => {
      /*
       * RFC 7591 section 2. A client that cannot keep a secret has to say
       * `none`; defaulting to it would make every confidential client that
       * left the field out a public one.
       */
      expect(register({}).tokenEndpointAuthMethod).toBe("client_secret_basic");
      expect(
        register({ token_endpoint_auth_method: null }).tokenEndpointAuthMethod,
      ).toBe("client_secret_basic");
    });

    it.each([
      ["none", McpOAuthClientAuthMethod.None],
      ["client_secret_post", McpOAuthClientAuthMethod.ClientSecretPost],
      ["client_secret_basic", McpOAuthClientAuthMethod.ClientSecretBasic],
    ])(
      "accepts token_endpoint_auth_method %s",
      (value: string, expected: McpOAuthClientAuthMethod) => {
        expect(
          register({ token_endpoint_auth_method: value })
            .tokenEndpointAuthMethod,
        ).toBe(expected);
      },
    );

    it.each([
      ["private_key_jwt", "private_key_jwt"],
      ["an upper-case NONE", "NONE"],
      ["an empty string", ""],
      ["a number", 0],
      ["a boolean", false],
      ["an array", ["none"]],
      ["an object", { method: "none" }],
    ])(
      "refuses token_endpoint_auth_method %s",
      (_name: string, value: unknown) => {
        const error: McpOAuthError = captureError(() => {
          return register({ token_endpoint_auth_method: value });
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
        expect(error.description).toBe(
          "token_endpoint_auth_method must be one of: none, client_secret_post, client_secret_basic.",
        );
      },
    );

    it("keeps only the fields the server uses", () => {
      const metadata: McpOAuthClientMetadata =
        ClientMetadata.parseRegistrationRequest({
          client_name: "Example Client",
          client_uri: "https://client.example/",
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: "mcp:read mcp:write admin",
          logo_uri: "https://client.example/logo.png",
          tos_uri: "https://client.example/tos",
          policy_uri: "https://client.example/policy",
          jwks_uri: "https://client.example/jwks.json",
          jwks: { keys: [] },
          contacts: ["someone@client.example"],
          software_id: "x",
          software_statement: "eyJhbGciOiJub25lIn0.e30.",
          client_id: "11111111-2222-3333-4444-555555555555",
          client_secret: "chosen-by-the-client",
        });

      expect(metadata).toEqual({
        clientName: "Example Client",
        clientUri: "https://client.example/",
        redirectUris: [REDIRECT_URI],
        tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
      });
    });

    describe("redirect_uris", () => {
      const REQUIRED_MESSAGE: string =
        "redirect_uris is required and must list at least one redirect URI.";

      it.each([
        ["missing", undefined],
        ["null", null],
        ["a string", REDIRECT_URI],
        ["an object", { 0: REDIRECT_URI }],
        ["a number", 1],
        ["an empty array", []],
      ])(
        "refuses redirect_uris that is %s",
        (_name: string, value: unknown) => {
          const error: McpOAuthError = captureError(() => {
            return ClientMetadata.parseRegistrationRequest({
              client_name: "Example",
              redirect_uris: value,
            });
          });

          expect(error.code).toBe(McpOAuthErrorCode.InvalidRedirectUri);
          expect(error.description).toBe(REQUIRED_MESSAGE);
        },
      );

      it("accepts ten redirect URIs and refuses eleven", () => {
        const uris: Array<string> = [];

        for (let index: number = 0; index < MAX_REDIRECT_URIS; index++) {
          uris.push(`https://client.example/callback/${index}`);
        }

        expect(MAX_REDIRECT_URIS).toBe(10);
        expect(register({ redirect_uris: uris }).redirectUris).toEqual(uris);

        const error: McpOAuthError = captureError(() => {
          return register({
            redirect_uris: [...uris, "https://client.example/callback/10"],
          });
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidRedirectUri);
        expect(error.description).toBe(
          "A client can register at most 10 redirect URIs.",
        );
      });

      it.each([
        [
          "a javascript: URI",
          "javascript:alert(1)",
          "A redirect URI cannot use the javascript: scheme.",
        ],
        [
          "plain http to another host",
          "http://client.example/callback",
          "A redirect URI must use https, unless it points at this machine (localhost, 127.0.0.1 or [::1]).",
        ],
        [
          "a fragment",
          "https://client.example/callback#x",
          "A redirect URI must not contain a fragment.",
        ],
        [
          "a relative path",
          "/callback",
          "A redirect URI must be an absolute URI.",
        ],
      ])(
        "refuses the whole registration over %s",
        (_name: string, bad: string, description: string) => {
          const error: McpOAuthError = captureError(() => {
            return register({ redirect_uris: [REDIRECT_URI, bad] });
          });

          expect(error.code).toBe(McpOAuthErrorCode.InvalidRedirectUri);
          expect(error.description).toBe(description);
        },
      );

      it.each([
        ["a number", 5],
        ["null", null],
        ["an object", { uri: REDIRECT_URI }],
        ["a nested array", [REDIRECT_URI]],
        ["an empty string", ""],
      ])("refuses an entry that is %s", (_name: string, bad: unknown) => {
        const error: McpOAuthError = captureError(() => {
          return register({ redirect_uris: [REDIRECT_URI, bad] });
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidRedirectUri);
        expect(error.description).toBe(
          "A redirect URI must be a non-empty string.",
        );
      });

      it("collapses duplicates and keeps the order", () => {
        expect(
          register({
            redirect_uris: [
              "http://localhost/callback",
              REDIRECT_URI,
              "http://localhost/callback",
              "cursor://anysphere.cursor-retrieval/oauth/callback",
              REDIRECT_URI,
            ],
          }).redirectUris,
        ).toEqual([
          "http://localhost/callback",
          REDIRECT_URI,
          "cursor://anysphere.cursor-retrieval/oauth/callback",
        ]);
      });

      it("stores each URI exactly as it was sent", () => {
        // Matching is by exact string, so nothing may be normalised here.
        const asSent: Array<string> = [
          "https://Client.Example:443/Callback?A=1",
          "http://127.0.0.1:3000/callback",
        ];

        expect(register({ redirect_uris: asSent }).redirectUris).toEqual(
          asSent,
        );
      });
    });

    describe("grant_types and response_types", () => {
      it.each([
        ["authorization_code alone", ["authorization_code"]],
        [
          "authorization_code with refresh_token",
          ["authorization_code", "refresh_token"],
        ],
        [
          "authorization_code among others",
          ["client_credentials", "authorization_code"],
        ],
      ])("accepts grant_types with %s", (_name: string, value: unknown) => {
        expect(register({ grant_types: value }).redirectUris).toEqual([
          REDIRECT_URI,
        ]);
      });

      it.each([
        ["refresh_token alone", ["refresh_token"]],
        ["client_credentials", ["client_credentials"]],
        ["implicit", ["implicit"]],
        ["an empty list", []],
        ["a bare string", "authorization_code"],
        ["null", null],
        ["an object", { authorization_code: true }],
      ])("refuses grant_types that is %s", (_name: string, value: unknown) => {
        const error: McpOAuthError = captureError(() => {
          return register({ grant_types: value });
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
        expect(error.description).toBe(
          'grant_types must include "authorization_code"; it is the only flow this server offers.',
        );
      });

      it("accepts response_types that include code", () => {
        expect(register({ response_types: ["code"] }).redirectUris).toEqual([
          REDIRECT_URI,
        ]);
        expect(
          register({ response_types: ["token", "code"] }).redirectUris,
        ).toEqual([REDIRECT_URI]);
      });

      it.each([
        ["token", ["token"]],
        ["id_token", ["id_token"]],
        ["an empty list", []],
        ["a bare string", "code"],
        ["null", null],
      ])(
        "refuses response_types that is %s",
        (_name: string, value: unknown) => {
          const error: McpOAuthError = captureError(() => {
            return register({ response_types: value });
          });

          expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
          expect(error.description).toBe(
            'response_types must include "code"; it is the only response type this server offers.',
          );
        },
      );
    });

    describe("client_uri", () => {
      it("keeps an https address, normalised", () => {
        expect(
          register({ client_uri: "https://client.example" }).clientUri,
        ).toBe("https://client.example/");
        expect(
          register({ client_uri: "HTTPS://Client.Example/About?x=1" })
            .clientUri,
        ).toBe("https://client.example/About?x=1");
      });

      it.each([
        ["plain http", "http://client.example/"],
        ["a javascript: URI", "javascript:alert(1)"],
        ["a data: URI", "data:text/html,hi"],
        ["a private-use scheme", "cursor://about"],
        ["credentials", "https://user:pass@client.example/"],
        ["a user alone", "https://user@client.example/"],
        ["a relative path", "/about"],
        ["a bare host", "client.example"],
        ["an empty string", ""],
        ["a number", 7],
        ["null", null],
        ["an array", ["https://client.example/"]],
      ])(
        "drops %s without refusing the registration",
        (_name: string, value: unknown) => {
          const metadata: McpOAuthClientMetadata = register({
            client_uri: value,
          });

          expect(metadata.clientUri).toBeUndefined();
          expect("clientUri" in metadata).toBe(false);
          expect(metadata.redirectUris).toEqual([REDIRECT_URI]);
        },
      );

      it("drops an address longer than 500 characters", () => {
        const prefix: string = "https://client.example/";
        const atLimit: string = `${prefix}${"a".repeat(MAX_CLIENT_URI_LENGTH - prefix.length)}`;

        expect(MAX_CLIENT_URI_LENGTH).toBe(500);
        expect(atLimit).toHaveLength(500);
        expect(register({ client_uri: atLimit }).clientUri).toBe(atLimit);
        expect(
          register({ client_uri: `${atLimit}a` }).clientUri,
        ).toBeUndefined();
      });

      it("drops an address that only exceeds the limit once normalised", () => {
        // 200 characters as sent; percent-encoding makes each one six.
        const value: string = `https://client.example/${"\xe9".repeat(200)}`;

        expect(value.length).toBeLessThan(MAX_CLIENT_URI_LENGTH);
        expect(register({ client_uri: value }).clientUri).toBeUndefined();
      });
    });

    describe("client_name", () => {
      it("keeps an ordinary name, including non-Latin text and emoji", () => {
        const name: string = `Claude ${char(0x2013)} B${char(0xfc)}ro ${char(0x6771)}${char(0x4eac)} ${char(0x1f600)}`;

        expect(nameOf("Claude Code")).toBe("Claude Code");
        expect(nameOf(name)).toBe(name);
      });

      it.each([
        ["missing", undefined],
        ["null", null],
        ["a number", 42],
        ["a boolean", true],
        ["an object", { name: "x" }],
        ["an array", ["x"]],
        ["an empty string", ""],
        ["only spaces", "     "],
        ["only control characters", "\x00\x01\x1f\x7f"],
        ["only zero-width characters", `${char(0x200b)}${char(0xfeff)}`],
      ])(
        "uses the generic name when it is %s",
        (_name: string, value: unknown) => {
          expect(nameOf(value)).toBe("MCP Client");
        },
      );

      it("collapses whitespace and trims", () => {
        expect(nameOf("   My    Client  ")).toBe("My Client");
        expect(nameOf("My\t\r\nClient")).toBe("My Client");
        // U+00A0 and U+3000 are whitespace too.
        expect(nameOf(`My${char(0xa0)}${char(0x3000)}Client`)).toBe(
          "My Client",
        );
      });

      it("removes every C0 control character", () => {
        for (let codePoint: number = 0x00; codePoint <= 0x1f; codePoint++) {
          expect(nameOf(`Evil${char(codePoint)}Client`)).toBe("Evil Client");
        }
      });

      it("removes DEL and every C1 control character", () => {
        for (let codePoint: number = 0x7f; codePoint <= 0x9f; codePoint++) {
          expect(nameOf(`Evil${char(codePoint)}Client`)).toBe("Evil Client");
        }
      });

      it.each([
        ["zero width space", 0x200b],
        ["zero width non-joiner", 0x200c],
        ["zero width joiner", 0x200d],
        ["left-to-right mark", 0x200e],
        ["right-to-left mark", 0x200f],
        ["line separator", 0x2028],
        ["paragraph separator", 0x2029],
        ["left-to-right embedding", 0x202a],
        ["right-to-left embedding", 0x202b],
        ["pop directional formatting", 0x202c],
        ["left-to-right override", 0x202d],
        ["right-to-left override", 0x202e],
        ["word joiner", 0x2060],
        ["left-to-right isolate", 0x2066],
        ["right-to-left isolate", 0x2067],
        ["first strong isolate", 0x2068],
        ["pop directional isolate", 0x2069],
        ["the last of the format block", 0x206f],
        ["byte order mark", 0xfeff],
      ])("removes the %s character", (_name: string, codePoint: number) => {
        const cleaned: string = nameOf(`Evil${char(codePoint)}Client`);

        expect(cleaned).toBe("Evil Client");
        expect(cleaned).not.toContain(char(codePoint));
      });

      it("defuses a right-to-left override used to reverse the visible name", () => {
        // Displays as "OneUptime" reversed tricks without the cleaning.
        const spoof: string = `${char(0x202e)}emitpUenO${char(0x202c)} Admin`;

        expect(nameOf(spoof)).toBe("emitpUenO Admin");
      });

      it("keeps the characters next to the removed ranges", () => {
        // U+200A (hair space) collapses as whitespace; the rest are printable.
        for (const codePoint of [0x20, 0x7e, 0xa1, 0x2010, 0x202f, 0x2070]) {
          const cleaned: string = nameOf(`A${char(codePoint)}B`);

          expect(cleaned.startsWith("A")).toBe(true);
          expect(cleaned.endsWith("B")).toBe(true);
        }

        expect(nameOf(`A${char(0x7e)}B`)).toBe("A~B");
        expect(nameOf(`A${char(0xa1)}B`)).toBe(`A${char(0xa1)}B`);
        expect(nameOf(`A${char(0x2010)}B`)).toBe(`A${char(0x2010)}B`);
        expect(nameOf(`A${char(0x2070)}B`)).toBe(`A${char(0x2070)}B`);
      });

      it("cuts the name to 100 characters", () => {
        expect(MAX_CLIENT_NAME_LENGTH).toBe(100);
        expect(nameOf("a".repeat(100))).toBe("a".repeat(100));
        expect(nameOf("a".repeat(150))).toBe("a".repeat(100));
      });

      it("does not leave a trailing space where it cut", () => {
        expect(nameOf(`${"a".repeat(99)} bbbbbb`)).toBe("a".repeat(99));
      });

      it("measures the limit after cleaning, not before", () => {
        // 300 characters as sent, 3 once the whitespace has collapsed.
        expect(nameOf(`a${" ".repeat(149)}b${" ".repeat(148)}c`)).toBe("a b c");
      });

      it("never cuts a name in the middle of a character", () => {
        /*
         * An emoji is two UTF-16 units. Cut between them, the name ends in
         * half a character - which JSON encodes as a lone surrogate escape
         * that strict parsers refuse, in the registration response and in
         * everything else the name is later written into.
         */
        const cleaned: string = nameOf(`${"a".repeat(99)}${char(0x1f600)}`);

        expect(endsWithHalfACharacter(cleaned)).toBe(false);

        /*
         * Counted in characters, as the column counts them: whether the
         * hundredth one is kept whole or dropped, it is never halved.
         */
        expect(Array.from(cleaned).length).toBeLessThanOrEqual(100);
        expect(cleaned.startsWith("a".repeat(99))).toBe(true);
      });

      it("returns markup unchanged: the pages that show a name escape it", () => {
        expect(nameOf("<script>alert(1)</script>")).toBe(
          "<script>alert(1)</script>",
        );
        expect(nameOf('"><img src=x onerror=alert(1)>')).toBe(
          '"><img src=x onerror=alert(1)>',
        );
      });
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a string", '{"redirect_uris":["https://client.example/callback"]}'],
      ["a number", 1],
      ["a boolean", true],
      ["an array", [{ redirect_uris: [REDIRECT_URI] }]],
    ])("refuses a body that is %s", (_name: string, body: unknown) => {
      const error: McpOAuthError = captureError(() => {
        return ClientMetadata.parseRegistrationRequest(body);
      });

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
      expect(error.description).toBe("Client metadata must be a JSON object.");
    });
  });

  describe("parseMetadataDocument", () => {
    function documentWith(
      overrides: Record<string, unknown>,
    ): Record<string, unknown> {
      return {
        client_id: CLIENT_ID_URL,
        client_name: "Example Client",
        client_uri: "https://client.example/",
        redirect_uris: [REDIRECT_URI, "http://127.0.0.1/callback"],
        ...overrides,
      };
    }

    function parse(document: unknown): McpOAuthClientMetadata {
      return ClientMetadata.parseMetadataDocument({
        clientId: CLIENT_ID_URL,
        document,
      });
    }

    it("parses a document into the same shape a registration has", () => {
      expect(parse(documentWith({}))).toEqual({
        clientName: "Example Client",
        clientUri: "https://client.example/",
        redirectUris: [REDIRECT_URI, "http://127.0.0.1/callback"],
        tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
      });
    });

    it("is a public client by default and when it says none", () => {
      expect(parse(documentWith({})).tokenEndpointAuthMethod).toBe("none");
      expect(
        parse(documentWith({ token_endpoint_auth_method: "none" }))
          .tokenEndpointAuthMethod,
      ).toBe("none");
      expect(
        parse(documentWith({ token_endpoint_auth_method: null }))
          .tokenEndpointAuthMethod,
      ).toBe("none");
    });

    it.each([
      ["missing", undefined],
      ["null", null],
      ["another client's URL", "https://other.example/oauth/metadata.json"],
      ["the same URL with a trailing slash", `${CLIENT_ID_URL}/`],
      ["the same URL in another letter case", CLIENT_ID_URL.toUpperCase()],
      ["the same URL with a query", `${CLIENT_ID_URL}?v=2`],
      ["the same URL over http", CLIENT_ID_URL.replace("https:", "http:")],
      ["an array holding the URL", [CLIENT_ID_URL]],
    ])(
      "refuses a document whose client_id is %s",
      (_name: string, value: unknown) => {
        const error: McpOAuthError = captureError(() => {
          return parse(documentWith({ client_id: value }));
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
        expect(error.description).toBe(
          "The client metadata document's client_id does not match the URL it was fetched from.",
        );
      },
    );

    it.each([
      ["a client_secret", { client_secret: "s3cret" }],
      ["an empty client_secret", { client_secret: "" }],
      ["a null client_secret", { client_secret: null }],
      ["client_secret_expires_at", { client_secret_expires_at: 0 }],
    ])(
      "refuses a document with %s",
      (_name: string, extra: Record<string, unknown>) => {
        const error: McpOAuthError = captureError(() => {
          return parse(documentWith(extra));
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
        expect(error.description).toBe(
          "A client metadata document must not contain a client secret.",
        );
      },
    );

    it.each(["client_secret_basic", "client_secret_post"])(
      "refuses a document that asks for %s",
      (method: string) => {
        const error: McpOAuthError = captureError(() => {
          return parse(documentWith({ token_endpoint_auth_method: method }));
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
        expect(error.description).toBe(
          'A client identified by a metadata document must use token_endpoint_auth_method "none".',
        );
      },
    );

    it("refuses a document with an authentication method this server does not know", () => {
      const error: McpOAuthError = captureError(() => {
        return parse(
          documentWith({ token_endpoint_auth_method: "private_key_jwt" }),
        );
      });

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
      expect(error.description).toContain("token_endpoint_auth_method");
    });

    it("holds the document's redirect URIs to the registration rules", () => {
      const missing: McpOAuthError = captureError(() => {
        return parse(documentWith({ redirect_uris: undefined }));
      });
      const unsafe: McpOAuthError = captureError(() => {
        return parse(
          documentWith({ redirect_uris: ["http://client.example/callback"] }),
        );
      });
      const script: McpOAuthError = captureError(() => {
        return parse(documentWith({ redirect_uris: ["javascript:alert(1)"] }));
      });

      expect(missing.code).toBe(McpOAuthErrorCode.InvalidRedirectUri);
      expect(unsafe.code).toBe(McpOAuthErrorCode.InvalidRedirectUri);
      expect(script.code).toBe(McpOAuthErrorCode.InvalidRedirectUri);
    });

    it("holds the document to the one flow this server offers", () => {
      const error: McpOAuthError = captureError(() => {
        return parse(documentWith({ grant_types: ["client_credentials"] }));
      });

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
    });

    it("cleans the document's name and drops an unusable client_uri", () => {
      const metadata: McpOAuthClientMetadata = parse(
        documentWith({
          client_name: `  Evil${char(0x202e)}  Client `,
          client_uri: "http://client.example/",
        }),
      );

      expect(metadata.clientName).toBe("Evil Client");
      expect(metadata.clientUri).toBeUndefined();
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a string", "<html></html>"],
      ["an array", [{ client_id: CLIENT_ID_URL }]],
      ["a number", 200],
    ])("refuses a document that is %s", (_name: string, document: unknown) => {
      const error: McpOAuthError = captureError(() => {
        return parse(document);
      });

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
      expect(error.description).toBe("Client metadata must be a JSON object.");
    });
  });

  describe("the metadata documents real MCP clients publish", () => {
    it.each(REAL_WORLD_CLIENTS)(
      "accepts $name's document as fetched from its own client id",
      (fixture: RealWorldClientFixture) => {
        expect(
          ClientMetadata.parseMetadataDocument({
            clientId: fixture.clientId,
            document: fixture.document,
          }),
        ).toEqual({
          clientName: fixture.expected.clientName,
          clientUri: fixture.expected.clientUri,
          redirectUris: fixture.expected.redirectUris,
          tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
        });
      },
    );

    it.each(REAL_WORLD_CLIENTS)(
      "reads $name as a public client",
      (fixture: RealWorldClientFixture) => {
        expect(fixture.document["token_endpoint_auth_method"]).toBe("none");
        expect(
          ClientMetadata.parseMetadataDocument({
            clientId: fixture.clientId,
            document: fixture.document,
          }).tokenEndpointAuthMethod,
        ).toBe(McpOAuthClientAuthMethod.None);
      },
    );

    it("tolerates the grant types real clients list beside the one this server offers", () => {
      // Device code (VS Code) and JWT bearer (Claude) are simply not used.
      expect(VS_CODE.document["grant_types"]).toContain(
        "urn:ietf:params:oauth:grant-type:device_code",
      );
      expect(CLAUDE.document["grant_types"]).toContain(
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      );

      for (const fixture of [VS_CODE, CLAUDE]) {
        expect(
          ClientMetadata.parseMetadataDocument({
            clientId: fixture.clientId,
            document: fixture.document,
          }).redirectUris,
        ).toEqual(fixture.expected.redirectUris);
      }
    });

    it("drops the fields it has no use for, such as logo_uri and application_type", () => {
      expect(VS_CODE.document["logo_uri"]).toBeDefined();
      expect(VS_CODE.document["application_type"]).toBe("native");

      const metadata: McpOAuthClientMetadata =
        ClientMetadata.parseMetadataDocument({
          clientId: VS_CODE.clientId,
          document: VS_CODE.document,
        });

      expect(Object.keys(metadata).sort()).toEqual([
        "clientName",
        "clientUri",
        "redirectUris",
        "tokenEndpointAuthMethod",
      ]);
    });

    it("keeps each client's redirect URIs exactly as published, ports and all", () => {
      expect(
        ClientMetadata.parseMetadataDocument({
          clientId: VS_CODE.clientId,
          document: VS_CODE.document,
        }).redirectUris,
      ).toEqual(["http://127.0.0.1:33418/", "https://vscode.dev/redirect"]);
      expect(
        ClientMetadata.parseMetadataDocument({
          clientId: CLAUDE.clientId,
          document: CLAUDE.document,
        }).redirectUris,
      ).toEqual(["https://claude.ai/api/mcp/auth_callback"]);
      expect(
        ClientMetadata.parseMetadataDocument({
          clientId: CLAUDE_CODE.clientId,
          document: CLAUDE_CODE.document,
        }).redirectUris,
      ).toEqual(["http://localhost/callback", "http://127.0.0.1/callback"]);
    });

    it.each(REAL_WORLD_CLIENTS)(
      "refuses $name's document when it is served from somebody else's URL",
      (fixture: RealWorldClientFixture) => {
        // A site re-hosting a well-known client's document to borrow its name.
        const error: McpOAuthError = captureError(() => {
          return ClientMetadata.parseMetadataDocument({
            clientId: "https://evil.example/oauth/client-metadata.json",
            document: fixture.document,
          });
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
        expect(error.description).toBe(
          "The client metadata document's client_id does not match the URL it was fetched from.",
        );
      },
    );

    it("does not mistake one Claude document for the other, though they share a host", () => {
      const error: McpOAuthError = captureError(() => {
        return ClientMetadata.parseMetadataDocument({
          clientId: CLAUDE.clientId,
          document: CLAUDE_CODE.document,
        });
      });

      expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
    });
  });
});

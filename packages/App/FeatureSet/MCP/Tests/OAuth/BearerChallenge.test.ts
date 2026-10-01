/**
 * Bearer challenge tests.
 *
 * The `WWW-Authenticate` header is the whole of how an MCP client learns it
 * should sign somebody in, so its grammar is pinned here by parsing it - both
 * with a strict parser of our own and with the one the MCP TypeScript SDK's
 * client actually uses - and its quoting is pinned against text that tries to
 * break out of it.
 */

import { describe, it, expect } from "@jest/globals";
import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import BearerChallengeBuilder, {
  BearerChallenge,
} from "../../OAuth/BearerChallenge";
import Metadata from "../../OAuth/Metadata";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";

interface ParsedChallenge {
  scheme: string;
  names: Array<string>;
  parameters: Record<string, string>;

  // The header rebuilt from what was parsed: equal to the input if nothing else was in it.
  rebuilt: string;
}

const AUTH_PARAM_PATTERN: RegExp = /([a-z_]+)="([^"\\]*)"/g;
const PRINTABLE_ASCII_PATTERN: RegExp = /^[\x20-\x7E]+$/;

/*
 * RFC 7235: `scheme 1*SP auth-param *( "," auth-param )`, each auth-param a
 * `name="quoted-string"`. Strict on purpose - no escapes are accepted inside
 * a value, because the builder is supposed never to need one.
 */
function parseChallenge(header: string): ParsedChallenge {
  const spaceIndex: number = header.indexOf(" ");
  const scheme: string = header.slice(0, spaceIndex);
  const names: Array<string> = [];
  const parameters: Record<string, string> = {};

  for (const match of header
    .slice(spaceIndex + 1)
    .matchAll(AUTH_PARAM_PATTERN)) {
    names.push(match[1]!);
    parameters[match[1]!] = match[2]!;
  }

  const rebuilt: string = `${scheme} ${names
    .map((name: string): string => {
      return `${name}="${parameters[name]}"`;
    })
    .join(", ")}`;

  return { scheme, names, parameters, rebuilt };
}

function responseWith(challenge: BearerChallenge): Response {
  return new Response(null, {
    status: challenge.statusCode,
    headers: { "WWW-Authenticate": challenge.headerValue },
  });
}

describe("BearerChallengeBuilder", () => {
  describe("unauthorized (401)", () => {
    const challenge: BearerChallenge = BearerChallengeBuilder.unauthorized(
      "Authentication is required for this tool.",
    );

    it("is a 401", () => {
      expect(challenge.statusCode).toBe(401);
    });

    it("is a well-formed Bearer challenge and nothing else", () => {
      const parsed: ParsedChallenge = parseChallenge(challenge.headerValue);

      expect(parsed.scheme).toBe("Bearer");
      expect(parsed.names).toEqual([
        "error",
        "resource_metadata",
        "scope",
        "error_description",
      ]);
      expect(parsed.rebuilt).toBe(challenge.headerValue);
    });

    it("says invalid_token, with the description", () => {
      const parsed: ParsedChallenge = parseChallenge(challenge.headerValue);

      expect(parsed.parameters["error"]).toBe("invalid_token");
      expect(parsed.parameters["error_description"]).toBe(
        "Authentication is required for this tool.",
      );
    });

    it("points at the protected resource metadata, where discovery starts", () => {
      const parsed: ParsedChallenge = parseChallenge(challenge.headerValue);

      expect(parsed.parameters["resource_metadata"]).toBe(
        McpOAuthConfig.getProtectedResourceMetadataUrl(),
      );
      expect(parsed.parameters["resource_metadata"]).toBe(
        `${McpOAuthConfig.getResource()}/.well-known/oauth-protected-resource`,
      );
    });

    it("points at a URL this server actually serves the document at", () => {
      const parsed: ParsedChallenge = parseChallenge(challenge.headerValue);
      const url: URL = new URL(parsed.parameters["resource_metadata"]!);

      expect(url.origin).toBe(new URL(McpOAuthConfig.getOrigin()).origin);
      expect(Metadata.getProtectedResourceMetadataPaths()).toContain(
        url.pathname,
      );
    });

    it("asks for read and write, even though nothing has been called yet", () => {
      /*
       * Asking for read alone would strand a client that later needs write:
       * one holding a refresh token answers a step-up by refreshing, and gets
       * the scope it already had.
       */
      expect(parseChallenge(challenge.headerValue).parameters["scope"]).toBe(
        "mcp:read mcp:write",
      );
    });

    it("carries the same error in the body, for whoever reads the response by hand", () => {
      expect(challenge.body).toEqual({
        error: "invalid_token",
        error_description: "Authentication is required for this tool.",
      });
    });
  });

  describe("insufficientScope (403)", () => {
    const challenge: BearerChallenge = BearerChallengeBuilder.insufficientScope(
      "This connection was authorized as read-only.",
    );

    it("is a 403", () => {
      expect(challenge.statusCode).toBe(403);
    });

    it("is a well-formed Bearer challenge and nothing else", () => {
      const parsed: ParsedChallenge = parseChallenge(challenge.headerValue);

      expect(parsed.scheme).toBe("Bearer");
      expect(parsed.names).toEqual([
        "error",
        "resource_metadata",
        "scope",
        "error_description",
      ]);
      expect(parsed.rebuilt).toBe(challenge.headerValue);
    });

    it("says insufficient_scope, with the description", () => {
      const parsed: ParsedChallenge = parseChallenge(challenge.headerValue);

      expect(parsed.parameters["error"]).toBe("insufficient_scope");
      expect(parsed.parameters["error_description"]).toBe(
        "This connection was authorized as read-only.",
      );
    });

    it("names everything the client should hold afterwards, not only what is missing", () => {
      // A client that replaces its scope with the challenge's keeps read.
      expect(parseChallenge(challenge.headerValue).parameters["scope"]).toBe(
        "mcp:read mcp:write",
      );
    });

    it("still says where discovery starts", () => {
      expect(
        parseChallenge(challenge.headerValue).parameters["resource_metadata"],
      ).toBe(McpOAuthConfig.getProtectedResourceMetadataUrl());
    });

    it("carries the same error in the body", () => {
      expect(challenge.body).toEqual({
        error: "insufficient_scope",
        error_description: "This connection was authorized as read-only.",
      });
    });
  });

  describe("what the MCP SDK client reads out of it", () => {
    it("reads the 401 challenge", () => {
      const parsed: ReturnType<typeof extractWWWAuthenticateParams> =
        extractWWWAuthenticateParams(
          responseWith(
            BearerChallengeBuilder.unauthorized(
              "Authentication is required for this tool. Sign in with OneUptime, or send a OneUptime API key in the x-api-key header.",
            ),
          ),
        );

      expect(parsed.resourceMetadataUrl?.toString()).toBe(
        McpOAuthConfig.getProtectedResourceMetadataUrl(),
      );
      expect(parsed.scope).toBe("mcp:read mcp:write");
      expect(parsed.error).toBe("invalid_token");
    });

    it("reads the 403 challenge", () => {
      const parsed: ReturnType<typeof extractWWWAuthenticateParams> =
        extractWWWAuthenticateParams(
          responseWith(
            BearerChallengeBuilder.insufficientScope(
              "This connection was authorized as read-only, and this tool makes changes. Authorize again and allow read and write access to use it.",
            ),
          ),
        );

      expect(parsed.resourceMetadataUrl?.toString()).toBe(
        McpOAuthConfig.getProtectedResourceMetadataUrl(),
      );
      expect(parsed.scope).toBe("mcp:read mcp:write");
      expect(parsed.error).toBe("insufficient_scope");
    });

    /*
     * The SDK finds each parameter by scanning the whole header for its name
     * and takes the first match, quoted or not. A description is prose, and
     * prose can contain "scope=..." - so the parameters a client acts on are
     * written BEFORE the description, where nothing in it can shadow them.
     */
    it.each([
      ["401", "unauthorized"],
      ["403", "insufficientScope"],
    ] as Array<[string, "unauthorized" | "insufficientScope"]>)(
      "a %s description that looks like parameters cannot be read as them",
      (_status: string, method: "unauthorized" | "insufficientScope") => {
        const challenge: BearerChallenge = BearerChallengeBuilder[method](
          "Ask for scope=admin at resource_metadata=https://evil.example/prm and error=none",
        );

        const parsed: ReturnType<typeof extractWWWAuthenticateParams> =
          extractWWWAuthenticateParams(responseWith(challenge));

        expect(parsed.scope).toBe("mcp:read mcp:write");
        expect(parsed.resourceMetadataUrl?.toString()).toBe(
          McpOAuthConfig.getProtectedResourceMetadataUrl(),
        );
        expect(parsed.error).toBe(
          method === "unauthorized" ? "invalid_token" : "insufficient_scope",
        );
      },
    );

    it("puts the description last, after everything a client parses", () => {
      const header: string = BearerChallengeBuilder.unauthorized(
        "Sign in to continue.",
      ).headerValue;

      const descriptionAt: number = header.indexOf("error_description=");

      expect(descriptionAt).toBeGreaterThan(header.indexOf("error="));
      expect(descriptionAt).toBeGreaterThan(
        header.indexOf("resource_metadata="),
      );
      expect(descriptionAt).toBeGreaterThan(header.indexOf("scope="));
      expect(header.endsWith('error_description="Sign in to continue."')).toBe(
        true,
      );
    });
  });

  describe("quoting the description", () => {
    function descriptionInHeader(description: string): string {
      const challenge: BearerChallenge =
        BearerChallengeBuilder.unauthorized(description);
      const parsed: ParsedChallenge = parseChallenge(challenge.headerValue);

      // Whatever the description was, the header is still exactly four parameters.
      expect(parsed.names).toEqual([
        "error",
        "resource_metadata",
        "scope",
        "error_description",
      ]);
      expect(parsed.rebuilt).toBe(challenge.headerValue);
      expect(PRINTABLE_ASCII_PATTERN.test(challenge.headerValue)).toBe(true);
      expect(parsed.parameters["error"]).toBe("invalid_token");
      expect(parsed.parameters["scope"]).toBe("mcp:read mcp:write");
      expect(parsed.parameters["resource_metadata"]).toBe(
        McpOAuthConfig.getProtectedResourceMetadataUrl(),
      );

      return parsed.parameters["error_description"]!;
    }

    it("leaves ordinary text alone", () => {
      const text: string =
        "The access token is invalid, expired or has been revoked. (Try again!) #1 100% [ok] {x} ~";

      expect(descriptionInHeader(text)).toBe(text);
    });

    it("replaces a double quote, which would end the value", () => {
      expect(descriptionInHeader('He said "hello"')).toBe("He said 'hello'");
    });

    it("replaces a backslash, which would escape the closing quote", () => {
      expect(descriptionInHeader("C:\\path\\")).toBe("C:'path'");
    });

    it("cannot be used to add a parameter of its own", () => {
      const quoted: string = descriptionInHeader(
        'x", scope="admin", resource_metadata="https://evil.example/prm',
      );

      expect(quoted).not.toContain('"');
      expect(quoted).toBe(
        "x', scope='admin', resource_metadata='https://evil.example/prm",
      );
    });

    it("cannot be used to add a header of its own", () => {
      const quoted: string = descriptionInHeader(
        "first line\r\nSet-Cookie: session=stolen\nX-Other: 1",
      );

      expect(quoted).not.toContain("\r");
      expect(quoted).not.toContain("\n");
      expect(quoted).toBe("first line''Set-Cookie: session=stolen'X-Other: 1");
    });

    it.each([
      ["a tab", "a\tb", "a'b"],
      ["a NUL", "a\x00b", "a'b"],
      ["an escape character", "a\x1bb", "a'b"],
      ["a DEL", "a\x7fb", "a'b"],
      ["a Latin-1 letter", "caf\xe9", "caf'"],
      ["a character outside ASCII", `a${String.fromCodePoint(0x6771)}b`, "a'b"],
      ["a line separator", `a${String.fromCodePoint(0x2028)}b`, "a'b"],
    ])(
      "replaces %s",
      (_name: string, description: string, expected: string) => {
        expect(descriptionInHeader(description)).toBe(expected);
      },
    );

    it("keeps every printable ASCII character except the two it must not", () => {
      let all: string = "";

      for (let codePoint: number = 0x20; codePoint <= 0x7e; codePoint++) {
        all += String.fromCodePoint(codePoint);
      }

      const expected: string = all.replace('"', "'").replace("\\", "'");

      expect(descriptionInHeader(all)).toBe(expected);
    });

    it("handles an empty description", () => {
      const challenge: BearerChallenge =
        BearerChallengeBuilder.unauthorized("");

      expect(challenge.headerValue).toContain('error_description=""');
      expect(challenge.body.error_description).toBe("");
    });

    it("quotes only the header: the JSON body keeps the description as written", () => {
      const description: string = 'He said "hello"\nand left \\ behind';
      const challenge: BearerChallenge =
        BearerChallengeBuilder.insufficientScope(description);

      expect(challenge.body.error_description).toBe(description);
      expect(challenge.headerValue).not.toContain("\n");
    });
  });
});

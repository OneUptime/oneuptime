import ExternalMcpServerAuthType, {
  EXTERNAL_MCP_SERVER_AUTH_TYPES,
  isExternalMcpServerAuthType,
  readExternalMcpServerAuthType,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import {
  RESERVED_EXTERNAL_MCP_HEADER_NAMES,
  getExternalMcpServerHeadersProblem,
  getExternalMcpServerSecretProblem,
  getExternalMcpServerSignInProblem,
  getExternalMcpServerUrlProblem,
  isValidExternalMcpHeaderName,
  isValidExternalMcpHeaderValue,
  readExternalMcpServerHeaders,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerSettingsCheck";
import {
  MAX_EXTERNAL_MCP_HEADER_VALUE_CHARS,
  MAX_EXTERNAL_MCP_SECRET_CHARS,
  MAX_EXTERNAL_MCP_SERVER_HEADERS,
  MAX_EXTERNAL_MCP_URL_CHARS,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerLimits";
import { describe, expect, test } from "@jest/globals";

/*
 * What an external MCP server's settings must be before they are saved -
 * the same sentences the service refuses with and the Dashboard's form
 * says first.
 */

describe("getExternalMcpServerUrlProblem", () => {
  test("takes an https or http address with a host", () => {
    expect(getExternalMcpServerUrlProblem("https://mcp.example.com/mcp")).toBe(
      null,
    );
    expect(getExternalMcpServerUrlProblem("http://10.0.0.5:8000/sse")).toBe(
      null,
    );
    expect(
      getExternalMcpServerUrlProblem("  https://mcp.example.com/mcp  "),
    ).toBe(null);
  });

  test("needs one", () => {
    expect(getExternalMcpServerUrlProblem(undefined)).toBe(
      "The MCP server's URL is required.",
    );
    expect(getExternalMcpServerUrlProblem("   ")).toBe(
      "The MCP server's URL is required.",
    );
    expect(getExternalMcpServerUrlProblem(42)).toBe(
      "The MCP server's URL is required.",
    );
  });

  test("refuses what is not a URL, and says what one looks like", () => {
    expect(getExternalMcpServerUrlProblem("mcp.example.com")).toBe(
      "The MCP server's URL is not a valid URL. Use the full address, such as https://mcp.example.com/mcp.",
    );
  });

  test("refuses other schemes", () => {
    for (const url of [
      "ftp://mcp.example.com",
      "file:///etc/passwd",
      "ws://mcp.example.com/mcp",
      "javascript:alert(1)",
    ]) {
      expect(getExternalMcpServerUrlProblem(url)).toBe(
        "The MCP server's URL must start with https:// or http://.",
      );
    }
  });

  test("refuses a user name or password in the address", () => {
    expect(
      getExternalMcpServerUrlProblem("https://user:pass@mcp.example.com/mcp"),
    ).toBe(
      "The MCP server's URL cannot hold a user name or password. Put the sign-in under Authentication instead.",
    );
  });

  test("refuses an address longer than the limit, and names the field asked about", () => {
    expect(
      getExternalMcpServerUrlProblem(
        `https://mcp.example.com/${"a".repeat(MAX_EXTERNAL_MCP_URL_CHARS)}`,
        "The token URL",
      ),
    ).toBe(
      `The token URL can be at most ${MAX_EXTERNAL_MCP_URL_CHARS} characters long.`,
    );
  });
});

describe("header names and values", () => {
  test("a name is a token of letters, digits and the symbols RFC 9110 allows", () => {
    expect(isValidExternalMcpHeaderName("X-API-Key")).toBe(true);
    expect(isValidExternalMcpHeaderName("DD-APPLICATION-KEY")).toBe(true);
    expect(isValidExternalMcpHeaderName("x_custom.header~1")).toBe(true);
    expect(isValidExternalMcpHeaderName("")).toBe(false);
    expect(isValidExternalMcpHeaderName("X API Key")).toBe(false);
    expect(isValidExternalMcpHeaderName("X:Key")).toBe(false);
    expect(isValidExternalMcpHeaderName("Ключ")).toBe(false);
    expect(isValidExternalMcpHeaderName("x".repeat(101))).toBe(false);
  });

  test("a value holds no line break or other control character", () => {
    expect(isValidExternalMcpHeaderValue("abc 123\tdef")).toBe(true);
    expect(isValidExternalMcpHeaderValue("abc\r\nX-Injected: 1")).toBe(false);
    expect(isValidExternalMcpHeaderValue("abc\ndef")).toBe(false);
    expect(isValidExternalMcpHeaderValue("abc\u0000")).toBe(false);
    expect(isValidExternalMcpHeaderValue("abc\u007f")).toBe(false);
    expect(isValidExternalMcpHeaderValue("")).toBe(false);
    expect(
      isValidExternalMcpHeaderValue(
        "v".repeat(MAX_EXTERNAL_MCP_HEADER_VALUE_CHARS + 1),
      ),
    ).toBe(false);
  });

  test("reads stored headers, trimmed, leaving out what is not text", () => {
    expect(
      readExternalMcpServerHeaders({
        " X-API-Key ": " key ",
        Empty: "  ",
        Number: 5,
      }),
    ).toEqual({ "X-API-Key": "key" });
    expect(readExternalMcpServerHeaders(null)).toEqual({});
    expect(readExternalMcpServerHeaders(["a"])).toEqual({});
    expect(readExternalMcpServerHeaders("X-API-Key: key")).toEqual({});
  });
});

describe("getExternalMcpServerHeadersProblem", () => {
  test("takes valid headers", () => {
    expect(
      getExternalMcpServerHeadersProblem({
        "X-API-Key": "key",
        Authorization: "Token abc",
      }),
    ).toBe(null);
  });

  test("needs at least one", () => {
    for (const value of [undefined, null, {}, [], "text"]) {
      expect(getExternalMcpServerHeadersProblem(value)).toBe(
        "Add at least one header, such as X-API-Key, with its value.",
      );
    }
  });

  test("takes at most the limit", () => {
    const headers: Record<string, string> = {};

    for (
      let index: number = 0;
      index <= MAX_EXTERNAL_MCP_SERVER_HEADERS;
      index++
    ) {
      headers[`X-Header-${index}`] = "v";
    }

    expect(getExternalMcpServerHeadersProblem(headers)).toBe(
      `An MCP server can have at most ${MAX_EXTERNAL_MCP_SERVER_HEADERS} headers.`,
    );
  });

  test("refuses every header OneUptime sets itself, in any case", () => {
    for (const name of RESERVED_EXTERNAL_MCP_HEADER_NAMES) {
      const upper: string = name.toUpperCase();
      expect(getExternalMcpServerHeadersProblem({ [upper]: "v" })).toBe(
        `OneUptime sets the ${upper} header itself. Remove it from the headers.`,
      );
    }
  });

  test("the session and protocol headers, the host and the length are among them", () => {
    expect(RESERVED_EXTERNAL_MCP_HEADER_NAMES).toEqual(
      expect.arrayContaining([
        "mcp-session-id",
        "mcp-protocol-version",
        "host",
        "content-length",
        "transfer-encoding",
        "content-type",
        "accept",
      ]),
    );
    // Authorization is the server's own to choose (a token of its kind).
    expect(RESERVED_EXTERNAL_MCP_HEADER_NAMES).not.toContain("authorization");
  });

  test("refuses an invalid name, a missing value, a line break and a name given twice", () => {
    expect(getExternalMcpServerHeadersProblem({ "Bad Name": "v" })).toBe(
      '"Bad Name" is not a valid header name. Use letters, digits and dashes, such as X-API-Key.',
    );
    expect(getExternalMcpServerHeadersProblem({ "X-Key": "  " })).toBe(
      "The X-Key header needs a value.",
    );
    expect(getExternalMcpServerHeadersProblem({ "X-Key": 5 })).toBe(
      "The X-Key header needs a value.",
    );
    expect(
      getExternalMcpServerHeadersProblem({ "X-Key": "a\r\nInjected: yes" }),
    ).toBe("The value of the X-Key header is too long, or holds a line break.");
    expect(
      getExternalMcpServerHeadersProblem({ "X-Key": "a", "x-key": "b" }),
    ).toBe("The x-key header is there twice. Keep one.");
  });
});

describe("getExternalMcpServerSecretProblem", () => {
  test("takes a token, needs one, and refuses control characters or a token too long", () => {
    expect(getExternalMcpServerSecretProblem("ghp_abc", "The token")).toBe(
      null,
    );
    expect(getExternalMcpServerSecretProblem("", "The token")).toBe(
      "The token is required.",
    );
    expect(getExternalMcpServerSecretProblem("a\nb", "The token")).toBe(
      "The token cannot hold a line break or another control character.",
    );
    expect(
      getExternalMcpServerSecretProblem(
        "t".repeat(MAX_EXTERNAL_MCP_SECRET_CHARS + 1),
        "The token",
      ),
    ).toBe(
      `The token can be at most ${MAX_EXTERNAL_MCP_SECRET_CHARS} characters long.`,
    );
  });
});

describe("getExternalMcpServerSignInProblem", () => {
  test("None (or nothing said) needs nothing", () => {
    expect(
      getExternalMcpServerSignInProblem({
        signIn: { authType: ExternalMcpServerAuthType.None },
        isEdit: false,
      }),
    ).toBe(null);
    expect(
      getExternalMcpServerSignInProblem({ signIn: {}, isEdit: false }),
    ).toBe(null);
  });

  test("a bearer token is required on create, and kept on an edit that leaves it out", () => {
    expect(
      getExternalMcpServerSignInProblem({
        signIn: { authType: ExternalMcpServerAuthType.BearerToken },
        isEdit: false,
      }),
    ).toBe("The token is required.");
    expect(
      getExternalMcpServerSignInProblem({
        signIn: { authType: ExternalMcpServerAuthType.BearerToken },
        isEdit: true,
      }),
    ).toBe(null);
    expect(
      getExternalMcpServerSignInProblem({
        signIn: {
          authType: ExternalMcpServerAuthType.BearerToken,
          bearerToken: "abc",
        },
        isEdit: false,
      }),
    ).toBe(null);
  });

  test("headers are required on create, and checked when an edit sends them", () => {
    expect(
      getExternalMcpServerSignInProblem({
        signIn: { authType: ExternalMcpServerAuthType.Headers },
        isEdit: false,
      }),
    ).toBe("Add at least one header, such as X-API-Key, with its value.");
    expect(
      getExternalMcpServerSignInProblem({
        signIn: { authType: ExternalMcpServerAuthType.Headers },
        isEdit: true,
      }),
    ).toBe(null);
    expect(
      getExternalMcpServerSignInProblem({
        signIn: {
          authType: ExternalMcpServerAuthType.Headers,
          headers: { Host: "evil" },
        },
        isEdit: true,
      }),
    ).toBe(
      "OneUptime sets the Host header itself. Remove it from the headers.",
    );
  });

  test("OAuth client credentials need a token URL, a client ID and a secret", () => {
    const complete: Record<string, string> = {
      authType: ExternalMcpServerAuthType.OAuthClientCredentials,
      oauthTokenUrl: "https://login.example.com/oauth2/token",
      oauthClientId: "client",
      oauthClientSecret: "secret",
    };

    expect(
      getExternalMcpServerSignInProblem({ signIn: complete, isEdit: false }),
    ).toBe(null);
    expect(
      getExternalMcpServerSignInProblem({
        signIn: { ...complete, oauthTokenUrl: "not a url" },
        isEdit: false,
      }),
    ).toBe(
      "The token URL is not a valid URL. Use the full address, such as https://mcp.example.com/mcp.",
    );
    expect(
      getExternalMcpServerSignInProblem({
        signIn: { ...complete, oauthClientId: "" },
        isEdit: false,
      }),
    ).toBe("The client ID is required.");
    expect(
      getExternalMcpServerSignInProblem({
        signIn: {
          authType: ExternalMcpServerAuthType.OAuthClientCredentials,
          oauthTokenUrl: "https://login.example.com/oauth2/token",
          oauthClientId: "client",
        },
        isEdit: false,
      }),
    ).toBe("The client secret is required.");
    // An edit keeps the stored secret.
    expect(
      getExternalMcpServerSignInProblem({
        signIn: {
          authType: ExternalMcpServerAuthType.OAuthClientCredentials,
        },
        isEdit: true,
      }),
    ).toBe(null);
  });

  test("an Authentication OneUptime does not know is refused, naming the ones it does", () => {
    expect(
      getExternalMcpServerSignInProblem({
        signIn: { authType: "Kerberos" },
        isEdit: false,
      }),
    ).toBe(
      "Choose how OneUptime signs in to the MCP server: None, Bearer token, Headers or OAuth client credentials.",
    );
  });
});

describe("ExternalMcpServerAuthType", () => {
  test("knows its four kinds, and reads anything else as None", () => {
    expect(EXTERNAL_MCP_SERVER_AUTH_TYPES).toEqual([
      "None",
      "BearerToken",
      "Headers",
      "OAuthClientCredentials",
    ]);
    expect(isExternalMcpServerAuthType("Headers")).toBe(true);
    expect(isExternalMcpServerAuthType("headers")).toBe(false);
    expect(readExternalMcpServerAuthType(undefined)).toBe(
      ExternalMcpServerAuthType.None,
    );
    expect(readExternalMcpServerAuthType("Bogus")).toBe(
      ExternalMcpServerAuthType.None,
    );
    expect(readExternalMcpServerAuthType("BearerToken")).toBe(
      ExternalMcpServerAuthType.BearerToken,
    );
  });
});
